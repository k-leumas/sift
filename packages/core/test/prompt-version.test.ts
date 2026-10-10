import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  llmOutputSchema,
  ollamaFormat,
  promptMaterial,
  RETRY_NOTE,
  sha256Hex,
} from '../src/classify/index.ts';
import { PROMPT_MATERIAL_PARTS, promptMaterialFrom } from '../src/classify/prompt-version.ts';

/**
 * The prompt_version key (D-29). Any change to the prompt template, a retry
 * note, a model option, a request flag, a limit or the output schema shape
 * changes this hash, which means a new prompt_version row. Update the constant
 * deliberately, never to make a failing test pass by accident.
 */
const EXPECTED_PROMPT_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

const README_CATEGORIES = ['Important', 'Job search', 'Receipts', 'Reading', 'Noise'];

describe('canonicalJson', () => {
  it('sorts object keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('sorts keys by UTF-16 code unit and escapes strings like JSON', () => {
    expect(canonicalJson({ b: 'x"y', a: null, A: true })).toBe('{"A":true,"a":null,"b":"x\\"y"}');
    expect(canonicalJson([3, 'a', false, []])).toBe('[3,"a",false,[]]');
  });

  it.each([
    ['undefined', undefined],
    ['a nested undefined', { a: undefined }],
    ['undefined in an array', [1, undefined]],
    ['a function', { f: () => 1 }],
    ['NaN', Number.NaN],
    ['Infinity', { n: Number.POSITIVE_INFINITY }],
    ['-Infinity', [Number.NEGATIVE_INFINITY]],
    ['a bigint', 1n],
  ])('throws TypeError on %s', (_name, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });
});

describe('sha256Hex', () => {
  it('returns 64 lowercase hex characters', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('Bills & Receipts')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('promptMaterial (D-29)', () => {
  it('is stable across calls and equals the pinned hash', () => {
    const first = promptMaterial();
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(promptMaterial()).toEqual(first);
    expect(first.hash).toBe(EXPECTED_PROMPT_HASH);
  });

  it('renders a human-readable template from placeholders only', () => {
    const { template } = promptMaterial();
    for (const placeholder of [
      '- <category>: <description>',
      '- <rule>',
      'from_address: <from_address>',
      'from_name: <from_name>',
      'subject: <subject>',
      'attachments: <attachment>',
      '<<<EMAIL NONCE>>>',
      '<body>',
      '<<<END EMAIL NONCE>>>',
    ]) {
      expect(template).toContain(placeholder);
    }
    for (const note of Object.values(RETRY_NOTE)) expect(template).toContain(note);
    for (const name of README_CATEGORIES) expect(template).not.toContain(name);
  });

  it('records the output schema shape for the placeholder category', () => {
    const { schemaShape } = promptMaterial();
    expect(schemaShape).toEqual(ollamaFormat(llmOutputSchema(['<category>'])));
    expect(JSON.stringify(schemaShape)).not.toContain('Important');
  });

  it('recomputes the same hash from the real parts', () => {
    expect(promptMaterialFrom({ ...PROMPT_MATERIAL_PARTS }).hash).toBe(promptMaterial().hash);
  });

  const base = PROMPT_MATERIAL_PARTS;
  it.each([
    [
      'the system template text',
      {
        ...base,
        renderSystem: (i: Parameters<typeof base.renderSystem>[0]) => `${base.renderSystem(i)} `,
      },
    ],
    [
      'the user template text',
      {
        ...base,
        renderUser: (e: Parameters<typeof base.renderUser>[0], n: string) =>
          `${base.renderUser(e, n)}.`,
      },
    ],
    ['a retry note', { ...base, retryNotes: { ...base.retryNotes, not_json: 'Try again.' } }],
    ['a model option', { ...base, modelOptions: { ...base.modelOptions, seed: 43 } }],
    ['a request flag', { ...base, requestFlags: { ...base.requestFlags, keep_alive: '5m' } }],
    ['BODY_MAX_CHARS', { ...base, limits: { ...base.limits, body_max_chars: 3000 } }],
    ['HEADER_MAX_CHARS', { ...base, limits: { ...base.limits, header_max_chars: 200 } }],
    [
      'the output schema shape',
      { ...base, schemaShape: { ...base.schemaShape, minProperties: 3 } },
    ],
  ])('changes the hash when %s changes', (_name, parts) => {
    expect(promptMaterialFrom(parts).hash).not.toBe(promptMaterial().hash);
  });
});
