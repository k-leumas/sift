import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex } from '../src/classify/index.ts';
import {
  parseRulesText,
  RULES_FORMAT_VERSION,
  type RulesConfig,
  ruleSetVersionOf,
} from '../src/rules/index.ts';

function parse(text: string): RulesConfig {
  const result = parseRulesText(text, 'rules.yaml');
  if (!result.ok) throw new Error(`invalid test rules: ${JSON.stringify(result.issues)}`);
  return result.rules;
}

function hashOf(text: string): string {
  return ruleSetVersionOf(parse(text)).hash;
}

const BASE = `version: 1
categories:
  - name: Important
    description: things I need to act on
  - name: Receipts
    description: orders and invoices
judgment:
  - Never mark anything from my bank as Noise.
  - Newsletters are Reading.
rules:
  - kind: exact
    name: bank alerts
    match:
      domain: [bank.example.test]
    label: Important
  - kind: exact
    name: shop orders
    match:
      from: [receipts@shop.example.test]
      phrase: [order confirmation]
      in: subject
    label: Receipts
`;

/** The same rules, written differently: none of these may create a new version (D-03, TRC-04). */
const formattingVariants: { name: string; text: string }[] = [
  {
    name: 'comments and blank lines',
    text: `# My rules
version: 1   # format

categories:
  # what I file mail into
  - name: Important
    description: things I need to act on

  - name: Receipts
    description: orders and invoices
judgment:
  - Never mark anything from my bank as Noise.

  - Newsletters are Reading.
rules:
  - kind: exact # the only kind
    name: bank alerts
    match:
      domain: [bank.example.test]
    label: Important

  - kind: exact
    name: shop orders
    match:
      from: [receipts@shop.example.test]
      phrase: [order confirmation]
      in: subject
    label: Receipts
`,
  },
  {
    name: 'keys reordered',
    text: `rules:
  - label: Important
    match:
      domain: [bank.example.test]
    name: bank alerts
    kind: exact
  - match:
      in: subject
      phrase: [order confirmation]
      from: [receipts@shop.example.test]
    label: Receipts
    kind: exact
    name: shop orders
judgment:
  - Never mark anything from my bank as Noise.
  - Newsletters are Reading.
categories:
  - description: things I need to act on
    name: Important
  - description: orders and invoices
    name: Receipts
version: 1
`,
  },
  {
    name: 'flow and block lists swapped',
    text: `version: 1
categories: [{ name: Important, description: things I need to act on }, { name: Receipts, description: orders and invoices }]
judgment: [Never mark anything from my bank as Noise., Newsletters are Reading.]
rules:
  - kind: exact
    name: bank alerts
    match:
      domain:
        - bank.example.test
    label: Important
  - kind: exact
    name: shop orders
    match: { from: [receipts@shop.example.test], phrase: [order confirmation], in: subject }
    label: Receipts
`,
  },
  {
    name: 'quoted and plain scalars',
    text: `version: 1
categories:
  - name: "Important"
    description: 'things I need to act on'
  - name: 'Receipts'
    description: "orders and invoices"
judgment:
  - "Never mark anything from my bank as Noise."
  - 'Newsletters are Reading.'
rules:
  - kind: "exact"
    name: "bank alerts"
    match:
      domain: ["bank.example.test"]
    label: 'Important'
  - kind: exact
    name: 'shop orders'
    match:
      from: ['receipts@shop.example.test']
      phrase: ["order confirmation"]
      in: "subject"
    label: Receipts
`,
  },
  {
    name: 'entries the schema normalises (case, trailing dot, spacing)',
    text: BASE.replace('[bank.example.test]', '[Bank.Example.Test.]')
      .replace('[receipts@shop.example.test]', '[Receipts@Shop.Example.Test]')
      .replace('[order confirmation]', '["  order   confirmation "]'),
  },
];

function swapRules(text: string): string {
  const start = text.indexOf('  - kind: exact\n    name: bank alerts');
  const second = text.indexOf('  - kind: exact\n    name: shop orders');
  return `${text.slice(0, start)}${text.slice(second)}${text.slice(start, second)}`;
}

/** Each changes what the rules mean: each must create a new version. */
const meaningfulChanges: { name: string; text: string }[] = [
  {
    name: 'a category description',
    text: BASE.replace('things I need to act on', 'things I must act on'),
  },
  {
    name: 'a judgment line',
    text: BASE.replace('Newsletters are Reading.', 'Newsletters are Reading!'),
  },
  {
    name: 'one character of a phrase',
    text: BASE.replace('order confirmation', 'order confirmatio'),
  },
  { name: 'the rule order', text: swapRules(BASE) },
  {
    name: 'a label',
    text: BASE.replace(
      'domain: [bank.example.test]\n    label: Important',
      'domain: [bank.example.test]\n    label: Receipts',
    ),
  },
  {
    name: 'the category order',
    text: BASE.replace(
      `  - name: Important
    description: things I need to act on
  - name: Receipts
    description: orders and invoices`,
      `  - name: Receipts
    description: orders and invoices
  - name: Important
    description: things I need to act on`,
    ),
  },
  { name: 'a rule name', text: BASE.replace('name: bank alerts', 'name: bank alert') },
  { name: 'where a phrase is looked for', text: BASE.replace('in: subject', 'in: body') },
  {
    name: 'a domain condition',
    text: BASE.replace('[bank.example.test]', '[bank.example.test, bank2.example.test]'),
  },
];

describe('ruleSetVersionOf (D-03, CLS-06, TRC-04)', () => {
  it('the same file parsed twice gives the same hash', () => {
    expect(hashOf(BASE)).toBe(hashOf(BASE));
  });

  it('the hash is the sha256 hex of the canonical JSON of format version and validated rules', () => {
    const rules = parse(BASE);
    const version = ruleSetVersionOf(rules);
    expect(version.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(version.hash).toBe(
      sha256Hex(canonicalJson({ format_version: RULES_FORMAT_VERSION, rules })),
    );
  });

  it.each(formattingVariants)('formatting only ($name) keeps the hash', ({ text }) => {
    expect(hashOf(text)).toBe(hashOf(BASE));
  });

  it.each(meaningfulChanges)('a changed $name gives a different hash', ({ text }) => {
    expect(text).not.toBe(BASE);
    expect(hashOf(text)).not.toBe(hashOf(BASE));
  });

  it('formatVersion is RULES_FORMAT_VERSION', () => {
    expect(ruleSetVersionOf(parse(BASE)).formatVersion).toBe(RULES_FORMAT_VERSION);
  });

  it('the snapshot deep-equals the validated rules and is plain JSON', () => {
    const rules = parse(BASE);
    const { snapshot } = ruleSetVersionOf(rules);
    expect(snapshot).toEqual(rules);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.rules[1]?.match.in).toBe('subject');
  });

  it('the snapshot does not share objects with the caller', () => {
    const rules = parse(BASE);
    const { snapshot, hash } = ruleSetVersionOf(rules);
    (rules.categories[0] as { description: string }).description = 'changed later';
    expect(snapshot.categories[0]?.description).toBe('things I need to act on');
    expect(
      sha256Hex(canonicalJson({ format_version: RULES_FORMAT_VERSION, rules: snapshot })),
    ).toBe(hash);
  });
});
