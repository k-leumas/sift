// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppDb, createAppDb, latestDecision, withMailbox } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import { type ClassifyRuntime, classifyMailbox } from '../src/classify/run.ts';
import {
  type ClassifyCommandDeps,
  classifyCommand,
  type Selector,
} from '../src/commands/classify.ts';
import {
  BASIC_RULES,
  decisionsOf,
  expectReplayableDecision,
  type SeedMessage,
  seedPendingMessages,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import { FAKE_MODEL, type FakeOllama, okAnswer, startFakeOllama } from './support/fake-ollama.ts';
import { recordingLog, siftConfig } from './support/mailbox-harness.ts';

/**
 * `sift classify` (03-12, D-17) against a real database as sift_app and the
 * scripted fake Ollama: explicit re-runs append decided_by rerun decisions
 * through the worker's own classifier, counted, confirmed and serialised with
 * the worker by the ingest lock.
 */

let db: TestDatabase;
let appDb: AppDb;
let dataDir: string;
const fakes: FakeOllama[] = [];
/** Every stdout and stderr line any command in this file wrote, for the final scan. */
const output: string[] = [];
/** Every subject, sender and body seeded in this file, and every reason a fake sent. */
const mailText: string[] = [];

beforeAll(async () => {
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  dataDir = await mkdtemp(join(tmpdir(), 'sift-classify-cli-'));
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

/** A fake that answers every chat with `category` at 0.9 and a reason unique to this file. */
async function answeringFake(category = 'Noise'): Promise<FakeOllama> {
  const reason = `Fake reason ${randomUUID().slice(0, 8)}.`;
  mailText.push(reason);
  return fakeOllama({ chat: () => okAnswer(category, 0.9, reason) });
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

/** Seed messages and remember their subjects, senders and bodies for the output scan. */
async function seed(box: Box, messages: readonly SeedMessage[]): Promise<string[]> {
  for (const m of messages) mailText.push(m.subject, m.body, m.from);
  return seedPendingMessages(appDb, box.id, messages);
}

/** A message the LLM tier gets (no exact rule matches it). */
function llmMessage(name: string, internalDate: Date | string): SeedMessage {
  return {
    from: `${name}-${randomUUID().slice(0, 6)}@letters.example.test`,
    subject: `Subject of ${name} ${randomUUID().slice(0, 6)}`,
    body: `Body text of ${name} ${randomUUID().slice(0, 6)}.`,
    internalDate,
  };
}

/** A message the bank.example.test exact rule decides. */
function bankMessage(name: string, internalDate: Date | string): SeedMessage {
  return {
    from: 'alerts@bank.example.test',
    subject: `Bank ${name} ${randomUUID().slice(0, 6)}`,
    body: `Bank body ${name} ${randomUUID().slice(0, 6)}.`,
    internalDate,
  };
}

/** One worker pass over the mailbox (decided_by worker). */
async function workerPass(box: Box, runtime: ClassifyRuntime): Promise<void> {
  const outcome = await classifyMailbox({
    db: appDb,
    mailbox: box,
    model: FAKE_MODEL,
    threshold: 0.75,
    runtime,
    signal: new AbortController().signal,
    log: recordingLog(),
  });
  expect(outcome.kind).toBe('done');
}

interface CommandRun {
  code: 0 | 1;
  stdout: string[];
  stderr: string[];
  confirmed: number[];
}

/** Run classifyCommand with captured output; confirm answers `confirm` (default: yes). */
async function classify(
  box: Box,
  selector: Selector,
  runtime: ClassifyRuntime,
  overrides: Partial<ClassifyCommandDeps> & { answer?: boolean } = {},
): Promise<CommandRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const confirmed: number[] = [];
  const { answer = true, ...rest } = overrides;
  const code = await classifyCommand({
    db: appDb,
    config: siftConfig(),
    env: {},
    slug: box.slug,
    selector,
    dataDir,
    runtime,
    confirm: async (count) => {
      confirmed.push(count);
      return answer;
    },
    stdout: (line) => {
      stdout.push(line);
      output.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
      output.push(line);
    },
    ...rest,
  });
  return { code, stdout, stderr, confirmed };
}

describe('sift classify --message (tracer)', () => {
  it('appends a rerun decision next to the worker one; the rerun is the current decision', async () => {
    const box = await newMailbox('cli-tracer');
    const fake = await answeringFake();
    const runtime = testRuntime(fake, dataDir);
    const [bankId, llmId] = await seed(box, [
      bankMessage('one', '2026-10-01T10:00:00Z'),
      llmMessage('two', '2026-10-01T09:00:00Z'),
    ]);
    await workerPass(box, runtime);
    const before = await decisionsOf(db.adminUrl, box.id);
    expect(before.map((d) => d.decidedBy)).toEqual(['worker', 'worker']);
    const workerDecision = before.find((d) => d.messageId === llmId);

    const run = await classify(box, { kind: 'message', id: llmId as string }, runtime);
    expect(run.stderr).toEqual([]);
    expect(run.code).toBe(0);
    expect(run.confirmed).toEqual([]);
    expect(run.stdout).toEqual([
      `Found 1 message to classify in ${box.slug}.`,
      `Classified 1 message of ${box.slug}: 1 labelled, 0 review.`,
    ]);

    const after = await decisionsOf(db.adminUrl, box.id);
    const forLlm = after.filter((d) => d.messageId === llmId);
    expect(forLlm.map((d) => d.decidedBy)).toEqual(['worker', 'rerun']);
    // The earlier decision is untouched (append-only, D-17).
    expect(forLlm[0]).toEqual(workerDecision);
    expect(after.filter((d) => d.messageId === bankId)).toHaveLength(1);

    const current = await withMailbox(appDb, box.id, (s) => latestDecision(s, llmId as string));
    expect(current?.id).toBe(forLlm[1]?.id);
    expect(current?.decidedBy).toBe('rerun');
    for (const decision of forLlm) await expectReplayableDecision(db.adminUrl, decision, fake);
  });
});
