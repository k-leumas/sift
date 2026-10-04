import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppDb, createAppDb, withMailbox } from '../src/index.ts';
import { freshDatabase, type TestDatabase } from './support/db.ts';
import { seedMailboxes } from './support/seed.ts';

/**
 * The scoped API (ISO-04, D-42..D-45): the only data-access surface app code
 * gets. RLS is the backstop; these helpers are the first line.
 */

let fresh: TestDatabase;
let A: string;
let B: string;

beforeAll(async () => {
  fresh = await freshDatabase();
  const ids = await seedMailboxes(fresh.ownerUrl, ['scope-a', 'scope-b']);
  A = ids['scope-a'] as string;
  B = ids['scope-b'] as string;
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
    const inserted = await withMailbox(app, A, (s) => s.message.insert([{}]));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.mailboxId).toBe(A);

    const underA = await withMailbox(app, A, (s) => s.message.find());
    expect(underA).toEqual(inserted);

    const underB = await withMailbox(app, B, (s) => s.message.find());
    expect(underB).toEqual([]);
  });
});
