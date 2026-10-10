import type { LlmOutput } from './llm-output.ts';
import {
  type ActionSpan,
  CLASSIFIER_SKIPPED_SPAN,
  type DecisionSpans,
  decisionSpansSchema,
  type ExactRulesSpan,
  type LlmAttemptSpan,
  type LlmSpan,
  type ReviewReason,
  TRACE_FORMAT_VERSION,
} from './spans.ts';

/**
 * The single assembler of decisions (CLS-05, T-03-12): tier results go in, one
 * decision draft comes out, with its spans in the fixed D-28 order and parsed
 * by the shared decisionSpansSchema before it is returned. The worker only
 * does I/O around this pure function.
 */

/** What the LLM tier concluded for one message (D-24, D-31). */
export type LlmVerdict =
  | { kind: 'decided'; output: LlmOutput; attempts: LlmAttemptSpan[] }
  | {
      kind: 'review';
      reason: 'invalid_output' | 'out_of_category' | 'input_too_long';
      attempts: LlmAttemptSpan[];
    };

/** The llm span fields that describe the request (model, prompt recipe, options, body). */
export type LlmSpanContext = Omit<
  LlmSpan,
  'kind' | 'attempts' | 'result' | 'confidence' | 'threshold'
>;

export interface DecisionDraft {
  outcome: 'labelled' | 'review';
  /** Null for review. */
  category: string | null;
  /** The LLM's confidence; null for exact rules and for an invalid answer. */
  confidence: number | null;
  tier: 'exact_rules' | 'llm';
  /** Null when labelled. */
  reviewReason: ReviewReason | null;
  /** The configured models.llm name; null for exact rules. */
  model: string | null;
  traceFormatVersion: number;
  spans: DecisionSpans;
}

export interface DecideInput {
  exact: ExactRulesSpan;
  /** Present only when no exact rule matched and the LLM tier ran. */
  llm?: { verdict: LlmVerdict; context: LlmSpanContext };
  /** tiers.llm.confidence_threshold (D-26), 0..1 inclusive. */
  threshold: number;
}

function assertThreshold(threshold: number): void {
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1
  ) {
    throw new RangeError(
      `decide: threshold must be a number from 0 to 1, got ${String(threshold)}`,
    );
  }
}

function labelAction(label: string): ActionSpan {
  return { kind: 'action', status: 'pending', intent: { type: 'label', label } };
}

/** Turn the tier results for one message into exactly one decision draft. */
export function decide(input: DecideInput): DecisionDraft {
  assertThreshold(input.threshold);
  const { exact, llm } = input;
  const winner = exact.winner;

  if (winner !== null && llm !== undefined) {
    throw new TypeError('decide: an exact rule matched, so the LLM must not have run');
  }
  if (winner === null && llm === undefined) {
    throw new TypeError('decide: no exact rule matched and no LLM verdict was given');
  }

  if (winner !== null) {
    const spans = decisionSpansSchema.parse([
      exact,
      { ...CLASSIFIER_SKIPPED_SPAN },
      labelAction(winner.label),
    ]);
    return {
      outcome: 'labelled',
      category: winner.label,
      confidence: null,
      tier: 'exact_rules',
      reviewReason: null,
      model: null,
      traceFormatVersion: TRACE_FORMAT_VERSION,
      spans,
    };
  }

  // Unreachable after the checks above; it narrows `llm` for the type checker.
  if (llm === undefined) throw new TypeError('decide: no LLM verdict was given');
  return decideLlm(exact, llm.verdict, llm.context, input.threshold);
}

type LlmOutcome = {
  result: LlmSpan['result'];
  confidence: number | null;
} & (
  | { outcome: 'labelled'; category: string; reviewReason: null }
  | { outcome: 'review'; category: null; reviewReason: ReviewReason }
);

/** D-24, D-26, D-31: a valid answer at or above the threshold labels; anything else reviews. */
function llmOutcome(verdict: LlmVerdict, threshold: number): LlmOutcome {
  if (verdict.kind === 'review') {
    return {
      outcome: 'review',
      category: null,
      reviewReason: verdict.reason,
      result: null,
      confidence: null,
    };
  }
  const { output } = verdict;
  const result = {
    reason: output.reason,
    category: output.category,
    confidence: output.confidence,
  };
  if (output.confidence >= threshold) {
    return {
      outcome: 'labelled',
      category: output.category,
      reviewReason: null,
      result,
      confidence: output.confidence,
    };
  }
  // Below the threshold: the answer and its confidence stay in the trace, the category does not.
  return {
    outcome: 'review',
    category: null,
    reviewReason: 'low_confidence',
    result,
    confidence: output.confidence,
  };
}

function decideLlm(
  exact: ExactRulesSpan,
  verdict: LlmVerdict,
  context: LlmSpanContext,
  threshold: number,
): DecisionDraft {
  const decided = llmOutcome(verdict, threshold);
  const action: ActionSpan =
    decided.outcome === 'labelled'
      ? labelAction(decided.category)
      : {
          kind: 'action',
          status: 'pending',
          intent: { type: 'review', reason: decided.reviewReason },
        };
  const spans = decisionSpansSchema.parse([
    exact,
    { ...CLASSIFIER_SKIPPED_SPAN },
    {
      kind: 'llm',
      ...context,
      attempts: verdict.attempts,
      result: decided.result,
      confidence: decided.confidence,
      threshold,
    },
    action,
  ]);
  return {
    outcome: decided.outcome,
    category: decided.category,
    confidence: decided.confidence,
    tier: 'llm',
    reviewReason: decided.reviewReason,
    model: context.model,
    traceFormatVersion: TRACE_FORMAT_VERSION,
    spans,
  };
}
