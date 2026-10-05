---
phase: 02-bridge-spike-and-imap-ingest
plan: 03
subsystem: database
tags: [postgres, drizzle, rls, migrations, schema, imap-ingest]

requires:
  - phase: 01-foundation
    provides: mailbox-scoped tables with FORCE RLS, the single mailbox_isolation policy, catalog check, isolation suite, scoped API (withMailbox), migrate() with backups and ordering guards
provides:
  - "message: identity_key (UNIQUE per mailbox, check pm:/mid:/hdr:v<n>:<64 hex>), message_id_header, internal_date, sent_at, from_address, from_domain, subject, headers, attachments, size_bytes, eligible_for_classification; no body column (D-06, D-08, D-12, D-82)"
  - "message_location (D-15): UNIQUE (mailbox_id, folder, uidvalidity, uid), generation, removed_at/removed_reason (vanished | superseded), message_location_message_idx and partial message_location_live_idx"
  - "message_body (D-06): one row per message (UNIQUE (mailbox_id, message_id)), source text_plain | text_html | none, truncated, expires_at with message_body_expires_at_idx"
  - "folder_sync: folder (UNIQUE per mailbox), uidvalidity, last_uid, internal_date_watermark, generation, state ok | resyncing with pending_* check, last_resync_*, first-backfill cursor (D-18, D-23..D-25, D-75)"
  - "mailbox_status: states ok/error/disabled/connecting/needs_attention, held_new_count, approved_new_count, backfill_done/backfill_total (D-26, D-34, D-75)"
  - "Migrations 0005_ingest_preflight (refuses non-empty message/folder_sync), 0006_ingest_tables, 0007_ingest_tables_force_grants"
  - "Scope.messageLocation and Scope.messageBody; SCOPED_TABLE_NAMES includes both; types MessageAttachment and ResyncSummary"
  - "MigrationFailedError: migrate() reports the database's own message for a failing migration"
  - "Test support: ScopedRowIds.messageLocationId/messageBodyId; migrate tests derive counts and names from the journal"
affects: [02-05, 02-06, 02-07, 02-08, 02-09, 02-10, 02-13, 02-14, 02-16, 02-19, phase-03, phase-04]

actuals:
  tokens: 39900
  tasks: 2
  commits: 3
plan_head_before: ceb998f9baa758ea88b1810b3a8f26e9322056e1
plan_head_after: fdcaeda987b58f61514dfdcc91c12ae2b365af86

tech-stack:
  added: []
  patterns:
    - "States stay text plus a check constraint; every check that can see a nullable column guards it with `is not null`, because a check accepts NULL"
    - "A migration that must inspect scoped rows loops over mailbox in a DO block with set_config('app.mailbox_id', id, true), then resets it"
    - "Tests derive migration counts, the newest tag and the extra test migration's tag from meta/_journal.json"

key-files:
  created:
    - packages/db/migrations/0005_ingest_preflight.sql
    - packages/db/migrations/0006_ingest_tables.sql
    - packages/db/migrations/0007_ingest_tables_force_grants.sql
    - packages/db/migrations/meta/0005_snapshot.json
    - packages/db/migrations/meta/0006_snapshot.json
    - packages/db/migrations/meta/0007_snapshot.json
  modified:
    - packages/db/src/schema/scoped.ts
    - packages/db/src/schema/index.ts
    - packages/db/src/scope.ts
    - packages/db/src/owner/migrate.ts
    - packages/db/migrations/meta/_journal.json
    - packages/db/test/support/seed.ts
    - packages/db/test/migrate.test.ts
    - packages/db/test/owner-rls.test.ts
    - packages/db/test/isolation.test.ts
    - packages/db/test/scope.test.ts
    - apps/worker/test/setup.test.ts

key-decisions:
  - "02-03: message_location_removed_check adds `removed_reason is not null` to the removed branch; the planned text let removed_at with a NULL reason pass, because `null in (...)` is NULL and a check accepts NULL"
  - "02-03: migrate() wraps a failing migration in MigrationFailedError carrying the driver error's message (drizzle's `Failed query: <whole SQL>` kept as cause), so `sift migrate` prints the 0005 preflight text with the mailbox slug"
  - "02-03: the NULL-check fix edited the committed but unpushed 0006 and its snapshots in place; no persistent database had applied it (dev db `sift` was at 5 migrations)"
  - "02-03: folder_sync_backfill_check uses num_nonnulls(...) in (0, 4) for the all-or-none rule"

patterns-established:
  - "seedScopedRows fills every NOT NULL column with per-call unique values (identity_key, folder, next uid), so repeated seeding of one mailbox works"
  - "Constraint-edge tests run each statement as sift_owner under app.mailbox_id in a transaction that is always rolled back"

requirements-completed: [ING-02, ING-04]

coverage:
  - id: D1
    description: "Ingest tables migrate cleanly behind the 0005 preflight; catalog check clean for message_location and message_body (forced RLS, one policy, grants, triggers, composite FKs)"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "packages/db/test/catalog.test.ts"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#migrate() records every committed migration"
        status: pass
      - kind: other
        ref: "pnpm db:generate prints No schema changes"
        status: pass
    human_judgment: false
  - id: D2
    description: "0005 preflight refuses a database whose message table holds a Phase 1 shaped row: fixed message with the mailbox slug, 5 migrations still recorded, no identity_key column"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#refuses a database whose message table already has rows and applies nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two-mailbox isolation over SCOPED_TABLE_NAMES including message_location and message_body: cross-mailbox insert 42501, reads see only own rows, child rows pointing at another mailbox's message fail the composite FK"
    requirement: ING-04
    verification:
      - kind: integration
        ref: "packages/db/test/isolation.test.ts"
        status: pass
      - kind: integration
        ref: "packages/db/test/owner-rls.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Scope.messageLocation and Scope.messageBody insert/find/update/delete only the scope's rows, even on a connection that bypasses RLS"
    requirement: ING-04
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#application filter without RLS (superuser connection)"
        status: pass
    human_judgment: false
  - id: D5
    description: "UID and UIDVALIDITY 4294967295 round-trip as JS numbers through bigint columns (SPK-04)"
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#round-trips UID and UIDVALIDITY 4294967295 through bigint columns as numbers (SPK-04)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Check constraints enforced by Postgres (23514): removed_at/reason pairing and values, folder_sync pending and backfill rules, mailbox_status needs_attention and backfill pairing, identity_key formats incl. unversioned hdr:, body source; duplicate identity_key gives 23505"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#ingest columns and constraint edges (D-12, D-15, D-18, D-23..D-26, D-34, D-75)"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-10-05
status: complete
---

# Phase 02 Plan 03: Ingest Schema (Identity, Location, Body Cache, Sync State) Summary

**Mailbox-scoped Postgres schema for ingest: message gains a UNIQUE per-mailbox identity_key (pm:/mid:/hdr:v<n>: check) and metadata with no body column, new message_location and message_body tables run under forced RLS, and folder_sync and mailbox_status gain resync, volume-cap and first-backfill state. A 0005 preflight refuses databases that already hold message or folder_sync rows.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-10-05T17:39:03Z
- **Completed:** 2026-10-05T17:50:00Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments

- `scoped.ts`: every column, unique key, check and index from the plan's interfaces block, with doc comments citing D-06, D-08, D-12, D-15, D-17, D-18, D-23..D-26, D-34, D-75 and D-82. UID and UIDVALIDITY columns are `bigint` (mode number).
- Migrations generated in order: 0005 custom preflight (a per-mailbox DO block under `app.mailbox_id` that raises the fixed text), 0006 generated (both tables, their policies, all columns, indexes and the replaced state check), and 0007 custom (FORCE RLS, grants, set_updated_at triggers). `pnpm db:generate` prints "No schema changes".
- `Scope.messageLocation` / `Scope.messageBody` are full ScopedTableApi helpers; `SCOPED_TABLE_NAMES` lists both, so the catalog, isolation, owner-rls and migrate suites cover them automatically.
- Fixture checklist done: seedScopedRows (message, location, body, folder_sync with unique values per call), migrate.test.ts (journal-derived counts and names, new preflight case), owner-rls and isolation CHILD_FIRST orders, isolation insertStatement per table, scope.test.ts required fields. `apps/worker/test/setup.test.ts` also needed its count derived.

## Task Commits

1. **Task 1 (tracer): message identity, location, body cache and sync state migrate, seed and pass the catalog check** - `20be095` (feat)
2. **Task 2 RED: scope, isolation and constraint-edge tests** - `f7a408b` (test)
3. **Task 2 GREEN: Scope.messageLocation / Scope.messageBody plus the removed-check fix** - `fdcaeda` (feat)

Tracer gate: the automated `<verify>` (catalog, migrate, owner-rls, registry tests and `pnpm db:generate` "No schema changes") was re-run end to end and passed before Task 2.

Commits were made directly on `main` (branching_strategy=none for this phase, as the orchestrator instructed).

## TDD Gate Compliance

- RED `f7a408b`: `pnpm vitest run packages/db/test/scope.test.ts packages/db/test/isolation.test.ts` exited 1 with 8 failing cases in scope.test.ts. Seven fail because Scope has no messageLocation/messageBody (the keys assertion, plus the find/update/delete/insert and bigint cases that use the helpers). The eighth, `rejects removed_at without removed_reason`, exposed the NULL-check bug below. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed, target `packages/db/test/scope.test.ts`).
- GREEN `fdcaeda`: all 51 cases pass, then the full suite passes.
- REFACTOR: none needed.
- The isolation and most constraint cases passed in RED by design. The schema itself is the Task 1 tracer, so only the Scope helpers and the bug fix were left for GREEN.

## Files Created/Modified

- `packages/db/src/schema/scoped.ts`: new message columns and checks, messageLocation, messageBody, folderSync and mailboxStatus columns and checks, MessageAttachment and ResyncSummary types
- `packages/db/src/schema/index.ts`: exports and SCOPED_TABLE_NAMES entries
- `packages/db/src/scope.ts`: Scope.messageLocation, Scope.messageBody
- `packages/db/src/owner/migrate.ts`: MigrationFailedError and unwrapping of drizzle's query wrapper
- `packages/db/migrations/0005_ingest_preflight.sql`, `0006_ingest_tables.sql`, `0007_ingest_tables_force_grants.sql` and their snapshots and journal entries
- `packages/db/test/support/seed.ts`: complete rows and new ids
- `packages/db/test/migrate.test.ts`: journal-derived values, preflight case
- `packages/db/test/owner-rls.test.ts`, `packages/db/test/isolation.test.ts`, `packages/db/test/scope.test.ts`: new tables, complete inserts, constraint edges
- `apps/worker/test/setup.test.ts`: migration count from the journal

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] message_location_removed_check accepted removed_at with a NULL removed_reason**
- **Found during:** Task 2 (RED run)
- **Issue:** The planned expression `(removed_at is null and removed_reason is null) or (removed_at is not null and removed_reason in ('vanished','superseded'))` evaluates to NULL when removed_at is set and the reason is NULL, and a check constraint accepts NULL. That breaks the truth "removed_at and removed_reason are set together".
- **Fix:** Added `removed_reason is not null and` to the second branch. Changed in scoped.ts, 0006_ingest_tables.sql and the 0006/0007 snapshots. 0006 was committed in `20be095` but not pushed or applied to any persistent database (dev db `sift` reported 5 applied migrations), so it was corrected in place rather than by a new migration.
- **Verification:** `rejects removed_at without removed_reason, and the reverse (D-17)` passes; `pnpm db:generate` prints "No schema changes".
- **Committed in:** `fdcaeda`

**2. [Rule 1 - Bug] `sift migrate` would have shown drizzle's `Failed query: <whole SQL>` instead of the preflight message**
- **Found during:** Task 1 (preflight case)
- **Issue:** drizzle 0.45 wraps driver errors, so the error message was the full DO block with a literal `%` and no slug. The plan requires a fixed message that names the mailbox.
- **Fix:** migrate() catches errors from the drizzle migrator and throws `MigrationFailedError` with the message from the first error in the cause chain that has a SQLSTATE. The original error is kept as `cause`. The test asserts the class, that the message starts with the fixed text, and the slug.
- **Files modified:** packages/db/src/owner/migrate.ts (not listed in the plan's files_modified)
- **Committed in:** `20be095`

**3. [Rule 3 - Blocking] More hard-coded migration counts than the plan listed**
- **Found during:** Task 1
- **Issue:** `migrate.test.ts` also hard-coded `applying 5 pending migrations` in the BackupRequiredError case, and `apps/worker/test/setup.test.ts` expected `Applied 5 migrations` and 5 rows.
- **Fix:** Both now derive the count from the journal. The preflight case's genuine Phase 1 count is a named `PHASE1_MIGRATION_COUNT = 5`, so the `toBe(5)` grep returns 0.
- **Committed in:** `20be095`

**4. [Rule 2 - Missing coverage] Extra edges beyond the behavior list**
- Added the reverse pairing (reason without removed_at), pending columns with state 'ok', unknown states, an upper-case hdr hex digest, an empty `pm:` key, a duplicate identity_key (23505), a message_body source of 'markdown', composite-FK cases for message_location and message_body, and the 23502 column name for the NULL mailbox_id case. Total: 16 23514 assertions.

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking) plus extra test coverage. **Impact:** Both bug fixes are needed for the plan's own truths: the removed_at/reason pairing, and a fixed preflight message that names the mailbox. Scope did not grow.

## Issues Encountered

- `pnpm lint` reports one pre-existing warning in `apps/worker/test/node-version.test.ts`; this plan did not touch that file.

## Verification

- `pnpm vitest run packages/db`: 9 files, 148 tests passed
- `pnpm test`: 29 files, 452 tests passed
- `pnpm typecheck`: exit 0
- `pnpm db:generate`: "No schema changes"
- Acceptance greps: FORCE RLS in 0007 = 2; set_config in 0005 = 2; `'message_location'` and `'message_body'` in index.ts; `'body_text'` in scoped.ts = 1; pgenum = 0; `toBe(5)` in migrate.test.ts = 0; messageLocation in the Scope interface and the withMailbox object; message_location in SCOPE_TABLES

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

Ready for the ingest plans (02-05 onward). They can write through `withMailbox` to message, messageLocation, messageBody, folderSync and mailboxStatus. Any plan that adds a migration no longer has to edit migrate.test.ts counts. A plan that adds a message child table must add it to CHILD_FIRST in owner-rls.test.ts and isolation.test.ts.

## Self-Check: PASSED

- FOUND: packages/db/migrations/0005_ingest_preflight.sql, 0006_ingest_tables.sql, 0007_ingest_tables_force_grants.sql, meta/0005..0007_snapshot.json
- FOUND commits: 20be095, f7a408b, fdcaeda
