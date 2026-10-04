import { sql } from 'drizzle-orm';
import { pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
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
