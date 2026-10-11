// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AppDb, createAppDb, latestDecision, withIngestLock, withMailbox } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import { type ClassifyRuntime, classifyMailbox } from '../src/classify/run.ts';
import {
  CLASSIFY_CONFIRM_THRESHOLD,
  CLASSIFY_LOCK_WAIT_MS,
  type ClassifyCommandDeps,
  classifyCommand,
  run,
  type Selector,
  USAGE,
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
import { mailboxStatus, ownerSql, recordingLog, siftConfig } from './support/mailbox-harness.ts';

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

/** Run `sift classify` through run() with no environment: argument errors stop before any I/O. */
async function cli(
  ...args: string[]
): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(args, {
    env: {},
    cwd: dataDir,
    stdout: (line) => {
      stdout.push(line);
      output.push(line);
    },
    stderr: (line) => {
      stderr.push(line);
      output.push(line);
    },
  });
  return { code, stdout, stderr };
}

/** `count` LLM-bound messages one minute apart, newest first, ending at `newest`. */
function llmMessages(prefix: string, count: number, newest: Date): SeedMessage[] {
  return Array.from({ length: count }, (_, i) =>
    llmMessage(`${prefix}-${i}`, new Date(newest.getTime() - i * 60_000)),
  );
}

/** Hold the mailbox's ingest lock from another connection until release() is called. */
async function holdLock(box: Box): Promise<{ release(): Promise<void> }> {
  let release = (): void => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = (): void => {};
  const acquired = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holding = withIngestLock(appDb, box.id, async () => {
    held();
    await released;
  });
  await acquired;
  return {
    release: async () => {
      release();
      expect((await holding).acquired).toBe(true);
    },
  };
}

describe('sift classify arguments (D-17, P1 D-24)', () => {
  const id = randomUUID();
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  it.each([
    ['no selector', ['personal']],
    ['two selectors', ['personal', '--message', id, '--all-pending']],
    ['three selectors', ['personal', '--message', id, '--since', '2026-01-01', '--all-pending']],
    ['no slug', ['--all-pending']],
    ['two slugs', ['personal', 'work', '--all-pending']],
    ['a message id that is not a UUID', ['personal', '--message', 'not-a-uuid']],
    ['a month 13', ['personal', '--since', '2026-13-01']],
    ['a 31 February', ['personal', '--since', '2026-02-31']],
    ['a date not as YYYY-MM-DD', ['personal', '--since', '1/2/2026']],
    ['a future date', ['personal', '--since', tomorrow]],
    ['an unknown option', ['personal', '--all-pending', '--force']],
    ['a value for --all-pending', ['personal', '--all-pending=yes']],
  ])('%s exits 2 with the usage', async (_name, args) => {
    const result = await cli(...args);
    expect(result.code).toBe(2);
    expect(result.stdout).toEqual([]);
    expect(result.stderr.at(-1)).toBe(USAGE);
  });

  it('accepts today as --since', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Parsing passes, so it stops later, at the missing config file.
    const result = await cli('personal', '--since', today);
    expect(result.code).toBe(1);
    expect(result.stderr.join('\n')).not.toContain(USAGE);
  });

  it('pins the confirmation threshold and the lock wait', () => {
    expect(CLASSIFY_CONFIRM_THRESHOLD).toBe(20);
    expect(CLASSIFY_LOCK_WAIT_MS).toBe(300_000);
  });
});

describe('sift classify selection', () => {
  it('a pending message re-run with --message is also decided_by rerun', async () => {
    const box = await newMailbox('cli-pending-one');
    const fake = await answeringFake();
    const [id] = await seed(box, [llmMessage('lonely', '2026-09-01T08:00:00Z')]);

    const result = await classify(
      box,
      { kind: 'message', id: id as string },
      testRuntime(fake, dataDir),
    );
    expect(result.code).toBe(0);
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions.map((d) => [d.messageId, d.decidedBy])).toEqual([[id, 'rerun']]);
    for (const d of decisions) await expectReplayableDecision(db.adminUrl, d, fake);
  });

  it('an unknown message id, an unknown slug and a disabled mailbox exit 1 with nothing changed', async () => {
    const box = await newMailbox('cli-refusals');
    const fake = await answeringFake();
    const runtime = testRuntime(fake, dataDir);
    const missing = randomUUID();

    const unknownMessage = await classify(box, { kind: 'message', id: missing }, runtime);
    expect(unknownMessage.code).toBe(1);
    expect(unknownMessage.stderr).toEqual([
      `sift classify: message ${missing} is not an eligible message of ${box.slug} with a live location; nothing changed`,
    ]);

    const unknownSlug = await classify(
      { ...box, slug: `${box.slug}-x` },
      { kind: 'pending' },
      runtime,
    );
    expect(unknownSlug.code).toBe(1);
    expect(unknownSlug.stderr).toEqual([`sift classify: no mailbox ${box.slug}-x`]);

    await seed(box, [llmMessage('disabled', '2026-09-01T08:00:00Z')]);
    await ownerSql(db.ownerUrl, box.id, 'update mailbox set disabled_at = now() where id = $1', [
      box.id,
    ]);
    const disabled = await classify(box, { kind: 'pending' }, runtime);
    expect(disabled.code).toBe(1);
    expect(disabled.stderr).toEqual([
      `sift classify: mailbox ${box.slug} is disabled; nothing changed`,
    ]);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect(fake.requests()).toEqual([]);
  });

  it('--since selects messages on or after the date, decided or not; older ones get nothing', async () => {
    const box = await newMailbox('cli-since');
    const fake = await answeringFake();
    const runtime = testRuntime(fake, dataDir);
    const [oldA, oldB, onDay, later] = await seed(box, [
      llmMessage('old-a', '2026-08-30T12:00:00Z'),
      llmMessage('old-b', '2026-08-31T23:59:59Z'),
      llmMessage('on-day', '2026-09-01T00:00:00Z'),
      bankMessage('later', '2026-09-02T10:00:00Z'),
    ]);
    await workerPass(box, runtime);
    const [fresh] = await seed(box, [llmMessage('undecided', '2026-09-03T10:00:00Z')]);

    const result = await classify(
      box,
      { kind: 'since', since: new Date('2026-09-01T00:00:00Z') },
      runtime,
    );
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      `Found 3 messages to classify in ${box.slug}.`,
      `Classified 3 messages of ${box.slug}: 3 labelled, 0 review.`,
    ]);
    const decisions = await decisionsOf(db.adminUrl, box.id);
    const of = (id: string | undefined) =>
      decisions.filter((d) => d.messageId === id).map((d) => d.decidedBy);
    expect(of(oldA)).toEqual(['worker']);
    expect(of(oldB)).toEqual(['worker']);
    expect(of(onDay)).toEqual(['worker', 'rerun']);
    expect(of(later)).toEqual(['worker', 'rerun']);
    expect(of(fresh)).toEqual(['rerun']);
    for (const d of decisions) await expectReplayableDecision(db.adminUrl, d, fake);
  });
});

describe('sift classify names a message Ollama failed on alone (CR-01, T-03-74)', () => {
  /** A fake that answers HTTP 500 with `errorText` for `sender` and okAnswer otherwise. */
  async function failingFor(sender: string, errorText: string): Promise<FakeOllama> {
    const reason = `Fake reason ${randomUUID().slice(0, 8)}.`;
    mailText.push(reason, errorText);
    return fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes(`from_address: ${sender}`)
          ? { status: 500, json: { error: errorText } }
          : okAnswer('Noise', 0.9, reason),
    });
  }

  it('a 500 on one message: its id on stderr, the others classified, exit 0', async () => {
    const box = await newMailbox('cli-poison-many');
    const poison = llmMessage('poison', '2026-09-02T08:01:00Z');
    const errorText = `runner crashed on this prompt ${randomUUID()}`;
    const fake = await failingFor(poison.from, errorText);
    const [newer] = await seed(box, [llmMessage('poison-newer', '2026-09-02T08:02:00Z')]);
    const [poisonId] = await seed(box, [poison]);
    const [older] = await seed(box, [llmMessage('poison-older', '2026-09-02T08:00:00Z')]);

    const result = await classify(box, { kind: 'pending' }, testRuntime(fake, dataDir));
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([
      `message ${poisonId}: Ollama failed on this message (HTTP 500); skipped`,
    ]);
    expect(result.stdout.at(-1)).toBe(
      `Classified 2 messages of ${box.slug}: 2 labelled, 0 review; 1 skipped.`,
    );
    const decided = (await decisionsOf(db.adminUrl, box.id)).map((d) => d.messageId).sort();
    expect(decided).toEqual([newer, older].sort());
    for (const line of [...result.stdout, ...result.stderr]) {
      expect(line).not.toContain(errorText);
    }
  });

  it('a 500 on the one message --message selects: its id on stderr, exit 0, no decision', async () => {
    const box = await newMailbox('cli-poison');
    const poison = llmMessage('poison', '2026-09-02T08:00:00Z');
    const errorText = `runner crashed on this prompt ${randomUUID()}`;
    const fake = await failingFor(poison.from, errorText);
    const [id] = await seed(box, [poison]);

    const result = await classify(
      box,
      { kind: 'message', id: id as string },
      testRuntime(fake, dataDir),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([
      `message ${id}: Ollama failed on this message (HTTP 500); skipped`,
    ]);
    expect(result.stdout.at(-1)).toBe(
      `Classified 0 messages of ${box.slug}: 0 labelled, 0 review; 1 skipped.`,
    );
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('a timeout on one message: its id and (timeout) on stderr, the others classified', async () => {
    const box = await newMailbox('cli-slow');
    const slow = llmMessage('slow', '2026-09-02T09:01:00Z');
    const reason = `Fake reason ${randomUUID().slice(0, 8)}.`;
    mailText.push(reason);
    const fake = await fakeOllama({
      chat: (request) =>
        JSON.stringify(request).includes(`from_address: ${slow.from}`)
          ? { hang: true }
          : okAnswer('Noise', 0.9, reason),
    });
    const [slowId] = await seed(box, [slow]);
    await seed(box, [
      llmMessage('slow-a', '2026-09-02T09:00:00Z'),
      llmMessage('slow-b', '2026-09-02T08:59:00Z'),
    ]);

    const result = await classify(
      box,
      { kind: 'pending' },
      testRuntime(fake, dataDir, { timeoutMs: 2000 }),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([
      `message ${slowId}: Ollama failed on this message (timeout); skipped`,
    ]);
    expect(result.stdout.at(-1)).toBe(
      `Classified 2 messages of ${box.slug}: 2 labelled, 0 review; 1 skipped.`,
    );
  });
});

describe('sift classify count and confirmation (D-17)', () => {
  const total = 30;
  let box: Box;
  let fake: FakeOllama;
  let runtime: ClassifyRuntime;

  beforeAll(async () => {
    box = await newMailbox('cli-confirm');
    const reason = `Confirm reason ${randomUUID().slice(0, 8)}.`;
    mailText.push(reason);
    // Every fifth answer is below the threshold: review low_confidence.
    fake = await fakeOllama({
      chat: (_request, index) => okAnswer('Noise', index % 5 === 0 ? 0.5 : 0.9, reason),
    });
    runtime = testRuntime(fake, dataDir);
    await seed(box, llmMessages('confirm', total, new Date('2026-09-20T12:00:00Z')));
  });

  it('a declined prompt prints the count and Nothing changed., exits 0 and writes nothing', async () => {
    const result = await classify(box, { kind: 'pending' }, runtime, { answer: false });
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.confirmed).toEqual([total]);
    expect(result.stdout).toEqual([
      `Found ${total} messages to classify in ${box.slug}.`,
      'Nothing changed.',
    ]);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect(fake.requests()).toEqual([]);
  });

  it('does not hold the ingest lock while it asks', async () => {
    let atPrompt: unknown;
    const result = await classify(box, { kind: 'pending' }, runtime, {
      confirm: async () => {
        atPrompt = await withIngestLock(appDb, box.id, async () => 'free');
        return false;
      },
    });
    expect(result.code).toBe(0);
    expect(atPrompt).toEqual({ acquired: true, value: 'free' });
  });

  it('a confirmed run decides every message as rerun with no per-pass cap', async () => {
    const result = await classify(box, { kind: 'pending' }, runtime);
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.confirmed).toEqual([total]);
    expect(result.stdout).toEqual([
      `Found ${total} messages to classify in ${box.slug}.`,
      `Classified ${total} messages of ${box.slug}: 24 labelled, 6 review.`,
    ]);
    // More than the worker's 25 calls per pass: the re-run has no cap (D-18 is the worker's).
    expect(fake.requests().filter((r) => r.path === '/api/chat')).toHaveLength(total);
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions).toHaveLength(total);
    expect(new Set(decisions.map((d) => d.decidedBy))).toEqual(new Set(['rerun']));
    expect(decisions.filter((d) => d.reviewReason === 'low_confidence')).toHaveLength(6);
  });

  it(`asks nothing for ${CLASSIFY_CONFIRM_THRESHOLD} messages or fewer`, async () => {
    const small = await newMailbox('cli-small');
    const smallFake = await answeringFake();
    await seed(small, llmMessages('small', 3, new Date('2026-09-20T12:00:00Z')));
    const result = await classify(small, { kind: 'pending' }, testRuntime(smallFake, dataDir), {
      answer: false,
    });
    expect(result.code).toBe(0);
    expect(result.confirmed).toEqual([]);
    expect(result.stdout.at(-1)).toBe(
      `Classified 3 messages of ${small.slug}: 3 labelled, 0 review.`,
    );
  });

  it('--all-pending skips messages the worker decided while the owner was asked', async () => {
    const racing = await newMailbox('cli-race');
    const smallFake = await answeringFake();
    const down = await fakeOllama();
    await down.close();
    await seed(racing, [
      ...llmMessages('race', 18, new Date('2026-09-20T12:00:00Z')),
      bankMessage('race-a', '2026-09-19T12:00:00Z'),
      bankMessage('race-b', '2026-09-19T11:00:00Z'),
      bankMessage('race-c', '2026-09-19T10:00:00Z'),
    ]);
    const result = await classify(racing, { kind: 'pending' }, testRuntime(smallFake, dataDir), {
      confirm: async () => {
        // A worker pass with Ollama down decides the three exact-rule messages only.
        const outcome = await classifyMailbox({
          db: appDb,
          mailbox: racing,
          model: FAKE_MODEL,
          threshold: 0.75,
          runtime: testRuntime(down, dataDir),
          signal: new AbortController().signal,
          log: recordingLog(),
        });
        expect(outcome).toMatchObject({ kind: 'infra', labelled: 3 });
        return true;
      },
    });
    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      `Found 21 messages to classify in ${racing.slug}.`,
      `Classified 18 messages of ${racing.slug}: 18 labelled, 0 review; 3 skipped.`,
    ]);
    const decisions = await decisionsOf(db.adminUrl, racing.id);
    expect(decisions.filter((d) => d.decidedBy === 'worker')).toHaveLength(3);
    expect(decisions.filter((d) => d.decidedBy === 'rerun')).toHaveLength(18);
    expect(new Set(decisions.map((d) => d.messageId)).size).toBe(21);
  });
});

describe('sift classify alongside the worker, outages and Ctrl-C', () => {
  it('waits for the ingest lock, saying so once, then refuses with nothing written (P2 D-03)', async () => {
    const box = await newMailbox('cli-locked');
    const fake = await answeringFake();
    await seed(box, [llmMessage('locked', '2026-09-01T08:00:00Z')]);
    const lock = await holdLock(box);
    let result: CommandRun;
    try {
      result = await classify(box, { kind: 'pending' }, testRuntime(fake, dataDir), {
        // Longer than one 2 s retry pause, so a second wait would show a second line.
        lockWaitMs: 2_500,
      });
    } finally {
      await lock.release();
    }
    expect(result.code).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr).toEqual([
      `sift classify: waiting for the worker to release ${box.slug} (it may be classifying; Ctrl-C to stop)`,
      `sift classify: the worker is classifying ${box.slug} right now; try again in a few minutes`,
    ]);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
    expect(fake.requests()).toEqual([]);
  });

  it('starts once the worker releases the lock within the wait', async () => {
    const box = await newMailbox('cli-wait');
    const fake = await answeringFake();
    await seed(box, [llmMessage('wait', '2026-09-01T08:00:00Z')]);
    const lock = await holdLock(box);
    const running = classify(box, { kind: 'pending' }, testRuntime(fake, dataDir), {
      lockWaitMs: 30_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await lock.release();
    const result = await running;
    expect(result.code).toBe(0);
    expect(result.stderr).toHaveLength(1);
    expect(result.stdout.at(-1)).toBe(`Classified 1 message of ${box.slug}: 1 labelled, 0 review.`);
  });

  it('an Ollama outage stops the command with the owner message and the counts; no status write', async () => {
    const box = await newMailbox('cli-outage');
    const fake = await answeringFake();
    let chats = 0;
    const fetchThenStop: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.endsWith('/api/chat')) {
        chats += 1;
        if (chats === 3) await fake.close();
      }
      return fetch(input, init);
    };
    await seed(box, llmMessages('outage', 5, new Date('2026-09-10T12:00:00Z')));
    const statusBefore = await mailboxStatus(db.adminUrl, box.id);

    const result = await classify(
      box,
      { kind: 'pending' },
      testRuntime(fake, dataDir, { fetch: fetchThenStop }),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toEqual([`Found 5 messages to classify in ${box.slug}.`]);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain('Ollama unreachable at ');
    expect(result.stderr[1]).toBe('sift classify: classified 2 of 5; 3 left');
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions.map((d) => d.decidedBy)).toEqual(['rerun', 'rerun']);
    expect(await mailboxStatus(db.adminUrl, box.id)).toEqual(statusBefore);
  });

  it('an invalid rules.yaml exits 1 with positioned issues and no Ollama request', async () => {
    const box = await newMailbox(
      'cli-rules',
      'version: 1\ncategories:\n  - name: Important\n    description: x\nrules:\n  - kind: exact\n    name: r\n    match:\n      domain: [a.example.test]\n    label: Missing\n',
    );
    const fake = await answeringFake();
    await seed(box, [llmMessage('rules', '2026-09-01T08:00:00Z')]);
    const result = await classify(box, { kind: 'pending' }, testRuntime(fake, dataDir));
    expect(result.code).toBe(1);
    expect(result.stdout).toEqual([]);
    expect(result.stderr.length).toBeGreaterThan(0);
    for (const line of result.stderr) {
      expect(line).toMatch(new RegExp(`mailboxes/${box.slug}/rules\\.yaml:\\d+`));
    }
    expect(fake.requests()).toEqual([]);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });

  it('Ctrl-C during a hanging chat call stops it with no decision for that message', async () => {
    const box = await newMailbox('cli-abort');
    const fake = await fakeOllama({ chat: [{ hang: true }] });
    await seed(box, [llmMessage('abort', '2026-09-01T08:00:00Z')]);
    const controller = new AbortController();
    const running = classify(box, { kind: 'pending' }, testRuntime(fake, dataDir), {
      signal: controller.signal,
    });
    while (!fake.requests().some((r) => r.path === '/api/chat')) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    controller.abort();
    const result = await running;
    expect(result.code).toBe(1);
    expect(result.stderr).toEqual(['sift classify: stopped; run it again to finish']);
    expect(await decisionsOf(db.adminUrl, box.id)).toEqual([]);
  });
});

describe('output (T-03-47)', () => {
  it('no command printed a subject, sender, body or model reason', () => {
    expect(output.length).toBeGreaterThan(20);
    const text = output.join('\n');
    for (const value of mailText) expect(text).not.toContain(value);
    expect(text).not.toContain('<<<EMAIL');
  });
});
