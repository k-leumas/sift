---
phase: 03-tiered-classification-with-traces
plan: 17
subsystem: classification
tags: [ollama, classification, resilience, cls-06, cr-01, d-16, vitest]

# Dependency graph
requires:
  - phase: 03-15
    provides: recordIngestSynced inside the ingest lock, so a pass that ends done or throws leaves the valve and last_sync_at right
  - phase: 03-16
    provides: current llm-output.ts and db classify.ts (no change needed here)
provides:
  - "MESSAGE_FAILURE_CODES, OLLAMA_MESSAGE_FAILURES_PER_PASS (2), OLLAMA_MESSAGE_FAILURE_LOG in apps/worker/src/classify/run.ts"
  - "draftFor re-runs the mail-free preflight after a chat server_error or timeout; healthy -> skip only that message for the pass"
  - "PassState.ollamaFailed and ClassifyOutcome done.ollamaFailed (ids skipped this pass)"
  - "sift classify prints the skipped message id, code and HTTP status on stderr"
  - "AI-SPEC error table / E5 / E6 / section 7 and a D-16 clarification note in 03-CONTEXT.md"
affects: [03-18, 03-19, 03-20, classification, mailbox-status, verification-gap-1]

actuals:
  tokens: 10990
  tasks: 2
  commits: 3
plan_head_before: e60b79769f4a848a736504d4f63992a3e433a18a
plan_head_after: 2aab59f5f64e6e7ca70151800f531a9030ad9df4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tell a message-confined Ollama failure from an outage with a mail-free re-probe and a small per-pass budget"
    - "RED for a tdd task layered on a tracer: plan-base implementation plus name-only constants as an uncommitted scaffold"

key-files:
  created: []
  modified:
    - apps/worker/src/classify/run.ts
    - apps/worker/src/commands/classify.ts
    - apps/worker/test/classify-run.test.ts
    - apps/worker/test/classify-batch.test.ts
    - apps/worker/test/classify-leak.test.ts
    - apps/worker/test/classify-cli.test.ts
    - apps/worker/test/classify-control-chars.test.ts
    - .planning/phases/03-tiered-classification-with-traces/03-AI-SPEC.md
    - .planning/phases/03-tiered-classification-with-traces/03-CONTEXT.md

key-decisions:
  - "A chat server_error or timeout followed by a healthy preflight skips only that message for the pass (no decision, stays pending); at most OLLAMA_MESSAGE_FAILURES_PER_PASS = 2 per pass, the next one is an outage (CR-01, D-16 clarification)"
  - "A failed re-probe, a third such failure, or any other infra code stays an outage exactly as D-16 says; the outage carries the chat result's code and owner message"
  - "A skipped message costs one call against LLM_CALLS_PER_TICK; its warn line holds slug, id, code and status only, never Ollama's error text"
  - "sift classify shows a skipped message on stderr as 'message <id>: Ollama failed on this message (<code>, HTTP <status>); skipped' and exits 0 like any other skipped message"

patterns-established:
  - "Message-confined infra failure: re-probe with the mail-free preflight before treating a chat 5xx/timeout as an outage"

requirements-completed: [CLS-06]

coverage:
  - id: D1
    description: "A 500 confined to one message skips only it; older LLM-bound mail is decided in the same pass and runBatch resolves on consecutive batches (status ok, no backoff)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a 500 confined to one message skips only it; older LLM-bound mail is decided in the same pass (CR-01)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#skips only that message: older mail is decided and runBatch resolves, on consecutive batches"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failed re-probe or a failure past the per-pass budget is an outage exactly as D-16 (infra, owner message, backoff, exact rules still decide)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a 500 the re-probe confirms as an outage stops LLM work for the pass; exact rules keep deciding"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#past OLLAMA_MESSAGE_FAILURES_PER_PASS (2) a further 500 in the same pass is an outage"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#the third message Ollama fails on in a pass is the outage: a fixed message, never Ollama's error text"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#an unreachable chat result is still an outage, with no re-probe (CR-01)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Timeout, single-message and shutdown-during-re-probe edges"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a timeout on one message is skipped after a healthy re-probe; the older mail is decided (CR-01)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a pass whose only LLM-bound message fails alone ends done with that id (CR-01)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#a shutdown during the re-probe ends the pass aborted with no decision (CR-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The skip warn line and status never carry mail text or Ollama's error text (T-03-62)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-leak.test.ts#a 500 on the only message, Ollama otherwise healthy: skipped by id, error body out of status and logs (CR-01)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-leak.test.ts#a 500 on every message: the third is the outage, Ollama's error body stays out of status and logs"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#no pass logged a subject, body, model reason or Ollama error text"
        status: pass
    human_judgment: false
  - id: D5
    description: "sift classify names a message Ollama failed on alone on stderr"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#a message Ollama fails on alone is skipped with its id on stderr, not an outage (CR-01)"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-16 clarification (03-CONTEXT.md note) and the AI-SPEC rows/rubrics describing the re-probe rule"
    verification:
      - kind: other
        ref: "grep -n 'Clarified by gap closure 03-17' 03-CONTEXT.md; grep -c 'gap closure 03-17' 03-AI-SPEC.md (6)"
        status: pass
    human_judgment: true
    rationale: "Changes how a locked decision (D-16) reads; the owner has to accept or object at the 03-19 checkpoint"

# Metrics
duration: 14min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 17: Message-confined Ollama failures Summary

**A chat 5xx or timeout now triggers a mail-free preflight re-probe: if Ollama answers, only that message is skipped for the pass (at most 2 per pass), so one poison email no longer blocks every older message or puts its mailbox and ingest into backoff (CR-01, CLS-06).**

## Performance

- **Duration:** 14 min
- **Started:** 2026-10-11T04:52:59Z
- **Completed:** 2026-10-11T05:07:01Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- `draftFor` (apps/worker/src/classify/run.ts) re-runs `ctx.runtime.preflight` after a chat `server_error` or `timeout`. If the preflight is ok and fewer than `OLLAMA_MESSAGE_FAILURES_PER_PASS` (2) messages have been skipped this pass, it records `{ id, code, status }` in `state.ollamaFailed`, takes one call off `llmCallsLeft`, logs `OLLAMA_MESSAGE_FAILURE_LOG` with slug, id, code and status only, and skips the message. Any other case (another code, budget used, re-probe infra) sets `llmBlocked` from the chat result as before. An aborted re-probe ends the pass `aborted`.
- The `done` outcome gains `ollamaFailed: string[]` and the `classify: pass finished` line gains an `ollamaFailed` count. Because a pass with only message-confined failures ends `done`, runBatch writes status ok and resolves: no ClassifyInfraError, no supervisor backoff, ingest keeps its poll cadence.
- The old head-of-line test ('a 500 on the third call stops LLM work for the pass') was replaced on purpose by three tests: message-specific 500 (older mail decided, two `/api/tags` requests), re-probe-confirmed outage (the old assertions kept), and the per-pass budget (third 500 is the outage, three chat calls).
- Batch-level proof (classify-batch.test.ts): with a fake that answers 500 only for the poison subject, the older mail is decided, runBatch resolves on two consecutive batches, status stays ok, and the second batch makes exactly one more chat call (retried, not blocking). The fixed-message 500 batch test now appends three messages so the third is the outage.
- Edge and leak tests: a 2000 ms client timeout on one message, a pass with a single failing message, a shutdown during the re-probe, an unreachable chat result (no re-probe), and leak runs for one skipped sentinel message (status ok) and three sentinel messages (third = outage).
- 03-AI-SPEC.md error table, E5, E6, the infra-vs-invalid guardrail row and the section 7 "Mailbox stuck in an Ollama error" row now describe the rule (marked "gap closure 03-17", 6 occurrences). 03-CONTEXT.md has the clarification note under D-16. D-16's own text is unchanged.

## Task Commits

1. **Task 1 (tracer): skip a message Ollama fails on alone; older mail decided; runBatch resolves** - `6050d27` (feat)
2. **Task 2 (tdd): timeout, single-message, abort and leak edges** - `ffc9530` (test)
3. **Task 2: design-contract notes (AI-SPEC, D-16 clarification)** - `2aab59f` (docs)

**Plan metadata:** recorded in the SUMMARY and state commits that follow.

## Files Created/Modified

- `apps/worker/src/classify/run.ts` - constants, `PassState.ollamaFailed`, re-probe branch in `draftFor`, `ollamaFailed` on the done outcome and the pass-finished line, module doc bullet
- `apps/worker/src/commands/classify.ts` - stderr line for a message Ollama failed on alone
- `apps/worker/test/classify-run.test.ts` - three replacement tests, four edge tests, `ollamaFailed` in done equality and the log-key allowlist
- `apps/worker/test/classify-batch.test.ts` - poison-message batch test (CR-01); third-failure outage test
- `apps/worker/test/classify-leak.test.ts` - `leakRun` mail count; the 500 case split into skipped and outage
- `apps/worker/test/classify-cli.test.ts` - CLI skipped-message test
- `apps/worker/test/classify-control-chars.test.ts` - `ollamaFailed: []` in two done-outcome equalities
- `.planning/phases/03-tiered-classification-with-traces/03-AI-SPEC.md` - error table, E5, E6, guardrail, section 7
- `.planning/phases/03-tiered-classification-with-traces/03-CONTEXT.md` - D-16 clarification note

## Locked decision changes

**Which locked decision changed:** D-16 is clarified. Its own text is unchanged. Task 2 added this note under D-16 in 03-CONTEXT.md, quoted in full:

> Clarified by gap closure 03-17 (03-VERIFICATION gap 1, review CR-01): a chat HTTP 5xx or timeout after which a fresh mail-free preflight succeeds is a failure of that message, not an outage: no decision is written, the message stays pending and is skipped for that tick, and the tick's other LLM work goes on (at most 2 such messages per tick; one more is an outage). Outages behave exactly as D-16 says.

**What behaves differently:** when a chat call returns HTTP 5xx or times out and the mail-free preflight then succeeds, only that message is skipped for the tick (at most 2 per tick). Before, this stopped the tick's LLM work and put the mailbox, ingest included, into backoff. The tick's other messages are now decided, the mailbox status stays ok, and the skip is logged by message id. `sift classify` prints the id on stderr.

**What does not change:** an outage behaves exactly as D-16 says. An outage is a failed re-probe, a third such failure in a tick, or any other infra code (unreachable, busy, model_missing, rejected, remote_model, model_unsuitable). In those cases no decision is written, the LLM-bound messages stay pending, the tick's LLM work stops, exact-rule decisions are still written, and mailbox_status shows the specific error with backoff. No decision is written for any skipped message.

**Why there was no checkpoint:** the change is reversible: it touches code only, with no schema, trace or stored-data change. It follows the fix direction that 03-VERIFICATION gap 1 recommended. It also serves D-16's own last sentence: "One bad message never stops the others".

**Where the owner can object:** at the 03-19 checkpoint, whose read_first lists this section. It shows this change to the owner next to D-16's terminal-state decision. An objection there (or later) is recorded as a follow-up to revert this plan. Reverting means every chat 5xx or timeout is treated as an outage again.

## Decisions Made

- Per plan: `MESSAGE_FAILURE_CODES = ['server_error', 'timeout']`, budget 2 per pass, one call counted per skip, warn line without `result.detail`.
- The outage after a failed re-probe carries the chat result (for example `failed (HTTP 500)`), not the preflight's code, as the plan specified.
- `sift classify` names the skipped message on stderr and exits 0, the same as for a message whose call throws (see Deviations).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Done-outcome equality in classify-control-chars.test.ts**
- **Found during:** Task 1
- **Issue:** two `toEqual` assertions on the `done` outcome would fail now that it carries `ollamaFailed`.
- **Fix:** added `ollamaFailed: []` to both.
- **Files modified:** apps/worker/test/classify-control-chars.test.ts
- **Verification:** the file passes (part of the 78-test plan verification run).
- **Committed in:** 6050d27

**2. [Rule 2 - Missing critical] sift classify said nothing about why a message was skipped**
- **Found during:** Task 1
- **Issue:** `sift classify` shares `classifyCandidates`, so after the change a message Ollama fails on alone shows only as "1 skipped". Before, the CLI printed the Ollama failure. The owner would have no id and no reason.
- **Fix:** the CLI's log adapter prints `message <id>: Ollama failed on this message (<code>, HTTP <status>); skipped` for `OLLAMA_MESSAGE_FAILURE_LOG`. The line holds id, code and status only. Added a CLI test.
- **Files modified:** apps/worker/src/commands/classify.ts, apps/worker/test/classify-cli.test.ts
- **Verification:** classify-cli.test.ts 30/30. The output scan (no subject, sender, body or reason) still passes.
- **Committed in:** 6050d27

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical)
**Impact on plan:** both follow directly from the planned change. No scope creep, no schema or trace change.

## TDD Notes (Task 2, tdd="true")

- **Ordering:** Task 1 was the tracer and already contained the whole implementation (`feat` 6050d27). So Task 2 has a `test` commit (ffc9530) after that `feat`, and no separate GREEN `feat` commit. `workflow.tdd_mode` is off, so this is advisory.
- **RED:** the four new pass-level tests ran against the plan-base run.ts (e60b797) plus the three new constants (names only, no behaviour). This was an uncommitted scaffold, restored afterwards with a clean `git diff`. Command: `pnpm vitest run apps/worker/test/classify-run.test.ts --reporter=default --reporter=junit --outputFile.junit=.vitest/red-03-17.xml -t "a message Ollama fails on alone: edges"`, exit 1. Three tests failed: timeout, single message, abort during re-probe. The unreachable test passed, which is expected because it guards against a regression. `gsd check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed), with target "a message Ollama fails on alone: edges (CR-01) > a timeout on one message is skipped after a healthy re-probe; the older mail is decided (CR-01)". **Semantic assessment:** the target ran and failed on its first outcome assertion: it expected `done`, and the plan-base code returned `infra timeout`. There was no load, fixture or syntax fault. The record was moved to the scratchpad and never committed.
- **Leak tests on the same scaffold:** both new leak tests failed there and pass on the implementation.
- **Mutation (Task 1):** replacing the re-probe condition with `false` made all five new or rewritten Task 1 tests fail, at both pass and batch level. The file was restored from a scratch copy.
- **GREEN:** Task 2 verify passed: 63/63 across the run, leak, hermetic and CLI files, plus typecheck.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for 03-18. It will add an in-memory per-message failure count across passes and the owner-visible ids, using `state.ollamaFailed` and the `done.ollamaFailed` ids added here.
- The 03-19 owner checkpoint must show the `## Locked decision changes` section above next to D-16's terminal-state decision.
- Verification: `pnpm vitest run` over classify-run, classify-batch, classify-leak, classify-cli, classify-hermetic, worker-classify and classify-control-chars: 78/78. Wider sweep over all classify-* files, user-facing-text and packages/core: 726/726. `pnpm typecheck` 0, `pnpm lint` 0.

## Self-Check: PASSED

- All 9 modified files exist on disk.
- Commits 6050d27, ffc9530 and 2aab59f are ancestors of HEAD. `check evaluation-scope --plan 03-17 --commits-only` resolves all three.
- Task acceptance greps all match: OLLAMA_MESSAGE_FAILURES_PER_PASS = 2, MESSAGE_FAILURE_CODES and OLLAMA_MESSAGE_FAILURE_LOG exports; ollamaFailed in PassState, newPassState and the done outcome; CR-01 in both test files; "a 500 the re-probe confirms as an outage"; "timeoutMs: 2000"; "gap closure 03-17" 6 times; "Clarified by gap closure 03-17".

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*
