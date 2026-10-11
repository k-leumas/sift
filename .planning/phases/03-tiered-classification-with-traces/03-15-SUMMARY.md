---
phase: 03-tiered-classification-with-traces
plan: 15
subsystem: database
tags: [postgres, volume-valve, d-26, cr-03, mailbox-status, vitest]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "classification pass after ingest with a single post-pass status write (03-09, D-14)"
  - phase: 02
    provides: "fail-closed volume valve: needs_attention, sift mailbox resume, approved_new_count (D-26)"
provides:
  - "recordIngestSynced(scope, at) in packages/db/src/status.ts, exported from @sift/db"
  - "runBatch spends the resume approval and records last_sync_at inside the ingest lock for synced/resynced outcomes when classification is on"
  - "CR-03 batch test: resume, a classification pass that throws, then a capped next batch"
affects: [03-verification, gsd-secure-phase, 03-16, 03-17, 03-18]

actuals:
  tokens: 3000
  tasks: 2
  commits: 2
plan_head_before: 1eb98d0132c32e3bb6d02a8c63dc0dde3aee6098
plan_head_after: 9a503fc0a51a57a9f26b815f8f3612d449fa5069

tech-stack:
  added: []
  patterns:
    - "Valve counts and last_sync_at are written with the ingest, in the lock; state and last_error stay with the single post-pass write (D-14)"
    - "A status helper that clears held_new_count must also leave needs_attention (mailbox_status_held_check)"

key-files:
  created: []
  modified:
    - packages/db/src/status.ts
    - packages/db/src/index.ts
    - apps/worker/src/runtime/mailbox-batch.ts
    - apps/worker/test/classify-batch.test.ts
    - packages/db/test/status.test.ts
    - packages/db/test/scope.test.ts

key-decisions:
  - "CR-03: with classification on, recordIngestSynced runs in the synced/resynced arm inside withIngestLock, so a one-time resume approval is spent by the batch whose ingest used it, whatever the pass does afterwards"
  - "recordIngestSynced changes state only for needs_attention (to ok, last_error null); every other state and last_error is left for the post-pass write (D-14)"
  - "Without a classification runtime, runBatch still writes recordSyncSuccess in the lock (Phase 2 unchanged); the post-pass switch and onBatchError are untouched"

patterns-established:
  - "Batch-level fail-closed tests snapshot mailbox_status from inside the failing pass (a preflight override) to show the state a killed worker leaves behind"

requirements-completed: [CLS-06]

coverage:
  - id: D1
    description: "After sift mailbox resume, a batch whose classification pass throws a non-infra error ends with approved/held null, state error and last_sync_at at the ingest time; the status read mid-pass already shows the approval spent; the next batch ingests with the cap and is held again"
    requirement: CLS-06
    verification:
      - kind: e2e
        ref: "apps/worker/test/classify-batch.test.ts#spends the resume approval with the ingest when the pass throws, so the next batch uses the cap (CR-03)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Phase 2 behaviour without a classification runtime is unchanged (recordSyncSuccess in the lock)"
    verification:
      - kind: integration
        ref: "apps/worker/test/mailbox-batch.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "recordIngestSynced state rules: needs_attention -> ok with last_error cleared; error and connecting kept with last_error; counts cleared; missing row created; backfill progress untouched"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "packages/db/test/status.test.ts#recordIngestSynced (CR-03, D-26)"
        status: pass
    human_judgment: false
  - id: D4
    description: "@sift/db export surface lists recordIngestSynced"
    verification:
      - kind: unit
        ref: "packages/db/test/scope.test.ts#exports exactly the scoped API and nothing that yields a pool, client or orm"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 15: Resume approval spent with the ingest (CR-03) Summary

**`recordIngestSynced` clears the volume valve's held/approved counts and records last_sync_at inside the ingest lock, with the ingest, so a classification pass that throws or a worker killed mid-pass can no longer leave a one-time `sift mailbox resume` approval usable. The next batch ingests with `new_mail_cap`, not approved + cap.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-11T04:23:59Z
- **Completed:** 2026-10-11T04:29:28Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- `recordIngestSynced(scope, at = new Date())` (packages/db/src/status.ts): reads the row, then upserts lastSyncAt/lastSeenAt = at with both counts null. When the stored state is `needs_attention` it also sets state `ok` and clears last_error, because the hold is gone and `mailbox_status_held_check` forbids needs_attention without a held count. Every other state and last_error stays for the post-pass write (D-14). The function is exported from `@sift/db`.
- runBatch's synced/resynced arm now always makes one `session.run` call inside `withIngestLock`: `recordSyncSuccess` with no classification runtime, `recordIngestSynced` otherwise. The comment and the `createMailboxCallbacks` doc comment now describe the split between the in-lock write and the post-pass write.
- CR-03 batch test (cap 1): five held mails, then resume, then a preflight override that snapshots status and throws. Five consecutive per-message failures rethrow a plain `Error`. The snapshot shows approved/held null, state ok and last_sync_at set. The final row shows state error with the same last_sync_at. Two more mails then put the mailbox back in needs_attention with held 2 (the cap, not 6).
- Five `recordIngestSynced (CR-03, D-26)` unit cases. The export-surface list gained the new name.

## Task Commits

1. **Task 1 (tracer): spend the resume approval with the ingest, inside the lock** - `c98a604` (fix)
2. **Task 2: recordIngestSynced unit cases and the export surface** - `9a503fc` (test)

## Files Created/Modified

- `packages/db/src/status.ts` - recordIngestSynced with its CR-03/D-14 doc comment
- `packages/db/src/index.ts` - exports recordIngestSynced
- `apps/worker/src/runtime/mailbox-batch.ts` - in-lock recordIngestSynced when classification is on; comments updated
- `apps/worker/test/classify-batch.test.ts` - CR-03 resume-then-throw test in 'volume hold (D-26)'
- `packages/db/test/status.test.ts` - 'recordIngestSynced (CR-03, D-26)' describe (5 cases, own slugs)
- `packages/db/test/scope.test.ts` - export-surface list gains 'recordIngestSynced'

## Mutation proofs

- **CR-03 batch test bites:** I restored the old `if (classify === undefined)` in-lock write from a scratch copy and ran `pnpm vitest run apps/worker/test/classify-batch.test.ts -t "CR-03"`. It failed with `AssertionError: expected 5 to be null` (the mid-pass snapshot's approved_new_count). I restored the file with `command cp -f` and `diff -q` confirmed it identical.
- **Unit cases bite:** I removed the needs_attention -> ok branch from recordIngestSynced. Two cases ('releases a resumed hold', 'never touches backfill progress') then failed with 23514 `mailbox_status_held_check`. I restored the file the same way.

## TDD Gate Compliance

Task 2 (`tdd="true"`, workflow tdd_mode off):

- **RED:** Before Task 2's edits, `packages/db/test/scope.test.ts > @sift/db export surface > exports exactly the scoped API...` failed with `+ "recordIngestSynced"`, because Task 1 had added the export. The five status.test.ts cases cover behaviour Task 1 already shipped (the plan put the implementation in the tracer), so they were not run before it existed. The mutation above shows they fail without the needs_attention rule.
- **GREEN:** `9a503fc`. status.test.ts and scope.test.ts pass (79 tests) and `pnpm typecheck` exits 0.
- **REFACTOR:** none needed.

## Decisions Made

- The in-lock write is one `session.run` with a ternary, as the plan specified. The post-pass `recordSyncSuccess`/`recordSyncError({ syncedAt })` writes and onBatchError are unchanged. Clearing the already-cleared counts a second time is harmless.
- The export is placed alphabetically in index.ts (between recordDisabled and recordMailboxSeen), following the file's sorted order, not literally next to recordSyncSuccess.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Between the two task commits, `packages/db/test/scope.test.ts`'s export-surface test failed by design. Task 1 added the export and Task 2 updated the list, as the plan split them. It passes from `9a503fc` on.
- Commits land on `main`. The orchestrator dispatched this as a sequential executor on the main working tree (`git.branching_strategy: none`).
- `pnpm lint` exits 0 with the one pre-existing warning in apps/worker/test/node-version.test.ts (noTemplateCurlyInString), which is unrelated.

## Verification

- `pnpm vitest run apps/worker/test/classify-batch.test.ts apps/worker/test/mailbox-batch.test.ts packages/db/test/status.test.ts packages/db/test/scope.test.ts`: 4 files, 116 tests passed
- `pnpm typecheck`: exit 0. `pnpm lint`: exit 0.
- Acceptance greps all match: `export async function recordIngestSynced` in status.ts; `recordIngestSynced` in index.ts, mailbox-batch.ts, status.test.ts and scope.test.ts; `CR-03` in classify-batch.test.ts.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap 3 of 03-VERIFICATION.md is closed. The in-lock clear of held/approved and last_sync_at is in place, and the resume-then-throw test asserts approved_new_count null and a capped next batch. T-03-55 and T-03-56 are mitigated as planned. Ready for 03-16.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*

## Self-Check: PASSED
