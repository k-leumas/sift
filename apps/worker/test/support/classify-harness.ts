// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type DecisionSpans,
  llmOutputSchema,
  MODEL_OPTIONS,
  ollamaFormat,
  parseDecisionSpans,
  promptMaterial,
  RETRY_NOTE,
  type RetryCode,
  renderMessages,
  TRACE_FORMAT_VERSION,
  trustedInputFrom,
} from '@sift/core/classify';
import {
  type AppDb,
  type ClassifyCandidate,
  type StoreItem,
  storeMessages,
  withMailbox,
} from '@sift/db';
import { expect } from 'vitest';
import { connect } from '../../../../packages/db/test/support/db.ts';
import { type ClassifyRuntime, createClassifyRuntime } from '../../src/classify/run.ts';
import { createSingleFlight } from '../../src/classify/single-flight.ts';
import { untrustedEmailOf } from '../../src/classify/untrusted-email.ts';
import type { FakeOllama, RecordedRequest } from './fake-ollama.ts';

/**
 * Shared pieces of the classification-pass tests (03-08): stored pending
 * messages, rules files in a temp data dir, a runtime pointed at the fake
 * Ollama, superuser reads of the decisions, and the E8 assertion every
 * decision-writing test runs (expectReplayableDecision).
 */

/** Three categories and one domain rule: mail from bank.example.test is Important. */
export const BASIC_RULES = `version: 1
categories:
  - name: Important
    description: things I need to act on or reply to personally
  - name: Receipts
    description: orders, invoices, shipping updates
  - name: Noise
    description: promotions, marketing, social notifications
judgment:
  - Never mark anything from my bank as Noise.
  - Newsletters are Noise unless they mention me by name.
rules:
  - kind: exact
    name: bank alerts
    match:
      domain: [bank.example.test]
    label: Important
`;

/** BASIC_RULES' category names, in file order. */
export const BASIC_CATEGORIES = ['Important', 'Receipts', 'Noise'] as const;

export interface SeedMessage {
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  internalDate: Date | string;
  attachments?: string[];
}

let nextUid = 1;

/**
 * Store eligible messages with a live INBOX location and a body, as sift_app
 * through the scoped API. Returns their ids in input order.
 */
export async function seedPendingMessages(
  db: AppDb,
  mailboxId: string,
  messages: readonly SeedMessage[],
): Promise<string[]> {
  const items: StoreItem[] = messages.map((m) => {
    const identityKey = `mid:${randomUUID()}@classify-run.test`;
    const domain = m.from.split('@')[1]?.toLowerCase() ?? null;
    return {
      message: {
        identityKey,
        messageIdHeader: identityKey.slice('mid:'.length),
        internalDate: new Date(m.internalDate),
        sentAt: null,
        fromAddress: m.from,
        fromDomain: domain,
        subject: m.subject,
        headers: { from: [m.fromName === undefined ? m.from : `"${m.fromName}" <${m.from}>`] },
        attachments: (m.attachments ?? []).map((name) => ({
          name,
          mimeType: 'application/pdf',
          sizeBytes: 100,
        })),
        sizeBytes: 1000,
        eligibleForClassification: true,
      },
      location: { folder: 'INBOX', uidvalidity: 7, uid: nextUid++, generation: 1 },
      body: { bodyText: m.body, source: 'text_plain', truncated: false },
    };
  });
  return withMailbox(db, mailboxId, async (s) => {
    await storeMessages(s, items);
    const rows = await s.message.find({ identityKey: items.map((i) => i.message.identityKey) });
    const byKey = new Map(rows.map((r) => [r.identityKey, r.id]));
    return items.map((i) => byKey.get(i.message.identityKey) as string);
  });
}

/** Write <dataDir>/mailboxes/<slug>/rules.yaml. */
export async function writeRules(dataDir: string, slug: string, yaml: string): Promise<string> {
  const dir = join(dataDir, 'mailboxes', slug);
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'rules.yaml');
  await writeFile(path, yaml);
  return path;
}

/** A runtime pointed at the fake, with a gate of its own. */
export function testRuntime(
  fake: FakeOllama,
  dataDir: string,
  overrides: Partial<Parameters<typeof createClassifyRuntime>[0]> = {},
): ClassifyRuntime {
  return createClassifyRuntime({
    dataDir,
    modelsUrl: fake.url,
    gate: createSingleFlight(),
    ...overrides,
  });
}

export interface StoredDecision {
  id: string;
  mailboxId: string;
  messageId: string;
  outcome: 'labelled' | 'review';
  category: string | null;
  confidence: number | null;
  tier: 'exact_rules' | 'llm';
  reviewReason: string | null;
  ruleSetId: string;
  promptVersionId: string | null;
  model: string | null;
  decidedBy: 'worker' | 'rerun';
  traceFormatVersion: number;
  spans: unknown;
  createdAt: Date;
}

/** Run `fn` with a superuser client whose transaction has app.mailbox_id set (FORCE RLS). */
async function asAdmin<T>(
  adminUrl: string,
  mailboxId: string,
  fn: (query: <R extends object>(sql: string, params?: unknown[]) => Promise<R[]>) => Promise<T>,
): Promise<T> {
  const admin = await connect(adminUrl);
  try {
    await admin.query('begin');
    await admin.query("select set_config('app.mailbox_id', $1, true)", [mailboxId]);
    const value = await fn(
      async <R extends object>(sql: string, params: unknown[] = []) =>
        (await admin.query<R>(sql, params)).rows,
    );
    await admin.query('commit');
    return value;
  } catch (error) {
    await admin.query('rollback').catch(() => {});
    throw error;
  } finally {
    await admin.end();
  }
}

/** Every decision of the mailbox, oldest first, read as the superuser. */
export async function decisionsOf(adminUrl: string, mailboxId: string): Promise<StoredDecision[]> {
  return asAdmin(adminUrl, mailboxId, (query) =>
    query<StoredDecision>(
      `select id, mailbox_id as "mailboxId", message_id as "messageId", outcome, category,
              confidence, tier, review_reason as "reviewReason", rule_set_id as "ruleSetId",
              prompt_version_id as "promptVersionId", model, decided_by as "decidedBy",
              trace_format_version as "traceFormatVersion", spans, created_at as "createdAt"
         from decision where mailbox_id = $1 order by created_at, id`,
      [mailboxId],
    ),
  );
}

/** The mailbox's rule_set rows (version, hash), oldest first, read as the superuser. */
export async function ruleSetsOf(
  adminUrl: string,
  mailboxId: string,
): Promise<{ id: string; version: number; hash: string; snapshot: unknown }[]> {
  return asAdmin(adminUrl, mailboxId, (query) =>
    query(
      'select id, version, hash, snapshot from rule_set where mailbox_id = $1 order by version',
      [mailboxId],
    ),
  );
}

/** The ids of the mailbox's messages that have no decision (still pending). */
export async function pendingIdsOf(adminUrl: string, mailboxId: string): Promise<string[]> {
  const rows = await asAdmin(adminUrl, mailboxId, (query) =>
    query<{ id: string }>(
      `select m.id from message m
        where m.mailbox_id = $1
          and not exists (select 1 from decision d where d.mailbox_id = m.mailbox_id
                          and d.message_id = m.id)
        order by m.internal_date desc, m.id desc`,
      [mailboxId],
    ),
  );
  return rows.map((r) => r.id);
}

/**
 * E1 invariant over every mailbox in the database: labelled decisions whose
 * category is not a name in their own rule_set snapshot. Must be 0.
 */
export async function labelledOutsideSnapshot(adminUrl: string): Promise<number> {
  const admin = await connect(adminUrl);
  try {
    const { rows: mailboxes } = await admin.query<{ id: string }>('select id from mailbox');
    let total = 0;
    for (const { id } of mailboxes) {
      total += await asAdmin(adminUrl, id, async (query) => {
        const [row] = await query<{ n: number }>(
          `select count(*)::int as n from decision d
             join rule_set r on r.mailbox_id = d.mailbox_id and r.id = d.rule_set_id
            where d.mailbox_id = $1 and d.outcome = 'labelled'
              and not exists (select 1 from jsonb_array_elements(r.snapshot -> 'categories') c
                               where c ->> 'name' = d.category)`,
          [id],
        );
        return row?.n ?? 0;
      });
    }
    return total;
  } finally {
    await admin.end();
  }
}

/** The user message of a recorded chat request. */
function userContent(request: RecordedRequest): string {
  const messages = (request.body as { messages?: { role: string; content: string }[] }).messages;
  return messages?.find((m) => m.role === 'user')?.content ?? '';
}

/** The message.content the fake answered with, or null when it sent no chat answer. */
function answeredContent(request: RecordedRequest): string | null {
  const response = request.response;
  if (response === undefined || (response.status ?? 200) !== 200) return null;
  const text = response.body ?? JSON.stringify(response.json);
  const parsed = JSON.parse(text) as { message?: { content?: unknown } };
  return typeof parsed.message?.content === 'string' ? parsed.message.content : null;
}

/** The stored message and body a decision was made from, as a candidate. */
async function storedCandidate(
  adminUrl: string,
  mailboxId: string,
  messageId: string,
): Promise<ClassifyCandidate> {
  const [row] = await asAdmin(adminUrl, mailboxId, (query) =>
    query<{
      id: string;
      identity_key: string;
      internal_date: Date;
      from_address: string | null;
      from_domain: string | null;
      subject: string | null;
      headers: Record<string, string[]>;
      attachments: ClassifyCandidate['attachments'];
      body_text: string | null;
      source: 'text_plain' | 'text_html' | 'none' | null;
      truncated: boolean | null;
      expires_at: Date | null;
    }>(
      `select m.id, m.identity_key, m.internal_date, m.from_address, m.from_domain, m.subject,
              m.headers, m.attachments, b.body_text, b.source, b.truncated, b.expires_at
         from message m
         left join message_body b on b.mailbox_id = m.mailbox_id and b.message_id = m.id
        where m.mailbox_id = $1 and m.id = $2`,
      [mailboxId, messageId],
    ),
  );
  if (row === undefined) throw new Error(`storedCandidate: no message ${messageId}`);
  return {
    id: row.id,
    identityKey: row.identity_key,
    internalDate: row.internal_date,
    fromAddress: row.from_address,
    fromDomain: row.from_domain,
    subject: row.subject,
    headers: row.headers,
    attachments: row.attachments,
    body:
      row.body_text === null
        ? null
        : {
            text: row.body_text,
            source: row.source ?? 'none',
            truncated: row.truncated ?? false,
            expiresAt: row.expires_at,
          },
    decided: true,
  };
}

/** Remove every attempt's raw output (mail-derived when the model echoes the email). */
function withoutRaw(spans: DecisionSpans): unknown {
  return spans.map((span) =>
    span.kind === 'llm'
      ? { ...span, attempts: span.attempts.map(({ raw: _raw, ...rest }) => rest) }
      : span,
  );
}

/**
 * E8: the decision is complete, closed and replayable.
 *
 * - spans parse with the shared schema, in the fixed order, with the current
 *   TRACE_FORMAT_VERSION, and agree with the typed columns;
 * - the rule_set and prompt_version references resolve, and the prompt
 *   version's hash is promptMaterial().hash;
 * - each attempt's raw output is exactly what the fake sent;
 * - re-rendering from the stored snapshot, the stored message and body and
 *   the recorded nonces (and the previous attempt's retry note) reproduces
 *   the exact request messages the fake received;
 * - outside raw outputs, the spans hold no rendered prompt (`<<<EMAIL`).
 */
export async function expectReplayableDecision(
  adminUrl: string,
  decision: StoredDecision,
  fake: FakeOllama,
): Promise<void> {
  const spans = parseDecisionSpans(decision.spans);
  expect(decision.traceFormatVersion).toBe(TRACE_FORMAT_VERSION);
  expect(spans.map((s) => s.kind)).toEqual(
    decision.tier === 'llm'
      ? ['exact_rules', 'classifier', 'llm', 'action']
      : ['exact_rules', 'classifier', 'action'],
  );

  const action = spans[spans.length - 1];
  if (action?.kind !== 'action') throw new Error('last span is not the action');
  if (decision.outcome === 'labelled') {
    expect(action.intent).toEqual({ type: 'label', label: decision.category });
    expect(decision.reviewReason).toBeNull();
  } else {
    expect(action.intent).toEqual({ type: 'review', reason: decision.reviewReason });
    expect(decision.category).toBeNull();
  }

  const [ruleSet] = await asAdmin(adminUrl, decision.mailboxId, (query) =>
    query<{
      snapshot: { categories: { name: string; description: string }[]; judgment: string[] };
    }>('select snapshot from rule_set where mailbox_id = $1 and id = $2', [
      decision.mailboxId,
      decision.ruleSetId,
    ]),
  );
  expect(ruleSet, 'rule_set_id resolves').toBeDefined();
  if (ruleSet === undefined) return;

  expect(JSON.stringify(withoutRaw(spans))).not.toContain('<<<EMAIL');

  if (decision.tier === 'exact_rules') {
    expect(decision.promptVersionId).toBeNull();
    expect(decision.model).toBeNull();
    expect(decision.confidence).toBeNull();
    return;
  }

  const llm = spans[2];
  if (llm?.kind !== 'llm') throw new Error('llm decision without an llm span');
  expect(decision.model).toBe(llm.model);
  expect(decision.confidence).toBe(llm.confidence);
  const [prompt] = await asAdmin(adminUrl, decision.mailboxId, (query) =>
    query<{ version: number; hash: string }>(
      'select version, hash from prompt_version where id = $1',
      [decision.promptVersionId],
    ),
  );
  expect(prompt, 'prompt_version_id resolves').toBeDefined();
  const material = promptMaterial();
  expect(prompt?.hash).toBe(material.hash);
  expect(llm.prompt_hash).toBe(material.hash);
  expect(llm.prompt_version).toBe(prompt?.version);

  const trusted = trustedInputFrom(ruleSet.snapshot);
  expect(llm.categories).toEqual(trusted.categories);
  expect(llm.judgment_rules).toEqual(trusted.judgment);

  const email = untrustedEmailOf(
    await storedCandidate(adminUrl, decision.mailboxId, decision.messageId),
  );
  const chats = fake.requests().filter((r) => r.path === '/api/chat');
  const [first, ...rest] = trusted.categories.map((c) => c.name);
  if (first === undefined) throw new Error('snapshot without categories');
  const format = ollamaFormat(llmOutputSchema([first, ...rest]));

  let previous: (typeof llm.attempts)[number] | undefined;
  for (const attempt of llm.attempts) {
    const marker = `<<<EMAIL ${attempt.nonce}>>>`;
    const matching = chats.filter((r) => userContent(r).includes(marker));
    expect(matching, `exactly one request carries nonce ${attempt.nonce}`).toHaveLength(1);
    const request = matching[0] as RecordedRequest;

    expect(attempt.raw).toBe(answeredContent(request));
    const retryNote =
      previous === undefined || previous.validation.ok
        ? undefined
        : RETRY_NOTE[previous.validation.code as RetryCode];
    const body = request.body as Record<string, unknown>;
    expect(body.messages).toEqual(renderMessages(trusted, email, attempt.nonce, retryNote));
    expect(body.format).toEqual(format);
    expect(body.options).toEqual({ ...MODEL_OPTIONS });
    expect(body.model).toBe(llm.model);
    previous = attempt;
  }
}
