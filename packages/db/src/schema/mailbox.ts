import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Mailbox registry (D-06). Configuration, not mail-derived data, so it has no
 * RLS; sift_app may only read it. password_env holds a variable NAME, never a
 * secret.
 */
export const mailbox = pgTable(
  'mailbox',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name'),
    imapHost: text('imap_host').notNull(),
    imapPort: integer('imap_port').notNull(),
    imapUsername: text('imap_username').notNull(),
    imapFolder: text('imap_folder').notNull(),
    passwordEnv: text('password_env').notNull(),
    labelsApplyAs: text('labels_apply_as').notNull(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'mailbox_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(${t.slug}) <= 40`,
    ),
    check('mailbox_imap_port_range', sql`${t.imapPort} BETWEEN 1 AND 65535`),
  ],
);
