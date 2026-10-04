---
phase: 01-foundation-and-isolation
plan: 08
subsystem: database
tags: [postgres, pg_dump, backups, migrations, advisory-lock, rls, cli]

# Dependency graph
requires:
  - phase: 01-03
    provides: migrate() under advisory lock, sift_app rotation, test global-setup
  - phase: 01-02
    provides: sift_backup role (BYPASSRLS + pg_read_all_data), backups/* gitignore, Compose db
provides:
  - "@sift/db/migrate: BackupTarget, MigrateOptions.backup, MigrateResult.backupFile, BackupRequiredError, BackupFailedError"
  - "packages/db/src/owner/backup.ts: BACKUP_KEEP, backupFileName, ensureWritableDir, writeBackup, pruneBackups"
  - "`sift migrate` CLI command (No pending migrations. / Backup written: ... / Applied <n> migrations: ...)"
  - "scripts/pg-dump-via-compose.sh for hosts without pg_dump 18 (SIFT_PG_DUMP)"
  - backups/.gitkeep
affects: [01-09, 01-12 setup container, phase-2 schema migrations]

actuals:
  tokens: 8100
  tasks: 2
  commits: 3
plan_head_before: 9f3d47c9fde623e622a49a661e18391029c20337
plan_head_after: 9b23364caec6f5df0a19b4d145a680fa91adbf09

tech-stack:
  added: []
  patterns:
    - "Everything that can fail before a schema change runs first: pending detection, then the required backup, then role rotation, then the migrator"
    - "Secrets reach child processes only through env (PGPASSWORD); argv URLs are stripped and stderr is redacted"
    - "Backup tests resolve pg_dump/pg_restore 18 from SIFT_PG_DUMP or the host; throw under CI, skip with a reason locally"

key-files:
  created:
    - packages/db/src/owner/backup.ts
    - apps/worker/src/commands/migrate.ts
    - scripts/pg-dump-via-compose.sh
    - backups/.gitkeep
  modified:
    - packages/db/src/owner/migrate.ts
    - packages/db/test/global-setup.ts
    - packages/db/test/migrate.test.ts
    - .env.development.example

key-decisions:
  - "BackupTarget and BackupFailedError live in backup.ts and are re-exported from migrate.ts (no import cycle)"
  - "MigrateOptions.backup is a required key (target | false | undefined) so every caller decides explicitly"
  - "pg-dump-via-compose.sh rewrites --dbname to db:5432, not 127.0.0.1: loopback is trust in the postgres image"
  - "Tests read pg_restore 18 from the Compose container (dump on stdin) when SIFT_PG_DUMP is the compose wrapper"

patterns-established:
  - "Pre-change safety step: fail before any DDL or role rotation, prove it with to_regclass + pg_authid verifier checks"
  - "Never put a password in argv: strip it from the URL, pass PGPASSWORD by name"

requirements-completed: [FND-01]

coverage:
  - id: D1
    description: "sift migrate dumps as sift_backup (custom format, mode 0600, sift-<ts>-pre-<tag>.dump) before applying pending migrations"
    requirement: FND-01
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#backs up before applying pending migrations"
        status: pass
      - kind: other
        ref: "pnpm sift migrate && pnpm sift migrate | grep -q 'No pending migrations.'"
        status: pass
    human_judgment: false
  - id: D2
    description: "No pending migrations: no backup written, nothing changed"
    requirement: FND-01
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#writes no backup when there are no pending migrations"
        status: pass
    human_judgment: false
  - id: D3
    description: "Retention keeps the newest 5 sift-*.dump files and leaves other files alone"
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#keeps the newest 5 sift-*.dump files and leaves other files alone"
        status: pass
    human_judgment: false
  - id: D4
    description: "Missing target, failed dump or unwritable dir applies nothing and leaves sift_app untouched; errors never carry the password"
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#throws BackupRequiredError and applies nothing without a backup target"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#throws BackupFailedError without the password, leaves no file and applies nothing"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#fails on an unwritable backup dir with a chown 1000 hint and applies nothing"
        status: pass
    human_judgment: false
  - id: D5
    description: "Advisory lock serialises concurrent runs; sift_app is re-ALTERed on every run and can still log in"
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#waits for the advisory lock held by another session (D-30)"
        status: pass
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#rotates the sift_app password on every run without breaking its login (D-39)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A dump of a two-mailbox database taken as sift_backup contains both mailboxes' message rows (D-66)"
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#dumps both mailboxes as sift_backup before a later migration (D-66)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 08: sift migrate Backups Summary

**`sift migrate` writes a 0600 custom-format pg_dump as the dump-only sift_backup role before applying pending migrations. It keeps the newest five dumps, and a missing or failed backup applies nothing. On a Mac without pg_dump 18, a Compose wrapper runs the dump inside the db container.**

## Performance

- **Duration:** about 7 min
- **Started:** 2026-10-04T06:27:00Z
- **Completed:** 2026-10-04T06:33:36Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- `migrate()` now runs in this order inside the advisory lock:
  1. Detect pending migrations.
  2. Take the required backup, which can throw BackupRequiredError or BackupFailedError.
  3. Rotate sift_app.
  4. Run the migrator.
  It returns `{ applied, backupFile }`.
- `backup.ts`:
  - `writeBackup` spawns pg_dump without a shell. The password travels only in `PGPASSWORD`, and the `--dbname=` URL is stripped of it.
  - The dump file is created with `wx` and mode 0600.
  - On failure the partial file is deleted and stderr is redacted.
  - `pruneBackups` touches only `sift-<ts>-pre-<tag>.dump` names.
  - `ensureWritableDir` suggests `chown 1000 <dir>`.
- `sift migrate` CLI:
  - Reads its settings from SIFT_OWNER_DATABASE_URL, SIFT_DB_APP_PASSWORD, SIFT_BACKUP_DATABASE_URL, SIFT_BACKUP_DIR and SIFT_PG_DUMP.
  - Never prints a URL or password, and its errors go through `redactText`.
- Ran end to end on the dev database:
  - The first run wrote `backups/sift-20261004T062924Z-pre-0004_scoped_tables_force_grants.dump` (mode 0600) and applied 5 migrations.
  - The second run printed `No pending migrations.`
- 9 new backup tests cover every D-29/D-30/D-39/D-66 guarantee. That includes a pg_restore content check showing both mailboxes' message rows are in a sift_backup dump.

## Task Commits

1. **Task 1: Tracer: `sift migrate` backs up as sift_backup, then applies pending migrations.** `78bba77` (feat)
2. **Task 2: Backup guarantees (TDD).** RED `3e1ff3e` (test), GREEN `9b23364` (feat). No refactor commit was needed.

**Plan metadata:** see the docs(01-08) commit that follows.

## Files Created/Modified

- `packages/db/src/owner/backup.ts`: BACKUP_KEEP, BackupTarget, BackupFailedError, backupFileName, ensureWritableDir, writeBackup, pruneBackups
- `packages/db/src/owner/migrate.ts`: pending detection, backup step, `backup` option, `backupFile` result, BackupRequiredError, re-exports
- `apps/worker/src/commands/migrate.ts`: the `sift migrate` command
- `scripts/pg-dump-via-compose.sh`: runs pg_dump 18 inside the db container and streams the dump to stdout
- `backups/.gitkeep`: a committed backups directory, so Docker never creates it root-owned
- `packages/db/test/global-setup.ts`: the template migrate passes `backup: false`
- `packages/db/test/migrate.test.ts`: 9 backup tests and helpers (emptyDatabase, resolvePgDump, resolvePgRestore, appVerifier, withExtraMigration)
- `.env.development.example`: SIFT_BACKUP_DIR, plus a commented SIFT_PG_DUMP with an explanation
- The local, ignored `.env.development` gained SIFT_BACKUP_DIR and SIFT_PG_DUMP through a scratchpad script that prints no values. It is not committed.

## Decisions Made

- BackupTarget and BackupFailedError are defined in backup.ts and re-exported from migrate.ts, so the two modules do not import each other.
- `MigrateOptions.backup` is a required key, so every caller states explicitly whether it wants a backup.
- The CLI resolves a SIFT_PG_DUMP value that contains a `/` against the working directory, and keeps a bare command name for PATH lookup.
- When SIFT_PG_DUMP is the compose wrapper, the tests run pg_restore in the Compose db container and feed the dump on stdin. The D-66 content check therefore runs locally instead of skipping.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The compose pg_dump wrapper skipped password authentication**
- **Found during:** Task 2 (RED). The BackupFailedError test showed that a dump with a wrong password succeeded.
- **Issue:** The plan had the wrapper rewrite the `--dbname` host to `127.0.0.1:5432`. The postgres image's pg_hba marks loopback as `trust`, so any password was accepted. The dev path would never have caught a wrong SIFT_BACKUP_DATABASE_URL password.
- **Fix:** The wrapper now rewrites the host to `db:5432`. That is the Compose service name, which resolves to the container's network address and gets `host all all all scram-sha-256`, the same as the setup container. The script comment explains why.
- **Files modified:** scripts/pg-dump-via-compose.sh
- **Verification:** The BackupFailedError test passes: the error carries no password and no partial file is left. All other backup tests still dump with the correct password.
- **Committed in:** 9b23364

**2. [Verify-command quirk] `git check-ignore -q backups/.gitkeep` exits 0 on Git 2.54**
- **Found during:** Task 2 verify.
- **Issue:** Git 2.54 `check-ignore` exits 0 when the matching pattern is the negation `!backups/.gitkeep`. That happens even for a tracked file, and it reproduces in a clean temp repo. The plan's `test $? -eq 1` therefore fails although the file is not ignored.
- **Fix:** I checked the real property instead. `git ls-files --error-unmatch backups/.gitkeep` succeeds, `git add` needed no `-f`, and `git status --ignored backups` lists only the dump as `!!`. No code change was needed.
- **Files modified:** none

---

**Total deviations:** 1 auto-fixed bug (Rule 1) and 1 verify-command quirk documented.
**Impact on plan:** The wrapper fix is needed for the dev backup path to check credentials. There is no scope creep.

## TDD Gate Compliance

- RED `3e1ff3e`: the target test failed on an assertion. "throws BackupFailedError without the password..." got a resolved migrate(). `check tdd-red-evidence` returned RED_EVIDENCE_OK.
- GREEN `9b23364`: 15/15 tests in migrate.test.ts pass, and 140/140 in the full suite.
- REFACTOR: none needed.

## Issues Encountered

- The plan's precondition requires a usable pg_dump 18. The host has none, so I appended `SIFT_PG_DUMP=scripts/pg-dump-via-compose.sh` and `SIFT_BACKUP_DIR=backups` to the local `.env.development` without printing any values.

## User Setup Required

None. A host without pg_dump 18 can use the commented SIFT_PG_DUMP line in `.env.development.example`; the local `.env.development` already has it set.

## Next Phase Readiness

- 01-12 (setup container) can call `sift migrate` with SIFT_BACKUP_DATABASE_URL and a `./backups` bind mount. CI needs PostgreSQL 18 client tools, because the backup tests throw under `CI`.
- The dev database is now migrated (0000-0004).

## Self-Check: PASSED

- FOUND: packages/db/src/owner/backup.ts, apps/worker/src/commands/migrate.ts, scripts/pg-dump-via-compose.sh, backups/.gitkeep
- FOUND commits: 78bba77, 3e1ff3e, 9b23364

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*
