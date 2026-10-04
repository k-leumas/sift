---
phase: 01-foundation-and-isolation
reviewed: 2026-10-04T08:16:53Z
depth: standard
files_reviewed: 101
files_reviewed_list:
  - .dockerignore
  - .env.development.example
  - .env.example
  - .env.mailboxes.example
  - .github/workflows/ci.yml
  - .gitignore
  - apps/worker/package.json
  - apps/worker/src/cli.ts
  - apps/worker/src/command.ts
  - apps/worker/src/commands/config-apply.ts
  - apps/worker/src/commands/config-check.ts
  - apps/worker/src/commands/mailbox-list.ts
  - apps/worker/src/commands/mailbox-rename.ts
  - apps/worker/src/commands/migrate.ts
  - apps/worker/src/commands/setup.ts
  - apps/worker/src/commands/worker.ts
  - apps/worker/src/runtime/backoff.ts
  - apps/worker/src/runtime/heartbeat.ts
  - apps/worker/src/runtime/mailbox-batch.ts
  - apps/worker/src/runtime/shutdown.ts
  - apps/worker/src/runtime/startup.ts
  - apps/worker/src/runtime/supervisor.ts
  - apps/worker/test/ci-workflow.test.ts
  - apps/worker/test/cli.test.ts
  - apps/worker/test/compose.test.ts
  - apps/worker/test/drift.test.ts
  - apps/worker/test/no-secret-leak.test.ts
  - apps/worker/test/node-version.test.ts
  - apps/worker/test/registry-cli.test.ts
  - apps/worker/test/setup.test.ts
  - apps/worker/test/supervisor.test.ts
  - apps/worker/test/user-facing-text.test.ts
  - apps/worker/test/worker.test.ts
  - apps/worker/tsconfig.json
  - backups/.gitkeep
  - biome.json
  - commitlint.config.js
  - compose.yaml
  - config/config.example.yaml
  - CONTRIBUTING.md
  - db/bootstrap.sql
  - Dockerfile
  - docs/adr/0003-traces-and-mail-app-relabels.md
  - lefthook.yml
  - package.json
  - packages/core/package.json
  - packages/core/src/config/env.ts
  - packages/core/src/config/errors.ts
  - packages/core/src/config/index.ts
  - packages/core/src/config/load.ts
  - packages/core/src/config/schema.ts
  - packages/core/src/config/slug.ts
  - packages/core/src/index.ts
  - packages/core/src/log.ts
  - packages/core/test/config.test.ts
  - packages/core/test/env.test.ts
  - packages/core/test/example-config.test.ts
  - packages/core/test/log.test.ts
  - packages/core/tsconfig.json
  - packages/db/drizzle.config.ts
  - packages/db/migrations/0000_extensions.sql
  - packages/db/migrations/0001_registry_and_message.sql
  - packages/db/migrations/0002_message_force_grants.sql
  - packages/db/migrations/0003_scoped_tables.sql
  - packages/db/migrations/0004_scoped_tables_force_grants.sql
  - packages/db/migrations/meta/_journal.json
  - packages/db/package.json
  - packages/db/src/app-db.ts
  - packages/db/src/connect.ts
  - packages/db/src/index.ts
  - packages/db/src/owner/backup.ts
  - packages/db/src/owner/migrate.ts
  - packages/db/src/owner/registry.ts
  - packages/db/src/registry-plan.ts
  - packages/db/src/registry-read.ts
  - packages/db/src/rls.ts
  - packages/db/src/schema/index.ts
  - packages/db/src/schema/mailbox.ts
  - packages/db/src/schema/scoped.ts
  - packages/db/src/scope.ts
  - packages/db/src/status.ts
  - packages/db/test/catalog.test.ts
  - packages/db/test/connect.test.ts
  - packages/db/test/global-setup.ts
  - packages/db/test/isolation.test.ts
  - packages/db/test/migrate.test.ts
  - packages/db/test/owner-rls.test.ts
  - packages/db/test/registry-plan.test.ts
  - packages/db/test/registry.test.ts
  - packages/db/test/scope.test.ts
  - packages/db/test/support/catalog.ts
  - packages/db/test/support/db.ts
  - packages/db/test/support/seed.ts
  - packages/db/tsconfig.json
  - pnpm-workspace.yaml
  - README.md
  - scripts/compose-smoke.sh
  - scripts/pg-dump-via-compose.sh
  - tsconfig.base.json
  - tsconfig.json
  - vitest.config.ts
findings:
  critical: 1
  warning: 8
  info: 7
  total: 16
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-10-04T08:16:53Z
**Depth:** standard (configured deep; downgraded because scope > 50 files)
**Files Reviewed:** 101 (generated drizzle snapshots `packages/db/migrations/meta/000*_snapshot.json` excluded as instructed)
**Status:** issues_found

## Summary

I read every source, migration, SQL, Compose, Docker, CI and shell file in scope in full. For the test files I checked reliability only: skips, env handling, the catalog-check helper and the global setup. I traced the isolation path (`withMailbox` -> transaction-local `set_config` -> forced RLS policy on `sift_app` and `sift_owner`), secret handling (pg_dump password via `PGPASSWORD`, `redactText`, `last_error` redaction, error mapping in `connect.ts`), the migrate/backup ordering, and supervisor shutdown, including the pg-pool `end()` and drizzle migrator internals in `node_modules`.

The isolation core is solid. The scoped API exposes no raw transaction, pool or ORM. Every helper adds its own `mailbox_id` filter on top of RLS. The policies, FORCE RLS and grants in the migrations match D-40/D-41. I found no path that leaks across mailboxes or logs a secret. The problems are elsewhere:

- **CI blocker:** the compose-smoke CI job cannot pass on a Linux runner because of file permissions.
- **Guards that are weaker than they claim:** the runtime role guard accepts `sift_owner`, and the catalog gate does not see column-level INSERT grants or memberships in roles that bypass RLS.
- **Migrate bookkeeping:** pending migrations are counted, while drizzle compares timestamps, so the two can disagree.
- **Shutdown:** a stuck batch makes shutdown hang until Docker sends SIGKILL.
- **Smoke script:** it suggests `COMPOSE_PROJECT_NAME` gives an isolated stack, but it still uses the owner's real `sift-pgdata` volume.

## Critical Issues

### CR-01: compose-smoke cannot pass on GitHub's Linux runners: config.yaml is created mode 0600 and ./backups is not writable by the container user

**File:** `scripts/compose-smoke.sh:43,65-68` (with `compose.yaml:57-59`, `Dockerfile:41`, `packages/db/src/owner/backup.ts:47-60`)
**Issue:** The script sets `umask 077` and then runs `cp config/config.example.yaml config/config.yaml`. With that umask, `cp` creates the file as mode 0600, owned by the runner user. GitHub-hosted Ubuntu runners use uid 1001. Both `setup` and `worker` run as `node` (uid 1000) and bind-mount `./config` read-only, so `loadConfig` gets EACCES and setup exits 1 with `cannot read config file /config/config.yaml (EACCES)`.

The backups mount fails independently. `./backups` comes from `actions/checkout` as 0755, owned by uid 1001. On a fresh database every migration is pending, so `migrate()` requires a backup, and `ensureWritableDir('/backups')` throws `backup directory /backups is not writable; on Linux run: chown 1000 /backups`.

Either failure fails the `compose-smoke` job on every push. The 01-12 summary lists "both CI jobs green after a push" as still pending, so this has not been run on Linux yet. Docker Desktop on macOS hides both problems because its file sharing does not enforce host uids.
**Fix:**
```bash
umask 077
# ... .env / .env.mailboxes generation stays 0600 (read by the compose CLI on the host)

if [ ! -f config/config.yaml ]; then
  (umask 022 && cp config/config.example.yaml config/config.yaml)   # container uid 1000 must read it
fi
# setup runs as uid 1000 and must write dumps here
mkdir -p backups
if [ "$(id -u)" != 1000 ]; then chmod o+rwx backups || sudo chown 1000 backups; fi
```
Alternatively, give the CI job a step that runs `sudo chown -R 1000 backups config` before the script.

## Warnings

### WR-01: compose-smoke's COMPOSE_PROJECT_NAME does not isolate the database; the `--down` guard only checks env vars

**File:** `scripts/compose-smoke.sh:18,32-36,41,70-75` (with `compose.yaml:103-105`)
**Issue:** The script header lists `COMPOSE_PROJECT_NAME` as a supported knob, which suggests a separate stack. But `compose.yaml` pins the volume with `name: sift-pgdata`, so every project name mounts the owner's real data volume. The cerebrum notes that an isolated smoke run only works after `sed`-ing the volume name in a copy.

Consequences:
- `COMPOSE_PROJECT_NAME=x SIFT_DB_PORT=55433 scripts/compose-smoke.sh` starts a second Postgres container on the same data directory. If the owner's db container is also running, both postmasters run as PID 1 in their own namespaces, so Postgres's stale-lock check (`other_pid == my_pid`) passes and two servers write the same cluster.
- With `--down` plus `SMOKE_ALLOW_VOLUME_REMOVAL=yes` (or any shell where `CI=true` is set), cleanup runs `docker compose down -v` against the real `sift-pgdata`. It deletes the volume whenever no container still references it, for example after the owner's own `docker compose down`.

The guard only looks at env vars. It never checks whether the volume holds data that existed before the smoke run.
**Fix:** Make the volume name follow the project, e.g. `name: ${SIFT_PGDATA_VOLUME:-sift-pgdata}`, and have the smoke script export `SIFT_PGDATA_VOLUME="${project}-pgdata-smoke"`. Independently, have the script refuse to start, with or without `--down`, when `docker volume inspect sift-pgdata` succeeds and the volume was not created by this run:
```bash
if [ "${CI:-}" != true ] && docker volume inspect sift-pgdata >/dev/null 2>&1; then
  echo "compose-smoke: sift-pgdata already exists; refusing to run against an existing database" >&2
  exit 2
fi
```

### WR-02: The worker's role guard accepts sift_owner (schema owner with CREATEROLE)

**File:** `packages/db/src/connect.ts:157-174`
**Issue:** `assertUnprivilegedRole` rejects only `rolsuper` and `rolbypassrls`. If `SIFT_DATABASE_URL` points at `sift_owner`, which is neither, the worker starts. It then holds DDL rights on every table (`ALTER TABLE ... NO FORCE ROW LEVEL SECURITY`, `DROP POLICY`), `CREATEROLE`, and the ability to rotate `sift_app`'s password.

The error text itself says "the worker must connect as sift_app", but the check never enforces that. Row-level isolation still holds today because the policy also applies to `sift_owner`. However, D-36 ("sift_app: DML only, owns nothing") is the guarantee this guard exists for. The guard also ignores membership in a role that bypasses RLS, such as `sift_backup` (see WR-07).
**Fix:** Assert the actual role and its powers:
```ts
`select current_user as name, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
        exists (select 1 from pg_class c where c.relowner = r.oid) as owns_relations,
        exists (select 1 from pg_roles b
                 where b.rolbypassrls and pg_has_role(r.oid, b.oid, 'MEMBER')
                   and b.oid <> r.oid) as member_of_bypass
   from pg_roles r where r.rolname = current_user`
// refuse unless name === 'sift_app' (or none of the flags are set)
```

### WR-03: Shutdown hangs, and never exits 0, when a batch outlives SHUTDOWN_TIMEOUT_MS

**File:** `apps/worker/src/commands/worker.ts:121-129`, `packages/db/src/app-db.ts:55-58`, `apps/worker/src/runtime/supervisor.ts:225-240`
**Issue:** When `supervisor.stop()` returns `drained: false`, the worker calls `db.close()`, which is `pool.end()`. In pg-pool (`_pulseQueue` in the ending branch), `end()` resolves only after every checked-out client is released. A batch stuck in a query, such as a lock wait or a half-open TCP connection with no keepalive or statement timeout, keeps its client forever. So `db.close()` never resolves, the "stopped" line is never logged, and the process waits for Compose's `stop_grace_period: 30s` SIGKILL.

D-53 requires a bounded wait, then closing the pool and exiting 0. The bound covers only the batches, not the close. Phase 2 IMAP ingest makes long-running batches much more likely.
**Fix:** Bound the close as well. When the drain timed out, destroy the remaining clients instead of waiting for them:
```ts
const { drained } = await supervisor.stop(SHUTDOWN_TIMEOUT_MS);
// in finally:
await Promise.race([db.close(), new Promise((r) => setTimeout(r, 5_000).unref())]);
```
Or add a `closeNow()` to AppDb that ends every client in the pool. Also set `statement_timeout` / `idle_in_transaction_session_timeout` on the app pool, so a stuck batch fails instead of hanging.

### WR-04: migrate() counts pending migrations while drizzle compares timestamps, so a skipped migration is reported as "No pending migrations"

**File:** `packages/db/src/owner/migrate.ts:92-106,161-174`
**Issue:** `migrate()` treats `tags.slice(appliedCount)` as pending and reports `tags.slice(before, after)` as applied. Drizzle's pg migrator (`pg-core/dialect.js:56-69`) does not count rows. It applies a migration only when `lastDbMigration.created_at < migration.folderMillis`.

Suppose a migration's journal `when` is older than the last applied one, which happens when two branches each generate a migration and one is rebased onto the other. Then:
1. A backup is taken because the count says one migration is pending.
2. Drizzle silently skips the migration.
3. `after === before`, so the command prints "No pending migrations." and exits 0, while the schema is missing that migration.

The catalog test runs against fresh test databases built in journal order, so it never sees this case.
**Fix:** After `drizzleMigrate`, assert that the database caught up, and fail loudly if not:
```ts
const after = await appliedCount(client);
if (after !== tags.length) {
  throw new Error(
    `Migrations out of order: ${tags.length - after} journal entr(y/ies) were not applied ` +
    `(journal "when" older than the last applied migration)`);
}
```
Also check, before applying anything, that the journal's `when` values strictly increase.

### WR-05: The rename hint pairs removed and added slugs arbitrarily and can steer the owner into attaching one mailbox's history to another account

**File:** `apps/worker/src/commands/config-apply.ts:17-40` (with `packages/db/src/registry-plan.ts:122-125,136-142`)
**Issue:** `removed` is sorted alphabetically (`planRegistryChanges`), while `added` is in config order. `printRenameHint` then prints `sift mailbox rename ${removed[i]} ${added[i]}` for each index. When two or more slugs change in one apply, the suggested pairs are arbitrary.

Example: `alpha` and `beta` are removed, and `zeta` (alpha's account) and `gamma` (beta's account) are added. The hint suggests renaming `alpha` to `zeta` (correct) and `beta` to `gamma` (also correct only by luck). In another order, following the copy-pasteable commands attaches account A's message, label and decision history to the slug that now reads account B. Undoing that needs a manual DB fix.
**Fix:** Print concrete `rename` commands only when exactly one slug was removed and one added. Otherwise pair by IMAP identity, since a real rename keeps host, username and folder. The removed rows' `imap_username` and the new config entries are both available in `applyConfig`. If no identity matches, list the two sets without commands.

### WR-06: The catalog gate (D-37) does not see column-level SELECT/INSERT grants to sift_app

**File:** `packages/db/test/support/catalog.ts:126-136,323-342`
**Issue:** UPDATE is checked with `has_any_column_privilege`, but SELECT and INSERT use `has_table_privilege`, which is false for column-level grants. So a migration with `GRANT INSERT (slug, imap_host, ...) ON mailbox TO sift_app` passes the gate. That would break D-06 ("sift_app has SELECT only" on the unscoped registry, the one table without RLS). The same applies to a column-level SELECT on `drizzle.__drizzle_migrations` (only partly covered by the schema USAGE check). Append-only tables are not affected, because column-level UPDATE is caught.
**Fix:** Use `has_any_column_privilege('sift_app', c.oid, 'SELECT')` and `has_any_column_privilege('sift_app', c.oid, 'INSERT')` for `app_select` / `app_insert`, and do the same for `backup_insert`. Add a catalog test case that grants column-level INSERT on `mailbox`.

### WR-07: Neither the catalog gate nor the runtime guard checks sift_app's membership in sift_backup or other RLS-bypassing roles

**File:** `packages/db/test/support/catalog.ts:411-429` (with `packages/db/src/connect.ts:157-174`)
**Issue:** The only membership check is `pg_has_role('sift_app', 'sift_owner', 'MEMBER')`. `sift_app` is created `NOINHERIT`, so `has_table_privilege` ignores any role it is a member of, and a grant such as `GRANT sift_backup TO sift_app` is invisible to every privilege check. Yet such a grant lets the app role run `SET ROLE sift_backup` and read every mailbox: BYPASSRLS plus `pg_read_all_data`.

The same blind spot covers `pg_write_all_data` (bulk write on every table, which would bypass D-40 append-only after `SET ROLE`), and also `pg_read_all_data`. The scoped API cannot issue `SET ROLE`, but the gate exists to catch privilege drift, and this is the highest-impact drift there is.
**Fix:** Add to `roleProblems`:
```sql
select b.rolname from pg_roles b
 where pg_has_role('sift_app', b.oid, 'MEMBER') and b.rolname <> 'sift_app'
```
Fail on any row. sift_app should be a member of nothing. Mirror the check in `assertUnprivilegedRole` (WR-02).

### WR-08: poll_interval_seconds values that are not multiples of the 15 s tick are rounded up (10 s runs every 15 s, 20 s every 30 s)

**File:** `packages/core/src/config/schema.ts:10`, `apps/worker/src/runtime/supervisor.ts:4,113,176`, `config/config.example.yaml:48`
**Issue:** The schema accepts `MIN_POLL_INTERVAL_SECONDS = 10`, and the example documents "How often each mailbox is checked ... (10 to 3600)". But the supervisor only starts runs on ticks every `SUPERVISOR_TICK_MS = 15_000`, and sets `nextRunAt = startedAt + pollIntervalMs`. The effective interval is therefore `ceil(interval / 15) * 15` seconds, plus tick drift: 10 becomes 15, 20 becomes 30 (50 % slower than configured), and 61 becomes 75. The owner's configured value is silently not honoured.
**Fix:** Either raise the minimum to the tick and require multiples of it, or schedule from `nextRunAt` instead of the fixed tick. For example, set the next tick timeout to `min(tickMs, earliest nextRunAt - now)` while still touching the heartbeat at least every `tickMs`.

## Info

### IN-01: The D-64 duplicate-account check uses raw values, but the stored values are trimmed

**File:** `packages/core/src/config/schema.ts:139-149`
**Issue:** `imapIdentity` reads `host`, `username` and `folder` from the raw input. The schema stores them trimmed (`nonEmpty(...).trim()`). Two entries such as `host: "imap.x "` and `host: "imap.x"` (quoted YAML) pass the duplicate check but are stored identically, so the same IMAP mailbox would be processed twice.
**Fix:** Trim (and lowercase) inside `imapIdentity`: `host.trim().toLowerCase()`, `username.trim().toLowerCase()`, `folder.trim()`.

### IN-02: The ISO-04 lint guard does not cover relative imports into packages/db internals

**File:** `biome.json:34-58`
**Issue:** `noRestrictedImports` blocks `pg`, `drizzle-orm` and `drizzle-orm/*` in `apps/**/src/**`. A relative import such as `../../../../packages/db/src/app-db.ts` (which exports `internalsOf`, giving the raw pool and ORM) is not matched. The package `exports` map blocks only the bare-specifier route.
**Fix:** Add a pattern group such as `["**/packages/db/src/**", "**/packages/*/src/**"]` with the same message.

### IN-03: Role passwords are sent as plaintext literals in DDL

**File:** `packages/db/src/owner/migrate.ts:189-215`, `db/bootstrap.sql:51-72`
**Issue:** `CREATE/ALTER ROLE ... PASSWORD '<plaintext>'` puts the password in the statement text. If one of these statements fails, or if `log_statement = 'ddl'` or `'all'` is ever enabled, Postgres writes the statement, password included, to the server log (`docker compose logs db`). The application code itself never logs it.
**Fix:** Send a pre-computed SCRAM-SHA-256 verifier (`PASSWORD 'SCRAM-SHA-256$4096:...'`) built client-side. Or at least document that `log_statement` must stay off or at `mod`-excluding settings.

### IN-04: Unexpected worker errors bypass pino and redaction

**File:** `apps/worker/src/cli.ts:67-74`, `apps/worker/src/commands/worker.ts:84-102`
**Issue:** Only `DatabaseStartupError` is handled inside `worker.run`. Errors from `checkDrift`, `assertUnprivilegedRole` (non-startup pg errors) or `createSupervisor` reach `cli.main`, which writes `sift: ${error.message}` to stderr as plain text, without `redactText`. Every other worker log line is JSON on stdout.
**Fix:** Catch inside `worker.run`, log via `log.error({ error: summarize(error) }, ...)` with `redactText(message, [...secrets, url])`, and return 1.

### IN-05: An unhealthy worker is never restarted, so the heartbeat healthcheck does not recover a stuck supervisor

**File:** `compose.yaml:89-101`, `apps/worker/src/runtime/supervisor.ts:193-207`
**Issue:** The heartbeat is skipped whenever the registry read fails or hangs, for example when all 4 pool clients are held by stuck batches. Docker then marks the container unhealthy. But `restart: unless-stopped` acts only on process exit, never on health status, so a wedged worker stays wedged. Health is only informational.
**Fix:** Document this, or have the supervisor exit non-zero after N consecutive missed heartbeats, so the restart policy recovers the worker.

### IN-06: A mailbox disabled while the worker is down keeps a stale mailbox_status.state

**File:** `apps/worker/src/runtime/supervisor.ts:162-168`
**Issue:** `stopMailbox` / `recordDisabled` runs only for mailboxes already in `states`. After a restart, a mailbox that is disabled in the registry is never known, so its `mailbox_status.state` stays `ok` or `error` indefinitely. `sift mailbox list` hides this by checking `disabledAt` first, but anything else reading `mailbox_status` (future UI) sees the wrong state.
**Fix:** On the first tick, call `onMailboxStopped` for disabled entries whose status is not `disabled`, or always record it once per process.

### IN-07: GitHub Actions are pinned by major tag, not commit SHA

**File:** `.github/workflows/ci.yml:43,46,48,92`
**Issue:** `actions/checkout@v7`, `pnpm/action-setup@v6` and `actions/setup-node@v7` are mutable tags. This is inconsistent with the supply-chain stance in `pnpm-workspace.yaml` (`minimumReleaseAge`).
**Fix:** Pin each action to a full commit SHA with a version comment.

---

_Reviewed: 2026-10-04T08:16:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
