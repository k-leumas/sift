import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { applyEnvOverrides, formatIssue, loadConfig, type SiftConfig } from '@sift/core/config';
import { redactText } from '@sift/core/log';
import { resolveDataPath } from '@sift/core/rules';
import {
  type AppDb,
  type CandidateQuery,
  type ClassifyCandidate,
  createAppDb,
  type IngestSession,
  MailboxDisabledError,
  readRegistry,
  requireDatabaseUrl,
  withIngestLock,
} from '@sift/db';
import { type RefetchDeps, RefetchFailedError, refetchBodies } from '../classify/refetch.ts';
import {
  CLASSIFY_CHUNK_SIZE,
  type ClassifyContext,
  type ClassifyLog,
  type ClassifyRuntime,
  classifyCandidates,
  createClassifyRuntime,
  infraOwnerMessage,
  loadMailboxRules,
  newPassState,
  OLLAMA_MESSAGE_FAILURE_LOG,
} from '../classify/run.ts';
import { createSingleFlight } from '../classify/single-flight.ts';
import type { CommandIO } from '../command.ts';
import type { openImap } from '../imap/connect.ts';
import {
  configEntryFor,
  MailboxSyncError,
  ownerMessageFor,
  storedError,
} from '../runtime/mailbox-batch.ts';

const COMMAND = 'sift classify';
export const USAGE =
  'Usage: sift classify <slug> (--message <id> | --since <YYYY-MM-DD> | --all-pending) [--yes]';

/** Above this many selected messages the owner must confirm (D-17, like P2 D-75). */
export const CLASSIFY_CONFIRM_THRESHOLD = 20;
/**
 * How long the command waits for the mailbox's ingest lock (D-17, P2 D-03):
 * the worker holds it for one 5-message chunk at a time, so five minutes
 * covers a slow model several times over.
 */
export const CLASSIFY_LOCK_WAIT_MS = 300_000;
/** Pause between two attempts to take the ingest lock. */
const LOCK_RETRY_MS = 2_000;
/** Longest confirmation line read from stdin. */
const MAX_LINE_CHARS = 1_024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Which messages a re-run selects (exactly one per command). */
export type Selector =
  | { kind: 'message'; id: string }
  | { kind: 'since'; since: Date }
  | { kind: 'pending' };

export interface ClassifyCommandDeps {
  db: AppDb;
  /** The loaded config (after env overrides): models.llm, the threshold, the mailbox's IMAP entry. */
  config: SiftConfig;
  /** For the mailbox's password_env when a body must be refetched. Values are never printed. */
  env: Readonly<Record<string, string | undefined>>;
  slug: string;
  selector: Selector;
  /** The data dir holding mailboxes/<slug>/rules.yaml (the runtime's own). */
  dataDir: string;
  runtime: ClassifyRuntime;
  /** Ask the owner; true classifies the counted messages. */
  confirm(count: number): Promise<boolean>;
  /** Defaults to CLASSIFY_LOCK_WAIT_MS. */
  lockWaitMs?: number;
  signal?: AbortSignal;
  stdout(line: string): void;
  stderr(line: string): void;
  /** Tests only. */
  openImap?: typeof openImap;
  now?: () => Date;
}

/** Why the command stops, as one owner-facing line (never mail content or Ollama text). */
class ClassifyStop extends Error {}

const STOPPED = 'stopped; run it again to finish';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Resolve after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/** The candidate query of a selector, without paging. */
function selectionOf(selector: Selector): Omit<CandidateQuery, 'limit' | 'before'> {
  switch (selector.kind) {
    case 'message':
      return { pendingOnly: false, messageIds: [selector.id] };
    case 'since':
      return { pendingOnly: false, since: selector.since };
    case 'pending':
      return { pendingOnly: true };
  }
}

/**
 * The explicit re-run (D-17): select messages of one mailbox, show the count,
 * ask above CLASSIFY_CONFIRM_THRESHOLD, then classify them through the same
 * tiers, rules, prompt and single write path as the worker (classifyCandidates),
 * with no per-pass cap. Every decision is appended with decided_by rerun; an
 * earlier decision is never changed, and the newest is the current one.
 *
 * Selection and each CLASSIFY_CHUNK_SIZE chunk run under the mailbox's ingest
 * lock, so the command never classifies alongside the worker (P2 D-03). The
 * lock is retried for `lockWaitMs`, then the command refuses. It is not held
 * while the owner reads the prompt.
 *
 * A selected message whose cached body has expired is refetched from IMAP
 * first (D-32, refetchBodies): read-only, by its location under the current
 * UIDVALIDITY, and only when the server copy's identity key equals the stored
 * one. A message that is gone or no longer matches is skipped with one line
 * naming its id. No IMAP connection is opened when every body is cached.
 *
 * An Ollama outage stops the command (exit 1) with the owner message and the
 * counts done and left. The command never writes mailbox_status. Output holds
 * counts, ids and fixed text only (T-03-47).
 */
export async function classifyCommand(deps: ClassifyCommandDeps): Promise<0 | 1> {
  const { slug, selector } = deps;
  const secrets: string[] = [];
  const fail = (message: string): 1 => {
    deps.stderr(`${COMMAND}: ${redactText(message, secrets)}`);
    return 1;
  };

  try {
    const row = (await readRegistry(deps.db)).find((r) => r.slug === slug);
    if (row === undefined) return fail(`no mailbox ${slug}`);
    if (row.disabledAt !== null) return fail(`mailbox ${slug} is disabled; nothing changed`);

    const rules = await loadMailboxRules(deps.dataDir, slug);
    if (!rules.ok) {
      for (const issue of rules.issues) deps.stderr(formatIssue(issue, rules.path));
      return 1;
    }

    const signal = deps.signal ?? new AbortController().signal;
    const lockWaitMs = deps.lockWaitMs ?? CLASSIFY_LOCK_WAIT_MS;
    let toldWaiting = false;

    /** Run `fn` under the mailbox's ingest lock, retried for lockWaitMs (P2 D-03). */
    const underLock = async <T>(fn: (session: IngestSession) => Promise<T>): Promise<T> => {
      const deadline = Date.now() + lockWaitMs;
      for (;;) {
        if (signal.aborted) throw new ClassifyStop(STOPPED);
        const locked = await withIngestLock(deps.db, row.id, fn);
        if (locked.acquired) return locked.value;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new ClassifyStop(
            `the worker is classifying ${slug} right now; try again in a few minutes`,
          );
        }
        if (!toldWaiting) {
          toldWaiting = true;
          deps.stderr(
            `${COMMAND}: waiting for the worker to release ${slug} (it may be classifying; Ctrl-C to stop)`,
          );
        }
        await pause(Math.min(LOCK_RETRY_MS, remaining), signal);
      }
    };

    // Selection: ids only, newest first, keyset-paged under one lock.
    const selection = selectionOf(selector);
    const ids = await underLock(async (session) => {
      const found: string[] = [];
      let before: { internalDate: Date; id: string } | undefined;
      for (;;) {
        const cursor = before;
        const page = await session.run(
          (s) =>
            s.classification.candidates({
              ...selection,
              limit: CLASSIFY_CHUNK_SIZE,
              ...(cursor === undefined ? {} : { before: cursor }),
            }),
          { requireActive: true },
        );
        for (const c of page) found.push(c.id);
        const last = page.at(-1);
        if (last === undefined || page.length < CLASSIFY_CHUNK_SIZE) return found;
        before = { internalDate: last.internalDate, id: last.id };
      }
    });

    if (selector.kind === 'message' && ids.length === 0) {
      return fail(
        `message ${selector.id} is not an eligible message of ${slug} with a live location; nothing changed`,
      );
    }
    const total = ids.length;
    deps.stdout(`Found ${plural(total, 'message')} to classify in ${slug}.`);
    if (total === 0) return 0;
    // The lock is released while the owner reads the prompt.
    if (total > CLASSIFY_CONFIRM_THRESHOLD && !(await deps.confirm(total))) {
      deps.stdout('Nothing changed.');
      return 0;
    }

    const state = newPassState(null);
    const log: ClassifyLog = {
      info: () => {},
      warn: (obj, msg) => {
        if (msg === OLLAMA_MESSAGE_FAILURE_LOG) {
          // A 5xx or timeout on this message alone (healthy re-probe, CR-01): the id and
          // the HTTP status, or the failure code when there is none. Never the object's
          // other fields, and never Ollama's error text (T-03-74).
          const { message, code, status } = obj as {
            message?: unknown;
            code?: unknown;
            status?: unknown;
          };
          const why = typeof status === 'number' ? `HTTP ${status}` : String(code);
          deps.stderr(
            `message ${String(message)}: Ollama failed on this message (${why}); skipped`,
          );
          return;
        }
        // classifyCandidates logs a failed message by id and code only.
        if (msg !== 'classify: message failed') return;
        const { message, code } = obj as { message?: unknown; code?: unknown };
        deps.stderr(`message ${String(message)}: could not be classified (${String(code)})`);
      },
    };
    const ctx: ClassifyContext = {
      db: deps.db,
      slug,
      rules,
      model: deps.config.models.llm,
      threshold: deps.config.tiers.llm.confidence_threshold,
      runtime: deps.runtime,
      signal,
      log,
      decidedBy: 'rerun',
      state,
      now: deps.now ?? (() => new Date()),
    };
    /** Selected messages this run will not classify (gone, changed, decided meanwhile). */
    let dropped = 0;
    const classified = (): number => state.labelled + state.review;

    let refetch: RefetchDeps | undefined;
    /** The IMAP entry and password, resolved when a body first needs a refetch (D-32). */
    const refetchDeps = (): RefetchDeps => {
      if (refetch !== undefined) return refetch;
      const entry = configEntryFor(deps.config, row);
      if (entry === undefined) {
        throw new ClassifyStop(
          `mailbox ${slug} is not in the config file this command loaded, so its expired bodies cannot be refetched`,
        );
      }
      const password = deps.env[entry.imap.password_env];
      if (password === undefined || password === '') {
        const owner = {
          slug,
          host: entry.imap.host,
          port: entry.imap.port,
          pinned: entry.imap.tls.pin_sha256 !== undefined,
          passwordEnv: entry.imap.password_env,
        };
        throw new ClassifyStop(
          ownerMessageFor(new MailboxSyncError('password_missing', ''), owner).message,
        );
      }
      secrets.push(password);
      refetch = {
        entry,
        password,
        ...(deps.openImap === undefined ? {} : { openImap: deps.openImap }),
      };
      return refetch;
    };

    for (let start = 0; start < total; start += CLASSIFY_CHUNK_SIZE) {
      const chunk = ids.slice(start, start + CLASSIFY_CHUNK_SIZE);
      const step = await underLock(async (session) => {
        const read = async (messageIds: readonly string[]): Promise<ClassifyCandidate[]> =>
          messageIds.length === 0
            ? []
            : session.run(
                (s) =>
                  s.classification.candidates({
                    pendingOnly: selection.pendingOnly,
                    messageIds,
                    limit: messageIds.length,
                  }),
                { requireActive: true },
              );
        // Re-read under this lock: --all-pending skips what the worker decided meanwhile.
        let candidates = await read(chunk);
        dropped += chunk.length - candidates.length;
        if (candidates.some((c) => c.body === null)) {
          const results = await refetchBodies(session, candidates, refetchDeps());
          for (const [id, result] of results) {
            if (result === 'restored') continue;
            dropped += 1;
            deps.stderr(
              result === 'gone'
                ? `message ${id}: its body is no longer on the server; skipped`
                : `message ${id}: the server copy no longer matches; skipped`,
            );
          }
          // Re-read, so a restored body is classified exactly as stored.
          const usable = candidates.filter((c) => {
            const result = results.get(c.id);
            return result === undefined || result === 'restored';
          });
          candidates = await read(usable.map((c) => c.id));
        }
        return classifyCandidates(
          session,
          candidates.filter((c) => c.body !== null),
          ctx,
        );
      });
      if (step === 'aborted') return fail(STOPPED);
      if (state.llmBlocked !== null) {
        const { code, status, detail } = state.llmBlocked;
        fail(
          infraOwnerMessage(code, {
            modelsUrl: deps.runtime.modelsUrl,
            model: ctx.model,
            status,
            detail,
          }),
        );
        return fail(
          `classified ${classified()} of ${total}; ${total - classified() - dropped} left`,
        );
      }
    }

    const skipped = total - classified();
    deps.stdout(
      `Classified ${plural(classified(), 'message')} of ${slug}: ` +
        `${state.labelled} labelled, ${state.review} review` +
        `${skipped > 0 ? `; ${skipped} skipped` : ''}.`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ClassifyStop || error instanceof RefetchFailedError) {
      return fail(error.message);
    }
    if (error instanceof MailboxDisabledError) {
      return fail(`mailbox ${slug} is disabled; nothing changed`);
    }
    // Drizzle's "Failed query: ... params: ..." wrapper can carry mail fields;
    // report the coded error inside it instead.
    const root = storedError(error);
    return fail(root instanceof Error ? root.message : String(root));
  }
}

function text(chunk: string | Buffer): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
}

/** One line from stdin without its line ending, or null on empty input or an over-long line. */
async function readLine(stdin: CommandIO['stdin']): Promise<string | null> {
  if (stdin === undefined) return null;
  let buffered = '';
  for await (const chunk of stdin) {
    buffered += text(chunk);
    const end = buffered.indexOf('\n');
    if (end >= 0) return buffered.slice(0, end).replace(/\r$/, '');
    if (buffered.length > MAX_LINE_CHARS) return null;
  }
  return buffered === '' ? null : buffered.replace(/\r$/, '');
}

/** A YYYY-MM-DD calendar date as UTC midnight, or null when it is not a real date. */
export function parseDay(raw: string): Date | null {
  const m = DAY.exec(raw);
  if (m === null) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

type Parsed =
  | { ok: true; slug: string; selector: Selector; yes: boolean }
  | { ok: false; message: string | null };

/** The command line, or why it is not one (null: just the usage). */
export function parseClassifyArgs(args: readonly string[], now: Date): Parsed {
  let values: { message?: string; since?: string; 'all-pending'?: boolean; yes?: boolean };
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: [...args],
      options: {
        message: { type: 'string' },
        since: { type: 'string' },
        'all-pending': { type: 'boolean' },
        yes: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
  const [slug] = positionals;
  if (positionals.length !== 1 || slug === undefined) return { ok: false, message: null };
  const chosen = [
    values.message !== undefined,
    values.since !== undefined,
    values['all-pending'] === true,
  ].filter(Boolean).length;
  if (chosen !== 1) {
    return { ok: false, message: 'give exactly one of --message, --since or --all-pending' };
  }
  const yes = values.yes === true;
  if (values.message !== undefined) {
    if (!UUID.test(values.message)) return { ok: false, message: '--message must be a message id' };
    return { ok: true, slug, selector: { kind: 'message', id: values.message.toLowerCase() }, yes };
  }
  if (values.since !== undefined) {
    const since = parseDay(values.since);
    if (since === null) return { ok: false, message: '--since must be a date as YYYY-MM-DD' };
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    if (since.getTime() > today) return { ok: false, message: '--since must not be after today' };
    return { ok: true, slug, selector: { kind: 'since', since }, yes };
  }
  return { ok: true, slug, selector: { kind: 'pending' }, yes };
}

/**
 * `sift classify <slug> (--message <id> | --since <YYYY-MM-DD> | --all-pending) [--yes]`
 * (D-17): classify one message again, every eligible message received on or
 * after a date (decided or not), or every pending message. Above 20 messages
 * it asks the owner to type yes (or takes --yes). It waits up to five minutes
 * for the worker's ingest lock first; Ctrl-C stops it between messages.
 *
 * Env: SIFT_DATABASE_URL (required), the config file (SIFT_CONFIG), SIFT_DATA
 * and, for an expired body, the mailbox's password_env. Output holds counts,
 * ids and fixed text only; no password, database URL or mail content.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  const parsed = parseClassifyArgs(args, new Date());
  if (!parsed.ok) {
    if (parsed.message !== null) io.stderr(`${COMMAND}: ${parsed.message}`);
    io.stderr(USAGE);
    return 2;
  }

  const path = resolveConfigPath(io.env, io.cwd);
  const loaded = await loadConfig(path);
  if (!loaded.ok) {
    for (const issue of loaded.issues) io.stderr(formatIssue(issue, path));
    return 1;
  }
  const overridden = applyEnvOverrides(loaded.config, io.env);
  if (!overridden.ok) {
    for (const issue of overridden.issues) io.stderr(formatIssue(issue, overridden.source));
    return 1;
  }

  let url: string;
  try {
    url = requireDatabaseUrl(io.env, 'SIFT_DATABASE_URL');
  } catch (error) {
    io.stderr(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const config = overridden.config;
  const dataDir = resolveDataPath(io.env, io.cwd);
  // Its own gate: this process sends Ollama one request at a time (D-19).
  const runtime = createClassifyRuntime({
    dataDir,
    modelsUrl: config.models.url,
    gate: createSingleFlight(),
  });
  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once('SIGINT', onSigint);
  // Two connections: the lock's own, and one for the registry read and prompt version.
  const db = createAppDb(url, { maxConnections: 2 });
  try {
    return await classifyCommand({
      db,
      config,
      env: io.env,
      slug: parsed.slug,
      selector: parsed.selector,
      dataDir,
      runtime,
      confirm: async () => {
        if (parsed.yes) return true;
        io.stdout('Classify them? Type yes to continue:');
        const line = await readLine(io.stdin);
        return line !== null && line.trim().toLowerCase() === 'yes';
      },
      signal: controller.signal,
      stdout: io.stdout,
      stderr: (line) => io.stderr(redactText(line, [url])),
    });
  } finally {
    process.off('SIGINT', onSigint);
    await db.close();
  }
}
