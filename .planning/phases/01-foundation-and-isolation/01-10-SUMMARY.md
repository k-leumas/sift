---
phase: 01-foundation-and-isolation
plan: 10
subsystem: worker
tags: [worker, supervisor, scheduler, backoff, heartbeat, pino, postgres, rls, vitest-fake-timers]

requires:
  - phase: 01-04
    provides: loadConfig, applyEnvOverrides, checkMailboxEnv, secretValues, createLogger, redactText
  - phase: 01-07
    provides: createAppDb, withMailbox (requireActive), readRegistry, recordMailboxSeen/SyncSuccess/SyncError/Disabled, MailboxDisabledError
  - phase: 01-09
    provides: applyConfig (tests align the registry with the test config)
provides:
  - "`sift worker`: config -> password_env check -> sift_app pool -> supervisor -> signal-driven drain and exit 0"
  - "createSupervisor: 15 s ticks, one async task per enabled due mailbox, skip-not-queue, capped backoff, disable transitions, bounded drain"
  - "computeBackoff / BACKOFF_CAP_MS (900000)"
  - "createMailboxCallbacks: Phase 1 no-op batch writing mailbox_status through withMailbox(..., { requireActive: true })"
  - "createHeartbeat / defaultHeartbeatFile (SIFT_HEARTBEAT_FILE, default <tmpdir>/sift/heartbeat)"
  - "waitForShutdownSignal (first SIGTERM/SIGINT)"
affects: [01-11 worker startup guards, 01-12 compose healthcheck and stop_grace_period, phase 02 IMAP ingest batch]

actuals:
  tokens: 9110
  tasks: 2
  commits: 3
plan_head_before: e7ec33c0adec00c0d5a40657eb0550c2f8982065
plan_head_after: f53d0fa25f94776451038b5828bd5751ddde4997

tech-stack:
  added: []
  patterns:
    - "Supervisor takes all I/O as injected deps (readRegistry, runBatch, onBatchError, onMailboxStopped, heartbeat, log, now, random), so scheduling is tested with vitest fake timers"
    - "Worker logs go through pino to io.stdout via a { write } destination, keeping CommandIO testable"
    - "Supervisor logs error name/code only; messages are logged only through an injected redact function"

key-files:
  created:
    - apps/worker/src/commands/worker.ts
    - apps/worker/src/runtime/supervisor.ts
    - apps/worker/src/runtime/backoff.ts
    - apps/worker/src/runtime/mailbox-batch.ts
    - apps/worker/src/runtime/heartbeat.ts
    - apps/worker/src/runtime/shutdown.ts
    - apps/worker/test/worker.test.ts
    - apps/worker/test/supervisor.test.ts
  modified: []

key-decisions:
  - "A successful run schedules the next one from the run's start time, not its completion, so 15 s ticks do not stretch the 60 s interval to 75 s"
  - "In-progress tracking is keyed by mailbox id separately from schedule state, so a disable/re-enable during a long run still cannot overlap it"
  - "SupervisorDeps gained an optional redact(text); the worker passes redactText with the mailbox secrets and the database URL"
  - "Heartbeat writes a temp file and renames it into place so a healthcheck never reads a partial file"

patterns-established:
  - "Phase 2 replaces only the body of runBatch (between recordMailboxSeen and recordSyncSuccess); scheduling is pinned by supervisor.test.ts"

requirements-completed: [FND-01, FND-02]

coverage:
  - id: D1
    description: "sift worker starts against Postgres as sift_app, records ok status with last_seen_at/last_sync_at for every mailbox, writes the heartbeat and exits 0 on SIGTERM with JSON-only stdout"
    requirement: FND-01
    verification:
      - kind: integration
        ref: "apps/worker/test/worker.test.ts#starts, records status, stops cleanly"
        status: pass
    human_judgment: false
  - id: D2
    description: "A missing password_env variable produces exactly one log line naming the variable and mailbox, exit 1, and no database connection attempt"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "apps/worker/test/worker.test.ts#missing env fails fast"
        status: pass
    human_judgment: false
  - id: D3
    description: "Supervisor contract: first-tick start, 15 s ticks, no overlap with skip logging, independent failure, capped exponential backoff with reset, disable/re-enable, new mailbox pickup, registry-failure handling, redacted error logs, bounded drain"
    requirement: FND-01
    verification:
      - kind: unit
        ref: "apps/worker/test/supervisor.test.ts (14 tests)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 10: Worker Process and Supervisor Summary

**`sift worker` runs as sift_app with a dependency-injected supervisor: 15 s registry ticks, one non-overlapping task per enabled mailbox, 15-minute-capped jittered backoff, disable transitions, a heartbeat file and a 20 s bounded drain on SIGTERM/SIGINT. The Phase 1 no-op batch writes mailbox_status through `withMailbox(..., { requireActive: true })`.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-10-04T06:46:48Z
- **Completed:** 2026-10-04T06:54:30Z
- **Tasks:** 2
- **Files modified:** 8 (all new)

## Accomplishments

- `sift worker` startup order is config, then `applyEnvOverrides`, then the D-35 `checkMailboxEnv`, then `SIFT_DATABASE_URL`, `createAppDb` and the supervisor. With a missing password it logs one JSON line and exits 1 before any connection.
- The supervisor ticks immediately and then every 15 s. Each tick rereads the registry and touches the heartbeat only after a successful read. Each enabled mailbox that is due starts as its own task. A mailbox whose last run is still going is skipped, not queued.
- Each mailbox fails on its own. The failing one gets `state='error'` with a redacted `last_error` (via `recordSyncError`) and backs off by `interval * 2^failures` with ±20% jitter, capped at 900000 ms. Its next success resets it to the plain interval.
- When a mailbox is disabled while the worker runs, it is stopped once and its status becomes `disabled`. Mailboxes that are already disabled are never started. A re-enabled mailbox runs again on the next tick.
- On SIGTERM or SIGINT the worker stops scheduling and waits up to 20 s for in-flight work. It then closes the pool, logs `stopped` and exits 0.

## Task Commits

1. **Task 1: Tracer: `sift worker` end to end.** `c73456d` (feat). The tracer gate re-ran `<verify>` after formatting, and it passed.
2. **Task 2: Supervisor semantics (TDD)**
   - RED `dbeffa4` (test). It failed for the right reasons: 4 behavior tests (no overlap, independent failure, backoff growth, disable) failed against the Task 1 supervisor, and the other 10 passed.
   - GREEN `f53d0fa` (feat). All 14 tests pass. No refactor commit was needed.

**Plan metadata:** see the final docs commit.

## Files Created/Modified

- `apps/worker/src/commands/worker.ts`: startup sequence, supervisor wiring and signal-driven shutdown.
- `apps/worker/src/runtime/supervisor.ts`: `createSupervisor`, `SUPERVISOR_TICK_MS` (15000), `SHUTDOWN_TIMEOUT_MS` (20000), `MailboxEntry`, `SupervisorDeps`.
- `apps/worker/src/runtime/backoff.ts`: `computeBackoff` and `BACKOFF_CAP_MS` (900000).
- `apps/worker/src/runtime/mailbox-batch.ts`: `createMailboxCallbacks(db, secrets)` over the scoped API.
- `apps/worker/src/runtime/heartbeat.ts`: `createHeartbeat` (atomic temp+rename) and `defaultHeartbeatFile`.
- `apps/worker/src/runtime/shutdown.ts`: `waitForShutdownSignal`.
- `apps/worker/test/worker.test.ts`: spawns the real CLI against a fresh Postgres clone. Covers the happy path and the fail-fast path.
- `apps/worker/test/supervisor.test.ts`: 14 tests with fake timers and stub deps.

## Decisions Made

- After a success, the next run is scheduled from the run's start time. If it were scheduled from completion, 15 s tick granularity would push a 60 s interval to 75 s.
- Whether a mailbox has a run in progress is tracked by mailbox id in its own map, apart from schedule state. Disabling and re-enabling a mailbox drops its schedule state, but this still cannot start a second, overlapping run.
- The supervisor logs only the error name and code by default. It logs a message only when `redact` is injected. The worker injects `redactText` with the mailbox secrets and the database URL.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Success schedules from run start, not completion**
- **Found during:** Task 1, designing the scheduling
- **Issue:** The plan says `nextRunAt = now() + pollIntervalMs` on success. With 15 s ticks, the run completes a few ms after the tick, so the mailbox would only be due on the tick after next. That stretches D-52's 60 s interval to 75 s.
- **Fix:** On success, `nextRunAt = startedAt + pollIntervalMs`. On failure, the delay is still counted from failure time (`now() + computeBackoff(...)`), as planned.
- **Files modified:** apps/worker/src/runtime/supervisor.ts
- **Verification:** supervisor.test.ts "ticks every 15 s and runs each mailbox every poll interval" expects runs at [0, 60000, 120000]
- **Committed in:** c73456d, f53d0fa

**2. [Rule 2 - Missing critical] Redacted error logging in the supervisor (T-01-40)**
- **Found during:** Task 1
- **Issue:** The supervisor logs batch, registry and heartbeat failures, but it has no access to secrets. An error message could quote a mailbox password or a URL.
- **Fix:** Added an optional `redact?: (text) => string` to `SupervisorDeps`. Without it, logs carry the error `name` and `code` only. The worker passes `redactText(text, [...secrets, url])`.
- **Files modified:** apps/worker/src/runtime/supervisor.ts, apps/worker/src/commands/worker.ts
- **Verification:** supervisor.test.ts "logs error messages only through redact". worker.test.ts asserts that the output never contains the app URL or the passwords.
- **Committed in:** c73456d, f53d0fa

**3. [Rule 2 - Missing critical] Atomic heartbeat write**
- **Found during:** Task 1
- **Issue:** A plain `writeFile` can leave an empty or partial file for a healthcheck to read.
- **Fix:** The heartbeat writes `<file>.<pid>.tmp` and then renames it over the heartbeat file.
- **Files modified:** apps/worker/src/runtime/heartbeat.ts
- **Committed in:** c73456d

**4. [Rule 3 - Blocking] Typed the test log mocks**
- **Found during:** Task 2 GREEN, `pnpm typecheck`
- **Issue:** Bare `vi.fn()` mocks (`Mock<Procedure | Constructable>`) are not assignable to `SupervisorLog` (TS2322).
- **Fix:** Changed them to `vi.fn<LogFn>()` with `Mock<LogFn>`.
- **Files modified:** apps/worker/test/supervisor.test.ts
- **Committed in:** f53d0fa

**Additional coverage beyond the plan's bullets:** an `onBatchError` that throws is logged and swallowed, a mailbox removed from the registry is dropped without a disable write, and the fail-fast path writes no heartbeat. The worker also logs a missing `SIFT_DATABASE_URL` as one error line and exits 1, instead of throwing.

---

**Total deviations:** 4 auto-fixed (1 bug, 2 missing critical, 1 blocking)
**Impact on plan:** All four are needed for correctness or for secret hygiene. Interfaces stay compatible: `redact` is optional. No scope creep.

## Issues Encountered

- If a batch hangs past the 20 s drain timeout, `db.close()` (`pg.Pool.end()`) waits for the checked-out client, so the process may not exit until Compose's `stop_grace_period` kills it. The Phase 1 batch is two short upserts, so this cannot happen today. Phase 2's IMAP batch should carry its own timeouts or an abort signal. `cli.ts` sets `process.exitCode` and never calls `process.exit`, so a forced exit would need a change there.

## Known Stubs

- `runBatch` is the intentional Phase 1 no-op batch (D-49). It only writes `mailbox_status`. Phase 2 adds IMAP ingest between `recordMailboxSeen` and `recordSyncSuccess`. This is by design and does not block this plan's goal.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 01-11 can add `connectWithRetry`, `assertUnprivilegedRole` and `checkDrift` after `createAppDb` and before `createSupervisor` in `worker.ts`. `worker.test.ts` already applies the registry from the same config, so the drift check should pass.
- 01-12's Compose healthcheck can check the age of `SIFT_HEARTBEAT_FILE` (default `/tmp/sift/heartbeat` in the container). `stop_grace_period` should exceed `SHUTDOWN_TIMEOUT_MS` (20 s).
- Full suite: 188/188 passing. `pnpm typecheck` and `pnpm lint` exit 0. No worker processes left running.

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED
