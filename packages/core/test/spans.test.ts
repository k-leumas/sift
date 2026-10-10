import { describe, expect, it } from 'vitest';
import {
  CLASSIFIER_SKIPPED_SPAN,
  decisionSpansSchema,
  LLM_SPAN_OPTIONS,
  parseDecisionSpans,
  REVIEW_REASONS,
} from '../src/classify/index.ts';

const exact = {
  kind: 'exact_rules',
  rules_checked: 3,
  matches: [],
  winner: null,
  nearest_miss: {
    index: 1,
    name: 'shop order confirmations',
    label: 'Receipts',
    conditions: [
      { field: 'from', pass: true },
      { field: 'phrase', pass: false },
    ],
    met: 1,
    total: 2,
  },
};

const exactWin = {
  kind: 'exact_rules',
  rules_checked: 1,
  matches: [{ index: 0, name: 'bank alerts', label: 'Important' }],
  winner: { index: 0, name: 'bank alerts', label: 'Important' },
  nearest_miss: null,
};

const classifier = { ...CLASSIFIER_SKIPPED_SPAN };

const attempt = {
  nonce: 'AAAAAAAAAAAAAAAA',
  raw: '{"reason":"Due bill.","category":"Important","confidence":0.9}',
  thinking: null,
  done_reason: 'stop',
  metrics: {
    total_duration_ns: 1,
    load_duration_ns: null,
    prompt_eval_count: 10,
    prompt_eval_cached_count: null,
    eval_count: 5,
  },
  validation: { ok: true },
};

const llm = {
  kind: 'llm',
  model: 'qwen3:1.7b',
  response_model: 'qwen3:1.7b',
  model_digest: null,
  ollama_version: null,
  prompt_version: 1,
  prompt_hash: 'b'.repeat(64),
  categories: [
    { name: 'Important', description: 'act on it' },
    { name: 'Noise', description: 'everything else' },
  ],
  judgment_rules: [],
  examples: [],
  options: { ...LLM_SPAN_OPTIONS },
  body: { sent_chars: 10, original_chars: 10, truncated: false },
  attempts: [attempt],
  result: { reason: 'Due bill.', category: 'Important', confidence: 0.9 },
  confidence: 0.9,
  threshold: 0.75,
};

const label = { kind: 'action', status: 'pending', intent: { type: 'label', label: 'Important' } };
const review = (reason: string) => ({
  kind: 'action',
  status: 'pending',
  intent: { type: 'review', reason },
});

function ok(value: unknown): boolean {
  return decisionSpansSchema.safeParse(value).success;
}

describe('decisionSpansSchema: valid traces (TRC-01, TRC-06)', () => {
  it('accepts an exact-rule decision: exact_rules, classifier, action', () => {
    expect(parseDecisionSpans([exactWin, classifier, label])).toHaveLength(3);
  });

  it('accepts an LLM decision: exact_rules, classifier, llm, action', () => {
    expect(parseDecisionSpans([exact, classifier, llm, label])).toHaveLength(4);
  });

  it('requires the classifier span even for a rules file with no rules', () => {
    const none = { ...exactWin, rules_checked: 0, matches: [], winner: null };
    expect(ok([none, classifier, llm, label])).toBe(true);
    expect(ok([none, llm, label])).toBe(false);
  });

  it.each(REVIEW_REASONS)('accepts a review intent with reason %s', (reason) => {
    expect(ok([exact, classifier, llm, review(reason)])).toBe(true);
  });

  it('accepts two attempts and an input_too_long attempt with a null result', () => {
    const tooLong = {
      ...attempt,
      raw: null,
      done_reason: null,
      metrics: null,
      validation: { ok: false, code: 'input_too_long', detail: 'HTTP 400' },
    };
    const span = { ...llm, attempts: [attempt, tooLong], result: null, confidence: null };
    expect(ok([exact, classifier, span, review('input_too_long')])).toBe(true);
  });

  it('keeps the classifier span frozen and fixed', () => {
    expect(Object.isFrozen(CLASSIFIER_SKIPPED_SPAN)).toBe(true);
    expect(CLASSIFIER_SKIPPED_SPAN).toEqual({
      kind: 'classifier',
      status: 'skipped',
      reason: 'not trained',
    });
  });
});

describe('decisionSpansSchema: rejections', () => {
  it.each([
    ['an empty array', []],
    ['a two-span array', [exact, classifier]],
    ['a one-span array', [exact]],
    ['classifier first', [classifier, exact, label]],
    ['llm after action', [exact, classifier, label, llm]],
    ['action not last', [exact, classifier, label, exact]],
    ['a trailing extra span', [exact, classifier, llm, label, label]],
    ['a classifier span that ran', [exact, { ...classifier, status: 'ran' }, label]],
    ['a classifier span with another reason', [exact, { ...classifier, reason: 'trained' }, label]],
    ['non-empty examples', [exact, classifier, { ...llm, examples: [{ id: 1 }] }, label]],
    ['zero attempts', [exact, classifier, { ...llm, attempts: [] }, label]],
    [
      'three attempts',
      [exact, classifier, { ...llm, attempts: [attempt, attempt, attempt] }, label],
    ],
    [
      'an attempt code outside the set',
      [
        exact,
        classifier,
        {
          ...llm,
          attempts: [{ ...attempt, validation: { ok: false, code: 'timeout', detail: 'x' } }],
        },
        label,
      ],
    ],
    ['an unknown key in exact_rules', [{ ...exact, extra: 1 }, classifier, label]],
    ['an unknown key in classifier', [exact, { ...classifier, extra: 1 }, label]],
    ['an unknown key in llm', [exact, classifier, { ...llm, prompt: 'rendered' }, label]],
    [
      'an unknown key in an attempt',
      [exact, classifier, { ...llm, attempts: [{ ...attempt, messages: [] }] }, label],
    ],
    ['an unknown key in action', [exact, classifier, { ...label, applied: true }, label]],
    ['a review reason outside REVIEW_REASONS', [exact, classifier, llm, review('timeout')]],
    ['an action that is not pending', [exact, classifier, { ...label, status: 'done' }]],
    [
      'options with thinking on',
      [exact, classifier, { ...llm, options: { ...llm.options, think: true } }, label],
    ],
    [
      'a result category not in the span categories',
      [exact, classifier, { ...llm, result: { ...llm.result, category: 'Spam' } }, label],
    ],
    [
      'a prompt hash that is not 64 hex',
      [exact, classifier, { ...llm, prompt_hash: 'abc' }, label],
    ],
  ])('rejects %s', (_name, value) => {
    expect(ok(value)).toBe(false);
    expect(() => parseDecisionSpans(value)).toThrow();
  });
});
