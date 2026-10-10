import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { mailboxIsolation } from '../rls.ts';
import { mailbox } from './mailbox.ts';
import { promptVersion } from './prompt-version.ts';

/**
 * Mailbox-scoped tables (ISO-01). Each one has a NOT NULL mailbox_id that
 * references mailbox ON DELETE RESTRICT (D-05) and carries the single
 * mailbox_isolation policy (D-41). FORCE RLS, grants and the updated_at
 * trigger live in the custom migrations next to the generated ones.
 */

const mailboxId = () =>
  uuid('mailbox_id')
    .notNull()
    .references(() => mailbox.id, { onDelete: 'restrict' });

const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One attachment's metadata as stored on message (D-08). Never its content. */
export interface MessageAttachment {
  name: string | null;
  mimeType: string;
  sizeBytes: number | null;
}

/** Counts from the last UIDVALIDITY resync of a folder (D-25). */
export interface ResyncSummary {
  matched: number;
  new: number;
  gone: number;
  older: number;
}

/**
 * One stored email per mailbox, keyed by identity_key (D-12): `pm:<id>` from
 * Bridge's X-Pm-Internal-Id, else `mid:<id>` from Message-ID, else a
 * versioned header hash `hdr:v<n>:<64 hex>` (D-82: an unversioned `hdr:` key
 * cannot be stored). UNIQUE (mailbox_id, identity_key) is the dedup guarantee
 * and the refetch handle.
 *
 * Metadata only (D-08). There is no body column here: body text lives only in
 * the short-lived message_body cache (D-06). Where the message sits on the
 * server is message_location (D-15).
 */
export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    identityKey: text('identity_key').notNull(),
    messageIdHeader: text('message_id_header'),
    internalDate: timestamp('internal_date', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    fromAddress: text('from_address'),
    fromDomain: text('from_domain'),
    subject: text('subject'),
    headers: jsonb('headers').$type<Record<string, string[]>>().notNull().default({}),
    attachments: jsonb('attachments').$type<MessageAttachment[]>().notNull().default([]),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    eligibleForClassification: boolean('eligible_for_classification').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('message_mailbox_id_id_key').on(t.mailboxId, t.id),
    unique('message_mailbox_id_identity_key_key').on(t.mailboxId, t.identityKey),
    check(
      'message_identity_key_check',
      sql`${t.identityKey} ~ '^(pm:.+|mid:.+|hdr:v[0-9]+:[0-9a-f]{64})$'`,
    ),
    // The classification pending scan: eligible mail, newest first.
    index('message_pending_idx')
      .on(t.mailboxId, t.internalDate.desc(), t.id.desc())
      .where(sql`eligible_for_classification`),
    mailboxIsolation(),
  ],
);

/**
 * Worker runtime state, one row per mailbox (D-07). state is text + check,
 * not a Postgres enum type, because enum changes fight the single-transaction
 * migrator.
 *
 * 'connecting' covers the startup grace window (D-34). 'needs_attention' means
 * new mail above the per-run cap is held for the owner (D-26) and always
 * carries held_new_count. backfill_done / backfill_total show the first
 * backfill's progress to the owner (D-75) and are set together.
 */
export const mailboxStatus = pgTable(
  'mailbox_status',
  {
    mailboxId: mailboxId().primaryKey(),
    state: text('state').notNull().default('ok'),
    lastError: text('last_error'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    heldNewCount: integer('held_new_count'),
    approvedNewCount: integer('approved_new_count'),
    backfillDone: integer('backfill_done'),
    backfillTotal: integer('backfill_total'),
    ...timestamps(),
  },
  (t) => [
    check(
      'mailbox_status_state_check',
      sql`${t.state} in ('ok', 'error', 'disabled', 'connecting', 'needs_attention')`,
    ),
    check(
      'mailbox_status_held_check',
      sql`${t.state} <> 'needs_attention' or ${t.heldNewCount} is not null`,
    ),
    check(
      'mailbox_status_backfill_check',
      sql`(${t.backfillDone} is null) = (${t.backfillTotal} is null)`,
    ),
    mailboxIsolation(),
  ],
);

/**
 * Where a message sits on the server (D-15): one row per (folder,
 * UIDVALIDITY, UID), so the same message can be seen in several folders and
 * across a UIDVALIDITY change. UID and UIDVALIDITY are unsigned 32-bit, so
 * they are bigint (SPK-04).
 *
 * A location is live while removed_at is null. It is never deleted: it is
 * marked 'vanished' when the UID disappears from the folder (D-17) or
 * 'superseded' when a resync moves the folder to a new generation (D-23).
 */
export const messageLocation = pgTable(
  'message_location',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    messageId: uuid('message_id').notNull(),
    folder: text('folder').notNull(),
    uidvalidity: bigint('uidvalidity', { mode: 'number' }).notNull(),
    uid: bigint('uid', { mode: 'number' }).notNull(),
    generation: integer('generation').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedReason: text('removed_reason'),
    ...timestamps(),
  },
  (t) => [
    unique('message_location_mailbox_id_id_key').on(t.mailboxId, t.id),
    unique('message_location_mailbox_id_folder_uidvalidity_uid_key').on(
      t.mailboxId,
      t.folder,
      t.uidvalidity,
      t.uid,
    ),
    foreignKey({
      name: 'message_location_message_fk',
      columns: [t.mailboxId, t.messageId],
      foreignColumns: [message.mailboxId, message.id],
    }).onDelete('restrict'),
    index('message_location_message_idx').on(t.mailboxId, t.messageId),
    // The live set: the removal diff and liveLocations read only these rows.
    index('message_location_live_idx').on(t.mailboxId, t.folder).where(sql`removed_at is null`),
    check(
      'message_location_removed_check',
      // removed_reason is not null is needed: `null in (...)` is NULL, and a
      // check constraint accepts NULL, so removed_at alone would pass.
      sql`(${t.removedAt} is null and ${t.removedReason} is null) or (${t.removedAt} is not null and ${t.removedReason} is not null and ${t.removedReason} in ('vanished', 'superseded'))`,
    ),
    mailboxIsolation(),
  ],
);

/**
 * Short-lived body cache (D-06, D-07): the only place body text is stored,
 * one row per message, dropped after expires_at.
 *
 * An eligible message has exactly one body row. A message with no text part
 * stores source 'none' with an empty body_text (''), never a missing row.
 */
export const messageBody = pgTable(
  'message_body',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    messageId: uuid('message_id').notNull(),
    bodyText: text('body_text').notNull(),
    source: text('source').notNull(),
    truncated: boolean('truncated').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique('message_body_mailbox_id_id_key').on(t.mailboxId, t.id),
    unique('message_body_mailbox_id_message_id_key').on(t.mailboxId, t.messageId),
    foreignKey({
      name: 'message_body_message_fk',
      columns: [t.mailboxId, t.messageId],
      foreignColumns: [message.mailboxId, message.id],
    }).onDelete('restrict'),
    check('message_body_source_check', sql`${t.source} in ('text_plain', 'text_html', 'none')`),
    index('message_body_expires_at_idx').on(t.expiresAt),
    mailboxIsolation(),
  ],
);

/** Labels reference their message through the composite key (D-04). */
export const label = pgTable(
  'label',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    messageId: uuid('message_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('label_mailbox_id_id_key').on(t.mailboxId, t.id),
    foreignKey({
      name: 'label_message_fk',
      columns: [t.mailboxId, t.messageId],
      foreignColumns: [message.mailboxId, message.id],
    }).onDelete('restrict'),
    mailboxIsolation(),
  ],
);

/** The rule-set snapshot stored on rule_set: the parsed rules.yaml content (D-03). */
export type RuleSetSnapshot = Record<string, unknown>;

/**
 * Append-only rule-set snapshots (D-03, TRC-04). A row is written whenever a
 * mailbox's rules.yaml content changes, and every decision references the
 * snapshot it was made against, so it can be replayed exactly. sift_app may
 * only read and insert rows (0010).
 *
 * version counts up from 1 per mailbox. hash is the 64-char lowercase hex
 * SHA-256 of the normalised snapshot, unique per mailbox so identical content
 * is stored once. format_version is the snapshot layout version, and snapshot
 * is the normalised rules document as a JSON object.
 */
export const ruleSet = pgTable(
  'rule_set',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    version: integer('version').notNull(),
    hash: text('hash').notNull(),
    formatVersion: integer('format_version').notNull(),
    snapshot: jsonb('snapshot').$type<RuleSetSnapshot>().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('rule_set_mailbox_id_id_key').on(t.mailboxId, t.id),
    unique('rule_set_mailbox_id_hash_key').on(t.mailboxId, t.hash),
    unique('rule_set_mailbox_id_version_key').on(t.mailboxId, t.version),
    check('rule_set_version_check', sql`${t.version} >= 1 and ${t.formatVersion} >= 1`),
    check('rule_set_hash_check', sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check('rule_set_snapshot_check', sql`jsonb_typeof(${t.snapshot}) = 'object'`),
    mailboxIsolation(),
  ],
);

/**
 * Append-only decision traces (D-40, D-27, TRC-01), keyed to a message like
 * label. One row records one classification of one message:
 *
 * - outcome: 'labelled' (category holds the label) or 'review' (held for the
 *   owner; review_reason says why, D-31: low_confidence, invalid_output,
 *   out_of_category or input_too_long).
 * - tier: which tier decided, 'exact_rules' or 'llm'. An exact-rule decision
 *   is always labelled and carries no confidence, prompt version or model
 *   (D-13). An LLM decision always names its prompt_version and model.
 * - confidence: the LLM's confidence, 0..1 in double precision. Present
 *   exactly when the LLM gave a usable answer: a labelled LLM decision or a
 *   low_confidence review.
 * - rule_set_id: the rule-set snapshot the decision was made against.
 * - decided_by: 'worker' for the automatic decision (at most one per message,
 *   D-15) or 'rerun' for an owner-requested re-classification, which appends
 *   next to it and never replaces it (D-17).
 * - trace_format_version and spans: the trace itself, a JSON array of span
 *   objects whose shape is validated in code.
 *
 * Every check names its nullable columns explicitly, because a check
 * constraint accepts a NULL result.
 */
export const decision = pgTable(
  'decision',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    messageId: uuid('message_id').notNull(),
    outcome: text('outcome').notNull(),
    category: text('category'),
    confidence: doublePrecision('confidence'),
    tier: text('tier').notNull(),
    reviewReason: text('review_reason'),
    ruleSetId: uuid('rule_set_id').notNull(),
    promptVersionId: uuid('prompt_version_id'),
    model: text('model'),
    decidedBy: text('decided_by').notNull(),
    traceFormatVersion: integer('trace_format_version').notNull(),
    spans: jsonb('spans').$type<readonly unknown[]>().notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('decision_mailbox_id_id_key').on(t.mailboxId, t.id),
    foreignKey({
      name: 'decision_message_fk',
      columns: [t.mailboxId, t.messageId],
      foreignColumns: [message.mailboxId, message.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'decision_rule_set_fk',
      columns: [t.mailboxId, t.ruleSetId],
      foreignColumns: [ruleSet.mailboxId, ruleSet.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'decision_prompt_version_fk',
      columns: [t.promptVersionId],
      foreignColumns: [promptVersion.id],
    }).onDelete('restrict'),
    index('decision_message_idx').on(t.mailboxId, t.messageId),
    // At most one automatic decision per message; reruns append freely.
    uniqueIndex('decision_one_worker_per_message')
      .on(t.mailboxId, t.messageId)
      .where(sql`decided_by = 'worker'`),
    check('decision_outcome_check', sql`${t.outcome} in ('labelled', 'review')`),
    check(
      'decision_category_check',
      sql`(${t.outcome} = 'labelled') = (${t.category} is not null)`,
    ),
    check('decision_tier_check', sql`${t.tier} in ('exact_rules', 'llm')`),
    check(
      'decision_review_reason_check',
      sql`((${t.outcome} = 'review') = (${t.reviewReason} is not null)) and (${t.reviewReason} is null or ${t.reviewReason} in ('low_confidence', 'invalid_output', 'out_of_category', 'input_too_long'))`,
    ),
    check(
      'decision_exact_rules_check',
      sql`${t.tier} <> 'exact_rules' or (${t.outcome} = 'labelled' and ${t.confidence} is null and ${t.promptVersionId} is null and ${t.model} is null)`,
    ),
    check(
      'decision_llm_check',
      sql`${t.tier} <> 'llm' or (${t.promptVersionId} is not null and ${t.model} is not null)`,
    ),
    check(
      'decision_confidence_check',
      sql`(${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 1)) and ((${t.tier} = 'llm' and (${t.outcome} = 'labelled' or ${t.reviewReason} is not distinct from 'low_confidence')) = (${t.confidence} is not null))`,
    ),
    check('decision_decided_by_check', sql`${t.decidedBy} in ('worker', 'rerun')`),
    check('decision_trace_format_check', sql`${t.traceFormatVersion} >= 1`),
    check('decision_spans_check', sql`jsonb_typeof(${t.spans}) = 'array'`),
    mailboxIsolation(),
  ],
);

/**
 * Sync state per watched folder (D-18): the UIDVALIDITY seen, the highest UID
 * ingested and the INTERNALDATE watermark, plus the location generation that
 * is current (D-23).
 *
 * state is 'resyncing' exactly while a UIDVALIDITY change is being applied,
 * and then pending_uidvalidity / pending_generation hold the target (D-24).
 * While resyncing, two generations of locations can be live at once, so
 * readers that act on the mailbox (Phase 4) must treat the folder as "do not
 * act". last_resync_at / last_resync_summary record the last resync (D-25).
 *
 * The backfill_* columns are the first-backfill cursor (D-75): all set while
 * one is pending, all null otherwise.
 */
export const folderSync = pgTable(
  'folder_sync',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    folder: text('folder').notNull(),
    uidvalidity: bigint('uidvalidity', { mode: 'number' }).notNull(),
    lastUid: bigint('last_uid', { mode: 'number' }).notNull(),
    internalDateWatermark: timestamp('internal_date_watermark', { withTimezone: true }).notNull(),
    generation: integer('generation').notNull().default(1),
    state: text('state').notNull().default('ok'),
    pendingUidvalidity: bigint('pending_uidvalidity', { mode: 'number' }),
    pendingGeneration: integer('pending_generation'),
    lastResyncAt: timestamp('last_resync_at', { withTimezone: true }),
    lastResyncSummary: jsonb('last_resync_summary').$type<ResyncSummary>(),
    backfillSince: timestamp('backfill_since', { withTimezone: true }),
    backfillCursorUid: bigint('backfill_cursor_uid', { mode: 'number' }),
    backfillUntilUid: bigint('backfill_until_uid', { mode: 'number' }),
    backfillTotal: integer('backfill_total'),
    ...timestamps(),
  },
  (t) => [
    unique('folder_sync_mailbox_id_id_key').on(t.mailboxId, t.id),
    unique('folder_sync_mailbox_id_folder_key').on(t.mailboxId, t.folder),
    check('folder_sync_state_check', sql`${t.state} in ('ok', 'resyncing')`),
    check(
      'folder_sync_pending_check',
      sql`(${t.state} = 'resyncing') = (${t.pendingUidvalidity} is not null and ${t.pendingGeneration} is not null)`,
    ),
    check(
      'folder_sync_backfill_check',
      sql`num_nonnulls(${t.backfillSince}, ${t.backfillCursorUid}, ${t.backfillUntilUid}, ${t.backfillTotal}) in (0, 4)`,
    ),
    mailboxIsolation(),
  ],
);

/** Append-only (D-40). */
export const labelEvent = pgTable(
  'label_event',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    ...timestamps(),
  },
  (t) => [unique('label_event_mailbox_id_id_key').on(t.mailboxId, t.id), mailboxIsolation()],
);
