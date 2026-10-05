import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type AppDb,
  type BodyInput,
  createAppDb,
  type StoreItem,
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
