import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Versioned LLM prompt templates (D-29). A decision made by the LLM tier
 * references the row its prompt was rendered from, so the exact template and
 * output schema can be replayed later (TRC-04).
 *
 * Prompt templates are code-derived, not mail-derived: a row holds only the
 * template text with its placeholders and the output schema shape, never a
 * rendered prompt or any mail content. So this table has no mailbox_id and no
 * RLS, and it is allowlisted in the catalog check with that reason. sift_app
 * may only read and insert rows (0010); a version is never edited in place.
 *
 * version counts up from 1; hash is the 64-char lowercase hex SHA-256 of the
 * template material, unique so the same template is stored once.
 */
export const promptVersion = pgTable(
  'prompt_version',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    version: integer('version').notNull().unique(),
    hash: text('hash').notNull().unique(),
    template: text('template').notNull(),
    schemaShape: jsonb('schema_shape').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('prompt_version_version_check', sql`${t.version} >= 1`),
    check('prompt_version_hash_check', sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    check('prompt_version_schema_shape_check', sql`jsonb_typeof(${t.schemaShape}) = 'object'`),
  ],
);
