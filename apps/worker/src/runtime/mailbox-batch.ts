import {
  type AppDb,
  MailboxDisabledError,
  readRegistry,
  recordDisabled,
  recordMailboxSeen,
  recordSyncError,
  recordSyncSuccess,
  withMailbox,
} from '@sift/db';
import type { MailboxEntry, SupervisorDeps } from './supervisor.ts';

export type MailboxCallbacks = Pick<
  SupervisorDeps,
  'readRegistry' | 'runBatch' | 'onBatchError' | 'onMailboxStopped'
>;

/**
 * The supervisor's per-mailbox callbacks over the scoped API (D-49). Every
 * write goes through withMailbox, so it is scoped to one mailbox by RLS.
 *
 * `secrets` are the mailbox password values; recordSyncError masks them in
 * last_error (D-51, T-01-40).
 */
export function createMailboxCallbacks(db: AppDb, secrets: readonly string[]): MailboxCallbacks {
  return {
    async readRegistry(): Promise<MailboxEntry[]> {
      const rows = await readRegistry(db);
      return rows.map((row) => ({ id: row.id, slug: row.slug, disabledAt: row.disabledAt }));
    },

    // Phase 1 no-op batch. Phase 2 puts ingest between the two status writes.
    // requireActive rechecks disabled_at inside the batch transaction (D-45).
    async runBatch(mailbox: MailboxEntry): Promise<void> {
      await withMailbox(
        db,
        mailbox.id,
        async (scope) => {
          await recordMailboxSeen(scope);
          await recordSyncSuccess(scope);
        },
        { requireActive: true },
      );
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
