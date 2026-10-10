import {
  type DecisionSpans,
  parseDecisionSpans,
  type ReviewReason,
  TRACE_FORMAT_VERSION,
} from '@sift/core/classify';
import type { InferSelectModel } from 'drizzle-orm';
import { stripNul } from './ingest.ts';
import type { decision } from './schema/index.ts';
import type { Scope } from './scope.ts';

/**
 * Classification use-cases over the scoped API (D-03, D-15, D-17, D-27, D-32).
 *
 * Like the ingest use-cases, each runs inside the caller's transaction (the
 * scope) and opens none of its own, takes the scope first and the clock
 * (`at`) last.
 */

/** How long a body stays cached after a message's first decision (D-32): 7 days. */
export const DECISION_BODY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type DecisionRow = InferSelectModel<typeof decision>;

/**
 * One decision to store (D-27). A DecisionDraft from @sift/core/classify's
 * decide() is structurally a subset of this: the caller adds the message,
 * the rule-set and prompt-version references and who decided.
 */
export interface RecordDecisionInput {
  messageId: string;
  ruleSetId: string;
  /** The prompt_version row an LLM decision was rendered from; null for exact rules. */
  promptVersionId: string | null;
  /** 'worker' at most once per message (D-15); 'rerun' appends (D-17). */
  decidedBy: 'worker' | 'rerun';
  outcome: 'labelled' | 'review';
  category: string | null;
  confidence: number | null;
  tier: 'exact_rules' | 'llm';
  reviewReason: ReviewReason | null;
  model: string | null;
  traceFormatVersion: number;
  spans: DecisionSpans;
  /** The decision time; defaults to now. It is the row's created_at. */
  at?: Date;
}

function mismatch(field: string, detail: string): TypeError {
  return new TypeError(`recordDecision: ${field} ${detail}`);
}

/**
 * Throw a TypeError naming the field when the typed columns disagree with
 * the trace: the action intent decides outcome, category and review reason,
 * and the llm span is present exactly for the llm tier, which names its
 * prompt version and model.
 */
function assertConsistent(input: RecordDecisionInput, spans: DecisionSpans): void {
  if (input.traceFormatVersion !== TRACE_FORMAT_VERSION) {
    throw mismatch('traceFormatVersion', `must be ${TRACE_FORMAT_VERSION} for this span layout`);
  }
  const action = spans[spans.length - 1];
  if (action?.kind !== 'action') throw mismatch('spans', 'must end with the action span');
  const { intent } = action;
  if (intent.type === 'label') {
    if (input.outcome !== 'labelled') {
      throw mismatch('outcome', "must be 'labelled' for a label intent");
    }
    if (input.category !== intent.label) {
      throw mismatch('category', 'must equal the label intent');
    }
    if (input.reviewReason !== null) {
      throw mismatch('reviewReason', 'must be null for a label intent');
    }
  } else {
    if (input.outcome !== 'review') {
      throw mismatch('outcome', "must be 'review' for a review intent");
    }
    if (input.category !== null) throw mismatch('category', 'must be null for a review intent');
    if (input.reviewReason !== intent.reason) {
      throw mismatch('reviewReason', 'must equal the review intent reason');
    }
  }

  const llm = spans.length === 4 ? spans[2] : undefined;
  if (input.tier === 'llm') {
    if (llm?.kind !== 'llm') throw mismatch('tier', "is 'llm' but the trace has no llm span");
    if (input.promptVersionId === null) {
      throw mismatch('promptVersionId', 'is required for an llm decision');
    }
    if (input.model === null || input.model !== llm.model) {
      throw mismatch('model', 'must equal the llm span model');
    }
    if (input.confidence !== llm.confidence) {
      throw mismatch('confidence', 'must equal the llm span confidence');
    }
  } else if (input.tier === 'exact_rules') {
    if (spans.length !== 3)
      throw mismatch('tier', "is 'exact_rules' but the trace has an llm span");
    if (input.promptVersionId !== null) {
      throw mismatch('promptVersionId', 'must be null for an exact-rule decision');
    }
    if (input.model !== null) throw mismatch('model', 'must be null for an exact-rule decision');
    if (input.confidence !== null) {
      throw mismatch('confidence', 'must be null for an exact-rule decision');
    }
  } else {
    throw mismatch('tier', "must be 'exact_rules' or 'llm'");
  }
}

/**
 * Store one decision (D-27, TRC-01): the single write path for decisions.
 *
 * The spans are parsed with the shared schema and checked against the typed
 * columns before any SQL, so a malformed or inconsistent trace never reaches
 * the database (the decision checks are the backstop). In the same
 * transaction the message's cached body gets expires_at = decided_at + 7 days,
 * only where expires_at is still null: the first decision starts the clock
 * and a re-run never extends it (D-32).
 *
 * A second 'worker' decision for a message fails with SQLSTATE 23505
 * (decision_one_worker_per_message); 'rerun' decisions append (D-17).
 *
 * Runs in the caller's transaction (the scope).
 */
export async function recordDecision(
  scope: Scope,
  input: RecordDecisionInput,
): Promise<DecisionRow> {
  const spans = parseDecisionSpans(input.spans);
  assertConsistent(input, spans);
  const at = input.at ?? new Date();
  if (!Number.isFinite(at.getTime())) throw mismatch('at', 'must be a valid Date');

  const [row] = await scope.decision.insert([
    {
      messageId: input.messageId,
      outcome: input.outcome,
      category: input.category,
      confidence: input.confidence,
      tier: input.tier,
      reviewReason: input.reviewReason,
      ruleSetId: input.ruleSetId,
      promptVersionId: input.promptVersionId,
      model: input.model,
      decidedBy: input.decidedBy,
      traceFormatVersion: input.traceFormatVersion,
      spans,
      createdAt: at,
    },
  ]);
  if (row === undefined) throw new Error('recordDecision: the insert returned no row');
  await scope.messageBody.update(
    { expiresAt: new Date(at.getTime() + DECISION_BODY_RETENTION_MS) },
    { messageId: input.messageId, expiresAt: null },
  );
  return row;
}

/**
 * The rule_set row for a snapshot (D-03): the existing row when its hash is
 * known, otherwise a new row with the mailbox's next version (1 when there is
 * none). Versions never skip.
 *
 * Writers of one mailbox are serialised by the ingest lock (classification
 * runs under it), and the unique (mailbox_id, hash) and (mailbox_id, version)
 * constraints back that up.
 *
 * Runs in the caller's transaction (the scope).
 */
export async function ensureRuleSet(
  scope: Scope,
  version: { hash: string; formatVersion: number; snapshot: Record<string, unknown> },
): Promise<{ id: string; version: number; created: boolean }> {
  const [known] = await scope.ruleSet.find({ hash: version.hash });
  if (known !== undefined) return { id: known.id, version: known.version, created: false };

  const existing = await scope.ruleSet.find();
  const next = existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
  const [row] = await scope.ruleSet.insert([
    {
      version: next,
      hash: version.hash,
      formatVersion: version.formatVersion,
      snapshot: version.snapshot,
    },
  ]);
  if (row === undefined) throw new Error('ensureRuleSet: the insert returned no row');
  return { id: row.id, version: row.version, created: true };
}

/**
 * The current decision of a message (D-17): the newest by created_at, then
 * id; null when it has none.
 *
 * Runs in the caller's transaction (the scope).
 */
export async function latestDecision(scope: Scope, messageId: string): Promise<DecisionRow | null> {
  const rows = await scope.decision.find({ messageId });
  let latest: DecisionRow | null = null;
  for (const row of rows) {
    if (
      latest === null ||
      row.createdAt.getTime() > latest.createdAt.getTime() ||
      (row.createdAt.getTime() === latest.createdAt.getTime() && row.id > latest.id)
    ) {
      latest = row;
    }
  }
  return latest;
}

/**
 * Put back a refetched body (D-32) when the message has none: NUL characters
 * are removed, and expires_at stays null so the next decision sets it.
 * Returns true when a row was written; an existing body is left untouched.
 *
 * Runs in the caller's transaction (the scope).
 */
export async function restoreBody(
  scope: Scope,
  messageId: string,
  body: { bodyText: string; source: 'text_plain' | 'text_html' | 'none'; truncated: boolean },
): Promise<boolean> {
  const clean = stripNul(body);
  const inserted = await scope.messageBody.insertOrIgnore(
    [
      {
        messageId,
        bodyText: clean.bodyText,
        source: clean.source,
        truncated: clean.truncated,
        expiresAt: null,
      },
    ],
    { target: ['messageId'] },
  );
  return inserted.length > 0;
}
