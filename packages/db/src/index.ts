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
