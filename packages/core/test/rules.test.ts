import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ConfigIssue, formatIssue, formatPath } from '../src/config/errors.ts';
import { loadRules, parseRulesText, RULES_FILE_MAX_BYTES } from '../src/rules/load.ts';
import {
  CATEGORY_NAME_PATTERN,
  JUDGMENT_TOTAL_MAX_CHARS,
  MAX_CATEGORIES,
  MAX_LIST_ENTRIES,
  MAX_RULES,
  MIN_CATEGORIES,
  RULES_FORMAT_VERSION,
} from '../src/rules/schema.ts';

const CATEGORIES = [
  'categories:',
  '  - name: Important',
  '    description: things I need to act on or reply to personally',
  '  - name: Job search',
  '    description: recruiters, applications, interview scheduling',
  '  - name: Receipts',
  '    description: orders, invoices, shipping updates',
  '  - name: Reading',
  '    description: newsletters I actually read',
  '  - name: Noise',
  '    description: everything else',
].join('\n');

const RULES = [
  'rules:',
  '  - kind: exact',
  '    name: bank alerts',
  '    match:',
  '      domain: [bank.example.test]',
  '    label: Important',
  '  - kind: exact',
  '    match:',
  '      from: [receipts@shop.example.test]',
  '      phrase: [order confirmation]',
  '      in: subject',
  '    label: Receipts',
].join('\n');

function rulesYaml(
  options: { head?: string; categories?: string; judgment?: string; rules?: string } = {},
): string {
  return [
    options.head ?? 'version: 1',
    options.categories ?? CATEGORIES,
    options.judgment ?? 'judgment:\n  - Never mark anything from my bank as Noise.',
    options.rules ?? RULES,
    '',
  ].join('\n');
}

/** A categories block with `count` valid, distinct names. */
function categoriesOf(count: number): string {
  const lines = ['categories:'];
  for (let i = 0; i < count; i++) {
    lines.push(`  - name: Category ${i}`, `    description: category number ${i}`);
  }
  return lines.join('\n');
}

/** A categories block with Important plus one other name, written exactly as given. */
function categoriesWithName(name: string): string {
  return [
    'categories:',
    '  - name: Important',
    '    description: things to act on',
    `  - name: ${name}`,
    '    description: the name under test',
  ].join('\n');
}

/** One rule whose match block is given as raw lines (6-space indent). */
function ruleWith(matchLines: string[], label = 'Important', extra: string[] = []): string {
  return [
    'rules:',
    '  - kind: exact',
    '    match:',
    ...matchLines,
    `    label: ${label}`,
    ...extra,
  ].join('\n');
}

function issuesOf(text: string): ConfigIssue[] {
  const result = parseRulesText(text, 'rules.yaml');
  if (result.ok) throw new Error('expected the rules file to be rejected');
  return result.issues;
}

function parsed(text: string) {
  const result = parseRulesText(text, 'rules.yaml');
  if (!result.ok) throw new Error(`expected a valid rules file: ${JSON.stringify(result.issues)}`);
  return result.rules;
}

/** Issues located at `path` (YAML-style, e.g. `rules[0].label`). */
function issuesAt(text: string, path: string): ConfigIssue[] {
  return issuesOf(text).filter((issue) => formatPath(issue.path) === path);
}

/** 1-based line of the first line of `text` containing `needle`. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`"${needle}" not in the text`);
  return index + 1;
}

/** Asserts exactly one issue at `path`, with `message` contained and on the line holding `needle`. */
function expectIssue(text: string, path: string, message: string, needle: string): void {
  const found = issuesAt(text, path);
  expect(found, JSON.stringify(issuesOf(text))).toHaveLength(1);
  expect(found[0]?.message).toContain(message);
  expect(found[0]?.line).toBe(lineOf(text, needle));
}

describe('a valid rules file (D-01, D-02)', () => {
  it('parses a file shaped like the docs/configuration.md example into the validated object', () => {
    const rules = parsed(rulesYaml());
    expect(rules.version).toBe(RULES_FORMAT_VERSION);
    expect(rules.categories.map((c) => c.name)).toEqual([
      'Important',
      'Job search',
      'Receipts',
      'Reading',
      'Noise',
    ]);
    expect(rules.categories[0]?.description).toBe('things I need to act on or reply to personally');
    expect(rules.judgment).toEqual(['Never mark anything from my bank as Noise.']);
    expect(rules.rules).toEqual([
      {
        kind: 'exact',
        name: 'bank alerts',
        match: { domain: ['bank.example.test'] },
        label: 'Important',
      },
      {
        kind: 'exact',
        match: {
          from: ['receipts@shop.example.test'],
          phrase: ['order confirmation'],
          in: 'subject',
        },
        label: 'Receipts',
      },
    ]);
  });

  it('accepts rules: [] and a file with no rules or judgment key (everything goes to the LLM)', () => {
    expect(parsed(rulesYaml({ rules: 'rules: []' })).rules).toEqual([]);
    const bare = ['version: 1', CATEGORIES, ''].join('\n');
    const rules = parsed(bare);
    expect(rules.rules).toEqual([]);
    expect(rules.judgment).toEqual([]);
  });

  it(`accepts ${MIN_CATEGORIES} and ${MAX_CATEGORIES} categories`, () => {
    expect(
      parsed(rulesYaml({ categories: categoriesOf(MIN_CATEGORIES), rules: 'rules: []' }))
        .categories,
    ).toHaveLength(MIN_CATEGORIES);
    expect(
      parsed(rulesYaml({ categories: categoriesOf(MAX_CATEGORIES), rules: 'rules: []' }))
        .categories,
    ).toHaveLength(MAX_CATEGORIES);
  });
});

describe('normalisation of match entries (D-08, D-09)', () => {
  it('lowercases from and domain entries and drops one trailing dot from a domain', () => {
    const text = rulesYaml({
      rules: ruleWith([
        '      from: [Receipts@Shop.Example.Test]',
        '      domain: [Bank.Example.Test.]',
      ]),
    });
    expect(parsed(text).rules[0]?.match).toEqual({
      from: ['receipts@shop.example.test'],
      domain: ['bank.example.test'],
    });
  });

  it('trims a phrase and collapses inner whitespace runs, keeping its case', () => {
    const text = rulesYaml({ rules: ruleWith(['      phrase: ["  Order \t  confirmation  "]']) });
    expect(parsed(text).rules[0]?.match.phrase).toEqual(['Order confirmation']);
  });

  it('stores in: any for a phrase rule without in, and adds no in to a rule without phrase', () => {
    const phrase = rulesYaml({ rules: ruleWith(['      phrase: [interview]']) });
    expect(parsed(phrase).rules[0]?.match).toEqual({ phrase: ['interview'], in: 'any' });
    const domain = rulesYaml({ rules: ruleWith(['      domain: [bank.example.test]']) });
    expect(parsed(domain).rules[0]?.match).toEqual({ domain: ['bank.example.test'] });
  });

  it('keeps in: body as written', () => {
    const text = rulesYaml({ rules: ruleWith(['      phrase: [interview]', '      in: body']) });
    expect(parsed(text).rules[0]?.match.in).toBe('body');
  });
});

describe('category names (D-06, ascii)', () => {
  it.each(['Job search', 'Bills & Tax', 'Follow-up', 'A', 'Q3 2026', 'x'.repeat(40)])(
    'accepts %s',
    (name) => {
      expect(
        parsed(rulesYaml({ categories: categoriesWithName(name), rules: 'rules: []' }))
          .categories[1]?.name,
      ).toBe(name);
    },
  );

  it.each([
    ['a 41-character name', 'x'.repeat(41)],
    ['a double space', '"Job  search"'],
    ['a slash', '"Bills/Tax"'],
    ['a non-ASCII letter', 'Büro'],
    ['an underscore', 'Job_search'],
    ['an empty name', '""'],
  ])('rejects %s, never fixing it', (_label, name) => {
    const text = rulesYaml({ categories: categoriesWithName(name), rules: 'rules: []' });
    expectIssue(
      text,
      'categories[1].name',
      'category names may use letters, digits, single spaces, - and & (1 to 40 characters)',
      `name: ${name}`,
    );
  });

  it('rejects a leading or trailing space instead of trimming it', () => {
    for (const name of ['" Important2"', '"Important2 "']) {
      const text = rulesYaml({ categories: categoriesWithName(name), rules: 'rules: []' });
      expectIssue(
        text,
        'categories[1].name',
        'must not start or end with a space',
        `name: ${name}`,
      );
    }
  });

  it('pins the ascii character set', () => {
    expect(CATEGORY_NAME_PATTERN.source).toBe('^[A-Za-z0-9&-]+(?: [A-Za-z0-9&-]+)*$');
  });

  it('rejects names that differ only in case and names the earlier entry', () => {
    const text = rulesYaml({ categories: categoriesWithName('IMPORTANT'), rules: 'rules: []' });
    expectIssue(
      text,
      'categories[1].name',
      'duplicate category name "IMPORTANT"',
      'name: IMPORTANT',
    );
    expect(issuesAt(text, 'categories[1].name')[0]?.message).toContain('categories[0]');
  });

  it(`rejects 1 and ${MAX_CATEGORIES + 1} categories`, () => {
    for (const count of [1, MAX_CATEGORIES + 1]) {
      const text = rulesYaml({ categories: categoriesOf(count), rules: 'rules: []' });
      // A list-level issue sits at the list node, i.e. its first item (as config.yaml's mailboxes).
      expectIssue(
        text,
        'categories',
        'categories must list from 2 to 20 categories',
        'name: Category 0',
      );
    }
  });

  it('rejects an empty categories list and a missing one', () => {
    const empty = rulesYaml({ categories: 'categories: []', rules: 'rules: []' });
    expectIssue(empty, 'categories', 'categories must list from 2 to 20 categories', 'categories:');
    const missing = ['version: 1', 'rules: []', ''].join('\n');
    expect(issuesAt(missing, 'categories')[0]?.message).toContain('categories is required');
  });

  it('rejects a description with a line break, an empty one and one over 200 characters', () => {
    const descriptions: [string, string][] = [
      ['"line one\\nline two"', 'description must be one line'],
      ['""', 'description must not be empty'],
      ['y'.repeat(201), 'description must be at most 200 characters'],
    ];
    for (const [description, message] of descriptions) {
      const categories = [
        'categories:',
        '  - name: Important',
        `    description: ${description}`,
        '  - name: Noise',
        '    description: everything else',
      ].join('\n');
      const text = rulesYaml({ categories, rules: 'rules: []' });
      expectIssue(text, 'categories[0].description', message, `description: ${description}`);
    }
  });
});

describe('judgment lines', () => {
  it('rejects a judgment line with a line break', () => {
    const text = rulesYaml({ judgment: 'judgment:\n  - "one\\ntwo"' });
    expectIssue(text, 'judgment[0]', 'judgment lines must be one line', '"one');
  });

  it(`rejects judgment text over ${JUDGMENT_TOTAL_MAX_CHARS} characters in total at judgment`, () => {
    const lines = Array.from({ length: 9 }, () => `  - ${'z'.repeat(450)}`);
    const text = rulesYaml({ judgment: ['judgment:', ...lines].join('\n') });
    expectIssue(text, 'judgment', 'judgment lines add up to 4050 characters (max 4000)', '  - zzz');
  });
});

describe('exact rules (D-08, D-09, D-10, D-13)', () => {
  it('rejects a label that is not one of the categories and lists the categories', () => {
    const text = rulesYaml({ rules: ruleWith(['      domain: [bank.example.test]'], 'Bills') });
    expectIssue(
      text,
      'rules[0].label',
      'label "Bills" is not one of the categories (Important, Job search, Receipts, Reading, Noise)',
      'label: Bills',
    );
  });

  it('compares labels case-sensitively and refuses review as a target', () => {
    for (const label of ['important', 'review']) {
      const text = rulesYaml({ rules: ruleWith(['      domain: [bank.example.test]'], label) });
      expectIssue(
        text,
        'rules[0].label',
        `label "${label}" is not one of the categories`,
        `label: ${label}`,
      );
    }
  });

  it('rejects in without phrase at match.in', () => {
    const text = rulesYaml({
      rules: ruleWith(['      domain: [bank.example.test]', '      in: subject']),
    });
    expectIssue(text, 'rules[0].match.in', 'in only applies to phrase', 'in: subject');
  });

  it('rejects an empty match mapping at match', () => {
    const text = rulesYaml({
      rules: ['rules:', '  - kind: exact', '    match: {}', '    label: Important'].join('\n'),
    });
    expectIssue(
      text,
      'rules[0].match',
      'match needs at least one of from, domain, phrase',
      'match: {}',
    );
  });

  it.each(['from', 'domain', 'phrase'])('rejects an empty %s list at its path', (key) => {
    const text = rulesYaml({ rules: ruleWith([`      ${key}: []`]) });
    expectIssue(text, `rules[0].match.${key}`, `${key} must list at least one entry`, `${key}: []`);
  });

  it(`rejects a list of more than ${MAX_LIST_ENTRIES} entries`, () => {
    const many = Array.from({ length: MAX_LIST_ENTRIES + 1 }, (_, i) => `d${i}.example.test`);
    const text = rulesYaml({ rules: ruleWith([`      domain: [${many.join(', ')}]`]) });
    expectIssue(text, 'rules[0].match.domain', 'domain may list at most 100 entries', 'domain: [');
  });

  it('rejects a single value where a list is expected', () => {
    const text = rulesYaml({ rules: ruleWith(['      domain: bank.example.test']) });
    expectIssue(text, 'rules[0].match.domain', 'domain must be a list', 'domain: bank');
  });

  it.each([
    ['an @', 'bank@example.test'],
    ['a leading dot', '.example.test'],
    ['whitespace', '"bank example.test"'],
    ['an empty label', 'bank..example.test'],
  ])('rejects a domain entry with %s', (_label, entry) => {
    const text = rulesYaml({ rules: ruleWith([`      domain: [${entry}]`]) });
    expectIssue(
      text,
      'rules[0].match.domain[0]',
      'domain entries are a domain such as example.test, without @',
      `domain: [${entry}]`,
    );
  });

  it.each([
    ['two @', 'a@b@example.test'],
    ['no @', 'example.test'],
    ['whitespace', '"a b@example.test"'],
  ])('rejects a from entry with %s', (_label, entry) => {
    const text = rulesYaml({ rules: ruleWith([`      from: [${entry}]`]) });
    expectIssue(
      text,
      'rules[0].match.from[0]',
      'from entries must be one email address',
      `from: [${entry}]`,
    );
  });

  it('rejects an empty phrase and one over 200 characters', () => {
    const empty = rulesYaml({ rules: ruleWith(['      phrase: ["   "]']) });
    expectIssue(empty, 'rules[0].match.phrase[0]', 'phrase entries must not be empty', 'phrase:');
    const long = rulesYaml({ rules: ruleWith([`      phrase: [${'p'.repeat(201)}]`]) });
    expectIssue(long, 'rules[0].match.phrase[0]', 'at most 200 characters', 'phrase:');
  });

  it('rejects an in value outside subject, body, any', () => {
    const text = rulesYaml({ rules: ruleWith(['      phrase: [x]', '      in: headers']) });
    expectIssue(text, 'rules[0].match.in', 'in must be subject, body, any', 'in: headers');
  });

  it('rejects another rule kind and a missing kind', () => {
    const other = rulesYaml({
      rules: ruleWith(['      domain: [bank.example.test]']).replace('kind: exact', 'kind: llm'),
    });
    expectIssue(
      other,
      'rules[0].kind',
      'kind must be exact; other rule kinds arrive with rules.md (M3)',
      'kind: llm',
    );
    const missing = rulesYaml({
      rules: [
        'rules:',
        '  - match:',
        '      domain: [bank.example.test]',
        '    label: Important',
      ].join('\n'),
    });
    expect(issuesAt(missing, 'rules[0].kind')[0]?.message).toBe('kind is required (kind: exact)');
  });

  it(`rejects more than ${MAX_RULES} rules`, () => {
    const one = [
      '  - kind: exact',
      '    match: { domain: [bank.example.test] }',
      '    label: Important',
    ];
    const lines = ['rules:'];
    for (let i = 0; i <= MAX_RULES; i++) lines.push(...one);
    const text = rulesYaml({ rules: lines.join('\n') });
    expectIssue(text, 'rules', 'rules may list at most 500 rules', '  - kind: exact');
  });

  it('rejects rules: with no value instead of reading it as no rules', () => {
    const text = rulesYaml({ rules: 'rules:' });
    expectIssue(text, 'rules', 'rules must be a list of rules', 'rules:');
  });
});

/** A file whose first category description is `description`, written as YAML. */
function withDescription(description: string): string {
  const categories = [
    'categories:',
    '  - name: Important',
    `    description: ${description}`,
    '  - name: Noise',
    '    description: everything else',
  ].join('\n');
  return rulesYaml({ categories, rules: 'rules: []' });
}

/** The three one-line fields: YAML path, message name and a file holding `value` there. */
const oneLineFields: [string, string, (value: string) => string][] = [
  ['categories[0].description', 'description', withDescription],
  ['judgment[0]', 'judgment lines', (value) => rulesYaml({ judgment: `judgment:\n  - ${value}` })],
  [
    'rules[0].name',
    'name',
    (value) =>
      rulesYaml({
        rules: ruleWith(['      domain: [bank.example.test]']).replace(
          '  - kind: exact',
          `  - kind: exact\n    name: ${value}`,
        ),
      }),
  ],
];

/** The three exact-rule entry lists: key and a valid entry to break. */
const entryKinds: [string, string][] = [
  ['from', 'receipts@shop.example.test'],
  ['domain', 'bank.example.test'],
  ['phrase', 'order confirmation'],
];

// Fixtures write control characters as YAML double-quoted escapes (\0, \x07, \t, \N for
// U+0085, \L for U+2028), so this file holds none of them raw.
describe('control characters in rules text (WR-02, D-05)', () => {
  it('rejects NUL, BEL, an inner tab and U+0085 in a description, judgment line or rule name', () => {
    for (const [path, name, file] of oneLineFields) {
      for (const value of ['"to\\0do"', '"to\\x07do"', '"to\\tdo"', '"to\\Ndo"']) {
        expectIssue(file(value), path, `${name} must not contain control characters`, value);
      }
    }
  });

  it('reports an inner line break or U+2028 as one issue, "must be one line"', () => {
    for (const [path, name, file] of oneLineFields) {
      for (const value of ['"to\\ndo"', '"to\\Ldo"', '"to\\ndo\\0"']) {
        const text = file(value);
        expectIssue(text, path, `${name} must be one line`, value);
        expect(issuesOf(text)).toHaveLength(1);
      }
    }
  });

  it('rejects from, domain and phrase entries holding NUL or BEL', () => {
    const entries: [string, string][] = [
      ['from', 'receipts@shop.example.test'],
      ['domain', 'bank.example.test'],
      ['phrase', 'order confirmation'],
    ];
    for (const [key, entry] of entries) {
      for (const yamlEscape of ['\\0', '\\x07']) {
        const value = `"${entry.slice(0, 4)}${yamlEscape}${entry.slice(4)}"`;
        const text = rulesYaml({ rules: ruleWith([`      ${key}: [${value}]`]) });
        expectIssue(
          text,
          `rules[0].match.${key}[0]`,
          `${key} entries must not contain control characters`,
          `${key}: [`,
        );
      }
    }
  });

  it('still loads a phrase with an inner tab, stored with one space', () => {
    const text = rulesYaml({ rules: ruleWith(['      phrase: ["order\\tconfirmation"]']) });
    expect(parsed(text).rules[0]?.match.phrase).toEqual(['order confirmation']);
  });

  it('still loads a description with accents and CJK text', () => {
    const description = 'factures du café, Rechnungen für Übersee, 領収書';
    const rules = parsed(withDescription(description));
    expect(rules.categories[0]?.description).toBe(description);
  });
});

// Unpaired surrogates (U+D800 to U+DFFF without a partner) are written as YAML
// double-quoted escapes built at runtime from BACKSLASH, so this file holds no
// backslash-u sequence and no raw surrogate (the Write/Edit tools and biome would
// decode one, and a raw lone surrogate cannot be saved as UTF-8 at all).
describe('unpaired surrogates in rules text (WR-05, D-05)', () => {
  const BACKSLASH = String.fromCharCode(92);
  /** The YAML double-quoted escape for the UTF-16 code unit `hex`. */
  const esc = (hex: string): string => `${BACKSLASH}u${hex}`;
  const SURROGATE_MESSAGE = 'must not contain an unpaired surrogate (U+D800 to U+DFFF)';

  it('sentinel: the escapes are built, not written', () => {
    expect(esc('D800')).toHaveLength(6);
    expect(esc('D800').charCodeAt(0)).toBe(92);
  });

  it('rejects a lone high (U+D800) or low (U+DC00) surrogate in a description, judgment line or rule name', () => {
    for (const [path, name, file] of oneLineFields) {
      for (const value of [`"to${esc('D800')}do"`, `"to${esc('DC00')}do"`]) {
        const text = file(value);
        expectIssue(text, path, `${name} ${SURROGATE_MESSAGE}`, value);
        expect(issuesOf(text)).toHaveLength(1);
      }
    }
  });

  it('names the fix and never quotes the value', () => {
    const [issue] = issuesOf(withDescription(`"secret${esc('D800')}text"`));
    expect(issue?.message).toBe(
      `description ${SURROGATE_MESSAGE}; write the character itself, not its escape`,
    );
    expect(issue?.message).not.toContain('secret');
  });

  it('reports a line break or a control character first, as the only issue', () => {
    for (const [path, name, file] of oneLineFields) {
      const cases: [string, string][] = [
        [`"to${BACKSLASH}ndo${esc('D800')}"`, `${name} must be one line`],
        [`"to${BACKSLASH}0do${esc('D800')}"`, `${name} must not contain control characters`],
      ];
      for (const [value, message] of cases) {
        const text = file(value);
        expectIssue(text, path, message, value);
        expect(issuesOf(text)).toHaveLength(1);
      }
    }
  });

  it('rejects from, domain and phrase entries holding a lone surrogate', () => {
    for (const [key, entry] of entryKinds) {
      for (const hex of ['D800', 'DC00']) {
        const value = `"${entry.slice(0, 4)}${esc(hex)}${entry.slice(4)}"`;
        const text = rulesYaml({ rules: ruleWith([`      ${key}: [${value}]`]) });
        expectIssue(
          text,
          `rules[0].match.${key}[0]`,
          `${key} entries ${SURROGATE_MESSAGE}`,
          `${key}: [`,
        );
        expect(issuesOf(text)).toHaveLength(1);
      }
    }
  });

  it('still loads a description written as the two escapes of a valid pair', () => {
    const rules = parsed(withDescription(`"smile ${esc('D83D')}${esc('DE00')} please"`));
    expect(rules.categories[0]?.description).toBe(`smile ${String.fromCodePoint(0x1f600)} please`);
  });

  it('still loads a description holding the emoji itself, unchanged', () => {
    const description = `inbox ${String.fromCodePoint(0x1f600)} zero`;
    expect(parsed(withDescription(description)).categories[0]?.description).toBe(description);
  });
});

describe('unknown keys and versions (P1 D-57)', () => {
  it.each([
    ['the root', 'version: 1\nlabels: []', 'labels', 'labels:'],
    ['a category', undefined, 'categories[0].colour', 'colour:'],
    ['a rule', undefined, 'rules[0].priority', 'priority:'],
    ['a match', undefined, 'rules[0].match.subject', 'subject:'],
  ])('rejects an unknown key in %s at its own line', (_where, head, path, needle) => {
    let text = rulesYaml({ head });
    if (path.startsWith('categories')) {
      text = text.replace('  - name: Important\n', '  - name: Important\n    colour: red\n');
    } else if (path === 'rules[0].priority') {
      text = text.replace('    label: Important\n', '    label: Important\n    priority: 1\n');
    } else if (path.endsWith('subject')) {
      text = text.replace(
        '      domain: [bank.example.test]\n',
        '      domain: [bank.example.test]\n      subject: [x]\n',
      );
    }
    const key = path.split('.').at(-1) ?? '';
    expectIssue(text, path, `unrecognized key "${key}"`, needle);
  });

  it('rejects a missing version and a different version', () => {
    const missing = rulesYaml({ head: '# no version' });
    expect(issuesAt(missing, 'version')[0]?.message).toBe(
      'version is required (this Sift build reads rules version 1)',
    );
    const other = rulesYaml({ head: 'version: 2' });
    expectIssue(
      other,
      'version',
      'unsupported rules version 2; this Sift build reads version 1',
      'version: 2',
    );
  });
});

describe('every problem in one pass, in file order', () => {
  it('reports five different problems in line order with their paths', () => {
    const text = [
      'version: 1',
      'categories:',
      '  - name: Important',
      '    description: things to act on',
      '  - name: "Bills/Tax"',
      '    description: invoices',
      'rules:',
      '  - kind: exact',
      '    match:',
      '      domain: [bank@example.test]',
      '    label: Important',
      '  - kind: exact',
      '    match:',
      '      from: [a@b.example.test]',
      '      in: body',
      '    label: Noise',
      '  - kind: exact',
      '    match: {}',
      '    label: Important',
      '    note: hello',
      '',
    ].join('\n');
    const issues = issuesOf(text);
    expect(issues.map((issue) => formatPath(issue.path))).toEqual([
      'categories[1].name',
      'rules[0].match.domain[0]',
      'rules[1].match.in',
      'rules[1].label',
      'rules[2].match',
      'rules[2].note',
    ]);
    expect(issues.map((issue) => issue.line)).toEqual([5, 10, 15, 16, 18, 20]);
    expect(formatIssue(issues[3] as ConfigIssue, 'rules.yaml')).toBe(
      'rules.yaml:16:12 rules[1].label: label "Noise" is not one of the categories (Important, Bills/Tax)',
    );
  });
});

describe('file problems', () => {
  it('reports a YAML syntax error with its first line only', () => {
    const [issue, ...rest] = issuesOf('version: 1\ncategories: [\n');
    expect(rest).toEqual([]);
    expect(issue?.message).toMatch(/^YAML syntax error: [^\n]+$/);
  });

  it('reports an empty file', () => {
    expect(issuesOf('')[0]?.message).toBe(
      'rules file is empty: expected version: 1, categories and rules',
    );
  });

  it('rejects a file over 256 KiB before parsing it', () => {
    const text = `${rulesYaml()}# ${'x'.repeat(RULES_FILE_MAX_BYTES)}\n`;
    expect(issuesOf(text)).toEqual([{ path: [], message: 'rules file is larger than 256 KiB' }]);
  });

  it('rejects more than 50 YAML aliases before validation', () => {
    const aliases = Array.from({ length: 60 }, () => '*d').join(', ');
    const text = `${rulesYaml()}x: &d [a]\ny: [${aliases}]\n`;
    expect(issuesOf(text)).toEqual([{ path: [], message: 'too many YAML aliases (max 50)' }]);
  });

  it('reports a missing file as an issue naming the path and the example to copy', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sift-rules-'));
    const path = join(dir, 'rules.yaml');
    const result = await loadRules(path);
    expect(result).toEqual({
      ok: false,
      source: path,
      issues: [
        {
          path: [],
          message: `rules file not found: ${path}. Copy data/mailboxes/example/rules.example.yaml to that path and edit it`,
        },
      ],
    });
  });

  it('reports an unreadable path with its error code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sift-rules-'));
    const result = await loadRules(dir);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.issues[0]?.message).toBe(`cannot read rules file ${dir} (EISDIR)`);
  });

  it('reads a valid file and never rewrites an invalid one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sift-rules-'));
    const good = join(dir, 'good.yaml');
    await writeFile(good, rulesYaml());
    const loaded = await loadRules(good);
    expect(loaded.ok).toBe(true);

    const bad = join(dir, 'bad.yaml');
    const text = rulesYaml({
      categories: categoriesWithName('" Spaced "'),
      rules: ruleWith(['      domain: [A.TEST.]']),
    });
    await writeFile(bad, text);
    const before = await stat(bad);
    const result = await loadRules(bad);
    expect(result.ok).toBe(false);
    expect(await readFile(bad, 'utf8')).toBe(text);
    expect((await stat(bad)).mtimeMs).toBe(before.mtimeMs);
  });
});
