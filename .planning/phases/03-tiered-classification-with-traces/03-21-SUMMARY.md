---
phase: 03-tiered-classification-with-traces
plan: 21
subsystem: rules
tags: [zod, rules-yaml, config-check, jsonb, wr-02]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-01 rules schema (oneLine, FromEntry, DomainEntry, PhraseEntry), loadRules and sift config check over every mailbox rules file"
provides:
  - "CONTROL_CHARACTERS (module-private, u flag: Unicode Cc plus U+2028 and U+2029) in packages/core/src/rules/schema.ts"
  - "oneLine fields (description, judgment lines, rule name) reject control characters; line breaks keep 'must be one line', one issue per value"
  - "from, domain and phrase entries reject control characters with '<key> entries must not contain control characters'"
  - "End-to-end config-check test: a NUL in a description exits 1 with file:line:col and YAML path"
affects: [rules, config-check, rule-set snapshot, trusted prompt, 03-verification]

actuals:
  tokens: 2347
  tasks: 2
  commits: 3
plan_head_before: c46b87e1ad50074489674913bf06787182e218c9
plan_head_after: 9d6c2b69016c9e5a97aec58a3d770fd0f2aae6c9

tech-stack:
  added: []
  patterns:
    - "Control characters are rejected by schema refines (no transform), so valid files normalise and hash exactly as before"
    - "Regex escapes for U+2028/U+2029 written via placeholder + python replace so the source stays ASCII (bug-240)"

key-files:
  created: []
  modified:
    - packages/core/src/rules/schema.ts
    - apps/worker/test/config-check-rules.test.ts
    - packages/core/test/rules.test.ts

key-decisions:
  - "LINE_BREAK widened to CR, LF, U+2028, U+2029 (u flag): these get 'must be one line'; every other Cc character gets 'must not contain control characters', one issue per one-line value"
  - "Entry refines sit right after trim/toLowerCase/overwrite (before max and regex); a from entry with an inner tab therefore reports both the address message and the control-character message"
  - "CONTROL_CHARACTERS is defined in the rules module, not imported from classify, so rules keeps no dependency on classify"

patterns-established:
  - "Owner text that reaches jsonb or the trusted prompt is checked for control characters at the schema, with a positioned message (D-05: reject, never repair)"

requirements-completed: [CLS-01, CLS-06]

coverage:
  - id: D1
    description: "sift config check exits 1 for a rules file whose first category description holds a NUL, printing exactly one line '<file>:<line>:<col> categories[0].description: description must not contain control characters'"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/config-check-rules.test.ts#exits 1 for a NUL in a description, naming file, position and YAML path (WR-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Description, judgment line and rule name reject NUL, BEL, inner tab and U+0085 with '<name> must not contain control characters'; inner LF or U+2028 gives one 'must be one line' issue"
    requirement: CLS-06
    verification:
      - kind: unit
        ref: "packages/core/test/rules.test.ts#rejects NUL, BEL, an inner tab and U+0085 in a description, judgment line or rule name"
        status: pass
      - kind: unit
        ref: "packages/core/test/rules.test.ts#reports an inner line break or U+2028 as one issue, \"must be one line\""
        status: pass
    human_judgment: false
  - id: D3
    description: "from, domain and phrase entries with NUL or BEL are rejected with '<key> entries must not contain control characters'; a phrase with an inner tab still loads with one space"
    requirement: CLS-06
    verification:
      - kind: unit
        ref: "packages/core/test/rules.test.ts#rejects from, domain and phrase entries holding NUL or BEL"
        status: pass
      - kind: unit
        ref: "packages/core/test/rules.test.ts#still loads a phrase with an inner tab, stored with one space"
        status: pass
    human_judgment: false
  - id: D4
    description: "Valid rules files (accents, CJK, the committed example) load and hash exactly as before"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "packages/core/test/rules.test.ts#still loads a description with accents and CJK text"
        status: pass
      - kind: unit
        ref: "packages/core/test/rules-hash.test.ts (pinned hashes, file unchanged)"
        status: pass
      - kind: unit
        ref: "packages/core/test/example-rules.test.ts"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-10-11
status: complete
---

# Phase 03 Plan 21: Control characters in rules.yaml Summary

**WR-02 closed: the strict rules schema now rejects NUL and every other control character (Unicode Cc plus U+2028/U+2029) in descriptions, judgment lines, rule names and from/domain/phrase entries with positioned messages, so sift config check refuses a rules file whose rule-set snapshot PostgreSQL jsonb could not store (SQLSTATE 22P05).**

## Performance

- **Duration:** about 5 min
- **Started:** 2026-10-11T04:32:12Z
- **Completed:** 2026-10-11T04:37:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `CONTROL_CHARACTERS` (module-private, `u` flag) and a widened `LINE_BREAK` in `packages/core/src/rules/schema.ts`. Both are ASCII escapes in the source (non-ASCII byte count 0).
- `oneLine` now uses one `superRefine` that reports at most one issue per value: a line break gives `<name> must be one line` (existing message), any other control character gives `<name> must not contain control characters`.
- `FromEntry`, `DomainEntry` and `PhraseEntry` have a control-character refine after their normalising steps. A tab inside a phrase is collapsed to a space before the check, so it still loads.
- Added an end-to-end test: `sift config check` with a NUL in a description exits 1 with exactly one stderr line naming file, line, column and `categories[0].description`. A mutation run against the pre-fix schema confirmed the test fails without the change.
- Added schema cases for every checked field, the one-issue rule and the positive cases (inner tab in a phrase, accents and CJK). Pinned rule-set hashes are unchanged.

## Task Commits

1. **Task 1 (tracer): sift config check rejects a NUL in a description** - `259723b` (fix)
2. **Task 2 (TDD): control characters in from, domain and phrase entries**
   - RED: `cc1d39e` (test)
   - GREEN: `9d6c2b6` (feat)
   - REFACTOR: none needed

## TDD Gate Compliance (Task 2)

- **RED:** `rejects from, domain and phrase entries holding NUL or BEL` was run alone with `--reporter=junit -t`. It exited 1 and the classifier returned `RED_EVIDENCE_OK` (target_test_failed, 1 fail, no report errors). Semantic assessment: the target test ran and failed for the planned reason (`parseRulesText` accepted a file whose from entry holds NUL, so "expected the rules file to be rejected"). There was no load, syntax or fixture fault. The other four WR-02 cases already passed because Task 1 covers the one-line fields; they were pinned in the same commit as regression tests.
- **GREEN:** after the three refines, all 106 tests in the 4 verify files pass.
- **REFACTOR:** none needed.

## Files Created/Modified

- `packages/core/src/rules/schema.ts`: `CONTROL_CHARACTERS`, wider `LINE_BREAK`, the `noControl` helper, the `oneLine` superRefine and the entry refines
- `apps/worker/test/config-check-rules.test.ts`: the `NUL_DESCRIPTION` fixture and the WR-02 end-to-end test
- `packages/core/test/rules.test.ts`: the `control characters in rules text (WR-02, D-05)` describe (5 cases)

## Decisions Made

- U+2028 and U+2029 count as line breaks and get `must be one line`. Every other Cc character, including the inner tab and U+0085, gets `must not contain control characters`.
- Entry refines run before `max` and `regex`. A from or domain entry with an inner tab therefore reports both the existing pattern message and the control-character message. The plan only asks for one issue per one-line field, so this was accepted as informative.
- The regex is defined in the rules module, not imported from classify (per the plan's interface note).

## Deviations from Plan

None. The plan was executed as written. While making the edits:
- Biome flagged a loop variable named `escape` (noShadowRestrictedNames) and a formatting issue in the RED test. I renamed the variable to `yamlEscape` and ran the formatter before the RED commit.
- One python anchor did not match because Task 1 had already changed the `oneLine` doc comment. The script asserted before writing anything, so I reran it with the correct anchor.

**Total deviations:** 0 auto-fixed.

## Issues Encountered

- `pnpm lint` reports one warning: noTemplateCurlyInString at `apps/worker/test/node-version.test.ts:26`. It was already there and is unrelated to this plan, so it is out of scope. Lint exits 0.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

- WR-02 is closed. Phase 03 still has its remaining gap-closure plans (for example 03-16 WR-01). No blockers.

## Self-Check: PASSED

- FOUND: packages/core/src/rules/schema.ts, apps/worker/test/config-check-rules.test.ts, packages/core/test/rules.test.ts
- FOUND commits: 259723b, cc1d39e, 9d6c2b6 (evaluation-scope for 03-21 resolved with these commits)
- Acceptance criteria re-run: the control-character messages are present (entries count 3), superRefine is present, WR-02 is in both test files, the non-ASCII count in schema.ts is 0, and rules-hash.test.ts is unchanged
- Plan verification: the 4 vitest files pass (106 tests), the core suite passes (405 tests), and `pnpm typecheck` and `pnpm lint` exit 0

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*
