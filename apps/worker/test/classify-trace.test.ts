// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LLM_SPAN_OPTIONS, parseDecisionSpans } from '@sift/core/classify';
import { parseRulesText } from '@sift/core/rules';
import { type AppDb, createAppDb, DECISION_BODY_RETENTION_MS } from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import { classifyMailbox } from '../src/classify/run.ts';
import {
  BASIC_RULES,
  bodyExpiryOf,
  decisionsOf,
  expectReplayableDecision,
  LABELLED_OUTSIDE_SNAPSHOT_SQL,
  labelledOutsideSnapshot,
  type StoredDecision,
  seedPendingMessages,
  testRuntime,
  writeRules,
} from './support/classify-harness.ts';
import {
  contentAnswer,
  FAKE_DIGEST,
  FAKE_MODEL,
  FAKE_VERSION,
  type FakeOllama,
  type FakeResponse,
  okAnswer,
  startFakeOllama,
} from './support/fake-ollama.ts';
import { recordingLog } from './support/mailbox-harness.ts';

/**
 * Every way a decision can be made leaves a complete, closed and replayable
 * trace (E8 matrix, E1 invariant, E10 threshold, E14 inclusion; TRC-01,
 * TRC-03, TRC-04, TRC-06). Each path runs through classifyMailbox against a
 * real database and the fake Ollama, then the stored row is checked.
 */

let db: TestDatabase;
let appDb: AppDb;
let dataDir: string;
let fake: FakeOllama;

/** How many chat calls each subject has had, so a script can answer per message and attempt. */
const callsBySubject = new Map<string, number>();

/** Scripted answers by subject; `attempt` is 0 for the first call of that message. */
const SCRIPT: Record<string, (attempt: number) => FakeResponse> = {
  'path llm labelled': () => okAnswer('Receipts', 0.9, 'An order confirmation.'),
  'path low confidence': () => okAnswer('Noise', 0.5, 'Might be a promotion.'),
  'path invalid twice': () => contentAnswer('{"category": "Noise"'),
  'path out of category twice': () => okAnswer('Spam', 0.9, 'Looks like spam.'),
  'path bad then good': (attempt) =>
    attempt === 0 ? contentAnswer('not json') : okAnswer('Important', 0.8, 'A personal note.'),
  'path threshold 0.85': () => okAnswer('Receipts', 0.85, 'Probably an invoice.'),
  'path threshold 0.9': () => okAnswer('Receipts', 0.9, 'An invoice.'),
};

beforeAll(async () => {
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
  dataDir = await mkdtemp(join(tmpdir(), 'sift-classify-trace-'));
  fake = await startFakeOllama({
    // Only the over-long body crosses this; every other request is far below it.
    charBudget: 5000,
    chat: (request) => {
      const user =
        (request as { messages?: { role: string; content: string }[] }).messages?.[1]?.content ??
        '';
      const subject = /^subject: (.*)$/m.exec(user)?.[1] ?? '';
      const attempt = callsBySubject.get(subject) ?? 0;
      callsBySubject.set(subject, attempt + 1);
      const answer = SCRIPT[subject];
      if (answer === undefined) throw new Error(`no scripted answer for subject "${subject}"`);
      return answer(attempt);
    },
  });
});

afterAll(async () => {
  await fake?.close();
  await appDb?.close();
  await db?.drop();
  if (dataDir !== undefined) await rm(dataDir, { recursive: true, force: true });
});

async function newMailbox(prefix: string): Promise<{ id: string; slug: string }> {
  const slug = `${prefix}-${randomUUID().slice(0, 8)}`;
  const id = (await seedMailboxes(db.ownerUrl, [slug]))[slug] as string;
  await writeRules(dataDir, slug, BASIC_RULES);
  return { id, slug };
}

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 2, 9, minute));

/** The validated BASIC_RULES, as the rule_set snapshot holds them. */
function basicSnapshot(): {
  categories: { name: string; description: string }[];
  judgment: string[];
} {
  const loaded = parseRulesText(BASIC_RULES, 'BASIC_RULES');
  if (!loaded.ok) throw new Error('BASIC_RULES must be valid');
  return loaded.rules;
}

/** The typed columns agree with the spans (D-27). */
function expectColumnsMatchSpans(decision: StoredDecision): void {
  const spans = parseDecisionSpans(decision.spans);
  const action = spans[spans.length - 1];
  if (action?.kind !== 'action') throw new Error('no action span');
  expect(decision.outcome).toBe(action.intent.type === 'label' ? 'labelled' : 'review');
  expect(decision.category).toBe(action.intent.type === 'label' ? action.intent.label : null);
  expect(decision.reviewReason).toBe(action.intent.type === 'review' ? action.intent.reason : null);
  const llm = spans.length === 4 ? spans[2] : undefined;
  if (llm?.kind === 'llm') {
    expect(decision.tier).toBe('llm');
    expect(decision.model).toBe(llm.model);
    expect(decision.confidence).toBe(llm.confidence);
    expect(decision.promptVersionId).not.toBeNull();
  } else {
    expect(decision.tier).toBe('exact_rules');
    expect(decision.model).toBeNull();
    expect(decision.confidence).toBeNull();
    expect(decision.promptVersionId).toBeNull();
  }
}

/** The llm span carries the full replay context (E8, E14). */
function expectLlmSpanContext(
  decision: StoredDecision,
  threshold: number,
  responseModel: string | null = FAKE_MODEL,
): void {
  const spans = parseDecisionSpans(decision.spans);
  const llm = spans[2];
  if (llm?.kind !== 'llm') throw new Error('expected an llm span');
  const snapshot = basicSnapshot();
  // E14 inclusion: every category with its description and every judgment line, verbatim.
  expect(llm.categories).toEqual(
    snapshot.categories.map((c) => ({ name: c.name, description: c.description })),
  );
  expect(llm.judgment_rules).toEqual(snapshot.judgment);
  expect(llm.examples).toEqual([]);
  expect(llm.threshold).toBe(threshold);
  expect(llm.model).toBe(FAKE_MODEL);
  // Null only when Ollama refused the prompt (HTTP 400): that answer names no model.
  expect(llm.response_model).toBe(responseModel);
  expect(llm.model_digest).toBe(FAKE_DIGEST);
  expect(llm.ollama_version).toBe(FAKE_VERSION);
  expect(llm.options).toEqual({ ...LLM_SPAN_OPTIONS });
}

interface Expected {
  subject: string;
  outcome: 'labelled' | 'review';
  category: string | null;
  confidence: number | null;
  tier: 'exact_rules' | 'llm';
  reviewReason: string | null;
  attempts: number;
}

describe('every decision path is replayable and closed', () => {
  const decided = new Map<string, StoredDecision>();
  const expected: Expected[] = [
    {
      subject: 'path exact rule',
      outcome: 'labelled',
      category: 'Important',
      confidence: null,
      tier: 'exact_rules',
      reviewReason: null,
      attempts: 0,
    },
    {
      subject: 'path llm labelled',
      outcome: 'labelled',
      category: 'Receipts',
      confidence: 0.9,
      tier: 'llm',
      reviewReason: null,
      attempts: 1,
    },
    {
      subject: 'path low confidence',
      outcome: 'review',
      category: null,
      confidence: 0.5,
      tier: 'llm',
      reviewReason: 'low_confidence',
      attempts: 1,
    },
    {
      subject: 'path invalid twice',
      outcome: 'review',
      category: null,
      confidence: null,
      tier: 'llm',
      reviewReason: 'invalid_output',
      attempts: 2,
    },
    {
      subject: 'path out of category twice',
      outcome: 'review',
      category: null,
      confidence: null,
      tier: 'llm',
      reviewReason: 'out_of_category',
      attempts: 2,
    },
    {
      subject: 'path bad then good',
      outcome: 'labelled',
      category: 'Important',
      confidence: 0.8,
      tier: 'llm',
      reviewReason: null,
      attempts: 2,
    },
    {
      subject: 'path input too long',
      outcome: 'review',
      category: null,
      confidence: null,
      tier: 'llm',
      reviewReason: 'input_too_long',
      attempts: 1,
    },
  ];
  let mailboxId: string;
  let ids: Map<string, string>;

  beforeAll(async () => {
    const box = await newMailbox('trace');
    mailboxId = box.id;
    const seeded = await seedPendingMessages(
      appDb,
      box.id,
      expected.map((e, i) => ({
        from:
          e.tier === 'exact_rules' ? 'alerts@bank.example.test' : `sender${i}@shop.example.test`,
        fromName: `Sender ${i}`,
        subject: e.subject,
        body:
          e.subject === 'path input too long'
            ? 'A very long newsletter paragraph. '.repeat(200)
            : `Body of ${e.subject}.`,
        internalDate: at(i),
        attachments: i % 2 === 0 ? [`file-${i}.pdf`] : [],
      })),
    );
    ids = new Map(expected.map((e, i) => [e.subject, seeded[i] as string]));

    const outcome = await classifyMailbox({
      db: appDb,
      mailbox: box,
      model: FAKE_MODEL,
      threshold: 0.75,
      runtime: testRuntime(fake, dataDir),
      signal: new AbortController().signal,
      log: recordingLog(),
    });
    expect(outcome).toMatchObject({ kind: 'done', labelled: 3, review: 4, failures: 0 });
    for (const decision of await decisionsOf(db.adminUrl, box.id)) {
      const subject = [...ids].find(([, id]) => id === decision.messageId)?.[0];
      if (subject !== undefined) decided.set(subject, decision);
    }
  });

  for (const path of [
    'path exact rule',
    'path llm labelled',
    'path low confidence',
    'path invalid twice',
    'path out of category twice',
    'path bad then good',
    'path input too long',
  ]) {
    it(`${path}: columns, spans and replay`, async () => {
      const want = expected.find((e) => e.subject === path) as Expected;
      const decision = decided.get(path);
      if (decision === undefined) throw new Error(`no decision for ${path}`);
      expect(decision).toMatchObject({
        outcome: want.outcome,
        category: want.category,
        confidence: want.confidence,
        tier: want.tier,
        reviewReason: want.reviewReason,
        model: want.tier === 'llm' ? FAKE_MODEL : null,
        decidedBy: 'worker',
      });
      expectColumnsMatchSpans(decision);
      await expectReplayableDecision(db.adminUrl, decision, fake);

      const spans = parseDecisionSpans(decision.spans);
      expect(spans[1]).toEqual({ kind: 'classifier', status: 'skipped', reason: 'not trained' });
      if (want.tier === 'llm') {
        expectLlmSpanContext(
          decision,
          0.75,
          want.reviewReason === 'input_too_long' ? null : FAKE_MODEL,
        );
        const llm = spans[2];
        if (llm?.kind !== 'llm') throw new Error('expected an llm span');
        expect(llm.attempts).toHaveLength(want.attempts);
      } else {
        expect(spans).toHaveLength(3);
      }

      // D-32: the first decision starts the body's 7-day clock.
      const expiry = await bodyExpiryOf(db.adminUrl, mailboxId, decision.messageId);
      expect(expiry?.getTime()).toBe(decision.createdAt.getTime() + DECISION_BODY_RETENTION_MS);
    });
  }
});

describe('the fenced email comes from the stored message (D-21, Pattern 6)', () => {
  it('carries the From display name and the attachment names', () => {
    const user = fake
      .chatBodies()
      .map((b) => (b.messages as { role: string; content: string }[])[1]?.content ?? '')
      .find((content) => content.includes('subject: path llm labelled'));
    expect(user).toContain('from_address: sender1@shop.example.test');
    expect(user).toContain('from_name: Sender 1');
    expect(user).toContain('attachments: \n');
    const withFile = fake
      .chatBodies()
      .map((b) => (b.messages as { role: string; content: string }[])[1]?.content ?? '')
      .find((content) => content.includes('subject: path low confidence'));
    expect(withFile).toContain('from_name: Sender 2');
    expect(withFile).toContain('attachments: file-2.pdf\n');
  });
});

describe('a configured threshold of 0.9 moves the boundary (E10)', () => {
  it('0.85 is review low_confidence and 0.9 is labelled, both replayable', async () => {
    const box = await newMailbox('threshold');
    const [below, atThreshold] = await seedPendingMessages(appDb, box.id, [
      {
        from: 'billing@shop.example.test',
        subject: 'path threshold 0.85',
        body: 'Your invoice is attached.',
        internalDate: at(30),
      },
      {
        from: 'billing@shop.example.test',
        subject: 'path threshold 0.9',
        body: 'Your second invoice is attached.',
        internalDate: at(31),
      },
    ]);
    const outcome = await classifyMailbox({
      db: appDb,
      mailbox: box,
      model: FAKE_MODEL,
      threshold: 0.9,
      runtime: testRuntime(fake, dataDir),
      signal: new AbortController().signal,
      log: recordingLog(),
    });
    expect(outcome).toMatchObject({ kind: 'done', labelled: 1, review: 1 });
    const decisions = await decisionsOf(db.adminUrl, box.id);
    expect(decisions.find((d) => d.messageId === below)).toMatchObject({
      outcome: 'review',
      reviewReason: 'low_confidence',
      category: null,
      confidence: 0.85,
    });
    expect(decisions.find((d) => d.messageId === atThreshold)).toMatchObject({
      outcome: 'labelled',
      category: 'Receipts',
      confidence: 0.9,
    });
    for (const decision of decisions) {
      expectColumnsMatchSpans(decision);
      expectLlmSpanContext(decision, 0.9);
      await expectReplayableDecision(db.adminUrl, decision, fake);
      const expiry = await bodyExpiryOf(db.adminUrl, box.id, decision.messageId);
      expect(expiry?.getTime()).toBe(decision.createdAt.getTime() + DECISION_BODY_RETENTION_MS);
    }
  });
});

describe('E1 invariant over the whole database', () => {
  it('no labelled decision has a category outside its own rule_set snapshot', async () => {
    const admin = await connect(db.adminUrl);
    try {
      const { rows } = await admin.query<{ n: number }>('select count(*)::int as n from decision');
      // The paths above wrote nine decisions; the invariant must look at real rows.
      expect(rows[0]?.n).toBe(9);
    } finally {
      await admin.end();
    }
    expect(await labelledOutsideSnapshot(db.adminUrl)).toBe(0);
  });

  it('positive control: the invariant query counts a snapshot that lost its categories', async () => {
    const admin = await connect(db.adminUrl);
    try {
      await admin.query('begin');
      const { rows } = await admin.query<{ mailbox_id: string }>(
        "select mailbox_id from decision where outcome = 'labelled' limit 1",
      );
      const mailbox = rows[0]?.mailbox_id;
      if (mailbox === undefined) throw new Error('no labelled decision to break');
      await admin.query("select set_config('app.mailbox_id', $1, true)", [mailbox]);
      await admin.query(
        `update rule_set set snapshot = jsonb_set(snapshot, '{categories}', '[]'::jsonb)
          where mailbox_id = $1`,
        [mailbox],
      );
      const { rows: counted } = await admin.query<{ n: number }>(LABELLED_OUTSIDE_SNAPSHOT_SQL, [
        mailbox,
      ]);
      expect(counted[0]?.n).toBeGreaterThan(0);
    } finally {
      await admin.query('rollback').catch(() => {});
      await admin.end();
    }
    expect(await labelledOutsideSnapshot(db.adminUrl)).toBe(0);
  });
});
