// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppDb, createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import {
  type ClassifyOutcome,
  type ClassifyRuntime,
  classifyMailbox,
} from '../src/classify/run.ts';
import {
  BASIC_RULES,
  decisionsOf,
  expectReplayableDecision,
  seedPendingMessages,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import { FAKE_MODEL, type FakeOllama, startFakeOllama } from './support/fake-ollama.ts';
import { recordingLog } from './support/mailbox-harness.ts';

/**
 * The classification pass (03-08) against a real database as sift_app and
 * the scripted fake Ollama: exact rules decide without a request, the LLM
 * tier decides the rest within the per-pass cap, outages stay pending, one
 * bad message never stops the others, and every decision replays (E8).
 */

let db: TestDatabase;
let appDb: AppDb;
let dataDir: string;
const fakes: FakeOllama[] = [];

beforeAll(async () => {
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  dataDir = await mkdtemp(join(tmpdir(), 'sift-classify-run-'));
});

afterAll(async () => {
  for (const fake of fakes) await fake.close().catch(() => {});
  await appDb?.close();
  await db?.drop();
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
});

async function fakeOllama(
  options: Parameters<typeof startFakeOllama>[0] = {},
): Promise<FakeOllama> {
  const fake = await startFakeOllama(options);
  fakes.push(fake);
  return fake;
}

interface Box {
  id: string;
  slug: string;
}

/** A registered mailbox with its own slug and (unless told otherwise) BASIC_RULES. */
async function newMailbox(prefix: string, rules: string | null = BASIC_RULES): Promise<Box> {
  const slug = `${prefix}-${randomUUID().slice(0, 8)}`;
  const id = (await seedMailboxes(db.ownerUrl, [slug]))[slug] as string;
  if (rules !== null) await writeRules(dataDir, slug, rules);
  return { id, slug };
}

function pass(
  box: Box,
  runtime: ClassifyRuntime,
  options: { signal?: AbortSignal; log?: ReturnType<typeof recordingLog>; threshold?: number } = {},
): Promise<ClassifyOutcome> {
  return classifyMailbox({
    db: appDb,
    mailbox: box,
    model: FAKE_MODEL,
    threshold: options.threshold ?? 0.75,
    runtime,
    signal: options.signal ?? new AbortController().signal,
    log: options.log ?? recordingLog(),
  });
}

/** Chat requests whose fenced email is from `address`. */
function chatsFrom(fake: FakeOllama, address: string): number {
  return fake
    .chatBodies()
    .filter((body) => JSON.stringify(body.messages).includes(`from_address: ${address}`)).length;
}

describe('tracer: one pass over two pending messages', () => {
  it('decides one by an exact rule with no request and one by the LLM, both replayable', async () => {
    const box = await newMailbox('tracer');
    const fake = await fakeOllama();
    const runtime = testRuntime(fake, dataDir);
    const [bankId, newsId] = await seedPendingMessages(appDb, box.id, [
      {
        from: 'alerts@bank.example.test',
        fromName: 'Bank Alerts',
        subject: 'Your statement is ready',
        body: 'Log in to read your statement.',
        internalDate: '2026-10-01T10:00:00Z',
      },
      {
        from: 'news@letters.example.test',
        fromName: 'Weekly Letter',
        subject: 'This week in gardening',
        body: 'Ten tips for autumn bulbs.',
        internalDate: '2026-10-01T09:00:00Z',
        attachments: ['tips.pdf'],
      },
    ]);

    const outcome = await pass(box, runtime);
    expect(outcome).toEqual({
      kind: 'done',
      labelled: 2,
      review: 0,
      llmCalls: 1,
      examined: 2,
      failures: 0,
    });

    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions).toHaveLength(2);
    const bank = decisions.find((d) => d.messageId === bankId);
    const news = decisions.find((d) => d.messageId === newsId);
    expect(bank).toMatchObject({
      outcome: 'labelled',
      category: 'Important',
      tier: 'exact_rules',
      decidedBy: 'worker',
      promptVersionId: null,
    });
    expect(news).toMatchObject({ outcome: 'labelled', tier: 'llm', model: FAKE_MODEL });
    expect(chatsFrom(fake, 'alerts@bank.example.test')).toBe(0);
    expect(chatsFrom(fake, 'news@letters.example.test')).toBe(1);
    for (const decision of decisions) await expectReplayableDecision(db.adminUrl, decision, fake);

    const before = fake.requests().length;
    expect(await pass(box, runtime)).toMatchObject({ kind: 'done', labelled: 0, review: 0 });
    expect(await decisionsOf(db.adminUrl, box.id)).toHaveLength(2);
    expect(fake.requests()).toHaveLength(before);
  });
});
