import { asc } from 'drizzle-orm';
import { type AppDb, internalsOf } from './app-db.ts';
import { type MailboxRow, mailbox } from './schema/index.ts';

export type RegistryRow = MailboxRow;

/**
 * Every mailbox row, ordered by slug, disabled ones included. The registry
 * is configuration with no RLS and sift_app may only read it (D-06), so this
 * runs outside any mailbox scope.
 */
export async function readRegistry(db: AppDb): Promise<RegistryRow[]> {
  const { orm } = internalsOf(db);
  return orm.select().from(mailbox).orderBy(asc(mailbox.slug));
}
