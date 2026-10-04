import { connect } from './db.ts';

/**
 * Insert one mailbox row per slug as sift_owner and return slug -> id.
 * mailbox has no RLS, so no app.mailbox_id is needed.
 */
export async function seedMailboxes(
  ownerUrl: string,
  slugs: readonly string[],
): Promise<Record<string, string>> {
  const owner = await connect(ownerUrl);
  try {
    const ids: Record<string, string> = {};
    for (const slug of slugs) {
      const { rows } = await owner.query<{ id: string }>(
        `insert into mailbox
           (slug, imap_host, imap_port, imap_username, imap_folder, password_env, labels_apply_as)
         values ($1, 'bridge.test', 1143, $2, 'INBOX', 'SIFT_TEST_IMAP_PASSWORD', 'proton_labels')
         returning id`,
        [slug, `${slug}@example.test`],
      );
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new Error(`seedMailboxes: no id returned for "${slug}"`);
      }
      ids[slug] = id;
    }
    return ids;
  } finally {
    await owner.end();
  }
}

export interface ScopedRowIds {
  messageId: string;
  labelId: string;
  decisionId: string;
  folderSyncId: string;
  labelEventId: string;
  ruleSetId: string;
}

/**
 * Insert one row into every scoped table for `mailboxId`, as sift_owner in
 * one transaction under app.mailbox_id (the owner is subject to FORCE RLS,
 * D-41). Safe to call repeatedly for the same mailbox.
 */
export async function seedScopedRows(ownerUrl: string, mailboxId: string): Promise<ScopedRowIds> {
  const owner = await connect(ownerUrl);
  try {
    await owner.query('begin');
    await owner.query("select set_config('app.mailbox_id', $1, true)", [mailboxId]);

    const insertId = async (sql: string, params: unknown[]): Promise<string> => {
      const { rows } = await owner.query<{ id: string }>(sql, params);
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new Error(`seedScopedRows: no id returned by: ${sql}`);
      }
      return id;
    };

    const messageId = await insertId('insert into message (mailbox_id) values ($1) returning id', [
      mailboxId,
    ]);
    const labelId = await insertId(
      'insert into label (mailbox_id, message_id) values ($1, $2) returning id',
      [mailboxId, messageId],
    );
    const decisionId = await insertId(
      'insert into decision (mailbox_id, message_id) values ($1, $2) returning id',
      [mailboxId, messageId],
    );
    const folderSyncId = await insertId(
      'insert into folder_sync (mailbox_id) values ($1) returning id',
      [mailboxId],
    );
    const labelEventId = await insertId(
      'insert into label_event (mailbox_id) values ($1) returning id',
      [mailboxId],
    );
    const ruleSetId = await insertId('insert into rule_set (mailbox_id) values ($1) returning id', [
      mailboxId,
    ]);
    await owner.query(
      `insert into mailbox_status (mailbox_id, last_error) values ($1, null)
       on conflict (mailbox_id) do nothing`,
      [mailboxId],
    );

    await owner.query('commit');
    return { messageId, labelId, decisionId, folderSyncId, labelEventId, ruleSetId };
  } catch (error) {
    await owner.query('rollback').catch(() => {});
    throw error;
  } finally {
    await owner.end();
  }
}
