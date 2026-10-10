import { randomBytes } from 'node:crypto';
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

/**
 * The smallest complete trace for an exact-rule decision (the 03-05 span
 * layout): one exact-rules match, the classifier span skipped, a pending
 * label action. Test rows use it so decision_spans_check and later trace
 * readers see a realistic value.
 */
export const SEED_SPANS: readonly unknown[] = [
  {
    kind: 'exact_rules',
    rules_checked: 1,
    matches: [{ index: 0, name: 'rules[0]', label: 'Seed' }],
    winner: { index: 0, name: 'rules[0]', label: 'Seed' },
    nearest_miss: null,
  },
  { kind: 'classifier', status: 'skipped', reason: 'not trained' },
  { kind: 'action', status: 'pending', intent: { type: 'label', label: 'Seed' } },
];

/** SEED_SPANS as a JSON text parameter (`$n::jsonb`); pg would send a JS array as a Postgres array. */
export const SEED_SPANS_JSON = JSON.stringify(SEED_SPANS);

/** A rule-set snapshot object accepted by rule_set_snapshot_check. */
export const SEED_SNAPSHOT_JSON = '{"version":1,"categories":[],"judgment":[],"rules":[]}';

/**
 * SQL for a random 64-char lowercase hex hash, so every inserted rule_set row
 * has its own (mailbox_id, hash).
 */
export const RANDOM_HASH_SQL = "encode(sha256(gen_random_uuid()::text::bytea), 'hex')";

/**
 * Versions for rule_set rows written through the scoped API. They start far
 * above what seedScopedRows hands out (max + 1 per mailbox), so the two never
 * meet on rule_set_mailbox_id_version_key.
 */
let nextRuleSetVersion = 1_000_000;

/** A complete rule_set row for `s.ruleSet.insert`, with its own version and hash. */
export function newRuleSetRow(): {
  version: number;
  hash: string;
  formatVersion: number;
  snapshot: Record<string, unknown>;
} {
  nextRuleSetVersion += 1;
  return {
    version: nextRuleSetVersion,
    hash: randomBytes(32).toString('hex'),
    formatVersion: 1,
    snapshot: JSON.parse(SEED_SNAPSHOT_JSON) as Record<string, unknown>,
  };
}

/**
 * A complete exact-rule labelled decision for `s.decision.insert`. decidedBy
 * defaults to 'rerun', which decision_one_worker_per_message never limits.
 */
export function newDecisionRow(
  messageId: string,
  ruleSetId: string,
  decidedBy: 'worker' | 'rerun' = 'rerun',
): {
  messageId: string;
  outcome: string;
  category: string;
  tier: string;
  ruleSetId: string;
  decidedBy: string;
  traceFormatVersion: number;
  spans: readonly unknown[];
} {
  return {
    messageId,
    outcome: 'labelled',
    category: 'Seed',
    tier: 'exact_rules',
    ruleSetId,
    decidedBy,
    traceFormatVersion: 1,
    spans: SEED_SPANS,
  };
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
    // rule_set first: the decision references the snapshot it was made against.
    // version is the next one for this mailbox, so repeated calls stay unique.
    const ruleSetId = await insertId(
      `insert into rule_set (mailbox_id, version, hash, format_version, snapshot)
       select $1::uuid, coalesce(max(version), 0) + 1, ${RANDOM_HASH_SQL}, 1, $2::jsonb
         from rule_set where mailbox_id = $1::uuid
       returning id`,
      [mailboxId, SEED_SNAPSHOT_JSON],
    );
    // A complete automatic exact-rule decision for the fresh message.
    const decisionId = await insertId(
      `insert into decision
         (mailbox_id, message_id, outcome, category, tier, rule_set_id, decided_by,
          trace_format_version, spans)
       values ($1, $2, 'labelled', 'Seed', 'exact_rules', $3, 'worker', 1, $4::jsonb)
       returning id`,
      [mailboxId, messageId, ruleSetId, SEED_SPANS_JSON],
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
