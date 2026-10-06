import type { MailboxConfig, SiftConfig } from '@sift/core/config';
import { imapIdentityKey } from '@sift/core/config';
import {
  type AppDb,
  MailboxDisabledError,
  type RegistryRow,
  readHold,
  readRegistry,
  recordBackfillProgress,
  recordConnecting,
  recordDisabled,
  recordMailboxSeen,
  recordNeedsAttention,
  recordSyncError,
  recordSyncSuccess,
  withIngestLock,
  withMailbox,
} from '@sift/db';
import {
  classifyImapError,
  closeImap,
  type ImapErrorClass,
  type ImapFlow,
  openImap,
} from '../imap/connect.ts';
import { createFolderSource } from '../imap/folder-source.ts';
import { createDbStore } from '../ingest/db-store.ts';
import { REMOVAL_DIFF_INTERVAL_MS, runIngest } from '../ingest/run.ts';
import type { FolderSource, IngestLog, IngestOutcome } from '../ingest/types.ts';
import type { MailboxEntry, SupervisorDeps, SupervisorLog } from './supervisor.ts';

export type MailboxCallbacks = Pick<
  SupervisorDeps,
  'readRegistry' | 'runBatch' | 'onBatchError' | 'onMailboxStopped'
>;

/**
 * After the worker starts, connection failures (unreachable, timeout) show as
 * `connecting`, not as an error: Bridge and the worker start together, and a
 * routine start must never show a misleading error (D-34).
 */
export const STARTUP_GRACE_MS = 60_000;

/** The one-shot Bridge setup the owner runs to (re)authorise Bridge (D-72, D-79). */
export const BRIDGE_INIT_COMMAND = 'docker compose run --rm bridge-init';

/** Why a mailbox run failed, as the owner sees it in mailbox_status (D-33, D-34, D-73). */
export type MailboxSyncErrorKind = ImapErrorClass | 'password_missing' | 'not_in_config';

/**
 * A classified mailbox failure. The message is owner-facing and secret-free
 * (ownerMessageFor); the original error, when there is one, is the `cause`,
 * which the supervisor logs through its redaction.
 */
export class MailboxSyncError extends Error {
  readonly kind: MailboxSyncErrorKind;

  constructor(kind: MailboxSyncErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailboxSyncError';
    this.kind = kind;
  }
}

/** What an owner message may name: never a password, server reply or mail content. */
export interface OwnerMessageContext {
  slug: string;
  host: string;
  port: number;
  /** The mailbox has imap.tls.pin_sha256 set. */
  pinned: boolean;
  /** The mailbox's password_env variable name (the name, never the value). */
  passwordEnv?: string;
}

function messageFor(kind: MailboxSyncErrorKind, ctx: OwnerMessageContext): string {
  const { slug, host, port } = ctx;
  const pinMismatch = `The IMAP server's certificate for mailbox ${slug} does not match imap.tls.pin_sha256. If you reinstalled Bridge, run sift bridge trust ${slug} to see the fingerprint the worker sees, compare it with the one ${BRIDGE_INIT_COMMAND} printed, and update config.yaml.`;
  switch (kind) {
    case 'pin_mismatch':
      return pinMismatch;
    case 'cert_untrusted':
      return ctx.pinned
        ? pinMismatch
        : `The IMAP server's certificate for mailbox ${slug} is not trusted. For Proton Bridge, set imap.tls.pin_sha256 (shown by ${BRIDGE_INIT_COMMAND} and sift bridge trust ${slug}); Sift never turns certificate checks off.`;
    case 'auth_rejected':
      return `Bridge rejected login: run ${BRIDGE_INIT_COMMAND}`;
    case 'unreachable':
    case 'timeout':
      return `IMAP server unreachable at ${host}:${port}`;
    case 'no_starttls':
      return `IMAP server at ${host}:${port} does not offer STARTTLS; Sift never logs in without TLS`;
    case 'protocol':
      return `IMAP server at ${host}:${port} gave an unexpected response for mailbox ${slug}; see the worker log (docker compose logs worker)`;
    case 'password_missing':
      return `Missing env var: ${ctx.passwordEnv ?? 'its password_env variable'} (password_env of mailbox ${slug}); add it to .env.mailboxes and recreate the worker`;
    case 'not_in_config':
      return `mailbox ${slug} is not in the config this worker loaded; recreate the worker: docker compose up -d --force-recreate worker`;
    default: {
      // A new MailboxSyncErrorKind without a message fails typecheck here.
      const unhandled: never = kind;
      throw new Error(`no owner message for ${String(unhandled)}`);
    }
  }
}

/**
 * The owner-facing kind and message for a mailbox failure: a MailboxSyncError
 * keeps its kind, anything else is classified by its codes and flags
 * (classifyImapError). The text is a fixed template over `ctx`, so it never
 * carries a password, a server reply or mail content (T-02-43).
 */
export function ownerMessageFor(
  error: unknown,
  ctx: OwnerMessageContext,
): { kind: MailboxSyncErrorKind; message: string } {
  const kind = error instanceof MailboxSyncError ? error.kind : classifyImapError(error);
  return { kind, message: messageFor(kind, ctx) };
}

function syncError(
  kind: MailboxSyncErrorKind,
  ctx: OwnerMessageContext,
  cause?: unknown,
): MailboxSyncError {
  return new MailboxSyncError(
    kind,
    messageFor(kind, ctx),
    cause === undefined ? undefined : { cause },
  );
}

/** What the worker's mailbox runs need besides the database (D-73, D-74, D-78). */
export interface MailboxIngestOptions {
  /** The config this worker loaded; each mailbox's IMAP and ingest settings come from it. */
  config: SiftConfig;
  /** The worker's environment, for each mailbox's password_env. Values are never logged. */
  env: Readonly<Record<string, string | undefined>>;
  log: SupervisorLog;
  /** Clock in epoch ms (tests inject one). */
  now?: () => number;
  /** When the worker started, in epoch ms; defaults to now() at creation. */
  startedAt?: number;
  /** Defaults to STARTUP_GRACE_MS. */
  startupGraceMs?: number;
  openImap?: typeof openImap;
  /** The engine's throttle pause; tests inject a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Tests only; defaults to the engine's BACKFILL_SLICE_SIZE. */
  backfillSliceSize?: number;
}

/** The config entry for a registry row: same IMAP identity (D-64). Also used by sift mailbox backfill. */
export function configEntryFor(config: SiftConfig, row: RegistryRow): MailboxConfig | undefined {
  const key = imapIdentityKey(row.imapHost, row.imapUsername, row.imapFolder);
  return config.mailboxes.find(
    (m) => imapIdentityKey(m.imap.host, m.imap.username, m.imap.folder) === key,
  );
}

/**
 * The FolderSource with every error it throws remembered in `seen`, so a
 * failed ingest can tell an IMAP failure (classified for the owner) from a
 * database or engine failure (recorded as is, redacted).
 */
export function trackedSource(source: FolderSource, seen: WeakSet<object>): FolderSource {
  const track = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      if (typeof error === 'object' && error !== null) seen.add(error);
      throw error;
    }
  };
  return {
    examine: (folder) => track(() => source.examine(folder)),
    fetchDates: (range) => track(() => source.fetchDates(range)),
    fetchHeaders: (uids) => track(() => source.fetchHeaders(uids)),
    listUids: (range) => track(() => source.listUids(range)),
    searchSince: (since) => track(() => source.searchSince(since)),
    downloadText: (uid, part, maxBytes) => track(() => source.downloadText(uid, part, maxBytes)),
  };
}

/** Kind of an IMAP failure during ingest; a dropped connection counts as unreachable. */
export function ingestKind(error: unknown, client: ImapFlow): ImapErrorClass {
  const kind = classifyImapError(error);
  return kind === 'protocol' && !client.usable ? 'unreachable' : kind;
}

/**
 * The error to store for an unclassified failure: the first error in the
 * cause chain that carries a code (a pg error inside Drizzle's "Failed query:
 * <sql> params: ..." wrapper, whose params can hold mail fields), else the
 * error itself. recordSyncError then redacts the secrets.
 */
export function storedError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (typeof (current as { code?: unknown }).code === 'string') return current;
    current = current.cause;
  }
  return error;
}

/**
 * The supervisor's per-mailbox callbacks (D-49). A run takes the mailbox's
 * ingest lock (D-03), checks the mailbox is active and not held (D-45, D-26),
 * connects with its configured TLS mode and pin (D-40, D-73), runs the sync
 * engine against the database store with its ingest settings (D-74, D-75)
 * and records the outcome. Every write goes through the scoped @sift/db API
 * (ISO-04).
 *
 * Failures reject runBatch, so the supervisor backs off (P1 D-51), and
 * onBatchError records them per mailbox: connecting inside the startup grace
 * (D-34), otherwise a specific owner message (ownerMessageFor) or the
 * redacted error.
 *
 * `secrets` are the mailbox password values; recordSyncError masks them in
 * last_error (D-51, T-01-40).
 */
export function createMailboxCallbacks(
  db: AppDb,
  secrets: readonly string[],
  ingest: MailboxIngestOptions,
): MailboxCallbacks {
  const nowMs = ingest.now ?? Date.now;
  const nowDate = (): Date => new Date(nowMs());
  const startedAt = ingest.startedAt ?? nowMs();
  const graceMs = ingest.startupGraceMs ?? STARTUP_GRACE_MS;
  const open = ingest.openImap ?? openImap;
  const registry = new Map<string, RegistryRow>();
  /** Per mailbox: when the last removal diff ran (D-17), in memory only. */
  const lastRemovalDiffAt = new Map<string, number>();

  async function refreshRegistry(): Promise<RegistryRow[]> {
    const rows = await readRegistry(db);
    registry.clear();
    for (const row of rows) registry.set(row.id, row);
    return rows;
  }

  function boundLog(slug: string): IngestLog {
    return {
      info: (obj, msg) => ingest.log.info({ mailbox: slug, ...obj }, msg),
      warn: (obj, msg) => ingest.log.warn({ mailbox: slug, ...obj }, msg),
    };
  }

  return {
    async readRegistry(): Promise<MailboxEntry[]> {
      const rows = await refreshRegistry();
      return rows.map((row) => ({ id: row.id, slug: row.slug, disabledAt: row.disabledAt }));
    },

    async runBatch(mailbox: MailboxEntry, signal: AbortSignal): Promise<void> {
      const { slug } = mailbox;
      let row = registry.get(mailbox.id);
      if (row === undefined) {
        await refreshRegistry();
        row = registry.get(mailbox.id);
      }
      const entry = row === undefined ? undefined : configEntryFor(ingest.config, row);
      if (entry === undefined) {
        throw syncError('not_in_config', {
          slug,
          host: row?.imapHost ?? '',
          port: row?.imapPort ?? 0,
          pinned: false,
        });
      }
      const passwordEnv = entry.imap.password_env;
      const ctx: OwnerMessageContext = {
        slug,
        host: entry.imap.host,
        port: entry.imap.port,
        pinned: entry.imap.tls.pin_sha256 !== undefined,
        passwordEnv,
      };
      const password = ingest.env[passwordEnv];
      if (password === undefined || password === '') throw syncError('password_missing', ctx);

      const log = boundLog(slug);
      const locked = await withIngestLock(db, mailbox.id, async (session) => {
        // requireActive rechecks disabled_at inside the lock (D-45).
        const hold = await session.run(
          async (scope) => {
            await recordMailboxSeen(scope, nowDate());
            return readHold(scope);
          },
          { requireActive: true },
        );
        if (hold.state === 'needs_attention' && hold.approved === null) {
          ingest.log.info({ mailbox: slug }, `waiting for sift mailbox resume ${slug}`);
          return;
        }

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
          throw syncError(classifyImapError(error), ctx, error);
        }

        const imapErrors = new WeakSet<object>();
        const lastDiff = lastRemovalDiffAt.get(mailbox.id);
        const removalDiff =
          lastDiff === undefined || nowMs() - lastDiff >= REMOVAL_DIFF_INTERVAL_MS;
        let outcome: IngestOutcome;
        try {
          const cap = entry.ingest.new_mail_cap;
          outcome = await runIngest({
            source: trackedSource(createFolderSource(client), imapErrors),
            store: createDbStore(session),
            folder: entry.imap.folder,
            trustPmHeader: entry.labels.apply_as === 'proton_labels',
            newMailCap: hold.approved === null ? cap : hold.approved + cap,
            initialBackfillDays: entry.ingest.initial_backfill_days,
            // The engine awaits this only after a commit resolved, so it never
            // overlaps a store call on the (non-re-entrant) session.
            onBackfillProgress: (p) => session.run((scope) => recordBackfillProgress(scope, p)),
            removalDiff,
            now: nowDate,
            signal,
            log,
            ...(ingest.sleep === undefined ? {} : { sleep: ingest.sleep }),
            ...(ingest.backfillSliceSize === undefined
              ? {}
              : { backfillSliceSize: ingest.backfillSliceSize }),
          });
        } catch (error) {
          if (typeof error === 'object' && error !== null && imapErrors.has(error)) {
            throw syncError(ingestKind(error, client), ctx, error);
          }
          throw error;
        } finally {
          // Bounded at 5 s and never throws (02-18), so the lock is released
          // even when the server never answers LOGOUT.
          await closeImap(client);
        }

        switch (outcome.kind) {
          case 'synced':
          case 'resynced': {
            // A resync compares every location, so it counts as a removal diff.
            if (removalDiff || outcome.kind === 'resynced') {
              lastRemovalDiffAt.set(mailbox.id, nowMs());
            }
            await session.run((scope) => recordSyncSuccess(scope, nowDate()));
            if (outcome.kind === 'synced') {
              ingest.log.info(
                {
                  mailbox: slug,
                  firstSync: outcome.firstSync,
                  stored: outcome.stored,
                  historical: outcome.historical,
                  vanished: outcome.vanished,
                  backfill: outcome.backfill,
                },
                'mailbox synced',
              );
            } else {
              ingest.log.info({ mailbox: slug, resync: outcome.counts }, 'mailbox synced');
            }
            return;
          }
          case 'needs_attention':
            await session.run((scope) =>
              recordNeedsAttention(scope, outcome.candidateNew, slug, nowDate()),
            );
            ingest.log.warn(
              { mailbox: slug, held: outcome.candidateNew, cap: entry.ingest.new_mail_cap },
              `new mail held by the volume limit; run sift mailbox resume ${slug}`,
            );
            return;
          case 'aborted':
            ingest.log.info(
              { mailbox: slug, stored: outcome.stored },
              'ingest stopped between chunks',
            );
            return;
        }
      });
      if (!locked.acquired) {
        // D-03: a CLI backfill (or another worker) has the mailbox. Not an
        // error: no status write and no backoff; the next poll tries again.
        ingest.log.info({ mailbox: slug }, 'ingest busy (another process holds mailbox)');
      }
    },

    async onBatchError(mailbox: MailboxEntry, error: unknown): Promise<void> {
      if (error instanceof MailboxDisabledError) {
        await withMailbox(db, mailbox.id, recordDisabled);
        return;
      }
      if (error instanceof MailboxSyncError) {
        const connecting =
          (error.kind === 'unreachable' || error.kind === 'timeout') &&
          nowMs() - startedAt < graceMs;
        await withMailbox(db, mailbox.id, (scope) =>
          connecting
            ? recordConnecting(scope, nowDate())
            : recordSyncError(scope, new Error(error.message), secrets, nowDate()),
        );
        return;
      }
      await withMailbox(db, mailbox.id, (scope) =>
        recordSyncError(scope, storedError(error), secrets, nowDate()),
      );
    },

    async onMailboxStopped(mailbox: MailboxEntry): Promise<void> {
      if (mailbox.disabledAt !== null) {
        await withMailbox(db, mailbox.id, recordDisabled);
      }
    },
  };
}
