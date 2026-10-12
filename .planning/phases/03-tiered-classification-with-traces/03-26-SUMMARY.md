---
phase: 03-tiered-classification-with-traces
plan: 26
subsystem: rules
tags: [rules, config-check, jsonb, unicode, surrogate, zod, WR-05]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-16 WR-02 control-character checks in the rules schema; 03-25 WR-04 isWellFormed predicate for model reasons"
provides:
  - "UNPAIRED_SURROGATE message tail and noUnpairedSurrogate (isWellFormed) predicate in packages/core/src/rules/schema.ts (module-private)"
  - "oneLine third branch: description, judgment lines and rule name reject an unpaired surrogate, one issue per value (line break, then control character, then surrogate)"
  - "refine(noUnpairedSurrogate) on FromEntry, DomainEntry and PhraseEntry, directly after noControl"
  - "sift config check exits 1 with file:line:col and the YAML path for such a file; the worker's loadRules reports rules_invalid before any rule_set insert"
affects: [phase-03-verification, config-check, classify-run]

actuals:
  tokens: 3157
  tasks: 2
  commits: 3
plan_head_before: 281eec25ba88220f777ad47420b386ab4fc4abd0
plan_head_after: e75dbd0ea4673d379ad351770db4c15d4d206bde

tech-stack:
  added: []
  patterns:
    - "Rules text checks in order: line break, control character, unpaired surrogate; reject, never repair (D-05)"
    - "YAML escapes for surrogates built at runtime from String.fromCharCode(92); source and test files stay ASCII"

key-files:
  created: []
  modified:
    - packages/core/src/rules/schema.ts
    - apps/worker/test/config-check-rules.test.ts
    - packages/core/test/rules.test.ts

key-decisions:
  - "WR-05 uses its own message ('must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape') with the same isWellFormed predicate as 03-25; WR-02 messages, CONTROL_CHARACTERS, LINE_BREAK and CATEGORY_NAME_PATTERN unchanged"
  - "Entries keep separate, non-aborting refines, so an entry holding both a control character and an unpaired surrogate reports two accurate issues at the same path; the one-issue-per-value rule applies to the one-line fields as the plan specified"

patterns-established:
  - "oneLine reports one issue per value, first match wins: line break, control character, unpaired surrogate"

requirements-completed: [CLS-06, CLS-01]

coverage:
  - id: D1
    description: "sift config check exits 1 for a lone U+D800 description, no stdout, one stderr line with file:line:col, categories[0].description and the exact message"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/config-check-rules.test.ts#sift config check reads every mailbox rules file (D-05) > exits 1 for an unpaired surrogate in a description, naming file, position and YAML path (WR-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Lone high and low surrogates in description, judgment line and rule name: exactly one issue at the path and line; line break and control character take precedence as the only issue; message never quotes the value"
    requirement: CLS-06
    verification:
      - kind: unit
        ref: "packages/core/test/rules.test.ts#unpaired surrogates in rules text (WR-05, D-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "from, domain and phrase entries holding a lone surrogate: exactly one issue at rules[0].match.<key>[0]"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "packages/core/test/rules.test.ts#unpaired surrogates in rules text (WR-05, D-05) > rejects from, domain and phrase entries holding a lone surrogate"
        status: pass
    human_judgment: false
  - id: D4
    description: "A valid pair written as two escapes, and the emoji itself, still load; rules-hash, example-rules and exact-rules tests pass unchanged"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "packages/core/test/rules.test.ts#unpaired surrogates in rules text (WR-05, D-05) > still loads a description written as the two escapes of a valid pair"
        status: pass
      - kind: unit
        ref: "packages/core/test/rules-hash.test.ts"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-10-12
status: complete
---

# Phase 3 Plan 26: Unpaired surrogates in rules.yaml (WR-05) Summary

**The rules schema now rejects any free-text value that is not well-formed UTF-16: the description, judgment lines, rule names and from/domain/phrase entries. So `sift config check` and the worker's `rules_invalid` status report such a file with its file, line and YAML path. Before this, every rule_set insert failed with an anonymous jsonb error.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-10-12T21:35:50Z
- **Completed:** 2026-10-12T21:40:52Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Closed the owner-side half of the 03-VERIFICATION SC5 / CLS-06 gap (review WR-05, the WR-02 residual). Config check and the worker share `loadRules`, so they now reject the same unstorable text. run.ts line 232 and config-check.ts line 24 both call it.
- `noUnpairedSurrogate(value)` is `value.isWellFormed()`, the same predicate 03-25 uses for model reasons. It has its own owner-facing message, which names the fix and never quotes the value.
- Every file that loads today still loads with the same content and D-03 hash. rules-hash, example-rules, exact-rules and all WR-02 cases pass unchanged.

## Task Commits

1. **Task 1 (tracer): config check rejects a description holding an unpaired-surrogate escape.** `c0c4035` (fix)
2. **Task 2 (tdd): entries, precedence and accepted pairs.** RED `5339884` (test), GREEN `e75dbd0` (feat). No refactor was needed.

## Files Created/Modified

- `packages/core/src/rules/schema.ts`: adds `UNPAIRED_SURROGATE` and `noUnpairedSurrogate` with a WR-05 doc comment, the third `oneLine` branch, and three entry refines. The file is pure ASCII.
- `apps/worker/test/config-check-rules.test.ts`: adds `BACKSLASH`, `LONE_SURROGATE_DESCRIPTION`, `UNPAIRED_SURROGATE_MESSAGE` and the WR-05 case. There are now 9 `it(` matches (8 before). The file is pure ASCII.
- `packages/core/test/rules.test.ts`: `withDescription` and `oneLineFields` move to file scope so both describes share them. Adds `entryKinds` and the describe `unpaired surrogates in rules text (WR-05, D-05)` with 7 cases: a sentinel, lone high and low surrogates in one-line fields, the message, precedence, entries, a valid pair as escapes, and the emoji itself. The file still has 2 non-ASCII lines and no backslash-u sequence.

## Proofs

**Task 1 mutation proof.** I removed the new `oneLine` branch in a copy backed by a scratch file, then restored it with `command cp -f` and confirmed with `diff -q`. The new case then failed on its first assertion. Config check printed `Config OK: 2 mailboxes (alpha, beta); password env vars present; rules files valid` on stdout, so `expected [ Array(1) ] to deeply equal []`. Without the check, config check reports the file as valid.

**Task 2 RED.** Target: `unpaired surrogates in rules text (WR-05, D-05) > rejects from, domain and phrase entries holding a lone surrogate`. The JUnit report showed 1 failed and 72 skipped, and the classifier returned `RED_EVIDENCE_OK` / `target_test_failed`. Semantic assessment: the target ran and failed inside `issuesOf` with `expected the rules file to be rejected`, because a from entry holding a lone U+D800 still loaded. That is the missing behaviour, not a setup, import or fixture fault. The one-line, precedence and valid-pair cases already passed after Task 1, and the RED commit pins them as regression tests. The record (json, xml, console) was moved out of `.vitest/` to the scratchpad.

## Decisions Made

- The message and predicate follow the plan. Category names and labels are not checked, because CATEGORY_NAME_PATTERN is ASCII-only and a label must equal a category name.
- On the optional reviewer suggestion (an entry holding both a control character and an unpaired surrogate): a probe shows it reports two issues at the same path, one for control characters and one for the unpaired surrogate. Both are accurate. Cutting it to one issue would mean making the WR-02 refine aborting or wrapping the predicate. The first changes existing check behaviour and the second breaks the `refine(noUnpairedSurrogate` acceptance count, so I left it as is. The plan's one-issue truth covers only the one-line fields, and those do give one issue.
- No backstop in ensureRuleSet, as the plan decided. The worker validates with the same `loadRules` before any insert.

## Deviations from Plan

None. The plan was executed exactly as written.

Note on the commit branch: commits went straight to `main`, as in every earlier sequential 03-xx plan (`git.branching_strategy: none`). Each commit used an explicit pathspec and hooks ran (biome and commitlint passed). No `--no-verify`.

## Issues Encountered

None.

## Verification

- `pnpm vitest run` over rules, rules-hash, example-rules, exact-rules and config-check-rules: 5 files, 153 tests passed.
- `pnpm typecheck`: passed. `pnpm lint`: 1 warning, the existing noTemplateCurlyInString in apps/worker/test/node-version.test.ts, which is unrelated.
- `grep -c "refine(noUnpairedSurrogate" packages/core/src/rules/schema.ts` gives 3. `noUnpairedSurrogate` appears 5 times. The message text matches once.
- `git diff --quiet 1aae7bc -- rules-hash.test.ts example-rules.test.ts load.ts hash.ts config-check.ts run.ts` exits 0.
- ASCII check: 0 non-ASCII lines in schema.ts and config-check-rules.test.ts, and 2 in rules.test.ts (unchanged).
- `grep -n loadRules` matches in both apps/worker/src/classify/run.ts and apps/worker/src/commands/config-check.ts.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

WR-05 is closed and WR-04 was closed by 03-25, so both halves of the SC5 / CLS-06 gap are done. Phase 3 is ready for re-verification.

## Self-Check: PASSED

- FOUND: packages/core/src/rules/schema.ts, apps/worker/test/config-check-rules.test.ts, packages/core/test/rules.test.ts
- FOUND: c0c4035, 5339884, e75dbd0 (ancestors of HEAD)

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-12*
