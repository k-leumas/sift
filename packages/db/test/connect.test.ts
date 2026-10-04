import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createAppDb } from '../src/app-db.ts';
import {
  assertUnprivilegedRole,
  classifyConnectError,
  connectWithRetry,
  DatabaseStartupError,
} from '../src/connect.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';

/**
 * Worker startup against the database (D-55, Pitfall 11): only self-resolving
 * connection errors are retried, and the worker never runs as a role that
 * bypasses RLS (T-01-43). Messages never carry the URL or password (T-01-45).
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CLI = path.join(REPO_ROOT, 'apps/worker/src/cli.ts');
const EXAMPLE_CONFIG = path.join(REPO_ROOT, 'config/config.example.yaml');

let fresh: TestDatabase;

beforeAll(async () => {
  fresh = await freshDatabase();
});

afterAll(async () => {
  await fresh?.drop();
});

function withPassword(url: string, password: string): string {
  const u = new URL(url);
  u.password = password;
  return u.toString();
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

async function startupError(promise: Promise<unknown>): Promise<DatabaseStartupError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DatabaseStartupError) return error;
    throw error;
  }
  throw new Error('expected a DatabaseStartupError');
}

describe('classifyConnectError', () => {
  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', '57P03'])(
    'retries %s',
    (code) => {
      expect(classifyConnectError(Object.assign(new Error('x'), { code }))).toBe('retry');
    },
  );

  it.each(['28P01', '3D000', '42501', '28000'])('fails fast on %s', (code) => {
    expect(classifyConnectError(Object.assign(new Error('x'), { code }))).toBe('fatal');
  });

  it('fails fast on an error without a code', () => {
    expect(classifyConnectError(new Error('Connection terminated unexpectedly'))).toBe('fatal');
    expect(classifyConnectError('not even an error')).toBe('fatal');
    expect(classifyConnectError(undefined)).toBe('fatal');
  });

  it('reads the codes inside an AggregateError', () => {
    const inner = [
      Object.assign(new Error('a'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('b'), { code: 'ECONNREFUSED' }),
    ];
    expect(classifyConnectError(new AggregateError(inner, 'x'))).toBe('retry');
    expect(classifyConnectError(new AggregateError([new Error('c')], 'x'))).toBe('fatal');
  });
});

describe('connectWithRetry', () => {
  it('resolves on a reachable database as sift_app', async () => {
    const db = createAppDb(fresh.appUrl);
    try {
      await expect(connectWithRetry(db)).resolves.toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it('fails fast on a wrong password without leaking it (28P01)', async () => {
    const url = withPassword(fresh.appUrl, 'wrong-sentinel-pw');
    const db = createAppDb(url);
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const started = Date.now();
    try {
      const error = await startupError(connectWithRetry(db, { sleep }));
      expect(Date.now() - started).toBeLessThan(3000);
      expect(error.code).toBe('28P01');
      expect(error.message).toContain('SIFT_DATABASE_URL');
      expect(error.message).not.toContain('wrong-sentinel-pw');
      expect(error.message).not.toContain(url);
      expect(sleep).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });

  it('fails fast on a database that does not exist (3D000)', async () => {
    const url = withDatabase(fresh.appUrl, `${fresh.name}_missing`);
    const db = createAppDb(url);
    const started = Date.now();
    try {
      const error = await startupError(connectWithRetry(db));
      expect(Date.now() - started).toBeLessThan(3000);
      expect(error.code).toBe('3D000');
      expect(error.message).toContain('SIFT_DATABASE_URL');
      expect(error.message).not.toContain(url);
    } finally {
      await db.close();
    }
  });

  it('retries a closed port with backoff until the deadline', async () => {
    const db = createAppDb('postgres://sift_app:x@127.0.0.1:1/sift');
    const sleeps: number[] = [];
    const sleep = (ms: number) => {
      sleeps.push(ms);
      return new Promise<void>((resolve) => setTimeout(resolve, ms));
    };
    const warn = vi.fn<(obj: object, msg?: string) => void>();
    try {
      const error = await startupError(
        connectWithRetry(db, { deadlineMs: 1500, sleep, log: { warn } }),
      );
      expect(sleeps.length).toBeGreaterThanOrEqual(2);
      expect(error.message).toContain('not reachable');
      expect(error.message).toContain('ECONNREFUSED');
      expect(error.code).toBe('ECONNREFUSED');
      expect(warn).toHaveBeenCalledWith(
        { code: 'ECONNREFUSED', attempt: 1 },
        'database not ready; retrying',
      );
    } finally {
      await db.close();
    }
    // Backoff doubles from 250 ms with +/-20 % jitter.
    expect(sleeps[0]).toBeGreaterThanOrEqual(200);
    expect(sleeps[0]).toBeLessThanOrEqual(300);
    expect(sleeps[1]).toBeGreaterThanOrEqual(400);
  });
});

describe('assertUnprivilegedRole', () => {
  it('accepts sift_app', async () => {
    const db = createAppDb(fresh.appUrl);
    try {
      await expect(assertUnprivilegedRole(db)).resolves.toBeUndefined();
    } finally {
      await db.close();
    }
  });

  it('refuses a superuser and names the role', async () => {
    const admin = await connect(fresh.adminUrl);
    const name = (await admin.query<{ name: string }>('select current_user as name')).rows[0]?.name;
    await admin.end();

    const db = createAppDb(fresh.adminUrl);
    try {
      const error = await startupError(assertUnprivilegedRole(db));
      expect(error.message).toContain('sift_app');
      expect(error.message).toContain(`"${name}"`);
      expect(error.message).not.toContain(fresh.adminUrl);
    } finally {
      await db.close();
    }
  });

  it('refuses sift_owner: it owns the schema and has CREATEROLE (D-36)', async () => {
    const db = createAppDb(fresh.ownerUrl);
    try {
      const error = await startupError(assertUnprivilegedRole(db));
      expect(error.message).toContain('"sift_owner"');
      expect(error.message).toContain('CREATEROLE');
      expect(error.message).toContain('owns database objects');
      expect(error.message).not.toContain(fresh.ownerUrl);
    } finally {
      await db.close();
    }
  });

  it('refuses a plain role that is a member of sift_backup (one SET ROLE from BYPASSRLS)', async () => {
    const name = `sift_guard_${randomBytes(3).toString('hex')}`;
    const password = randomBytes(12).toString('hex');
    const admin = await connect(fresh.adminUrl);
    try {
      await admin.query(
        `create role ${name} login password '${password}' nosuperuser nobypassrls in role sift_backup`,
      );
      const url = new URL(fresh.appUrl);
      url.username = name;
      url.password = password;
      const db = createAppDb(url.toString());
      try {
        const error = await startupError(assertUnprivilegedRole(db));
        expect(error.message).toContain(`"${name}"`);
        // Indirect memberships count too: sift_backup brings pg_read_all_data.
        expect(error.message).toContain('member of pg_read_all_data, sift_backup');
        expect(error.message).not.toContain(password);
      } finally {
        await db.close();
      }
    } finally {
      await admin.query(`drop role if exists ${name}`);
      await admin.end();
    }
  });

  it('refuses a REPLICATION role: logical decoding reads every row past RLS (IN-11)', async () => {
    const name = `sift_guard_${randomBytes(3).toString('hex')}`;
    const password = randomBytes(12).toString('hex');
    const admin = await connect(fresh.adminUrl);
    try {
      await admin.query(
        `create role ${name} login password '${password}' nosuperuser nobypassrls replication`,
      );
      const url = new URL(fresh.appUrl);
      url.username = name;
      url.password = password;
      const db = createAppDb(url.toString());
      try {
        const error = await startupError(assertUnprivilegedRole(db));
        expect(error.message).toContain(`"${name}": REPLICATION`);
        expect(error.message).not.toContain(password);
      } finally {
        await db.close();
      }
    } finally {
      await admin.query(`drop role if exists ${name}`);
      await admin.end();
    }
  });

  it('the worker exits 1 when SIFT_DATABASE_URL is a superuser URL', async () => {
    const child = spawn(process.execPath, [CLI, 'worker'], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH ?? '',
        SIFT_DATABASE_URL: fresh.adminUrl,
        SIFT_CONFIG: EXAMPLE_CONFIG,
        SIFT_HEARTBEAT_FILE: path.join(tmpdir(), `sift-connect-test-${process.pid}`, 'heartbeat'),
        SIFT_PERSONAL_IMAP_PASSWORD: 'pw-a',
        SIFT_JOBS_IMAP_PASSWORD: 'pw-b',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`worker did not exit within 15 s:\n${output}`));
      }, 15_000);
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode);
      });
    });

    expect(code, output).toBe(1);
    expect(output).toContain(': superuser');
    expect(output).not.toContain(fresh.adminUrl);
    expect(output).not.toContain('worker started');

    const admin = await connect(fresh.adminUrl);
    try {
      const { rows } = await admin.query<{ n: number }>(
        'select count(*)::int as n from mailbox_status',
      );
      expect(rows[0]?.n).toBe(0);
    } finally {
      await admin.end();
    }
  }, 30_000);
});
