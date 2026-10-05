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

/**
 * Insert one mailbox row with the given IMAP identity as sift_owner and
 * return its id. The row matches a config entry with the same host, username
 * and folder (imapIdentityKey), labels_apply_as proton_labels.
 */
export async function seedImapMailbox(
  ownerUrl: string,
  m: {
    slug: string;
    host: string;
    port: number;
    username: string;
    passwordEnv: string;
    folder?: string;
  },
): Promise<string> {
  const owner = await connect(ownerUrl);
  try {
    const { rows } = await owner.query<{ id: string }>(
      `insert into mailbox
         (slug, imap_host, imap_port, imap_username, imap_folder, password_env, labels_apply_as)
       values ($1, $2, $3, $4, $5, $6, 'proton_labels')
       returning id`,
      [m.slug, m.host, m.port, m.username, m.folder ?? 'INBOX', m.passwordEnv],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`seedImapMailbox: no id returned for "${m.slug}"`);
    return id;
  } finally {
    await owner.end();
  }
}

export interface ScopedRowIds {
  messageId: string;
  messageLocationId: string;
  messageBodyId: string;
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

    // identity_key and folder are unique per mailbox, so every call gets
    // fresh values and repeated calls for one mailbox still succeed.
    const messageId = await insertId(
      `insert into message (mailbox_id, identity_key, internal_date, eligible_for_classification)
       values ($1, 'mid:seed-' || gen_random_uuid() || '@seed.test', now(), true)
       returning id`,
      [mailboxId],
    );
    const messageLocationId = await insertId(
      `insert into message_location (mailbox_id, message_id, folder, uidvalidity, uid, generation)
       select $1::uuid, $2::uuid, 'INBOX', 1, coalesce(max(uid), 0) + 1, 1
         from message_location where mailbox_id = $1::uuid
       returning id`,
      [mailboxId, messageId],
    );
    const messageBodyId = await insertId(
      `insert into message_body (mailbox_id, message_id, body_text, source, truncated)
       values ($1, $2, 'seed body', 'text_plain', false)
       returning id`,
      [mailboxId, messageId],
    );
    const labelId = await insertId(
      'insert into label (mailbox_id, message_id) values ($1, $2) returning id',
      [mailboxId, messageId],
    );
    const decisionId = await insertId(
      'insert into decision (mailbox_id, message_id) values ($1, $2) returning id',
      [mailboxId, messageId],
    );
    const folderSyncId = await insertId(
      `insert into folder_sync (mailbox_id, folder, uidvalidity, last_uid, internal_date_watermark)
       values ($1, 'seed-' || gen_random_uuid(), 1, 0, now())
       returning id`,
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
    return {
      messageId,
      messageLocationId,
      messageBodyId,
      labelId,
      decisionId,
      folderSyncId,
      labelEventId,
      ruleSetId,
    };
  } catch (error) {
    await owner.query('rollback').catch(() => {});
    throw error;
  } finally {
    await owner.end();
  }
}
