import { randomUUID } from 'node:crypto';
import {
  type DecisionDraft,
  decide,
  type ExactRulesSpan,
  LLM_SPAN_OPTIONS,
  type LlmAttemptSpan,
  type LlmSpanContext,
  type LlmVerdict,
  type PromptMaterial,
  promptMaterial,
  REVIEW_REASONS,
  type ReviewReason,
} from '@sift/core/classify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AppDb,
  type ClassifyCandidate,
  createAppDb,
  DECISION_BODY_RETENTION_MS,
  ensurePromptVersion,
  ensureRuleSet,
  latestDecision,
  markLocationsRemoved,
  PROMPT_VERSION_LOCK_KEY,
  type RecordDecisionInput,
  recordDecision,
  restoreBody,
  type StoreItem,
  storeMessages,
  withMailbox,
} from '../src/index.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { seedMailboxes } from './support/seed.ts';

/**
 * Classification use-cases (D-03, D-15, D-17, D-18, D-27, D-29, D-32,
 * TRC-01, TRC-04) on a real database, through createAppDb + withMailbox as
 * sift_app.
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

async function newMailbox(): Promise<string> {
  const slug = `classify-${randomUUID().slice(0, 8)}`;
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

let nextUid = 1;

/** One fetched UID: eligible, INBOX, UIDVALIDITY 7, generation 1, a text body. */
function item(
  name: string,
  internalDate: string,
  overrides: { eligible?: boolean } = {},
): StoreItem {
  const identityKey = `mid:${name}-${randomUUID()}@classify.test`;
  return {
    message: {
      identityKey,
      messageIdHeader: identityKey.slice('mid:'.length),
      internalDate: new Date(internalDate),
      sentAt: null,
      fromAddress: `${name}@example.test`,
      fromDomain: 'example.test',
      subject: `Subject ${name}`,
      headers: { 'list-id': ['<news.example.test>'] },
      attachments: [{ name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 }],
      sizeBytes: 100,
      eligibleForClassification: overrides.eligible ?? true,
    },
    location: { folder: 'INBOX', uidvalidity: 7, uid: nextUid++, generation: 1 },
    body: { bodyText: `body of ${name}`, source: 'text_plain', truncated: false },
  };
}

/** Store items and return identity key -> message id. */
async function store(mailboxId: string, items: StoreItem[]): Promise<string[]> {
  return withMailbox(app, mailboxId, async (s) => {
    await storeMessages(s, items);
    const rows = await s.message.find({ identityKey: items.map((i) => i.message.identityKey) });
    const byKey = new Map(rows.map((r) => [r.identityKey, r.id]));
    return items.map((i) => byKey.get(i.message.identityKey) as string);
  });
}

function exactWin(label: string): ExactRulesSpan {
  const rule = { index: 0, name: 'bank alerts', label };
  return {
    kind: 'exact_rules',
    rules_checked: 1,
    matches: [rule],
    winner: rule,
    nearest_miss: null,
  };
}

/** An exact-rule labelled draft built by the real assembler. */
const exactDraft = (label = 'Important'): DecisionDraft =>
  decide({ exact: exactWin(label), threshold: 0.75 });

function decisionInput(
  messageId: string,
  ruleSetId: string,
  draft: DecisionDraft,
  overrides: Partial<RecordDecisionInput> = {},
): RecordDecisionInput {
  return {
    ...draft,
    messageId,
    ruleSetId,
    promptVersionId: null,
    decidedBy: 'worker',
    ...overrides,
  };
}

let nextHash = 0;
/** A distinct 64-hex hash per call. */
const hashOf = () => (nextHash++).toString(16).padStart(64, '0');

const snapshot = { version: 1, categories: [], judgment: [], rules: [] };

const ids = (rows: readonly ClassifyCandidate[]) => rows.map((r) => r.id);

/** Two uuids by the database's ordering (descending), for the shared-date tie-break. */
const desc = (a: string, b: string) => (a > b ? [a, b] : [b, a]);

describe('tracer: pending -> rule set -> one decision -> no longer pending (D-15, D-03, D-27, D-32)', () => {
  let mailboxId: string;
  let newest: string;
  let tied: string[];
  let historical: string;
  let vanished: string;

  beforeAll(async () => {
    mailboxId = await newMailbox();
    const items = [
      item('newest', '2026-10-03T12:00:00Z'),
      item('tie-a', '2026-10-02T12:00:00Z'),
      item('tie-b', '2026-10-02T12:00:00Z'),
      item('historical', '2026-10-04T12:00:00Z', { eligible: false }),
      item('vanished', '2026-10-05T12:00:00Z'),
    ];
    const stored = await store(mailboxId, items);
    [newest, , , historical, vanished] = stored as [string, string, string, string, string];
    tied = desc(stored[1] as string, stored[2] as string);
    await withMailbox(app, mailboxId, async (s) => {
      const [location] = await s.messageLocation.find({ messageId: vanished, removedAt: null });
      await markLocationsRemoved(s, [location?.id as string], 'vanished');
    });
  });

  it('lists the eligible live undecided messages newest first, id breaking ties', async () => {
    const pending = await withMailbox(app, mailboxId, (s) =>
      s.classification.candidates({ pendingOnly: true, limit: 100 }),
    );
    expect(ids(pending)).toEqual([newest, ...tied]);
    expect(ids(pending)).not.toContain(historical);
    expect(ids(pending)).not.toContain(vanished);
    expect(pending[0]).toMatchObject({
      id: newest,
      internalDate: new Date('2026-10-03T12:00:00Z'),
      fromAddress: 'newest@example.test',
      fromDomain: 'example.test',
      subject: 'Subject newest',
      headers: { 'list-id': ['<news.example.test>'] },
      attachments: [{ name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 }],
      body: { text: 'body of newest', source: 'text_plain', truncated: false, expiresAt: null },
      decided: false,
    });
    expect(pending[0]?.identityKey).toMatch(/^mid:newest-/);
  });

  it('pages with the (internal_date, id) keyset cursor', async () => {
    const page = (before?: ClassifyCandidate) =>
      withMailbox(app, mailboxId, (s) =>
        s.classification.candidates({
          pendingOnly: true,
          limit: 1,
          ...(before === undefined
            ? {}
            : { before: { internalDate: before.internalDate, id: before.id } }),
        }),
      );
    const first = await page();
    const second = await page(first[0]);
    const third = await page(second[0]);
    const fourth = await page(third[0]);
    expect([...ids(first), ...ids(second), ...ids(third)]).toEqual([newest, ...tied]);
    expect(fourth).toEqual([]);
  });

  it('records one validated decision; the message leaves the pending set and its body expires in 7 days', async () => {
    const at = new Date('2026-10-06T08:00:00Z');
    const result = await withMailbox(app, mailboxId, async (s) => {
      const ruleSet = await ensureRuleSet(s, { hash: hashOf(), formatVersion: 1, snapshot });
      const row = await recordDecision(s, decisionInput(newest, ruleSet.id, exactDraft(), { at }));
      const pending = await s.classification.candidates({ pendingOnly: true, limit: 100 });
      return { ruleSet, row, pending };
    });
    expect(result.ruleSet).toMatchObject({ version: 1, created: true });
    expect(result.row).toMatchObject({
      mailboxId,
      messageId: newest,
      outcome: 'labelled',
      category: 'Important',
      confidence: null,
      tier: 'exact_rules',
      reviewReason: null,
      ruleSetId: result.ruleSet.id,
      promptVersionId: null,
      model: null,
      decidedBy: 'worker',
      traceFormatVersion: 1,
      createdAt: at,
    });
    expect(result.row.spans).toEqual(exactDraft().spans);
    expect(ids(result.pending)).toEqual(tied);

    const [body] = await adminQuery<{ expires_at: Date }>(
      'select expires_at from message_body where mailbox_id = $1 and message_id = $2',
      [mailboxId, newest],
    );
    expect(body?.expires_at).toEqual(new Date(at.getTime() + DECISION_BODY_RETENTION_MS));
    expect(DECISION_BODY_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('refuses a second worker decision with 23505 and appends a rerun', async () => {
    const [ruleSet] = await withMailbox(app, mailboxId, (s) => s.ruleSet.find());
    await expect(
      withMailbox(app, mailboxId, (s) =>
        recordDecision(s, decisionInput(newest, ruleSet?.id as string, exactDraft())),
      ),
    ).rejects.toMatchObject({ cause: { code: '23505' } });

    const rerun = await withMailbox(app, mailboxId, (s) =>
      recordDecision(
        s,
        decisionInput(newest, ruleSet?.id as string, exactDraft('Noise'), { decidedBy: 'rerun' }),
      ),
    );
    expect(rerun).toMatchObject({ decidedBy: 'rerun', category: 'Noise' });
    const rows = await adminQuery<{ decided_by: string }>(
      'select decided_by from decision where mailbox_id = $1 and message_id = $2 order by created_at',
      [mailboxId, newest],
    );
    expect(rows.map((r) => r.decided_by)).toEqual(['worker', 'rerun']);
  });

  it('ensureRuleSet returns the known row for a known hash', async () => {
    const hash = hashOf();
    const result = await withMailbox(app, mailboxId, async (s) => ({
      first: await ensureRuleSet(s, { hash, formatVersion: 1, snapshot }),
      again: await ensureRuleSet(s, { hash, formatVersion: 1, snapshot }),
    }));
    expect(result.first).toMatchObject({ version: 2, created: true });
    expect(result.again).toEqual({ ...result.first, created: false });
  });

  it('refuses a malformed or inconsistent draft before any SQL', async () => {
    const [ruleSet] = await withMailbox(app, mailboxId, (s) => s.ruleSet.find());
    const ruleSetId = ruleSet?.id as string;
    const [target] = tied as [string];
    const reviewWithLabelIntent = decisionInput(target, ruleSetId, exactDraft(), {
      outcome: 'review',
      category: null,
      reviewReason: 'low_confidence',
    });
    const emptySpans = decisionInput(target, ruleSetId, exactDraft(), {
      spans: [] as unknown as RecordDecisionInput['spans'],
    });
    const querySpy = vi.spyOn(pg.Client.prototype, 'query');
    try {
      const after = await withMailbox(app, mailboxId, async (s) => {
        querySpy.mockClear();
        const errors = [
          await recordDecision(s, emptySpans).catch((e: unknown) => e),
          await recordDecision(s, reviewWithLabelIntent).catch((e: unknown) => e),
        ];
        const sent = querySpy.mock.calls.length;
        // The transaction is still usable: nothing failed inside the database.
        const pending = await s.classification.candidates({ pendingOnly: true, limit: 100 });
        return { errors, sent, pending };
      });
      expect(after.errors[0]).toMatchObject({ name: 'ZodError' });
      expect(after.errors[1]).toBeInstanceOf(TypeError);
      expect((after.errors[1] as Error).message).toMatch(/outcome/);
      expect(after.sent).toBe(0);
      expect(ids(after.pending)).toEqual(tied);
    } finally {
      querySpy.mockRestore();
    }
  });
});

describe('candidates validation', () => {
  it('refuses a limit outside 1..1000 and returns [] for an empty id list without SQL', async () => {
    const mailboxId = await newMailbox();
    const querySpy = vi.spyOn(pg.Client.prototype, 'query');
    try {
      const result = await withMailbox(app, mailboxId, async (s) => {
        querySpy.mockClear();
        const errors = await Promise.all(
          [0, 1001, 1.5, Number.NaN].map((limit) =>
            s.classification.candidates({ pendingOnly: true, limit }).catch((e: unknown) => e),
          ),
        );
        const badId = await s.classification
          .candidates({ pendingOnly: false, limit: 10, messageIds: ['not-a-uuid'] })
          .catch((e: unknown) => e);
        const empty = await s.classification.candidates({
          pendingOnly: false,
          limit: 10,
          messageIds: [],
        });
        return { errors, badId, empty, sent: querySpy.mock.calls.length };
      });
      for (const error of result.errors) expect(error).toBeInstanceOf(TypeError);
      expect(result.badId).toBeInstanceOf(TypeError);
      expect(result.empty).toEqual([]);
      expect(result.sent).toBe(0);
    } finally {
      querySpy.mockRestore();
    }
  });
});

describe('ensurePromptVersion (D-29, RESEARCH Pitfall 8)', () => {
  // prompt_version is global to the database, so this describe has its own:
  // the version numbers it asserts start at 1.
  let own: TestDatabase;

  beforeAll(async () => {
    own = await freshDatabase();
  });

  afterAll(async () => {
    await own?.drop();
  });

  const material = (seed: string): PromptMaterial => ({
    hash: Buffer.from(seed.padEnd(32, '.')).toString('hex').slice(0, 64),
    template: `template ${seed}`,
    schemaShape: { type: 'object', seed },
  });

  async function promptRows() {
    const admin = await connect(own.adminUrl);
    try {
      return (
        await admin.query<{ id: string; version: number; hash: string }>(
          'select id, version, hash from prompt_version order by version',
        )
      ).rows;
    } finally {
      await admin.end();
    }
  }

  it('five concurrent first calls on five handles store exactly one row', async () => {
    const handles = Array.from({ length: 5 }, () => createAppDb(own.appUrl));
    try {
      const first = material('first');
      const results = await Promise.all(handles.map((db) => ensurePromptVersion(db, first)));
      const rows = await promptRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ version: 1, hash: first.hash });
      for (const result of results) {
        expect(result).toMatchObject({ id: rows[0]?.id, version: 1 });
      }
      expect(results.filter((r) => r.created)).toHaveLength(1);
    } finally {
      await Promise.all(handles.map((db) => db.close()));
    }
  });

  it('a new hash gets the next version; a known one returns its row', async () => {
    const db = createAppDb(own.appUrl);
    try {
      const second = await ensurePromptVersion(db, material('second'));
      const firstAgain = await ensurePromptVersion(db, material('first'));
      expect(second).toMatchObject({ version: 2, created: true });
      expect(firstAgain).toMatchObject({ version: 1, created: false });
      expect((await promptRows()).map((r) => r.version)).toEqual([1, 2]);
    } finally {
      await db.close();
    }
  });

  it(`waits for advisory lock ${PROMPT_VERSION_LOCK_KEY}`, async () => {
    expect(PROMPT_VERSION_LOCK_KEY).toBe(815309003);
    const locker = await connect(own.adminUrl);
    const db = createAppDb(own.appUrl);
    try {
      await locker.query('select pg_advisory_lock($1)', [PROMPT_VERSION_LOCK_KEY]);
      let settled = false;
      const pending = ensurePromptVersion(db, material('third')).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await locker.query('select pg_advisory_unlock($1)', [PROMPT_VERSION_LOCK_KEY]);
      await expect(pending).resolves.toMatchObject({ version: 3, created: true });
    } finally {
      await db.close();
      await locker.end();
    }
  });
});

/** A one-attempt llm context naming the stored prompt version. */
function llmContext(version: { version: number }, hash: string): LlmSpanContext {
  return {
    model: 'qwen3:1.7b',
    response_model: 'qwen3:1.7b',
    model_digest: null,
    ollama_version: null,
    prompt_version: version.version,
    prompt_hash: hash,
    categories: [
      { name: 'Important', description: 'act on it' },
      { name: 'Noise', description: 'promotions' },
    ],
    judgment_rules: [],
    examples: [],
    options: { ...LLM_SPAN_OPTIONS },
    body: { sent_chars: 10, original_chars: 10, truncated: false },
  };
}

function attempt(validation: LlmAttemptSpan['validation']): LlmAttemptSpan {
  return {
    nonce: 'N0NCE00000000001',
    raw: '{}',
    thinking: null,
    done_reason: 'stop',
    metrics: null,
    validation,
  };
}

/** The LLM verdict that leads decide() to each review reason. */
function reviewVerdict(reason: ReviewReason): LlmVerdict {
  if (reason === 'low_confidence') {
    const output = { reason: 'unsure', category: 'Noise', confidence: 0.2 };
    return { kind: 'decided', output, attempts: [attempt({ ok: true })] };
  }
  const code = reason === 'invalid_output' ? 'not_json' : reason;
  return { kind: 'review', reason, attempts: [attempt({ ok: false, code, detail: 'x' })] };
}

const noMatch: ExactRulesSpan = {
  kind: 'exact_rules',
  rules_checked: 0,
  matches: [],
  winner: null,
  nearest_miss: null,
};

describe('re-runs, latest decision, body restore and the review reasons (D-17, D-32, TRC-04)', () => {
  let mailboxId: string;
  let ruleSetId: string;
  let older: string;
  let middle: string;
  let newer: string;
  const material = promptMaterial();
  let prompt: { id: string; version: number; created: boolean };

  beforeAll(async () => {
    mailboxId = await newMailbox();
    [older, middle, newer] = (await store(mailboxId, [
      item('older', '2026-09-01T00:00:00Z'),
      item('middle', '2026-09-15T00:00:00Z'),
      item('newer', '2026-09-30T00:00:00Z'),
    ])) as [string, string, string];
    ruleSetId = await withMailbox(app, mailboxId, async (s) => {
      const set = await ensureRuleSet(s, { hash: hashOf(), formatVersion: 1, snapshot });
      return set.id;
    });
    prompt = await ensurePromptVersion(app, material);
    await withMailbox(app, mailboxId, (s) =>
      recordDecision(s, decisionInput(middle, ruleSetId, exactDraft())),
    );
  });

  it('selects decided messages by id, marking them decided', async () => {
    const found = await withMailbox(app, mailboxId, (s) =>
      s.classification.candidates({ pendingOnly: false, messageIds: [middle], limit: 10 }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: middle, decided: true });
  });

  it('selects eligible live messages since a date, decided or not', async () => {
    const found = await withMailbox(app, mailboxId, (s) =>
      s.classification.candidates({
        pendingOnly: false,
        since: new Date('2026-09-15T00:00:00Z'),
        limit: 10,
      }),
    );
    expect(found.map((c) => [c.id, c.decided])).toEqual([
      [newer, false],
      [middle, true],
    ]);
  });

  it('returns body null when the body row is gone, and restoreBody puts it back once', async () => {
    const result = await withMailbox(app, mailboxId, async (s) => {
      await s.messageBody.delete({ messageId: older });
      const [gone] = await s.classification.candidates({
        pendingOnly: false,
        messageIds: [older],
        limit: 1,
      });
      const restored = await restoreBody(s, older, {
        bodyText: 'refetched\u0000 body',
        source: 'text_html',
        truncated: true,
      });
      const [back] = await s.classification.candidates({
        pendingOnly: false,
        messageIds: [older],
        limit: 1,
      });
      const again = await restoreBody(s, older, {
        bodyText: 'other',
        source: 'text_plain',
        truncated: false,
      });
      const [unchanged] = await s.messageBody.find({ messageId: older });
      return { gone, restored, back, again, unchanged };
    });
    expect(result.gone?.body).toBeNull();
    expect(result.restored).toBe(true);
    expect(result.back?.body).toEqual({
      text: 'refetched body',
      source: 'text_html',
      truncated: true,
      expiresAt: null,
    });
    expect(result.again).toBe(false);
    expect(result.unchanged).toMatchObject({ bodyText: 'refetched body', source: 'text_html' });
  });

  it('restoreBody gives the body of a decided message expires_at = at + 7 days, kept by a rerun (CR-02)', async () => {
    // Its own message: later tests depend on the bodies of older, middle and newer.
    const [own] = await store(mailboxId, [item('restored', '2026-09-20T00:00:00Z')]);
    if (own === undefined) throw new Error('no message stored');
    const at = new Date('2026-10-20T08:00:00Z');
    const later = new Date('2026-10-25T08:00:00Z');
    const result = await withMailbox(app, mailboxId, async (s) => {
      await recordDecision(s, decisionInput(own, ruleSetId, exactDraft()));
      await s.messageBody.delete({ messageId: own });
      const restored = await restoreBody(
        s,
        own,
        { bodyText: 'refetched', source: 'text_plain', truncated: false },
        at,
      );
      const [afterRestore] = await s.messageBody.find({ messageId: own });
      await recordDecision(
        s,
        decisionInput(own, ruleSetId, exactDraft('Noise'), { decidedBy: 'rerun', at: later }),
      );
      const [afterRerun] = await s.messageBody.find({ messageId: own });
      return { restored, afterRestore, afterRerun };
    });
    expect(result.restored).toBe(true);
    expect(result.afterRestore?.expiresAt).toEqual(
      new Date(at.getTime() + DECISION_BODY_RETENTION_MS),
    );
    expect(result.afterRerun?.expiresAt).toEqual(result.afterRestore?.expiresAt);
  });

  it('restoreBody refuses an invalid Date before any SQL (CR-02)', async () => {
    const run = vi.fn();
    const scope = new Proxy({} as Parameters<typeof restoreBody>[0], {
      get: () => {
        run();
        throw new Error('no SQL expected');
      },
    });
    await expect(
      restoreBody(
        scope,
        older,
        { bodyText: 'x', source: 'text_plain', truncated: false },
        new Date(Number.NaN),
      ),
    ).rejects.toThrow(new TypeError('restoreBody: at must be a valid Date'));
    expect(run).not.toHaveBeenCalled();
  });

  it('a rerun leaves an existing body expiry unchanged', async () => {
    const before = await withMailbox(app, mailboxId, (s) =>
      s.messageBody.find({ messageId: middle }),
    );
    expect(before[0]?.expiresAt).toBeInstanceOf(Date);
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const after = await withMailbox(app, mailboxId, async (s) => {
      await recordDecision(
        s,
        decisionInput(middle, ruleSetId, exactDraft('Noise'), { decidedBy: 'rerun', at: later }),
      );
      return s.messageBody.find({ messageId: middle });
    });
    expect(after[0]?.expiresAt).toEqual(before[0]?.expiresAt);
  });

  it('latestDecision orders by created_at, then id, and is null for an undecided message', async () => {
    const t1 = new Date('2027-01-01T00:00:00Z');
    const t2 = new Date('2027-01-02T00:00:00Z');
    const result = await withMailbox(app, mailboxId, async (s) => {
      const none = await latestDecision(s, newer);
      // Inserted first but decided later: created_at wins over insertion order.
      const late = await recordDecision(
        s,
        decisionInput(newer, ruleSetId, exactDraft('Noise'), { decidedBy: 'rerun', at: t2 }),
      );
      await recordDecision(
        s,
        decisionInput(newer, ruleSetId, exactDraft(), { decidedBy: 'rerun', at: t1 }),
      );
      const byTime = await latestDecision(s, newer);
      // Same created_at: the larger id (the later uuidv7) wins.
      const tieA = await recordDecision(
        s,
        decisionInput(older, ruleSetId, exactDraft(), { decidedBy: 'rerun', at: t1 }),
      );
      const tieB = await recordDecision(
        s,
        decisionInput(older, ruleSetId, exactDraft('Noise'), { decidedBy: 'rerun', at: t1 }),
      );
      const byId = await latestDecision(s, older);
      return { none, late, byTime, tieA, tieB, byId };
    });
    expect(result.none).toBeNull();
    expect(result.byTime?.id).toBe(result.late.id);
    const tieWinner = result.tieA.id > result.tieB.id ? result.tieA : result.tieB;
    expect(result.byId?.id).toBe(tieWinner.id);
  });

  it('stores an exact-rule decision with prompt_version_id and model null', async () => {
    const [row] = await adminQuery<{ prompt_version_id: string | null; model: string | null }>(
      `select prompt_version_id, model from decision
        where mailbox_id = $1 and message_id = $2 and decided_by = 'worker'`,
      [mailboxId, middle],
    );
    expect(row).toEqual({ prompt_version_id: null, model: null });
  });

  it('accepts every REVIEW_REASONS value in an llm review decision (core and SQL lists agree)', async () => {
    const stored = await withMailbox(app, mailboxId, async (s) => {
      const rows = [];
      for (const reason of REVIEW_REASONS) {
        const draft = decide({
          exact: noMatch,
          llm: { verdict: reviewVerdict(reason), context: llmContext(prompt, material.hash) },
          threshold: 0.75,
        });
        rows.push(
          await recordDecision(
            s,
            decisionInput(newer, ruleSetId, draft, {
              decidedBy: 'rerun',
              promptVersionId: prompt.id,
            }),
          ),
        );
      }
      return rows;
    });
    expect(stored.map((r) => r.reviewReason)).toEqual([...REVIEW_REASONS]);
    for (const row of stored) {
      expect(row).toMatchObject({
        outcome: 'review',
        tier: 'llm',
        promptVersionId: prompt.id,
        model: 'qwen3:1.7b',
      });
    }
  });

  it('stores an llm decision whose attempt holds NUL in thinking, raw and done_reason, without the NUL (WR-01 backstop)', async () => {
    const nul = String.fromCodePoint(0);
    const dirty: LlmAttemptSpan = {
      ...attempt({ ok: false, code: 'not_json', detail: 'content is not one JSON value' }),
      raw: `not${nul} json`,
      thinking: `thinking${nul} aloud`,
      done_reason: `st${nul}op`,
    };
    const draft = decide({
      exact: noMatch,
      llm: {
        verdict: { kind: 'review', reason: 'invalid_output', attempts: [dirty] },
        context: { ...llmContext(prompt, material.hash), response_model: `qwen3${nul}:1.7b` },
      },
      threshold: 0.75,
    });
    const row = await withMailbox(app, mailboxId, (s) =>
      recordDecision(
        s,
        decisionInput(newer, ruleSetId, draft, { decidedBy: 'rerun', promptVersionId: prompt.id }),
      ),
    );
    expect(row).toMatchObject({ outcome: 'review', reviewReason: 'invalid_output', tier: 'llm' });

    const [stored] = await adminQuery<{ spans: { kind: string }[] }>(
      'select spans from decision where id = $1',
      [row.id],
    );
    const llm = stored?.spans.find((s) => s.kind === 'llm') as
      | { response_model: string; attempts: LlmAttemptSpan[] }
      | undefined;
    expect(llm?.response_model).toBe('qwen3:1.7b');
    expect(llm?.attempts).toHaveLength(1);
    expect(llm?.attempts[0]).toMatchObject({
      raw: 'not json',
      thinking: 'thinking aloud',
      done_reason: 'stop',
    });
    // JSON.stringify writes NUL as a six-character escape: look for that.
    expect(JSON.stringify(stored?.spans)).not.toContain(`${String.fromCharCode(92)}u0000`);
  });

  it('refuses an unknown review reason with 23514', async () => {
    await expect(
      withMailbox(app, mailboxId, (s) =>
        s.decision.insert([
          {
            messageId: newer,
            outcome: 'review',
            category: null,
            confidence: null,
            tier: 'llm',
            reviewReason: 'something_else',
            ruleSetId,
            promptVersionId: prompt.id,
            model: 'qwen3:1.7b',
            decidedBy: 'rerun',
            traceFormatVersion: 1,
            spans: [],
          },
        ]),
      ),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint: 'decision_review_reason_check' },
    });
  });

  it('refuses an llm decision without a prompt version before any SQL', async () => {
    const draft = decide({
      exact: noMatch,
      llm: { verdict: reviewVerdict('invalid_output'), context: llmContext(prompt, material.hash) },
      threshold: 0.75,
    });
    const querySpy = vi.spyOn(pg.Client.prototype, 'query');
    try {
      const result = await withMailbox(app, mailboxId, async (s) => {
        querySpy.mockClear();
        const error = await recordDecision(
          s,
          decisionInput(newer, ruleSetId, draft, { decidedBy: 'rerun', promptVersionId: null }),
        ).catch((e: unknown) => e);
        return { error, sent: querySpy.mock.calls.length };
      });
      expect(result.error).toBeInstanceOf(TypeError);
      expect((result.error as Error).message).toMatch(/promptVersionId/);
      expect(result.sent).toBe(0);
    } finally {
      querySpy.mockRestore();
    }
  });

  it('numbers rule sets 1, 2, 3 per mailbox in creation order', async () => {
    const own = await newMailbox();
    const versions = await withMailbox(app, own, async (s) => [
      (await ensureRuleSet(s, { hash: hashOf(), formatVersion: 1, snapshot })).version,
      (await ensureRuleSet(s, { hash: hashOf(), formatVersion: 1, snapshot })).version,
      (await ensureRuleSet(s, { hash: hashOf(), formatVersion: 1, snapshot })).version,
    ]);
    expect(versions).toEqual([1, 2, 3]);
  });
});
