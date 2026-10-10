import { randomUUID } from 'node:crypto';
import { type DecisionDraft, decide, type ExactRulesSpan } from '@sift/core/classify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type AppDb,
  type ClassifyCandidate,
  createAppDb,
  DECISION_BODY_RETENTION_MS,
  ensureRuleSet,
  markLocationsRemoved,
  type RecordDecisionInput,
  recordDecision,
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
