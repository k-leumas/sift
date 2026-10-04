import { type SQL, sql } from 'drizzle-orm';
import { type PgPolicy, type PgRole, pgPolicy, pgRole } from 'drizzle-orm/pg-core';

/**
 * Roles are created outside drizzle-kit: sift_owner by db/bootstrap.sql and
 * sift_app by migrate(). `.existing()` keeps kit from emitting CREATE ROLE.
 */
export const siftApp: PgRole = pgRole('sift_app').existing();
export const siftOwner: PgRole = pgRole('sift_owner').existing();

/**
 * The one isolation predicate (D-41). `nullif` turns an unset or reset
 * setting into NULL, so a connection with no mailbox matches no rows.
 */
export const mailboxPredicate: SQL = sql`mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid`;

/** The single policy every mailbox-scoped table carries (ISO-02, D-41). */
export function mailboxIsolation(): PgPolicy {
  return pgPolicy('mailbox_isolation', {
    as: 'permissive',
    for: 'all',
    to: [siftApp, siftOwner],
    using: mailboxPredicate,
    withCheck: mailboxPredicate,
  });
}
