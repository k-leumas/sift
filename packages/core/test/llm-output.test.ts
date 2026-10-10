import { describe, expect, it } from 'vitest';
import {
  llmOutputSchema,
  ollamaFormat,
  REASON_MAX_CHARS,
  validateLlmOutput,
} from '../src/classify/index.ts';

const CATEGORIES = ['Important', 'Noise', 'Bills & Receipts'] as const;
const schema = llmOutputSchema(CATEGORIES);

/** AI-SPEC section 4b, [verified] generated format for these three categories. */
const VERIFIED_FORMAT =
  '{"type":"object","properties":{"reason":{"type":"string","minLength":1,"maxLength":200},"category":{"type":"string","enum":["Important","Noise","Bills & Receipts"]},"confidence":{"type":"number","minimum":0,"maximum":1}},"required":["reason","category","confidence"],"additionalProperties":false}';

function answer(fields: Record<string, unknown>): string {
  return JSON.stringify({
    reason: 'A bill is due.',
    category: 'Important',
    confidence: 0.9,
    ...fields,
  });
}

function code(raw: string, s = schema): string {
  const result = validateLlmOutput(s, raw);
  return result.ok ? 'ok' : result.failure.code;
}

describe('ollamaFormat (D-22)', () => {
  it('equals the AI-SPEC verified JSON byte for byte', () => {
    expect(JSON.stringify(ollamaFormat(schema))).toBe(VERIFIED_FORMAT);
  });

  it('orders properties reason, category, confidence (generation order)', () => {
    const format = ollamaFormat(schema) as { properties: Record<string, unknown> };
    expect(Object.keys(format.properties)).toEqual(['reason', 'category', 'confidence']);
    expect(format).not.toHaveProperty('$schema');
  });
});

describe('validateLlmOutput: valid answers', () => {
  it('accepts a valid answer and returns the typed value', () => {
    const result = validateLlmOutput(schema, answer({}));
    expect(result).toEqual({
      ok: true,
      value: { reason: 'A bill is due.', category: 'Important', confidence: 0.9 },
    });
  });

  it.each([
    ['confidence 0', { confidence: 0 }],
    ['confidence 1', { confidence: 1 }],
    ['category with &', { category: 'Bills & Receipts' }],
    [`reason of ${REASON_MAX_CHARS} characters`, { reason: 'r'.repeat(REASON_MAX_CHARS) }],
  ])('accepts %s', (_name, fields) => {
    expect(code(answer(fields))).toBe('ok');
  });
});

describe('validateLlmOutput: out_of_category (CLS-03, CLS-05, no repair)', () => {
  it.each([
    ['an off-list category', 'Spam'],
    ['a lower-case variant', 'important'],
    ['a padded value', 'Important '],
    ['a leading-space value', ' Important'],
    ['a prefix of a category', 'Importan'],
    ['the empty string', ''],
    ['another mailbox category', 'Receipts'],
    ['full-width letters', 'Ｉｍｐｏｒｔａｎｔ'],
    ['an HTML entity for &', 'Bills &amp; Receipts'],
  ])('rejects %s', (_name, category) => {
    expect(code(answer({ category }))).toBe('out_of_category');
  });

  it('rejects the NFD form of an accented category', () => {
    const accented = llmOutputSchema(['Café', 'Noise']);
    expect(code(answer({ category: 'Café' }), accented)).toBe('ok');
    expect(code(answer({ category: 'Café'.normalize('NFD') }), accented)).toBe('out_of_category');
  });

  it('rejects a category valid only in another snapshot', () => {
    const other = llmOutputSchema(['Receipts', 'Noise']);
    expect(code(answer({ category: 'Receipts' }), other)).toBe('ok');
    expect(code(answer({ category: 'Receipts' }))).toBe('out_of_category');
  });
});

describe('validateLlmOutput: schema_mismatch (CLS-03, CLS-04)', () => {
  // Zod 4.6 counts code points, like the grammar's maxLength: the code is never looser.
  const emoji = (n: number) => '\u{1F600}'.repeat(n);

  it.each([
    ['confidence above 1', answer({ confidence: 7.5 })],
    ['confidence below 0', answer({ confidence: -0.1 })],
    ['confidence as a string', answer({ confidence: '0.9' })],
    ['confidence null', answer({ confidence: null })],
    ['a missing reason', JSON.stringify({ category: 'Important', confidence: 0.9 })],
    ['a whitespace-only reason', answer({ reason: '   ' })],
    ['an empty reason', answer({ reason: '' })],
    ['a 201-character reason', answer({ reason: 'r'.repeat(REASON_MAX_CHARS + 1) })],
    ['a reason of 201 astral emoji (201 code points)', answer({ reason: emoji(201) })],
    ['an extra key', answer({ note: 'x' })],
    ['an empty object', '{}'],
    ['a missing category', JSON.stringify({ reason: 'x', confidence: 0.9 })],
    ['a numeric category', answer({ category: 3 })],
    ['a JSON string', '"Important"'],
    ['a JSON array', '["Important"]'],
    ['JSON null', 'null'],
  ])('rejects %s', (_name, raw) => {
    expect(code(raw)).toBe('schema_mismatch');
  });

  it('counts code points like the grammar: 200 emoji (400 UTF-16 units) pass, 201 fail', () => {
    expect(emoji(200)).toHaveLength(400);
    expect(code(answer({ reason: emoji(200) }))).toBe('ok');
    expect(code(answer({ reason: emoji(101) }))).toBe('ok');
    expect(code(answer({ reason: emoji(201) }))).toBe('schema_mismatch');
  });
});

describe('validateLlmOutput: not_json', () => {
  it.each([
    ['plain text', 'This is Important.'],
    ['empty content', ''],
    ['JSON followed by more text', `${answer({})} and more`],
    ['a fenced code block', `\`\`\`json\n${answer({})}\n\`\`\``],
    ['two JSON objects', `${answer({})}${answer({})}`],
  ])('rejects %s', (_name, raw) => {
    expect(code(raw)).toBe('not_json');
  });
});

describe('validateLlmOutput: failure detail', () => {
  const secret = 'QZSECRETTEXT';

  it.each([
    ['not_json', `${secret} is not json`],
    ['out_of_category', answer({ category: secret })],
    ['schema_mismatch', answer({ reason: secret.repeat(30), extra: secret })],
  ])('holds paths and codes only for %s, never the raw text', (expected, raw) => {
    const result = validateLlmOutput(schema, raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe(expected);
    expect(result.failure.detail).not.toContain(secret);
  });

  it('names the failing paths', () => {
    const result = validateLlmOutput(schema, answer({ confidence: 7.5, category: 'Spam' }));
    expect(result).toEqual({
      ok: false,
      failure: { code: 'out_of_category', detail: 'category: invalid_value; confidence: too_big' },
    });
  });
});
