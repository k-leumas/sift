import { z } from 'zod';
import { describe, unlessMissing } from '../config/schema.ts';

/**
 * Schema of a mailbox's rules file, data/mailboxes/<slug>/rules.yaml (D-01,
 * D-02): its categories, the owner's judgment lines for the LLM and the exact
 * rules. Every value is rejected, never fixed (P1 D-63); unknown keys are errors.
 */

/** Format version of rules.yaml, so M3 can migrate the file (D-01). */
export const RULES_FORMAT_VERSION = 1;

/** Categories per mailbox (D-06). */
export const MIN_CATEGORIES = 2;
export const MAX_CATEGORIES = 20;
export const CATEGORY_NAME_MAX_CHARS = 40;

/** Text caps (AI-SPEC section 4): the description and judgment text go into every LLM prompt. */
export const DESCRIPTION_MAX_CHARS = 200;
export const JUDGMENT_LINE_MAX_CHARS = 500;
export const JUDGMENT_TOTAL_MAX_CHARS = 4000;

/** Exact-rule caps (T-03-01). */
export const MAX_RULES = 500;
export const MAX_LIST_ENTRIES = 100;
export const PHRASE_MAX_CHARS = 200;
export const RULE_NAME_MAX_CHARS = 80;
/** RFC 5321 path limit for one address; a DNS name is at most 253 characters. */
export const FROM_MAX_CHARS = 254;
export const DOMAIN_MAX_CHARS = 253;

/**
 * Category name rule (D-06), owner choice "ascii" at plan 03-01 Task 1: ASCII
 * letters and digits, `-` and `&`, words joined by single spaces. No `/`, no
 * leading, trailing or double space. Category names become Proton label
 * folders Labels/<name> in Phase 4; widening to Unicode letters is
 * non-breaking and waits until Phase 4 shows Bridge handles modified UTF-7.
 */
export const CATEGORY_NAME_PATTERN = /^[A-Za-z0-9&-]+(?: [A-Za-z0-9&-]+)*$/;

/** Where a phrase is looked for (D-09); `any` means subject or body. */
export const PHRASE_PLACES = ['subject', 'body', 'any'] as const;
export type PhrasePlace = (typeof PHRASE_PLACES)[number];

const FROM_PATTERN = /^[^\s@]+@[^\s@]+$/;
const DOMAIN_PATTERN = /^[^\s@.]+(\.[^\s@.]+)*$/;
/** CR, LF and the Unicode line and paragraph separators U+2028 and U+2029. */
const LINE_BREAK = /[\r\n\u2028\u2029]/u;

/**
 * Control characters, matched per code point: the Unicode property Cc (NUL,
 * tab, CR, LF, DEL and the C1 range with U+0085) plus the separators U+2028
 * and U+2029 (WR-02). The rule set snapshot is stored as PostgreSQL jsonb,
 * which cannot hold NUL (SQLSTATE 22P05), so a rules file with one would pass
 * config check and then fail the rule-set write on every pass (CLS-06).
 * Trusted prompt text is one line with no control characters; match entries
 * hold none either. Rejected, never stripped (D-05).
 */
const CONTROL_CHARACTERS = /[\p{Cc}\u2028\u2029]/u;

const categoryNameMessage = `category names may use letters, digits, single spaces, - and & (1 to ${CATEGORY_NAME_MAX_CHARS} characters)`;
const categoriesMessage = `categories must list from ${MIN_CATEGORIES} to ${MAX_CATEGORIES} categories`;
const fromMessage = 'from entries must be one email address';
const domainMessage = 'domain entries are a domain such as example.test, without @';

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function length(value: string): number {
  return [...value].length;
}

/** True when `value` holds no control character (WR-02). */
function noControl(value: string): boolean {
  return !CONTROL_CHARACTERS.test(value);
}

/**
 * Message tail for a value holding an unpaired surrogate (WR-05). It names the
 * fix and never quotes the value.
 */
const UNPAIRED_SURROGATE =
  'must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape';

/**
 * True when `value` is well-formed UTF-16 (WR-05). A YAML double-quoted escape
 * for a code unit in U+D800..U+DFFF without its partner parses into an
 * unpaired surrogate. The validated file is stored as rule_set.snapshot jsonb,
 * which PostgreSQL refuses ("Unicode low surrogate must follow a high
 * surrogate"), so such a file would pass config check and then fail every
 * decision of the mailbox. Same predicate as validateLlmOutput (plan 03-25).
 * Used by the one-line fields (description, judgment lines, rule name) and,
 * directly after their control-character check, by the from, domain and
 * phrase entries. Rejected, never repaired (D-05).
 */
function noUnpairedSurrogate(value: string): boolean {
  return value.isWellFormed();
}

/**
 * A trimmed, non-empty, single-line string of at most `max` characters with no
 * control characters and no unpaired surrogate. One issue per value, first
 * match wins: a line break is reported as such, then any other control
 * character as a control character, then an unpaired surrogate.
 */
function oneLine(name: string, max: number) {
  return z
    .string({ error: unlessMissing(`${name} must be text`) })
    .trim()
    .min(1, `${name} must not be empty`)
    .max(max, `${name} must be at most ${max} characters`)
    .superRefine((value, ctx) => {
      if (LINE_BREAK.test(value)) {
        ctx.addIssue({ code: 'custom', message: `${name} must be one line` });
      } else if (CONTROL_CHARACTERS.test(value)) {
        ctx.addIssue({ code: 'custom', message: `${name} must not contain control characters` });
      } else if (!noUnpairedSurrogate(value)) {
        ctx.addIssue({ code: 'custom', message: `${name} ${UNPAIRED_SURROGATE}` });
      }
    });
}

/** Checked as written: a name is never trimmed or otherwise fixed. One message per name. */
const CategoryName = z
  .string({ error: unlessMissing('name must be text') })
  .superRefine((value, ctx) => {
    if (value.length > 0 && value !== value.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'category names must not start or end with a space',
      });
    } else if (length(value) > CATEGORY_NAME_MAX_CHARS || !CATEGORY_NAME_PATTERN.test(value)) {
      ctx.addIssue({ code: 'custom', message: categoryNameMessage });
    }
  });

export const CategorySchema = z.strictObject(
  {
    name: CategoryName,
    description: oneLine('description', DESCRIPTION_MAX_CHARS),
  },
  { error: unlessMissing('each category must be a mapping with name and description') },
);

/** Names are unique case-insensitively (D-06): Proton folder names must not collide. */
function checkDuplicateNames(categories: unknown, ctx: z.RefinementCtx): void {
  if (!Array.isArray(categories)) return;
  const seen = new Map<string, number>();
  categories.forEach((category: unknown, index) => {
    const name = field(category, 'name');
    if (typeof name !== 'string') return;
    const key = name.toLowerCase();
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, index);
      return;
    }
    ctx.addIssue({
      code: 'custom',
      path: [index, 'name'],
      message: `duplicate category name "${name}" (also used by categories[${first}]; names compare case-insensitively)`,
    });
  });
}

const Categories = z
  .array(CategorySchema, {
    error: (issue) =>
      issue.input === undefined
        ? `categories is required: list ${MIN_CATEGORIES} to ${MAX_CATEGORIES} categories with name and description`
        : 'categories must be a list of categories',
  })
  .min(MIN_CATEGORIES, categoriesMessage)
  .max(MAX_CATEGORIES, categoriesMessage)
  .superRefine(checkDuplicateNames, { when: () => true });

function checkJudgmentTotal(lines: unknown, ctx: z.RefinementCtx): void {
  if (!Array.isArray(lines)) return;
  const total = lines.reduce<number>(
    (sum, line: unknown) => sum + (typeof line === 'string' ? length(line.trim()) : 0),
    0,
  );
  if (total > JUDGMENT_TOTAL_MAX_CHARS) {
    ctx.addIssue({
      code: 'custom',
      message: `judgment lines add up to ${total} characters (max ${JUDGMENT_TOTAL_MAX_CHARS})`,
    });
  }
}

const Judgment = z
  .array(oneLine('judgment lines', JUDGMENT_LINE_MAX_CHARS), {
    error: unlessMissing('judgment must be a list of one-line sentences'),
  })
  .superRefine(checkJudgmentTotal, { when: () => true });

/** One condition list (D-10: entries are OR). Present lists are never empty. */
function entryList<T extends z.ZodType<string>>(name: string, entry: T, example: string) {
  return z
    .array(entry, {
      error: unlessMissing(`${name} must be a list, for example ${name}: [${example}]`),
    })
    .min(1, `${name} must list at least one entry`)
    .max(MAX_LIST_ENTRIES, `${name} may list at most ${MAX_LIST_ENTRIES} entries`)
    .optional();
}

/** Stored lowercased; compared with the From address only (D-08). */
const FromEntry = z
  .string({ error: unlessMissing(fromMessage) })
  .trim()
  .toLowerCase()
  .refine(noControl, 'from entries must not contain control characters')
  .refine(noUnpairedSurrogate, `from entries ${UNPAIRED_SURROGATE}`)
  .max(FROM_MAX_CHARS, `from entries must be at most ${FROM_MAX_CHARS} characters`)
  .regex(FROM_PATTERN, fromMessage);

/** Stored lowercased with one trailing dot removed; also matches subdomains (D-08). */
const DomainEntry = z
  .string({ error: unlessMissing(domainMessage) })
  .trim()
  .toLowerCase()
  .overwrite((value) => (value.endsWith('.') ? value.slice(0, -1) : value))
  .refine(noControl, 'domain entries must not contain control characters')
  .refine(noUnpairedSurrogate, `domain entries ${UNPAIRED_SURROGATE}`)
  .max(DOMAIN_MAX_CHARS, `domain entries must be at most ${DOMAIN_MAX_CHARS} characters`)
  .regex(DOMAIN_PATTERN, domainMessage);

/** Plain substring (D-09): trimmed, with inner whitespace runs collapsed to one space. */
const PhraseEntry = z
  .string({ error: unlessMissing('phrase entries must be text') })
  .trim()
  .overwrite((value) => value.replace(/\s+/g, ' '))
  // After the collapse, so a tab inside a phrase is already one space and still loads.
  .refine(noControl, 'phrase entries must not contain control characters')
  .refine(noUnpairedSurrogate, `phrase entries ${UNPAIRED_SURROGATE}`)
  .min(1, 'phrase entries must not be empty')
  .max(PHRASE_MAX_CHARS, `phrase entries must be at most ${PHRASE_MAX_CHARS} characters`);

function checkMatch(match: unknown, ctx: z.RefinementCtx): void {
  if (typeof match !== 'object' || match === null || Array.isArray(match)) return;
  const phrase = field(match, 'phrase');
  if (
    field(match, 'from') === undefined &&
    field(match, 'domain') === undefined &&
    phrase === undefined
  ) {
    ctx.addIssue({ code: 'custom', message: 'match needs at least one of from, domain, phrase' });
  }
  if (field(match, 'in') !== undefined && phrase === undefined) {
    ctx.addIssue({ code: 'custom', path: ['in'], message: 'in only applies to phrase' });
  }
}

export const RuleMatchSchema = z
  .strictObject(
    {
      from: entryList('from', FromEntry, 'receipts@shop.example.test'),
      domain: entryList('domain', DomainEntry, 'bank.example.test'),
      phrase: entryList('phrase', PhraseEntry, 'order confirmation'),
      in: z
        .enum(PHRASE_PLACES, { error: unlessMissing(`in must be ${PHRASE_PLACES.join(', ')}`) })
        .optional(),
    },
    { error: unlessMissing('match must be a mapping of from, domain, phrase and in') },
  )
  .superRefine(checkMatch, { when: () => true })
  // Normalised so the stored object (and its hash, D-03) says where a phrase is looked for.
  .transform((match) =>
    match.phrase !== undefined && match.in === undefined ? { ...match, in: 'any' as const } : match,
  );

export const ExactRuleSchema = z.strictObject(
  {
    kind: z.literal('exact', {
      error: (issue) =>
        issue.input === undefined
          ? 'kind is required (kind: exact)'
          : 'kind must be exact; other rule kinds arrive with rules.md (M3)',
    }),
    name: oneLine('name', RULE_NAME_MAX_CHARS).optional(),
    match: RuleMatchSchema,
    // Compared exactly with the category names (D-13), so it is not trimmed.
    label: z
      .string({ error: unlessMissing('label must be text') })
      .min(1, 'label must not be empty'),
  },
  { error: unlessMissing('each rule must be a mapping with kind, match and label') },
);

const Rules = z
  .array(ExactRuleSchema, { error: unlessMissing('rules must be a list of rules') })
  .max(MAX_RULES, `rules may list at most ${MAX_RULES} rules`);

/** An exact rule's label must be exactly one of the categories; rules cannot send to review (D-13). */
function checkLabels(file: unknown, ctx: z.RefinementCtx): void {
  const categories = field(file, 'categories');
  const rules = field(file, 'rules');
  // Without a category list there is nothing to compare with; that list has its own issue.
  if (!Array.isArray(rules) || !Array.isArray(categories)) return;
  const names = categories
    .map((category: unknown) => field(category, 'name'))
    .filter((name): name is string => typeof name === 'string');
  rules.forEach((rule: unknown, index) => {
    const label = field(rule, 'label');
    if (typeof label !== 'string' || label === '' || names.includes(label)) return;
    ctx.addIssue({
      code: 'custom',
      path: ['rules', index, 'label'],
      message: `label ${JSON.stringify(label)} is not one of the categories (${names.join(', ')})`,
    });
  });
}

export const RulesFile = z
  .strictObject(
    {
      version: z.literal(RULES_FORMAT_VERSION, {
        error: (issue) =>
          issue.input === undefined
            ? `version is required (this Sift build reads rules version ${RULES_FORMAT_VERSION})`
            : `unsupported rules version ${describe(issue.input)}; this Sift build reads version ${RULES_FORMAT_VERSION}`,
      }),
      categories: Categories,
      judgment: Judgment.default([]),
      rules: Rules.default([]),
    },
    {
      error: unlessMissing('the rules file must be a mapping of keys (version, categories, rules)'),
    },
  )
  // `when` runs the label check even if a field elsewhere failed, so every
  // problem in the file is reported in one pass.
  .superRefine(checkLabels, { when: () => true });

export type RulesConfig = z.output<typeof RulesFile>;
export type Category = z.output<typeof CategorySchema>;
export type RuleMatch = z.output<typeof RuleMatchSchema>;
export type ExactRule = z.output<typeof ExactRuleSchema>;
