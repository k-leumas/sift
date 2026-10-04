---
phase: 01-foundation-and-isolation
fixed_at: 2026-10-04T18:18:32Z
review_path: .planning/phases/01-foundation-and-isolation/01-REVIEW.md
iteration: 1
findings_in_scope: 16
fixed: 16
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-10-04T18:18:32Z
**Source review:** .planning/phases/01-foundation-and-isolation/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 16 (CR-02, WR-04, WR-09, IN-01 to IN-13; fix scope `all`)
- Fixed: 16. IN-05 is fixed by documentation only, which is one of the two fixes the review offers; the runtime option is left to the owner. WR-04, IN-06, IN-09 and IN-13 change logic and are marked "requires human verification".
- Skipped: 0

Each finding has its own commit on `main`. Every commit names its files explicitly, so the pre-existing `.wolf/**` changes did not go into any fix commit. Every behavioural fix comes with tests. For CR-02, WR-09, IN-08, WR-04, IN-02, IN-12 and IN-13, I also ran the new tests against the previous code and confirmed that they fail there.

## Fixed Issues

### CR-02: Local compose-smoke runs write throwaway dumps into the owner's ./backups and prune the owner's real pre-migration backups

**Files modified:** `compose.yaml`, `scripts/compose-smoke.sh`, `.gitignore`, `.dockerignore`, `CONTRIBUTING.md`, `apps/worker/test/compose-smoke.test.ts`, `apps/worker/test/compose.test.ts`
**Commit:** 5e58de9
**Status:** fixed
**Applied fix:**
- `setup` now mounts `${SIFT_BACKUP_HOST_DIR:-./backups}:/backups`, with a comment saying the variable is for compose-smoke only. I rendered it with `docker compose config` (Compose v2.2.3) using a fake env file: the default is still `./backups`, and an override is honoured.
- The smoke script exports `SIFT_BACKUP_HOST_DIR=<repo>/.smoke/<project>/backups` as a resolved physical path. Before any file is created or any `docker compose` call is made, it refuses (exit 2) any directory that resolves to `./backups`, including a symlink to it or the absolute path. The Linux `chown 1000` now targets the smoke directory, never `./backups`.
- `.smoke/` is in `.gitignore` and `.dockerignore`. CONTRIBUTING now says where the smoke dumps go.
- Tests: the smoke dumps go to `.smoke/<project>/backups`, `./backups` is left untouched and never chowned, the three refusal cases are covered, and a custom directory is honoured. The compose test pins the default mount.

### WR-04: migrate() counts pending migrations while drizzle compares timestamps, so a skipped migration is reported as "No pending migrations"

**Files modified:** `packages/db/src/owner/migrate.ts`, `packages/db/test/migrate.test.ts`
**Commit:** b368478
**Status:** fixed: requires human verification
**Applied fix:** The check now uses identity instead of row counts. `appliedHashes()` reads `hash` from `drizzle.__drizzle_migrations` and returns an empty set when the table does not exist yet. Any journal entry that is neither pending (dated after the last applied migration) nor recorded by its hash raises `MigrationOrderError`. The error names the skipped tags and says to regenerate them or restore an applied file that was edited. This runs before the backup and before any role or schema change. Two new tests: a foreign applied row that makes the row count equal the journal length (the reviewer's trace), and an applied migration file edited after the fact. Before the change, I checked the owner's dev database read-only: all 5 recorded hashes match the committed migration files, so the stricter check does not block the owner's next `sift migrate`.

### WR-09: compose-smoke's "do not replace your containers" guard is still env-var based: with CI=true, or an explicit COMPOSE_PROJECT_NAME equal to the owner's project, it recreates and then removes the owner's running stack

**Files modified:** `scripts/compose-smoke.sh`, `CONTRIBUTING.md`, `apps/worker/test/compose-smoke.test.ts`
**Commit:** 6474051
**Status:** fixed
**Applied fix:** After the env-var checks and **before** the EXIT trap is set (so a refusal can never trigger `--down`), the script runs `docker ps -aq --filter label=com.docker.compose.project=<project>`. If the project has containers and none of them mounts the smoke volume (`--filter volume=<volume>`), it refuses. If `docker ps` fails, it also refuses. This applies in CI too, where a fresh runner has no containers. The existing env-var guards are still in place. Tests use a `docker` shim whose `ps` answers are configurable. They cover CI=true with the default project, an explicit `COMPOSE_PROJECT_NAME` that names the owner's project together with `--down`, the filters the script queries, a rerun on an earlier smoke stack, a fresh runner, and a failing `docker ps`. **Not verified against a live daemon:** that `--filter volume=<name>` matches by volume name (the Docker documentation says it accepts a name or a mount point).

### IN-01: The D-64 duplicate-account check uses raw values, but the stored values are trimmed

**Files modified:** `packages/core/src/config/schema.ts`, `packages/core/src/config/index.ts`, `packages/core/test/config.test.ts`, `packages/db/src/registry-plan.ts`, `packages/db/test/registry-plan.test.ts`
**Commit:** 569e45a
**Status:** fixed
**Applied fix:** I added one shared helper, `imapIdentityKey(host, username, folder)`, exported from `@sift/core/config`. It trims all three values, lowercases host and username, and folds `INBOX` case-insensitively. The D-64 check and `registry-plan`'s rename pairing both use it, so the two notions of identity agree again. Previously registry-plan did not fold INBOX. Tests: a duplicate that differs only by surrounding spaces is rejected, a unit test covers the key, and a test checks rename pairing across `INBOX`/`inbox`.

### IN-02: The ISO-04 lint guard does not cover relative imports into packages/db internals

**Files modified:** `biome.json`, `apps/worker/test/lint-guard.test.ts` (new)
**Commit:** 9409407
**Status:** fixed
**Applied fix:** I added a `noRestrictedImports` pattern group, `["**/packages/*/src/**", "@sift/*/src/**"]`, to the `apps/**/src/**` override. The new test copies the real `biome.json` into a scratch git repo, lints probe files at `apps/worker/src/`, and asserts three things: the relative import `../../../packages/db/src/app-db.ts` is rejected, the deep import `@sift/db/src/app-db.ts` is rejected, and package exports and local modules still pass. `pnpm lint` passes on the existing source.

### IN-03: Role passwords are sent as plaintext literals in DDL

**Files modified:** `packages/db/src/owner/scram.ts` (new), `packages/db/src/owner/migrate.ts`, `packages/db/test/scram.test.ts` (new), `packages/db/test/migrate.test.ts`, `README.md`, `db/bootstrap.sql`
**Commit:** 8dfcb8e
**Status:** fixed (sift_app path); bootstrap path documented
**Applied fix:** `ensureAppRole` now sends a SCRAM-SHA-256 verifier built on the client (`scramSha256Verifier`: PBKDF2 with 4096 iterations, a random 16-byte salt, and node-postgres's SASLprep), so the `sift_app` password never appears in statement text.
- Tests: the verifier is byte-identical to the one PostgreSQL stores for the same salt, for a hex password and for a password that SASLprep changes. A role created with the verifier logs in over TCP, and a wrong password gets `28P01`. A spy on `pg.Client.prototype.query` shows that `migrate()` never sends the password, only `PASSWORD 'SCRAM-SHA-256$4096:...`. The existing rotation and login test still passes.
- `db/bootstrap.sql` (psql inside the superuser's initdb) cannot build a verifier, so it still sends the `sift_owner` and `sift_backup` passwords in plain text. README "Security model" and a comment in the file now say to keep `log_statement` at `none` when it runs.
- **Owner decision:** whether the bootstrap should also move to verifiers, for example by generating them on the host before init.

### IN-04: Unexpected worker errors bypass pino and redaction

**Files modified:** `apps/worker/src/commands/worker.ts`, `apps/worker/test/worker-errors.test.ts` (new)
**Commit:** e911836
**Status:** fixed
**Applied fix:** `worker.run` now catches every error after the pool is created. It unwraps drizzle's `Failed query: <sql> params: ...` wrapper to the pg error inside it, logs `worker failed: <redactText(message, [...secrets, url])>` with the SQLSTATE through pino, and returns 1. The pool is still closed in `finally`. The in-process test revokes `SELECT` on `mailbox` from `sift_app` in a throwaway database, which makes the drift check hit 42501, and sets a mailbox password that also appears in the error message. It asserts: exit code 1, nothing on stderr, exactly one level-50 JSON line with code `42501`, no "Failed query" text, and the redacted value masked.

### IN-05: An unhealthy worker is never restarted, so the heartbeat healthcheck does not recover a stuck supervisor

**Files modified:** `compose.yaml`, `README.md`, `apps/worker/test/compose.test.ts`, `apps/worker/test/user-facing-text.test.ts`
**Commit:** 5e65436
**Status:** fixed (documented; the runtime alternative is an owner decision)
**Applied fix:** I applied the review's "document this" option. The README quick start now explains what `healthy` and `unhealthy` mean, that Docker restarts the worker only when it exits, and that the owner should check `docker compose logs worker` and then run `docker compose restart worker`. The compose healthcheck comment says the same, and tests pin both texts. I did not implement the other option (exit non-zero after N failed or overdue ticks, so `restart: unless-stopped` recovers the worker). It changes the worker's availability behaviour, and covering a hung registry read would need a watchdog. That is a restart-policy choice for the owner.

### IN-06: A mailbox disabled while the worker is down keeps a stale mailbox_status.state

**Files modified:** `apps/worker/src/runtime/supervisor.ts`, `apps/worker/test/supervisor.test.ts`
**Commit:** 92bbd52
**Status:** fixed: requires human verification
**Applied fix:** A new `recordedDisabled` set records each disable once per process. This includes the first time the worker sees a mailbox that was disabled before it started; the log message for that case is `mailbox disabled`. The id is cleared when the mailbox is re-enabled or leaves the registry, so a later disable is recorded again. `onMailboxStopped` → `recordDisabled` is an upsert, so it also works when the mailbox has no status row. The existing first-tick test now expects one stop for the disabled mailbox. A new test covers the sequence disabled at start → recorded once across ticks → re-enabled and run → disabled again and recorded again.

### IN-07: GitHub Actions are pinned by major tag, not commit SHA

**Files modified:** `.github/workflows/ci.yml`, `apps/worker/test/ci-workflow.test.ts`
**Commit:** e96a208
**Status:** fixed
**Applied fix:** I pinned each action to the commit its major tag resolves to today, checked with `git ls-remote` and using the peeled commit for annotated tags, and added the version in a comment:

| Action | Pinned commit | Version |
|---|---|---|
| `actions/checkout` | `3d3c42e5…` | v7.0.1 |
| `pnpm/action-setup` | `0977fd99…` | v6.0.10 (what `v6` points to; v6.1.0 also exists) |
| `actions/setup-node` | `820762786…` | v7.0.0 |

The versions that run are the same as before. actionlint passes. A test fails on any `uses:` line that is not pinned. **Owner decision:** I did not add Dependabot or Renovate to bump these pins.

### IN-08: The smoke stack reuses the owner's config.yaml, .env and .env.mailboxes and the shared sift:local image

**Files modified:** `compose.yaml`, `scripts/compose-smoke.sh`, `CONTRIBUTING.md`, `apps/worker/test/compose-smoke.test.ts`, `apps/worker/test/compose.test.ts`
**Commit:** be0489b
**Status:** fixed
**Applied fix:**
- `compose.yaml` now takes `image: ${SIFT_IMAGE:-sift:local}`, `${SIFT_CONFIG_HOST_DIR:-./config}:/config:ro` and `env_file: ${SIFT_MAILBOXES_ENV_FILE:-.env.mailboxes}`. All three are smoke-only and documented in the header. I confirmed with `docker compose config` on v2.2.3 that the overrides and the defaults render correctly, and that `--env-file` replaces `./.env`.
- The smoke script no longer reads or writes the owner's `.env`, `.env.mailboxes` or `config/config.yaml`. It keeps its own copies in `.smoke/<project>/`:
  - `.env` with random passwords, kept across runs because the smoke volume stores them
  - `.env.mailboxes` with placeholders
  - `config/config.yaml` from the example, with every IMAP `host:` set to `imap.smoke.invalid`. The directory is created with mode 0755 and the file with 0644 for uid 1000 on Linux.
- Every compose call goes through `dc() { docker compose --env-file <smoke .env> ...; }`, and the build tags `sift-smoke:local`.
- Tests: owner files with sentinel values stay byte-identical and are never created. The exported variables point at the smoke paths and image. The generated config validates with the real `loadConfig`, and every host is `imap.smoke.invalid`. The mailbox env file holds only placeholders, and the smoke `.env` is stable across runs.

### IN-09: A single removed+added pair is suggested as a rename even when its IMAP identity differs

**Files modified:** `packages/db/src/registry-plan.ts`, `packages/db/test/registry-plan.test.ts`, `packages/db/test/registry.test.ts`, `apps/worker/src/commands/config-apply.ts`, `apps/worker/test/registry-cli.test.ts`
**Commit:** a4da990
**Status:** fixed: requires human verification
**Applied fix:** In the 1:1 case, `findRenameSuspects` still suggests the pair, as D-33 requires. When the registry row's identity differs from the new entry's (compared with `imapIdentityKey`), it now sets `identityDiffers: true`. The hint then adds: "Their IMAP host, username or folder differ, so rename only if "<to>" is the same account as "<from>"; otherwise its history would be attached to another account." The registry test whose `jobs`→`job-search` usernames differ now expects the flag. New unit and CLI tests check that the warning appears for a different account and is absent for the same one.

### IN-10: The rename hint prints empty "No longer in config.yaml:" / "New in config.yaml:" lines

**Files modified:** `apps/worker/src/commands/config-apply.ts`, `apps/worker/test/registry-cli.test.ts`
**Commit:** 2577981
**Status:** fixed
**Applied fix:** Each line is now printed only when its list is non-empty. The new CLI test covers the review's example (`alpha` paired with `zeta` by account, `gamma` unpaired): the output has no "No longer in config.yaml:" line and no line ending in `: `.

### IN-11: The worker role guard does not check REPLICATION

**Files modified:** `packages/db/src/connect.ts`, `packages/db/test/connect.test.ts`, `packages/db/test/support/catalog.ts`, `packages/db/test/catalog.test.ts`
**Commit:** 12439f4
**Status:** fixed
**Applied fix:** `assertUnprivilegedRole` now selects `rolreplication` and lists `REPLICATION` as a reason, and its doc comment explains why. In the catalog gate, `sift_app`'s attribute flags moved into an exported `attributeProblems(client, role)`, which now also checks REPLICATION. That makes it testable on a throwaway stand-in role, in line with the rule not to alter the shared `sift_app`. Tests: a LOGIN REPLICATION role is refused by name, and a stand-in with CREATEDB and REPLICATION produces both problems.

### IN-12: The bounded close does not cover a pool client that is still connecting

**Files modified:** `packages/db/src/app-db.ts`, `packages/db/test/scope.test.ts`
**Commit:** 51ebdc4
**Status:** fixed
**Applied fix:** The pool now builds a `TrackedClient`, a `pg.Client` subclass passed through the pool's `Client` option. It registers itself on construction and unregisters on `end`, so clients that are still connecting are tracked too. The forced close calls `client.end()` and then destroys `client.connection.stream`. `end()` comes first so the client emits no `error`. On a client still in its handshake, `end()` alone only half-closes the socket, which I confirmed with a probe.
- I chose this over `connectionTimeoutMillis`. That option would also time out waits for a free pool client, and its timeout error has no code, so `connectWithRetry` would fail fast instead of retrying (D-55).
- The new test runs a TCP server that accepts the connection and never answers. It asserts that `close({ timeoutMs: 100 })` returns `{ forced: true }` and that the server-side socket closes within 2 s. Against the old code the socket stayed open.
- **Known limit:** pg never settles the promise of a connect that was ended on purpose mid-handshake. That promise does not keep the event loop alive.

### IN-13: A mailbox whose batch outlasts the poll interval now reruns back-to-back with no gap

**Files modified:** `apps/worker/src/runtime/supervisor.ts`, `apps/worker/test/supervisor.test.ts`
**Commit:** dfa20b6
**Status:** fixed: requires human verification
**Applied fix:** I read the locked decision D-50 ("the next run is skipped, not stacked") literally. On success, `nextRunAt = startedAt + max(1, ceil((now - startedAt) / pollIntervalMs)) * pollIntervalMs`, so a run that missed slots resumes at the first slot after it ended. New tests use a 10 s interval: a 25 s batch runs at 0, 30 s and 60 s (before the fix it ran at 0, 25 s and 50 s), and a 9 s batch keeps the exact 10 s cadence. The existing WR-08 cadence tests still pass.

## Verification

All gates ran in the **main checkout** (`/Users/samuel/dev/sift`), not in an isolated worktree. The orchestrator told me to commit on `main` and to run the project gates, which need `node_modules` and `.env.development`. A hand-made worktree has neither, so I did not create one, even though `workflow.use_worktrees` is `true`. No recovery sentinel was written.

- `pnpm lint`: exit 0. The one warning is in `apps/worker/test/node-version.test.ts:26`, a file I did not touch.
- `pnpm typecheck`: exit 0.
- `pnpm test`: exit 0. All 27 test files and 342 tests passed in one full run (80 s) against `sift-db-1`. No re-runs were needed.
- Docker Desktop was not running when I started. I started it (`open -a Docker`) so the DB tests could reach `sift-db-1`. I did not stop, recreate or write to the owner's `sift` database; the only access was one read-only `select hash` for WR-04. Every DB test used throwaway `sift_test_*` databases, and roles named `sift_test_scram_*`, `sift_guard_*` and `app_standIn_*`, which the tests drop again.
- I did not run `scripts/compose-smoke.sh` against Docker. Every smoke change is covered by the shim-based tests. A real run, `COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh`, or the CI `compose-smoke` job after a push, should confirm the CR-02, WR-09 and IN-08 changes end to end, including `--filter volume=`.

---

_Fixed: 2026-10-04T18:18:32Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
