---
phase: 03-tiered-classification-with-traces
plan: 18
subsystem: classification
tags: [ollama, classification, mailbox-status, wr-03, cr-01, cls-06, vitest]

# Dependency graph
requires:
  - phase: 03-17
    provides: "draftFor's message-specific Ollama failure branch (healthy re-probe), PassState.ollamaFailed, done.ollamaFailed"
  - phase: 03-15
    provides: "recordIngestSynced in the ingest lock; the post-pass recordSyncSuccess write in mailbox-batch.ts"
provides:
  - "NOTICE_MAX_IDS (3), unclassifiedNotice(ids), PassState.unclassified and ClassifyOutcome done.unclassified in apps/worker/src/classify/run.ts"
  - "recordSyncSuccess(scope, at, { notice }) storing a non-error owner notice in last_error with state ok"
  - "mailbox-batch.ts writes the notice for a done pass; busy and aborted unchanged"
  - "sift mailbox list renders 'ok; <notice>' and 'ok, backfilling X of Y; <notice>' (NOTICE_PREVIEW 240)"
  - "MESSAGE_FAILURE_PASSES (3), ClassifyRuntime.messageFailures, MESSAGE_HELD_BACK_LOG, CANARY_SYSTEM, CANARY_USER, canaryChat(ctx)"
affects: [03-19, 03-22, classification, mailbox-status, verification-gap-1]

actuals:
  tokens: 5600
  tasks: 2
  commits: 4
plan_head_before: 4d831ee2eb06ca6a772636d989eb5a39865be3cf
plan_head_after: 5b08ac7785a4971632e93d19f1f3f6b29bc28089

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner notice on an ok state: last_error holds a fixed-template note (ids and counts only) while state stays ok; a clean pass clears it"
    - "Per-process failure memory with a mail-free canary chat before a message is held back, so an always-failing runner still reads as an outage"

key-files:
  created: []
  modified:
    - apps/worker/src/classify/run.ts
    - packages/db/src/status.ts
    - apps/worker/src/runtime/mailbox-batch.ts
    - apps/worker/src/commands/mailbox-list.ts
    - apps/worker/test/classify-batch.test.ts
    - apps/worker/test/classify-run.test.ts
    - apps/worker/test/classify-control-chars.test.ts
    - apps/worker/test/classify-leak.test.ts
    - packages/db/test/status.test.ts
    - apps/worker/test/registry-cli.test.ts

key-decisions:
  - "WR-03: a done pass that left messages unclassified (Ollama failed on them alone, they threw, no body, or held back) writes state ok with last_error = unclassifiedNotice(ids); a clean done pass writes null; busy and aborted keep the plain recordSyncSuccess"
  - "Per worker process, a message Ollama failed on alone in MESSAGE_FAILURE_PASSES (3) passes is held back: no preflight, chat or budget, stays pending and named in the notice; restart or an exact rule ends the hold"
  - "A message is held back only if a mail-free canary chat succeeds at that moment; a failed canary sets llmBlocked from its result (D-16 outage) and the count is not stored"
  - "The canary costs one call against llmCallsLeft; an input_too_long canary result (not expected for the fixed text) is treated as an outage with code rejected"

patterns-established:
  - "markUnclassified(state, id): one id once, in the order the pass met it (newest INTERNALDATE first)"

requirements-completed: [CLS-06]

coverage:
  - id: D1
    description: "A message the pass could not classify is named in mailbox_status.last_error while state stays ok; a later clean pass clears it (batch level)"
    requirement: CLS-06
    verification:
      - kind: e2e
        ref: "apps/worker/test/classify-batch.test.ts#skips only that message: older mail is decided and runBatch resolves, on consecutive batches"
        status: pass
    human_judgment: false
  - id: D2
    description: "unclassifiedNotice text: null for none, at most 3 ids then '; and N more', ids only (T-03-31, T-03-64)"
    requirement: CLS-06
    verification:
      - kind: unit
        ref: "apps/worker/test/classify-run.test.ts#unclassifiedNotice names at most NOTICE_MAX_IDS ids, then a count (WR-03)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#two messages Ollama fails on alone are named newest first (WR-03)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-leak.test.ts#a 500 on the only message, Ollama otherwise healthy: skipped by id, error body out of status and logs (CR-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "recordSyncSuccess notice storage and sift mailbox list 'ok; <notice>' rendering, with and without backfill progress"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "packages/db/test/status.test.ts#stores the notice as last_error with state ok; a later call without one clears it"
        status: pass
      - kind: integration
        ref: "apps/worker/test/registry-cli.test.ts#shows every state, the backfill progress and a MESSAGES column"
        status: pass
    human_judgment: false
  - id: D4
    description: "A message Ollama failed on alone in 3 passes is no longer sent (no preflight, no chat) in this process; after 2 passes it still is; a restart sends it again"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#after MESSAGE_FAILURE_PASSES (3) passes no chat and no preflight is spent on it; after 2 it is still sent (WR-03)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a fresh runtime (worker restart) sends a held-back message again (WR-03)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Canary: mail-free request (fixed text, format only Probe); a failing canary is an outage and nothing is held back (T-03-67)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#the canary request carries no email: fixed CANARY_SYSTEM and CANARY_USER, format names only Probe (CR-01)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a runner that fails every prompt fails the canary: an outage, and the message is not held back (CR-01)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A decided message (Ollama answers, or an exact rule added later) is removed from the failure memory"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a message that failed twice and is then answered is decided and forgotten (WR-03)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#an exact rule added after the message is held back decides it with no chat and forgets it (WR-03)"
        status: pass
    human_judgment: false

# Metrics
duration: 21min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 18: Unclassified-message notice and per-process hold-back Summary

**A pass now reports the ids it could not classify. The batch stores them as an ok-state notice in mailbox_status ("1 message could not be classified (ids: ...); see docker compose logs worker"), and `sift mailbox list` shows it as "ok; <notice>". A message Ollama fails on alone in 3 passes is no longer sent by that worker process, but only after a mail-free canary chat proves Ollama itself still answers (WR-03, CLS-06, 03-VERIFICATION gap 1 item 2).**

## Performance

- **Duration:** 21 min
- **Started:** 2026-10-11T05:11:53Z
- **Completed:** 2026-10-11T05:33:02Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- `run.ts`: `PassState.unclassified` is filled once per id, in the order the pass meets messages, from three places: the body_missing branch, the catch branch, and the message-specific Ollama failure branch. Held-back messages are added too. The done outcome carries `unclassified`. `unclassifiedNotice(ids)` returns null for an empty list. Otherwise it returns the fixed template with at most `NOTICE_MAX_IDS` (3) ids and then "; and N more".
- `status.ts`: `recordSyncSuccess(scope, at, { notice })` stores the notice (capped at 1000) as last_error with state ok. Without a notice it stores null, as before.
- `mailbox-batch.ts`: the `done` case writes `recordSyncSuccess(scope, syncedAt, { notice: unclassifiedNotice(outcome.unclassified) })`. `busy` and `aborted` write the plain call.
- `mailbox-list.ts`: an ok mailbox with a non-blank last_error shows `ok; <notice>`, or `ok, backfilling X of Y; <notice>` during a backfill. Whitespace runs are collapsed and the notice is capped at `NOTICE_PREVIEW` (240).
- Hold-back: `ClassifyRuntime.messageFailures` (one per process) counts the passes in which Ollama failed on a message alone. When the next count would reach `MESSAGE_FAILURE_PASSES` (3), `canaryChat(ctx)` sends one gated, mail-free chat (`CANARY_SYSTEM`, `CANARY_USER`, format with the single category Probe). If the canary succeeds, the count is stored and `MESSAGE_HELD_BACK_LOG` is logged with mailbox, id and passes. If it fails, the pass is an outage (D-16) and the count stays as it was. In `draftFor`, a message at the limit is skipped after the exact-rule check and before the outage and budget checks, so no preflight, chat or budget is spent on it. A committed decision deletes the id from the map.

## Task Commits

1. **Task 1 (tracer): notice in mailbox_status and sift mailbox list** - `30148dd` (feat)
2. **Task 2 RED: failing hold-back tests plus a name-only scaffold** - `8b97cb2` (test)
3. **Task 2 GREEN: failure memory, canary and hold-back** - `f8a81bf` (feat)
4. **Task 2: leak test expects the notice** - `5b08ac7` (test)

**Plan metadata:** the SUMMARY commit and the state commit that follow.

## Files Created/Modified

- `apps/worker/src/classify/run.ts` - notice, unclassified tracking, failure memory, canary, hold-back check, module doc bullet
- `packages/db/src/status.ts` - `recordSyncSuccess` notice option
- `apps/worker/src/runtime/mailbox-batch.ts` - done case writes the notice
- `apps/worker/src/commands/mailbox-list.ts` - `ok; <notice>` rendering and doc comment
- `apps/worker/test/classify-batch.test.ts` - notice after the first and second poison cycles, cleared after Ollama answers (third cycle)
- `apps/worker/test/classify-run.test.ts` - 8 tests in "a message Ollama keeps failing on is held back (WR-03, CR-01)", `unclassified` in done equalities, `passes` in the log-key allowlist
- `apps/worker/test/classify-control-chars.test.ts` - `unclassified: []` in two done equalities
- `apps/worker/test/classify-leak.test.ts` - the CR-01 single-message case expects the notice
- `packages/db/test/status.test.ts` - notice store, cap and clear
- `apps/worker/test/registry-cli.test.ts` - india (`ok; <notice>`, newline collapsed) and juliet (backfilling plus notice) rows

## Decisions Made

- The canary takes one call off `llmCallsLeft`, so the third failing pass reports `llmCalls: 2`.
- An `input_too_long` canary result is treated as an outage with code `rejected`. This should not happen with the fixed text. The plan only covered infra results.
- The held-back warn line uses an exported constant, `MESSAGE_HELD_BACK_LOG`, so tests can match it. The text is the one the plan gives.
- Only a `done` pass writes the notice. `busy` and `aborted` clear last_error as before, as the plan specified.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Done-outcome equalities in other test files**
- **Found during:** Task 1
- **Issue:** `toEqual` on the done outcome in classify-run.test.ts (6 places) and classify-control-chars.test.ts (2 places) would fail now that the outcome has `unclassified`.
- **Fix:** each place got `unclassified` with the same ids as its `ollamaFailed`.
- **Files modified:** apps/worker/test/classify-run.test.ts, apps/worker/test/classify-control-chars.test.ts
- **Verification:** 103/103 across classify-run, control-chars, classify-cli, registry-cli and status
- **Committed in:** 30148dd

**2. [Rule 1 - Test asserting old behaviour] classify-leak.test.ts CR-01 single-message case**
- **Found during:** plan-level verification
- **Issue:** the test still expected `last_error` null after a message Ollama failed on alone. WR-03 changes that on purpose.
- **Fix:** the test now expects `unclassifiedNotice([pending])`. The no-leak scan over status and logs is unchanged and passes.
- **Files modified:** apps/worker/test/classify-leak.test.ts (not in the plan's files_modified)
- **Verification:** classify-leak.test.ts 6/6
- **Committed in:** 5b08ac7

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 outdated assertion)
**Impact on plan:** both follow directly from the new outcome field and the new notice. No scope creep and no schema change. The `sift classify` skip line and README text were left to 03-22. The stderr line that 03-17 added still passes (classify-cli.test.ts).

## TDD Notes (Task 2, tdd="true")

- **RED:** commit `8b97cb2` holds the tests and a name-only scaffold: constants, an empty `messageFailures` map, and a `canaryChat` stub that is never called. With the scaffold, the tree typechecks and the tests fail on their assertions rather than on imports. Command: `pnpm vitest run apps/worker/test/classify-run.test.ts --reporter=default --reporter=junit --outputFile.junit=.vitest/red-03-18.xml -t "is held back"`, exit 1. 6 tests failed. The ordering test and the unclassifiedNotice unit test passed, which is expected because Task 1 already implemented that behaviour. `gsd check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed, junit). Target: "a message Ollama keeps failing on is held back (WR-03, CR-01) > after MESSAGE_FAILURE_PASSES (3) passes no chat and no preflight is spent on it; after 2 it is still sent (WR-03)". **Semantic assessment:** the target ran and failed on its first planned assertion, `runtime.messageFailures.get(id)` expected 1 and got undefined, because the scaffold has no failure memory. There was no load, fixture or syntax fault. The evidence record was moved to the scratchpad and not committed.
- **GREEN:** `f8a81bf`. The Task 2 verify passed 78/78 (classify-run, status, registry-cli) and typecheck was clean.
- **Mutation:** with the canary check bypassed, "a runner that fails every prompt fails the canary" failed. The file was restored from a scratch copy and `git diff --quiet` passed.
- **REFACTOR:** none.

## Issues Encountered

- In the wider sweep run with `--maxWorkers=3` and live containers, two tests hit their timeouts: the D-19 two-mailbox batch test (30 s) and the injection bound test (60 s). Both files pass when run alone (33/33). This is the known host-load pattern (bug-189). These two tests were not changed by this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 03-22 can make `sift classify` name a held-back or unclassified message by id and explain the notice in the README. The text it should reference is `unclassifiedNotice` / `NOTICE_MAX_IDS`.
- 03-19 (owner checkpoint) can weigh this hold-back state, which has no schema change and is per process, against ending such a message as a review decision (llm_error).
- Verification: the plan's six-file set passed (124 tests, after the leak update). The wider sweep covered all classify-*, mailbox-batch, supervisor, user-facing-text, worker-*, registry-cli, packages/db and prompt-version: 718/720, and the 2 timeouts pass alone. `pnpm typecheck` passed. `pnpm lint` showed 1 warning, which was already there in an unrelated file. `git diff --quiet packages/core/test/prompt-version.test.ts` passed.

## Self-Check: PASSED

- All 10 modified files exist on disk.
- Commits 30148dd, 8b97cb2, f8a81bf and 5b08ac7 are ancestors of HEAD. `check evaluation-scope --plan 03-18 --commits-only` resolves all four.
- Task 1 and Task 2 acceptance greps all match: unclassifiedNotice and NOTICE_MAX_IDS = 3 exports; `unclassifiedNotice(outcome.unclassified)` in mailbox-batch.ts; NOTICE_PREVIEW; `notice` in status.ts; MESSAGE_FAILURE_PASSES = 3; `messageFailures` in ClassifyRuntime, createClassifyRuntime, draftFor and classifyCandidates; canaryChat and CANARY_USER exports; WR-03 in classify-run.test.ts; "could not be classified" in status.test.ts and registry-cli.test.ts.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*
