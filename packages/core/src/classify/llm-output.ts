import { z } from 'zod';

/**
 * The LLM tier's output contract (D-22, D-24, AI-SPEC section 4b). One Zod
 * object does two jobs: `ollamaFormat` turns it into the Ollama `format`
 * grammar, and `validateLlmOutput` re-checks the raw answer in code, because
 * the grammar does not enforce every rule (number ranges in particular).
 */

/**
 * Longest reason the grammar lets the model write (also bounds output tokens).
 * The grammar and Zod 4.6 both count it in code points, so code is never looser.
 */
export const REASON_MAX_CHARS = 200;

/**
 * Built per mailbox: the enum is the mailbox's category list from its rule_set
 * snapshot. Key order is generation order: llama.cpp's grammar emits
 * properties in schema order, so `reason` is written before the model commits
 * to `category`. The schema is transform-free so it stays representable as
 * JSON Schema.
 */
export function llmOutputSchema(categories: readonly [string, ...string[]]) {
  return z.strictObject({
    reason: z.string().trim().min(1).max(REASON_MAX_CHARS),
    category: z.enum(categories),
    // Ollama's grammar does NOT enforce minimum/maximum on `number`; only code does.
    confidence: z.number().min(0).max(1),
  });
}

export type LlmOutputSchema = ReturnType<typeof llmOutputSchema>;
export type LlmOutput = z.output<LlmOutputSchema>;

/**
 * The JSON schema sent as Ollama `format`. `$schema` is dropped: the grammar
 * converter ignores it, and leaving it out keeps the prompt_version shape
 * minimal and stable across Zod upgrades.
 */
export function ollamaFormat(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dropped, ...format } = z.toJSONSchema(schema, { target: 'draft-7' });
  return format;
}

/**
 * Characters a reason must not hold (WR-01): every Unicode control character
 * (Cc: NUL, tab, CR, LF, DEL and the C1 range) plus the two Unicode line
 * separators. PostgreSQL jsonb rejects NUL (SQLSTATE 22P05), so a reason with
 * one would fail the decision insert on every pass; and a reason is one
 * sentence on one line. Matched per code point (`u` flag). Checked in code
 * only: it is not part of llmOutputSchema, because that schema is prompt
 * material (D-29) and llama.cpp's grammar converter has no Unicode property
 * escapes.
 */
export const REASON_CONTROL_CHARACTERS = /[\p{Cc}\u2028\u2029]/u;

export type ValidationFailure =
  | { code: 'not_json'; detail: string }
  | { code: 'out_of_category'; detail: string }
  | { code: 'schema_mismatch'; detail: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Re-validate the raw `message.content` in code. Never trust the grammar
 * alone, and never repair: nothing is case-folded, trimmed into a category,
 * matched to the nearest name or coerced to a number.
 *
 * `out_of_category` means the answer named a category (a string) that is not
 * on this mailbox's list; a missing or non-string category is a shape error,
 * `schema_mismatch`. Details hold issue paths and codes only, never model text,
 * which may echo the email.
 *
 * A reason holding a control character (REASON_CONTROL_CHARACTERS, after
 * JSON.parse and the schema's trim) is `schema_mismatch` with the fixed detail
 * `reason: control_character`: rejected and retried like any other invalid
 * answer, never stripped.
 *
 * A reason that is not well-formed UTF-16 is `schema_mismatch` with the fixed
 * detail `reason: lone_surrogate` (WR-04). llama.cpp's JSON grammar lets the
 * model write a JSON escape for a code unit in U+D800..U+DFFF without its
 * partner, and JSON.parse turns that into an unpaired surrogate. PostgreSQL
 * jsonb refuses one ("Unicode low surrogate must follow a high surrogate"), so
 * the decision insert would fail on every pass. The answer is rejected and
 * retried like any other invalid answer, never repaired, and the detail is
 * fixed text that never quotes the model. isWellFormed() is the same predicate
 * the rules schema uses (03-26), so the worker and config check cannot drift.
 */
export function validateLlmOutput(
  schema: LlmOutputSchema,
  raw: string,
): { ok: true; value: LlmOutput } | { ok: false; failure: ValidationFailure } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // The engine's parse error quotes the input, so it is not passed on.
    return { ok: false, failure: { code: 'not_json', detail: 'content is not one JSON value' } };
  }
  const result = schema.safeParse(parsed);
  if (result.success) {
    if (REASON_CONTROL_CHARACTERS.test(result.data.reason)) {
      return {
        ok: false,
        failure: { code: 'schema_mismatch', detail: 'reason: control_character' },
      };
    }
    if (!result.data.reason.isWellFormed()) {
      return { ok: false, failure: { code: 'schema_mismatch', detail: 'reason: lone_surrogate' } };
    }
    return { ok: true, value: result.data };
  }
  const issues = result.error.issues;
  const offList =
    isRecord(parsed) &&
    typeof parsed.category === 'string' &&
    issues.some((i) => i.code === 'invalid_value' && i.path[0] === 'category');
  return {
    ok: false,
    failure: {
      code: offList ? 'out_of_category' : 'schema_mismatch',
      detail: issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.code}`).join('; '),
    },
  };
}
