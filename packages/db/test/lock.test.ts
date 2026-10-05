import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AppDb,
  createAppDb,
  IngestSessionBusyError,
  withIngestLock,
  withMailbox,
} from '../src/index.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { seedMailboxes } from './support/seed.ts';

/**
 * The cross-process ingest lock (D-03, RESEARCH Pattern 6, Pitfall 9). Two
 * AppDb instances logged in as sift_app stand in for the worker and a CLI
 * backfill running in separate processes; each carries its own
 * application_name so the admin can tell their backends apart.
 */

let fresh: TestDatabase;
let M1: string;
let M2: string;
/** "Process" A and "process" B. */
let a: AppDb;
let b: AppDb;

function withAppName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('application_name', name);
  return parsed.toString();
}

function deferred<T = void>() {
  return Promise.withResolvers<T>();
}

/** Backends of this test database opened with `name`, read as the superuser. */
async function backends(name: string): Promise<number> {
  const admin = await connect(fresh.adminUrl);
  try {
    const { rows } = await admin.query<{ n: number }>(
      'select count(*)::int as n from pg_stat_activity where datname = $1 and application_name = $2',
      [fresh.name, name],
    );
    return rows[0]?.n ?? -1;
  } finally {
    await admin.end();
  }
}

beforeAll(async () => {
  fresh = await freshDatabase();
  const ids = await seedMailboxes(fresh.ownerUrl, ['lock-1', 'lock-2']);
  M1 = ids['lock-1'] as string;
  M2 = ids['lock-2'] as string;
  a = createAppDb(withAppName(fresh.appUrl, 'sift-lock-a'));
  b = createAppDb(withAppName(fresh.appUrl, 'sift-lock-b'));
});

afterAll(async () => {
  await a?.close({ timeoutMs: 2_000 });
  await b?.close({ timeoutMs: 2_000 });
  await fresh?.drop();
});

describe('withIngestLock across two processes (D-03)', () => {
  it('a second process gets acquired false at once while the first holds the lock; other mailboxes are unaffected', async () => {
    const entered = deferred();
    const gate = deferred();
    const holding = withIngestLock(a, M1, async () => {
      entered.resolve();
      await gate.promise;
      return 'a-done';
    });
    await entered.promise;

    let called = false;
    const started = performance.now();
    const contended = await withIngestLock(b, M1, async () => {
      called = true;
    });
    expect(contended).toEqual({ acquired: false });
    expect(called).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);

    await expect(withIngestLock(b, M2, async () => 'other')).resolves.toEqual({
      acquired: true,
      value: 'other',
    });

    gate.resolve();
    await expect(holding).resolves.toEqual({ acquired: true, value: 'a-done' });
    await expect(withIngestLock(b, M1, async () => 'b-after')).resolves.toEqual({
      acquired: true,
      value: 'b-after',
    });
  });
});

describe('IngestSession.run (Pitfall 9)', () => {
  it('writes through a scoped transaction on the lock connection: one backend for the holder', async () => {
    const name = 'sift-lock-budget';
    const holder = createAppDb(withAppName(fresh.appUrl, name));
    try {
      const at = new Date('2026-10-05T12:00:00.000Z');
      const counts: number[] = [];
      const result = await withIngestLock(holder, M1, async (session) => {
        expect(session.mailboxId).toBe(M1);
        await session.run(async (s) => {
          await s.mailboxStatus.upsert({ lastSeenAt: at });
          counts.push(await backends(name));
        });
        return session.run(async (s) => {
          counts.push(await backends(name));
          return (await s.mailboxStatus.get())?.lastSeenAt?.toISOString();
        });
      });
      expect(result).toEqual({ acquired: true, value: at.toISOString() });
      expect(counts).toEqual([1, 1]);

      const status = await withMailbox(b, M1, (s) => s.mailboxStatus.get());
      expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
    } finally {
      await holder.close({ timeoutMs: 2_000 });
    }
  });

  it('rejects a run nested inside another run with IngestSessionBusyError and sends no SQL', async () => {
    const querySpy = vi.spyOn(pg.Client.prototype, 'query');
    try {
      const at = new Date('2026-10-05T12:30:00.000Z');
      const result = await withIngestLock(a, M1, async (session) => {
        await session.run(async (s) => {
          const before = querySpy.mock.calls.length;
          await expect(session.run(async () => 'inner')).rejects.toBeInstanceOf(
            IngestSessionBusyError,
          );
          expect(querySpy.mock.calls.length).toBe(before);
          // The outer transaction is untouched and still writes.
          await s.mailboxStatus.upsert({ lastSeenAt: at });
          expect(querySpy.mock.calls.length).toBeGreaterThan(before);
        });
        // The first run settled, so the next one works.
        return session.run(async (s) => (await s.mailboxStatus.get())?.lastSeenAt?.toISOString());
      });
      expect(result).toEqual({ acquired: true, value: at.toISOString() });
    } finally {
      querySpy.mockRestore();
    }
  });

  it('rejects an overlapping run; the first still commits and a later run works', async () => {
    const at = new Date('2026-10-05T13:00:00.000Z');
    const result = await withIngestLock(a, M2, async (session) => {
      const gate = deferred();
      const first = session.run(async (s) => {
        await gate.promise;
        return s.mailboxStatus.upsert({ lastSeenAt: at });
      });
      const second = session.run((s) =>
        s.mailboxStatus.upsert({ lastSeenAt: new Date('2000-01-01T00:00:00.000Z') }),
      );
      await expect(second).rejects.toBeInstanceOf(IngestSessionBusyError);
      gate.resolve();
      await first;
      return session.run(async (s) => (await s.mailboxStatus.get())?.lastSeenAt?.toISOString());
    });
    expect(result).toEqual({ acquired: true, value: at.toISOString() });

    const status = await withMailbox(b, M2, (s) => s.mailboxStatus.get());
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
  });
});
