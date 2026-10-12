// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDecisionSpans } from '@sift/core/classify';
import { type AppDb, createAppDb } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import { type ClassifyOutcome, classifyMailbox } from '../src/classify/run.ts';
import {
  BASIC_RULES,
  decisionsOf,
  expectReplayableDecision,
  pendingIdsOf,
  type SeedMessage,
  type StoredDecision,
  seedPendingMessages,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import {
  contentAnswer,
  FAKE_MODEL,
  type FakeOllama,
  type FakeResponse,
  okAnswer,
  startFakeOllama,
} from './support/fake-ollama.ts';
import { recordingLog } from './support/mailbox-harness.ts';

/**
 * WR-01 end to end: a model reason that holds a control character after
 * JSON.parse (NUL from a JSON escape, BEL, U+2028) cannot be stored, because
 * PostgreSQL jsonb rejects NUL (SQLSTATE 22P05). validateLlmOutput treats such
 * a reason as schema_mismatch: one retry, then a stored review invalid_output
 * decision, and the pass decides the other messages. Before the fix the
 * insert failed on every pass and the message stayed pending forever.
 *
 * WR-04 end to end: the same for a reason holding an unpaired UTF-16
 * surrogate (U+D800 or U+DC00 from a JSON escape without its partner), which
 * jsonb also rejects. validateLlmOutput fails it as schema_mismatch
 * 'reason: lone_surrogate'; five such messages in a row no longer make the
 * pass throw (ROADMAP SC5, CLS-06).
 */

let db: TestDatabase;
let appDb: AppDb;
let dataDir: string;
const fakes: FakeOllama[] = [];

beforeAll(async () => {
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  dataDir = await mkdtemp(join(tmpdir(), 'sift-classify-control-'));
});

afterAll(async () => {
  for (const fake of fakes) await fake.close().catch(() => {});
  await appDb?.close();
  await db?.drop();
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
});

interface Box {
  id: string;
  slug: string;
}

async function newMailbox(prefix: string): Promise<Box> {
  const slug = `${prefix}-${randomUUID().slice(0, 8)}`;
  const id = (await seedMailboxes(db.ownerUrl, [slug]))[slug] as string;
  await writeRules(dataDir, slug, BASIC_RULES);
  return { id, slug };
}

async function fakeOllama(chat: (request: unknown) => FakeResponse): Promise<FakeOllama> {
  const fake = await startFakeOllama({ chat });
  fakes.push(fake);
  return fake;
}

function pass(box: Box, fake: FakeOllama): Promise<ClassifyOutcome> {
  return classifyMailbox({
    db: appDb,
    mailbox: box,
    model: FAKE_MODEL,
    threshold: 0.75,
    runtime: testRuntime(fake, dataDir),
    signal: new AbortController().signal,
    log: recordingLog(),
  });
}

const minute = (n: number): Date => new Date(Date.UTC(2026, 9, 2, 8, 0) + n * 60_000);

/** A message the LLM tier gets (no exact rule matches it), with a findable subject. */
function llmMessage(name: string, internalDate: Date): SeedMessage {
  return {
    from: `${name}@letters.example.test`,
    subject: `Subject ${name} ${randomUUID().slice(0, 6)}`,
    body: `Body text of ${name}.`,
    internalDate,
  };
}

const BACKSLASH = String.fromCharCode(92);

/**
 * A chat answer whose message.content is valid JSON text in which the reason
 * holds a JSON escape (backslash, u, four hex digits) mid-sentence: the
 * fake's HTTP body stays valid JSON, and JSON.parse of the content yields the
 * real code point. Mid-sentence, because the schema trims leading and trailing
 * whitespace (U+2028 at the end would be trimmed away).
 */
function controlReasonAnswer(hex: string): FakeResponse {
  const content = JSON.stringify({
    reason: 'Looks fine@@ to me.',
    category: 'Noise',
    confidence: 0.95,
  }).replace('@@', `${BACKSLASH}u${hex}`);
  return contentAnswer(content);
}

/** The subject line of the fenced email in a recorded chat request body. */
function asksAbout(request: unknown, subject: string): boolean {
  return JSON.stringify(request).includes(`subject: ${subject}`);
}

function llmAttempts(decision: StoredDecision) {
  const llm = parseDecisionSpans(decision.spans).find((s) => s.kind === 'llm');
  if (llm?.kind !== 'llm') throw new Error('decision without an llm span');
  return llm.attempts;
}

const CONTROL_CHARACTER_FAILURE = {
  ok: false,
  code: 'schema_mismatch',
  detail: 'reason: control_character',
} as const;

const LONE_SURROGATE_FAILURE = {
  ok: false,
  code: 'schema_mismatch',
  detail: 'reason: lone_surrogate',
} as const;

type ExpectedValidation = typeof CONTROL_CHARACTER_FAILURE | typeof LONE_SURROGATE_FAILURE;

/**
 * Two LLM-bound messages: the newer one always gets the control-character
 * reason, the older one a valid answer. The newer one must become a stored
 * review invalid_output decision after two attempts, the older one labelled.
 */
async function expectHeldForReview(
  hex: string,
  failure: ExpectedValidation = CONTROL_CHARACTER_FAILURE,
): Promise<void> {
  const box = await newMailbox(`ctl-${hex.toLowerCase()}`);
  const bad = llmMessage(`bad-${hex}`, minute(20));
  const good = llmMessage(`good-${hex}`, minute(10));
  const fake = await fakeOllama((request) =>
    asksAbout(request, bad.subject) ? controlReasonAnswer(hex) : okAnswer('Receipts', 0.9),
  );
  const [badId, goodId] = await seedPendingMessages(appDb, box.id, [bad, good]);

  const outcome = await pass(box, fake);
  expect(outcome).toEqual({
    kind: 'done',
    labelled: 1,
    review: 1,
    llmCalls: 3,
    examined: 2,
    failures: 0,
    ollamaFailed: [],
    unclassified: [],
  });

  const decisions = await decisionsOf(db.adminUrl, box.id);
  expect(decisions).toHaveLength(2);
  const held = decisions.find((d) => d.messageId === badId);
  expect(held).toMatchObject({
    outcome: 'review',
    reviewReason: 'invalid_output',
    tier: 'llm',
    category: null,
  });
  const attempts = llmAttempts(held as StoredDecision);
  expect(attempts.map((a) => a.validation)).toEqual([failure, failure]);
  expect(decisions.find((d) => d.messageId === goodId)).toMatchObject({
    outcome: 'labelled',
    category: 'Receipts',
    tier: 'llm',
  });
  for (const decision of decisions) await expectReplayableDecision(db.adminUrl, decision, fake);
  expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([]);
}

describe('a model reason with a control character (WR-01, CLS-03, CLS-06)', () => {
  it('NUL in the reason twice: stored as review invalid_output, the other message labelled', async () => {
    await expectHeldForReview('0000');
  });

  it('NUL on the first call, a valid answer on the retry: labelled with two attempts', async () => {
    const box = await newMailbox('ctl-retry');
    const message = llmMessage('retry', minute(30));
    let calls = 0;
    const fake = await fakeOllama(() => {
      calls += 1;
      return calls === 1 ? controlReasonAnswer('0000') : okAnswer('Receipts', 0.9);
    });
    const [id] = await seedPendingMessages(appDb, box.id, [message]);

    expect(await pass(box, fake)).toEqual({
      kind: 'done',
      labelled: 1,
      review: 0,
      llmCalls: 2,
      examined: 1,
      failures: 0,
      ollamaFailed: [],
      unclassified: [],
    });
    const [decision, ...others] = await decisionsOf(db.adminUrl, box.id);
    expect(others).toEqual([]);
    expect(decision).toMatchObject({
      messageId: id,
      outcome: 'labelled',
      category: 'Receipts',
      tier: 'llm',
    });
    const attempts = llmAttempts(decision as StoredDecision);
    expect(attempts.map((a) => a.validation)).toEqual([CONTROL_CHARACTER_FAILURE, { ok: true }]);
    await expectReplayableDecision(db.adminUrl, decision as StoredDecision, fake);
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('BEL in the reason twice: stored as review invalid_output', async () => {
    await expectHeldForReview('0007');
  });

  it('U+2028 in the reason twice: stored as review invalid_output', async () => {
    await expectHeldForReview('2028');
  });
});

describe('a model reason with a lone surrogate (WR-04, CLS-06)', () => {
  it('a lone high surrogate (U+D800) twice: stored as review invalid_output, the other message labelled', async () => {
    await expectHeldForReview('D800', LONE_SURROGATE_FAILURE);
  });

  it('a lone low surrogate (U+DC00) twice: stored as review invalid_output, the other message labelled', async () => {
    await expectHeldForReview('DC00', LONE_SURROGATE_FAILURE);
  });

  it('five lone-surrogate answers in a row and an older valid message: all six decided in the first pass (SC5)', async () => {
    const box = await newMailbox('ctl-five');
    const bad = [60, 59, 58, 57, 56].map((n) => llmMessage(`five-${n}`, minute(n)));
    const good = llmMessage('five-good', minute(10));
    const fake = await fakeOllama((request) =>
      bad.some((m) => asksAbout(request, m.subject))
        ? controlReasonAnswer('D800')
        : okAnswer('Receipts', 0.9),
    );
    const ids = await seedPendingMessages(appDb, box.id, [...bad, good]);
    const badIds = ids.slice(0, bad.length);
    const goodId = ids[bad.length];
    const log = recordingLog();

    const outcome = await classifyMailbox({
      db: appDb,
      mailbox: box,
      model: FAKE_MODEL,
      threshold: 0.75,
      runtime: testRuntime(fake, dataDir),
      signal: new AbortController().signal,
      log,
    });
    expect(outcome).toEqual({
      kind: 'done',
      labelled: 1,
      review: 5,
      llmCalls: 11,
      examined: 6,
      failures: 0,
      ollamaFailed: [],
      unclassified: [],
    });

    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions).toHaveLength(6);
    for (const badId of badIds) {
      const held = decisions.find((d) => d.messageId === badId);
      expect(held).toMatchObject({
        outcome: 'review',
        reviewReason: 'invalid_output',
        tier: 'llm',
        category: null,
      });
      expect(llmAttempts(held as StoredDecision).map((a) => a.validation)).toEqual([
        LONE_SURROGATE_FAILURE,
        LONE_SURROGATE_FAILURE,
      ]);
    }
    expect(decisions.find((d) => d.messageId === goodId)).toMatchObject({
      outcome: 'labelled',
      category: 'Receipts',
      tier: 'llm',
    });
    for (const decision of decisions) await expectReplayableDecision(db.adminUrl, decision, fake);
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([]);
    expect(log.messages()).not.toContain('classify: message failed');
  });
});
