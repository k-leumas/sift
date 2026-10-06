import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { applyEnvOverrides, formatIssue, loadConfig, type SiftConfig } from '@sift/core/config';
import { redactText } from '@sift/core/log';
import {
  type AppDb,
  createAppDb,
  type IngestSession,
  MailboxDisabledError,
  readRegistry,
  requireDatabaseUrl,
  withIngestLock,
} from '@sift/db';
import type { CommandIO } from '../command.ts';
import { closeImap, type ImapFlow, openImap } from '../imap/connect.ts';
import { createFolderSource } from '../imap/folder-source.ts';
import { createDbStore } from '../ingest/db-store.ts';
import {
  BackfillRefusedError,
  countBackfill,
  type IngestDeps,
  runBackfill,
} from '../ingest/run.ts';
import type { IngestLog } from '../ingest/types.ts';
import {
  configEntryFor,
  ingestKind,
  MailboxSyncError,
  type OwnerMessageContext,
  ownerMessageFor,
  storedError,
  trackedSource,
} from '../runtime/mailbox-batch.ts';

const COMMAND = 'sift mailbox backfill';
export const USAGE = 'Usage: sift mailbox backfill <slug> [--days <n>] [--yes]';

/**
 * How long the backfill waits for the mailbox's ingest lock (D-03): one
 * default poll interval, so the CLI holds a database connection no longer
 * than one worker cycle before it gives up.
 */
export const BACKFILL_LOCK_WAIT_MS = 60_000;
/** Pause between two attempts to take the ingest lock. */
const LOCK_RETRY_MS = 2_000;
export const MIN_BACKFILL_DAYS = 1;
export const MAX_BACKFILL_DAYS = 365;
export const DEFAULT_BACKFILL_DAYS = 3;
/** Longest confirmation line read from stdin. */
const MAX_LINE_CHARS = 1_024;

export interface BackfillMailboxDeps {
  db: AppDb;
  /** The loaded config (after env overrides); the mailbox's IMAP and ingest settings come from it. */
  config: SiftConfig;
  /** For the mailbox's password_env. Values are never printed. */
  env: Readonly<Record<string, string | undefined>>;
  slug: string;
  days: number;
  /** Ask the owner; true ingests the counted messages. */
  confirm(count: number, days: number): Promise<boolean>;
  /** Defaults to BACKFILL_LOCK_WAIT_MS. */
  lockWaitMs?: number;
  signal?: AbortSignal;
  stdout(line: string): void;
  stderr(line: string): void;
  /** Tests only. */
  openImap?: typeof openImap;
}

/** Why the backfill stops, as one owner-facing line (never a server reply or mail content). */
class BackfillStop extends Error {}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Resolve after `ms`, or at once when `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const done = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

const silentLog: IngestLog = { info: () => {}, warn: () => {} };

/**
 * The explicit later backfill (D-75): count the messages of the last `days`
 * days, show the count, ask, then ingest exactly the counted UIDs as eligible,
 * with no new-mail cap, through the worker's pinned connection and engine.
 * last_uid, the watermark and the first-backfill cursor do not move.
 *
 * The mailbox's ingest lock is held from the count through the ingest, so the
 * worker can neither ingest the counted set in between nor run alongside
 * (D-03). The lock is retried for `lockWaitMs`, then the backfill refuses.
 *
 * Resolves the exit code: 0 after a backfill or a declined confirmation
 * (nothing changed), 1 when it could not run or was stopped.
 */
export async function backfillMailbox(deps: BackfillMailboxDeps): Promise<0 | 1> {
  const { slug, days } = deps;
  const secrets: string[] = [];
  const fail = (message: string): 1 => {
    deps.stderr(`${COMMAND}: ${redactText(message, secrets)}`);
    return 1;
  };

  let ctx: OwnerMessageContext | undefined;
  try {
    const row = (await readRegistry(deps.db)).find((r) => r.slug === slug);
    if (row === undefined) return fail(`no mailbox with slug "${slug}"`);
    const entry = configEntryFor(deps.config, row);
    if (entry === undefined) {
      return fail(`mailbox ${slug} is not in the config file this command loaded`);
    }
    ctx = {
      slug,
      host: entry.imap.host,
      port: entry.imap.port,
      pinned: entry.imap.tls.pin_sha256 !== undefined,
      passwordEnv: entry.imap.password_env,
    };
    const password = deps.env[entry.imap.password_env];
    if (password === undefined || password === '') {
      return fail(ownerMessageFor(new MailboxSyncError('password_missing', ''), ctx).message);
    }
    secrets.push(password);
    const owner = ctx;
    const open = deps.openImap ?? openImap;
    const signal = deps.signal ?? new AbortController().signal;

    const ingest = async (session: IngestSession): Promise<0 | 1> => {
      // requireActive rechecks disabled_at inside the lock (D-45).
      await session.run(async () => {}, { requireActive: true });
      let client: ImapFlow;
      try {
        client = await open({
          host: entry.imap.host,
          port: entry.imap.port,
          user: entry.imap.username,
          pass: password,
          tls: { mode: entry.imap.tls.mode, pinSha256: entry.imap.tls.pin_sha256 },
        });
      } catch (error) {
        throw new BackfillStop(ownerMessageFor(error, owner).message, { cause: error });
      }
      const imapErrors = new WeakSet<object>();
      try {
        const engine: IngestDeps = {
          source: trackedSource(createFolderSource(client), imapErrors),
          store: createDbStore(session),
          folder: entry.imap.folder,
          trustPmHeader: entry.labels.apply_as === 'proton_labels',
          // Not used by the backfill: the owner confirmed this count (D-75).
          newMailCap: entry.ingest.new_mail_cap,
          initialBackfillDays: entry.ingest.initial_backfill_days,
          now: () => new Date(),
          signal,
          log: silentLog,
        };
        const plan = await countBackfill(engine, days);
        deps.stdout(
          `Found ${plural(plan.count, 'message')} from the last ${plural(days, 'day')} ` +
            `in ${entry.imap.folder} of ${slug}.`,
        );
        if (!(await deps.confirm(plan.count, days))) {
          deps.stdout('Nothing changed.');
          return 0;
        }
        const outcome = await runBackfill(engine, plan);
        if (outcome.kind === 'aborted') {
          return fail(`Backfill of ${slug} stopped between chunks; run it again to finish.`);
        }
        deps.stdout(
          `Backfilled ${slug}: stored ${outcome.inserted} new, ${outcome.existing} already stored.`,
        );
        return 0;
      } catch (error) {
        if (typeof error === 'object' && error !== null && imapErrors.has(error)) {
          const kind = ingestKind(error, client);
          throw new BackfillStop(ownerMessageFor(new MailboxSyncError(kind, ''), owner).message, {
            cause: error,
          });
        }
        throw error;
      } finally {
        // Bounded and never throws (02-18), so the lock is always released.
        await closeImap(client);
      }
    };

    const lockWaitMs = deps.lockWaitMs ?? BACKFILL_LOCK_WAIT_MS;
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      if (signal.aborted)
        return fail(`backfill of ${slug} stopped before it started; nothing changed`);
      const locked = await withIngestLock(deps.db, row.id, ingest);
      if (locked.acquired) return locked.value;
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        return fail(`the worker is ingesting ${slug} right now; try again in a minute`);
      await pause(Math.min(LOCK_RETRY_MS, remaining), signal);
    }
  } catch (error) {
    if (error instanceof BackfillStop) return fail(error.message);
    if (error instanceof BackfillRefusedError) {
      return fail(
        error.reason === 'not_synced'
          ? `the worker has not synced ${slug} yet; start the worker first`
          : `${slug} is being resynced; try again after the worker finishes`,
      );
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

/** --days as a whole number of days in range, or null. */
function parseDays(raw: string): number | null {
  if (!/^\d{1,3}$/.test(raw)) return null;
  const days = Number(raw);
  return days >= MIN_BACKFILL_DAYS && days <= MAX_BACKFILL_DAYS ? days : null;
}

/**
 * `sift mailbox backfill <slug> [--days <n>] [--yes]` (D-75): count the
 * mailbox's messages from the last n days (default 3, 1-365), print the count,
 * ask the owner to type yes (or take --yes), then ingest exactly those
 * messages, waiting for the worker's ingest lock first (D-03). Ctrl-C stops
 * it between chunks.
 *
 * Env: SIFT_DATABASE_URL (required), the config file (SIFT_CONFIG) and the
 * mailbox's password_env. Output holds counts only; no password, database URL
 * or mail content is ever printed.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  let slug: string;
  let days: number;
  let yes: boolean;
  try {
    const { values, positionals } = parseArgs({
      args: [...args],
      options: {
        days: { type: 'string', default: String(DEFAULT_BACKFILL_DAYS) },
        yes: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: true,
    });
    const parsedDays = parseDays(values.days);
    const [first] = positionals;
    if (positionals.length !== 1 || first === undefined) {
      io.stderr(USAGE);
      return 2;
    }
    if (parsedDays === null) {
      io.stderr(
        `${COMMAND}: --days must be a whole number from ${MIN_BACKFILL_DAYS} to ${MAX_BACKFILL_DAYS}`,
      );
      io.stderr(USAGE);
      return 2;
    }
    slug = first;
    days = parsedDays;
    yes = values.yes;
  } catch (error) {
    io.stderr(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}`);
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

  const controller = new AbortController();
  const onSigint = (): void => controller.abort();
  process.once('SIGINT', onSigint);
  // Two connections: the lock's own, and one for the registry read.
  const db = createAppDb(url, { maxConnections: 2 });
  try {
    return await backfillMailbox({
      db,
      config: overridden.config,
      env: io.env,
      slug,
      days,
      confirm: async () => {
        if (yes) return true;
        io.stdout('Ingest them? Type yes to continue:');
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
