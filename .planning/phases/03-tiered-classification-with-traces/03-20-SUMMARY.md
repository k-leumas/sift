---
phase: 03-tiered-classification-with-traces
plan: 20
subsystem: classification
tags: [ollama, llm-tier, decision-trace, review, cr-01, d-16]

requires:
  - phase: 03-19
    provides: "owner decision option-review; llm_error in REVIEW_REASONS, ATTEMPT_FAILURE_CODES, LlmVerdict and the DB CHECK (migration 0011)"
  - phase: 03-17
    provides: "re-probe after a chat server_error/timeout, OLLAMA_MESSAGE_FAILURES_PER_PASS budget"
  - phase: 03-18
    provides: "MESSAGE_FAILURE_PASSES, ClassifyRuntime.messageFailures, canaryChat, the unclassified notice"
  - phase: 03-22
    provides: "sift classify skip line and the README mailbox-list bullet"
provides:
  - "llmErrorDetail(code, status): fixed attempt text with the code and HTTP status only"
  - "LlmTierResult infra carries attempts (the failed call as an llm_error attempt) and responseModel"
  - "worker writes review llm_error for a message Ollama fails on alone in MESSAGE_FAILURE_PASSES passes after a successful canary (replaces the 03-18 hold-back)"
  - "tests: outages, the per-pass budget and an always-failing runner never become llm_error; the timeout path; sift classify never writes it"
affects: [phase-04-apply, trc-05-trace-cli, verify-work-03]

actuals:
  tokens: 11067
  tasks: 2
  commits: 4
plan_head_before: 4b16bbb4ddb2ea56e60c8a70fffc6b4d77e9a0c9
plan_head_after: b462ca13761bfd96f85a69eec8240bc6767b384f

tech-stack:
  added: []
  patterns:
    - "An infra tier result keeps the failed call as an attempt (raw null, fixed detail), so a later terminal decision can carry a replayable trace"
    - "llmSpanContext(ctx, preflight, prompt, email, responseModel) builds the llm span request fields for both the success path and llm_error"

key-files:
  created: []
  modified:
    - apps/worker/src/classify/llm-tier.ts
    - apps/worker/src/classify/run.ts
    - apps/worker/test/classify-run.test.ts
    - apps/worker/test/classify-llm-tier.test.ts
    - apps/worker/test/classify-cli.test.ts
    - apps/worker/test/support/classify-harness.ts
    - README.md

key-decisions:
  - "03-20: llm_error is written only when ctx.decidedBy is worker; sift classify keeps skipping such a message even if a runtime were shared across runs (defence in depth for the must-have; the CLI already builds a runtime per run)"
  - "03-20: messageFailures is set before the llm_error draft is returned and removed only after the decision commits, so a failed write counts again next pass and goes through the normal path"
  - "03-20: the llm_error message stays in state.ollamaFailed (it uses up the per-pass budget) and so in the done outcome's ollamaFailed, but not in unclassified; the outcome doc says so"
  - "03-20: MESSAGE_HELD_BACK_LOG is replaced by MESSAGE_LLM_ERROR_LOG ('...; held for review (llm_error)')"

patterns-established:
  - "Terminal review for a per-message Ollama failure: re-probe ok + MESSAGE_FAILURE_PASSES passes + canary ok -> decide({ llm: { verdict: { kind: 'review', reason: 'llm_error', attempts } } })"

requirements-completed: [CLS-06, TRC-01]

coverage:
  - id: D1
    description: "A message Ollama fails on alone in three passes of one worker gets exactly one review llm_error decision on the third pass, after a successful canary; tier llm, category and confidence null, decided_by worker; replayable; no longer pending, in the notice or in messageFailures"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#after MESSAGE_FAILURE_PASSES passes a message Ollama fails on alone is held for review with reason llm_error (CR-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The failed call is stored as an attempt with raw null, metrics null and validation { ok: false, code: llm_error, detail: llmErrorDetail(code, status) }; Ollama's error text never reaches the attempt"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#the failed call is recorded with fixed text, never Ollama error text (CR-01, T-03-71) (3 tests)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#infra on attempt 1 / infra on attempt 2 (new result shape)"
        status: pass
    human_judgment: false
  - id: D3
    description: "An outage never becomes llm_error: a failed re-probe over four passes, a failed canary (every chat failing) over four passes, and failures past the per-pass budget write no decision"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#over four passes a 500 whose re-probe always fails writes no decision and is never counted (D-16)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#with every chat failing, three messages over four passes never become llm_error (D-16)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a runner that fails every prompt fails the canary: an outage, and the message is not held for review (CR-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A timeout confined to one message reaches llm_error on the third pass with detail 'Ollama failed on this request (timeout)' and replays"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a timeout confined to one message is held for review with llm_error on the third pass (CR-01)"
        status: pass
    human_judgment: false
  - id: D5
    description: "sift classify never writes llm_error: three runs with a runtime per run, and three runs sharing one runtime, only print the skip line"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#three separate runs (a runtime per run) only skip it: no llm_error decision (CR-01)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#even a runtime shared by three runs never writes llm_error from sift classify (CR-01)"
        status: pass
    human_judgment: false
  - id: D6
    description: "README mailbox-list bullet says that after three such passes, if Ollama answers a mail-free test request, the message is held for review with the reason llm_error, and that an outage never puts a message in review"
    requirement: CLS-06
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts (README pins still pass)"
        status: pass
    human_judgment: true
    rationale: "Whether the README wording is clear to the owner is a reading judgment; no test pins this sentence"

duration: 16min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 20: llm_error review decision for a message Ollama keeps failing on Summary

**The worker now holds a message for review with reason `llm_error` when Ollama fails on that message alone in three passes (healthy re-probe each time) and then answers a mail-free canary chat. The decision's llm span holds the failed call as an attempt with fixed text (`Ollama failed on this request (server_error, HTTP 500)` or `(timeout)`), never Ollama's error text, and the trace replays. Outages, failures past the per-pass budget and a runner that fails every prompt still never become a decision. `sift classify` never writes `llm_error` (CR-01, D-16 as amended in 03-19, option-review).**

## Performance

- **Duration:** 16 min
- **Started:** 2026-10-11T08:39:22Z
- **Completed:** 2026-10-11T08:55:30Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `llm-tier.ts`: new `llmErrorDetail(code, status)`. When `client.chat` returns infra, `runLlmTier` now adds an attempt (`raw`, `thinking`, `done_reason` and `metrics` null; validation `llm_error` with the fixed detail) and returns `{ kind: 'infra', code, status, detail, attempts, responseModel }`. There are still at most two attempts.
- `run.ts`: the 03-18 held-back check and its "not sent again until the worker restarts" log line are gone. In the message-specific branch, when the new count reaches `MESSAGE_FAILURE_PASSES` (and the caller is the worker) and `canaryChat` succeeds, `draftFor` returns `decide({ exact, llm: { verdict: { kind: 'review', reason: 'llm_error', attempts: result.attempts }, context }, threshold })` with `promptVersionId` set to the prompt id. It logs `MESSAGE_LLM_ERROR_LOG` with the slug, id and pass count. A failing canary is still an outage. A message-specific failure now takes `result.attempts.length` calls off the budget (it was 1). The llm span's request fields are built by a shared `llmSpanContext` helper.
- Tests: the 03-18 "not sent again" test and its restart test are replaced. The new main test checks the three-pass `llm_error` decision field by field, then a fourth pass with nothing pending and no request. A new restart test checks that the count starts from zero in a fresh runtime. Outage, always-500, timeout and CLI cases were added (Task 2). The tier tests now use the new infra shape and add the 500-on-first-call and 500-on-retry cases.
- `classify-harness.ts`: `answeredContent` returns null for a hang response, so a trace from a timeout can be replayed.
- README line 91: the restart clause now says the message is held for review with the reason `llm_error`, and that an outage never puts a message in review.

## Task Commits

1. **Task 1 (tracer): three passes of a 500 end in a replayable review llm_error decision** - `9cde6da` (feat)
2. **Task 2 RED: outages never become llm_error; timeout path; CLI never writes it** - `0866f08` (test)
3. **Task 2 GREEN: replay a timeout-derived llm_error trace** - `056bced` (feat)
4. **Task 2 follow-up: shared-runtime CLI case runs three times, as its title says** - `b462ca1` (test)

**Plan metadata:** the SUMMARY commit and the state commit that follow.

## Files Created/Modified

- `apps/worker/src/classify/llm-tier.ts` - llmErrorDetail; infra results carry the attempts and responseModel
- `apps/worker/src/classify/run.ts` - llm_error branch after the canary; hold-back removed; llmSpanContext helper; MESSAGE_LLM_ERROR_LOG
- `apps/worker/test/classify-run.test.ts` - three-pass llm_error test; restart and exact-rule tests adjusted; D-16 outage, always-500 and timeout tests
- `apps/worker/test/classify-llm-tier.test.ts` - infra cases on the new shape; llmErrorDetail and llm_error attempt cases
- `apps/worker/test/classify-cli.test.ts` - two cases: sift classify never writes llm_error
- `apps/worker/test/support/classify-harness.ts` - answeredContent handles a hang response
- `README.md` - line 91 bullet: held for review with the reason llm_error

## Decisions Made

- **Worker-only guard.** The `llm_error` branch also requires `ctx.decidedBy === 'worker'`. The CLI already builds one runtime per run, so a count never reaches 3 there. The guard makes "sift classify never writes llm_error" hold even if a runtime were shared, and the shared-runtime CLI test (mutation-checked) pins it.
- **Count kept until the commit.** `messageFailures` is set before the draft is returned and deleted only after `recordDecision` commits (the existing classifyCandidates code). If that write fails, the next pass sees a count at or above the limit and goes through the normal path again, as the plan describes.
- **The llm_error message stays in `ollamaFailed`.** It uses up the per-pass budget, as the plan says, so it also appears in the done outcome's `ollamaFailed`, while `unclassified` (the notice) leaves it out. Only `unclassified` feeds the mailbox notice. The outcome's doc comment now says this.
- **Tracer gate:** interactive run, `human_verify_mode` end-of-phase, automated-only `<verify>`. I re-ran the verify; it passed, so no checkpoint was needed.

## TDD Gate Compliance

- **RED** `0866f08`: target `only a failure confined to one message becomes llm_error (CR-01, D-16) > a timeout confined to one message is held for review with llm_error on the third pass (CR-01)`. I captured a JUnit report (`--reporter=junit -t ...`), and `check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`, exit 1). Semantic assessment: the target ran. Every assertion before the replay passed: the decision was written, with the llm_error detail `Ollama failed on this request (timeout)`. It then failed inside `expectReplayableDecision`, because `answeredContent` called `JSON.parse` on the missing body of the hang response. That is the planned failure ("a timeout trace that cannot be replayed"), not a load or fixture fault. The record was moved to the scratchpad and not committed.
- The other three Task 2 tests already passed at RED, because the Task 1 tracer implemented the behaviour. I checked them with one mutation each of run.ts (restored from a scratch copy each time):
  - counting a failure whose re-probe failed makes the re-probe test fail;
  - ignoring a failed canary makes the always-500 test fail;
  - removing the worker-only guard makes the shared-runtime CLI test fail.
- **GREEN** `056bced`: the harness change. 4 files, 86/86.
- **REFACTOR:** none.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test asserting old behaviour] exact-rule test relied on the 03-18 hold-back**
- **Found during:** Task 1
- **Issue:** `an exact rule added after the message is held back ...` ran three failing passes first. Under option-review, the third pass now decides the message (llm_error), so the exact rule could no longer decide it.
- **Fix:** It now runs MESSAGE_FAILURE_PASSES - 1 passes ("an exact rule added after two failures decides it with no chat and forgets it"). It checks the same thing: an exact rule decides the message with no chat and clears its count.
- **Files modified:** apps/worker/test/classify-run.test.ts
- **Committed in:** 9cde6da

**2. [Rule 1 - Replaced test kept in a useful form] restart follow-up**
- **Found during:** Task 1
- **Issue:** The plan replaces the 03-18 restart follow-up. Its subject, the in-memory count, still matters.
- **Fix:** It is now `a fresh runtime (worker restart) counts the passes from zero again`: two failing passes, a restart, one more pass, and the count is 1 with no canary and no decision.
- **Files modified:** apps/worker/test/classify-run.test.ts
- **Committed in:** 9cde6da

**3. [Rule 2 - Missing guard for a must-have] worker-only llm_error**
- **Found during:** Task 1
- **Issue:** "sift classify never writes llm_error" depended only on the CLI building a runtime per run.
- **Fix:** The terminal branch requires `ctx.decidedBy === 'worker'`. The extra CLI test with a shared runtime pins it.
- **Files modified:** apps/worker/src/classify/run.ts, apps/worker/test/classify-cli.test.ts
- **Committed in:** 9cde6da, 0866f08

**4. [Rule 1 - Test wording] shared-runtime CLI loop count**
- **Found during:** final verification
- **Issue:** The test title said three runs, but the loop ran four.
- **Fix:** The loop runs three times. The count reaches the limit on the third run, so the mutation still bites; I re-checked this.
- **Committed in:** b462ca1

---

**Total deviations:** 4 auto-fixed (3 test adjustments, 1 defensive guard)
**Impact on plan:** No scope change. All four keep the plan's must-haves true and the tests honest.

## Issues Encountered

- `pnpm lint` reports one warning, in apps/worker/test/node-version.test.ts (noTemplateCurlyInString). It predates this plan and lint exits 0.

## Verification

- `pnpm vitest run` of classify-run, classify-llm-tier, classify-cli, classify-leak, classify-trace, classify-batch and user-facing-text: 7 files, 244/244 pass
- `pnpm typecheck`: exit 0
- `pnpm lint`: exit 0 (the 1 pre-existing warning)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- With option-review, every ingested message now ends labelled or held for review. A message Ollama keeps failing on alone gets a review `llm_error` decision with a replayable trace. An outage still leaves mail pending (03-VERIFICATION gap 1, item 2).
- The README `sift classify` paragraph (line 249) still says such a message is skipped with a stderr line, which remains true for the CLI.
- This was the last open plan in phase 03; phase verification can run next.

## Self-Check: PASSED

- FOUND: apps/worker/src/classify/llm-tier.ts, apps/worker/src/classify/run.ts, apps/worker/test/classify-run.test.ts, apps/worker/test/classify-llm-tier.test.ts, apps/worker/test/classify-cli.test.ts, apps/worker/test/support/classify-harness.ts, README.md
- FOUND commits: 9cde6da, 0866f08, 056bced, b462ca1 (evaluation-scope resolved them as this plan's commits)

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*
