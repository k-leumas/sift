---
phase: 01-foundation-and-isolation
reviewed: 2026-10-04T17:22:35Z
depth: deep
files_reviewed: 25
files_reviewed_list:
  - apps/worker/src/commands/config-apply.ts
  - apps/worker/src/commands/worker.ts
  - apps/worker/src/runtime/supervisor.ts
  - apps/worker/test/compose-smoke.test.ts
  - apps/worker/test/compose.test.ts
  - apps/worker/test/registry-cli.test.ts
  - apps/worker/test/supervisor.test.ts
  - apps/worker/test/user-facing-text.test.ts
  - compose.yaml
  - CONTRIBUTING.md
  - packages/db/src/app-db.ts
  - packages/db/src/connect.ts
  - packages/db/src/index.ts
  - packages/db/src/owner/migrate.ts
  - packages/db/src/owner/registry.ts
  - packages/db/src/registry-plan.ts
  - packages/db/test/catalog.test.ts
  - packages/db/test/connect.test.ts
  - packages/db/test/migrate.test.ts
  - packages/db/test/registry-plan.test.ts
  - packages/db/test/registry.test.ts
  - packages/db/test/scope.test.ts
  - packages/db/test/support/catalog.ts
  - README.md
  - scripts/compose-smoke.sh
findings:
  critical: 1
  warning: 2
  info: 13
  total: 16
status: issues_found
---

# Phase 1: Code Review Report (re-review after CR-01, WR-01..WR-08 fixes)

**Reviewed:** 2026-10-04T17:22:35Z
**Depth:** deep
**Files Reviewed:** 25 (changed since da7bad9 by fix commits 3249ce5..45a7ad6)
**Status:** issues_found

## Summary

I checked each fix against the current source and followed the call chains into unchanged code: `backup.ts` (`pruneBackups`), `mailbox-batch.ts`, `cli.ts`, `db/bootstrap.sql`, the migrations, and the installed `pg-pool` 3.14.0 (`_pulseQueue`, `_remove`, the `connect` event) and drizzle-orm 0.45.3 (`pg-core/dialect.js` `migrate`). Results per fix:

- **CR-01 (config.yaml mode, backups ownership):** correct. `(umask 022 && cp ...)` gives 0644. `.env` and `.env.mailboxes` stay 0600. The chown only runs on Linux when the host uid is not 1000 and `backups/` is not owned by uid 1000. GitHub runners have passwordless `sudo -n`.
- **WR-01 (volume/project isolation):** `sift-pgdata` can no longer be removed by the script. The volume is always `<project>-pgdata-smoke` unless `SIFT_PGDATA_VOLUME` is set explicitly, and a literal `sift-pgdata` is refused even in CI. The shell export beats any `.env` value. However, the fix makes local smoke runs from the owner's checkout normal practice, and every such run now writes and **prunes** dumps in the owner's shared `./backups` (CR-02, new BLOCKER). The project guard also still depends on an env var (WR-09).
- **WR-02 / WR-07 (role guard, catalog membership):** correct. `sift_app` is created by `sift_owner` with `NOINHERIT`, and is granted only table privileges, so `member_of` is empty and the guard does not reject the legitimate role. PG16+ grants `sift_app` to its creator `sift_owner`, which makes `sift_owner` a member of `sift_app`, not the other way round. `pg_has_role(sift_app, X, 'MEMBER')` stays false. `owns_objects` is false for `sift_app`. `rolreplication` is not checked (IN-11).
- **WR-03 (bounded shutdown):** correct for clients that are checked out. `pg.Client.end()` with `_ending` set does not emit `error`, so ending a checked-out client cannot crash the process. The budget 20 s + 3 s + 1 s fits within `stop_grace_period: 30s`. One gap remains: a client still in the TCP or startup handshake is not tracked (IN-12).
- **WR-04 (migrate journal check):** incomplete. The journal monotonicity check closes the rebase case. The DB-side check compares row *counts*, though, so a migration that drizzle skips is still reported as "No pending migrations" when the database holds a row from another branch. Re-listed below.
- **WR-05 (rename-hint pairing):** correct for two or more slugs. Two side issues: the 1:1 case ignores identity (IN-09), and the hint prints empty lists (IN-10).
- **WR-06 (column-level grants):** correct.
- **WR-08 (next-due scheduling, heartbeat cadence):** correct. Ticks cannot overlap: a wake-up that arrives during a tick is folded into the re-arm. The heartbeat gap stays at or below `tickMs` after a successful read. A failing registry falls back to the plain tick. A batch that runs longer than the interval now restarts back-to-back (IN-13).

Carry-forward: I re-verified IN-01 through IN-07 against the current source. All seven still apply and are repeated below under their original IDs and titles. New findings start at CR-02, WR-09 and IN-08.

## Critical Issues

### CR-02: Local compose-smoke runs write throwaway dumps into the owner's ./backups and prune the owner's real pre-migration backups

**File:** `compose.yaml:57-59`, `scripts/compose-smoke.sh:98-106`, `packages/db/src/owner/migrate.ts:119-120,175-177`, `packages/db/src/owner/backup.ts:26,134-142`, `CONTRIBUTING.md:82`
**Issue:** The `setup` service always bind-mounts `./backups:/backups`, and the smoke script does not override it. Since WR-01, the smoke stack starts on a brand-new `<project>-pgdata-smoke` volume, so every migration is pending on every run. `migrate()` therefore always calls `backupBeforeApplying`, which:
1. writes `sift-<stamp>-pre-0004_...dump` (a dump of the empty smoke database) into the same `./backups` folder the owner's own stack uses, and
2. calls `pruneBackups(backup.dir, BACKUP_KEEP)`. That function keeps the 5 newest files matching `^sift-\d{8}T\d{6}Z-pre-.+\.dump$` and deletes the rest. The smoke dumps match the pattern and are always the newest.

CONTRIBUTING now documents the local run from the repo root (`COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh`) and says it "never touches your database". On this project the owner's stack runs from the same checkout. Each smoke run silently deletes one more of the owner's real pre-migration dumps (D-29). After five runs, `./backups` holds only dumps of throwaway smoke databases, and the owner's recovery point for a failed migration is gone. Before WR-01 the smoke run reused `sift-pgdata`, where nothing was pending and no dump or prune happened, so the fix introduced this regression. On Linux the script also `chown`s the owner's folder.
**Fix:** Give the smoke stack its own backup directory, in the same way it already has its own volume:
```yaml
# compose.yaml (setup)
    volumes:
      - ./config:/config:ro
      # Must be writable by uid 1000. SIFT_BACKUP_HOST_DIR exists only for compose-smoke.
      - ${SIFT_BACKUP_HOST_DIR:-./backups}:/backups
```
```bash
# compose-smoke.sh
backup_dir=${SIFT_BACKUP_HOST_DIR:-.smoke/$project/backups}
[ "$(cd "$(dirname "$backup_dir")" 2>/dev/null && pwd)/$(basename "$backup_dir")" != "$PWD/backups" ] \
  || refuse "refusing to write smoke dumps into ./backups, your own backup folder"
mkdir -p "$backup_dir"; export SIFT_BACKUP_HOST_DIR=$backup_dir
# chown the smoke dir (not ./backups) on Linux; gitignore .smoke/
```
Add a compose-smoke test asserting that the exported backup dir is not `./backups`, and correct the CONTRIBUTING sentence.

## Warnings

### WR-04: migrate() counts pending migrations while drizzle compares timestamps, so a skipped migration is reported as "No pending migrations"

**File:** `packages/db/src/owner/migrate.ts:110-118,129-134`
**Issue:** The fix is incomplete. The journal check (lines 91-98) catches a back-dated entry *within* the journal. The database-side check is `before + pending.length < tags.length`, which compares a row count with a journal length and never asks *which* migrations were applied. Drizzle stores each migration's `hash`, but the check does not use it. When the database holds a row that is not in this journal, the counts can match while a journal migration is still skipped. Trace:

- On branch `feat-1`, the dev database applies 0000-0004 plus `0005_x`, with `when = T2`.
- After switching to branch `feat-2`, the journal is 0000-0004 plus `0005_y`, generated earlier with `when = T1 < T2`.
- `before = 6`, `tags.length = 6`, `last = T2`, so `pending = []` (because `T1 < T2`), and the check `6 + 0 < 6` is false.
- Drizzle skips `0005_y`, the post-check `0 === 0` passes, and the command logs "No pending migrations." and exits 0, with `0005_y`'s schema missing.

The same thing happens on any database that ran a migration later dropped from the journal (a reverted PR) when a new migration is added with an older `when` than the dropped one. The fix report's carve-out ("more rows than the journal keeps the old behaviour") hides this.
**Fix:** Decide by identity, not count. `readMigrationFiles` already returns `hash` for each entry:
```ts
const appliedHashes = new Set(
  (await client.query<{ hash: string }>(`select hash from "drizzle"."__drizzle_migrations"`)).rows
    .map((r) => r.hash),
);
const missing = migrations.filter(
  (m, i) => !appliedHashes.has(m.hash) && !(last === null || last < m.folderMillis),
);
if (missing.length > 0) {
  throw new MigrationOrderError(
    `${missing.length} migration(s) not applied and older than the last applied one: ...`);
}
```
Guard the table-exists case as `lastAppliedMillis` does. Note that an applied migration file edited after the fact also shows up here, which is desirable. Add a test that inserts a foreign row with a later `created_at`, so that the row count equals the journal length.

### WR-09: compose-smoke's "do not replace your containers" guard is still env-var based: with CI=true, or an explicit COMPOSE_PROJECT_NAME equal to the owner's project, it recreates and then removes the owner's running stack

**File:** `scripts/compose-smoke.sh:40-41,53-55,108-113,129-130`, `CONTRIBUTING.md:82`
**Issue:** The project guard refuses only when `CI != true` **and** `project == basename($PWD)`. Two ways around it remain:
- **`CI=true` in a local shell.** Some tool wrappers export it. The previous review named this case. The default project is then accepted.
- **An explicit `COMPOSE_PROJECT_NAME` that names the owner's project from a checkout with a different directory name.** For example, running from `~/dev/sift-wt` with `COMPOSE_PROJECT_NAME=sift`: the project is `sift`, which differs from the default `sift-wt`, so the guard passes.

In both cases `docker compose up -d` runs under the owner's project with a different volume name. Compose recreates the owner's `db`, `setup` and `worker` containers on the empty smoke volume, so the owner's worker now runs against a throwaway database. `--down` (always allowed when `CI=true`) then runs `down -v --remove-orphans` on the owner's project and deletes those containers. `sift-pgdata` itself survives, so this is a disruption, not data loss. Still, CONTRIBUTING promises the script "cannot replace your running containers".
**Fix:** Check the actual Docker state instead of env vars. Before `docker compose build`, refuse when the project already has containers that do not mount the smoke volume:
```bash
existing=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
if [ -n "$existing" ] && ! docker ps -aq --filter "label=com.docker.compose.project=$project" \
     --filter "volume=$volume" | grep -q .; then
  refuse "project $project already has containers that are not a smoke stack; pick another COMPOSE_PROJECT_NAME."
fi
```
This holds in CI too, where a fresh runner has no containers, so the `CI` exemption is no longer needed for safety.

## Info

### IN-01: The D-64 duplicate-account check uses raw values, but the stored values are trimmed

**File:** `packages/core/src/config/schema.ts:139-149` (with `:30-33,62-66`)
**Issue:** Still present. `imapIdentity` lowercases `host` and `username` but never trims them. The schema stores them trimmed through `nonEmpty(...).trim()`, so `host: "imap.x "` and `host: "imap.x"` pass D-64 and are stored identically. Note that the new `identityKey` in `registry-plan.ts:153-155` does trim, so the two identity notions now disagree.
**Fix:** Trim (and lowercase) inside `imapIdentity`: `host.trim().toLowerCase()`, `username.trim().toLowerCase()`, `folder.trim()`. Better still, share one identity helper with `registry-plan.ts`.

### IN-02: The ISO-04 lint guard does not cover relative imports into packages/db internals

**File:** `biome.json:34-58`
**Issue:** Still present. `noRestrictedImports` covers only `pg`, `drizzle-orm` and `drizzle-orm/*`. A relative import of `packages/db/src/app-db.ts` (`internalsOf`) from `apps/**/src/**` is not matched.
**Fix:** Add a pattern group such as `["**/packages/db/src/**", "**/packages/*/src/**"]` with the same message.

### IN-03: Role passwords are sent as plaintext literals in DDL

**File:** `packages/db/src/owner/migrate.ts:244,257`, `db/bootstrap.sql:52,59,66,70`
**Issue:** Still present. `CREATE/ALTER ROLE ... PASSWORD '<plaintext>'` puts the password in the statement text. A failing statement, or `log_statement = 'ddl'`/`'all'`, writes it to the server log. Nothing in README or CONTRIBUTING warns about `log_statement`.
**Fix:** Send a SCRAM-SHA-256 verifier built on the client side, or document that `log_statement` must not include DDL.

### IN-04: Unexpected worker errors bypass pino and redaction

**File:** `apps/worker/src/cli.ts:67-74`, `apps/worker/src/commands/worker.ts:93-99,103`
**Issue:** Still present. Only `DatabaseStartupError` is handled inside `worker.run`. A pg error from the new role-guard query, or from `checkDrift` or `createSupervisor`, is rethrown and written by `cli.main` as plain `sift: <message>` to stderr, without `redactText`.
**Fix:** Catch inside `worker.run`, log through `log.error` with `redactText(message, [...secrets, url])`, and return 1.

### IN-05: An unhealthy worker is never restarted, so the heartbeat healthcheck does not recover a stuck supervisor

**File:** `compose.yaml:89-101`, `apps/worker/src/runtime/supervisor.ts:203-218`
**Issue:** Still present. The heartbeat is skipped when the registry read fails or hangs. `restart: unless-stopped` acts only when the process exits, and nothing in the supervisor exits after missed heartbeats.
**Fix:** Document this, or exit non-zero after N consecutive failed or overdue ticks.

### IN-06: A mailbox disabled while the worker is down keeps a stale mailbox_status.state

**File:** `apps/worker/src/runtime/supervisor.ts:171-177`
**Issue:** Still present. `stopMailbox` runs only for mailboxes that are already in `states`. A mailbox that was disabled before the process started is skipped with `continue`, so its `mailbox_status.state` is never set to `disabled`.
**Fix:** On the first tick, call `onMailboxStopped` for disabled entries, or once per process for each disabled id.

### IN-07: GitHub Actions are pinned by major tag, not commit SHA

**File:** `.github/workflows/ci.yml:43,46,48,92`
**Issue:** Still present. `actions/checkout@v7`, `pnpm/action-setup@v6` and `actions/setup-node@v7` are mutable tags.
**Fix:** Pin each action to a full commit SHA with a version comment.

### IN-08: The smoke stack reuses the owner's config.yaml, .env and .env.mailboxes and the shared sift:local image

**File:** `scripts/compose-smoke.sh:64-92,129`, `compose.yaml:47,70,74-75`
**Issue:** Existing owner files are "never overwritten", so they are used as they are. The smoke worker therefore loads the owner's real mailbox list and IMAP passwords. Today the batch is a no-op. Once Phase 2 ingest lands, every local smoke run would start a second worker that polls the owner's real mailboxes at the same time as the owner's own worker, writing into the throwaway database. In Phase 4 it would also apply labels to the owner's real mail. `docker compose build` also retags the shared `sift:local`, so the owner's next `docker compose up -d` picks up whatever the smoke run built.
**Fix:** Point the smoke run at its own config (`SIFT_CONFIG` or a smoke-only config directory with placeholder mailboxes and an unroutable host) and its own env files, and use a distinct image tag (`image: ${SIFT_IMAGE:-sift:local}`).

### IN-09: A single removed+added pair is suggested as a rename even when its IMAP identity differs

**File:** `packages/db/src/registry-plan.ts:173-177`
**Issue:** With exactly one removed and one added slug, the pair is suggested with no identity check. The doc comment at lines 143-149 gives the reason why a wrong pair is harmful ("following a wrong pair would attach one account's history to another"), and that reason applies just as much here. Replacing one mailbox with an unrelated one in a single edit is a plausible case. The data needed to tell these apart (`rows`) is already passed in.
**Fix:** In the 1:1 case, compare `identityKey`s as well. When they differ, keep the pair but have `printRenameHint` add "their IMAP host/username/folder differ; only rename if it is the same account", or leave the pair out.

### IN-10: The rename hint prints empty "No longer in config.yaml:" / "New in config.yaml:" lines

**File:** `apps/worker/src/commands/config-apply.ts:32-34`
**Issue:** The block runs when *either* side has unpaired slugs, but it prints both lines unconditionally. For example, with `alpha` removed and `zeta`/`gamma` added, and `alpha` paired with `zeta` by identity, the output contains `  No longer in config.yaml: ` with nothing after it.
**Fix:** Print each line only when its list is non-empty.

### IN-11: The worker role guard does not check REPLICATION

**File:** `packages/db/src/connect.ts:163-173,187`
**Issue:** `privilegeReasons` checks SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, ownership and membership, but not `rolreplication`. A REPLICATION role can read every row change through logical decoding (`pg_create_logical_replication_slot` / `pg_logical_slot_get_changes`) when `wal_level=logical`, bypassing RLS. Today's default `wal_level=replica` blocks this, so it is defence in depth only.
**Fix:** Select `r.rolreplication` and add `'REPLICATION'` to the reasons. Mirror it in the catalog `roleProblems` check for `sift_app`.

### IN-12: The bounded close does not cover a pool client that is still connecting

**File:** `packages/db/src/app-db.ts:79-88,104-110`
**Issue:** `clients` is filled from the pool's `connect` event, which pg-pool 3.14 emits only after the handshake (`index.js:337`). A client still in TCP connect or authentication at shutdown is in the pool's `_clients` but not in `clients`, so it is never ended. The pool has no `connectionTimeoutMillis`. In that case `close()` returns `{ forced: true }` after 1 s, `run` returns 0, but the pending socket keeps the event loop alive. `cli.ts` sets `process.exitCode` and never calls `process.exit()`, so the container can still hit the 30 s SIGKILL that WR-03 meant to avoid. This is unlikely inside the Compose network.
**Fix:** Set `connectionTimeoutMillis` (for example 5000) on the pool, or have the worker call `process.exit(code)` after a forced close.

### IN-13: A mailbox whose batch outlasts the poll interval now reruns back-to-back with no gap

**File:** `apps/worker/src/runtime/supervisor.ts:119-121,221-226`
**Issue:** After a successful run, `nextRunAt = startedAt + pollIntervalMs` is already in the past when the batch took longer than the interval. `wakeAt` then arms `setTimeout(loop, 0)`, and the next tick restarts the mailbox immediately. Before WR-08 there was a gap of up to 15 s. A slow mailbox now polls IMAP continuously, and each completion adds a registry read. D-50 says "if a run exceeds the interval, the next run is skipped, not stacked". The code does not stack runs, but it also never skips the missed slot.
**Fix:** If D-50's "skip" is meant literally, advance to the next slot: `state.nextRunAt = startedAt + Math.ceil((now() - startedAt) / pollIntervalMs) * pollIntervalMs`. Otherwise, record that back-to-back reruns are intended.

---

_Reviewed: 2026-10-04T17:22:35Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
