---
phase: 01-foundation-and-isolation
plan: 03
subsystem: database
tags: [postgres, drizzle-orm, drizzle-kit, rls, force-rls, migrations, uuidv7, vitest, test-harness]

# Dependency graph
requires:
  - phase: 01-foundation-and-isolation (plan 01-01)
    provides: "pnpm workspace, @sift/db exports map (./migrate -> src/owner/migrate.ts), drizzle-orm 0.45.3 / drizzle-kit 0.31.11 / pg 8.23.0 / vitest 5.0.2 pins, db:generate script"
  - phase: 01-foundation-and-isolation (plan 01-02)
    provides: "Running Postgres 18 + pgvector with sift_owner (CREATEROLE) and sift_backup, vector in template1, .env passwords"
provides:
  - "Drizzle schema for all eight M1 tables: mailbox (unscoped registry) + seven mailbox-scoped tables"
  - "rls.ts: siftApp/siftOwner existing roles, mailboxPredicate, mailboxIsolation() policy factory (D-41)"
  - "Five committed migrations 0000..0004 (generated tables/policies plus custom FORCE RLS, grants, set_updated_at triggers)"
  - "@sift/db/migrate migrate(): session advisory lock, sift_app create/rotate, drizzle migrator, applied tags"
  - "Root vitest.config.ts and DB harness: per-run migrated template sift_test_<run>_tpl, per-file clones, teardown drop"
  - "Test helpers requireTestDb/freshDatabase/connect/roleUrl and seedMailboxes/seedScopedRows"
affects: [01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-10, 01-11, 01-12, ci]

# Actuals (#2632)
actuals:
  tokens: 23866    # chars/4 over the realized diff e3a76db..73da6c5 (95463 chars; drizzle-kit snapshots are ~65% of it)
  tasks: 2
  commits: 2
plan_head_before: e3a76db5e9c43717ed59752465fbffd64fe62585
plan_head_after: 73da6c5cdba26cf7b46267d7d596055c5b508a94

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every scoped table calls mailboxIsolation() in its pgTable extra config; drizzle-kit emits ENABLE RLS + CREATE POLICY"
    - "Each generated migration that adds tables is followed by a --custom migration with FORCE RLS, explicit per-table GRANTs and <table>_set_updated_at triggers; the 0.45 migrator applies all pending migrations in one transaction"
    - "Roles are declared pgRole(...).existing() with entities.roles: true, so kit never emits CREATE ROLE"
    - "migrate() runs on one dedicated pg.Client (session advisory lock), ensures sift_app before the migrator, and builds role DDL with client.escapeLiteral()"
    - "DB tests: globalSetup migrates one template per run; each test file clones it via freshDatabase() and drops it; requireTestDb() fails (never skips) without SIFT_TEST_ADMIN_URL"

key-files:
  created:
    - packages/db/src/rls.ts
    - packages/db/src/schema/mailbox.ts
    - packages/db/src/schema/scoped.ts
    - packages/db/src/schema/index.ts
    - packages/db/drizzle.config.ts
    - packages/db/migrations/0000_extensions.sql
    - packages/db/migrations/0001_registry_and_message.sql
    - packages/db/migrations/0002_message_force_grants.sql
    - packages/db/migrations/0003_scoped_tables.sql
    - packages/db/migrations/0004_scoped_tables_force_grants.sql
    - packages/db/migrations/meta/_journal.json
    - packages/db/src/owner/migrate.ts
    - packages/db/test/global-setup.ts
    - packages/db/test/support/db.ts
    - packages/db/test/support/seed.ts
    - packages/db/test/migrate.test.ts
    - vitest.config.ts
  modified: []

key-decisions:
  - "migrate() computes applied tags as journal tags sliced by drizzle.__drizzle_migrations row count before/after (to_regclass guard), and cross-checks journal length against readMigrationFiles before connecting"
  - "Role DDL failures are rethrown as a new Error carrying only SQLSTATE and the server message, never the statement text (T-01-09)"
  - "Clone names are sift_test_<runId>_<counter>_<6 hex>: test files run in separate workers, so a module counter alone is not unique; teardown drops every sift_test_<runId>* database"
  - "If template migration fails, globalSetup drops the run's databases before rethrowing, so a broken migration leaves nothing behind"
  - "sift_app ALTER on rerun only sets LOGIN PASSWORD (per plan); attribute drift is asserted by the 01-05 catalog test, since a non-superuser owner cannot reliably re-assert BYPASSRLS/CREATEDB"

patterns-established:
  - "New scoped table checklist: mailbox_id via the shared mailboxId() column builder, unique(<table>_mailbox_id_id_key), mailboxIsolation(), then a custom migration with FORCE + GRANT + trigger"
  - "Negative-grep acceptance criteria scan comments too: never write a forbidden literal (pgEnum, TRUNCATE, GRANT ALL) in a checked file's comments"

requirements-completed: [FND-03, ISO-01, ISO-02]

coverage:
  - id: D1
    description: "Real migrate() as sift_owner on an empty database creates all eight M1 tables and records exactly five migrations (0000..0004, in journal order)"
    requirement: FND-03
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#migrate() records every committed migration"
        status: pass
      - kind: other
        ref: "grep tags in packages/db/migrations/meta/_journal.json -> 0000_extensions, 0001_registry_and_message, 0002_message_force_grants, 0003_scoped_tables, 0004_scoped_tables_force_grants"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every scoped table has NOT NULL mailbox_id FK (ON DELETE RESTRICT), ENABLE + FORCE RLS and one mailbox_isolation policy FOR ALL TO sift_app, sift_owner with the D-41 predicate; no migration creates a role or grants TRUNCATE/ALL/default privileges"
    requirement: ISO-01
    verification:
      - kind: other
        ref: "grep FORCE/CREATE POLICY in 0001..0004; grep -ci 'create role' and 'truncate|grant all|default privileges' -> 0 for every migration; grep -c 'mailboxIsolation()' scoped.ts -> 7"
        status: pass
    human_judgment: false
  - id: D3
    description: "Under app.mailbox_id = A, sift_app can insert and read its rows in every scoped table; with no setting it reads nothing"
    requirement: ISO-02
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#migrate() lets sift_app write and read message only under app.mailbox_id"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#migrate() scopes every mailbox-scoped table to app.mailbox_id for sift_app"
        status: pass
    human_judgment: false
  - id: D4
    description: "sift migrate creates sift_app (NOSUPERUSER, NOBYPASSRLS) before the first policy, and a rerun rotates its password and applies nothing"
    requirement: ISO-02
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#migrate() creates sift_app without superuser or BYPASSRLS"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#migrate() applies nothing on a rerun"
        status: pass
    human_judgment: false
  - id: D5
    description: "label and decision reference message through composite FKs label_message_fk / decision_message_fk; set_updated_at triggers bump updated_at on UPDATE"
    verification:
      - kind: other
        ref: "grep -c 'label_message_fk|decision_message_fk' packages/db/migrations/0003_scoped_tables.sql -> 2"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#migrate() bumps updated_at on UPDATE through the trigger"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-47 harness: one migrated template per Vitest run, a clone per test file, all sift_test_<run>* databases dropped at teardown; DB tests fail (not skip) without SIFT_TEST_ADMIN_URL while non-DB suites still pass"
    verification:
      - kind: integration
        ref: "pnpm test (2 files, 10 tests) then psql count of sift_test% databases -> 0"
        status: pass
      - kind: other
        ref: "SIFT_TEST_ADMIN_URL= pnpm vitest run packages/db/test/migrate.test.ts -> file fails with 'SIFT_TEST_ADMIN_URL is not set'; SIFT_TEST_ADMIN_URL= pnpm vitest run apps/worker -> passes"
        status: pass
    human_judgment: false

# Metrics
duration: 9min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 03: Mailbox-Scoped Schema, Forced-RLS Migrations and DB Test Harness Summary

**Drizzle schema for all eight M1 tables with one `mailbox_isolation` policy per scoped table, five committed migrations (generated DDL plus custom FORCE RLS, explicit per-table grants and `set_updated_at` triggers), a `migrate()` that takes an advisory lock and creates or rotates `sift_app` through `escapeLiteral`, and a Vitest harness that runs those real migrations once per run into a template database and gives each test file its own clone.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-10-04T05:35:20Z
- **Completed:** 2026-10-04T05:44:36Z
- **Tasks:** 2/2 (Task 1 tracer, Task 2 auto)
- **Files modified:** 22 (17 source/SQL/test files plus 5 drizzle-kit snapshots)

## Accomplishments
- All eight M1 tables exist after `migrate()`: `mailbox` (unscoped registry with `mailbox_slug_format` and `mailbox_imap_port_range` checks) and the seven scoped tables `mailbox_status`, `message`, `label`, `decision`, `folder_sync`, `label_event`, `rule_set`. Primary keys default to PG18 `uuidv7()`, and `mailbox_status` is keyed by `mailbox_id`.
- Each scoped table has RLS enabled and forced, plus exactly one `mailbox_isolation` policy for `sift_app, sift_owner` with `USING` and `WITH CHECK` equal to the D-41 predicate. FORCE lives in custom migrations that the 0.45 migrator applies in the same transaction as the generated `CREATE TABLE`.
- Grants follow D-40: SELECT on `mailbox`, the four DML verbs on `message`, `mailbox_status`, `label`, `folder_sync` and `rule_set`, and SELECT+INSERT on the append-only `decision` and `label_event`. No TRUNCATE, no `GRANT ALL`, no default privileges.
- `label` and `decision` reference `message(mailbox_id, id)` through the composite FKs `label_message_fk` and `decision_message_fk` (D-04).
- `migrate()` holds `pg_advisory_lock(815309001)` on one dedicated client and creates `sift_app` (LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT) before the migrator runs, treating 42710 as "already exists". On a rerun it rotates the password and returns `applied: []`.
- The harness creates `sift_test_<run>_tpl` owned by `sift_owner`, migrates it with the real `migrate()`, provides it via `inject('testDb')`, and drops every `sift_test_<run>*` database at teardown. Verified: no test databases remain after `pnpm test`.

## Task Commits

1. **Task 1: Tracer - mailbox + message migrated by the real migrate(), proven as sift_app under app.mailbox_id** - `7e8d043` (feat)
2. **Task 2: Remaining scoped tables with composite FKs, their FORCE/grants/triggers, and seed helpers** - `73da6c5` (feat)

**Plan metadata:** recorded in the `docs(01-03)` commit that adds this SUMMARY

## Files Created/Modified
- `packages/db/src/rls.ts` - `siftApp`/`siftOwner` existing roles, `mailboxPredicate`, `mailboxIsolation()`
- `packages/db/src/schema/mailbox.ts` - Unscoped mailbox registry table with slug/port checks
- `packages/db/src/schema/scoped.ts` - The seven scoped tables, shared `mailboxId()`/`timestamps()` column builders
- `packages/db/src/schema/index.ts` - Barrel plus `SCOPED_TABLE_NAMES`, `APPEND_ONLY_TABLE_NAMES`, `MAILBOX_COLUMNS`, `MailboxRow`
- `packages/db/drizzle.config.ts` - drizzle-kit generate config (`drizzle.__drizzle_migrations`, `entities.roles`)
- `packages/db/migrations/0000_extensions.sql` - `CREATE EXTENSION IF NOT EXISTS vector` (fails loudly if the bootstrap was skipped)
- `packages/db/migrations/0001_registry_and_message.sql` - Generated: mailbox, message, RLS enable, policy
- `packages/db/migrations/0002_message_force_grants.sql` - Custom: FORCE on message, grants, `set_updated_at()`, two triggers
- `packages/db/migrations/0003_scoped_tables.sql` - Generated: six scoped tables, FKs, composite FKs, policies
- `packages/db/migrations/0004_scoped_tables_force_grants.sql` - Custom: FORCE on six tables, D-40 grants, six triggers
- `packages/db/migrations/meta/*` - Journal and drizzle-kit snapshots 0000..0004
- `packages/db/src/owner/migrate.ts` - `migrate()`, `MIGRATE_LOCK_KEY`, `MIGRATIONS_FOLDER`, `MigrateOptions`, `MigrateResult`
- `packages/db/test/global-setup.ts` - Bootstrap check, template create + migrate, `provide('testDb')`, teardown drop
- `packages/db/test/support/db.ts` - `requireTestDb`, `freshDatabase`, `connect`, `roleUrl`, `adminUrlFor`, `requireEnv`, `dropDatabase`
- `packages/db/test/support/seed.ts` - `seedMailboxes`, `seedScopedRows`, `ScopedRowIds`
- `packages/db/test/migrate.test.ts` - Smoke test: migration count, sift_app attributes, scoped read/write, per-table scope, updated_at trigger, idempotent rerun
- `vitest.config.ts` - Root config: include globs, globalSetup, timeouts, optional `.env.development` load

## Decisions Made
- `applied` is the journal tag list sliced by the migrations-table row count before and after the migrator. The journal length is checked against `readMigrationFiles` before connecting.
- Role DDL errors are rebuilt from SQLSTATE and the server message only, so the statement (which embeds the password literal) never reaches a log or an error.
- Clone names add a random suffix to the counter, because test files run in separate workers.
- When template migration fails, global setup drops the run's databases before rethrowing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A comment tripped the `pgEnum` negative grep**
- **Found during:** Task 2 acceptance criteria
- **Issue:** The `mailbox_status` doc comment said "not a pgEnum", so `grep -c pgEnum packages/db/src/schema/scoped.ts` printed 1 instead of 0.
- **Fix:** Reworded the comment to "not a Postgres enum type".
- **Files modified:** packages/db/src/schema/scoped.ts
- **Verification:** The grep prints 0 for every schema file. The test and typecheck re-ran green.
- **Committed in:** 73da6c5

**2. [Rule 2 - Missing Critical] Global setup cleans up after a failed template migration**
- **Found during:** Task 1
- **Issue:** Vitest does not run teardown when setup throws, so a failing migration would leave `sift_test_<run>_tpl` behind on the shared cluster.
- **Fix:** If migrate fails, setup calls `teardown()` and then rethrows.
- **Files modified:** packages/db/test/global-setup.ts
- **Verification:** The normal path leaves 0 `sift_test%` databases after `pnpm test`.
- **Committed in:** 7e8d043

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 2)
**Impact on plan:** One was a comment wording fix and one added test-harness cleanup. No scope change.

## Issues Encountered
- The Task 1 precondition required `.env.development`, which did not exist. A scratchpad script generated it from `.env.development.example` and copied the matching passwords from `.env` (umask 077). It printed only variable names, and no value appeared in the conversation. The file is git-ignored and not committed.

## User Setup Required

None. `.env.development` was created locally from `.env` and its passwords match the running cluster.

## Next Phase Readiness
- 01-05 (catalog and isolation tests) can use `freshDatabase()`, `seedMailboxes()`, `seedScopedRows()`, `SCOPED_TABLE_NAMES`, `APPEND_ONLY_TABLE_NAMES` and `MAILBOX_COLUMNS`.
- 01-08 can add the pre-migration backup option to `migrate()`. `applied` and the advisory lock are already in place.
- The scoped API plan (withMailbox) can import the table objects from `packages/db/src/schema/index.ts`.
- `pnpm test` now migrates a template database whenever `SIFT_TEST_ADMIN_URL` is set, including for non-DB suites (about 2 s of overhead).

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED

All 17 key files exist on disk. Commits 7e8d043 and 73da6c5 are in git log. Both tasks' verify blocks and acceptance criteria re-ran green: migrate.test.ts passed 6/6, typecheck and lint exited 0, and the grep checks matched.
