import type { MailboxConfig, SiftConfig } from '@sift/core/config';
import { imapIdentityKey } from '@sift/core/config';
import {
  type AppDb,
  MailboxDisabledError,
  type RegistryRow,
  readHold,
  readRegistry,
  recordBackfillProgress,
  recordDisabled,
  recordMailboxSeen,
  recordNeedsAttention,
  recordSyncError,
  recordSyncSuccess,
  withIngestLock,
  withMailbox,
} from '@sift/db';
import { closeImap, type ImapErrorClass, openImap } from '../imap/connect.ts';
import { createFolderSource } from '../imap/folder-source.ts';
import { createDbStore } from '../ingest/db-store.ts';
import { REMOVAL_DIFF_INTERVAL_MS, runIngest } from '../ingest/run.ts';
import type { IngestLog, IngestOutcome } from '../ingest/types.ts';
import type { MailboxEntry, SupervisorDeps, SupervisorLog } from './supervisor.ts';

export type MailboxCallbacks = Pick<
  SupervisorDeps,
  'readRegistry' | 'runBatch' | 'onBatchError' | 'onMailboxStopped'
>;

/** Why a mailbox run failed, as the owner sees it in mailbox_status (D-33, D-34, D-73). */
export type MailboxSyncErrorKind = ImapErrorClass | 'password_missing' | 'not_in_config';

/**
 * A classified mailbox failure. The message is owner-facing and secret-free;
 * the original error, when there is one, is the `cause` (logged by the
 * supervisor through its redaction).
 */
export class MailboxSyncError extends Error {
  readonly kind: MailboxSyncErrorKind;

  constructor(kind: MailboxSyncErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MailboxSyncError';
    this.kind = kind;
  }
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
  startupGraceMs?: number;
  openImap?: typeof openImap;
  /** The engine's throttle pause; tests inject a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** Tests only; defaults to the engine's BACKFILL_SLICE_SIZE. */
  backfillSliceSize?: number;
}

/** The config entry for a registry row: same IMAP identity (D-64). */
function configEntryFor(config: SiftConfig, row: RegistryRow): MailboxConfig | undefined {
  const key = imapIdentityKey(row.imapHost, row.imapUsername, row.imapFolder);
  return config.mailboxes.find(
    (m) => imapIdentityKey(m.imap.host, m.imap.username, m.imap.folder) === key,
  );
}

/**
 * The supervisor's per-mailbox callbacks (D-49). A run takes the mailbox's
 * ingest lock (D-03), checks the mailbox is active and not held (D-45, D-26),
 * connects with its configured TLS mode and pin (D-40, D-73), runs the sync
 * engine against the database store with its ingest settings (D-74, D-75)
 * and records the outcome. Every write goes through the scoped @sift/db API
 * (ISO-04).
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
        throw new MailboxSyncError(
          'not_in_config',
          `mailbox ${slug} is not in the config this worker loaded; recreate the worker: docker compose up -d --force-recreate worker`,
        );
      }
      const passwordEnv = entry.imap.password_env;
      const password = ingest.env[passwordEnv];
      if (password === undefined || password === '') {
        throw new MailboxSyncError(
          'password_missing',
          `Missing env var: ${passwordEnv} (password_env of mailbox ${slug}); add it to .env.mailboxes and recreate the worker`,
        );
      }

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

        const client = await open({
          host: entry.imap.host,
          port: entry.imap.port,
          user: entry.imap.username,
          pass: password,
          tls: { mode: entry.imap.tls.mode, pinSha256: entry.imap.tls.pin_sha256 },
        });
        let outcome: IngestOutcome;
        const lastDiff = lastRemovalDiffAt.get(mailbox.id);
        const removalDiff =
          lastDiff === undefined || nowMs() - lastDiff >= REMOVAL_DIFF_INTERVAL_MS;
        try {
          const cap = entry.ingest.new_mail_cap;
          outcome = await runIngest({
            source: createFolderSource(client),
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
      await withMailbox(db, mailbox.id, (scope) => recordSyncError(scope, error, secrets));
    },

    async onMailboxStopped(mailbox: MailboxEntry): Promise<void> {
      if (mailbox.disabledAt !== null) {
        await withMailbox(db, mailbox.id, recordDisabled);
      }
    },
  };
}
