import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppDb,
  advanceFolderSync,
  type BackfillCursor,
  type BodyInput,
  beginResync,
  createAppDb,
  createFolderSync,
  deleteExpiredBodies,
  deleteOrphanBodies,
  finishResync,
  getFolderSync,
  knownIdentityKeys,
  liveLocations,
  markLocationsRemoved,
  type Scope,
  type StoreItem,
  setFolderBackfill,
  storeMessages,
  withMailbox,
} from '../src/index.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { seedMailboxes } from './support/seed.ts';

/**
 * Ingest use-cases (ING-02, ING-04, D-14, D-15, D-07, D-17, D-21..D-25) on a
 * real database, through createAppDb + withMailbox as sift_app.
 */

let fresh: TestDatabase;
let app: AppDb;

beforeAll(async () => {
  fresh = await freshDatabase();
  app = createAppDb(fresh.appUrl);
});

afterAll(async () => {
  await app?.close();
  await fresh?.drop();
});

/** A fresh mailbox per test, so row counts are exact. */
async function newMailbox(): Promise<string> {
  const slug = `ingest-${randomUUID().slice(0, 8)}`;
  return (await seedMailboxes(fresh.ownerUrl, [slug]))[slug] as string;
}

/** Ground truth, read as the superuser (bypasses RLS). */
async function adminQuery<R extends object>(sql: string, params: unknown[]): Promise<R[]> {
  const admin = await connect(fresh.adminUrl);
  try {
    return (await admin.query<R>(sql, params)).rows;
  } finally {
    await admin.end();
  }
}

async function counts(mailboxId: string) {
  const [row] = await adminQuery<{ messages: number; locations: number; bodies: number }>(
    `select (select count(*)::int from message where mailbox_id = $1) as messages,
            (select count(*)::int from message_location where mailbox_id = $1) as locations,
            (select count(*)::int from message_body where mailbox_id = $1) as bodies`,
    [mailboxId],
  );
  return row;
}

const key = (name: string) => `mid:${name}-${randomUUID()}@ingest.test`;

const textBody = (text: string): BodyInput => ({
  bodyText: text,
  source: 'text_plain',
  truncated: false,
});

let nextUid = 1;

/** One fetched UID. Defaults: eligible, INBOX, UIDVALIDITY 7, generation 1, a text body. */
function item(
  identityKey: string,
  overrides: {
    uid?: number;
    folder?: string;
    uidvalidity?: number;
    generation?: number;
    eligible?: boolean;
    body?: BodyInput | null;
    subject?: string;
  } = {},
): StoreItem {
  return {
    message: {
      identityKey,
      messageIdHeader: identityKey.slice('mid:'.length),
      internalDate: new Date('2026-10-01T12:00:00Z'),
      sentAt: new Date('2026-10-01T11:59:00Z'),
      fromAddress: 'sender@example.test',
      fromDomain: 'example.test',
      subject: overrides.subject ?? 'Hello',
      headers: { 'list-id': ['<news.example.test>'] },
      attachments: [],
      sizeBytes: 1234,
      eligibleForClassification: overrides.eligible ?? true,
    },
    location: {
      folder: overrides.folder ?? 'INBOX',
      uidvalidity: overrides.uidvalidity ?? 7,
      uid: overrides.uid ?? nextUid++,
      generation: overrides.generation ?? 1,
    },
    body: overrides.body === undefined ? textBody(`body of ${identityKey}`) : overrides.body,
  };
}

describe('storeMessages (ING-02, D-14)', () => {
  it('writes the message, its location and its body for each eligible item', async () => {
    const mailboxId = await newMailbox();
    const items = [item(key('a')), item(key('b'))];

    const result = await withMailbox(app, mailboxId, (s) => storeMessages(s, items));

    expect(result).toEqual({
      insertedMessages: 2,
      existingMessages: 0,
      promotedMessages: 0,
      insertedLocations: 2,
      insertedBodies: 2,
    });
    expect(await counts(mailboxId)).toEqual({ messages: 2, locations: 2, bodies: 2 });
  });

  it('is idempotent: a rerun inserts nothing and keeps every message updated_at', async () => {
    const mailboxId = await newMailbox();
    const items = [item(key('a')), item(key('b'))];
    await withMailbox(app, mailboxId, (s) => storeMessages(s, items));
    const before = await adminQuery<{ id: string; updated_at: Date }>(
      'select id, updated_at from message where mailbox_id = $1 order by id',
      [mailboxId],
    );

    const result = await withMailbox(app, mailboxId, (s) => storeMessages(s, items));

    expect(result).toEqual({
      insertedMessages: 0,
      existingMessages: 2,
      promotedMessages: 0,
      insertedLocations: 0,
      insertedBodies: 0,
    });
    expect(await counts(mailboxId)).toEqual({ messages: 2, locations: 2, bodies: 2 });
    expect(
      await adminQuery('select id, updated_at from message where mailbox_id = $1 order by id', [
        mailboxId,
      ]),
    ).toEqual(before);
  });

  it('merges two UIDs of one identity key in one call into one message with two locations', async () => {
    const mailboxId = await newMailbox();
    const shared = key('shared');

    const result = await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(shared, { uid: 101 }), item(shared, { uid: 102 })]),
    );

    expect(result).toMatchObject({
      insertedMessages: 1,
      insertedLocations: 2,
      insertedBodies: 1,
    });
    expect(await counts(mailboxId)).toEqual({ messages: 1, locations: 2, bodies: 1 });
    const locations = await adminQuery<{ uid: number; message_id: string; identity_key: string }>(
      `select l.uid::int as uid, l.message_id, m.identity_key
         from message_location l join message m on m.id = l.message_id
        where l.mailbox_id = $1 order by l.uid`,
      [mailboxId],
    );
    expect(locations.map((l) => [l.uid, l.identity_key])).toEqual([
      [101, shared],
      [102, shared],
    ]);
  });
});

/** message_location rows of a mailbox with their message's identity key, by uid. */
async function locationRows(mailboxId: string) {
  return adminQuery<{
    id: string;
    uid: number;
    uidvalidity: number;
    generation: number;
    message_id: string;
    identity_key: string;
    removed_at: Date | null;
    removed_reason: string | null;
  }>(
    `select l.id, l.uid::int as uid, l.uidvalidity::int as uidvalidity, l.generation,
            l.message_id, m.identity_key, l.removed_at, l.removed_reason
       from message_location l join message m on m.id = l.message_id
      where l.mailbox_id = $1 order by l.uidvalidity, l.uid`,
    [mailboxId],
  );
}

async function bodyKeys(mailboxId: string): Promise<string[]> {
  const rows = await adminQuery<{ identity_key: string }>(
    `select m.identity_key from message_body b join message m on m.id = b.message_id
      where b.mailbox_id = $1 order by m.identity_key`,
    [mailboxId],
  );
  return rows.map((r) => r.identity_key);
}

/** Message ids by identity key, through the scoped API. */
async function idsByKey(scope: Scope, keys: readonly string[]): Promise<Map<string, string>> {
  const known = await knownIdentityKeys(scope, keys);
  return new Map([...known].map(([k, v]) => [k, v.id]));
}

describe('storeMessages edges (D-14, D-15, D-21, Pitfall 7)', () => {
  it('attaches every location to the message of its own identity key, whatever the order', async () => {
    const mailboxId = await newMailbox();
    const [k1, k2, k3, k4] = [key('k1'), key('k2'), key('k3'), key('k4')];
    await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(k1, { uid: 1 }), item(k2, { uid: 2 })]),
    );

    const result = await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [
        item(k3, { uid: 30 }),
        item(k1, { uid: 10 }),
        item(k4, { uid: 40 }),
        item(k2, { uid: 20 }),
        item(k3, { uid: 31 }),
      ]),
    );

    expect(result).toMatchObject({
      insertedMessages: 2,
      existingMessages: 2,
      insertedLocations: 5,
    });
    const rows = await locationRows(mailboxId);
    expect(rows.map((r) => [r.uid, r.identity_key])).toEqual([
      [1, k1],
      [2, k2],
      [10, k1],
      [20, k2],
      [30, k3],
      [31, k3],
      [40, k4],
    ]);
    const ids = await withMailbox(app, mailboxId, (s) => idsByKey(s, [k1, k2, k3, k4]));
    for (const row of rows) expect(row.message_id).toBe(ids.get(row.identity_key));
  });

  it('stores the same (folder, uidvalidity, uid) twice in one call as one location', async () => {
    const mailboxId = await newMailbox();
    const k = key('dup');
    await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(k, { uid: 5 }), item(k, { uid: 5 })]),
    );
    expect(await counts(mailboxId)).toEqual({ messages: 1, locations: 1, bodies: 1 });
  });

  it('makes a vanished location live again with the new generation when it is seen again', async () => {
    const mailboxId = await newMailbox();
    const k = key('back');
    await withMailbox(app, mailboxId, (s) => storeMessages(s, [item(k, { uid: 9 })]));
    const [location] = await locationRows(mailboxId);
    await withMailbox(app, mailboxId, (s) =>
      markLocationsRemoved(s, [location?.id as string], 'vanished'),
    );

    await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(k, { uid: 9, generation: 2 })]),
    );

    expect(await locationRows(mailboxId)).toMatchObject([
      { id: location?.id, generation: 2, removed_at: null, removed_reason: null },
    ]);
  });

  it('stores an eligible message without a text part with one body row of empty text', async () => {
    const mailboxId = await newMailbox();
    const k = key('empty');
    await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(k, { body: { bodyText: '', source: 'none', truncated: false } })]),
    );
    expect(
      await adminQuery('select body_text, source from message_body where mailbox_id = $1', [
        mailboxId,
      ]),
    ).toEqual([{ body_text: '', source: 'none' }]);
  });

  it('gives a historical message a row and a location but no body (D-21)', async () => {
    const mailboxId = await newMailbox();
    const result = await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(key('old'), { eligible: false })]),
    );
    expect(result).toMatchObject({ insertedMessages: 1, insertedLocations: 1, insertedBodies: 0 });
    expect(await counts(mailboxId)).toEqual({ messages: 1, locations: 1, bodies: 0 });
  });

  it('keeps a stored historical message historical when it is seen again as eligible', async () => {
    const mailboxId = await newMailbox();
    const k = key('old');
    await withMailbox(app, mailboxId, (s) => storeMessages(s, [item(k, { eligible: false })]));

    const result = await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(k, { eligible: true })]),
    );

    expect(result).toMatchObject({ existingMessages: 1, promotedMessages: 0, insertedBodies: 0 });
    const known = await withMailbox(app, mailboxId, (s) => knownIdentityKeys(s, [k]));
    expect(known.get(k)?.eligible).toBe(false);
    expect(await bodyKeys(mailboxId)).toEqual([]);
  });

  it('promotes a stored historical message and stores its body with promoteEligible (D-02)', async () => {
    const mailboxId = await newMailbox();
    const k = key('old');
    await withMailbox(app, mailboxId, (s) => storeMessages(s, [item(k, { eligible: false })]));

    const result = await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(k, { eligible: true })], { promoteEligible: true }),
    );

    expect(result).toMatchObject({ existingMessages: 1, promotedMessages: 1, insertedBodies: 1 });
    const known = await withMailbox(app, mailboxId, (s) => knownIdentityKeys(s, [k]));
    expect(known.get(k)?.eligible).toBe(true);
    expect(await bodyKeys(mailboxId)).toEqual([k]);
  });

  it('strips NUL from the subject, header values and attachment names (Pitfall 7)', async () => {
    const mailboxId = await newMailbox();
    const nul = item(key('nul'), { subject: 'Hel\u0000lo' });
    nul.message.headers = { 'x-te\u0000st': ['a\u0000b'] };
    nul.message.attachments = [{ name: 'f\u0000.pdf', mimeType: 'application/pdf', sizeBytes: 1 }];
    nul.body = textBody('bo\u0000dy');

    await withMailbox(app, mailboxId, (s) => storeMessages(s, [nul]));

    const [row] = await adminQuery<{ subject: string; headers: unknown; attachments: unknown }>(
      'select subject, headers, attachments from message where mailbox_id = $1',
      [mailboxId],
    );
    expect(row).toEqual({
      subject: 'Hello',
      headers: { 'x-test': ['ab'] },
      attachments: [{ name: 'f.pdf', mimeType: 'application/pdf', sizeBytes: 1 }],
    });
    expect(
      await adminQuery('select body_text from message_body where mailbox_id = $1', [mailboxId]),
    ).toEqual([{ body_text: 'body' }]);
  });
});

describe('scoped conflict helpers', () => {
  it('refuses an upsert whose rows repeat a conflict key, before any SQL', async () => {
    const mailboxId = await newMailbox();
    const row = {
      messageId: randomUUID(),
      folder: 'INBOX',
      uidvalidity: 7,
      uid: 1,
      generation: 1,
    };
    await withMailbox(app, mailboxId, async (s) => {
      await expect(
        s.messageLocation.upsert([row, { ...row, generation: 2 }], {
          target: ['folder', 'uidvalidity', 'uid'],
          update: ['generation'],
        }),
      ).rejects.toThrow(new TypeError('upsert rows repeat a conflict key'));
      // A statement that reached PostgreSQL and failed would abort the
      // transaction (25P02); the scope still works, so none was sent.
      expect(await s.message.find()).toEqual([]);
    });
  });

  it('refuses an upsert with an empty update list', async () => {
    const mailboxId = await newMailbox();
    await withMailbox(app, mailboxId, async (s) => {
      await expect(s.message.upsert([], { target: ['identityKey'], update: [] })).rejects.toThrow(
        TypeError,
      );
    });
  });

  it('refuses mailboxId or id in conflict rows, targets and update lists', async () => {
    const mailboxId = await newMailbox();
    await withMailbox(app, mailboxId, async (s) => {
      const row = item(key('x')).message;
      await expect(
        // @ts-expect-error id is filled by the database
        s.message.insertOrIgnore([{ ...row, id: randomUUID() }], { target: ['identityKey'] }),
      ).rejects.toThrow(TypeError);
      await expect(
        // @ts-expect-error mailbox_id is prepended by the helper
        s.message.insertOrIgnore([row], { target: ['mailboxId'] }),
      ).rejects.toThrow(TypeError);
      await expect(
        // @ts-expect-error id is never an update column
        s.message.upsert([row], { target: ['identityKey'], update: ['id'] }),
      ).rejects.toThrow(TypeError);
    });
  });

  it('keeps insertOrIgnore and upsert off the append-only tables (D-40)', async () => {
    const mailboxId = await newMailbox();
    await withMailbox(app, mailboxId, async (s) => {
      for (const table of [s.decision, s.labelEvent]) {
        expect(Object.keys(table).sort()).toEqual(['find', 'insert']);
        expect('insertOrIgnore' in table).toBe(false);
        expect('upsert' in table).toBe(false);
      }
    });
  });

  it('matches nothing and runs no SQL for an empty array value', async () => {
    const mailboxId = await newMailbox();
    await withMailbox(app, mailboxId, (s) => storeMessages(s, [item(key('m'))]));
    await withMailbox(app, mailboxId, async (s) => {
      expect(await s.message.find({ id: [] })).toEqual([]);
      expect(await s.message.update({ subject: 'x' }, { id: [] })).toEqual([]);
      expect(await s.messageBody.delete({ messageId: [] })).toEqual([]);
    });
    expect(await counts(mailboxId)).toEqual({ messages: 1, locations: 1, bodies: 1 });
  });
});

describe('folder sync state (D-18, D-75)', () => {
  const cursor = (cursorUid: number): BackfillCursor => ({
    since: new Date('2026-09-01T00:00:00Z'),
    cursorUid,
    untilUid: 500,
    total: 120,
  });

  it('returns null before createFolderSync and the row after', async () => {
    const mailboxId = await newMailbox();
    await withMailbox(app, mailboxId, async (s) => {
      expect(await getFolderSync(s, 'INBOX')).toBeNull();
      const created = await createFolderSync(s, {
        folder: 'INBOX',
        uidvalidity: 7,
        lastUid: 10,
        internalDateWatermark: new Date('2026-10-01T00:00:00Z'),
        backfill: null,
      });
      expect(await getFolderSync(s, 'INBOX')).toEqual(created);
      expect(created).toMatchObject({ uidvalidity: 7, lastUid: 10, generation: 1, state: 'ok' });
    });
  });

  it('never moves last_uid, the watermark or the backfill cursor backwards', async () => {
    const mailboxId = await newMailbox();
    const t1 = new Date('2026-10-01T00:00:00Z');
    const t2 = new Date('2026-10-02T00:00:00Z');
    const row = await withMailbox(app, mailboxId, async (s) => {
      await createFolderSync(s, {
        folder: 'INBOX',
        uidvalidity: 7,
        lastUid: 10,
        internalDateWatermark: t1,
        backfill: cursor(100),
      });
      await advanceFolderSync(s, 'INBOX', {
        lastUid: 20,
        internalDateWatermark: t2,
        backfillCursorUid: 150,
      });
      await advanceFolderSync(s, 'INBOX', {
        lastUid: 15,
        internalDateWatermark: t1,
        backfillCursorUid: 120,
      });
      return getFolderSync(s, 'INBOX');
    });
    expect(row).toMatchObject({ lastUid: 20, internalDateWatermark: t2, backfillCursorUid: 150 });
  });

  it('moves only the backfill cursor when that is all it is given', async () => {
    const mailboxId = await newMailbox();
    const t1 = new Date('2026-10-01T00:00:00Z');
    const row = await withMailbox(app, mailboxId, async (s) => {
      await createFolderSync(s, {
        folder: 'INBOX',
        uidvalidity: 7,
        lastUid: 10,
        internalDateWatermark: t1,
        backfill: cursor(100),
      });
      await advanceFolderSync(s, 'INBOX', { backfillCursorUid: 130 });
      return getFolderSync(s, 'INBOX');
    });
    expect(row).toMatchObject({ lastUid: 10, internalDateWatermark: t1, backfillCursorUid: 130 });
  });

  it('writes, clears and replaces all four backfill columns together', async () => {
    const mailboxId = await newMailbox();
    const backfillOf = (r: Awaited<ReturnType<typeof getFolderSync>>) => ({
      since: r?.backfillSince,
      cursorUid: r?.backfillCursorUid,
      untilUid: r?.backfillUntilUid,
      total: r?.backfillTotal,
    });
    await withMailbox(app, mailboxId, async (s) => {
      const created = await createFolderSync(s, {
        folder: 'INBOX',
        uidvalidity: 7,
        lastUid: 0,
        internalDateWatermark: new Date(),
        backfill: cursor(100),
      });
      expect(backfillOf(created)).toEqual(cursor(100));

      await setFolderBackfill(s, 'INBOX', null);
      expect(backfillOf(await getFolderSync(s, 'INBOX'))).toEqual({
        since: null,
        cursorUid: null,
        untilUid: null,
        total: null,
      });

      const next = {
        since: new Date('2026-09-15T00:00:00Z'),
        cursorUid: 3,
        untilUid: 90,
        total: 40,
      };
      await setFolderBackfill(s, 'INBOX', next);
      expect(backfillOf(await getFolderSync(s, 'INBOX'))).toEqual(next);
    });
  });
});

describe('removals and the body cache (D-07, D-17)', () => {
  it('marks locations removed and drops them from liveLocations', async () => {
    const mailboxId = await newMailbox();
    const [ka, kb] = [key('a'), key('b')];
    await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [item(ka, { uid: 1 }), item(kb, { uid: 2 })]),
    );
    const at = new Date('2026-10-03T00:00:00Z');
    const live = await withMailbox(app, mailboxId, (s) => liveLocations(s, 'INBOX'));
    expect(live.map((l) => l.uid).sort()).toEqual([1, 2]);
    const first = live.find((l) => l.uid === 1);

    const marked = await withMailbox(app, mailboxId, (s) =>
      markLocationsRemoved(s, [first?.id as string], 'vanished', at),
    );

    expect(marked).toBe(1);
    expect((await locationRows(mailboxId)).find((r) => r.uid === 1)).toMatchObject({
      removed_at: at,
      removed_reason: 'vanished',
    });
    const after = await withMailbox(app, mailboxId, (s) => liveLocations(s, 'INBOX'));
    expect(after.map((l) => l.uid)).toEqual([2]);
    expect(after[0]).toEqual({
      id: expect.any(String),
      uid: 2,
      uidvalidity: 7,
      generation: 1,
      messageId: (await withMailbox(app, mailboxId, (s) => idsByKey(s, [kb]))).get(kb),
    });
  });

  it('deletes a body only when its message has no live location and no decision', async () => {
    const mailboxId = await newMailbox();
    const [stillLive, decided, orphan] = [key('live'), key('decided'), key('orphan')];
    await withMailbox(app, mailboxId, (s) =>
      storeMessages(s, [
        item(stillLive, { uid: 1 }),
        item(stillLive, { uid: 1, folder: 'Archive' }),
        item(decided, { uid: 2 }),
        item(orphan, { uid: 3 }),
      ]),
    );

    const deleted = await withMailbox(app, mailboxId, async (s) => {
      const ids = await idsByKey(s, [stillLive, decided, orphan]);
      await s.decision.insert([{ messageId: ids.get(decided) as string }]);
      const inbox = await liveLocations(s, 'INBOX');
      await markLocationsRemoved(
        s,
        inbox.map((l) => l.id),
        'vanished',
      );
      return deleteOrphanBodies(s, [...ids.values()]);
    });

    expect(deleted).toBe(1);
    expect(await bodyKeys(mailboxId)).toEqual([decided, stillLive].sort());
  });

  it('deletes only expired bodies, and none of another mailbox', async () => {
    const [mine, other] = [await newMailbox(), await newMailbox()];
    const now = new Date('2026-10-05T12:00:00Z');
    const past = new Date('2026-10-05T11:00:00Z');
    const future = new Date('2026-10-12T12:00:00Z');
    const [expired, atNow, later, never] = [key('e'), key('n'), key('l'), key('x')];
    await withMailbox(app, mine, async (s) => {
      await storeMessages(s, [item(expired), item(atNow), item(later), item(never)]);
      const ids = await idsByKey(s, [expired, atNow, later]);
      await s.messageBody.update({ expiresAt: past }, { messageId: ids.get(expired) as string });
      await s.messageBody.update({ expiresAt: now }, { messageId: ids.get(atNow) as string });
      await s.messageBody.update({ expiresAt: future }, { messageId: ids.get(later) as string });
    });
    const otherKey = key('other');
    await withMailbox(app, other, async (s) => {
      await storeMessages(s, [item(otherKey)]);
      await s.messageBody.update({ expiresAt: past });
    });

    const deleted = await withMailbox(app, mine, (s) => deleteExpiredBodies(s, now));

    expect(deleted).toBe(2);
    expect(await bodyKeys(mine)).toEqual([later, never].sort());
    expect(await bodyKeys(other)).toEqual([otherKey]);
  });
});

describe('generation resync (ING-04, D-23..D-25)', () => {
  /** Folder at UIDVALIDITY 7 / generation 1 with three eligible messages. */
  async function resyncFixture(backfill: BackfillCursor | null = null) {
    const mailboxId = await newMailbox();
    const [kept, gone1, gone2, fresh2] = [key('kept'), key('gone1'), key('gone2'), key('new')];
    await withMailbox(app, mailboxId, async (s) => {
      await createFolderSync(s, {
        folder: 'INBOX',
        uidvalidity: 7,
        lastUid: 3,
        internalDateWatermark: new Date('2026-10-01T00:00:00Z'),
        backfill,
      });
      await storeMessages(s, [
        item(kept, { uid: 1 }),
        item(gone1, { uid: 2 }),
        item(gone2, { uid: 3 }),
      ]);
    });
    return { mailboxId, kept, gone1, gone2, fresh2 };
  }

  /** The rescan under UIDVALIDITY 9 finds `kept` again and one new message. */
  const rescan = (kept: string, fresh2: string) => [
    item(kept, { uidvalidity: 9, uid: 50, generation: 2 }),
    item(fresh2, { uidvalidity: 9, uid: 51, generation: 2 }),
  ];

  const done = (extra: object = {}) => ({
    uidvalidity: 9,
    generation: 2,
    lastUid: 51,
    internalDateWatermark: new Date('2026-10-04T00:00:00Z'),
    summary: { matched: 1, new: 1, older: 0 },
    at: new Date('2026-10-05T00:00:00Z'),
    ...extra,
  });

  it('beginResync marks the folder resyncing with both pending columns', async () => {
    const { mailboxId } = await resyncFixture();
    const row = await withMailbox(app, mailboxId, async (s) => {
      await beginResync(s, 'INBOX', { pendingUidvalidity: 9, pendingGeneration: 2 });
      return getFolderSync(s, 'INBOX');
    });
    expect(row).toMatchObject({
      state: 'resyncing',
      pendingUidvalidity: 9,
      pendingGeneration: 2,
      uidvalidity: 7,
      generation: 1,
    });
  });

  it('finishResync supersedes matched locations, vanishes the rest and settles folder_sync', async () => {
    const { mailboxId, kept, gone1, gone2, fresh2 } = await resyncFixture();
    await withMailbox(app, mailboxId, async (s) => {
      await beginResync(s, 'INBOX', { pendingUidvalidity: 9, pendingGeneration: 2 });
      await storeMessages(s, rescan(kept, fresh2));
    });

    const result = await withMailbox(app, mailboxId, (s) => finishResync(s, 'INBOX', done()));

    const summary = { matched: 1, new: 1, older: 0, gone: 2 };
    expect(result).toEqual({ superseded: 1, vanished: 2, summary });
    const rows = await locationRows(mailboxId);
    expect(rows.map((r) => [r.identity_key, r.uidvalidity, r.uid, r.removed_reason])).toEqual([
      [kept, 7, 1, 'superseded'],
      [gone1, 7, 2, 'vanished'],
      [gone2, 7, 3, 'vanished'],
      [kept, 9, 50, null],
      [fresh2, 9, 51, null],
    ]);
    expect(await bodyKeys(mailboxId)).toEqual([fresh2, kept].sort());
    const row = await withMailbox(app, mailboxId, (s) => getFolderSync(s, 'INBOX'));
    expect(row).toMatchObject({
      state: 'ok',
      pendingUidvalidity: null,
      pendingGeneration: null,
      uidvalidity: 9,
      generation: 2,
      lastUid: 51,
      internalDateWatermark: new Date('2026-10-04T00:00:00Z'),
      lastResyncAt: new Date('2026-10-05T00:00:00Z'),
      lastResyncSummary: summary,
    });
  });

  it('finishResync replaces, clears or keeps the backfill cursor in the same call (D-75)', async () => {
    const old = { since: new Date('2026-09-01T00:00:00Z'), cursorUid: 2, untilUid: 3, total: 3 };
    const next = { since: new Date('2026-09-05T00:00:00Z'), cursorUid: 50, untilUid: 51, total: 2 };
    const backfillAfter = async (backfill?: BackfillCursor | null) => {
      const { mailboxId, kept, fresh2 } = await resyncFixture(old);
      return withMailbox(app, mailboxId, async (s) => {
        await beginResync(s, 'INBOX', { pendingUidvalidity: 9, pendingGeneration: 2 });
        await storeMessages(s, rescan(kept, fresh2));
        await finishResync(s, 'INBOX', backfill === undefined ? done() : done({ backfill }));
        const r = await getFolderSync(s, 'INBOX');
        return {
          since: r?.backfillSince,
          cursorUid: r?.backfillCursorUid,
          untilUid: r?.backfillUntilUid,
          total: r?.backfillTotal,
        };
      });
    };

    expect(await backfillAfter(next)).toEqual(next);
    expect(await backfillAfter(null)).toEqual({
      since: null,
      cursorUid: null,
      untilUid: null,
      total: null,
    });
    expect(await backfillAfter(undefined)).toEqual(old);
  });

  it('finishResync settles a folder with more live locations than PostgreSQL bind parameters (CR-01)', async () => {
    // 70,000 > 65,535: an IN list with one parameter per id fails on every retry.
    const LIVE = 70_000;
    const mailboxId = await newMailbox();
    await withMailbox(app, mailboxId, (s) =>
      createFolderSync(s, {
        folder: 'INBOX',
        uidvalidity: 7,
        lastUid: LIVE,
        internalDateWatermark: new Date('2026-10-01T00:00:00Z'),
        backfill: null,
      }),
    );
    // Seeded as the superuser in one statement; the scoped API would need 1,400 chunks.
    await adminQuery(
      `with m as (
         insert into message (mailbox_id, identity_key, internal_date, eligible_for_classification)
         select $1, 'mid:big-' || n || '@ingest.test', '2026-09-01T00:00:00Z', false
           from generate_series(1, $2::int) n
         returning id, identity_key)
       insert into message_location (mailbox_id, message_id, folder, uidvalidity, uid, generation)
       select $1, m.id, 'INBOX', 7, substring(m.identity_key from 'big-([0-9]+)@')::bigint, 1
         from m`,
      [mailboxId, LIVE],
    );
    const kept = 'mid:big-1@ingest.test';

    const result = await withMailbox(app, mailboxId, async (s) => {
      await beginResync(s, 'INBOX', { pendingUidvalidity: 9, pendingGeneration: 2 });
      await storeMessages(s, [item(kept, { uidvalidity: 9, uid: 1, generation: 2, body: null })]);
      return finishResync(s, 'INBOX', {
        uidvalidity: 9,
        generation: 2,
        lastUid: 1,
        internalDateWatermark: new Date('2026-10-04T00:00:00Z'),
        summary: { matched: 1, new: 0, older: 0 },
      });
    });

    expect(result).toEqual({
      superseded: 1,
      vanished: LIVE - 1,
      summary: { matched: 1, new: 0, older: 0, gone: LIVE - 1 },
    });
    const [left] = await adminQuery<{ live: number; removed: number }>(
      `select count(*) filter (where removed_at is null)::int as live,
              count(*) filter (where removed_at is not null)::int as removed
         from message_location where mailbox_id = $1`,
      [mailboxId],
    );
    expect(left).toEqual({ live: 1, removed: LIVE });
    const row = await withMailbox(app, mailboxId, (s) => getFolderSync(s, 'INBOX'));
    expect(row).toMatchObject({ state: 'ok', uidvalidity: 9, generation: 2 });
  }, 120_000);
});
