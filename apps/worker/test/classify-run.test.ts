// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDecisionSpans } from '@sift/core/classify';
import { type AppDb, createAppDb, withIngestLock } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import { llmErrorDetail } from '../src/classify/llm-tier.ts';
import { createOllamaClient, type LlmClient } from '../src/classify/ollama-client.ts';
import { createPreflight } from '../src/classify/preflight.ts';
import {
  CANARY_SYSTEM,
  CANARY_USER,
  CLASSIFY_CHUNK_SIZE,
  type ClassifyOutcome,
  type ClassifyRuntime,
  classifyMailbox,
  LLM_CALLS_PER_TICK,
  MAX_CONSECUTIVE_MESSAGE_FAILURES,
  MESSAGE_FAILURE_PASSES,
  MESSAGE_LLM_ERROR_LOG,
  NOTICE_MAX_IDS,
  OLLAMA_MESSAGE_FAILURE_LOG,
  OLLAMA_MESSAGE_FAILURES_PER_PASS,
  rulesProblemMessage,
  unclassifiedNotice,
} from '../src/classify/run.ts';
import {
  BASIC_CATEGORIES,
  BASIC_RULES,
  decisionsOf,
  expectReplayableDecision,
  pendingIdsOf,
  ruleSetsOf,
  type SeedMessage,
  seedPendingMessages,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import {
  contentAnswer,
  FAKE_DIGEST,
  FAKE_MODEL,
  type FakeOllama,
  okAnswer,
  startFakeOllama,
} from './support/fake-ollama.ts';
import { type LogLine, recordingLog } from './support/mailbox-harness.ts';

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
/** Every log line any pass in this file wrote, for the final no-mail-text scan. */
const allLines: LogLine[] = [];
/** Every subject and body seeded in this file, and every reason or error text a fake sent. */
const mailText: string[] = [];

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

/** A log whose lines also go to allLines. */
function newLog(): ReturnType<typeof recordingLog> {
  const log = recordingLog();
  const { info, warn } = log;
  log.info = (obj, msg) => {
    info(obj, msg);
    allLines.push({ level: 'info', obj, msg });
  };
  log.warn = (obj, msg) => {
    warn(obj, msg);
    allLines.push({ level: 'warn', obj, msg });
  };
  return log;
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
    log: options.log ?? newLog(),
  });
}

/** Seed messages and remember their subjects and bodies for the log scan. */
async function seed(box: Box, messages: readonly SeedMessage[]): Promise<string[]> {
  for (const m of messages) mailText.push(m.subject, m.body);
  return seedPendingMessages(appDb, box.id, messages);
}

/** A message the LLM tier gets (no exact rule matches it). */
function llmMessage(name: string, internalDate: Date | string, body?: string): SeedMessage {
  return {
    from: `${name}@letters.example.test`,
    subject: `Subject of ${name} ${randomUUID().slice(0, 6)}`,
    body: body ?? `Body text of ${name} ${randomUUID().slice(0, 6)}.`,
    internalDate,
  };
}

/** A message the bank.example.test exact rule decides. */
function bankMessage(name: string, internalDate: Date | string): SeedMessage {
  return {
    from: `${name}@bank.example.test`,
    subject: `Bank notice ${name} ${randomUUID().slice(0, 6)}`,
    body: `Bank body ${name} ${randomUUID().slice(0, 6)}.`,
    internalDate,
  };
}

const minute = (n: number): Date => new Date(Date.UTC(2026, 9, 1, 8, 0) + n * 60_000);

function chatRequests(fake: FakeOllama) {
  return fake.requests().filter((r) => r.path === '/api/chat');
}

/** Chat requests whose fenced email is from `address`. */
function chatsFrom(fake: FakeOllama, address: string): number {
  return fake
    .chatBodies()
    .filter((body) => JSON.stringify(body.messages).includes(`from_address: ${address}`)).length;
}

/** The fenced from_address of each chat request, in request order. */
function chatSenders(fake: FakeOllama): string[] {
  return fake.chatBodies().map((body) => {
    const user = (body.messages as { role: string; content: string }[])[1]?.content ?? '';
    return /^from_address: (.*)$/m.exec(user)?.[1] ?? '';
  });
}

async function expectAllReplayable(box: Box, fake: FakeOllama): Promise<void> {
  for (const decision of await decisionsOf(db.adminUrl, box.id)) {
    await expectReplayableDecision(db.adminUrl, decision, fake);
  }
}

/** Resolves once the fake has received a chat request. */
async function untilChat(fake: FakeOllama): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (chatRequests(fake).length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the fake never received a chat request');
}

describe('tracer: one pass over two pending messages', () => {
  it('decides one by an exact rule with no request and one by the LLM, both replayable', async () => {
    const box = await newMailbox('tracer');
    const fake = await fakeOllama();
    const runtime = testRuntime(fake, dataDir);
    const [bankId, newsId] = await seed(box, [
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
      ollamaFailed: [],
      unclassified: [],
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

describe('backlog: the 25-call cap, newest first, and the keyset (D-14, D-18, E6)', () => {
  it('makes exactly 25 calls newest first, keeps deciding exact rules, leaves the oldest pending', async () => {
    const box = await newMailbox('cap');
    const fake = await fakeOllama();
    const runtime = testRuntime(fake, dataDir);
    // 26 LLM-bound messages at minutes 10..35 and two older exact-bound ones.
    const llm = Array.from({ length: 26 }, (_, i) => llmMessage(`n${i}`, minute(10 + i)));
    const llmIds = await seed(box, llm);
    await seed(box, [bankMessage('old1', minute(1)), bankMessage('old2', minute(2))]);

    const outcome = await pass(box, runtime);
    expect(outcome).toEqual({
      kind: 'done',
      labelled: 27,
      review: 0,
      llmCalls: LLM_CALLS_PER_TICK,
      examined: 28,
      failures: 0,
      ollamaFailed: [],
      unclassified: [],
    });
    expect(chatRequests(fake)).toHaveLength(25);
    const newestFirst = llm.map((m) => m.from).reverse();
    expect(chatSenders(fake)).toEqual(newestFirst.slice(0, 25));
    // The oldest LLM-bound message is the one left pending.
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([llmIds[0]]);
    expect(fake.requests().filter((r) => r.path === '/api/tags')).toHaveLength(1);

    const next = await pass(box, runtime);
    expect(next).toMatchObject({ kind: 'done', labelled: 1, llmCalls: 1 });
    expect(chatRequests(fake)).toHaveLength(26);
    expect(chatSenders(fake).at(-1)).toBe(llm[0]?.from);
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([]);
    await expectAllReplayable(box, fake);
  });

  it('decides every message sharing one INTERNALDATE exactly once across chunks', async () => {
    const box = await newMailbox('same-date');
    const fake = await fakeOllama();
    const runtime = testRuntime(fake, dataDir);
    const when = minute(100);
    const ids = await seed(box, [
      ...Array.from({ length: 5 }, (_, i) => bankMessage(`same${i}`, when)),
      llmMessage('same-llm-a', when),
      llmMessage('same-llm-b', when),
    ]);
    expect(ids.length).toBeGreaterThan(CLASSIFY_CHUNK_SIZE);

    const outcome = await pass(box, runtime);
    expect(outcome).toMatchObject({ kind: 'done', labelled: 7, examined: 7, llmCalls: 2 });
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions.map((d) => d.messageId).sort()).toEqual([...ids].sort());
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([]);
    await expectAllReplayable(box, fake);
  });

  it('with nothing pending makes no request, not even the preflight, and writes no rule_set', async () => {
    const box = await newMailbox('empty');
    const fake = await fakeOllama();
    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome).toEqual({
      kind: 'done',
      labelled: 0,
      review: 0,
      llmCalls: 0,
      examined: 0,
      failures: 0,
      ollamaFailed: [],
      unclassified: [],
    });
    expect(fake.requests()).toEqual([]);
    expect(await ruleSetsOf(db.adminUrl, box.id)).toEqual([]);
  });
});

describe('outages are never decisions (D-16, E5)', () => {
  it('Ollama unreachable: exact rules still decide, LLM-bound mail stays pending, then recovers', async () => {
    const box = await newMailbox('down');
    const dead = await fakeOllama();
    const origin = new URL(dead.url).origin;
    await dead.close();
    // More skipped LLM-bound messages than one chunk, all newer than the exact-rule one:
    // only the keyset cursor gets the pass past them to the bank message.
    const [bankId] = await seed(box, [bankMessage('down-bank', minute(3))]);
    const llmIds = await seed(
      box,
      Array.from({ length: CLASSIFY_CHUNK_SIZE + 1 }, (_, i) =>
        llmMessage(`down${i}`, minute(4 + i)),
      ),
    );

    const log = newLog();
    const outcome = await pass(box, testRuntime(dead, dataDir), { log });
    expect(outcome).toMatchObject({ kind: 'infra', code: 'unreachable', labelled: 1, review: 0 });
    if (outcome.kind !== 'infra') throw new Error('expected infra');
    expect(outcome.message).toContain(`Ollama unreachable at ${origin} (ECONNREFUSED`);
    expect(chatRequests(dead)).toHaveLength(0);
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions.map((d) => d.messageId)).toEqual([bankId]);
    expect((await pendingIdsOf(db.adminUrl, box.id)).sort()).toEqual([...llmIds].sort());
    expect(log.lines.find((l) => l.level === 'warn')?.obj).toEqual({
      mailbox: box.slug,
      code: 'unreachable',
      status: null,
    });

    const healthy = await fakeOllama();
    const next = await pass(box, testRuntime(healthy, dataDir));
    expect(next).toMatchObject({ kind: 'done', labelled: llmIds.length, llmCalls: llmIds.length });
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([]);
    await expectAllReplayable(box, healthy);
  });

  it('a missing model is infra model_missing with the ollama pull hint and no chat call', async () => {
    const box = await newMailbox('no-model');
    const fake = await fakeOllama({
      tags: { status: 200, json: { models: [{ name: 'llama3.2:3b', digest: FAKE_DIGEST }] } },
    });
    await seed(box, [llmMessage('no-model', minute(6))]);
    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome).toMatchObject({ kind: 'infra', code: 'model_missing' });
    if (outcome.kind !== 'infra') throw new Error('expected infra');
    expect(outcome.message).toContain(`ollama pull ${FAKE_MODEL}`);
    expect(chatRequests(fake)).toHaveLength(0);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('a cloud model is infra remote_model and no mail is sent', async () => {
    const box = await newMailbox('remote');
    const fake = await fakeOllama({
      tags: {
        status: 200,
        json: {
          models: [
            {
              name: FAKE_MODEL,
              model: FAKE_MODEL,
              digest: FAKE_DIGEST,
              remote_host: 'https://ollama.com:443',
              remote_model: 'qwen3:1.7b',
            },
          ],
        },
      },
    });
    await seed(box, [llmMessage('remote', minute(7))]);
    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome).toMatchObject({ kind: 'infra', code: 'remote_model' });
    if (outcome.kind !== 'infra') throw new Error('expected infra');
    expect(outcome.message).toContain('Sift never sends mail off this machine');
    expect(chatRequests(fake)).toHaveLength(0);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('a 500 confined to one message skips only it; older LLM-bound mail is decided in the same pass (CR-01)', async () => {
    const box = await newMailbox('poison');
    const errorText = `runner crashed on this prompt ${randomUUID()}`;
    mailText.push(errorText);
    const poison = llmMessage('poison', minute(25));
    const fake = await fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes(`from_address: ${poison.from}`)
          ? { status: 500, json: { error: errorText } }
          : okAnswer('Noise', 0.9),
    });
    const [poisonId] = await seed(box, [poison]);
    const older = await seed(box, [
      llmMessage('poison-a', minute(24)),
      llmMessage('poison-b', minute(23)),
      llmMessage('poison-c', minute(22)),
    ]);
    const [bankId] = await seed(box, [bankMessage('poison-bank', minute(21))]);

    const log = newLog();
    const outcome = await pass(box, testRuntime(fake, dataDir), { log });
    expect(outcome).toEqual({
      kind: 'done',
      labelled: 4,
      review: 0,
      llmCalls: 4,
      examined: 5,
      failures: 0,
      ollamaFailed: [poisonId],
      unclassified: [poisonId],
    });
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([poisonId]);
    const decided = (await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId).sort();
    expect(decided).toEqual([...older, bankId].sort());
    expect(chatRequests(fake)).toHaveLength(4);
    expect(chatSenders(fake)[0]).toBe(poison.from);
    // The pass's own preflight, then the re-probe after the 500.
    expect(fake.requests().filter((r) => r.path === '/api/tags')).toHaveLength(2);
    expect(log.lines.filter((l) => l.msg === OLLAMA_MESSAGE_FAILURE_LOG)).toEqual([
      {
        level: 'warn',
        obj: { mailbox: box.slug, message: poisonId, code: 'server_error', status: 500 },
        msg: OLLAMA_MESSAGE_FAILURE_LOG,
      },
    ]);
    expect(log.lines.some((l) => l.msg === 'classify: Ollama unavailable')).toBe(false);
    await expectAllReplayable(box, fake);
  });

  it('a 500 the re-probe confirms as an outage stops LLM work for the pass; exact rules keep deciding', async () => {
    const box = await newMailbox('server-error');
    const errorText = `runner crashed while reading ${randomUUID()}`;
    mailText.push(errorText);
    const fake = await fakeOllama({
      chat: [
        okAnswer('Noise', 0.9),
        okAnswer('Receipts', 0.8),
        { status: 500, json: { error: errorText } },
      ],
    });
    // Ollama answers the pass's first preflight, then goes away: the re-probe fails.
    const real = createPreflight(fake.url);
    let preflights = 0;
    const flaky: typeof real = async (model, shutdown) => {
      preflights += 1;
      if (preflights === 1) return real(model, shutdown);
      return { kind: 'infra', code: 'unreachable', status: null, detail: 'ECONNREFUSED' };
    };
    const llmIds = await seed(box, [
      llmMessage('se-a', minute(20)),
      llmMessage('se-b', minute(19)),
      llmMessage('se-c', minute(18)),
      llmMessage('se-d', minute(17)),
    ]);
    const [bankId] = await seed(box, [bankMessage('se-bank', minute(16))]);

    const outcome = await pass(box, testRuntime(fake, dataDir, { preflight: flaky }));
    expect(outcome).toMatchObject({ kind: 'infra', code: 'server_error', labelled: 3, review: 0 });
    if (outcome.kind !== 'infra') throw new Error('expected infra');
    expect(outcome.message).toContain('failed (HTTP 500)');
    expect(outcome.message).not.toContain(errorText);
    expect(preflights).toBe(2);
    expect(chatRequests(fake)).toHaveLength(3);
    const decided = (await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId).sort();
    expect(decided).toEqual([llmIds[0], llmIds[1], bankId].sort());
    expect((await pendingIdsOf(db.adminUrl, box.id)).sort()).toEqual([llmIds[2], llmIds[3]].sort());
    await expectAllReplayable(box, fake);
  });

  it(`past OLLAMA_MESSAGE_FAILURES_PER_PASS (${OLLAMA_MESSAGE_FAILURES_PER_PASS}) a further 500 in the same pass is an outage`, async () => {
    const box = await newMailbox('all-500');
    const errorText = `runner crashes on every prompt ${randomUUID()}`;
    mailText.push(errorText);
    const fake = await fakeOllama({ chat: () => ({ status: 500, json: { error: errorText } }) });
    const llmIds = await seed(box, [
      llmMessage('all-a', minute(15)),
      llmMessage('all-b', minute(14)),
      llmMessage('all-c', minute(13)),
      llmMessage('all-d', minute(12)),
    ]);
    const [bankId] = await seed(box, [bankMessage('all-bank', minute(11))]);

    const log = newLog();
    const outcome = await pass(box, testRuntime(fake, dataDir), { log });
    expect(outcome).toMatchObject({ kind: 'infra', code: 'server_error', labelled: 1, review: 0 });
    if (outcome.kind !== 'infra') throw new Error('expected infra');
    expect(outcome.message).toContain('failed (HTTP 500)');
    expect(chatRequests(fake)).toHaveLength(OLLAMA_MESSAGE_FAILURES_PER_PASS + 1);
    // One re-probe per skipped message; none for the failure that exceeded the budget.
    expect(fake.requests().filter((r) => r.path === '/api/tags')).toHaveLength(
      1 + OLLAMA_MESSAGE_FAILURES_PER_PASS,
    );
    expect(log.lines.filter((l) => l.msg === OLLAMA_MESSAGE_FAILURE_LOG)).toHaveLength(
      OLLAMA_MESSAGE_FAILURES_PER_PASS,
    );
    expect((await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId)).toEqual([bankId]);
    expect((await pendingIdsOf(db.adminUrl, box.id)).sort()).toEqual([...llmIds].sort());
  });
});

describe('one bad message never stops the others (CLS-06, E6)', () => {
  it('an over-long message is review input_too_long after one call; the pass carries on', async () => {
    const box = await newMailbox('too-long');
    const fake = await fakeOllama({ charBudget: 4000 });
    const [longId] = await seed(box, [
      llmMessage('tl-long', minute(30), `${'Very long body. '.repeat(240)}`),
    ]);
    const others = await seed(box, [
      llmMessage('tl-a', minute(31)),
      llmMessage('tl-b', minute(29)),
      bankMessage('tl-bank', minute(28)),
    ]);

    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome).toMatchObject({ kind: 'done', labelled: 3, review: 1, llmCalls: 3 });
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions.find((d) => d.messageId === longId)).toMatchObject({
      outcome: 'review',
      reviewReason: 'input_too_long',
      tier: 'llm',
    });
    expect(decisions.map((d) => d.messageId).sort()).toEqual([longId, ...others].sort());
    expect(chatsFrom(fake, 'tl-long@letters.example.test')).toBe(1);
    await expectAllReplayable(box, fake);
  });

  it('invalid output twice is a review; a message whose call throws is skipped and logged by id', async () => {
    const box = await newMailbox('isolation');
    const reason = `The sender is a newsletter ${randomUUID()}`;
    mailText.push(reason);
    const fake = await fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes('subject: Garbled answers')
          ? contentAnswer('this is not json at all')
          : okAnswer('Noise', 0.95, reason),
    });
    const real = createOllamaClient(fake.url);
    const throwing: LlmClient = {
      chat(request, shutdown) {
        const user = request.messages[1]?.content ?? '';
        if (user.includes('subject: Explodes on contact')) {
          // The error text is mail-derived on purpose: it must never reach a log line.
          throw new Error(`cannot classify ${user.slice(0, 200)}`);
        }
        return real.chat(request, shutdown);
      },
    };
    const [garbledId, explodesId] = await seed(box, [
      { ...llmMessage('iso-garbled', minute(40)), subject: 'Garbled answers' },
      { ...llmMessage('iso-explodes', minute(39)), subject: 'Explodes on contact' },
    ]);
    const others = await seed(box, [
      llmMessage('iso-a', minute(38)),
      bankMessage('iso-bank', minute(37)),
      llmMessage('iso-b', minute(36)),
    ]);

    const log = newLog();
    const outcome = await pass(box, testRuntime(fake, dataDir, { llm: throwing }), { log });
    expect(outcome).toMatchObject({ kind: 'done', labelled: 3, review: 1, failures: 1 });
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions.find((d) => d.messageId === garbledId)).toMatchObject({
      outcome: 'review',
      reviewReason: 'invalid_output',
    });
    expect(decisions.find((d) => d.messageId === explodesId)).toBeUndefined();
    expect(decisions.map((d) => d.messageId).sort()).toEqual([garbledId, ...others].sort());
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([explodesId]);
    const failed = log.lines.filter((l) => l.msg === 'classify: message failed');
    expect(failed.map((l) => l.obj)).toEqual([
      { mailbox: box.slug, message: explodesId, code: 'Error' },
    ]);
    await expectAllReplayable(box, fake);
  });

  it(`${MAX_CONSECUTIVE_MESSAGE_FAILURES} failures in a row stop the pass with the last error`, async () => {
    const box = await newMailbox('failing');
    const fake = await fakeOllama();
    let calls = 0;
    const broken: LlmClient = {
      chat() {
        calls += 1;
        throw new TypeError(`broken client ${calls}`);
      },
    };
    await seed(
      box,
      Array.from({ length: 7 }, (_, i) => llmMessage(`fail${i}`, minute(50 + i))),
    );
    const log = newLog();
    await expect(pass(box, testRuntime(fake, dataDir, { llm: broken }), { log })).rejects.toThrow(
      'broken client 5',
    );
    expect(calls).toBe(MAX_CONSECUTIVE_MESSAGE_FAILURES);
    expect(log.lines.filter((l) => l.msg === 'classify: message failed')).toHaveLength(5);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });
});

describe('a message Ollama fails on alone: edges (CR-01)', () => {
  it('a timeout on one message is skipped after a healthy re-probe; the older mail is decided (CR-01)', async () => {
    const box = await newMailbox('slow');
    const slow = llmMessage('slow', minute(140));
    const fake = await fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes(`from_address: ${slow.from}`)
          ? { hang: true }
          : okAnswer('Noise', 0.9),
    });
    const [slowId] = await seed(box, [slow]);
    const older = await seed(box, [
      llmMessage('slow-a', minute(139)),
      llmMessage('slow-b', minute(138)),
    ]);

    const log = newLog();
    const outcome = await pass(box, testRuntime(fake, dataDir, { timeoutMs: 2000 }), { log });
    expect(outcome).toEqual({
      kind: 'done',
      labelled: 2,
      review: 0,
      llmCalls: 3,
      examined: 3,
      failures: 0,
      ollamaFailed: [slowId],
      unclassified: [slowId],
    });
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([slowId]);
    const decided = (await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId).sort();
    expect(decided).toEqual([...older].sort());
    expect(log.lines.filter((l) => l.msg === OLLAMA_MESSAGE_FAILURE_LOG).map((l) => l.obj)).toEqual(
      [{ mailbox: box.slug, message: slowId, code: 'timeout', status: null }],
    );
    await expectAllReplayable(box, fake);
  });

  it('a pass whose only LLM-bound message fails alone ends done with that id (CR-01)', async () => {
    const box = await newMailbox('only-one');
    const errorText = `runner crashed on the only prompt ${randomUUID()}`;
    mailText.push(errorText);
    const fake = await fakeOllama({ chat: () => ({ status: 500, json: { error: errorText } }) });
    const [id] = await seed(box, [llmMessage('only-one', minute(150))]);

    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome).toEqual({
      kind: 'done',
      labelled: 0,
      review: 0,
      llmCalls: 1,
      examined: 1,
      failures: 0,
      ollamaFailed: [id],
      unclassified: [id],
    });
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([id]);
  });

  it('a shutdown during the re-probe ends the pass aborted with no decision (CR-01)', async () => {
    const box = await newMailbox('probe-abort');
    const errorText = `runner crashed before shutdown ${randomUUID()}`;
    mailText.push(errorText);
    const fake = await fakeOllama({ chat: () => ({ status: 500, json: { error: errorText } }) });
    const controller = new AbortController();
    const real = createPreflight(fake.url);
    let preflights = 0;
    const stopping: typeof real = async (model, shutdown) => {
      preflights += 1;
      if (preflights === 1) return real(model, shutdown);
      controller.abort();
      return { kind: 'aborted' };
    };
    const ids = await seed(box, [
      llmMessage('probe-abort-a', minute(160)),
      llmMessage('probe-abort-b', minute(159)),
    ]);

    const outcome = await pass(box, testRuntime(fake, dataDir, { preflight: stopping }), {
      signal: controller.signal,
    });
    expect(outcome).toEqual({ kind: 'aborted' });
    expect(preflights).toBe(2);
    expect(chatRequests(fake)).toHaveLength(1);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect((await pendingIdsOf(db.adminUrl, box.id)).sort()).toEqual([...ids].sort());
  });

  it('an unreachable chat result is still an outage, with no re-probe (CR-01)', async () => {
    const box = await newMailbox('chat-down');
    const fake = await fakeOllama();
    let chats = 0;
    const down: LlmClient = {
      async chat() {
        chats += 1;
        return { kind: 'infra', code: 'unreachable', status: null, detail: 'ECONNREFUSED' };
      },
    };
    const llmIds = await seed(box, [
      llmMessage('chat-down-a', minute(170)),
      llmMessage('chat-down-b', minute(169)),
    ]);
    const [bankId] = await seed(box, [bankMessage('chat-down-bank', minute(168))]);

    const outcome = await pass(box, testRuntime(fake, dataDir, { llm: down }));
    expect(outcome).toMatchObject({ kind: 'infra', code: 'unreachable', labelled: 1, review: 0 });
    expect(chats).toBe(1);
    expect(fake.requests().filter((r) => r.path === '/api/tags')).toHaveLength(1);
    expect((await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId)).toEqual([bankId]);
    expect((await pendingIdsOf(db.adminUrl, box.id)).sort()).toEqual([...llmIds].sort());
  });
});

describe('a message Ollama keeps failing on is held for review (WR-03, CR-01)', () => {
  /** A fake that answers 500 for chats from `address` and Noise for every other chat. */
  async function poisonFake(address: string): Promise<FakeOllama> {
    const errorText = `runner crashed on this sender ${randomUUID()}`;
    mailText.push(errorText);
    return fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes(`from_address: ${address}`)
          ? { status: 500, json: { error: errorText } }
          : okAnswer('Noise', 0.9),
    });
  }

  /** Chat requests that are the mail-free canary. */
  function canaries(fake: FakeOllama): Record<string, unknown>[] {
    return fake.chatBodies().filter((body) => JSON.stringify(body.messages).includes(CANARY_USER));
  }

  /** The done outcome of a pass whose only LLM-bound message Ollama failed on alone. */
  const skipped = (id: string, llmCalls: number): ClassifyOutcome => ({
    kind: 'done',
    labelled: 0,
    review: 0,
    llmCalls,
    examined: 1,
    failures: 0,
    ollamaFailed: [id],
    unclassified: [id],
  });

  it('after MESSAGE_FAILURE_PASSES passes a message Ollama fails on alone is held for review with reason llm_error (CR-01)', async () => {
    expect(MESSAGE_FAILURE_PASSES).toBe(3);
    const box = await newMailbox('llm-error');
    const poison = llmMessage('llm-error', minute(200));
    const fake = await poisonFake(poison.from);
    const [id] = await seed(box, [poison]);
    const [olderId] = await seed(box, [llmMessage('llm-error-older', minute(199))]);
    if (id === undefined || olderId === undefined) throw new Error('seed returned no id');
    const runtime = testRuntime(fake, dataDir);

    // Pass 1: the poison message is skipped, the older one decided.
    expect(await pass(box, runtime)).toEqual({
      kind: 'done',
      labelled: 1,
      review: 0,
      llmCalls: 2,
      examined: 2,
      failures: 0,
      ollamaFailed: [id],
      unclassified: [id],
    });
    // Pass 2: skipped again, still no decision for it.
    expect(await pass(box, runtime)).toEqual(skipped(id, 1));
    expect(runtime.messageFailures.get(id)).toBe(2);
    expect((await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId)).toEqual([olderId]);
    expect(chatsFrom(fake, poison.from)).toBe(2);
    expect(canaries(fake)).toHaveLength(0);

    // Pass 3: the message's chat, then one canary chat, which Ollama answers, then the decision.
    const log = newLog();
    expect(await pass(box, runtime, { log })).toEqual({
      kind: 'done',
      labelled: 0,
      review: 1,
      llmCalls: 2,
      examined: 1,
      failures: 0,
      ollamaFailed: [id],
      unclassified: [],
    });
    expect(chatsFrom(fake, poison.from)).toBe(3);
    expect(canaries(fake)).toHaveLength(1);
    const decisions = (await decisionsOf(db.adminUrl, box.id)).filter((d) => d.messageId === id);
    expect(decisions).toHaveLength(1);
    const [decision] = decisions;
    if (decision === undefined) throw new Error('no decision');
    expect(decision).toMatchObject({
      outcome: 'review',
      reviewReason: 'llm_error',
      tier: 'llm',
      category: null,
      confidence: null,
      decidedBy: 'worker',
      model: FAKE_MODEL,
    });
    const llm = parseDecisionSpans(decision.spans)[2];
    if (llm?.kind !== 'llm') throw new Error('no llm span');
    expect(llm.result).toBeNull();
    expect(llm.attempts).toHaveLength(1);
    expect(llm.attempts[0]).toMatchObject({
      raw: null,
      thinking: null,
      done_reason: null,
      metrics: null,
      validation: {
        ok: false,
        code: 'llm_error',
        detail: 'Ollama failed on this request (server_error, HTTP 500)',
      },
    });
    expect(JSON.stringify(decision.spans)).not.toContain('runner crashed');
    await expectReplayableDecision(db.adminUrl, decision, fake);
    expect(runtime.messageFailures.has(id)).toBe(false);
    expect(log.lines.filter((l) => l.msg === MESSAGE_LLM_ERROR_LOG)).toEqual([
      {
        level: 'warn',
        obj: { mailbox: box.slug, message: id, passes: MESSAGE_FAILURE_PASSES },
        msg: MESSAGE_LLM_ERROR_LOG,
      },
    ]);
    expect(log.lines.some((l) => l.msg === OLLAMA_MESSAGE_FAILURE_LOG)).toBe(false);

    // Pass 4: nothing is pending, so no request of any kind reaches Ollama.
    const before = fake.requests().length;
    expect(await pass(box, runtime)).toEqual({
      kind: 'done',
      labelled: 0,
      review: 0,
      llmCalls: 0,
      examined: 0,
      failures: 0,
      ollamaFailed: [],
      unclassified: [],
    });
    expect(fake.requests()).toHaveLength(before);
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('the canary request carries no email: fixed CANARY_SYSTEM and CANARY_USER, format names only Probe (CR-01)', async () => {
    const box = await newMailbox('canary');
    const poison = llmMessage('canary', minute(210));
    const fake = await poisonFake(poison.from);
    await seed(box, [poison]);
    const runtime = testRuntime(fake, dataDir);
    for (let i = 0; i < MESSAGE_FAILURE_PASSES; i += 1) await pass(box, runtime);

    const [canary] = canaries(fake);
    if (canary === undefined) throw new Error('no canary chat');
    expect(canary.model).toBe(FAKE_MODEL);
    expect(canary.messages).toEqual([
      { role: 'system', content: CANARY_SYSTEM },
      { role: 'user', content: CANARY_USER },
    ]);
    const format = JSON.stringify(canary.format);
    expect(format).toContain('Probe');
    for (const name of BASIC_CATEGORIES) expect(format).not.toContain(name);
    const text = JSON.stringify(canary);
    expect(text).not.toContain(poison.from);
    expect(text).not.toContain(poison.subject);
    expect(text).not.toContain(poison.body);
    expect(text).not.toContain('<<<EMAIL');
  });

  it('a runner that fails every prompt fails the canary: an outage, and the message is not held for review (CR-01)', async () => {
    const box = await newMailbox('all-fail');
    const errorText = `runner crashed on every prompt ${randomUUID()}`;
    mailText.push(errorText);
    const fake = await fakeOllama({ chat: () => ({ status: 500, json: { error: errorText } }) });
    const message = llmMessage('all-fail', minute(220));
    const [id] = await seed(box, [message]);
    if (id === undefined) throw new Error('seed returned no id');
    const runtime = testRuntime(fake, dataDir);

    expect(await pass(box, runtime)).toEqual(skipped(id, 1));
    expect(await pass(box, runtime)).toEqual(skipped(id, 1));
    const log = newLog();
    const third = await pass(box, runtime, { log });
    expect(third).toMatchObject({ kind: 'infra', code: 'server_error' });
    expect(canaries(fake)).toHaveLength(1);
    expect(runtime.messageFailures.get(id)).toBe(2);
    expect(log.lines.some((l) => l.msg === MESSAGE_LLM_ERROR_LOG)).toBe(false);

    // Not held for review: the next pass sends the message again.
    const fourth = await pass(box, runtime);
    expect(fourth).toMatchObject({ kind: 'infra', code: 'server_error' });
    expect(chatsFrom(fake, message.from)).toBe(4);
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([id]);
  });

  it('a fresh runtime (worker restart) counts the passes from zero again (WR-03)', async () => {
    const box = await newMailbox('restart');
    const poison = llmMessage('restart', minute(230));
    const fake = await poisonFake(poison.from);
    const [id] = await seed(box, [poison]);
    if (id === undefined) throw new Error('seed returned no id');
    const runtime = testRuntime(fake, dataDir);
    for (let i = 0; i < MESSAGE_FAILURE_PASSES - 1; i += 1) await pass(box, runtime);
    expect(runtime.messageFailures.get(id)).toBe(MESSAGE_FAILURE_PASSES - 1);

    const restarted = testRuntime(fake, dataDir);
    expect(await pass(box, restarted)).toEqual(skipped(id, 1));
    expect(restarted.messageFailures.get(id)).toBe(1);
    expect(chatsFrom(fake, poison.from)).toBe(MESSAGE_FAILURE_PASSES);
    expect(canaries(fake)).toHaveLength(0);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('a message that failed twice and is then answered is decided and forgotten (WR-03)', async () => {
    const box = await newMailbox('recovers');
    const poison = llmMessage('recovers', minute(240));
    const fake = await poisonFake(poison.from);
    const [id] = await seed(box, [poison]);
    if (id === undefined) throw new Error('seed returned no id');
    const runtime = testRuntime(fake, dataDir);
    await pass(box, runtime);
    await pass(box, runtime);
    expect(runtime.messageFailures.get(id)).toBe(2);

    fake.setChat(() => okAnswer('Noise', 0.9));
    expect(await pass(box, runtime)).toMatchObject({
      kind: 'done',
      labelled: 1,
      ollamaFailed: [],
      unclassified: [],
    });
    expect((await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId)).toEqual([id]);
    expect(runtime.messageFailures.has(id)).toBe(false);
  });

  it('an exact rule added after two failures decides it with no chat and forgets it (WR-03)', async () => {
    const box = await newMailbox('rule-later');
    const poison = llmMessage('rule-later', minute(250));
    const fake = await poisonFake(poison.from);
    const [id] = await seed(box, [poison]);
    if (id === undefined) throw new Error('seed returned no id');
    const runtime = testRuntime(fake, dataDir);
    for (let i = 0; i < MESSAGE_FAILURE_PASSES - 1; i += 1) await pass(box, runtime);
    expect(runtime.messageFailures.get(id)).toBe(MESSAGE_FAILURE_PASSES - 1);

    await writeRules(
      dataDir,
      box.slug,
      `${BASIC_RULES}  - kind: exact
    name: the held sender
    match:
      from: [${poison.from}]
    label: Receipts
`,
    );
    const before = fake.requests().length;
    expect(await pass(box, runtime)).toMatchObject({
      kind: 'done',
      labelled: 1,
      unclassified: [],
    });
    expect(fake.requests()).toHaveLength(before);
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      messageId: id,
      tier: 'exact_rules',
      category: 'Receipts',
    });
    expect(runtime.messageFailures.has(id)).toBe(false);
  });

  it('two messages Ollama fails on alone are named newest first (WR-03)', async () => {
    const box = await newMailbox('order');
    const errorText = `runner crashed in order ${randomUUID()}`;
    mailText.push(errorText);
    const fake = await fakeOllama({ chat: () => ({ status: 500, json: { error: errorText } }) });
    const [newer] = await seed(box, [llmMessage('order-new', minute(261))]);
    const [older] = await seed(box, [llmMessage('order-old', minute(260))]);
    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome).toMatchObject({ kind: 'done', unclassified: [newer, older] });
  });

  it('unclassifiedNotice names at most NOTICE_MAX_IDS ids, then a count (WR-03)', () => {
    expect(NOTICE_MAX_IDS).toBe(3);
    expect(unclassifiedNotice([])).toBeNull();
    expect(unclassifiedNotice(['a'])).toBe(
      '1 message could not be classified (ids: a); see docker compose logs worker',
    );
    expect(unclassifiedNotice(['a', 'b', 'c'])).toBe(
      '3 messages could not be classified (ids: a, b, c); see docker compose logs worker',
    );
    expect(unclassifiedNotice(['a', 'b', 'c', 'd', 'e'])).toBe(
      '5 messages could not be classified (ids: a, b, c; and 2 more); see docker compose logs worker',
    );
  });
});

describe('only a failure confined to one message becomes llm_error (CR-01, D-16)', () => {
  /** Chat requests that are the mail-free canary. */
  function canaryCount(fake: FakeOllama): number {
    return fake.chatBodies().filter((body) => JSON.stringify(body.messages).includes(CANARY_USER))
      .length;
  }

  it('over four passes a 500 whose re-probe always fails writes no decision and is never counted (D-16)', async () => {
    const box = await newMailbox('reprobe-down');
    const errorText = `runner crashed and Ollama went away ${randomUUID()}`;
    mailText.push(errorText);
    const poison = llmMessage('reprobe-down', minute(300));
    const fake = await fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes(`from_address: ${poison.from}`)
          ? { status: 500, json: { error: errorText } }
          : okAnswer('Noise', 0.9),
    });
    const [id] = await seed(box, [poison]);
    const [bankId] = await seed(box, [bankMessage('reprobe-down-bank', minute(299))]);
    if (id === undefined) throw new Error('seed returned no id');
    // Healthy for the pass's own preflight, unreachable for every re-probe.
    const real = createPreflight(fake.url);
    let callsThisPass = 0;
    const firstOnly: typeof real = async (model, shutdown) => {
      callsThisPass += 1;
      if (callsThisPass === 1) return real(model, shutdown);
      return { kind: 'infra', code: 'unreachable', status: null, detail: 'ECONNREFUSED' };
    };
    const runtime = testRuntime(fake, dataDir, { preflight: firstOnly });

    for (let i = 0; i < MESSAGE_FAILURE_PASSES + 1; i += 1) {
      callsThisPass = 0;
      expect(await pass(box, runtime)).toMatchObject({ kind: 'infra', code: 'server_error' });
      expect(callsThisPass).toBe(2);
    }
    expect(chatsFrom(fake, poison.from)).toBe(MESSAGE_FAILURE_PASSES + 1);
    expect(canaryCount(fake)).toBe(0);
    expect(runtime.messageFailures.has(id)).toBe(false);
    expect((await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId)).toEqual([bankId]);
    expect(await pendingIdsOf(db.adminUrl, box.id)).toEqual([id]);
  });

  it('with every chat failing, three messages over four passes never become llm_error (D-16)', async () => {
    const box = await newMailbox('always-500');
    const errorText = `runner crashes on every prompt ${randomUUID()}`;
    mailText.push(errorText);
    const fake = await fakeOllama({ chat: () => ({ status: 500, json: { error: errorText } }) });
    const messages = [
      llmMessage('always-a', minute(310)),
      llmMessage('always-b', minute(309)),
      llmMessage('always-c', minute(308)),
    ];
    const ids = await seed(box, messages);
    const [a, b, c] = ids;
    const [ma, mb, mc] = messages;
    if (a === undefined || b === undefined || c === undefined) throw new Error('no ids');
    if (ma === undefined || mb === undefined || mc === undefined) throw new Error('no messages');
    const runtime = testRuntime(fake, dataDir);

    // Passes 1 and 2: two messages skipped alone, the third failure is the outage.
    for (let i = 0; i < MESSAGE_FAILURE_PASSES - 1; i += 1) {
      expect(await pass(box, runtime)).toMatchObject({ kind: 'infra', code: 'server_error' });
    }
    expect(runtime.messageFailures.get(a)).toBe(2);
    expect(runtime.messageFailures.get(b)).toBe(2);
    expect(runtime.messageFailures.has(c)).toBe(false);
    expect(canaryCount(fake)).toBe(0);

    // Passes 3 and 4: the newest would reach the limit, the canary fails, so: an outage.
    for (let i = 0; i < 2; i += 1) {
      expect(await pass(box, runtime)).toMatchObject({ kind: 'infra', code: 'server_error' });
    }
    expect(canaryCount(fake)).toBe(2);
    expect(chatsFrom(fake, ma.from)).toBe(4);
    expect(chatsFrom(fake, mb.from)).toBe(2);
    expect(chatsFrom(fake, mc.from)).toBe(2);
    expect(runtime.messageFailures.get(a)).toBe(2);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect((await pendingIdsOf(db.adminUrl, box.id)).sort()).toEqual([...ids].sort());
  });

  it('a timeout confined to one message is held for review with llm_error on the third pass (CR-01)', async () => {
    const box = await newMailbox('slow-llm-error');
    const slow = llmMessage('slow-llm-error', minute(320));
    const fake = await fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes(`from_address: ${slow.from}`)
          ? { hang: true }
          : okAnswer('Noise', 0.9),
    });
    const [id] = await seed(box, [slow]);
    if (id === undefined) throw new Error('seed returned no id');
    const runtime = testRuntime(fake, dataDir, { timeoutMs: 2000 });

    for (let i = 0; i < MESSAGE_FAILURE_PASSES - 1; i += 1) {
      expect(await pass(box, runtime)).toMatchObject({ kind: 'done', unclassified: [id] });
    }
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect(await pass(box, runtime)).toMatchObject({
      kind: 'done',
      review: 1,
      ollamaFailed: [id],
      unclassified: [],
    });
    expect(canaryCount(fake)).toBe(1);
    const [decision, ...others] = await decisionsOf(db.adminUrl, box.id);
    expect(others).toEqual([]);
    if (decision === undefined) throw new Error('no decision');
    expect(decision).toMatchObject({
      messageId: id,
      outcome: 'review',
      reviewReason: 'llm_error',
      tier: 'llm',
      category: null,
      confidence: null,
      decidedBy: 'worker',
    });
    const llm = parseDecisionSpans(decision.spans)[2];
    if (llm?.kind !== 'llm') throw new Error('no llm span');
    expect(llm.attempts).toHaveLength(1);
    expect(llm.attempts[0]?.raw).toBeNull();
    expect(llm.attempts[0]?.validation).toEqual({
      ok: false,
      code: 'llm_error',
      detail: llmErrorDetail('timeout', null),
    });
    await expectReplayableDecision(db.adminUrl, decision, fake);
  });
});

describe('shutdown, rules files, re-runs and the lock', () => {
  it('shutdown aborts the in-flight call, writes no decision and is not infra', async () => {
    const box = await newMailbox('abort');
    const fake = await fakeOllama({ chat: [{ hang: true }] });
    await seed(box, [llmMessage('abort-a', minute(60)), bankMessage('abort-bank', minute(59))]);
    const controller = new AbortController();
    const running = pass(box, testRuntime(fake, dataDir), { signal: controller.signal });
    await untilChat(fake);
    controller.abort();
    expect(await running).toEqual({ kind: 'aborted' });
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect(chatRequests(fake)).toHaveLength(1);
  });

  it('a missing rules.yaml is rules_invalid naming the file; nothing is classified', async () => {
    const box = await newMailbox('no-rules', null);
    const fake = await fakeOllama();
    await seed(box, [llmMessage('nr-a', minute(70)), bankMessage('nr-bank', minute(69))]);
    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome.kind).toBe('rules_invalid');
    if (outcome.kind !== 'rules_invalid') throw new Error('expected rules_invalid');
    expect(outcome.message).toContain(join(dataDir, 'mailboxes', box.slug, 'rules.yaml'));
    expect(outcome.message).toContain('not found');
    expect(fake.requests()).toEqual([]);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('an invalid rules.yaml is rules_invalid naming the file and each problem path', async () => {
    const box = await newMailbox(
      'bad-rules',
      [
        'version: 2',
        'categories:',
        '  - name: Important',
        '    description: things to act on',
        'rules:',
        '  - kind: exact',
        '    match:',
        '      domain: [bank.example.test]',
        '    label: Missing',
        '',
      ].join('\n'),
    );
    const fake = await fakeOllama();
    await seed(box, [bankMessage('br-bank', minute(71))]);
    const outcome = await pass(box, testRuntime(fake, dataDir));
    if (outcome.kind !== 'rules_invalid')
      throw new Error(`expected rules_invalid, got ${outcome.kind}`);
    const path = join(dataDir, 'mailboxes', box.slug, 'rules.yaml');
    expect(outcome.message).toContain(`rules file ${path} has 3 problems: `);
    expect(outcome.message).toMatch(/line 1 version: unsupported rules version/);
    expect(outcome.message).toMatch(/line \d+ categories: /);
    expect(outcome.message).toMatch(/line 9 rules\[0\]\.label: label "Missing"/);
    expect(outcome.message).toContain(
      'See them all with: docker compose run --rm --no-deps worker sift config check',
    );
    expect(fake.requests()).toEqual([]);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('lists at most five problems, then how many more', () => {
    const issues = Array.from({ length: 7 }, (_, i) => ({
      path: ['categories', i, 'name'],
      message: `problem ${i}`,
      line: i + 2,
    }));
    const message = rulesProblemMessage('/data/mailboxes/a/rules.yaml', issues);
    expect(message).toBe(
      'rules file /data/mailboxes/a/rules.yaml has 7 problems: ' +
        'line 2 categories[0].name: problem 0; line 3 categories[1].name: problem 1; ' +
        'line 4 categories[2].name: problem 2; line 5 categories[3].name: problem 3; ' +
        'line 6 categories[4].name: problem 4; and 2 more. ' +
        'See them all with: docker compose run --rm --no-deps worker sift config check',
    );
  });

  it('an edited rules.yaml never re-classifies decided mail; the next decision uses version 2', async () => {
    const box = await newMailbox('edit-rules');
    const fake = await fakeOllama();
    const runtime = testRuntime(fake, dataDir);
    await seed(box, [bankMessage('er-1', minute(80)), llmMessage('er-2', minute(79))]);
    expect(await pass(box, runtime)).toMatchObject({ kind: 'done', labelled: 2 });

    await writeRules(
      dataDir,
      box.slug,
      BASIC_RULES.replace(
        'judgment:\n',
        'judgment:\n  - Anything from my landlord is Important.\n',
      ),
    );
    const before = fake.requests().length;
    expect(await pass(box, runtime)).toMatchObject({ kind: 'done', labelled: 0, review: 0 });
    expect(fake.requests()).toHaveLength(before);
    expect(await decisionsOf(db.adminUrl, box.id)).toHaveLength(2);
    expect((await ruleSetsOf(db.adminUrl, box.id)).map((r) => r.version)).toEqual([1]);

    const [freshId] = await seed(box, [bankMessage('er-3', minute(81))]);
    expect(await pass(box, runtime)).toMatchObject({ kind: 'done', labelled: 1 });
    const sets = await ruleSetsOf(db.adminUrl, box.id);
    expect(sets.map((r) => r.version)).toEqual([1, 2]);
    const decision = (await decisionsOf(db.adminUrl, box.id)).find((d) => d.messageId === freshId);
    expect(decision?.ruleSetId).toBe(sets[1]?.id);
    await expectAllReplayable(box, fake);
  });

  it('returns busy and writes nothing while another session holds the ingest lock', async () => {
    const box = await newMailbox('busy');
    const fake = await fakeOllama();
    await seed(box, [bankMessage('busy-bank', minute(90)), llmMessage('busy-a', minute(89))]);
    const held = await withIngestLock(appDb, box.id, () => pass(box, testRuntime(fake, dataDir)));
    expect(held).toEqual({ acquired: true, value: { kind: 'busy' } });
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect(fake.requests()).toEqual([]);
  });
});

describe('logs (SEC-01, T-03-26)', () => {
  it('no pass logged a subject, body, model reason or Ollama error text', () => {
    expect(allLines.length).toBeGreaterThan(10);
    const text = JSON.stringify(allLines);
    for (const value of mailText) expect(text).not.toContain(value);
    expect(text).not.toContain('Explodes on contact');
    expect(text).not.toContain('<<<EMAIL');
    for (const line of allLines) {
      for (const key of Object.keys(line.obj)) {
        expect([
          'mailbox',
          'message',
          'code',
          'status',
          'problems',
          'labelled',
          'review',
          'llmCalls',
          'examined',
          'failures',
          'ollamaFailed',
          'passes',
        ]).toContain(key);
      }
    }
  });
});
