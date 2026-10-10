// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppDb, createAppDb, withIngestLock } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import { createOllamaClient, type LlmClient } from '../src/classify/ollama-client.ts';
import {
  CLASSIFY_CHUNK_SIZE,
  type ClassifyOutcome,
  type ClassifyRuntime,
  classifyMailbox,
  LLM_CALLS_PER_TICK,
  MAX_CONSECUTIVE_MESSAGE_FAILURES,
  rulesProblemMessage,
} from '../src/classify/run.ts';
import {
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

  it('a 500 on the third call stops LLM work for the pass; exact rules keep deciding', async () => {
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
    const llmIds = await seed(box, [
      llmMessage('se-a', minute(20)),
      llmMessage('se-b', minute(19)),
      llmMessage('se-c', minute(18)),
      llmMessage('se-d', minute(17)),
    ]);
    const [bankId] = await seed(box, [bankMessage('se-bank', minute(16))]);

    const outcome = await pass(box, testRuntime(fake, dataDir));
    expect(outcome).toMatchObject({ kind: 'infra', code: 'server_error', labelled: 3, review: 0 });
    if (outcome.kind !== 'infra') throw new Error('expected infra');
    expect(outcome.message).toContain('failed (HTTP 500)');
    expect(outcome.message).not.toContain(errorText);
    expect(chatRequests(fake)).toHaveLength(3);
    const decided = (await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId).sort();
    expect(decided).toEqual([llmIds[0], llmIds[1], bankId].sort());
    expect((await pendingIdsOf(db.adminUrl, box.id)).sort()).toEqual([llmIds[2], llmIds[3]].sort());
    await expectAllReplayable(box, fake);
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
        ]).toContain(key);
      }
    }
  });
});
