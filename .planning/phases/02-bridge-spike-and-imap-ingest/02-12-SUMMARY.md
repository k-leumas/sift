---
phase: 02-bridge-spike-and-imap-ingest
plan: 12
subsystem: database
tags: [postgres, advisory-lock, pg-pool, drizzle, mailbox-status, vitest]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-03 mailbox_status columns and checks (connecting, needs_attention, held/approved counts, backfill progress); 02-06 scoped helpers and the ingest use-cases"
provides:
  - "withIngestLock(db, mailboxId, fn): per-mailbox session advisory lock on hashtextextended(id, INGEST_LOCK_SEED), returns { acquired: false } at once when held elsewhere"
  - "IngestSession.run: scoped transactions on the lock's own connection; not re-entrant (IngestSessionBusyError)"
  - "Internal runScoped(orm, mailboxId, fn, options) shared by withMailbox and IngestSession.run"
  - "recordConnecting, recordNeedsAttention, readHold, recordBackfillProgress; recordSyncSuccess clears held and approved counts"
affects: [02-13 worker integration, 02-16 CLI backfill, mailbox resume command, status display]

actuals:
  tokens: 8300
  tasks: 2
  commits: 3
plan_head_before: 1bd95692edceed60f99ca452ecce72ada4049bca
plan_head_after: 185fd94bb0b8ae28b41d518adca8e04c2e521abf

tech-stack:
  added: []
  patterns:
    - "Session advisory lock on a dedicated pooled client, with the holder's transactions on that same client (one connection per active mailbox)"
    - "Checked-out pg clients get their own 'error' listener; a dead or possibly-locked client is released with an error so the pool discards it"
    - "Owner-facing status text carries only counts and a command, never message content"

key-files:
  created:
    - packages/db/src/lock.ts
    - packages/db/test/lock.test.ts
    - packages/db/test/status.test.ts
  modified:
    - packages/db/src/scope.ts
    - packages/db/src/status.ts
    - packages/db/src/index.ts
    - packages/db/test/scope.test.ts

key-decisions:
  - "Ingest lock key is hashtextextended(mailbox_id, 815309), a 64-bit key in the single-bigint advisory space, so two mailboxes practically never share a lock"
  - "withIngestLock error precedence: fn's own error wins; if fn succeeded but the connection died or the unlock failed, that error is thrown; the client is then discarded, never pooled"
  - "A plain fn throw with a clean unlock returns the healthy connection to the pool (no reconnect per failed batch)"
  - "withIngestLock waits for a session.run that fn left in flight before unlocking and releasing, so a client never returns to the pool inside an open transaction"
  - "recordNeedsAttention clears approved_new_count, so every new hold needs a fresh owner approval; held/done/total must be non-negative integers"

patterns-established:
  - "Two AppDb instances with distinct application_name stand in for two processes; the admin counts and terminates backends by application_name"
  - "No-SQL proof for a refused call: spy on pg.Client.prototype.query and compare call counts around the refusal"

requirements-completed: [ING-01, ING-02]

coverage:
  - id: D1
    description: "A second process gets { acquired: false } at once while another holds the mailbox's ingest lock; other mailboxes are unaffected; after release it acquires"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "packages/db/test/lock.test.ts#a second process gets acquired false at once while the first holds the lock; other mailboxes are unaffected"
        status: pass
    human_judgment: false
  - id: D2
    description: "The holder does all session work on one connection, and nested or overlapping session.run calls are refused before any SQL"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "packages/db/test/lock.test.ts#writes through a scoped transaction on the lock connection: one backend for the holder"
        status: pass
      - kind: integration
        ref: "packages/db/test/lock.test.ts#rejects a run nested inside another run with IngestSessionBusyError and sends no SQL"
        status: pass
      - kind: integration
        ref: "packages/db/test/lock.test.ts#rejects an overlapping run; the first still commits and a later run works"
        status: pass
    human_judgment: false
  - id: D3
    description: "The lock never wedges a mailbox: freed on fn throw and on a terminated backend; dead clients discarded; closed session and invalid id refused"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "packages/db/test/lock.test.ts#withIngestLock never wedges a mailbox (6 cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "connecting, needs_attention (held count + resume hint), readHold, backfill progress, and a 25-pair status transition matrix that never violates the mailbox_status checks"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "packages/db/test/status.test.ts (30 cases)"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-10-05
status: complete
---

# Phase 2 Plan 12: Ingest Lock and Mailbox Status Summary

**A per-mailbox `pg_try_advisory_lock(hashtextextended(id, 815309))` held on one pooled connection that also runs the holder's scoped transactions (not re-entrant). It survives fn throws and terminated backends. New status use-cases cover connecting, needs_attention with the `sift mailbox resume <slug>` hint, and first-backfill progress.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-10-05T20:34:45Z
- **Completed:** 2026-10-05T20:45:54Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `withIngestLock` keeps the worker and a CLI backfill in another process from ingesting the same mailbox at once (D-03). When the lock is busy it returns `{ acquired: false }` at once without calling fn.
- `IngestSession.run` runs scoped transactions on the lock's own connection, so one active mailbox uses exactly one connection (Pitfall 9). The test counts the holder's backends in `pg_stat_activity` and gets 1. A mutation that moved run onto the pool counted 2, so the test catches that regression.
- `run` is not re-entrant. A nested or overlapping call rejects with `IngestSessionBusyError` and sends no SQL. The test proves this with a spy on `pg.Client.prototype.query`.
- On failure: a throwing fn rethrows and leaves the lock free. A terminated holder backend frees the lock within 1 s, its `withIngestLock` rejects, and the dead client is discarded. Before this change, a terminated backend raised uncaught `'error'` events.
- Status: `recordConnecting` (D-34), `recordNeedsAttention` (D-26; last_error holds only the count and the resume command), `readHold`, and `recordBackfillProgress` (D-75). `recordSyncSuccess` now clears the held and approved counts. A 25-pair transition matrix passes with no check violations.

## Task Commits

1. **Task 1 (tracer): two processes contend for one mailbox's ingest lock; the holder writes through a scoped transaction on the same connection.** `030364a` (feat)
2. **Task 2 (TDD): lock release on failure, and the connecting / needs_attention status use-cases.** RED `3e515b8` (test), GREEN `185fd94` (feat). No refactor commit was needed.

**Plan metadata:** see the `docs(02-12)` commit that adds this file.

## TDD Gate Compliance

- **RED (`3e515b8`):** `pnpm vitest run packages/db/test/lock.test.ts packages/db/test/status.test.ts` exited 1, with 33 of 40 failing on assertions. In lock.test.ts the failures were the terminated-backend cases (leaked client: `totalCount` 1, unlock error instead of fn's error) and the in-flight-run case. All 30 status cases failed. Value-returning scaffolding for the four new status exports sat in the working tree and was never committed. The run also logged 4 unhandled errors: the uncaught client `'error'` events this task fixes. `gsd-tools check tdd-red-evidence` gave `RED_EVIDENCE_OK` (target_test_failed) for both test files. Four lock cases (fn throw, closed session, invalid id, plus the Task 1 cases) passed against the tracer, as expected, because Task 1 already gave that behaviour.
- **GREEN (`185fd94`):** 40 of 40 pass. With the scope and isolation suites, 94 of 94 pass.

## Files Created/Modified

- `packages/db/src/lock.ts`: `INGEST_LOCK_SEED`, `IngestSessionBusyError`, `IngestSession`, `IngestLockResult`, `withIngestLock` (client error listener, error precedence, discard rules, waits for in-flight runs)
- `packages/db/src/scope.ts`: internal `runScoped` extracted from `withMailbox` (no behaviour change) and an `isMailboxId` helper. Neither is exported from index.ts.
- `packages/db/src/status.ts`: `recordConnecting`, `recordNeedsAttention`, `readHold` (+ `HoldStatus`), `recordBackfillProgress`. `recordSyncSuccess` now clears the held and approved counts.
- `packages/db/src/index.ts`: exports the lock API and the new status functions. Neither the client nor the pool is exported.
- `packages/db/test/lock.test.ts`: 10 cases, using two app-role AppDb instances
- `packages/db/test/status.test.ts`: 30 cases, including the it.each transition matrix
- `packages/db/test/scope.test.ts`: the export-surface list

## Decisions Made

See `key-decisions` in the frontmatter. The main judgement calls were these three. fn's error wins over a release error. A plain fn throw keeps the healthy connection in the pool. The holder waits for any run fn left in flight, so a client never goes back to the pool inside a transaction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Wait for a session.run left in flight before unlocking**
- **Found during:** Task 2
- **Issue:** If fn returned without awaiting a run, the unlock could interleave with the run's transaction, and the client could go back to the pool mid-transaction.
- **Fix:** `holdSession` waits for the in-flight run to settle (`Promise.allSettled`, so the caller's own rejection handling is untouched) before withIngestLock unlocks and releases.
- **Files modified:** packages/db/src/lock.ts. Test: "waits for a run fn left in flight before unlocking and releasing the client"
- **Committed in:** 3e515b8 (test), 185fd94 (fix)

**2. [Rule 2 - Correctness] Discard a client whose unlock returned false or whose lock query failed**
- **Found during:** Task 2
- **Issue:** The plan only covered an unlock that throws. A connection whose lock state is unknown must not go back to the pool either.
- **Fix:** If `pg_advisory_unlock` returns false, that counts as an unlock error. A failure before the lock query answered also discards the client.
- **Files modified:** packages/db/src/lock.ts
- **Committed in:** 185fd94

**3. [Rule 2 - Validation] Count arguments validated**
- **Found during:** Task 2
- **Issue:** A non-integer or negative held/done/total count would reach a CHECK-constrained table or the owner-facing text.
- **Fix:** These now throw `TypeError` before any SQL. `recordNeedsAttention` also sets `last_seen_at` from its `at` parameter, matching `recordConnecting`.
- **Files modified:** packages/db/src/status.ts
- **Committed in:** 185fd94

---

**Total deviations:** 3 auto-fixed (all Rule 2). **Impact:** These are small hardening steps inside the planned files. Scope and the API are unchanged, apart from the extra `HoldStatus` type export.

## Issues Encountered

- The acceptance grep `grep -n 'pg_try_advisory_lock(hashtextextended($1, $2))'` does not match under macOS BSD grep, which treats the mid-pattern `$` as an anchor. It matches with `grep -F` or with escaped `\$`. The source line is exactly as the plan specifies.
- **Intermittent full-suite failure identified:** `apps/worker/test/bridge-probe.test.ts > sift bridge probe --label-test (SPK-01, D-11) > reports a missing target UID, before any write` failed once with `sift bridge probe: unreachable: Unexpected close`, a Dovecot connection closed under full-suite load. It passed on the rerun (42 files, 779 tests). It is unrelated to this plan's files.
- Commits went straight to `main`, as intended for this phase (branching_strategy none).

## Known Stubs

None. The RED scaffolding was never committed, and the GREEN implementation replaced it.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 02-13 (worker integration) and 02-16 (CLI backfill) can wrap each mailbox's ingest in `withIngestLock` and pass `session.run` to the 02-10 engine's store. One rule follows from the busy guard: await each commit before starting the next run.
- The `sift mailbox resume <slug>` command (a later plan) can read `readHold` and set `approvedNewCount` through `mailboxStatus.upsert`.

## Self-Check: PASSED

- All 7 files listed above exist.
- Commits 030364a, 3e515b8 and 185fd94 are present in `git log`.
- Plan verification passed: `pnpm vitest run packages/db` (12 files, 217 tests), `pnpm typecheck` exit 0, `pnpm lint` exit 0, and `pnpm test` 779/779 on the rerun.

---
*Phase: 02-bridge-spike-and-imap-ingest*
*Completed: 2026-10-05*
