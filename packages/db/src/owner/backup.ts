import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { redactText } from '@sift/core/log';

/** How many sift-*.dump files `sift migrate` keeps after a successful dump (D-29). */
export const BACKUP_KEEP = 5;

/** Where and how `sift migrate` writes its pre-migration dump (D-29, D-66). */
export interface BackupTarget {
  /** sift_backup connection string. Its password only ever reaches pg_dump as PGPASSWORD. */
  url: string;
  /** Directory the dump is written to; created when missing. */
  dir: string;
  /** pg_dump executable (default `pg_dump`); must be major version 18. */
  pgDump?: string;
}

/** pg_dump could not produce a complete dump. The message never carries the password. */
export class BackupFailedError extends Error {
  override name = 'BackupFailedError';
}

const BACKUP_NAME = /^sift-\d{8}T\d{6}Z-pre-.+\.dump$/;
const SAFE_TAG = /^[A-Za-z0-9_.-]+$/;
const WRITE_PROBE = '.sift-write-probe';
const STDERR_LIMIT = 4096;

/** `sift-YYYYMMDDTHHMMSSZ-pre-<tag>.dump`, in UTC. Names sort chronologically. */
export function backupFileName(now: Date, targetTag: string): string {
  if (!SAFE_TAG.test(targetTag)) {
    throw new Error(`Migration tag is not usable in a file name: ${targetTag}`);
  }
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `sift-${stamp}-pre-${targetTag}.dump`;
}

/**
 * Create `dir` when missing and prove it is writable (Pitfall 12). A
 * Docker-created bind mount is root-owned, so the fix names `chown 1000`.
 */
export async function ensureWritableDir(dir: string): Promise<void> {
  const probe = path.join(dir, WRITE_PROBE);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, '', { mode: 0o600 });
    await unlink(probe);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
      throw new Error(`backup directory ${dir} is not writable; on Linux run: chown 1000 ${dir}`);
    }
    throw error;
  }
}

/**
 * Stream a custom-format pg_dump of `target.url` into `<dir>/<fileName>` with
 * mode 0600 and return the absolute path. The password travels only in the
 * PGPASSWORD environment variable: argv carries a `--dbname=` URL without it,
 * and pg_dump's stderr is redacted before it reaches an error. A failed dump
 * leaves no partial file behind.
 */
export async function writeBackup(target: BackupTarget, fileName: string): Promise<string> {
  const file = path.resolve(target.dir, fileName);
  const url = new URL(target.url);
  const password = decodeURIComponent(url.password);
  url.password = '';
  const command = target.pgDump ?? 'pg_dump';

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (password === '') {
    delete env.PGPASSWORD;
  } else {
    env.PGPASSWORD = password;
  }

  const child = spawn(command, ['--format=custom', '--no-password', `--dbname=${url.toString()}`], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < STDERR_LIMIT) stderr += chunk;
  });

  let opened = false;
  const out = createWriteStream(file, { flags: 'wx', mode: 0o600 });
  out.once('open', () => {
    opened = true;
  });

  let writeError: unknown;
  const piped = pipeline(child.stdout, out).catch((error: unknown) => {
    writeError = error;
    child.kill();
  });
  const exit = await new Promise<{ code: number | null; spawnError?: unknown }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, spawnError: error }));
    child.once('close', (code) => resolve({ code }));
  });
  await piped;

  let failure: string | undefined;
  if (exit.spawnError !== undefined) {
    failure = `could not start ${command} (${errorCode(exit.spawnError) ?? 'unknown error'})`;
  } else if (writeError !== undefined) {
    failure = `could not write ${fileName} (${errorCode(writeError) ?? 'unknown error'})`;
  } else if (exit.code !== 0) {
    failure = `exit ${exit.code ?? 'by signal'}`;
  }

  if (failure !== undefined) {
    if (opened) {
      await rm(file, { force: true });
    }
    const detail = redactText(stderr.trim(), [password, target.url]);
    throw new BackupFailedError(`pg_dump failed (${failure})${detail === '' ? '' : `: ${detail}`}`);
  }
  return file;
}

/**
 * Keep the newest `keep` files named like a Sift backup and delete the rest.
 * Other files in the directory are never touched. Returns the removed names.
 */
export async function pruneBackups(dir: string, keep: number = BACKUP_KEEP): Promise<string[]> {
  const names = (await readdir(dir)).filter((name) => BACKUP_NAME.test(name));
  names.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const removed = names.slice(Math.max(keep, 0));
  for (const name of removed) {
    await rm(path.join(dir, name), { force: true });
  }
  return removed;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error as { code: unknown };
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
