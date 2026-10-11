---
phase: 03-tiered-classification-with-traces
plan: 16
subsystem: classification
tags: [llm-output, zod, postgres, jsonb, 22p05, wr-01, vitest]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "validateLlmOutput and the retry/review path (03-05, 03-07), recordDecision as the single decision write path (03-06, 03-14), stripNul in ingest.ts"
provides:
  - "REASON_CONTROL_CHARACTERS (/[\\p{Cc}\\u2028\\u2029]/u) exported from packages/core/src/classify/llm-output.ts and @sift/core/classify"
  - "validateLlmOutput: a reason with a control character after JSON.parse and trim is schema_mismatch with the fixed detail 'reason: control_character'"
  - "recordDecision strips NUL from every string of the parsed spans before assertConsistent and the insert"
  - "apps/worker/test/classify-control-chars.test.ts (end-to-end NUL, BEL and U+2028 reasons through the pass)"
affects: [03-verification, gsd-secure-phase, phase-04-label-application]

actuals:
  tokens: 4280
  tasks: 2
  commits: 3
plan_head_before: 9d5edf86d64532111213583de2e7e177a56f930c
plan_head_after: cc029c2acced8fa8fb999790a939208b804daae0

tech-stack:
  added: []
  patterns:
    - "Model output that would break storage is rejected in code (schema_mismatch, retried once, then review invalid_output), never repaired; only Ollama-supplied trace strings get a NUL strip at the database boundary"
    - "Checks that the llama.cpp grammar cannot express (Unicode property escapes) live in validateLlmOutput, not in llmOutputSchema, so the prompt material hash is unchanged"

key-files:
  created:
    - apps/worker/test/classify-control-chars.test.ts
  modified:
    - packages/core/src/classify/llm-output.ts
    - packages/core/src/classify/index.ts
    - packages/core/test/llm-output.test.ts
    - packages/db/src/classify.ts
    - packages/db/test/classify.test.ts

key-decisions:
  - "WR-01: a reason holding a Unicode control character (Cc) or U+2028/U+2029 after the schema's trim is schema_mismatch 'reason: control_character'; leading/trailing whitespace controls are trimmed away first and pass"
  - "recordDecision strips NUL from the whole parsed spans (raw, thinking, done_reason, response_model) as a backstop; the reason is never stripped because validateLlmOutput rejects it first"
  - "REASON_CONTROL_CHARACTERS is re-exported from @sift/core/classify next to REASON_MAX_CHARS"

patterns-established:
  - "End-to-end control-character tests build JSON escapes from String.fromCharCode(92) so the test source holds no backslash-u escape and no raw control character"

requirements-completed: [CLS-06, CLS-03, SEC-01]

coverage:
  - id: D1
    description: "A model reason with NUL, BEL or U+2028 is retried once and then stored as a review invalid_output decision (two schema_mismatch attempts with detail 'reason: control_character'); the other message of the pass is labelled, both replay, nothing stays pending"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-control-chars.test.ts#NUL in the reason twice: stored as review invalid_output, the other message labelled"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-control-chars.test.ts#BEL in the reason twice: stored as review invalid_output"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-control-chars.test.ts#U+2028 in the reason twice: stored as review invalid_output"
        status: pass
    human_judgment: false
  - id: D2
    description: "A NUL reason on the first call and a valid answer on the retry is labelled with two attempts"
    requirement: CLS-03
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-control-chars.test.ts#NUL on the first call, a valid answer on the retry: labelled with two attempts"
        status: pass
    human_judgment: false
  - id: D3
    description: "validateLlmOutput rejects NUL, BEL, ESC, DEL, U+0085, an inner tab or line feed, U+2028 and U+2029 per code point, accepts accents, CJK and astral emoji, accepts a reason whose whitespace controls only lead or trail, and never quotes the reason in the detail"
    requirement: CLS-03
    verification:
      - kind: unit
        ref: "packages/core/test/llm-output.test.ts#control characters in the reason (WR-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The prompt material is unchanged: EXPECTED_PROMPT_HASH still matches and prompt-version.test.ts is not modified"
    verification:
      - kind: unit
        ref: "packages/core/test/prompt-version.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "recordDecision stores an llm decision whose attempt holds NUL in thinking, raw and done_reason (and NUL in response_model) with the NUL removed; before the change the insert failed with 22P05"
    requirement: SEC-01
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#stores an llm decision whose attempt holds NUL in thinking, raw and done_reason, without the NUL (WR-01 backstop)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 16: Control characters in the model reason (WR-01) Summary

**validateLlmOutput now rejects a reason holding a Unicode control character or U+2028/U+2029 as schema_mismatch `reason: control_character` (retried once, then stored as review invalid_output), and recordDecision strips NUL from Ollama-supplied trace strings, so no model answer can make a message fail every pass with SQLSTATE 22P05.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-10-11T04:41:17Z
- **Completed:** 2026-10-11T04:48:10Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- `REASON_CONTROL_CHARACTERS = /[\p{Cc}\u2028\u2029]/u` in `packages/core/src/classify/llm-output.ts`. The source keeps the escapes and has no non-ASCII bytes. validateLlmOutput applies it to the parsed and trimmed reason after a successful safeParse. `llmOutputSchema` and `ollamaFormat` are unchanged, so EXPECTED_PROMPT_HASH still matches and no new prompt_version row is created.
- End-to-end test file `apps/worker/test/classify-control-chars.test.ts` (4 cases) runs on a real DB with the fake Ollama. NUL, BEL and U+2028 reasons give outcome done with labelled 1, review 1, llmCalls 3 and failures 0. The bad message gets a review invalid_output decision with two `{ ok: false, code: 'schema_mismatch', detail: 'reason: control_character' }` attempts. Every decision passes expectReplayableDecision and no message is left pending. NUL followed by a valid retry is labelled with two attempts.
- Contract table in `packages/core/test/llm-output.test.ts`: 9 rejected characters, 4 accepted Unicode reasons, the trimmed leading/trailing case and a sentinel check on the detail.
- `recordDecision` now runs `stripNul(parseDecisionSpans(input.spans))` before assertConsistent and the insert. An attempt with NUL in thinking, raw, done_reason and response_model is stored without the NUL.

## Task Commits

1. **Task 1 (tracer): a NUL reason becomes a stored review invalid_output decision** - `9182182` (fix)
2. **Task 2 (TDD): output-contract cases and the recordDecision NUL backstop**
   - RED: `7ffef70` (test)
   - GREEN: `cc029c2` (feat)
   - REFACTOR: none needed

## Mutation proof (the end-to-end test bites)

I disabled the new check in a scratch-backed copy (`if (false && REASON_CONTROL_CHARACTERS.test(...))`) and ran `pnpm vitest run apps/worker/test/classify-control-chars.test.ts -t "NUL in the reason twice"`. It failed with `expected ... failures: 0`, got `failures: 1`: the decision insert failed with 22P05, the pass counted it as a per-message failure, and the message was left pending. I restored the file with `command cp -f` and `diff -q` showed it identical.

## TDD Gate Compliance

Task 2 (`tdd="true"`):

- **RED** `7ffef70`. Target: `re-runs, latest decision, body restore and the review reasons (D-17, D-32, TRC-04) > stores an llm decision whose attempt holds NUL in thinking, raw and done_reason, without the NUL (WR-01 backstop)`. It was run alone with `--reporter=junit -t "WR-01 backstop"`, exited 1, and failed with `code: '22P05', detail: '\u0000 cannot be converted to text.'` on the decision insert. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed, 1 fail, no report errors). Semantic assessment: the target ran and failed for the planned reason (jsonb refused the NUL from Ollama-supplied span strings). There was no load, syntax or fixture fault. The llm-output contract cases already passed at RED time because Task 1 had implemented the check, so they were pinned in the same commit as regression tests (same pattern as 03-14 and 03-21).
- **GREEN** `cc029c2`. The three Task 2 verify files pass (121 tests) and `pnpm typecheck` exits 0.
- **REFACTOR**: none needed.

## Files Created/Modified

- `packages/core/src/classify/llm-output.ts`: REASON_CONTROL_CHARACTERS, the check in validateLlmOutput, doc comments (WR-01, 22P05, fixed detail)
- `packages/core/src/classify/index.ts`: re-exports REASON_CONTROL_CHARACTERS
- `apps/worker/test/classify-control-chars.test.ts`: new end-to-end file (4 cases, 229 lines)
- `packages/core/test/llm-output.test.ts`: `control characters in the reason (WR-01)` describe
- `packages/db/src/classify.ts`: recordDecision NUL backstop and its doc comment
- `packages/db/test/classify.test.ts`: the `(WR-01 backstop)` case

## Decisions Made

- The check runs on the trimmed reason. A tab, line feed or U+2028 that only leads or trails is trimmed by the schema and passes, which matches the one-line rule. Inside the text, it is rejected.
- The end-to-end answers put the escape mid-sentence (`Looks fine<char> to me.`) because a trailing U+2028 would be trimmed away and would not test anything.
- response_model was also given a NUL in the backstop case. The plan names it as an Ollama-supplied field, and the stored row confirms it is stripped too.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] REASON_CONTROL_CHARACTERS was not reachable from @sift/core/classify**
- **Found during:** Task 2 (RED)
- **Issue:** `packages/core/test/llm-output.test.ts` imports from `../src/classify/index.ts`, which did not re-export the new constant.
- **Fix:** Added it to the llm-output export list in `packages/core/src/classify/index.ts`, next to REASON_MAX_CHARS.
- **Files modified:** packages/core/src/classify/index.ts
- **Verification:** The core tests and `pnpm typecheck` pass.
- **Committed in:** `7ffef70` (RED commit; a one-line re-export, not the behaviour under test)

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact on plan:** none on scope.

## Issues Encountered

- `pnpm lint` exits 0 with the existing noTemplateCurlyInString warning at `apps/worker/test/node-version.test.ts:26`. It is unrelated to this plan.
- Commits land on `main`, as the orchestrator dispatched this plan as a sequential executor on the main working tree (`git.branching_strategy: none`).

## Verification

- `pnpm vitest run apps/worker/test/classify-control-chars.test.ts packages/core/test/llm-output.test.ts packages/core/test/prompt-version.test.ts packages/db/test/classify.test.ts apps/worker/test/classify-llm-tier.test.ts apps/worker/test/classify-hermetic.test.ts apps/worker/test/classify-run.test.ts`: 7 files, 169 tests passed
- Regression run of `packages/core`, `packages/db` and every `apps/worker/test/classify-*` file: 39 files, 919 tests passed
- `pnpm typecheck` exits 0. `pnpm lint` exits 0 (1 existing warning).
- Acceptance greps: `export const REASON_CONTROL_CHARACTERS` and `reason: control_character` are in llm-output.ts, there are 4 `it(` in the new test file, `git diff --quiet packages/core/test/prompt-version.test.ts` passes, `stripNul(parseDecisionSpans` is in classify.ts, and `WR-01` appears in both test files.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- WR-01 is closed: a control character in the model reason can no longer make a message fail on every pass, so it can no longer feed the five-in-a-row rethrow behind CR-03. Ready for 03-17.

## Self-Check: PASSED

- FOUND: apps/worker/test/classify-control-chars.test.ts, packages/core/src/classify/llm-output.ts, packages/db/src/classify.ts
- FOUND commits: 9182182, 7ffef70, cc029c2 (all ancestors of HEAD)

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*
