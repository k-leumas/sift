import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CLASSIFIER_SKIPPED_SPAN,
  decide,
  decisionSpansSchema,
  type ExactRulesSpan,
  LLM_SPAN_OPTIONS,
  type LlmAttemptSpan,
  type LlmSpanContext,
  type LlmVerdict,
  TRACE_FORMAT_VERSION,
} from '../src/classify/index.ts';

/** No rule matched; the nearest miss met none of its one condition. */
const noMatch: ExactRulesSpan = {
  kind: 'exact_rules',
  rules_checked: 1,
  matches: [],
  winner: null,
  nearest_miss: {
    index: 0,
    name: 'bank alerts',
    label: 'Important',
    conditions: [{ field: 'domain', pass: false }],
    met: 0,
    total: 1,
  },
};

const exactWin: ExactRulesSpan = {
  kind: 'exact_rules',
  rules_checked: 1,
  matches: [{ index: 0, name: 'bank alerts', label: 'Important' }],
  winner: { index: 0, name: 'bank alerts', label: 'Important' },
  nearest_miss: null,
};

const context: LlmSpanContext = {
  model: 'qwen3:1.7b',
  response_model: 'qwen3:1.7b',
  model_digest: 'sha256:abc',
  ollama_version: '0.12.0',
  prompt_version: 1,
  prompt_hash: 'a'.repeat(64),
  categories: [
    { name: 'Important', description: 'things I need to act on' },
    { name: 'Noise', description: 'promotions' },
  ],
  judgment_rules: ['Never mark anything from my bank as Noise.'],
  examples: [],
  options: { ...LLM_SPAN_OPTIONS },
  body: { sent_chars: 120, original_chars: 120, truncated: false },
};

function attempt(
  raw: string,
  validation: LlmAttemptSpan['validation'],
  nonce = 'N0NCE00000000001',
): LlmAttemptSpan {
  return {
    nonce,
    raw,
    thinking: null,
    done_reason: 'stop',
    metrics: {
      total_duration_ns: 1_000,
      load_duration_ns: null,
      prompt_eval_count: 300,
      prompt_eval_cached_count: null,
      eval_count: 20,
    },
    validation,
  };
}

function decided(category: string, confidence: number): LlmVerdict {
  const output = { reason: 'Looks like a bill due soon.', category, confidence };
  return { kind: 'decided', output, attempts: [attempt(JSON.stringify(output), { ok: true })] };
}

const notJson = attempt('not json', { ok: false, code: 'not_json', detail: 'output is not JSON' });

function runLlm(verdict: LlmVerdict, threshold: number) {
  return decide({ exact: noMatch, llm: { verdict, context }, threshold });
}

function llmSpanOf(draft: ReturnType<typeof decide>) {
  const span = draft.spans[2];
  if (span?.kind !== 'llm') throw new Error('expected an llm span at index 2');
  return span;
}

function expectConsistent(draft: ReturnType<typeof decide>): void {
  expect(decisionSpansSchema.safeParse(draft.spans).success).toBe(true);
  expect(draft.tier).toBe('llm');
  expect(draft.model).toBe(context.model);
  expect(draft.traceFormatVersion).toBe(TRACE_FORMAT_VERSION);
  expect(draft.spans).toHaveLength(4);
  expect(draft.spans.map((span) => span.kind)).toEqual([
    'exact_rules',
    'classifier',
    'llm',
    'action',
  ]);
  expect(draft.spans[0]).toEqual(noMatch);
  expect(draft.spans[1]).toEqual(CLASSIFIER_SKIPPED_SPAN);
  const action = draft.spans[3];
  expect(action?.kind).toBe('action');
  if (action?.kind !== 'action') return;
  expect(action.status).toBe('pending');
  if (draft.outcome === 'labelled') {
    expect(draft.category).not.toBeNull();
    expect(draft.reviewReason).toBeNull();
    expect(action.intent).toEqual({ type: 'label', label: draft.category });
  } else {
    expect(draft.category).toBeNull();
    expect(draft.reviewReason).not.toBeNull();
    expect(action.intent).toEqual({ type: 'review', reason: draft.reviewReason });
  }
}

interface ThresholdCase {
  confidence: number;
  threshold: number;
  outcome: 'labelled' | 'review';
}

const thresholdCases: ThresholdCase[] = [
  { confidence: 0.7499, threshold: 0.75, outcome: 'review' },
  { confidence: 0.75, threshold: 0.75, outcome: 'labelled' },
  { confidence: 1, threshold: 0.75, outcome: 'labelled' },
  { confidence: 0, threshold: 0.75, outcome: 'review' },
  { confidence: 0.89, threshold: 0.9, outcome: 'review' },
  { confidence: 0.9, threshold: 0.9, outcome: 'labelled' },
  { confidence: 0, threshold: 0, outcome: 'labelled' },
  { confidence: 1, threshold: 1, outcome: 'labelled' },
];

describe('decide() with an LLM verdict: threshold (D-26, CLS-04, E10)', () => {
  it.each(thresholdCases)(
    'confidence $confidence at threshold $threshold is $outcome',
    ({ confidence, threshold, outcome }) => {
      const verdict = decided('Important', confidence);
      const draft = runLlm(verdict, threshold);
      expectConsistent(draft);
      expect(draft.outcome).toBe(outcome);
      expect(draft.confidence).toBe(confidence);
      const span = llmSpanOf(draft);
      expect(span.result).toEqual(verdict.kind === 'decided' ? verdict.output : null);
      expect(span.confidence).toBe(confidence);
      expect(span.threshold).toBe(threshold);
      if (outcome === 'labelled') {
        expect(draft.category).toBe('Important');
        expect(draft.reviewReason).toBeNull();
      } else {
        expect(draft.category).toBeNull();
        expect(draft.reviewReason).toBe('low_confidence');
      }
    },
  );

  it('0.7499 at 0.75 keeps the answer and the confidence, but holds for review', () => {
    const draft = runLlm(decided('Noise', 0.7499), 0.75);
    expect(draft).toMatchObject({
      outcome: 'review',
      category: null,
      confidence: 0.7499,
      tier: 'llm',
      reviewReason: 'low_confidence',
      model: 'qwen3:1.7b',
    });
    expect(llmSpanOf(draft).result?.category).toBe('Noise');
    expect(draft.spans[3]).toEqual({
      kind: 'action',
      status: 'pending',
      intent: { type: 'review', reason: 'low_confidence' },
    });
  });

  it('a labelled answer uses the answer category in the action', () => {
    const draft = runLlm(decided('Noise', 0.95), 0.75);
    expect(draft.category).toBe('Noise');
    expect(draft.spans[3]).toEqual({
      kind: 'action',
      status: 'pending',
      intent: { type: 'label', label: 'Noise' },
    });
  });
});

describe('decide() with an LLM review verdict (D-24, D-31)', () => {
  const reviews: { name: string; verdict: LlmVerdict }[] = [
    {
      name: 'invalid_output after two attempts',
      verdict: {
        kind: 'review',
        reason: 'invalid_output',
        attempts: [
          notJson,
          attempt(
            '{"category":"Important"}',
            {
              ok: false,
              code: 'schema_mismatch',
              detail: 'reason: invalid_type',
            },
            'N0NCE00000000002',
          ),
        ],
      },
    },
    {
      name: 'out_of_category after two attempts',
      verdict: {
        kind: 'review',
        reason: 'out_of_category',
        attempts: [
          attempt('{"reason":"x","category":"Bills","confidence":0.9}', {
            ok: false,
            code: 'out_of_category',
            detail: 'category',
          }),
          attempt(
            '{"reason":"x","category":"Bills","confidence":0.9}',
            {
              ok: false,
              code: 'out_of_category',
              detail: 'category',
            },
            'N0NCE00000000002',
          ),
        ],
      },
    },
    {
      name: 'input_too_long after one attempt',
      verdict: {
        kind: 'review',
        reason: 'input_too_long',
        attempts: [
          attempt('{"reason":"x","category":"Important","confidence":0.9}', {
            ok: false,
            code: 'input_too_long',
            detail: 'prompt_eval_count reached num_ctx - num_predict',
          }),
        ],
      },
    },
    {
      name: 'llm_error after one call Ollama failed on (gap closure 03-19)',
      verdict: {
        kind: 'review',
        reason: 'llm_error',
        attempts: [
          {
            nonce: 'N0NCE00000000001',
            raw: null,
            thinking: null,
            done_reason: null,
            metrics: null,
            validation: { ok: false, code: 'llm_error', detail: 'Ollama failed on this message' },
          },
        ],
      },
    },
  ];

  it.each(reviews)('$name: review with that reason, no confidence, result null', ({ verdict }) => {
    const draft = runLlm(verdict, 0.75);
    expectConsistent(draft);
    expect(draft.outcome).toBe('review');
    expect(draft.category).toBeNull();
    expect(draft.confidence).toBeNull();
    expect(draft.reviewReason).toBe(verdict.kind === 'review' ? verdict.reason : null);
    const span = llmSpanOf(draft);
    expect(span.result).toBeNull();
    expect(span.confidence).toBeNull();
    expect(span.threshold).toBe(0.75);
    expect(span.attempts).toEqual(verdict.attempts);
  });
});

describe('decide() llm span contents (D-28, E8)', () => {
  it('records the context, attempts, result, confidence and threshold in schema key order', () => {
    const verdict = decided('Important', 0.8);
    const draft = runLlm(verdict, 0.75);
    expect(llmSpanOf(draft)).toEqual({
      kind: 'llm',
      ...context,
      attempts: verdict.attempts,
      result: verdict.kind === 'decided' ? verdict.output : null,
      confidence: 0.8,
      threshold: 0.75,
    });
    expect(Object.keys(llmSpanOf(draft)).slice(0, 2)).toEqual(['kind', 'model']);
    expect(Object.keys(llmSpanOf(draft)).slice(-4)).toEqual([
      'attempts',
      'result',
      'confidence',
      'threshold',
    ]);
  });

  it('two runs give byte-identical drafts', () => {
    const run = () => JSON.stringify(runLlm(decided('Important', 0.8), 0.75));
    expect(run()).toBe(run());
  });

  it('an answer whose category is not in the span categories fails the spans schema', () => {
    expect(() => runLlm(decided('Bills', 0.9), 0.75)).toThrow(ZodError);
  });
});

describe('decide() input checks', () => {
  it.each([-0.1, 1.1, Number.NaN])('threshold %s throws RangeError', (threshold) => {
    expect(() => runLlm(decided('Important', 0.9), threshold)).toThrow(RangeError);
  });

  it('an exact winner together with an LLM verdict throws TypeError', () => {
    expect(() =>
      decide({
        exact: exactWin,
        llm: { verdict: decided('Important', 0.9), context },
        threshold: 0.75,
      }),
    ).toThrow(TypeError);
  });

  it('no winner and no LLM verdict throws TypeError', () => {
    expect(() => decide({ exact: noMatch, threshold: 0.75 })).toThrow(TypeError);
  });
});
