import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLASSIFIER_SKIPPED_SPAN,
  decide,
  decisionSpansSchema,
  type MatchableMessage,
  matchExactRules,
  TRACE_FORMAT_VERSION,
} from '../src/classify/index.ts';
import { type ExactRule, ExactRuleSchema } from '../src/rules/schema.ts';

/** Build a rule through the real schema, so entries are normalised as after loading. */
function rule(match: Record<string, unknown>, label = 'Important', name?: string): ExactRule {
  return ExactRuleSchema.parse({
    kind: 'exact',
    ...(name === undefined ? {} : { name }),
    match,
    label,
  });
}

function mail(overrides: Partial<MatchableMessage> = {}): MatchableMessage {
  return {
    fromAddress: 'someone@other.example.test',
    fromDomain: 'other.example.test',
    subject: null,
    body: null,
    ...overrides,
  };
}

/** From as ingest stores it: the address, domain lowercased, and the domain alone. */
function from(address: string): Pick<MatchableMessage, 'fromAddress' | 'fromDomain'> {
  const at = address.lastIndexOf('@');
  const domain = address.slice(at + 1).toLowerCase();
  return { fromAddress: `${address.slice(0, at)}@${domain}`, fromDomain: domain };
}

const bankDomain = rule({ domain: ['bank.example.test'] }, 'Important', 'bank alerts');

interface MatchCase {
  name: string;
  rules: ExactRule[];
  message: MatchableMessage;
  /** Indices of the matching rules, in file order; the first is the winner. */
  matches: number[];
}

const cases: MatchCase[] = [
  {
    name: 'from address matches case-insensitively',
    rules: [rule({ from: ['Receipts@Shop.example.test'] }, 'Receipts')],
    message: mail(from('RECEIPTS@shop.example.test')),
    matches: [0],
  },
  {
    name: 'from address with another local part does not match',
    rules: [rule({ from: ['receipts@shop.example.test'] }, 'Receipts')],
    message: mail(from('marketing@shop.example.test')),
    matches: [],
  },
  {
    name: 'domain equal to the rule domain matches',
    rules: [bankDomain],
    message: mail(from('alerts@bank.example.test')),
    matches: [0],
  },
  {
    name: 'subdomain matches at a label boundary',
    rules: [bankDomain],
    message: mail(from('alerts@mail.bank.example.test')),
    matches: [0],
  },
  {
    name: 'domain with one trailing dot matches',
    rules: [bankDomain],
    message: mail({ fromAddress: 'alerts@bank.example.test.', fromDomain: 'Bank.Example.Test.' }),
    matches: [0],
  },
  {
    name: 'look-alike notbank.example.test does not match',
    rules: [bankDomain],
    message: mail(from('alerts@notbank.example.test')),
    matches: [],
  },
  {
    name: 'look-alike bank.example.test.evil.example.test does not match',
    rules: [bankDomain],
    message: mail(from('alerts@bank.example.test.evil.example.test')),
    matches: [],
  },
  {
    name: 'display-name spoof "Bank Support" <alerts@evil.example.test> does not match',
    rules: [bankDomain, rule({ from: ['alerts@bank.example.test'] })],
    message: mail({ ...from('alerts@evil.example.test'), subject: 'Bank Support' }),
    matches: [],
  },
  {
    name: 'entries in one list are OR',
    rules: [rule({ domain: ['shop.example.test', 'bank.example.test'] })],
    message: mail(from('alerts@bank.example.test')),
    matches: [0],
  },
  {
    name: 'phrase only in the body does not match in: subject',
    rules: [rule({ phrase: ['order confirmation'], in: 'subject' }, 'Receipts')],
    message: mail({ subject: 'Hello', body: 'Your order confirmation is attached' }),
    matches: [],
  },
  {
    name: 'phrase in the subject matches in: subject',
    rules: [rule({ phrase: ['order confirmation'], in: 'subject' }, 'Receipts')],
    message: mail({ subject: 'Order confirmation #12', body: null }),
    matches: [0],
  },
  {
    name: 'phrase only in the subject does not match in: body',
    rules: [rule({ phrase: ['invite you to an interview'], in: 'body' }, 'Job search')],
    message: mail({ subject: 'We invite you to an interview', body: 'See the attachment.' }),
    matches: [],
  },
  {
    name: 'phrase in the body matches in: body',
    rules: [rule({ phrase: ['invite you to an interview'], in: 'body' }, 'Job search')],
    message: mail({ subject: 'Next steps', body: 'We would like to invite you to an interview.' }),
    matches: [0],
  },
  {
    name: 'phrase in the body matches the default in: any',
    rules: [rule({ phrase: ['order confirmation'] }, 'Receipts')],
    message: mail({ subject: 'Hello', body: 'Your order confirmation' }),
    matches: [0],
  },
  {
    name: 'regex metacharacters in a phrase match only the literal text',
    rules: [rule({ phrase: ['a.b*(c)'] })],
    message: mail({ subject: 'see a.b*(c) here' }),
    matches: [0],
  },
  {
    name: 'regex metacharacters never act as a pattern',
    rules: [rule({ phrase: ['a.b*(c)'] })],
    message: mail({ subject: 'axbbbc and aXb(c) and abc' }),
    matches: [],
  },
  {
    name: 'whitespace and case variants of a phrase match',
    rules: [rule({ phrase: ['Order   Confirmation'] }, 'Receipts')],
    message: mail({ subject: '  ORDER\t\n  confirmation #12' }),
    matches: [0],
  },
  {
    name: 'NFKC: a full-width phrase in mail matches an ASCII rule phrase',
    rules: [rule({ phrase: ['order confirmation'] }, 'Receipts')],
    // Full-width letters and an ideographic space (U+3000).
    message: mail({ subject: 'ＯＲＤＥＲ　ＣＯＮＦＩＲＭＡＴＩＯＮ' }),
    matches: [0],
  },
  {
    name: 'AND: every present field must hold',
    rules: [
      rule({ from: ['receipts@shop.example.test'], phrase: ['order'], in: 'subject' }, 'Receipts'),
    ],
    message: mail({ ...from('receipts@shop.example.test'), subject: 'Your parcel' }),
    matches: [],
  },
  {
    name: 'AND: all fields holding matches',
    rules: [
      rule({ from: ['receipts@shop.example.test'], phrase: ['order'], in: 'subject' }, 'Receipts'),
    ],
    message: mail({ ...from('receipts@shop.example.test'), subject: 'Your order' }),
    matches: [0],
  },
  {
    name: 'two matching rules are both listed and the first wins',
    rules: [
      rule({ phrase: ['invoice'] }, 'Receipts', 'invoices'),
      rule({ domain: ['other.example.test'] }, 'Noise', 'other'),
      rule({ domain: ['bank.example.test'] }, 'Important', 'bank'),
    ],
    message: mail({ subject: 'Invoice 4' }),
    matches: [0, 1],
  },
  {
    name: 'a null From fails from and domain without an error',
    rules: [rule({ from: ['a@bank.example.test'] }), bankDomain],
    message: mail({ fromAddress: null, fromDomain: null, subject: 'x' }),
    matches: [],
  },
  {
    name: 'a null subject and body never match a phrase',
    rules: [rule({ phrase: ['null'] })],
    message: mail({ subject: null, body: null }),
    matches: [],
  },
];

describe('matchExactRules (D-08 to D-12, E9 Set A)', () => {
  it('has at least 12 table cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
  });

  it.each(cases)('$name', ({ rules, message, matches }) => {
    const span = matchExactRules(rules, message);
    expect(span.kind).toBe('exact_rules');
    expect(span.rules_checked).toBe(rules.length);
    expect(span.matches.map((ref) => ref.index)).toEqual(matches);
    expect(span.winner?.index ?? null).toBe(matches[0] ?? null);
    if (matches.length > 0) expect(span.nearest_miss).toBeNull();
    else expect(span.nearest_miss).not.toBeNull();
  });

  it('Reply-To and Sender carrying the bank address cannot match: only From is read', () => {
    const spoof = {
      ...mail(from('alerts@evil.example.test')),
      replyTo: 'alerts@bank.example.test',
      sender: 'alerts@bank.example.test',
      body: 'Reply-To: alerts@bank.example.test\nSender: alerts@bank.example.test',
    };
    const span = matchExactRules([bankDomain, rule({ from: ['alerts@bank.example.test'] })], spoof);
    expect(span.matches).toEqual([]);
    expect(span.winner).toBeNull();
  });

  it('records rule refs with the rule name, or rules[index] when unnamed', () => {
    const span = matchExactRules(
      [
        rule({ domain: ['bank.example.test'] }, 'Important', 'bank alerts'),
        bankDomain,
        rule({ domain: ['bank.example.test'] }),
      ],
      mail(from('alerts@bank.example.test')),
    );
    expect(span.matches).toEqual([
      { index: 0, name: 'bank alerts', label: 'Important' },
      { index: 1, name: 'bank alerts', label: 'Important' },
      { index: 2, name: 'rules[2]', label: 'Important' },
    ]);
    expect(span.winner).toEqual({ index: 0, name: 'bank alerts', label: 'Important' });
  });

  it('nearest miss: an AND rule with one failing condition, with per-condition results', () => {
    const span = matchExactRules(
      [
        bankDomain,
        rule(
          { from: ['receipts@shop.example.test'], phrase: ['order'], in: 'subject' },
          'Receipts',
          'shop orders',
        ),
      ],
      mail({ ...from('receipts@shop.example.test'), subject: 'Your parcel' }),
    );
    expect(span.winner).toBeNull();
    expect(span.nearest_miss).toEqual({
      index: 1,
      name: 'shop orders',
      label: 'Receipts',
      conditions: [
        { field: 'from', pass: true },
        { field: 'phrase', pass: false },
      ],
      met: 1,
      total: 2,
    });
  });

  it('nearest miss: conditions are listed in the fixed order from, domain, phrase', () => {
    const span = matchExactRules(
      [rule({ phrase: ['x'], domain: ['shop.example.test'], from: ['a@shop.example.test'] })],
      mail({ ...from('a@shop.example.test'), subject: 'y' }),
    );
    expect(span.nearest_miss?.conditions).toEqual([
      { field: 'from', pass: true },
      { field: 'domain', pass: true },
      { field: 'phrase', pass: false },
    ]);
    expect(span.nearest_miss?.met).toBe(2);
    expect(span.nearest_miss?.total).toBe(3);
  });

  it('nearest miss: a tie goes to the lower index', () => {
    const span = matchExactRules(
      [
        bankDomain,
        rule({ from: ['a@shop.example.test'], phrase: ['order'] }, 'Receipts', 'first half'),
        rule({ domain: ['shop.example.test'], phrase: ['invoice'] }, 'Receipts', 'second half'),
      ],
      mail({ ...from('a@shop.example.test'), subject: 'hello' }),
    );
    expect(span.nearest_miss?.index).toBe(1);
    expect(span.nearest_miss?.name).toBe('first half');
  });

  it('nearest miss: the highest fraction wins over a lower index (1/2 < 2/3)', () => {
    const span = matchExactRules(
      [
        rule({ from: ['a@shop.example.test'], phrase: ['order'] }, 'Receipts', 'half'),
        rule(
          { from: ['a@shop.example.test'], domain: ['shop.example.test'], phrase: ['invoice'] },
          'Receipts',
          'two thirds',
        ),
      ],
      mail({ ...from('a@shop.example.test'), subject: 'hello' }),
    );
    expect(span.nearest_miss?.index).toBe(1);
    expect(span.nearest_miss?.met).toBe(2);
  });

  it('nearest miss: reported even when it met none of its conditions (D-12 literally)', () => {
    const span = matchExactRules([bankDomain], mail());
    expect(span.nearest_miss).toEqual({
      index: 0,
      name: 'bank alerts',
      label: 'Important',
      conditions: [{ field: 'domain', pass: false }],
      met: 0,
      total: 1,
    });
  });

  it('no rules: rules_checked 0, winner and nearest miss null', () => {
    expect(matchExactRules([], mail())).toEqual({
      kind: 'exact_rules',
      rules_checked: 0,
      matches: [],
      winner: null,
      nearest_miss: null,
    });
  });

  it('two runs over the same input give byte-identical span JSON with a fixed key order', () => {
    const rules = [
      rule({ from: ['a@shop.example.test'], phrase: ['order'] }, 'Receipts'),
      bankDomain,
      rule({ phrase: ['invoice'] }, 'Receipts', 'invoices'),
    ];
    const message = mail({ ...from('a@shop.example.test'), subject: 'Invoice' });
    const first = JSON.stringify(matchExactRules(rules, message));
    const second = JSON.stringify(matchExactRules(rules, message));
    expect(second).toBe(first);
    const span = matchExactRules(rules, mail());
    expect(Object.keys(span)).toEqual([
      'kind',
      'rules_checked',
      'matches',
      'winner',
      'nearest_miss',
    ]);
    expect(Object.keys(span.nearest_miss ?? {})).toEqual([
      'index',
      'name',
      'label',
      'conditions',
      'met',
      'total',
    ]);
  });

  it('a hostile pattern-like phrase over long mail runs linearly and matches only literally', () => {
    const rules = [rule({ phrase: ['(a+)+$'] })];
    const started = performance.now();
    const span = matchExactRules(
      rules,
      mail({ subject: `${'a'.repeat(30_000)}!`, body: 'a'.repeat(30_000) }),
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(span.matches).toEqual([]);
    expect(matchExactRules(rules, mail({ body: 'x (a+)+$ y' })).matches).toHaveLength(1);
  });

  it('the matcher source builds no pattern from rule or mail text (T-03-11)', () => {
    const source = readFileSync(new URL('../src/classify/exact-rules.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/RegExp/);
    // String#match/matchAll/search turn a string argument into a pattern.
    expect(source).not.toMatch(/\.(match|matchAll|search)\(/);
    // The only pattern literal is the fixed whitespace class.
    expect(source.match(/= \/[^/\n]+\/[gimsuy]*;/g)).toEqual(['= /\\s+/g;']);
  });
});

describe('decide() on an exact winner (CLS-01, TRC-06)', () => {
  const rules = [rule({ domain: ['bank.example.test'] }, 'Important', 'bank alerts')];
  const message = mail(from('alerts@mail.bank.example.test'));

  it('gives a labelled draft with no LLM involved', () => {
    const exact = matchExactRules(rules, message);
    const draft = decide({ exact, threshold: 0.75 });
    expect(draft).toEqual({
      outcome: 'labelled',
      category: 'Important',
      confidence: null,
      tier: 'exact_rules',
      reviewReason: null,
      model: null,
      traceFormatVersion: TRACE_FORMAT_VERSION,
      spans: [
        exact,
        CLASSIFIER_SKIPPED_SPAN,
        { kind: 'action', status: 'pending', intent: { type: 'label', label: 'Important' } },
      ],
    });
    expect(draft.spans).toHaveLength(3);
    expect(decisionSpansSchema.safeParse(draft.spans).success).toBe(true);
  });

  it('two runs give byte-identical drafts', () => {
    const run = () =>
      JSON.stringify(decide({ exact: matchExactRules(rules, message), threshold: 0.75 }));
    expect(run()).toBe(run());
  });

  it('throws TypeError with neither a winner nor an LLM verdict', () => {
    const exact = matchExactRules(rules, mail());
    expect(() => decide({ exact, threshold: 0.75 })).toThrow(TypeError);
  });

  it('throws RangeError for a threshold outside 0..1 before building anything', () => {
    const exact = matchExactRules(rules, message);
    for (const threshold of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => decide({ exact, threshold })).toThrow(RangeError);
    }
  });
});
