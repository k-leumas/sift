import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../src/owner/migrate.ts';
import { connect, freshDatabase, type TestDatabase } from './support/db.ts';
import { SEED_SNAPSHOT_JSON, SEED_SPANS, SEED_SPANS_JSON, seedMailboxes } from './support/seed.ts';

/**
 * The Phase 3 trace shape at the database level (D-27, D-29, D-03, D-15,
 * TRC-01, TRC-04, CLS-06). Every write runs on a raw pg client logged in as
 * sift_app under app.mailbox_id, the way the worker writes, so the checks,
 * foreign keys, the worker uniqueness index and the grants are what is under
 * test; no application code stands in front of them.
 */

let db: TestDatabase;
let admin: pg.Client;
let app: pg.Client;
let A: string;
let B: string;
/** A's and B's first rule-set snapshot, and the shared prompt version. */
let ruleSetA: string;
let ruleSetB: string;
let promptVersionId: string;

const hex64 = (): string => randomBytes(32).toString('hex');

/**
 * Run `fn` in a transaction with app.mailbox_id set transaction-locally, the
 * way the app's withMailbox does. Rolls back and rethrows on error.
 */
async function inScope<T>(
  client: pg.Client,
  mailboxId: string,
  fn: (c: pg.Client) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query("select set_config('app.mailbox_id', $1, true)", [mailboxId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  }
}

/** Insert one row and return its id; the statement must end in `returning id`. */
async function insertId(c: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const { rows } = await c.query<{ id: string }>(sql, params);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`no id returned by: ${sql}`);
  return id;
}

/** A message for `mailboxId`, written by sift_app. */
async function newMessage(mailboxId: string): Promise<string> {
  return inScope(app, mailboxId, (c) =>
    insertId(
      c,
      `insert into message (mailbox_id, identity_key, internal_date, eligible_for_classification)
       values ($1, 'mid:cls-' || gen_random_uuid() || '@cls.test', now(), true)
       returning id`,
      [mailboxId],
    ),
  );
}

interface RuleSetRow {
  version: number;
  hash: string;
  format_version: number;
  /** JSON text. */
  snapshot: string;
}

let nextRuleSetVersion = 100;

function ruleSetRow(overrides: Partial<RuleSetRow> = {}): RuleSetRow {
  nextRuleSetVersion += 1;
  return {
    version: nextRuleSetVersion,
    hash: hex64(),
    format_version: 1,
    snapshot: SEED_SNAPSHOT_JSON,
    ...overrides,
  };
}

function insertRuleSet(mailboxId: string, row: RuleSetRow): Promise<string> {
  return inScope(app, mailboxId, (c) =>
    insertId(
      c,
      `insert into rule_set (mailbox_id, version, hash, format_version, snapshot)
       values ($1, $2, $3, $4, $5::jsonb) returning id`,
      [mailboxId, row.version, row.hash, row.format_version, row.snapshot],
    ),
  );
}

interface PromptVersionRow {
  version: number;
  hash: string;
  template: string;
  /** JSON text. */
  schema_shape: string;
}

let nextPromptVersion = 100;

function promptVersionRow(overrides: Partial<PromptVersionRow> = {}): PromptVersionRow {
  nextPromptVersion += 1;
  return {
    version: nextPromptVersion,
    hash: hex64(),
    template: 'Classify this email into one of: {{categories}}',
    schema_shape: '{"type":"object"}',
    ...overrides,
  };
}

/** prompt_version has no RLS, so a plain sift_app statement with no scope writes it. */
function insertPromptVersion(row: PromptVersionRow): Promise<string> {
  return insertId(
    app,
    `insert into prompt_version (version, hash, template, schema_shape)
     values ($1, $2, $3, $4::jsonb) returning id`,
    [row.version, row.hash, row.template, row.schema_shape],
  );
}

interface DecisionRow {
  message_id: string;
  outcome: string | null;
  category: string | null;
  /** A number, or a string such as 'NaN' that Postgres parses. */
  confidence: number | string | null;
  tier: string | null;
  review_reason: string | null;
  rule_set_id: string | null;
  prompt_version_id: string | null;
  model: string | null;
  decided_by: string | null;
  trace_format_version: number | null;
  /** JSON text, so a non-array can be stored. */
  spans: string;
}

type DecisionBase = Omit<DecisionRow, 'message_id'>;

/** The four valid decision shapes; every invalid case below changes one of them. */
const exactLabelled = (): DecisionBase => ({
  outcome: 'labelled',
  category: 'Seed',
  confidence: null,
  tier: 'exact_rules',
  review_reason: null,
  rule_set_id: ruleSetA,
  prompt_version_id: null,
  model: null,
  decided_by: 'rerun',
  trace_format_version: 1,
  spans: SEED_SPANS_JSON,
});

const llmLabelled = (): DecisionBase => ({
  ...exactLabelled(),
  tier: 'llm',
  confidence: 0.75,
  prompt_version_id: promptVersionId,
  model: 'qwen3:8b',
});

const llmReviewLowConfidence = (): DecisionBase => ({
  ...llmLabelled(),
  outcome: 'review',
  category: null,
  confidence: 0.7499,
  review_reason: 'low_confidence',
});

const llmReviewInvalidOutput = (): DecisionBase => ({
  ...llmReviewLowConfidence(),
  confidence: null,
  review_reason: 'invalid_output',
});

const DECISION_INSERT = `insert into decision
    (mailbox_id, message_id, outcome, category, confidence, tier, review_reason, rule_set_id,
     prompt_version_id, model, decided_by, trace_format_version, spans)
  values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
  returning id`;

function decisionParams(mailboxId: string, row: DecisionRow): unknown[] {
  return [
    mailboxId,
    row.message_id,
    row.outcome,
    row.category,
    row.confidence,
    row.tier,
    row.review_reason,
    row.rule_set_id,
    row.prompt_version_id,
    row.model,
    row.decided_by,
    row.trace_format_version,
    row.spans,
  ];
}

function insertDecision(mailboxId: string, row: DecisionRow): Promise<string> {
  return inScope(app, mailboxId, (c) =>
    insertId(c, DECISION_INSERT, decisionParams(mailboxId, row)),
  );
}

/** Every decision of `messageId`, read as sift_app under A. */
async function decisionsOf(
  messageId: string,
): Promise<{ id: string; decided_by: string; confidence: number | null }[]> {
  return inScope(
    app,
    A,
    async (c) =>
      (
        await c.query<{ id: string; decided_by: string; confidence: number | null }>(
          'select id, decided_by, confidence from decision where message_id = $1 order by id',
          [messageId],
        )
      ).rows,
  );
}

beforeAll(async () => {
  db = await freshDatabase();
  const ids = await seedMailboxes(db.ownerUrl, ['cls-a', 'cls-b']);
  A = ids['cls-a'] as string;
  B = ids['cls-b'] as string;
  admin = await connect(db.adminUrl);
  app = await connect(db.appUrl);
  ruleSetA = await insertRuleSet(A, ruleSetRow({ version: 1 }));
  ruleSetB = await insertRuleSet(B, ruleSetRow({ version: 1 }));
  promptVersionId = await insertPromptVersion(promptVersionRow({ version: 1 }));
});

afterAll(async () => {
  for (const client of [app, admin]) {
    await client?.end().catch(() => {});
  }
  await db?.drop();
});

describe('decision rows that fit the D-27 trace shape are stored as sift_app', () => {
  it('stores an exact-rule labelled decision with its spans array', async () => {
    const messageId = await newMessage(A);
    const id = await insertDecision(A, { ...exactLabelled(), message_id: messageId });
    const { rows } = await inScope(app, A, (c) =>
      c.query('select outcome, category, tier, rule_set_id, spans from decision where id = $1', [
        id,
      ]),
    );
    expect(rows).toEqual([
      {
        outcome: 'labelled',
        category: 'Seed',
        tier: 'exact_rules',
        rule_set_id: ruleSetA,
        spans: SEED_SPANS,
      },
    ]);
  });

  it('stores an LLM labelled decision with confidence 0.75 and its prompt version and model', async () => {
    const messageId = await newMessage(A);
    const id = await insertDecision(A, { ...llmLabelled(), message_id: messageId });
    const { rows } = await inScope(app, A, (c) =>
      c.query('select confidence, prompt_version_id, model from decision where id = $1', [id]),
    );
    expect(rows).toEqual([
      { confidence: 0.75, prompt_version_id: promptVersionId, model: 'qwen3:8b' },
    ]);
  });

  it('stores 0.7499 as double precision and reads back exactly 0.7499 (CLS-04 precision edge)', async () => {
    const messageId = await newMessage(A);
    const id = await insertDecision(A, { ...llmReviewLowConfidence(), message_id: messageId });
    const { rows } = await inScope(app, A, (c) =>
      c.query<{ confidence: number; type: string; text: string }>(
        `select confidence, pg_typeof(confidence)::text as type, confidence::text as text
           from decision where id = $1`,
        [id],
      ),
    );
    // A float4 column would read back 0.7499000072479248.
    expect(rows).toEqual([{ confidence: 0.7499, type: 'double precision', text: '0.7499' }]);
  });

  it('stores an LLM review for invalid output with no confidence', async () => {
    const messageId = await newMessage(A);
    await expect(
      insertDecision(A, { ...llmReviewInvalidOutput(), message_id: messageId }),
    ).resolves.toEqual(expect.any(String));
  });

  it('accepts the confidence bounds 0 and 1', async () => {
    for (const confidence of [0, 1]) {
      const messageId = await newMessage(A);
      await expect(
        insertDecision(A, { ...llmLabelled(), confidence, message_id: messageId }),
        String(confidence),
      ).resolves.toEqual(expect.any(String));
    }
  });

  it('accepts every review reason (D-31)', async () => {
    for (const reason of ['out_of_category', 'input_too_long', 'invalid_output', 'llm_error']) {
      const messageId = await newMessage(A);
      await expect(
        insertDecision(A, {
          ...llmReviewInvalidOutput(),
          review_reason: reason,
          message_id: messageId,
        }),
        reason,
      ).resolves.toEqual(expect.any(String));
    }
  });
});

describe('one automatic decision per message (D-15, D-17, CLS-06, TRC-01 adjacency edge)', () => {
  it('refuses a second worker decision with 23505 and keeps rerun rows next to the first', async () => {
    const messageId = await newMessage(A);
    const worker = await insertDecision(A, {
      ...exactLabelled(),
      decided_by: 'worker',
      message_id: messageId,
    });
    await expect(
      insertDecision(A, { ...llmLabelled(), decided_by: 'worker', message_id: messageId }),
    ).rejects.toMatchObject({ code: '23505', constraint: 'decision_one_worker_per_message' });

    const rerunOne = await insertDecision(A, { ...llmLabelled(), message_id: messageId });
    const rerunTwo = await insertDecision(A, {
      ...llmReviewLowConfidence(),
      message_id: messageId,
    });

    const rows = await decisionsOf(messageId);
    expect(rows.map((r) => r.id).sort()).toEqual([worker, rerunOne, rerunTwo].sort());
    expect(rows.filter((r) => r.decided_by === 'worker').map((r) => r.id)).toEqual([worker]);
    expect(rows.filter((r) => r.decided_by === 'rerun')).toHaveLength(2);
  });

  it('allows one worker decision for each of two messages', async () => {
    for (const _ of [1, 2]) {
      const messageId = await newMessage(A);
      await expect(
        insertDecision(A, { ...exactLabelled(), decided_by: 'worker', message_id: messageId }),
      ).resolves.toEqual(expect.any(String));
    }
  });
});

/** One inconsistent row per case, and the check that must refuse it. */
const INVALID_DECISIONS: [string, () => DecisionBase, string][] = [
  [
    'an unknown outcome',
    () => ({ ...llmReviewInvalidOutput(), outcome: 'maybe', review_reason: null }),
    'decision_outcome_check',
  ],
  [
    'labelled without a category',
    () => ({ ...llmLabelled(), category: null }),
    'decision_category_check',
  ],
  [
    'review with a category',
    () => ({ ...llmReviewInvalidOutput(), category: 'Seed' }),
    'decision_category_check',
  ],
  [
    'review with a NULL reason',
    () => ({ ...llmReviewInvalidOutput(), review_reason: null }),
    'decision_review_reason_check',
  ],
  [
    'labelled with a reason',
    () => ({ ...llmLabelled(), review_reason: 'invalid_output' }),
    'decision_review_reason_check',
  ],
  [
    'an unknown review reason',
    () => ({ ...llmReviewInvalidOutput(), review_reason: 'bored' }),
    'decision_review_reason_check',
  ],
  [
    'a labelled row with reason llm_error (gap closure 03-19)',
    () => ({ ...llmLabelled(), review_reason: 'llm_error' }),
    'decision_review_reason_check',
  ],
  ['an unknown tier', () => ({ ...exactLabelled(), tier: 'magic' }), 'decision_tier_check'],
  [
    'an exact-rule review',
    () => ({
      ...exactLabelled(),
      outcome: 'review',
      category: null,
      review_reason: 'invalid_output',
    }),
    'decision_exact_rules_check',
  ],
  [
    'an exact-rule decision with a prompt version',
    () => ({ ...exactLabelled(), prompt_version_id: promptVersionId }),
    'decision_exact_rules_check',
  ],
  [
    'an exact-rule decision with a model',
    () => ({ ...exactLabelled(), model: 'qwen3:8b' }),
    'decision_exact_rules_check',
  ],
  // Also fails decision_confidence_check, which sorts first and is reported.
  [
    'an exact-rule decision with a confidence',
    () => ({ ...exactLabelled(), confidence: 0.9 }),
    'decision_confidence_check',
  ],
  [
    'an LLM decision with no prompt version',
    () => ({ ...llmLabelled(), prompt_version_id: null }),
    'decision_llm_check',
  ],
  [
    'an LLM decision with no model',
    () => ({ ...llmLabelled(), model: null }),
    'decision_llm_check',
  ],
  [
    'an LLM labelled decision with a NULL confidence',
    () => ({ ...llmLabelled(), confidence: null }),
    'decision_confidence_check',
  ],
  [
    'an LLM low_confidence review with a NULL confidence',
    () => ({ ...llmReviewLowConfidence(), confidence: null }),
    'decision_confidence_check',
  ],
  [
    'an LLM invalid_output review with a confidence',
    () => ({ ...llmReviewInvalidOutput(), confidence: 0.3 }),
    'decision_confidence_check',
  ],
  [
    'a confidence above 1',
    () => ({ ...llmLabelled(), confidence: 1.5 }),
    'decision_confidence_check',
  ],
  [
    'a confidence below 0',
    () => ({ ...llmLabelled(), confidence: -0.1 }),
    'decision_confidence_check',
  ],
  [
    'a NaN confidence',
    () => ({ ...llmLabelled(), confidence: 'NaN' }),
    'decision_confidence_check',
  ],
  [
    'an unknown decided_by',
    () => ({ ...exactLabelled(), decided_by: 'owner' }),
    'decision_decided_by_check',
  ],
  [
    'trace_format_version 0',
    () => ({ ...exactLabelled(), trace_format_version: 0 }),
    'decision_trace_format_check',
  ],
  [
    'spans that are a JSON object',
    () => ({ ...exactLabelled(), spans: '{"kind":"exact_rules"}' }),
    'decision_spans_check',
  ],
  [
    'spans that are JSON null',
    () => ({ ...exactLabelled(), spans: 'null' }),
    'decision_spans_check',
  ],
];

describe('the database refuses inconsistent decisions with 23514 (D-13, D-27, D-31)', () => {
  it.each(INVALID_DECISIONS)('refuses %s', async (_name, row, constraint) => {
    const messageId = await newMessage(A);
    await expect(insertDecision(A, { ...row(), message_id: messageId })).rejects.toMatchObject({
      code: '23514',
      constraint,
    });
    expect(await decisionsOf(messageId)).toEqual([]);
  });

  it('refuses a NULL in each required column with 23502', async () => {
    const required = [
      'outcome',
      'tier',
      'rule_set_id',
      'decided_by',
      'trace_format_version',
    ] as const;
    for (const column of required) {
      const messageId = await newMessage(A);
      await expect(
        insertDecision(A, { ...exactLabelled(), [column]: null, message_id: messageId }),
        column,
      ).rejects.toMatchObject({ code: '23502', column });
    }
  });
});

describe('decision foreign keys (TRC-04)', () => {
  it('refuses a rule set that does not exist', async () => {
    const messageId = await newMessage(A);
    await expect(
      insertDecision(A, { ...exactLabelled(), rule_set_id: randomUUID(), message_id: messageId }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'decision_rule_set_fk' });
  });

  it("refuses another mailbox's rule set (the FK pairs mailbox_id)", async () => {
    const messageId = await newMessage(A);
    await expect(
      insertDecision(A, { ...exactLabelled(), rule_set_id: ruleSetB, message_id: messageId }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'decision_rule_set_fk' });
  });

  it('refuses a prompt version that does not exist', async () => {
    const messageId = await newMessage(A);
    await expect(
      insertDecision(A, {
        ...llmLabelled(),
        prompt_version_id: randomUUID(),
        message_id: messageId,
      }),
    ).rejects.toMatchObject({ code: '23503', constraint: 'decision_prompt_version_fk' });
  });
});

describe('rule_set snapshots (D-03)', () => {
  it('stores a snapshot with version, hash and format_version', async () => {
    const row = ruleSetRow();
    const id = await insertRuleSet(A, row);
    const { rows } = await inScope(app, A, (c) =>
      c.query('select version, hash, format_version, snapshot from rule_set where id = $1', [id]),
    );
    expect(rows).toEqual([
      {
        version: row.version,
        hash: row.hash,
        format_version: 1,
        snapshot: JSON.parse(SEED_SNAPSHOT_JSON),
      },
    ]);
  });

  it.each([
    ['version 0', { version: 0 }, 'rule_set_version_check'],
    ['format_version 0', { format_version: 0 }, 'rule_set_version_check'],
    ['an upper-case hash', { hash: hex64().toUpperCase() }, 'rule_set_hash_check'],
    ['a short hash', { hash: 'abc123' }, 'rule_set_hash_check'],
    ['a snapshot that is a JSON array', { snapshot: '[]' }, 'rule_set_snapshot_check'],
  ] as [string, Partial<RuleSetRow>, string][])(
    'refuses %s with 23514',
    async (_n, overrides, constraint) => {
      await expect(insertRuleSet(A, ruleSetRow(overrides))).rejects.toMatchObject({
        code: '23514',
        constraint,
      });
    },
  );

  it('refuses a repeated hash or version within a mailbox, and allows both in another', async () => {
    const row = ruleSetRow();
    await insertRuleSet(A, row);
    await expect(insertRuleSet(A, ruleSetRow({ hash: row.hash }))).rejects.toMatchObject({
      code: '23505',
      constraint: 'rule_set_mailbox_id_hash_key',
    });
    await expect(insertRuleSet(A, ruleSetRow({ version: row.version }))).rejects.toMatchObject({
      code: '23505',
      constraint: 'rule_set_mailbox_id_version_key',
    });
    await expect(insertRuleSet(B, row)).resolves.toEqual(expect.any(String));
  });

  it('is append-only for sift_app: UPDATE and DELETE fail with 42501 (T-03-06)', async () => {
    await expect(
      inScope(app, A, (c) => c.query("update rule_set set snapshot = '{}'::jsonb")),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(inScope(app, A, (c) => c.query('delete from rule_set'))).rejects.toMatchObject({
      code: '42501',
    });
    const { rows } = await inScope(app, A, (c) =>
      c.query<{ snapshot: unknown }>('select snapshot from rule_set where id = $1', [ruleSetA]),
    );
    expect(rows).toEqual([{ snapshot: JSON.parse(SEED_SNAPSHOT_JSON) }]);
  });
});

describe('decision is append-only for sift_app (D-40, T-03-06)', () => {
  it('UPDATE and DELETE fail with 42501', async () => {
    await expect(
      inScope(app, A, (c) => c.query("update decision set category = 'Other'")),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(inScope(app, A, (c) => c.query('delete from decision'))).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('prompt_version: unscoped, append-only for sift_app (D-29)', () => {
  it('is readable by sift_app without a mailbox scope (no RLS)', async () => {
    const fresh = await connect(db.appUrl);
    try {
      const { rows } = await fresh.query<{ version: number }>(
        'select version from prompt_version where id = $1',
        [promptVersionId],
      );
      expect(rows).toEqual([{ version: 1 }]);
    } finally {
      await fresh.end();
    }
  });

  it.each([
    ['version 0', { version: 0 }, 'prompt_version_version_check'],
    ['an upper-case hash', { hash: hex64().toUpperCase() }, 'prompt_version_hash_check'],
    [
      'a schema shape that is a JSON array',
      { schema_shape: '[]' },
      'prompt_version_schema_shape_check',
    ],
  ] as [string, Partial<PromptVersionRow>, string][])(
    'refuses %s with 23514',
    async (_n, overrides, constraint) => {
      await expect(insertPromptVersion(promptVersionRow(overrides))).rejects.toMatchObject({
        code: '23514',
        constraint,
      });
    },
  );

  it('refuses a repeated version or hash with 23505', async () => {
    const row = promptVersionRow();
    await insertPromptVersion(row);
    await expect(insertPromptVersion(promptVersionRow({ hash: row.hash }))).rejects.toMatchObject({
      code: '23505',
    });
    await expect(
      insertPromptVersion(promptVersionRow({ version: row.version })),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('UPDATE and DELETE fail with 42501', async () => {
    await expect(app.query("update prompt_version set template = 'changed'")).rejects.toMatchObject(
      { code: '42501' },
    );
    await expect(app.query('delete from prompt_version')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('migration 0008 preflight (refuses decision or rule_set rows it did not write)', () => {
  const preflightSql = (): Promise<string> =>
    readFile(path.join(MIGRATIONS_FOLDER, '0008_classification_preflight.sql'), 'utf8');

  it('passes when no mailbox has rows, raises naming the mailbox that has one, and resets the scope', async () => {
    const pre = await freshDatabase();
    const owner = await connect(pre.ownerUrl);
    try {
      const ids = await seedMailboxes(pre.ownerUrl, ['pre-a', 'pre-b']);
      const sql = await preflightSql();

      // An owner's database with mailboxes but no decision or rule_set rows.
      await owner.query('begin');
      await owner.query(sql);
      const { rows } = await owner.query<{ setting: string }>(
        "select current_setting('app.mailbox_id', true) as setting",
      );
      expect(rows).toEqual([{ setting: '' }]);
      await owner.query('commit');

      await owner.query('begin');
      await owner.query("select set_config('app.mailbox_id', $1, true)", [ids['pre-b']]);
      await owner.query(
        `insert into rule_set (mailbox_id, version, hash, format_version, snapshot)
         values ($1, 1, $2, 1, $3::jsonb)`,
        [ids['pre-b'], hex64(), SEED_SNAPSHOT_JSON],
      );
      await owner.query('commit');

      const run = owner.query(sql);
      await expect(run).rejects.toMatchObject({ code: 'P0001' });
      await expect(run).rejects.toThrow(
        "Sift's Phase 3 schema adds required columns to decision and rule_set, but mailbox pre-b already has rows there that Sift did not write (Phase 2 never classified mail). sift migrate stopped and changed nothing; remove those rows or restore the pre-migration backup, then run sift migrate again.",
      );
    } finally {
      await owner.end();
      await pre.drop();
    }
  });
});
