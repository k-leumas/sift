---
phase: 01-foundation-and-isolation
fixed_at: 2026-10-04T09:20:00Z
review_path: .planning/phases/01-foundation-and-isolation/01-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-10-04T09:20:00Z
**Source review:** .planning/phases/01-foundation-and-isolation/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (CR-01, WR-01 to WR-08; Info findings were out of scope)
- Fixed: 9 (three of them, WR-04, WR-05 and WR-08, change logic and are marked "requires human verification")
- Skipped: 0

Every fix has one commit on `main`, and each commit names its files explicitly, so none of the user's pre-staged `.wolf/**`, `.claude/**` or `.planning/config.json` changes went into a commit. Each fix comes with tests. For every fix except WR-07, I also ran the new tests against the old code and confirmed they fail there.

## Fixed Issues

### CR-01: compose-smoke cannot pass on GitHub's Linux runners

**Files modified:** `scripts/compose-smoke.sh`, `apps/worker/test/compose-smoke.test.ts` (new), `README.md`, `apps/worker/test/user-facing-text.test.ts`
**Commit:** 3249ce5
**Status:** fixed
**Applied fix:**
- `config/config.yaml` is now created with `(umask 022 && cp ...)`, so it is mode 0644 and uid 1000 can read it. `.env` and `.env.mailboxes` stay 0600.
- On Linux, when the host uid is not 1000 and `backups/` is not owned by uid 1000, the script runs `chown 1000 backups`. It does this directly as root, otherwise through `sudo -n`. If that fails, the script exits 1 with the command to run, before it starts the stack.
- README quick start step 5 has a new Linux note: `sudo chown 1000 backups` when `id -u` is not 1000, and keep `config.yaml` readable.
- The new test runs the script in a temporary copy of the repo, with `docker`, `uname`, `id` and `sudo` replaced by stub scripts. It checks the file modes and the chown call on Linux, and that the chown is skipped on macOS or when the uid is 1000.
- Reproduced in a throwaway `sift:local` container on real Linux, with paths owned by uid 1001. After the script ran, `node` (uid 1000) could read `config.yaml` and write to `backups/`.

**Still open:** someone needs to push and confirm that both CI jobs are green. `ensureWritableDir`'s error still names the container path `/backups`; the README note covers the host side.

### WR-01: compose-smoke's COMPOSE_PROJECT_NAME does not isolate the database

**Files modified:** `compose.yaml`, `scripts/compose-smoke.sh`, `apps/worker/test/compose-smoke.test.ts`, `apps/worker/test/compose.test.ts`, `CONTRIBUTING.md`
**Commit:** d45299e
**Status:** fixed
**Applied fix:**
- The volume name is now `${SIFT_PGDATA_VOLUME:-sift-pgdata}`. Owners still get `sift-pgdata` (D-25). I checked with `docker compose config` (v2.2.3) that the default still resolves to `sift-pgdata` and that the override works.
- The smoke script exports `SIFT_PGDATA_VOLUME=<project>-pgdata-smoke`, so `--down` only ever deletes the smoke volume.
- The script refuses to run on `sift-pgdata`, even in CI.
- Outside CI, it also refuses to run under the default Compose project, so it can no longer replace the owner's running containers. Local runs now need `COMPOSE_PROJECT_NAME`, and CONTRIBUTING documents this.
- The `SMOKE_ALLOW_VOLUME_REMOVAL` confirmation for `--down` is kept.
- Tests cover each refusal and the volume name passed to docker.

### WR-02: The worker's role guard accepts sift_owner

**Files modified:** `packages/db/src/connect.ts`, `packages/db/test/connect.test.ts`
**Commit:** 191b056
**Status:** fixed
**Applied fix:**
- `assertUnprivilegedRole` now refuses any role that is a superuser, has BYPASSRLS, CREATEROLE or CREATEDB, owns objects (relations, schemas, functions or the database), or is a direct or indirect member of any other role.
- The error message lists the reasons and never the URL.
- New tests: `sift_owner` is refused (CREATEROLE, owns objects). A throwaway login role in `sift_backup` is refused as "member of pg_read_all_data, sift_backup".
- The guard does not require the role to be named `sift_app`. A clean DML-only role with another name still passes.

### WR-03: Shutdown hangs when a batch outlives SHUTDOWN_TIMEOUT_MS

**Files modified:** `packages/db/src/app-db.ts`, `packages/db/src/index.ts`, `apps/worker/src/commands/worker.ts`, `packages/db/test/scope.test.ts`
**Commit:** 148143e
**Status:** fixed
**Applied fix:**
- `AppDb.close({ timeoutMs })` records the pool's clients through its `connect` and `remove` events. After the timeout, it ends every client that is still checked out; pg 8.23's `Client.end()` destroys the socket when a query is running. It then waits at most 1 s more and resolves `{ forced: true }`.
- The worker closes with `CLOSE_TIMEOUT_MS = 3000`: 20 s drain + 3 s + 1 s stays within the 30 s `stop_grace_period`. A forced close logs a warning.
- New test: a scope blocked behind an `ACCESS EXCLUSIVE` lock. `close({ timeoutMs: 200 })` resolves forced in under 5 s, and the stuck scope rejects. Against the old code, this test hit its 30 s timeout.

**Not done:**
- `statement_timeout` and `idle_in_transaction_session_timeout` (the review marked them optional). Choosing values is a design decision.
- An end-to-end worker test with a never-resolving batch. It would need more than 20 s of real time.

### WR-04: migrate() counts pending migrations while drizzle compares timestamps

**Files modified:** `packages/db/src/owner/migrate.ts`, `packages/db/test/migrate.test.ts`
**Commit:** 0b32e67
**Status:** fixed: requires human verification
**Applied fix:**
- New `MigrationOrderError`. It is thrown before any database change or backup when either:
  - the journal's `when` values do not strictly increase, or
  - fewer migrations would be applied than are missing. migrate() now computes pending with drizzle's own rule (newer than the last applied `created_at`).
- A check after applying confirms that the number of new rows equals the number of pending migrations.
- A database that has more rows than the journal (an older image) keeps the old behaviour and is not rejected.
- Two new tests: a back-dated journal entry, and a pending entry older than the last applied one. Both fail with nothing applied.

### WR-05: The rename hint pairs removed and added slugs arbitrarily

**Files modified:** `packages/db/src/registry-plan.ts`, `packages/db/src/owner/registry.ts`, `apps/worker/src/commands/config-apply.ts`, `packages/db/test/registry-plan.test.ts`, `packages/db/test/registry.test.ts`, `apps/worker/test/registry-cli.test.ts`
**Commit:** aa7f88a
**Status:** fixed: requires human verification
**Applied fix:**
- `findRenameSuspects(changes, rows)` now returns `pairs`:
  - One removed slug next to one added slug is paired as before (D-33).
  - Otherwise, slugs are paired only by IMAP identity, and only when the match is unique in both directions. Identity is host and username compared case-insensitively, plus folder.
- `refused-rename` results include `pairs`.
- `config apply` prints rename commands only for those pairs. It lists the unpaired slugs and says it cannot tell which became which.
- New tests: the review's alpha/beta to gamma/zeta example in reversed config order, run in-process against the DB; no identity match; an ambiguous identity.

### WR-06: The catalog gate does not see column-level SELECT/INSERT grants

**Files modified:** `packages/db/test/support/catalog.ts`, `packages/db/test/catalog.test.ts`
**Commit:** 2c7a0c2
**Status:** fixed
**Applied fix:**
- `app_select`, `app_insert` and `backup_insert` now use `has_any_column_privilege`.
- New test: column-level `INSERT (slug)` on `mailbox`, `SELECT (id)` on `drizzle.__drizzle_migrations` and `INSERT (created_at)` on `message` to `sift_backup`. All three are reported.

### WR-07: Catalog gate and runtime guard miss memberships in RLS-bypassing roles

**Files modified:** `packages/db/test/support/catalog.ts`, `packages/db/test/catalog.test.ts`
**Commit:** 809ff06
**Status:** fixed
**Applied fix:**
- The catalog gate's `roleProblems` now uses the new exported `membershipProblems(client, 'sift_app')`. This replaces the old check that only looked at membership in `sift_owner`. Any direct or indirect membership is a violation.
- The runtime guard mirror was added in the WR-02 commit.
- The test uses a throwaway NOINHERIT stand-in role that is granted `sift_backup`, and expects `pg_read_all_data` and `sift_backup` to be reported. I did not grant anything to the shared `sift_app`: test files running at the same time would trip the new worker guard.

### WR-08: poll_interval_seconds values that are not multiples of the 15 s tick are rounded up

**Files modified:** `apps/worker/src/runtime/supervisor.ts`, `apps/worker/test/supervisor.test.ts`
**Commit:** 45a7ad6
**Status:** fixed: requires human verification
**Applied fix:**
- The next tick now runs at `min(now + 15 s, earliest nextRunAt among idle mailboxes)`.
- A finished or failed run calls `wakeAt(nextRunAt)`, so a run that ends between ticks is not delayed. A wake-up during a tick is folded into the re-arm at the end of that tick, so ticks never overlap.
- After a failed registry read, the plain 15 s tick applies, so a broken database is not hammered.
- New tests: 10 s, 20 s and 61 s intervals run exactly on schedule; the heartbeat gap stays at 15 s or less; a 4 s batch keeps the start-based interval; a failing registry does not spin.
- Default and multiple-of-15 intervals behave as before (all 14 existing supervisor tests pass).

## Verification

All gates ran in the **main checkout** (`/Users/samuel/dev/sift`), not in an isolated worktree. The orchestrator told me to commit on `main` and to run the project gates, which need `node_modules` and `.env.development`. A hand-made worktree has neither, so I did not create one, even though `workflow.use_worktrees` is `true`. No recovery sentinel was written.

- `pnpm lint`: exit 0. Its one warning (`noTemplateCurlyInString` in `apps/worker/test/node-version.test.ts`) was already there before these fixes.
- `pnpm typecheck`: exit 0.
- `pnpm test` (full suite, load average about 35 to 40): 24 files and 299 tests passed, exit 0. No timeouts this run, so the process-spawning test files did not need a separate rerun.
- Each fix's test file was also run alone after the fix and against the old code.

Docker safety:
- `sift-db-1` and `sift-pgdata` were not touched.
- CR-01 was reproduced only in a `docker run --rm` throwaway container using a scratch directory, which I removed afterwards.
- `docker compose config` was used read-only to confirm the volume names.
- I did not run a full compose-smoke stack.

---

_Fixed: 2026-10-04T09:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
