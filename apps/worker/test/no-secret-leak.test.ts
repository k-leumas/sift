// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { createMailboxCallbacks } from '../src/runtime/mailbox-batch.ts';
import { imapMailbox, recordingLog, siftConfig } from './support/mailbox-harness.ts';

/**
 * FND-02 / success criterion 2 (automated half, T-01-46): a mailbox password
 * set in the environment is used in memory only. After `sift config apply`, a
 * worker run and a recorded mailbox failure whose message quoted the password,
 * the value appears in no config file, no row of any table and no line of
 * process output.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');
const CONFIG_DIR = path.join(REPO_ROOT, 'config');
const EXAMPLE_CONFIG = path.join(CONFIG_DIR, 'config.example.yaml');

const S = `sentinel-${randomUUID()}`;
const S2 = `sentinel-${randomUUID()}`;
const SENTINELS = [S, S2] as const;

let db: TestDatabase;
let dir: string;
let configPath: string;
const outputs: { what: string; text: string }[] = [];
const children: ChildProcess[] = [];

/** Which sentinels occur in `text`. */
function leaks(text: string): string[] {
  return SENTINELS.filter((sentinel) => text.includes(sentinel));
}

/** Every regular file under `root`, recursively. */
async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

beforeAll(async () => {
  db = await freshDatabase();
  dir = await mkdtemp(path.join(tmpdir(), 'sift-secret-leak-test-'));
  configPath = path.join(dir, 'config.yaml');
  // The password_env names stay as they are; only the env values are sentinels.
  await copyFile(EXAMPLE_CONFIG, configPath);
});

afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await db?.drop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function statusRows(): Promise<{ slug: string; state: string | null }[]> {
  const admin = await connect(db.adminUrl);
  try {
    const { rows } = await admin.query<{ slug: string; state: string | null }>(
      `select m.slug, s.state
         from mailbox m left join mailbox_status s on s.mailbox_id = m.id
        order by m.slug`,
    );
    return rows;
  } finally {
    await admin.end();
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`condition not met within ${timeoutMs} ms`);
}

describe('mailbox secrets never persist (FND-02)', () => {
  it('the scanner finds a sentinel when it is there (positive control)', () => {
    expect(leaks(`IMAP login failed with password ${S}.`)).toEqual([S]);
    expect(leaks(JSON.stringify({ last_error: `x${S2}y` }))).toEqual([S2]);
    expect(leaks('nothing to see')).toEqual([]);
  });

  it('config apply with the passwords present persists none of them', () => {
    const result = spawnSync(process.execPath, [CLI, 'config', 'apply'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        SIFT_OWNER_DATABASE_URL: db.ownerUrl,
        SIFT_CONFIG: configPath,
        SIFT_PERSONAL_IMAP_PASSWORD: S,
        SIFT_JOBS_IMAP_PASSWORD: S2,
      },
    });
    outputs.push({ what: 'config apply stdout', text: result.stdout });
    outputs.push({ what: 'config apply stderr', text: result.stderr });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('add mailbox "personal"');
  });

  it('a worker run with the passwords in its env persists none of them', async () => {
    const child = spawn(process.execPath, [CLI, 'worker'], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        SIFT_DATABASE_URL: db.appUrl,
        SIFT_CONFIG: configPath,
        SIFT_HEARTBEAT_FILE: path.join(dir, 'heartbeat'),
        SIFT_PERSONAL_IMAP_PASSWORD: S,
        SIFT_JOBS_IMAP_PASSWORD: S2,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    const exited = new Promise<number | null>((resolve) => child.on('close', resolve));

    await waitFor(async () => {
      if (child.exitCode !== null) {
        throw new Error(`worker exited early (${child.exitCode}):\n${stdout}${stderr}`);
      }
      // The example config's IMAP host does not exist here, so each mailbox
      // gets a per-mailbox status from its first run rather than 'ok'.
      const rows = await statusRows();
      return rows.length === 2 && rows.every((r) => r.state !== null);
    }, 15_000);

    child.kill('SIGTERM');
    const code = await exited;
    outputs.push({ what: 'worker stdout', text: stdout });
    outputs.push({ what: 'worker stderr', text: stderr });
    expect(code, stdout + stderr).toBe(0);
    expect(stdout).toContain('worker started');
  }, 45_000);

  it('a mailbox failure quoting the password stores it redacted', async () => {
    const appDb = createAppDb(db.appUrl);
    try {
      const callbacks = createMailboxCallbacks(appDb, [S, S2], {
        config: siftConfig(imapMailbox('personal', 'me@proton.me')),
        env: {},
        log: recordingLog(),
      });
      const personal = (await callbacks.readRegistry()).find((m) => m.slug === 'personal');
      if (personal === undefined) throw new Error('mailbox "personal" is not registered');
      await callbacks.onBatchError(personal, new Error(`IMAP login failed with password ${S}`));
    } finally {
      await appDb.close();
    }

    const admin = await connect(db.adminUrl);
    try {
      const { rows } = await admin.query<{ state: string; last_error: string | null }>(
        `select s.state, s.last_error
           from mailbox_status s join mailbox m on m.id = s.mailbox_id
          where m.slug = 'personal'`,
      );
      expect(rows[0]?.state).toBe('error');
      expect(rows[0]?.last_error).toContain('[REDACTED]');
      expect(rows[0]?.last_error).toContain('IMAP login failed');
      expect(rows[0]?.last_error).not.toContain(S);
    } finally {
      await admin.end();
    }
  });

  it('no config file, table row or output line contains a sentinel', async () => {
    // Config files: the temp config dir and the repo's config/ dir.
    const files = [...(await filesUnder(dir)), ...(await filesUnder(CONFIG_DIR))];
    expect(files).toContain(configPath);
    for (const file of files) {
      expect(leaks(await readFile(file, 'utf8')), file).toEqual([]);
    }

    // Process output from config apply and the worker.
    expect(outputs.map((o) => o.what)).toEqual([
      'config apply stdout',
      'config apply stderr',
      'worker stdout',
      'worker stderr',
    ]);
    for (const { what, text } of outputs) {
      expect(leaks(text), what).toEqual([]);
    }

    // Every row of every table, as the superuser (bypasses RLS). The table
    // list comes from pg_tables, so tables added later are scanned too.
    const admin = await connect(db.adminUrl);
    try {
      const { rows: tables } = await admin.query<{
        schemaname: string;
        tablename: string;
        qualified: string;
      }>(
        `select schemaname, tablename,
                quote_ident(schemaname) || '.' || quote_ident(tablename) as qualified
           from pg_tables
          where schemaname not in ('pg_catalog', 'information_schema')
          order by schemaname, tablename`,
      );
      const schemas = new Set(tables.map((t) => t.schemaname));
      expect(schemas).toContain('public');
      expect(schemas).toContain('drizzle');
      const names = tables.map((t) => `${t.schemaname}.${t.tablename}`);
      expect(names).toContain('public.mailbox');
      expect(names).toContain('public.mailbox_status');

      let scannedRows = 0;
      let registryText = '';
      for (const { schemaname, tablename, qualified } of tables) {
        const { rows } = await admin.query<{ row: string }>(
          `select row_to_json(t)::text as row from ${qualified} t`,
        );
        for (const { row } of rows) {
          scannedRows += 1;
          if (tablename === 'mailbox') registryText += row;
          expect(leaks(row), `${schemaname}.${tablename}`).toEqual([]);
        }
      }
      // The scan really read data: the registry rows and their password_env names.
      expect(scannedRows).toBeGreaterThan(0);
      expect(registryText).toContain('SIFT_PERSONAL_IMAP_PASSWORD');
      expect(registryText).toContain('SIFT_JOBS_IMAP_PASSWORD');
    } finally {
      await admin.end();
    }
  });
});
