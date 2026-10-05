import { randomUUID } from 'node:crypto';
import { type AddressInfo, createServer, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { internalsOf } from '../src/app-db.ts';
import * as api from '../src/index.ts';
import {
  type AppDb,
  createAppDb,
  InvalidMailboxIdError,
  MailboxDisabledError,
  MailboxNotFoundError,
  readRegistry,
  recordDisabled,
  recordMailboxSeen,
  recordSyncError,
  recordSyncSuccess,
  requireActive,
  type Scope,
  ScopeClosedError,
  withMailbox,
} from '../src/index.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { type ScopedRowIds, seedMailboxes, seedScopedRows } from './support/seed.ts';

/**
 * The scoped API (ISO-04, D-42..D-45): the only data-access surface app code
 * gets. RLS is the backstop; these helpers are the first line.
 */

let fresh: TestDatabase;
/** Active mailboxes with one seeded row in every scoped table. */
let A: string;
let B: string;
/** Disabled mailbox (D-45). */
let C: string;
/** Active mailbox with no mailbox_status row, for the status use-cases. */
let D: string;
let seededA: ScopedRowIds;
let seededB: ScopedRowIds;

/** Scoped tables reachable through Scope, with their SQL names. */
const SCOPE_TABLES = [
  ['message', 'message'],
  ['messageLocation', 'message_location'],
  ['messageBody', 'message_body'],
  ['label', 'label'],
  ['folderSync', 'folder_sync'],
  ['ruleSet', 'rule_set'],
  ['decision', 'decision'],
  ['labelEvent', 'label_event'],
] as const;

type AdminRow = { id: string; updated_at: Date };

/** Ground truth for one mailbox, read as the superuser (bypasses RLS). */
async function adminRows(table: string, mailboxId: string): Promise<AdminRow[]> {
  const admin = await connect(fresh.adminUrl);
  try {
    const { rows } = await admin.query<AdminRow>(
      `select id, updated_at from ${table} where mailbox_id = $1 order by id`,
      [mailboxId],
    );
    return rows;
  } finally {
    await admin.end();
  }
}

async function adminCount(sql: string, params: unknown[]): Promise<number> {
  const admin = await connect(fresh.adminUrl);
  try {
    const { rows } = await admin.query<{ n: number }>(sql, params);
    return rows[0]?.n ?? -1;
  } finally {
    await admin.end();
  }
}

async function adminQuery<R extends object>(sql: string, params: unknown[]): Promise<R[]> {
  const admin = await connect(fresh.adminUrl);
  try {
    return (await admin.query<R>(sql, params)).rows;
  } finally {
    await admin.end();
  }
}

const ids = (rows: readonly { id: string }[]): string[] => rows.map((r) => r.id).sort();

/** The NOT NULL fields of a new message (D-12); identity_key is unique per mailbox. */
const newMessage = () => ({
  identityKey: `mid:${randomUUID()}@scope.test`,
  internalDate: new Date(),
  eligibleForClassification: true,
});

/** The NOT NULL fields of a new folder_sync row (D-18); folder is unique per mailbox. */
const newFolderSync = () => ({
  folder: `scope-${randomUUID()}`,
  uidvalidity: 1,
  lastUid: 0,
  internalDateWatermark: new Date(),
});

/** Largest unsigned 32-bit value: the top of the UID and UIDVALIDITY range (SPK-04). */
const MAX_U32 = 4_294_967_295;

beforeAll(async () => {
  fresh = await freshDatabase();
  const slugs = await seedMailboxes(fresh.ownerUrl, ['scope-a', 'scope-b', 'scope-c', 'scope-d']);
  A = slugs['scope-a'] as string;
  B = slugs['scope-b'] as string;
  C = slugs['scope-c'] as string;
  D = slugs['scope-d'] as string;
  seededA = await seedScopedRows(fresh.ownerUrl, A);
  seededB = await seedScopedRows(fresh.ownerUrl, B);

  const owner = await connect(fresh.ownerUrl);
  try {
    await owner.query('update mailbox set disabled_at = now() where id = $1', [C]);
  } finally {
    await owner.end();
  }
});

afterAll(async () => {
  await fresh?.drop();
});

describe('withMailbox as sift_app (RLS and helper filter both in force)', () => {
  let app: AppDb;

  beforeAll(() => {
    app = createAppDb(fresh.appUrl);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('writes a message under A and reads it back only under A', async () => {
    const inserted = await withMailbox(app, A, (s) => s.message.insert([newMessage()]));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.mailboxId).toBe(A);
    const insertedId = inserted[0]?.id as string;

    const underA = await withMailbox(app, A, (s) => s.message.find({ id: insertedId }));
    expect(underA).toEqual(inserted);
    const allA = await withMailbox(app, A, (s) => s.message.find());
    expect(ids(allA)).toEqual([seededA.messageId, insertedId].sort());

    const underB = await withMailbox(app, B, (s) => s.message.find({ id: insertedId }));
    expect(underB).toEqual([]);
  });

  it('hands the callback only per-table helpers', async () => {
    const keys = await withMailbox(app, A, async (s) => Object.keys(s).sort());
    expect(keys).toEqual([
      'decision',
      'folderSync',
      'label',
      'labelEvent',
      'mailboxId',
      'mailboxStatus',
      'message',
      'messageBody',
      'messageLocation',
      'ruleSet',
    ]);
    expect(Object.keys(app)).toEqual(['close']);
  });

  it('keeps cross-mailbox writes and append-only mutations out of the types', async () => {
    await withMailbox(app, A, async (s) => {
      // @ts-expect-error mailbox_id is filled from the scope, never from input (D-44)
      const [row] = await s.message.insert([{ ...newMessage(), mailboxId: B }]);
      expect(row?.mailboxId).toBe(A);

      // @ts-expect-error update cannot move a row to another mailbox
      await expect(s.message.update({ mailboxId: B })).rejects.toThrow(TypeError);
      // @ts-expect-error update cannot rewrite a primary key
      await expect(s.message.update({ id: randomUUID() })).rejects.toThrow(TypeError);

      // @ts-expect-error decision is append-only (D-40)
      expect(s.decision.update).toBeUndefined();
      // @ts-expect-error label_event is append-only (D-40)
      expect(s.labelEvent.delete).toBeUndefined();
      expect(Object.keys(s.decision).sort()).toEqual(['find', 'insert']);
      expect(Object.keys(s.labelEvent).sort()).toEqual(['find', 'insert']);
    });
  });

  it('inserts into append-only tables and every other scoped table under the scope', async () => {
    const rows = await withMailbox(app, A, async (s) => {
      const [msg] = await s.message.insert([newMessage()]);
      const messageId = msg?.id as string;
      return {
        label: await s.label.insert([{ messageId }]),
        decision: await s.decision.insert([{ messageId }]),
        messageLocation: await s.messageLocation.insert([
          { messageId, folder: 'INBOX', uidvalidity: 7, uid: 1, generation: 1 },
        ]),
        messageBody: await s.messageBody.insert([
          { messageId, bodyText: '', source: 'none', truncated: false },
        ]),
        folderSync: await s.folderSync.insert([newFolderSync()]),
        labelEvent: await s.labelEvent.insert([{}]),
        ruleSet: await s.ruleSet.insert([{}]),
      };
    });
    for (const inserted of Object.values(rows)) {
      expect(inserted).toHaveLength(1);
      expect(inserted[0]?.mailboxId).toBe(A);
    }
  });

  it('returns [] for an empty insert without touching the database', async () => {
    expect(await withMailbox(app, A, (s) => s.ruleSet.insert([]))).toEqual([]);
  });
});

describe('application filter without RLS (superuser connection)', () => {
  // A superuser bypasses RLS, so any B row coming back under A could only be
  // the result of a missing application-level mailbox_id filter (ISO-04).
  let admin: AppDb;

  beforeAll(() => {
    admin = createAppDb(fresh.adminUrl);
  });

  afterAll(async () => {
    await admin?.close();
  });

  it('find() under A returns exactly A rows on every scoped table', async () => {
    for (const [key, table] of SCOPE_TABLES) {
      const found = await withMailbox(admin, A, (s) => s[key].find());
      expect(found.length, table).toBeGreaterThan(0);
      expect(
        found.every((r) => r.mailboxId === A),
        table,
      ).toBe(true);
      expect(ids(found), table).toEqual(ids(await adminRows(table, A)));
    }
    const status = await withMailbox(admin, A, (s) => s.mailboxStatus.get());
    expect(status?.mailboxId).toBe(A);
  });

  it('a match on a B id under A finds, updates and deletes nothing', async () => {
    const result = await withMailbox(admin, A, async (s) => ({
      found: await s.message.find({ id: seededB.messageId }),
      updated: await s.folderSync.update({}, { id: seededB.folderSyncId }),
      deleted: await s.label.delete({ id: seededB.labelId }),
      appendOnly: await s.decision.find({ id: seededB.decisionId }),
      location: await s.messageLocation.update(
        { removedAt: new Date(), removedReason: 'vanished' },
        { id: seededB.messageLocationId },
      ),
      body: await s.messageBody.delete({ id: seededB.messageBodyId }),
    }));
    expect(result).toEqual({
      found: [],
      updated: [],
      deleted: [],
      appendOnly: [],
      location: [],
      body: [],
    });
    expect(ids(await adminRows('label', B))).toEqual([seededB.labelId]);
    expect(ids(await adminRows('message_location', B))).toEqual([seededB.messageLocationId]);
    expect(ids(await adminRows('message_body', B))).toEqual([seededB.messageBodyId]);
  });

  it('update({}) under A touches only A rows', async () => {
    const mutable = [
      'message',
      'messageLocation',
      'messageBody',
      'label',
      'folderSync',
      'ruleSet',
    ] as const;
    const tables = {
      message: 'message',
      messageLocation: 'message_location',
      messageBody: 'message_body',
      label: 'label',
      folderSync: 'folder_sync',
      ruleSet: 'rule_set',
    };
    for (const key of mutable) {
      const beforeB = await adminRows(tables[key], B);
      const updated = await withMailbox(admin, A, (s) => s[key].update({}));
      expect(updated.length, key).toBeGreaterThan(0);
      expect(
        updated.every((r) => r.mailboxId === A),
        key,
      ).toBe(true);
      expect(await adminRows(tables[key], B), key).toEqual(beforeB);
    }
  });

  it('delete() under A removes only A rows', async () => {
    const deletable = [
      ['messageLocation', 'message_location'],
      ['messageBody', 'message_body'],
      ['label', 'label'],
      ['folderSync', 'folder_sync'],
      ['ruleSet', 'rule_set'],
    ] as const;
    for (const [key, table] of deletable) {
      const beforeB = await adminRows(table, B);
      const deleted = await withMailbox(admin, A, (s) => s[key].delete());
      expect(deleted.length, table).toBeGreaterThan(0);
      expect(
        deleted.every((r) => r.mailboxId === A),
        table,
      ).toBe(true);
      expect(await adminRows(table, A), table).toEqual([]);
      expect(await adminRows(table, B), table).toEqual(beforeB);
    }
  });

  it('insertOrIgnore and upsert under A conflict only with A rows (T-02-21)', async () => {
    const [bMessage] = await adminQuery<{ identity_key: string; updated_at: Date }>(
      'select identity_key, updated_at from message where id = $1',
      [seededB.messageId],
    );
    const [bLocation] = await adminQuery<{
      folder: string;
      uidvalidity: string;
      uid: string;
      generation: number;
      updated_at: Date;
    }>(
      'select folder, uidvalidity, uid, generation, updated_at from message_location where id = $1',
      [seededB.messageLocationId],
    );
    const identityKey = bMessage?.identity_key as string;

    const result = await withMailbox(admin, A, async (s) => ({
      ignored: await s.message.insertOrIgnore(
        [{ identityKey, internalDate: new Date(), eligibleForClassification: false }],
        { target: ['identityKey'] },
      ),
      upserted: await s.messageLocation.upsert(
        [
          {
            messageId: seededA.messageId,
            folder: bLocation?.folder as string,
            uidvalidity: Number(bLocation?.uidvalidity),
            uid: Number(bLocation?.uid),
            generation: 42,
          },
        ],
        { target: ['folder', 'uidvalidity', 'uid'], update: ['generation'] },
      ),
    }));

    // B's rows did not count as conflicts: both statements inserted A rows.
    expect(result.ignored).toHaveLength(1);
    expect(result.ignored[0]?.mailboxId).toBe(A);
    expect(result.upserted).toMatchObject([{ mailboxId: A, generation: 42, inserted: true }]);
    expect(
      await adminQuery('select identity_key, updated_at from message where id = $1', [
        seededB.messageId,
      ]),
    ).toEqual([bMessage]);
    expect(
      await adminQuery(
        'select folder, uidvalidity, uid, generation, updated_at from message_location where id = $1',
        [seededB.messageLocationId],
      ),
    ).toEqual([bLocation]);
  });

  it('an array match under A that names B ids finds, updates and deletes only A rows', async () => {
    const both = [seededA.messageId, seededB.messageId];
    const beforeB = await adminRows('message', B);
    const result = await withMailbox(admin, A, async (s) => ({
      found: ids(await s.message.find({ id: both })),
      updated: ids(await s.message.update({}, { id: both })),
      deleted: ids(await s.label.delete({ id: [seededA.labelId, seededB.labelId] })),
    }));
    expect(result).toEqual({
      found: [seededA.messageId],
      updated: [seededA.messageId],
      deleted: [],
    });
    expect(await adminRows('message', B)).toEqual(beforeB);
    expect(ids(await adminRows('label', B))).toEqual([seededB.labelId]);
  });

  it('messageBody.deleteExpired under A leaves expired B bodies alone', async () => {
    const past = new Date('2000-01-01T00:00:00Z');
    await withMailbox(admin, B, async (s) => {
      await s.messageBody.update({ expiresAt: past }, { id: seededB.messageBodyId });
    });
    await withMailbox(admin, A, (s) => s.messageBody.deleteExpired(new Date()));
    expect(ids(await adminRows('message_body', B))).toEqual([seededB.messageBodyId]);
  });
});

describe('pooled connections', () => {
  it('runs concurrent scopes for A and B on one pool, each seeing only its own rows', async () => {
    const db = createAppDb(fresh.appUrl, { maxConnections: 2 });
    try {
      const events: string[] = [];
      const run = (id: string, tag: string) =>
        withMailbox(db, id, async (s) => {
          events.push(`start ${tag}`);
          await delay(200);
          const rows = await s.message.find();
          events.push(`end ${tag}`);
          return rows;
        });
      const [rowsA, rowsB] = await Promise.all([run(A, 'A'), run(B, 'B')]);

      // Both transactions were open at the same time.
      expect(events.slice(0, 2).sort()).toEqual(['start A', 'start B']);
      expect(rowsA.length).toBeGreaterThan(0);
      expect(rowsA.every((r) => r.mailboxId === A)).toBe(true);
      expect(rowsB.length).toBeGreaterThan(0);
      expect(rowsB.every((r) => r.mailboxId === B)).toBe(true);
    } finally {
      await db.close();
    }
  });

  it('rolls back when the callback throws and leaves no mailbox on the connection', async () => {
    const db = createAppDb(fresh.appUrl, { maxConnections: 1 });
    try {
      let insertedId: string | undefined;
      await expect(
        withMailbox(db, A, async (s) => {
          const [row] = await s.message.insert([newMessage()]);
          insertedId = row?.id;
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(insertedId).toBeDefined();
      expect(
        await adminCount('select count(*)::int as n from message where id = $1', [insertedId]),
      ).toBe(0);

      const underB = await withMailbox(db, B, (s) => s.message.find());
      expect(underB.length).toBeGreaterThan(0);
      expect(underB.every((r) => r.mailboxId === B)).toBe(true);

      // The pool's only connection carries no mailbox after the scopes ended.
      const { rows } = await internalsOf(db).pool.query<{ v: string | null }>(
        "select current_setting('app.mailbox_id', true) as v",
      );
      expect([null, '']).toContain(rows[0]?.v);
    } finally {
      await db.close();
    }
  });
});

describe('bounded close (D-53)', () => {
  it('closes an idle pool without forcing', async () => {
    const db = createAppDb(fresh.appUrl);
    await withMailbox(db, A, (s) => s.message.find());
    await expect(db.close({ timeoutMs: 1_000 })).resolves.toEqual({ forced: false });
  });

  it('ends a client stuck in a lock wait once the timeout passes', async () => {
    // Another session holds an exclusive lock, so the scope blocks inside its
    // transaction the way a stuck batch would; pool.end() alone never resolves.
    const locker = await connect(fresh.adminUrl);
    const db = createAppDb(fresh.appUrl);
    try {
      await locker.query('begin');
      await locker.query('lock table message in access exclusive mode');
      const stuck = withMailbox(db, A, (s) => s.message.find());
      stuck.catch(() => {});
      await delay(300);

      const startedAt = Date.now();
      await expect(db.close({ timeoutMs: 200 })).resolves.toEqual({ forced: true });
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      await expect(stuck).rejects.toThrow();
    } finally {
      await locker.query('rollback').catch(() => {});
      await locker.end();
    }
  });

  it('ends a client still in its startup handshake, closing its socket (IN-12)', async () => {
    // A server that accepts the TCP connection but never answers the startup
    // message: the pool's client stays in the handshake, before pg-pool's
    // 'connect' event.
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      sockets.push(socket);
      socket.on('error', () => {});
      // Read (and drop) what the client sends, so its FIN is seen as 'close'.
      socket.resume();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const db = createAppDb(`postgres://nobody:pw@127.0.0.1:${port}/none`, {
      onPoolError: () => {},
    });
    try {
      const pending = internalsOf(db).pool.query('select 1');
      pending.catch(() => {});
      while (sockets.length === 0) await delay(20);
      const socket = sockets[0] as Socket;
      const socketClosed = new Promise<'closed'>((resolve) =>
        socket.once('close', () => resolve('closed')),
      );

      await expect(db.close({ timeoutMs: 100 })).resolves.toEqual({ forced: true });
      const outcome = await Promise.race([socketClosed, delay(2_000).then(() => 'open')]);
      // The socket, not the pending query, is what kept the worker alive: pg
      // never settles a connect that was ended on purpose mid-handshake.
      expect(outcome).toBe('closed');
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('guards', () => {
  it('rejects a non-UUID mailbox id before any query runs', async () => {
    // Nothing listens on port 1: any query would fail with a connection error.
    const unreachable = createAppDb('postgres://nobody@127.0.0.1:1/none', {
      onPoolError: () => {},
    });
    try {
      const fn = vi.fn(async () => {});
      for (const bad of ['not-a-uuid', "'; drop table message; --", '', `${A} `]) {
        await expect(withMailbox(unreachable, bad, fn)).rejects.toBeInstanceOf(
          InvalidMailboxIdError,
        );
      }
      expect(fn).not.toHaveBeenCalled();
    } finally {
      await unreachable.close();
    }
  });

  it('throws ScopeClosedError when a scope is used after its callback resolved', async () => {
    const app = createAppDb(fresh.appUrl);
    try {
      let captured: Scope | undefined;
      await withMailbox(app, A, async (s) => {
        captured = s;
      });
      const scope = captured as Scope;
      await expect(scope.message.find()).rejects.toBeInstanceOf(ScopeClosedError);
      await expect(scope.decision.insert([])).rejects.toBeInstanceOf(ScopeClosedError);
      await expect(scope.mailboxStatus.get()).rejects.toBeInstanceOf(ScopeClosedError);
      await expect(requireActive(scope)).rejects.toBeInstanceOf(ScopeClosedError);
    } finally {
      await app.close();
    }
  });
});

describe('requireActive (D-45)', () => {
  let app: AppDb;

  beforeAll(() => {
    app = createAppDb(fresh.appUrl);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a disabled mailbox before the callback runs', async () => {
    const fn = vi.fn(async (s: Scope) => s.message.find());
    const attempt = withMailbox(app, C, fn, { requireActive: true });
    await expect(attempt).rejects.toBeInstanceOf(MailboxDisabledError);
    await expect(attempt).rejects.toThrow('mailbox "scope-c" is disabled');
    expect(fn).not.toHaveBeenCalled();
  });

  it('still scopes a disabled mailbox without the option', async () => {
    expect(await withMailbox(app, C, (s) => s.message.find())).toEqual([]);
    await expect(withMailbox(app, C, (s) => requireActive(s))).rejects.toBeInstanceOf(
      MailboxDisabledError,
    );
  });

  it('passes for an active mailbox', async () => {
    const found = await withMailbox(app, A, (s) => s.message.find(), { requireActive: true });
    expect(found.length).toBeGreaterThan(0);
    await expect(withMailbox(app, B, (s) => requireActive(s))).resolves.toBeUndefined();
  });

  it('rejects an unknown mailbox with MailboxNotFoundError', async () => {
    await expect(
      withMailbox(app, randomUUID(), async () => {}, { requireActive: true }),
    ).rejects.toBeInstanceOf(MailboxNotFoundError);
  });
});

describe('mailbox status use-cases (D-07, D-51)', () => {
  let app: AppDb;

  beforeAll(() => {
    app = createAppDb(fresh.appUrl);
  });

  afterAll(async () => {
    await app?.close();
  });

  const statusRows = () =>
    adminCount('select count(*)::int as n from mailbox_status where mailbox_id = $1', [D]);

  it('upsert twice keeps one row', async () => {
    expect(await withMailbox(app, D, (s) => s.mailboxStatus.get())).toBeNull();
    const first = await withMailbox(app, D, (s) => s.mailboxStatus.upsert({ state: 'ok' }));
    expect(first.mailboxId).toBe(D);
    const second = await withMailbox(app, D, (s) => s.mailboxStatus.upsert({ state: 'error' }));
    expect(second.state).toBe('error');
    expect(await statusRows()).toBe(1);
  });

  it('recordSyncError stores a redacted, truncated last_error', async () => {
    const at = new Date('2026-10-04T08:00:00.000Z');
    await withMailbox(app, D, (s) =>
      recordSyncError(s, new Error('IMAP login failed with s3cret'), ['s3cret'], at),
    );
    const status = await withMailbox(app, D, (s) => s.mailboxStatus.get());
    expect(status?.state).toBe('error');
    expect(status?.lastError).toContain('[REDACTED]');
    expect(status?.lastError).not.toContain('s3cret');
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());

    await withMailbox(app, D, (s) => recordSyncError(s, `${'x'.repeat(2000)} s3cret`, ['s3cret']));
    const long = await withMailbox(app, D, (s) => s.mailboxStatus.get());
    expect(long?.lastError).toHaveLength(1000);
    expect(await statusRows()).toBe(1);
  });

  it('recordSyncSuccess resets state and last_error', async () => {
    const at = new Date('2026-10-04T09:00:00.000Z');
    await withMailbox(app, D, (s) => recordSyncSuccess(s, at));
    const status = await withMailbox(app, D, (s) => s.mailboxStatus.get());
    expect(status?.state).toBe('ok');
    expect(status?.lastError).toBeNull();
    expect(status?.lastSyncAt?.toISOString()).toBe(at.toISOString());
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
  });

  it('recordMailboxSeen and recordDisabled update their columns only', async () => {
    const at = new Date('2026-10-04T10:00:00.000Z');
    await withMailbox(app, D, (s) => recordMailboxSeen(s, at));
    let status = await withMailbox(app, D, (s) => s.mailboxStatus.get());
    expect(status?.lastSeenAt?.toISOString()).toBe(at.toISOString());
    expect(status?.lastSyncAt?.toISOString()).toBe('2026-10-04T09:00:00.000Z');
    expect(status?.state).toBe('ok');

    await withMailbox(app, D, (s) => recordDisabled(s));
    status = await withMailbox(app, D, (s) => s.mailboxStatus.get());
    expect(status?.state).toBe('disabled');
    expect(await statusRows()).toBe(1);
  });
});

describe('readRegistry', () => {
  it('returns every mailbox row ordered by slug as sift_app, disabled ones included', async () => {
    const app = createAppDb(fresh.appUrl);
    try {
      const rows = await readRegistry(app);
      expect(rows.map((r) => r.slug)).toEqual(['scope-a', 'scope-b', 'scope-c', 'scope-d']);
      expect(rows.find((r) => r.id === C)?.disabledAt).toBeInstanceOf(Date);
      expect(rows.find((r) => r.id === A)?.disabledAt).toBeNull();
    } finally {
      await app.close();
    }
  });
});

describe('ingest columns and constraint edges (D-12, D-15, D-18, D-23..D-26, D-34, D-75)', () => {
  /**
   * Run one statement as sift_owner under app.mailbox_id = A (the owner is
   * subject to FORCE RLS) and always roll it back, so cases never interfere.
   */
  async function ownerAttempt(sql: string, params: unknown[] = []): Promise<number | null> {
    const owner = await connect(fresh.ownerUrl);
    try {
      await owner.query('begin');
      await owner.query("select set_config('app.mailbox_id', $1, true)", [A]);
      return (await owner.query(sql, params)).rowCount;
    } finally {
      await owner.query('rollback').catch(() => {});
      await owner.end();
    }
  }

  const CHECK_VIOLATION = { code: '23514' };

  const insertLocation = (removedAt: string, removedReason: string) =>
    ownerAttempt(
      `insert into message_location
         (mailbox_id, message_id, folder, uidvalidity, uid, generation, removed_at, removed_reason)
       values ($1, $2, 'INBOX', 99, 99, 1, ${removedAt}, ${removedReason})`,
      [A, seededA.messageId],
    );

  const insertFolderSync = (extraColumns: string, extraValues: string) =>
    ownerAttempt(
      `insert into folder_sync
         (mailbox_id, folder, uidvalidity, last_uid, internal_date_watermark${extraColumns})
       values ($1, 'edge-' || gen_random_uuid(), 1, 0, now()${extraValues})`,
      [A],
    );

  const insertMessage = (identityKeySql: string) =>
    ownerAttempt(
      `insert into message (mailbox_id, identity_key, internal_date, eligible_for_classification)
       values ($1, ${identityKeySql}, now(), true)`,
      [A],
    );

  const updateStatus = (set: string) =>
    ownerAttempt(`update mailbox_status set ${set} where mailbox_id = $1`, [A]);

  it('round-trips UID and UIDVALIDITY 4294967295 through bigint columns as numbers (SPK-04)', async () => {
    const app = createAppDb(fresh.appUrl);
    try {
      const { location, sync } = await withMailbox(app, A, async (s) => {
        const [msg] = await s.message.insert([newMessage()]);
        const [inserted] = await s.messageLocation.insert([
          {
            messageId: msg?.id as string,
            folder: 'INBOX',
            uidvalidity: MAX_U32,
            uid: MAX_U32,
            generation: 1,
          },
        ]);
        const [folder] = await s.folderSync.insert([
          { ...newFolderSync(), uidvalidity: MAX_U32, lastUid: MAX_U32 },
        ]);
        return {
          location: await s.messageLocation.find({ id: inserted?.id as string }),
          sync: await s.folderSync.find({ id: folder?.id as string }),
        };
      });
      expect(location).toHaveLength(1);
      expect(location[0]?.uid).toBe(MAX_U32);
      expect(location[0]?.uidvalidity).toBe(MAX_U32);
      expect(typeof location[0]?.uid).toBe('number');
      expect(sync[0]?.uidvalidity).toBe(MAX_U32);
      expect(sync[0]?.lastUid).toBe(MAX_U32);
      expect(
        await adminCount(
          "select count(*)::int as n from message_location where id = $1 and uid::text = '4294967295'",
          [location[0]?.id],
        ),
      ).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('rejects removed_at without removed_reason, and the reverse (D-17)', async () => {
    await expect(insertLocation('now()', 'null')).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(insertLocation('null', "'vanished'")).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it("rejects removed_reason 'deleted' and accepts vanished and superseded (D-17, D-23)", async () => {
    await expect(insertLocation('now()', "'deleted'")).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(insertLocation('now()', "'vanished'")).resolves.toBe(1);
    await expect(insertLocation('now()', "'superseded'")).resolves.toBe(1);
    await expect(insertLocation('null', 'null')).resolves.toBe(1);
  });

  it("rejects folder_sync state 'resyncing' without both pending columns, and pending with 'ok' (D-24)", async () => {
    await expect(insertFolderSync(', state', ", 'resyncing'")).rejects.toMatchObject(
      CHECK_VIOLATION,
    );
    await expect(
      insertFolderSync(', state, pending_uidvalidity', ", 'resyncing', 5"),
    ).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(
      insertFolderSync(', state, pending_uidvalidity, pending_generation', ", 'ok', 5, 2"),
    ).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(
      insertFolderSync(', state, pending_uidvalidity, pending_generation', ", 'resyncing', 5, 2"),
    ).resolves.toBe(1);
    await expect(insertFolderSync(', state', ", 'paused'")).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it('rejects a partial first-backfill cursor on folder_sync (D-75)', async () => {
    await expect(insertFolderSync(', backfill_since', ', now()')).rejects.toMatchObject(
      CHECK_VIOLATION,
    );
    await expect(
      insertFolderSync(
        ', backfill_since, backfill_until_uid, backfill_total',
        ", now() - interval '30 days', 500, 120",
      ),
    ).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(
      insertFolderSync(
        ', backfill_since, backfill_cursor_uid, backfill_until_uid, backfill_total',
        ", now() - interval '30 days', 0, 500, 120",
      ),
    ).resolves.toBe(1);
  });

  it("rejects mailbox_status 'needs_attention' without held_new_count and backfill_done alone (D-26, D-75)", async () => {
    await expect(updateStatus("state = 'needs_attention'")).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(updateStatus('backfill_done = 10')).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(updateStatus('backfill_total = 10')).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(updateStatus("state = 'paused'")).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it("accepts mailbox_status 'connecting', 'needs_attention' with held_new_count 250 and backfill progress (D-34, D-26, D-75)", async () => {
    await expect(updateStatus("state = 'connecting'")).resolves.toBe(1);
    await expect(updateStatus("state = 'needs_attention', held_new_count = 250")).resolves.toBe(1);
    await expect(updateStatus('backfill_done = 10, backfill_total = 120')).resolves.toBe(1);
  });

  it('rejects identity keys outside pm:, mid: and versioned hdr:v<n>:<64 hex> (D-12, D-82)', async () => {
    await expect(insertMessage("'x:1'")).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(insertMessage("'hdr:' || repeat('a', 64)")).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(insertMessage("'hdr:v1:xyz'")).rejects.toMatchObject(CHECK_VIOLATION);
    await expect(insertMessage("'hdr:v1:' || repeat('A', 64)")).rejects.toMatchObject(
      CHECK_VIOLATION,
    );
    await expect(insertMessage("'pm:'")).rejects.toMatchObject(CHECK_VIOLATION);
  });

  it('accepts pm:, mid: and hdr:v1: identity keys', async () => {
    await expect(insertMessage("'hdr:v1:' || repeat('a', 64)")).resolves.toBe(1);
    await expect(insertMessage("'pm:' || gen_random_uuid()")).resolves.toBe(1);
    await expect(insertMessage("'mid:<' || gen_random_uuid() || '@x.test>'")).resolves.toBe(1);
  });

  it('rejects a second message with the same identity key in one mailbox (D-12)', async () => {
    await expect(
      ownerAttempt(
        `insert into message (mailbox_id, identity_key, internal_date, eligible_for_classification)
         values ($1, 'mid:dup@x.test', now(), true), ($1, 'mid:dup@x.test', now(), true)`,
        [A],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a message_body source other than text_plain, text_html or none (D-06)', async () => {
    const owner = await connect(fresh.ownerUrl);
    try {
      await owner.query('begin');
      await owner.query("select set_config('app.mailbox_id', $1, true)", [A]);
      const { rows } = await owner.query<{ id: string }>(
        `insert into message (mailbox_id, identity_key, internal_date, eligible_for_classification)
         values ($1, 'mid:body-edge@x.test', now(), true) returning id`,
        [A],
      );
      await expect(
        owner.query(
          `insert into message_body (mailbox_id, message_id, body_text, source, truncated)
           values ($1, $2, '', 'markdown', false)`,
          [A, rows[0]?.id],
        ),
      ).rejects.toMatchObject(CHECK_VIOLATION);
    } finally {
      await owner.query('rollback').catch(() => {});
      await owner.end();
    }
  });
});

describe('@sift/db export surface', () => {
  it('exports exactly the scoped API and nothing that yields a pool, client or orm', () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        'InvalidMailboxIdError',
        'MailboxDisabledError',
        'MailboxNotFoundError',
        'ScopeClosedError',
        'createAppDb',
        'readRegistry',
        'recordDisabled',
        'recordMailboxSeen',
        'recordSyncError',
        'recordSyncSuccess',
        'requireActive',
        'requireDatabaseUrl',
        'advanceFolderSync',
        'beginResync',
        'createFolderSync',
        'deleteExpiredBodies',
        'deleteOrphanBodies',
        'finishResync',
        'getFolderSync',
        'knownIdentityKeys',
        'liveLocations',
        'markLocationsRemoved',
        'setFolderBackfill',
        'storeMessages',
        'withMailbox',
      ].sort(),
    );
  });
});
