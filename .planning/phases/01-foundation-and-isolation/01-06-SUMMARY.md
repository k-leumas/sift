---
phase: 01-foundation-and-isolation
plan: 06
subsystem: database
tags: [postgres, rls, isolation, vitest, pg]

requires:
  - phase: 01-foundation-and-isolation (01-03)
    provides: scoped schema with FORCE RLS + mailbox_isolation policy, freshDatabase/connect/seed test harness
provides:
  - D-48 two-mailbox isolation test on raw sift_app connections (ISO-03, success criterion 4)
  - D-70 owner FORCE-RLS delete test proving owner work needs and honours app.mailbox_id
affects: [mailbox purge, data migrations, withMailbox, ingest, decision trace]

actuals:
  tokens: 4040
  tasks: 3
  commits: 3
plan_head_before: 10fdd0c73e1af0bc89adc13319ef546e1318c6f6
plan_head_after: 398d968e2043a5df8edd2f0bf15b6d55c9f64cb0

tech-stack:
  added: []
  patterns:
    - "inScope(client, mailboxId, fn): begin + transaction-local set_config + raw SQL + commit/rollback"
    - "Isolation tests iterate SCOPED_TABLE_NAMES and compare sorted id sets against superuser ground truth"
    - "Child-first DELETE order (label, decision, message, rest) so RESTRICT FKs never mask RLS"

key-files:
  created:
    - packages/db/test/isolation.test.ts
    - packages/db/test/owner-rls.test.ts
  modified: []

key-decisions:
  - "mailbox_status has no id column, so its id-set comparisons use mailbox_id as the id"
  - "Non-UUID and upper-case UUID edges are asserted on every scoped table, not just message"
  - "Append-only 42501 on an unfiltered UPDATE/DELETE proves the privilege check: RLS alone would return 0 rows, not an error"

patterns-established:
  - "DB isolation assertions use err.code (SQLSTATE) only, never message text"

requirements-completed: [ISO-03, ISO-02, ISO-01]

coverage:
  - id: D1
    description: "Under A, raw unfiltered sift_app reads return only A's rows (≥1) on every scoped table; update/delete aimed at B affect 0 rows and B is unchanged"
    requirement: ISO-03
    verification:
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#reads under A return only A, in every scoped table"
        status: pass
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#update and delete aimed at B affect 0 rows and leave B unchanged"
        status: pass
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#an unfiltered update under A touches exactly A's rows"
        status: pass
    human_judgment: false
  - id: D2
    description: "No scope (fresh connection) and stale scope (reused connection, current_setting '') read nothing and inserts fail 42501"
    requirement: ISO-02
    verification:
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#a fresh connection with no mailbox set reads nothing and cannot insert"
        status: pass
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#a reused connection after a committed scope reads nothing, without error"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cross-mailbox writes fail: insert for B 42501, move A row to B 42501, child row to B's message 23503, append-only update/delete 42501, NULL mailbox_id 42501 (sift_app) / 23502 (superuser)"
    requirement: ISO-01
    verification:
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#cross-mailbox writes and scope edges (D-48)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Encoding and empty edges: non-UUID setting 22P02, upper-case UUID scopes to A, empty mailbox C reads 0 rows"
    requirement: ISO-01
    verification:
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#a non-UUID app.mailbox_id errors with 22P02 and never returns rows"
        status: pass
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#the upper-case spelling of A's UUID scopes to A (uuid, not text, equality)"
        status: pass
      - kind: integration
        ref: "packages/db/test/isolation.test.ts#an empty mailbox C reads 0 rows from every scoped table"
        status: pass
    human_judgment: false
  - id: D5
    description: "sift_owner DELETE with no app.mailbox_id removes nothing; under A removes all of A and none of B (D-70)"
    requirement: ISO-03
    verification:
      - kind: integration
        ref: "packages/db/test/owner-rls.test.ts#owner DELETE under FORCE RLS (D-70)"
        status: pass
    human_judgment: false

duration: 3min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 06: Mailbox Isolation and Owner RLS Tests Summary

**Every D-48 case proven on raw sift_app pg clients across all 7 scoped tables (wrong, missing, stale, malformed and upper-case scope; cross-mailbox insert/move/child FK; append-only privileges; NULL mailbox_id), plus the D-70 sift_owner FORCE-RLS delete test**

## Performance

- **Duration:** 3 min
- **Started:** 2026-10-04T06:12:26Z
- **Completed:** 2026-10-04T06:15:53Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- `isolation.test.ts` (14 tests) seeds mailboxes iso-a/iso-b (2 rows per id-keyed table each) and an empty iso-c. Every statement runs on a raw sift_app client with no `WHERE mailbox_id`, iterating `SCOPED_TABLE_NAMES`, so a table added later is covered automatically.
- Under A: reads return exactly A's id set. Update/delete aimed at B report rowCount 0 and B's superuser snapshot (ids + updated_at) is unchanged. An unfiltered `update message` touches exactly A's 2 rows.
- Failure codes asserted per table: insert for B and moving an A row to B give 42501, a child row pointing at B's message gives 23503, non-UUID scope gives 22P02, append-only UPDATE/DELETE give 42501, and NULL mailbox_id gives 42501 under RLS and 23502 as superuser.
- Scope edges: a fresh connection and a reused connection after a committed scope both read 0 rows (`current_setting` = `''`). The upper-case UUID scopes to A. Empty mailbox C reads 0 rows.
- `owner-rls.test.ts` (3 tests): an unscoped sift_owner `DELETE FROM` on every scoped table removes 0 rows. Under A it removes all of A's rows, including from the append-only tables, and B's counts are unchanged. A's mailbox registry row stays.

## Task Commits

1. **Task 1: Tracer - reads under A, no-scope reads** - `7ed7f50` (test)
2. **Task 2: Remaining D-48 cases and isolation edges** - `e367e78` (test)
3. **Task 3: Owner FORCE-RLS delete test (D-70)** - `398d968` (test)

**Plan metadata:** see the docs(01-06) commit

## Files Created/Modified
- `packages/db/test/isolation.test.ts` - D-48 isolation suite on raw sift_app connections (D-46)
- `packages/db/test/owner-rls.test.ts` - D-70 owner FORCE-RLS DELETE test

## Decisions Made
- mailbox_status is keyed by mailbox_id, so `selectSql` uses `mailbox_id as id` for it and `select id, mailbox_id from <table>` for every other table.
- The non-UUID (22P02) and upper-case UUID cases run on every scoped table, not just message. This is a stronger form of the planned assertion.
- The append-only test uses an unfiltered UPDATE/DELETE under A. RLS alone would give 0 rows and no error, so a 42501 can only come from the privilege check (D-40).

## Deviations from Plan

None. The plan ran as written. The extra per-table coverage for the 22P02 and upper-case cases, and the seed sanity test, go beyond the plan without changing it.

## Issues Encountered
- Biome flagged `seededA` as unused after Task 1, because the tests that use it land in Task 2. It is now used in the seed sanity test. Biome's formatter reflowed one call in Task 2. Both were fixed before their commits, so no hook failed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ISO-01/02/03 have automated DB-level proof that runs in CI job `check` (01-05) through `pnpm test`. The full suite now passes 108/108.
- The later `sift mailbox purge` can rely on the owner-under-app.mailbox_id path proven by D-70.

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED
