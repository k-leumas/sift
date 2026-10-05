---
phase: 02-bridge-spike-and-imap-ingest
plan: 05
subsystem: worker-runtime
tags: [supervisor, scheduler, abortsignal, vitest, fake-timers]

requires:
  - phase: 01
    provides: createSupervisor (D-49..D-53 tick loop, backoff, skip-not-queue, bounded drain)
provides:
  - "Supervisor.nudge(mailboxId): boolean (D-28)"
  - "SupervisorDeps.runBatch(mailbox, signal: AbortSignal), aborted at the start of stop() (D-04, P1 D-53)"
affects: [02-10 chunked ingest abort-resume, 02-13 worker integration, future IDLE listener / sync command]

actuals:
  tokens: 2834
  tasks: 2
  commits: 3
plan_head_before: 7abdff275a27a206aa842b5f59cdad995f4f5bff
plan_head_after: 6feb0c9105cce7083999d618019f2e938aacff59

tech-stack:
  added: []
  patterns:
    - "One AbortController per supervisor, aborted first in stop(); batches observe shutdown through the signal"
    - "In-memory `nudged` Set: a nudge during a run becomes one follow-up run after a success only"

key-files:
  created: []
  modified:
    - apps/worker/src/runtime/supervisor.ts
    - apps/worker/test/supervisor.test.ts

key-decisions:
  - "nudge() on a running mailbox only flags it; the follow-up is scheduled from runMailbox's success path, so D-50 never-overlaps holds and nudge never bypasses the running guard"
  - "A failed run deletes the pending nudge before computing backoff, so a nudge cannot cut D-51 backoff during a Bridge outage"
  - "nudge returns false when stopped or when the mailbox has no schedule state (unknown, disabled, left the registry, or before start)"

patterns-established:
  - "Fake-timer tests of 'runs at once' after a timer callback allow 1 ms: a 0 ms setTimeout created during a tick fires 1 ms later"

requirements-completed: [ING-03]

coverage:
  - id: D1
    description: "nudge(mailboxId) runs an idle scheduled mailbox now through the normal tick loop, then returns to the poll interval measured from that run"
    requirement: ING-03
    verification:
      - kind: unit
        ref: "apps/worker/test/supervisor.test.ts#nudge (D-28) runs an idle mailbox now, then returns to the interval measured from that run"
        status: pass
    human_judgment: false
  - id: D2
    description: "A nudge while the mailbox runs never starts a concurrent run; exactly one follow-up after a success; a failed run drops the nudge and keeps backoff"
    requirement: ING-03
    verification:
      - kind: unit
        ref: "apps/worker/test/supervisor.test.ts#a nudge while running never overlaps; one more run starts right after a success"
        status: pass
      - kind: unit
        ref: "apps/worker/test/supervisor.test.ts#a failed run drops a pending nudge and keeps its backoff (D-51)"
        status: pass
    human_judgment: false
  - id: D3
    description: "nudge returns false and starts nothing for unknown or disabled mailboxes, before start and after stop()"
    requirement: ING-03
    verification:
      - kind: unit
        ref: "apps/worker/test/supervisor.test.ts#returns false and runs nothing for an unknown or disabled mailbox, or after stop"
        status: pass
    human_judgment: false
  - id: D4
    description: "runBatch receives an AbortSignal that is aborted the moment stop() is called, before the drain; a cooperating batch lets stop() report drained true"
    requirement: ING-03
    verification:
      - kind: unit
        ref: "apps/worker/test/supervisor.test.ts#runBatch gets a signal that aborts as soon as stop() is called, before the drain"
        status: pass
      - kind: unit
        ref: "apps/worker/test/supervisor.test.ts#a batch that stops on abort lets stop() drain"
        status: pass
      - kind: other
        ref: "pnpm typecheck (mailbox-batch.ts one-parameter runBatch still assignable)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every pre-existing supervisor and run-until-stopped test still passes; full suite green"
    verification:
      - kind: unit
        ref: "pnpm vitest run apps/worker/test/supervisor.test.ts apps/worker/test/run-until-stopped.test.ts (40 pass)"
        status: pass
      - kind: integration
        ref: "pnpm test (31 files, 477 tests pass)"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-10-05
status: complete
---

# Phase 2 Plan 05: Supervisor nudge() and shutdown AbortSignal Summary

**The supervisor gains `nudge(mailboxId)`, which makes a mailbox due now without ever overlapping a running batch or cutting its backoff, and passes `runBatch` a shutdown AbortSignal that `stop()` aborts before it drains.**

## Performance

- **Duration:** about 10 min
- **Started:** 2026-10-05T18:11:30Z
- **Completed:** 2026-10-05T18:20:27Z
- **Tasks:** 2 (1 tracer, 1 TDD)
- **Files modified:** 2

## Accomplishments

- `Supervisor.nudge(mailboxId): boolean` (D-28). For an idle mailbox it sets `nextRunAt = now()` and calls `wakeAt`, so the run goes through the normal tick loop. For a running mailbox it records the id in an in-memory `nudged` Set and starts nothing. runMailbox's success path turns that flag into exactly one immediate follow-up run. The failure path drops the flag and keeps the D-51 backoff. It returns false after stop(), and for mailboxes with no schedule state (unknown, disabled, removed, or before start).
- `SupervisorDeps.runBatch(mailbox, signal: AbortSignal)`. Each supervisor has one `AbortController`, and `stop()` calls `shutdown.abort()` before it clears timers and starts the bounded drain. Chunked ingest (02-10, 02-13) can therefore stop between chunks. `mailbox-batch.ts` is unchanged and still type-checks.
- Seven new fake-timer tests: the nudge cadence, no overlap with a single follow-up, nudge dropped on failure with backoff kept, refusal cases, the signal aborted before the drain, and a cooperating batch draining.

## Task Commits

1. **Task 1: Tracer - nudge() makes an idle mailbox run now** - `fca1446` (feat)
2. **Task 2: Shutdown AbortSignal for runBatch; nudge limits**
   - RED - `b2d3687` (test)
   - GREEN - `6feb0c9` (feat)
   - REFACTOR: none needed

The tracer feedback gate (end-of-phase mode, automated-only verify) re-ran `pnpm vitest run apps/worker/test/supervisor.test.ts`: 30/30 passed before expansion.

All commits went to `main`, as intended for this phase (`branching_strategy: none`, sequential executor).

## TDD Gate Compliance

- RED `test(02-05)` b2d3687 precedes GREEN `feat(02-05)` 6feb0c9.
- RED evidence: `pnpm vitest run apps/worker/test/supervisor.test.ts --reporter=tap-flat` exited 1. The target test "runBatch gets a signal that aborts as soon as stop() is called, before the drain" failed with `expected undefined to be false`, and "a batch that stops on abort lets stop() drain" failed with `expected false to be true`. 33 tests passed. `check tdd-red-evidence` returned `RED_EVIDENCE_OK`. Vitest's TAP output has no node-test `# tests/# pass/# fail` trailer, so those three lines were appended from the run's own ok/not-ok counts (35/33/2) before the check.
- The nudge overlap, failure and refusal cases were already green at RED. The plan builds that logic in Task 1 (step 2), and Task 2 only adds tests for it.

## Files Created/Modified

- `apps/worker/src/runtime/supervisor.ts` - nudge(), the `nudged` Set, nudge handling in the success and failure paths, the shutdown AbortController, the `runBatch(entry, shutdown.signal)` call, and `shutdown.abort()` first in stop().
- `apps/worker/test/supervisor.test.ts` - the harness passes the signal to batch bodies and records it per slug; new `nudge (D-28)` and `shutdown signal (D-04, P1 D-53)` describe blocks.

## Decisions Made

- The nudge follow-up is applied only on success, and a failure deletes it (Cursor MEDIUM review concern, T-02-19).
- A disabled-then-re-enabled mailbox whose old run is still in flight is not handled specially. A nudge flagged during that window lands on the old state object and is lost. This is harmless: the new state is already due, and nothing calls nudge in Phase 2.

## Deviations from Plan

None to the production code.

Test-only adjustment: the overlap test asserts that the follow-up run starts within 1 ms of the first run ending, not at exactly 20 000 ms. Under fake timers, a 0 ms `setTimeout` created inside a timer callback fires 1 ms later. The behaviour is unchanged: the follow-up is immediate, and the next run is measured from it. The cooperating-drain test also checks that the batch ended because of the abort and recorded no error, so it cannot pass for the wrong reason (a batch that throws also drains).

**Total deviations:** 0 auto-fixed. **Impact:** none.

## Issues Encountered

- During debugging, a chained `rm` hung on an interactive prompt (`rm` is aliased to `rm -i` in the agent shell), so the edit after it did not run. It was re-applied with `command rm -f`. Logged in buglog (bug-137) and in the cerebrum Do-Not-Repeat list.

## Threat Flags

None. The change is in-process scheduling only. T-02-19 (nudges hammering Bridge) is mitigated as planned, and the tests above cover it.

## Known Stubs

None. Nothing calls `nudge()` in Phase 2 by design (D-28, D-76 deferred). The signal is consumed by 02-10 and 02-13.

## User Setup Required

None.

## Next Phase Readiness

- 02-13 can pass `shutdown.signal` through `mailbox-batch.ts` into the chunked ingest engine (02-10).
- A future IDLE listener or `sift mailbox sync` can call `supervisor.nudge(id)`.

---
*Phase: 02-bridge-spike-and-imap-ingest*
*Completed: 2026-10-05*

## Self-Check: PASSED
