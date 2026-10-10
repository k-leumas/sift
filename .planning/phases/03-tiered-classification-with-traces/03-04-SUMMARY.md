---
phase: 03-tiered-classification-with-traces
plan: 04
subsystem: classify
tags: [exact-rules, decide, traces, threshold, sha256, canonical-json, zod]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-01 RulesConfig/ExactRule (normalised match entries), parseRulesText, RULES_FORMAT_VERSION"
  - phase: 03-tiered-classification-with-traces
    provides: "03-05 decisionSpansSchema, span types, CLASSIFIER_SKIPPED_SPAN, TRACE_FORMAT_VERSION, LLM_SPAN_OPTIONS, canonicalJson, sha256Hex"
provides:
  - "@sift/core/classify: matchExactRules(rules, MatchableMessage) -> ExactRulesSpan"
  - "@sift/core/classify: decide({ exact, llm?, threshold }) -> DecisionDraft, the single decision assembler"
  - "@sift/core/classify types: DecisionDraft, DecideInput, LlmVerdict, LlmSpanContext, MatchableMessage"
  - "@sift/core/rules: ruleSetVersionOf(rules) -> { hash, formatVersion, snapshot }, RuleSetVersion"
affects: [03-06, 03-07, 03-08, 03-10, phase-04-apply, TRC-05]

actuals:
  tokens: 11800
  tasks: 3
  commits: 5
plan_head_before: c5fb98897cf9ebda1b94032cecbd3dfe2043768e
plan_head_after: e9d09a9542143a295a262a4de11a3913d0bb0a00

tech-stack:
  added: []
  patterns:
    - "Exact matching compares strings only: includes/equality/endsWith('.' + entry); the one pattern literal is the fixed whitespace class"
    - "Nearest miss compares met/total by cross-multiplying (no float rounding); only a strictly better fraction replaces the current one, so ties keep the lower index"
    - "decide() models the LLM outcome as a discriminated union (labelled with category | review with reason), so the action intent cannot disagree with the outcome"
    - "Rule-set snapshot is JSON.parse of the hashed canonical text: plain JSON, no shared objects, re-hashes to the same value"

key-files:
  created:
    - packages/core/src/classify/exact-rules.ts
    - packages/core/src/classify/decide.ts
    - packages/core/src/rules/hash.ts
    - packages/core/test/exact-rules.test.ts
    - packages/core/test/decide.test.ts
    - packages/core/test/rules-hash.test.ts
  modified:
    - packages/core/src/classify/index.ts
    - packages/core/src/rules/index.ts

key-decisions:
  - "D-12 applied literally: when nothing matched, the nearest miss is reported even if it met 0 of its conditions (flagged TRC-02 probe edge)"
  - "A phrase entry that normalises to the empty string never matches (it would otherwise be a substring of every message)"
  - "The stored From domain is compared after lower-casing and dropping one trailing dot, the same normalisation the schema applies to rule domains"
  - "A low_confidence review keeps the validated answer in llm.result and the confidence on the draft; only the category is null"
  - "Rule-set hash material is canonicalJson({ format_version: RULES_FORMAT_VERSION, rules }) of the validated object, so YAML formatting never creates a version"

patterns-established:
  - "Every decision draft goes through decide(); the worker calls matchExactRules then decide and never builds spans by hand"

requirements-completed: [CLS-01, TRC-02, CLS-04, CLS-05, TRC-06]

coverage:
  - id: D1
    description: "Deterministic exact-rule matcher: From address/domain only, label-boundary subdomains, literal NFKC phrases, AND/OR, every match listed, first wins, nearest miss (E9 Set A)"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "packages/core/test/exact-rules.test.ts#matchExactRules (D-08 to D-12, E9 Set A)"
        status: pass
    human_judgment: false
  - id: D2
    description: "exact_rules span contents: rules_checked, matches, winner, nearest miss with per-condition results; byte-identical across runs"
    requirement: TRC-02
    verification:
      - kind: unit
        ref: "packages/core/test/exact-rules.test.ts#two runs over the same input give byte-identical span JSON with a fixed key order"
        status: pass
      - kind: unit
        ref: "packages/core/test/exact-rules.test.ts#nearest miss: an AND rule with one failing condition, with per-condition results"
        status: pass
    human_judgment: false
  - id: D3
    description: "No pattern built from rule or mail text (T-03-11): source scan plus a hostile pattern-like phrase over 30,000-char mail"
    verification:
      - kind: unit
        ref: "packages/core/test/exact-rules.test.ts#the matcher source builds no pattern from rule or mail text (T-03-11)"
        status: pass
      - kind: other
        ref: "grep -c 'new RegExp' packages/core/src/classify/exact-rules.ts -> 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "decide() threshold and review logic: 0.7499/0.75, 0/1, 0.89/0.9, 0 at 0; invalid_output, out_of_category, input_too_long; RangeError on bad threshold"
    requirement: CLS-04
    verification:
      - kind: unit
        ref: "packages/core/test/decide.test.ts#decide() with an LLM verdict: threshold (D-26, CLS-04, E10)"
        status: pass
      - kind: unit
        ref: "packages/core/test/decide.test.ts#decide() with an LLM review verdict (D-24, D-31)"
        status: pass
    human_judgment: false
  - id: D5
    description: "One draft per call, spans in the fixed order with the classifier span skipped at index 1 and an action intent consistent with the outcome"
    requirement: CLS-05
    verification:
      - kind: unit
        ref: "packages/core/test/decide.test.ts (expectConsistent in every LLM case)"
        status: pass
      - kind: unit
        ref: "packages/core/test/exact-rules.test.ts#decide() on an exact winner (CLS-01, TRC-06)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Classifier span always present and skipped at index 1 in every draft built here"
    requirement: TRC-06
    verification:
      - kind: unit
        ref: "packages/core/test/decide.test.ts#expectConsistent spans[1] equals CLASSIFIER_SKIPPED_SPAN"
        status: pass
    human_judgment: false
  - id: D7
    description: "Rule-set content hash: formatting-only YAML variants keep it, any change in meaning alters it; snapshot is plain JSON"
    verification:
      - kind: unit
        ref: "packages/core/test/rules-hash.test.ts"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 04: Exact Rules, decide() and Rule-Set Hash Summary

**An exact-rule matcher that reads only the stored From address, From domain, subject and body, and matches domains at label boundaries and phrases as literal NFKC substrings. It feeds `decide()`, the one pure function that turns tier results into a schema-checked decision draft (threshold, review reasons, fixed span order). `ruleSetVersionOf` gives each set of validated rules a sha256 identity over their canonical JSON.**

## Performance

- **Duration:** about 14 min
- **Started:** 2026-10-10T19:50:55Z
- **Completed:** 2026-10-10T20:05:00Z
- **Tasks:** 3 (1 tracer, 2 TDD)
- **Files modified:** 8 (6 created, 2 barrels extended)

## Accomplishments

- `matchExactRules` evaluates every rule in file order. For each rule it builds conditions in the fixed order from, domain, phrase; entries in one list are OR, fields in one rule are AND. It lists every match, takes the first as the winner, and reports a nearest miss only when nothing matched (highest met/total, ties to the lower index). A display-name spoof, Reply-To/Sender spoof, `notbank.example.test` and `bank.example.test.evil.example.test` all fail to match. `mail.bank.example.test` matches.
- Phrases are compared after NFKC, lower case and whitespace collapsing, using `includes` only. `a.b*(c)` matches only that literal text. A full-width subject matches an ASCII rule. A `(a+)+$` phrase over 30,000 characters of mail returns at once.
- `decide()` builds the exact path (labelled, no confidence, no model, 3 spans) and the LLM path (4 spans; labelled at confidence >= threshold, otherwise `low_confidence` review with the answer kept in `llm.result`; `invalid_output`, `out_of_category` and `input_too_long` review with null confidence). It throws RangeError for a threshold outside 0..1 or not finite, and TypeError for a winner plus an LLM verdict, or for neither. Every draft's spans are parsed with `decisionSpansSchema` before they are returned.
- `ruleSetVersionOf` hashes `canonicalJson({ format_version, rules })`. Comments, blank lines, key order, flow/block lists, quoting and schema-normalised spellings keep the hash. Any change to a description, judgment line, phrase (one character), rule order, label, category order, rule name, `in` or a domain list changes it.

## Task Commits

1. **Task 1: Tracer: exact rule to labelled draft, no LLM** - `a5a8d67` (feat)
2. **Task 2: decide() for LLM verdicts**: RED `61577b3` (test), GREEN `39179fa` (feat)
3. **Task 3: Rule-set snapshot and content hash**: RED `f81c903` (test), GREEN `e9d09a9` (feat)

REFACTOR: none as a separate commit. In Task 2 the outcome type became a discriminated union before the GREEN commit.

## TDD Gate Compliance

- **Task 1 (tracer):** the tracer gate ran in interactive end-of-phase mode with an automated-only verify. Re-running the verify passed (39 tests, typecheck 0), so the plan moved on to the next tasks with no checkpoint.
- **Task 2 RED (`61577b3`):** `decide.test.ts` ran against the Task 1 `decide()`, whose LLM branch threw "not implemented". 16 of 21 tests failed. `gsd check tdd-red-evidence` on the Vitest JUnit report returned `RED_EVIDENCE_OK` (target_test_failed). Semantic assessment: valid. Every failure came from the missing LLM branch (the planned behaviour), and there were no import, syntax or fixture faults. The 5 input-check tests passed at RED because Task 1 had already added those guards. One test ("category not in span categories fails the schema") passed trivially at first because it accepted any throw, so it was tightened to `toThrow(ZodError)` before RED was recorded. **GREEN (`39179fa`):** 60/60 across decide and exact-rules.
- **Task 3 RED (`f81c903`):** `rules-hash.test.ts` ran against a stub `hash.ts`, kept only in the working tree, that returned an empty hash, format 0 and an empty snapshot. 13 of 19 tests failed, all on AssertionErrors (plus one TypeError from reading the empty snapshot). `RED_EVIDENCE_OK`. Semantic assessment: valid. The 6 early passes are the "hash stays the same" cases, which a constant stub satisfies by construction. **GREEN (`e9d09a9`):** 80/80 with rules.test.ts.
- The RED evidence records and JUnit reports stayed in the session scratchpad and were not committed.

## Files Created/Modified

- `packages/core/src/classify/exact-rules.ts` - `matchExactRules`, `MatchableMessage`
- `packages/core/src/classify/decide.ts` - `decide`, `DecisionDraft`, `DecideInput`, `LlmVerdict`, `LlmSpanContext`
- `packages/core/src/rules/hash.ts` - `ruleSetVersionOf`, `RuleSetVersion`
- `packages/core/src/classify/index.ts`, `packages/core/src/rules/index.ts` - barrel exports
- `packages/core/test/exact-rules.test.ts` - 23-case E9 table plus nearest-miss, determinism, source-scan and exact `decide()` tests (39)
- `packages/core/test/decide.test.ts` - LLM verdict, threshold and input-check tests (21)
- `packages/core/test/rules-hash.test.ts` - hash and snapshot tests (19)

## Decisions Made

See key-decisions in the frontmatter. Beyond the planned interfaces, `DecideInput` is also exported, so 03-08 can type the call.

## Deviations from Plan

### Auto-fixed Issues

None. Small choices made within the plan's discretion:
- A phrase entry that normalises to `''` never matches (correctness guard; the schema makes this nearly impossible).
- The source-scan test also forbids `String#match/matchAll/search` calls, because those turn a string argument into a pattern.
- An extra test checks that the snapshot shares no objects with the caller and re-hashes to the same value.

**Total deviations:** 0. **Impact:** none on scope.

## Issues Encountered

- One exact-rules test failed at first because of a test-data typo: the full-width subject was missing "ATION". After a `biome check --write`, the `\uFF..` escapes had become literal characters, so the first sed fix silently matched nothing. Fixed with the Edit tool and logged as bug-215. The matcher was correct throughout.
- `pnpm lint` reports one warning that was already there, in `apps/worker/test/node-version.test.ts` (noTemplateCurlyInString). It is out of scope.

## Verification

- `pnpm vitest run packages/core`: 13 files, 400 tests passed
- `pnpm typecheck`: exit 0
- `grep -c "new RegExp" packages/core/src/classify/exact-rules.ts`: 0
- Acceptance greps for `export function matchExactRules`, `export function decide`, `low_confidence` and `export function ruleSetVersionOf` all match

## Flagged for the Verifier

- TRC-02 probe edge: D-12 is applied literally. When no rule matched, the nearest miss is reported even if it met 0 of its conditions (test: "nearest miss: reported even when it met none of its conditions").

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- 03-06 can store `ruleSetVersionOf(rules)` as a `rule_set` row (hash, format_version, snapshot) and `DecisionDraft` fields as decision columns.
- 03-07 produces an `LlmVerdict` plus an `LlmSpanContext` (spread `LLM_SPAN_OPTIONS` into `options`). `decide()` checks that the answer's category is one of `context.categories`.
- 03-08 builds `MatchableMessage` from `message.from_address`, `from_domain`, `subject` and `message_body.body_text`, then calls `matchExactRules` and `decide`. It must not call the LLM when `exact.winner` is set (decide throws TypeError).

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*

## Self-Check: PASSED
