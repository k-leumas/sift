import { z } from 'zod';
import { MODEL_OPTIONS, REQUEST_FLAGS } from './prompt.ts';

/**
 * The `decision.spans` trace (D-27, D-28, D-30, TRC-01, TRC-03, TRC-06): a
 * fixed-order array validated by this one shared schema. Phase 4 apply, the
 * TRC-05 trace CLI and M2 all read it, so the layout is versioned.
 *
 * Spans record the prompt recipe (nonce, prompt version and hash, model,
 * options), never the rendered prompt (P2 D-09): the user message can be
 * re-rendered from the cached body, so there is no field to store it in.
 * Keys are snake_case, as stored in JSONB. Every object is strict.
 */

/** Trace layout version; a later layout gets a new number and both stay readable. */
export const TRACE_FORMAT_VERSION = 1;

/** Review reason codes (D-31, plus input_too_long from AI-SPEC Pitfall 3). */
export const REVIEW_REASONS = [
  'low_confidence',
  'invalid_output',
  'out_of_category',
  'input_too_long',
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];

/** Attempt validation codes: the output failures plus the two transport-level ones. */
export const ATTEMPT_FAILURE_CODES = [
  'not_json',
  'schema_mismatch',
  'out_of_category',
  'truncated',
  'input_too_long',
] as const;

const count = z.number().int().nonnegative();
const metric = z.number().nonnegative().nullable();

/** A rule by position in the rules file; `name` is `rule.name ?? \`rules[${index}]\``. */
export const RuleRefSchema = z.strictObject({
  index: count,
  name: z.string().min(1),
  label: z.string().min(1),
});
export type RuleRef = z.infer<typeof RuleRefSchema>;

export const ConditionResultSchema = z.strictObject({
  field: z.enum(['from', 'domain', 'phrase']),
  pass: z.boolean(),
});
export type ConditionResult = z.infer<typeof ConditionResultSchema>;

export const ExactRulesSpanSchema = z.strictObject({
  kind: z.literal('exact_rules'),
  rules_checked: count,
  matches: z.array(RuleRefSchema),
  winner: RuleRefSchema.nullable(),
  nearest_miss: z
    .strictObject({
      ...RuleRefSchema.shape,
      conditions: z.array(ConditionResultSchema),
      met: count,
      total: count,
    })
    .nullable(),
});
export type ExactRulesSpan = z.infer<typeof ExactRulesSpanSchema>;

/** Always present in M1, always skipped (TRC-06); M2 records a real one at the same index. */
export const ClassifierSpanSchema = z.strictObject({
  kind: z.literal('classifier'),
  status: z.literal('skipped'),
  reason: z.literal('not trained'),
});
export type ClassifierSpan = z.infer<typeof ClassifierSpanSchema>;

export const CLASSIFIER_SKIPPED_SPAN: Readonly<ClassifierSpan> = Object.freeze({
  kind: 'classifier',
  status: 'skipped',
  reason: 'not trained',
});

export const LlmAttemptSpanSchema = z.strictObject({
  /** Not mail-derived; lets a replay re-render the exact prompt. */
  nonce: z.string().min(1),
  /** `message.content` verbatim (mail-derived: it may echo the email). */
  raw: z.string().nullable(),
  /** Expected null with think:false; recorded as an anomaly, never parsed. */
  thinking: z.string().nullable(),
  done_reason: z.string().nullable(),
  metrics: z
    .strictObject({
      total_duration_ns: metric,
      load_duration_ns: metric,
      prompt_eval_count: metric,
      prompt_eval_cached_count: metric,
      eval_count: metric,
    })
    .nullable(),
  validation: z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true) }),
    z.strictObject({
      ok: z.literal(false),
      code: z.enum(ATTEMPT_FAILURE_CODES),
      detail: z.string(),
    }),
  ]),
});
export type LlmAttemptSpan = z.infer<typeof LlmAttemptSpanSchema>;

/** The span's `options`: MODEL_OPTIONS plus the request flags that shape the answer. */
export const LLM_SPAN_OPTIONS = Object.freeze({
  ...MODEL_OPTIONS,
  think: REQUEST_FLAGS.think,
  truncate: REQUEST_FLAGS.truncate,
  shift: REQUEST_FLAGS.shift,
  keep_alive: REQUEST_FLAGS.keep_alive,
});

export const LlmSpanSchema = z
  .strictObject({
    kind: z.literal('llm'),
    /** The configured models.llm name. */
    model: z.string().min(1),
    /** The response's `model` field. */
    response_model: z.string().nullable(),
    model_digest: z.string().nullable(),
    ollama_version: z.string().nullable(),
    prompt_version: z.number().int().positive(),
    prompt_hash: z.string().regex(/^[0-9a-f]{64}$/),
    /** The trusted categories included in the prompt. */
    categories: z
      .array(z.strictObject({ name: z.string().min(1), description: z.string() }))
      .min(1),
    /** The judgment lines included in the prompt. */
    judgment_rules: z.array(z.string()),
    /** Retrieved examples: always empty in M1 (D-28). */
    examples: z.tuple([]),
    options: z.strictObject({
      temperature: z.number(),
      seed: z.number().int(),
      num_predict: z.number().int(),
      num_ctx: z.number().int(),
      think: z.literal(false),
      truncate: z.literal(false),
      shift: z.literal(false),
      keep_alive: z.string(),
    }),
    body: z.strictObject({
      sent_chars: count,
      original_chars: count,
      truncated: z.boolean(),
    }),
    attempts: z.array(LlmAttemptSpanSchema).min(1).max(2),
    /** The validated answer, or null when no attempt validated. */
    result: z
      .strictObject({
        reason: z.string(),
        category: z.string(),
        confidence: z.number().min(0).max(1),
      })
      .nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    /** tiers.llm.confidence_threshold applied (D-26). */
    threshold: z.number().min(0).max(1),
  })
  .superRefine((span, ctx) => {
    if (span.result !== null && !span.categories.some((c) => c.name === span.result?.category)) {
      ctx.addIssue({
        code: 'custom',
        path: ['result', 'category'],
        message: 'result category is not one of the span categories',
      });
    }
  });
export type LlmSpan = z.infer<typeof LlmSpanSchema>;

/** The intended action, status pending: Phase 4 records what was done separately (D-30). */
export const ActionSpanSchema = z.strictObject({
  kind: z.literal('action'),
  status: z.literal('pending'),
  intent: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('label'), label: z.string().min(1) }),
    z.strictObject({ type: z.literal('review'), reason: z.enum(REVIEW_REASONS) }),
  ]),
});
export type ActionSpan = z.infer<typeof ActionSpanSchema>;

/**
 * The two valid layouts, in fixed order (D-28): exact_rules, classifier,
 * [llm,] action. The classifier span is always at index 1.
 */
export const decisionSpansSchema = z.union([
  z.tuple([ExactRulesSpanSchema, ClassifierSpanSchema, ActionSpanSchema]),
  z.tuple([ExactRulesSpanSchema, ClassifierSpanSchema, LlmSpanSchema, ActionSpanSchema]),
]);
export type DecisionSpans = z.infer<typeof decisionSpansSchema>;

/** Parse a stored or built spans array; throws a ZodError when it is not a valid trace. */
export function parseDecisionSpans(value: unknown): DecisionSpans {
  return decisionSpansSchema.parse(value);
}
