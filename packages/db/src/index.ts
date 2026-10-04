/** Database connection-string variables. Values are secrets and are never logged. */
export type DatabaseUrlVar =
  | 'SIFT_DATABASE_URL'
  | 'SIFT_OWNER_DATABASE_URL'
  | 'SIFT_BACKUP_DATABASE_URL';

/**
 * Read a database URL from the environment. Throws when the variable is unset
 * or whitespace-only. The error names the variable and never includes a value.
 */
export function requireDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
  name: DatabaseUrlVar,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

// The scoped API is the only data-access surface app code gets (ISO-04,
// D-42/D-43). Nothing here yields a pg pool, client, Drizzle instance or
// transaction.
export { type AppDb, type AppDbOptions, createAppDb } from './app-db.ts';
export { type RegistryRow, readRegistry } from './registry-read.ts';
export {
  type AppendOnlyTableApi,
  InvalidMailboxIdError,
  MailboxDisabledError,
  MailboxNotFoundError,
  type MailboxStatusApi,
  type MailboxStatusRow,
  type Match,
  requireActive,
  type Scope,
  ScopeClosedError,
  type ScopedTableApi,
  type WithMailboxOptions,
  withMailbox,
} from './scope.ts';
export {
  recordDisabled,
  recordMailboxSeen,
  recordSyncError,
  recordSyncSuccess,
} from './status.ts';
