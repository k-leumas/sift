import type { ExactRule } from '../rules/schema.ts';
import type { ConditionResult, ExactRulesSpan, RuleRef } from './spans.ts';

/**
 * The exact-rules tier (D-08 to D-12, TRC-02): the owner's rules decide,
 * deterministically, with no LLM call (CLS-01).
 *
 * - from and domain read the stored From address and From domain only. A
 *   display name, Reply-To or Sender header never reaches this function, so it
 *   can never satisfy a rule (D-08, T-03-10).
 * - A domain matches itself and its subdomains at a label boundary only:
 *   mail.bank.example.test matches bank.example.test, notbank.example.test does not.
 * - Phrases are literal substrings after one fixed normalisation (NFKC, lower
 *   case, whitespace runs as one space). Rule and mail text are only ever
 *   compared as strings; no pattern is built from them (D-09, T-03-11).
 * - Fields in one match combine with AND, entries in one list with OR (D-10).
 * - Every rule is evaluated in file order; the first match wins (D-11). The
 *   nearest miss is reported only when nothing matched (D-12).
 *
 * Objects are built with a fixed key order, so the span JSON is byte-identical
 * across runs over the same input (E9).
 */

/** The message fields an exact rule may read (stored columns, not raw headers). */
export interface MatchableMessage {
  /** message.from_address: the From address, domain lowercased at ingest. */
  fromAddress: string | null;
  /** message.from_domain, lowercased. */
  fromDomain: string | null;
  subject: string | null;
  /** The cached message_body.body_text. */
  body: string | null;
}

/** The only pattern used: a fixed, linear whitespace class. */
const WHITESPACE_RUN = /\s+/g;

function normalise(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(WHITESPACE_RUN, ' ').trim();
}

function fromPasses(entries: readonly string[], fromAddress: string | null): boolean {
  if (fromAddress === null) return false;
  const address = fromAddress.toLowerCase();
  return entries.includes(address);
}

function domainPasses(entries: readonly string[], fromDomain: string | null): boolean {
  if (fromDomain === null) return false;
  const lower = fromDomain.toLowerCase();
  const domain = lower.endsWith('.') ? lower.slice(0, -1) : lower;
  if (domain === '') return false;
  return entries.some((entry) => domain === entry || domain.endsWith(`.${entry}`));
}

interface PhraseText {
  subject: string;
  body: string;
}

function phrasePasses(
  entries: readonly string[],
  place: 'subject' | 'body' | 'any',
  text: PhraseText,
): boolean {
  return entries.some((entry) => {
    const phrase = normalise(entry);
    // An entry that normalises to nothing would be a substring of everything.
    if (phrase === '') return false;
    if (place === 'subject') return text.subject.includes(phrase);
    if (place === 'body') return text.body.includes(phrase);
    return text.subject.includes(phrase) || text.body.includes(phrase);
  });
}

function ruleRef(rule: ExactRule, index: number): RuleRef {
  return { index, name: rule.name ?? `rules[${index}]`, label: rule.label };
}

/** One result per present field, in the fixed order from, domain, phrase. */
function conditionsOf(
  rule: ExactRule,
  message: MatchableMessage,
  text: () => PhraseText,
): ConditionResult[] {
  const conditions: ConditionResult[] = [];
  const { from, domain, phrase } = rule.match;
  if (from !== undefined) {
    conditions.push({ field: 'from', pass: fromPasses(from, message.fromAddress) });
  }
  if (domain !== undefined) {
    conditions.push({ field: 'domain', pass: domainPasses(domain, message.fromDomain) });
  }
  if (phrase !== undefined) {
    conditions.push({
      field: 'phrase',
      pass: phrasePasses(phrase, rule.match.in ?? 'any', text()),
    });
  }
  return conditions;
}

/** Evaluate every rule against the message and build the exact_rules span. */
export function matchExactRules(
  rules: readonly ExactRule[],
  message: MatchableMessage,
): ExactRulesSpan {
  let normalised: PhraseText | undefined;
  const text = (): PhraseText => {
    normalised ??= {
      subject: normalise(message.subject ?? ''),
      body: normalise(message.body ?? ''),
    };
    return normalised;
  };

  const matches: RuleRef[] = [];
  let best: { index: number; conditions: ConditionResult[]; met: number; total: number } | null =
    null;

  for (const [index, rule] of rules.entries()) {
    const conditions = conditionsOf(rule, message, text);
    const total = conditions.length;
    const met = conditions.filter((condition) => condition.pass).length;
    if (total > 0 && met === total) {
      matches.push(ruleRef(rule, index));
      continue;
    }
    // Highest met/total wins; compared by cross-multiplying, so no float rounding.
    // Only a strictly better fraction replaces the current one: ties go to the lower index.
    if (best === null || met * best.total > best.met * total) {
      best = { index, conditions, met, total };
    }
  }

  const first = matches[0];
  const winner = first === undefined ? null : { ...first };
  const missRule = best === null ? undefined : rules[best.index];
  const nearestMiss: ExactRulesSpan['nearest_miss'] =
    winner !== null || best === null || missRule === undefined
      ? null
      : {
          ...ruleRef(missRule, best.index),
          conditions: best.conditions,
          met: best.met,
          total: best.total,
        };

  return {
    kind: 'exact_rules',
    rules_checked: rules.length,
    matches,
    winner,
    nearest_miss: nearestMiss,
  };
}
