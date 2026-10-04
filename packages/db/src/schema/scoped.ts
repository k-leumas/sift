import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { mailboxIsolation } from '../rls.ts';
import { mailbox } from './mailbox.ts';

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

/** Keys and timestamps only until the Bridge spike settles identity (D-02). */
export const message = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    ...timestamps(),
  },
  (t) => [unique('message_mailbox_id_id_key').on(t.mailboxId, t.id), mailboxIsolation()],
);

/**
 * Worker runtime state, one row per mailbox (D-07). state is text + check,
 * not a Postgres enum type, because enum changes fight the single-transaction
 * migrator.
 */
export const mailboxStatus = pgTable(
  'mailbox_status',
  {
    mailboxId: mailboxId().primaryKey(),
    state: text('state').notNull().default('ok'),
    lastError: text('last_error'),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    check('mailbox_status_state_check', sql`${t.state} in ('ok', 'error', 'disabled')`),
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

/** Append-only decision trace rows (D-40), keyed to a message like label. */
export const decision = pgTable(
  'decision',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    messageId: uuid('message_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('decision_mailbox_id_id_key').on(t.mailboxId, t.id),
    foreignKey({
      name: 'decision_message_fk',
      columns: [t.mailboxId, t.messageId],
      foreignColumns: [message.mailboxId, message.id],
    }).onDelete('restrict'),
    mailboxIsolation(),
  ],
);

export const folderSync = pgTable(
  'folder_sync',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    ...timestamps(),
  },
  (t) => [unique('folder_sync_mailbox_id_id_key').on(t.mailboxId, t.id), mailboxIsolation()],
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

export const ruleSet = pgTable(
  'rule_set',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    ...timestamps(),
  },
  (t) => [unique('rule_set_mailbox_id_id_key').on(t.mailboxId, t.id), mailboxIsolation()],
);
