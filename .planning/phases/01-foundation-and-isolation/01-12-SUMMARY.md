---
phase: 01-foundation-and-isolation
plan: 12
subsystem: infra
tags: [docker, compose, pgdg, postgresql-client-18, corepack, pnpm, vitest, github-actions]

requires:
  - phase: 01-02
    provides: db service, .env.example, db/bootstrap.sql
  - phase: 01-05
    provides: ci.yml check job and its static contract test
  - phase: 01-08
    provides: sift migrate (backup + lock), pg-dump-via-compose.sh
  - phase: 01-09
    provides: sift config apply (registry reconciliation, rename refusal)
  - phase: 01-10
    provides: sift worker with heartbeat file (SIFT_HEARTBEAT_FILE)
provides:
  - "Dockerfile: one image (sift:local) for setup and worker, node 26.10.0 trixie-slim, postgresql-client-18, non-root"
  - "compose.yaml: db -> setup (one-shot) -> worker with per-service credentials"
  - "sift setup [--confirm]: config schema check -> migrate -> config apply"
  - "scripts/compose-smoke.sh: full-stack smoke used locally and by CI"
  - ".env.mailboxes.example: mailbox passwords for the worker only"
  - "CI job compose-smoke"
  - "lockAppRole(): cross-file test lock for sift_app password rotation"
affects: [phase-02-imap, deployment, ci, owner-docs]

actuals:
  tokens: 9282
  tasks: 2
  commits: 2
plan_head_before: 98d4f92c416a58a5738ef21d99d07786d688b556
plan_head_after: 48181fd2a7586f12f5237b1f10e1f2c3502f93d8

tech-stack:
  added: [docker image sift:local, PGDG apt repo (postgresql-client-18), corepack 0.36.0 in image]
  patterns:
    - "Explicit per-service environment in compose; only the worker reads .env.mailboxes"
    - "Copied-workspace image: pnpm install --frozen-lockfile --prod keeps workspace packages symlinked so Node type stripping works"
    - "Static compose contract test parses compose.yaml with yaml and asserts credential subsets"
    - "Test files that run migrate() or compare sift_app's verifier hold lockAppRole() for the whole file"

key-files:
  created:
    - Dockerfile
    - .dockerignore
    - .env.mailboxes.example
    - apps/worker/src/commands/setup.ts
    - scripts/compose-smoke.sh
    - apps/worker/test/node-version.test.ts
    - apps/worker/test/compose.test.ts
    - apps/worker/test/setup.test.ts
  modified:
    - compose.yaml
    - .env.example
    - .github/workflows/ci.yml
    - apps/worker/test/ci-workflow.test.ts
    - packages/db/test/migrate.test.ts
    - packages/db/test/support/db.ts

key-decisions:
  - "compose-smoke.sh --down refuses to run unless CI=true or SMOKE_ALLOW_VOLUME_REMOVAL=yes, because docker compose down -v deletes the sift-pgdata volume"
  - "setup.test.ts runs setup in-process (one CLI spawn for the wiring); five Node spawns tipped worker tests over their 15 s windows under a loaded parallel run"
  - "Test files that rotate or compare the cluster-wide sift_app password serialize on an advisory lock in the admin database (lockAppRole)"
  - "PGDG helper script path /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh works on trixie (research assumption A4 confirmed); no manual apt source needed"

patterns-established:
  - "Smoke runs on the dev machine go through an isolated copy (own COMPOSE_PROJECT_NAME, port, volume name), never the dev stack"

requirements-completed: [FND-01, FND-02]

coverage:
  - id: D1
    description: "docker compose up on a clean checkout builds sift:local, runs setup to exit 0 and brings the worker to healthy with 5 migrations and 2 mailboxes (status ok) applied"
    requirement: FND-01
    verification:
      - kind: e2e
        ref: "scripts/compose-smoke.sh (isolated copy: COMPOSE_PROJECT_NAME=siftsmoke12, SIFT_DB_PORT=55433, volume siftsmoke12-pgdata) -> compose smoke OK"
        status: pass
      - kind: e2e
        ref: "docker compose run --rm -T setup (second run) -> No pending migrations. / Mailbox registry already matches config.yaml. exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "sift setup: broken config stops before any change; valid config migrates with a backup and registers mailboxes; rerun is a no-op; rename-suspect needs --confirm"
    requirement: FND-01
    verification:
      - kind: integration
        ref: "apps/worker/test/setup.test.ts#sift setup (D-27, D-28, D-33)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Per-service credential contract: worker gets sift_app URL + .env.mailboxes only; setup gets owner/backup URLs and no mailbox passwords; db port loopback; ordering, healthcheck, stop grace, read-only config"
    requirement: FND-02
    verification:
      - kind: unit
        ref: "apps/worker/test/compose.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "Node version drift between .nvmrc, Dockerfile ARG and compose build args fails a test"
    verification:
      - kind: unit
        ref: "apps/worker/test/node-version.test.ts (fail-first verified with ARG 26.9.0, reverted)"
        status: pass
    human_judgment: false
  - id: D5
    description: "CI job compose-smoke runs the real stack on GitHub runners"
    verification:
      - kind: unit
        ref: "apps/worker/test/ci-workflow.test.ts#compose-smoke job; actionlint .github/workflows/ci.yml"
        status: pass
    human_judgment: true
    rationale: "The job only runs after the owner pushes; executors do not push (plan human-check 3)"
  - id: D6
    description: "Stack comes up on the target home machine with real Bridge passwords; real passwords never reach config/ or a pg_dump"
    verification: []
    human_judgment: true
    rationale: "Target hardware and real credentials are not reachable from automation (plan human-checks 1 and 2)"

duration: 37min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 12: Docker Image, Compose Stack and sift setup Summary

**One locally built node 26.10.0 trixie-slim image (PGDG postgresql-client-18, corepack pnpm, non-root) runs `sift setup` (config check, migrate with backup, config apply) and then the worker in Compose. Each container gets only its own secrets, and a smoke script and CI job prove the whole stack comes up.**

## Performance

- **Duration:** 37 min
- **Started:** 2026-10-04T07:07:33Z
- **Completed:** 2026-10-04T07:44:51Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments
- `docker compose up -d` brings db (healthy), then setup (exited 0), then worker (healthy). Proven by `scripts/compose-smoke.sh` printing `compose smoke OK` with 5 migrations, 2 mailboxes and 2 mailboxes in state ok. Docker's timestamps confirm the order: the worker started 0.9 s after setup finished.
- Rerunning setup (`docker compose run --rm -T setup`) is idempotent. It prints `No pending migrations.` and `Mailbox registry already matches config.yaml.`
- Credential isolation, verified with `docker inspect`. The worker env holds only SIFT_DATABASE_URL (sift_app), SIFT_CONFIG, SIFT_HEARTBEAT_FILE and the two `*_IMAP_PASSWORD` variables. Setup holds the owner/backup URLs and SIFT_DB_APP_PASSWORD, with no mailbox passwords.
- `sift setup [--confirm]` reuses the migrate and config-apply command modules. A broken config prints the issues plus `Setup stopped: ... Nothing was changed.` and touches nothing.
- Static tests now fail on any of these: Node version drift, a credential leaking between services, a non-loopback DB port, or broken ordering. CI job `compose-smoke` runs the real stack.

## Task Commits

1. **Task 1: Tracer - docker compose brings db, setup and worker up** - `be4ce69` (feat)
2. **Task 2: Version-drift, credential-contract and setup tests, plus the compose-smoke CI job** - `48181fd` (test)

## Files Created/Modified
- `Dockerfile` - ARG NODE_VERSION=26.10.0; PGDG client 18; corepack 0.36.0 + pnpm; `--prod` install of the copied workspace; `/usr/local/bin/sift` wrapper; `USER node`
- `.dockerignore` - keeps node_modules, .git, planning/tool dirs, env files, real config, backups, tests and docs out of the build context
- `compose.yaml` - adds `setup` (one-shot, `restart: "no"`) and `worker` (env_file .env.mailboxes, heartbeat healthcheck 120 s, stop_grace_period 30s, host-gateway)
- `.env.mailboxes.example` - SIFT_PERSONAL_IMAP_PASSWORD / SIFT_JOBS_IMAP_PASSWORD with owner instructions
- `.env.example` - mailbox-password note and optional `# NODE_VERSION=` override
- `apps/worker/src/commands/setup.ts` - `sift setup [--confirm]`
- `scripts/compose-smoke.sh` - creates missing owner files from the examples, builds, starts, polls setup exit and worker health, asserts DB counts, prints logs on failure; `--down` is guarded
- `apps/worker/test/node-version.test.ts` - .nvmrc vs Dockerfile/compose defaults
- `apps/worker/test/compose.test.ts` - credential, port, volume, ordering, health and mailbox-env contract
- `apps/worker/test/setup.test.ts` - setup on an empty sift_owner database (broken, valid, rerun, rename)
- `.github/workflows/ci.yml` / `apps/worker/test/ci-workflow.test.ts` - job `compose-smoke` and its assertions
- `packages/db/test/support/db.ts` / `packages/db/test/migrate.test.ts` - `lockAppRole()` cross-file lock

## Decisions Made
- `--down` guard in the smoke script: `docker compose down -v` deletes the explicitly named `sift-pgdata` volume, so on a dev machine it would wipe the owner's database. It runs only with CI=true (GitHub sets this) or SMOKE_ALLOW_VOLUME_REMOVAL=yes.
- PGDG helper path worked on trixie, so research assumption A4 holds and no manual signed-by apt source was needed.
- The setup test runs `run()` in-process for its DB steps and spawns the CLI once (broken config), which proves the command-table wiring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Guarded `compose-smoke.sh --down` against deleting the dev database**
- **Found during:** Task 1
- **Issue:** As planned, `--down` runs `docker compose down -v`. With the volume explicitly named `sift-pgdata`, a local run would delete the owner's or developer's whole database.
- **Fix:** `--down` exits 2 with an explanation unless `CI=true` or `SMOKE_ALLOW_VOLUME_REMOVAL=yes`.
- **Files modified:** scripts/compose-smoke.sh
- **Verification:** A local `scripts/compose-smoke.sh --down` printed the refusal and exited 2. CI sets CI=true automatically.
- **Committed in:** be4ce69

**2. [Rule 1 - Bug] Cross-file race on the sift_app password verifier**
- **Found during:** Task 2 (full-suite run)
- **Issue:** `migrate()` rotates the cluster-wide sift_app password on every run. The new setup.test.ts ran it concurrently with packages/db/test/migrate.test.ts, which asserts the verifier is unchanged after a failed backup. Result: `throws BackupFailedError ... applies nothing` failed intermittently.
- **Fix:** Added `lockAppRole()` to packages/db/test/support/db.ts (advisory lock 815309101 in the admin database). Both migrate.test.ts and setup.test.ts hold it for their whole file (beforeAll/afterAll, 180 s hook timeout).
- **Files modified:** packages/db/test/support/db.ts, packages/db/test/migrate.test.ts, apps/worker/test/setup.test.ts (the first two are outside files_modified, but this task introduced the race)
- **Verification:** Two consecutive full `pnpm test` runs: 239/239.
- **Committed in:** 48181fd

**3. [Rule 1 - Bug] setup.test.ts spawning the CLI per step pushed worker tests over their 15 s windows**
- **Found during:** Task 2
- **Issue:** The host load average was 50-180. Five extra Node CLI spawns made pre-existing worker/drift/no-secret-leak tests time out. The suite without the new file passed under the same load.
- **Fix:** The DB steps call `run()` from setup.ts in-process with captured IO. One CLI spawn remains, for the broken-config case.
- **Files modified:** apps/worker/test/setup.test.ts
- **Verification:** Full suite 239/239 twice (77 s each).
- **Committed in:** 48181fd

**4. [Rule 3 - Blocking] Created an empty `.env.mailboxes` in the dev checkout (untracked, git-ignored)**
- **Found during:** Task 1
- **Issue:** Docker Compose v2.2.3 refuses to load the project while the worker's `env_file` is missing (`open .../.env.mailboxes: no such file or directory`). That broke every `docker compose` command in the repo, including `scripts/pg-dump-via-compose.sh`, which the DB backup tests use.
- **Fix:** Copied `.env.mailboxes.example` to `.env.mailboxes` with umask 077. Values are empty: no secrets were fabricated, and no real-file content was changed. Logged the missing developer docs step in deferred-items.md.
- **Files modified:** none tracked
- **Verification:** `docker compose config --quiet` succeeds; backup tests pass through pg-dump-via-compose.sh.

---

**Total deviations:** 4 auto-fixed (1 missing critical, 2 bugs, 1 blocking)
**Impact on plan:** All four protect the owner's data or keep the existing suite and dev workflow working. No scope creep.

## Issues Encountered
- The plan's `<automated>` verify runs `docker compose config --quiet` before the smoke script. On a truly clean checkout that fails, because `.env` and `.env.mailboxes` do not exist until the smoke script creates them. The smoke script is the real check.
- On this host, `docker compose run --rm setup` without `-T` drops output (no TTY in the agent shell). With `-T` it prints as expected.
- The dev-machine smoke ran in an isolated copy (scratchpad `siftsmoke12/`: COMPOSE_PROJECT_NAME=siftsmoke12, SIFT_DB_PORT=55433, volume renamed to `siftsmoke12-pgdata`). Owner files were generated there and nothing touched `sift-pgdata`, port 5432 or the dev `sift` database. Afterwards the copy's stack was removed with `docker compose down -v`, which deleted only siftsmoke12 containers, network and volume.
- Docker resources: image `sift:local` (496 MB) was built and left in place. Created and then removed: containers siftsmoke12-{db,setup,worker}-1, the setup one-off run containers, network siftsmoke12_default and volume siftsmoke12-pgdata. sift-db-1 is running and healthy, and sift-pgdata is intact; the dev `sift` database still has no mailboxes.

## User Setup Required
None. Owners copy the three example files (already documented in compose.yaml and config.example.yaml).

## Next Phase Readiness
- The stack is ready for Phase 2: the worker image runs `sift worker`, which reaches host services through host.docker.internal.
- Pending human checks (end of phase): bring-up on the target home machine; real-password grep against config/ and a pg_dump; both CI jobs green after a push.
- Deferred: CONTRIBUTING.md should tell developers to create `.env.mailboxes` (see deferred-items.md).

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED
