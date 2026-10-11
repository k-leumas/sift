---
phase: 03-tiered-classification-with-traces
plan: 19
subsystem: classification
tags: [ollama, classification, decision-trace, postgres, drizzle, migration, cr-01, d-16, d-31, cls-06, trc-01]

# Dependency graph
requires:
  - phase: 03-18
    provides: "MESSAGE_FAILURE_PASSES (3), the per-process hold-back and the mail-free canary chat that confirm a message Ollama keeps failing on alone"
  - phase: 03-17
    provides: "the message-specific Ollama failure branch (healthy re-probe) and the D-16 clarification note"
provides:
  - "Owner decision recorded: option-review (a message Ollama keeps failing on alone ends as a review decision with reason llm_error)"
  - "'llm_error' as the last value of REVIEW_REASONS and ATTEMPT_FAILURE_CODES in packages/core/src/classify/spans.ts"
  - "LlmVerdict review reason 'llm_error' in packages/core/src/classify/decide.ts"
  - "Migration 0011_decision_llm_error_reason: decision_review_reason_check accepts llm_error (journal idx 11, meta/0011_snapshot.json)"
  - "D-16 and D-31 amendment notes in 03-CONTEXT.md"
affects: [03-20, phase-04-apply, trc-05-trace-cli, m2, classification, verification-gap-1]

actuals:
  tokens: 15300
  tasks: 3
  commits: 3
plan_head_before: bc1db3a83958e6af12dbf151bc4554b74dc4212c
plan_head_after: 12850be00c4c30268a383c1577471d8b0eaf68cc

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A review reason is added by appending to REVIEW_REASONS, to the decision_review_reason_check list in scoped.ts and by a generated drop-and-re-add CHECK migration; classify.test.ts loops REVIEW_REASONS through recordDecision so the core and SQL lists cannot drift"

key-files:
  created:
    - packages/db/migrations/0011_decision_llm_error_reason.sql
    - packages/db/migrations/meta/0011_snapshot.json
  modified:
    - packages/core/src/classify/spans.ts
    - packages/core/src/classify/decide.ts
    - packages/db/src/schema/scoped.ts
    - packages/db/migrations/meta/_journal.json
    - packages/db/test/classify-schema.test.ts
    - packages/core/test/spans.test.ts
    - packages/core/test/decide.test.ts
    - .planning/phases/03-tiered-classification-with-traces/03-CONTEXT.md

key-decisions:
  - "Owner decision (Samuel Kimama, 2026-10-11, 03-19 checkpoint): option-review. A message Ollama fails on alone in MESSAGE_FAILURE_PASSES (3) passes, confirmed by a healthy re-probe and a successful mail-free canary chat, ends as a review decision with reason llm_error (tier llm, confidence null, result null, failed attempt recorded). Amends D-16 and D-31. One-way: stored llm_error rows are append-only"
  - "The owner reviewed the 03-17 D-16 clarification at the 03-19 checkpoint and accepted it (no objection, keep fix 1); no revert of 03-17 is needed"
  - "An llm_error attempt has raw null and a fixed detail text; Ollama's own error text is never stored in the trace"
  - "REVIEW_REASONS is not prompt material, so EXPECTED_PROMPT_HASH and prompt-version.test.ts are unchanged"

patterns-established:
  - "Growing a CHECK allow-list needs no preflight: drizzle-kit generates DROP CONSTRAINT then ADD CONSTRAINT, and every existing row stays valid"

requirements-completed: [CLS-06, TRC-01]

coverage:
  - id: D1
    description: "The owner chose option-review at the blocking-human checkpoint, and accepted the 03-17 D-16 clarification; both are recorded here and in 03-CONTEXT.md"
    requirement: CLS-06
    verification:
      - kind: other
        ref: "grep -n 'Amended by owner decision in gap closure 03-19' .planning/phases/03-tiered-classification-with-traces/03-CONTEXT.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "llm_error is in REVIEW_REASONS and ATTEMPT_FAILURE_CODES (last); an llm_error trace (one failed call, raw null, result null) parses; an unknown reason such as model_error is refused"
    requirement: TRC-01
    verification:
      - kind: unit
        ref: "packages/core/test/spans.test.ts#accepts an llm_error trace: one failed call, raw null, result null (gap closure 03-19)"
        status: pass
      - kind: unit
        ref: "packages/core/test/spans.test.ts#ends REVIEW_REASONS and ATTEMPT_FAILURE_CODES with llm_error (gap closure 03-19)"
        status: pass
      - kind: unit
        ref: "packages/core/test/spans.test.ts#a review reason that is not llm_error (model_error)"
        status: pass
    human_judgment: false
  - id: D3
    description: "decide() turns an llm_error review verdict into outcome review, reviewReason llm_error, tier llm, category null, confidence null, with the attempts kept and result null"
    requirement: CLS-06
    verification:
      - kind: unit
        ref: "packages/core/test/decide.test.ts#llm_error after one call Ollama failed on (gap closure 03-19): review with that reason, no confidence, result null"
        status: pass
    human_judgment: false
  - id: D4
    description: "Migration 0011 only drops and re-adds decision_review_reason_check with llm_error; Postgres accepts an llm_error review row, refuses a labelled llm_error row and an unknown reason with 23514; recordDecision stores an llm_error review; db:generate reports no drift"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "packages/db/test/classify-schema.test.ts#accepts every review reason (D-31)"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify-schema.test.ts#refuses a labelled row with reason llm_error (gap closure 03-19) with 23514"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#accepts every REVIEW_REASONS value in an llm review decision (core and SQL lists agree)"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts and packages/db/test/catalog.test.ts (freshly migrated database)"
        status: pass
      - kind: other
        ref: "pnpm db:generate prints 'No schema changes'"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 19: Owner decision and the llm_error review contract Summary

**The owner chose option-review: a message Ollama keeps failing on alone now has a valid end state, a review decision with reason `llm_error`. `REVIEW_REASONS` and `ATTEMPT_FAILURE_CODES` gained `llm_error`, `LlmVerdict` accepts it, and migration 0011 lets Postgres store it. The D-16 and D-31 amendments are recorded in 03-CONTEXT.md. 03-20 makes the worker write such decisions.**

## Owner decision (Task 1, checkpoint:decision, blocking-human)

- **Chosen option:** `option-review`: a review decision with the new reason `llm_error`.
- **Owner:** Samuel Kimama, project owner.
- **Date:** 2026-10-11, at the 03-19 checkpoint.
- **Owner's words:** "keep fix 1, go with option A". Option A is option-review, the first option the checkpoint presented and the recommended one. "Keep fix 1" refers to the 03-17 D-16 clarification.
- **03-17 D-16 clarification:** the owner saw the 03-17 SUMMARY section "Locked decision changes" at this checkpoint and **accepted it, with no objection**. No follow-up to revert 03-17 is needed.
- **Consequence for 03-20:** 03-20's preconditions are met. It is to be executed, and it makes the worker write the `llm_error` review decision.
- **What this amends:** D-16 (a failure confined to one message for 3 passes, confirmed by a healthy re-probe and a successful canary chat, becomes a review; an outage is still never a decision) and D-31's reason list. This is a one-way change: stored `llm_error` rows are append-only, and Phase 4 apply, the TRC-05 trace CLI and M2 must accept the value.

## Performance

- **Duration:** 8 min (this continuation; the checkpoint agent made no changes)
- **Started:** 2026-10-11T08:14:39Z
- **Completed:** 2026-10-11T08:23:04Z
- **Tasks:** 3 (1 decision checkpoint, 1 tracer, 1 tdd)
- **Files modified:** 10

## Accomplishments

- `spans.ts`: `'llm_error'` is the last value of `REVIEW_REASONS` and of `ATTEMPT_FAILURE_CODES`. Both have doc comments. The action span's review intent and the attempt's validation code accept it through the existing `z.enum`s.
- `decide.ts`: the `LlmVerdict` review reason union includes `'llm_error'`. No logic changed, because a review verdict already gives outcome review, category null, confidence null, and an llm span with result null and the attempts kept.
- `scoped.ts`: `decision_review_reason_check` lists `llm_error`, and the decision doc comment names it.
- Migration `0011_decision_llm_error_reason.sql` was generated by `pnpm db:generate --name=decision_llm_error_reason`. It contains exactly two statements: DROP CONSTRAINT and ADD CONSTRAINT `decision_review_reason_check`. The journal entry `when` (1791706525352) is later than 0010's (1791658921210). Apart from the CHECK value, the snapshot differs from 0010 only in key order. A second `pnpm db:generate` printed "No schema changes".
- `03-CONTEXT.md`: an amendment note under D-16, after the 03-17 note, and an "llm_error added" note under D-31. The original decision text is unchanged.

## Task Commits

1. **Task 1: owner decision**: no commit. The decision was taken at the checkpoint and is recorded in this SUMMARY and in the Task 3 docs commit.
2. **Task 2 (tracer): llm_error in core, the Drizzle CHECK and migration 0011, classify-schema tests**: `9056482` (feat)
3. **Task 3 (tdd): core unit tests**: `ab11bc6` (test)
4. **Task 3: D-16 and D-31 amendments in 03-CONTEXT.md**: `12850be` (docs)

**Plan metadata:** the SUMMARY commit and the state commit that follow.

## Files Created/Modified

- `packages/core/src/classify/spans.ts`: `llm_error` in both lists, with doc comments
- `packages/core/src/classify/decide.ts`: `LlmVerdict` review reason and doc comment
- `packages/db/src/schema/scoped.ts`: CHECK list and decision doc comment
- `packages/db/migrations/0011_decision_llm_error_reason.sql`: drop and re-add of `decision_review_reason_check` (created)
- `packages/db/migrations/meta/0011_snapshot.json`: drizzle snapshot (created)
- `packages/db/migrations/meta/_journal.json`: entry idx 11
- `packages/db/test/classify-schema.test.ts`: `llm_error` in "accepts every review reason (D-31)", and a new refusal for a labelled `llm_error` row (`decision_review_reason_check`, 23514). The `bored` refusal is kept.
- `packages/core/test/spans.test.ts`: an llm_error trace parses, both lists end with llm_error, and `model_error` is refused
- `packages/core/test/decide.test.ts`: an llm_error review verdict case in the review table
- `.planning/phases/03-tiered-classification-with-traces/03-CONTEXT.md`: D-16 and D-31 amendment notes

## Decisions Made

- The test fixtures use the fixed attempt detail text "Ollama failed on this message". 03-20 chooses the text the worker writes. The trace schema only requires a string.
- The refusal case uses `llmLabelled()` with `review_reason: 'llm_error'`. That row breaks only `decision_review_reason_check`: confidence is present and the outcome is labelled, so `decision_confidence_check` still holds. The refusal is therefore attributed to the intended constraint.
- `classify.test.ts` was not edited. Its `REVIEW_REASONS` loop now covers `llm_error` by itself. `reviewVerdict('llm_error')` maps to attempt code `llm_error`, which is valid now that the code is in `ATTEMPT_FAILURE_CODES`.

## Deviations from Plan

None. The plan was executed as written for option-review.

## TDD Notes (Task 3, tdd="true")

- **Layered on the tracer:** the behaviour Task 3 tests was implemented in Task 2 (`9056482`), as the plan intends. So the `feat` commit comes before the `test` commit, and this order is intentional. It follows the project pattern for a tdd task on top of a tracer.
- **RED:** the plan-base `spans.ts` and `decide.ts` (from `bc1db3a`) were placed in the working tree. Then `pnpm vitest run packages/core/test/spans.test.ts packages/core/test/decide.test.ts --reporter=junit --outputFile.junit=.vitest/red-03-19.xml` exited 1, with 57 tests, 54 passing and 3 failing. Exactly the 3 new positive tests failed. `gsd check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed, junit). The target was "decisionSpansSchema: valid traces (TRC-01, TRC-06) > accepts an llm_error trace: one failed call, raw null, result null (gap closure 03-19)". **Semantic assessment:** the target ran and failed because `parseDecisionSpans` threw. The Zod errors were "Invalid option" for the attempt code and for the action review reason, which means `llm_error` was not yet in either enum. There was no load, fixture or syntax fault. The other two failures are the sibling tests for the same missing value. The committed files were restored with `git checkout --`, and `git diff --quiet` confirmed it. The evidence record was moved to the scratchpad and not committed.
- **GREEN:** with the committed implementation, spans, decide and prompt-version passed 81/81, and `pnpm typecheck` passed.
- **REFACTOR:** none.

## Issues Encountered

- The RED evidence record in the gitignored `.vitest/` folder made `pnpm lint` fail, because Biome formats it. It was moved to the scratchpad, as 03-18 did, and lint then exited 0. The `noTemplateCurlyInString` warning in `apps/worker/test/node-version.test.ts` was already there and is not related to this plan.

## User Setup Required

None. No external service configuration is required. On the next `sift migrate`, the owner database applies migration 0011. It only widens a CHECK, so every existing row stays valid.

## Next Phase Readiness

- **03-20 is unblocked and should run**, because the owner chose option-review. It makes the worker write a review decision with reason `llm_error` after MESSAGE_FAILURE_PASSES re-probe-confirmed failures and a successful canary chat, in place of 03-18's in-memory hold-back. T-03-68 (an outage recorded as a decision) is mitigated there by outage tests.
- Phase 4 apply, the TRC-05 trace CLI and M2 must treat `llm_error` as a valid review reason and attempt code. Because they validate through `decisionSpansSchema`, they get the new value automatically.
- Verification: the plan's seven files (classify-schema, classify, migrate, catalog, spans, decide, prompt-version) passed 193/193. `pnpm db:generate` reported "No schema changes". `pnpm typecheck` 0, `pnpm lint` 0. `git diff --quiet` passed for `packages/core/test/prompt-version.test.ts` and for 03-VERIFICATION.md.

## Self-Check: PASSED

- All 10 created or modified files exist on disk.
- Commits 9056482, ab11bc6 and 12850be are ancestors of HEAD. `check evaluation-scope --plan 03-19 --commits-only` resolves them.
- Task 2 acceptance: `'llm_error'` matches twice in spans.ts and once in scoped.ts. 0011 exists and contains `decision_review_reason_check` and `llm_error`. The journal names `0011_decision_llm_error_reason` exactly once. The verify command exited 0, and was re-run after the commit for the tracer gate.
- Task 3 acceptance: `llm_error` matches in spans.test.ts (8) and decide.test.ts (3). The "Amended by owner decision in gap closure 03-19" line is present. prompt-version.test.ts and 03-VERIFICATION.md are unchanged. The verify command exited 0.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*
