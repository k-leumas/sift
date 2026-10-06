import { type SiftConfig, validateSlug } from '@sift/core/config';
import pg from 'pg';
import {
  type FieldChange,
  findRenameSuspects,
  type MailboxValues,
  planRegistryChanges,
  type RegistryChange,
  type RegistryRowLike,
  type RenameSuspects,
} from '../registry-plan.ts';

/**
 * Owner-side mailbox registry operations (FND-02, D-32, D-33). Every function
 * opens its own sift_owner connection and closes it. Connection strings are
 * never logged.
 */

/** Transaction-level advisory lock serializing config apply and rename. */
export const CONFIG_APPLY_LOCK_KEY = 815309002;

export type ApplyResult =
  | { status: 'applied'; changes: RegistryChange[] }
  | { status: 'unchanged' }
  | ({ status: 'refused-rename' } & RenameSuspects);

export interface MailboxListing {
  slug: string;
  displayName: string | null;
  disabledAt: Date | null;
  state: 'ok' | 'error' | 'disabled' | null;
  lastSeenAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
}

interface MailboxDbRow {
  id: string;
  slug: string;
  display_name: string | null;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_folder: string;
  password_env: string;
  labels_apply_as: string;
  disabled_at: Date | null;
}

const MAILBOX_SELECT = `select id, slug, display_name, imap_host, imap_port, imap_username,
  imap_folder, password_env, labels_apply_as, disabled_at
  from mailbox order by slug`;

function toRowLike(row: MailboxDbRow): RegistryRowLike {
  return {
    slug: row.slug,
    displayName: row.display_name,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapUsername: row.imap_username,
    imapFolder: row.imap_folder,
    passwordEnv: row.password_env,
    labelsApplyAs: row.labels_apply_as,
    disabledAt: row.disabled_at,
  };
}

async function withOwnerClient<T>(
  ownerUrl: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Run fn in one transaction; any error rolls it back and is rethrown. */
async function inTransaction<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

async function insertMailbox(client: pg.Client, v: MailboxValues): Promise<void> {
  await client.query(
    `insert into mailbox
       (slug, display_name, imap_host, imap_port, imap_username, imap_folder,
        password_env, labels_apply_as)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      v.slug,
      v.displayName,
      v.imapHost,
      v.imapPort,
      v.imapUsername,
      v.imapFolder,
      v.passwordEnv,
      v.labelsApplyAs,
    ],
  );
}

/**
 * Update the changed columns of one mailbox. Column names come from the
 * fixed RegistryField union, values are always parameters.
 */
async function updateMailbox(
  client: pg.Client,
  slug: string,
  changes: readonly FieldChange[],
  enable: boolean,
): Promise<void> {
  const sets = changes.map((change, index) => `${change.field} = $${index + 2}`);
  if (enable) sets.push('disabled_at = null');
  if (sets.length === 0) return;
  await client.query(`update mailbox set ${sets.join(', ')} where slug = $1`, [
    slug,
    ...changes.map((change) => change.to),
  ]);
}

async function executeChange(client: pg.Client, change: RegistryChange): Promise<void> {
  switch (change.kind) {
    case 'add':
      await insertMailbox(client, change.values);
      return;
    case 'update':
      await updateMailbox(client, change.slug, change.changes, false);
      return;
    case 'enable':
      await updateMailbox(client, change.slug, change.changes, true);
      return;
    case 'disable':
      await client.query('update mailbox set disabled_at = now() where slug = $1', [change.slug]);
      return;
  }
}

/**
 * Reconcile the registry with config (D-32) in one transaction under
 * CONFIG_APPLY_LOCK_KEY. A disappearing slug next to a new one is refused
 * without `confirm` (D-33). Refusal and no-op both roll back, so nothing is
 * written. The caller validates config first; a broken config never gets here.
 */
export async function applyConfig(
  ownerUrl: string,
  config: SiftConfig,
  options: { confirm?: boolean } = {},
): Promise<ApplyResult> {
  return withOwnerClient(ownerUrl, async (client): Promise<ApplyResult> => {
    await client.query('begin');
    try {
      await client.query('select pg_advisory_xact_lock($1)', [CONFIG_APPLY_LOCK_KEY]);
      const { rows } = await client.query<MailboxDbRow>(`${MAILBOX_SELECT} for update`);
      const registry = rows.map(toRowLike);
      const changes = planRegistryChanges(config, registry);

      const suspects = findRenameSuspects(changes, registry);
      if (suspects !== null && options.confirm !== true) {
        await client.query('rollback');
        return { status: 'refused-rename', ...suspects };
      }
      if (changes.length === 0) {
        await client.query('rollback');
        return { status: 'unchanged' };
      }
      for (const change of changes) await executeChange(client, change);
      await client.query('commit');
      return { status: 'applied', changes };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    }
  });
}

const UNIQUE_VIOLATION = '23505';

/**
 * Rename a mailbox slug (D-32, D-63). Only the slug changes: the id, and so
 * every scoped row, stays attached. Runs under CONFIG_APPLY_LOCK_KEY so it
 * cannot interleave with a config apply. Errors carry a message for the owner
 * and change nothing.
 */
export async function renameMailbox(
  ownerUrl: string,
  oldSlug: string,
  newSlug: string,
): Promise<void> {
  const invalid = validateSlug(newSlug);
  if (invalid !== null) throw new Error(invalid);
  if (oldSlug === newSlug) throw new Error(`mailbox "${oldSlug}" already has that slug`);

  await withOwnerClient(ownerUrl, (client) =>
    inTransaction(client, async () => {
      await client.query('select pg_advisory_xact_lock($1)', [CONFIG_APPLY_LOCK_KEY]);
      let rowCount: number | null;
      try {
        ({ rowCount } = await client.query('update mailbox set slug = $2 where slug = $1', [
          oldSlug,
          newSlug,
        ]));
      } catch (error) {
        if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) {
          throw new Error(`a mailbox with slug "${newSlug}" already exists`);
        }
        throw error;
      }
      if (rowCount === 0) throw new Error(`no mailbox with slug "${oldSlug}"`);
    }),
  );
}

export type ResumeResult =
  | { resumed: true; held: number }
  | { resumed: false; state: string | null };

/**
 * Release a volume hold (D-26): when the mailbox is in needs_attention, set
 * approved_new_count to the held count, so the worker's next check processes
 * up to that many held messages. Any other state changes nothing and reports
 * the state (null when the mailbox has never run). Throws for an unknown slug.
 */
export async function resumeMailbox(ownerUrl: string, slug: string): Promise<ResumeResult> {
  return withOwnerClient(ownerUrl, (client) =>
    inTransaction(client, async (): Promise<ResumeResult> => {
      const { rows } = await client.query<{ id: string }>(
        'select id from mailbox where slug = $1',
        [slug],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error(`no mailbox with slug "${slug}"`);
      // mailbox_status is under FORCE RLS and the owner is subject to it (D-41).
      await client.query("select set_config('app.mailbox_id', $1, true)", [id]);
      const status = await client.query<{ state: string | null; held_new_count: number | null }>(
        `select state, held_new_count from mailbox_status where mailbox_id = $1 for update`,
        [id],
      );
      const row = status.rows[0];
      if (row?.state !== 'needs_attention' || row.held_new_count === null) {
        return { resumed: false, state: row?.state ?? null };
      }
      await client.query(
        'update mailbox_status set approved_new_count = held_new_count where mailbox_id = $1',
        [id],
      );
      return { resumed: true, held: row.held_new_count };
    }),
  );
}

interface StatusDbRow {
  state: 'ok' | 'error' | 'disabled';
  last_error: string | null;
  last_sync_at: Date | null;
  last_seen_at: Date | null;
}

/**
 * Every mailbox with its status, disabled ones included, ordered by slug.
 * mailbox_status is under forced RLS and the owner is subject to it (D-41),
 * so each status read runs with app.mailbox_id set to that mailbox.
 */
export async function listMailboxes(ownerUrl: string): Promise<MailboxListing[]> {
  return withOwnerClient(ownerUrl, (client) =>
    inTransaction(client, async () => {
      await client.query('set transaction read only');
      const { rows } = await client.query<MailboxDbRow>(MAILBOX_SELECT);
      const listings: MailboxListing[] = [];
      for (const row of rows) {
        await client.query("select set_config('app.mailbox_id', $1, true)", [row.id]);
        const status = await client.query<StatusDbRow>(
          `select state, last_error, last_sync_at, last_seen_at
             from mailbox_status where mailbox_id = $1`,
          [row.id],
        );
        const s = status.rows[0];
        listings.push({
          slug: row.slug,
          displayName: row.display_name,
          disabledAt: row.disabled_at,
          state: s?.state ?? null,
          lastSeenAt: s?.last_seen_at ?? null,
          lastSyncAt: s?.last_sync_at ?? null,
          lastError: s?.last_error ?? null,
        });
      }
      return listings;
    }),
  );
}
