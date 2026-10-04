import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { redactText } from '@sift/core/log';
import { requireDatabaseUrl } from '@sift/db';
import { type BackupTarget, migrate } from '@sift/db/migrate';
import type { CommandIO } from '../command.ts';

const DEFAULT_BACKUP_DIR = 'backups';

/** Show a path relative to the working directory when it lives under it. */
function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

function nonBlank(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/**
 * `sift migrate` (FND-01, D-29, D-30, D-66). Applies pending migrations as
 * sift_owner under an advisory lock. When anything is pending it first writes
 * a pg_dump taken as sift_backup to SIFT_BACKUP_DIR (default `backups`) and
 * keeps the newest five.
 *
 * Env: SIFT_OWNER_DATABASE_URL and SIFT_DB_APP_PASSWORD (required),
 * SIFT_BACKUP_DATABASE_URL (required only when migrations are pending),
 * SIFT_BACKUP_DIR, SIFT_PG_DUMP. URLs and passwords are never printed.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  const secrets = [
    io.env.SIFT_OWNER_DATABASE_URL,
    io.env.SIFT_BACKUP_DATABASE_URL,
    io.env.SIFT_DB_APP_PASSWORD,
  ].filter((s): s is string => s !== undefined && s.trim() !== '');

  try {
    parseArgs({ args: [...args], options: {}, strict: true, allowPositionals: false });

    const ownerUrl = requireDatabaseUrl(io.env, 'SIFT_OWNER_DATABASE_URL');
    const appPassword = io.env.SIFT_DB_APP_PASSWORD;
    if (appPassword === undefined || appPassword.trim() === '') {
      throw new Error('Missing env var: SIFT_DB_APP_PASSWORD');
    }

    const backupUrl = nonBlank(io.env.SIFT_BACKUP_DATABASE_URL);
    let backup: BackupTarget | undefined;
    if (backupUrl !== undefined) {
      const pgDump = nonBlank(io.env.SIFT_PG_DUMP);
      backup = {
        url: backupUrl,
        dir: resolve(io.cwd, nonBlank(io.env.SIFT_BACKUP_DIR) ?? DEFAULT_BACKUP_DIR),
        // A path (not a bare command name) is relative to the working directory.
        ...(pgDump === undefined
          ? {}
          : { pgDump: pgDump.includes('/') ? resolve(io.cwd, pgDump) : pgDump }),
      };
    }

    const result = await migrate({ ownerUrl, appPassword, backup });
    if (result.applied.length === 0) {
      io.stdout('No pending migrations.');
      return 0;
    }
    if (result.backupFile !== null) {
      io.stdout(`Backup written: ${displayPath(result.backupFile, io.cwd)}`);
    }
    io.stdout(`Applied ${result.applied.length} migrations: ${result.applied.join(', ')}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sift migrate: ${redactText(message, secrets)}`);
    return 1;
  }
}
