---
phase: 01-foundation-and-isolation
verified: 2026-10-04T08:30:22Z
status: gaps_found
score: 98/103 must-haves verified (roadmap success criteria 3/4; SC1 needs the target machine)
covered_files: [".dockerignore", ".env.development.example", ".env.example", ".env.mailboxes.example", ".github/workflows/ci.yml", ".gitignore", ".nvmrc", ".planning/phases/01-foundation-and-isolation/01-01-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-01-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-02-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-02-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-03-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-03-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-04-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-04-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-05-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-05-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-06-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-06-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-07-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-07-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-08-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-08-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-09-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-09-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-10-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-10-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-11-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-11-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-12-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-12-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-13-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-13-SUMMARY.md", "CONTRIBUTING.md", "Dockerfile", "README.md", "apps/worker/package.json", "apps/worker/src/cli.ts", "apps/worker/src/command.ts", "apps/worker/src/commands/config-apply.ts", "apps/worker/src/commands/config-check.ts", "apps/worker/src/commands/mailbox-list.ts", "apps/worker/src/commands/mailbox-rename.ts", "apps/worker/src/commands/migrate.ts", "apps/worker/src/commands/setup.ts", "apps/worker/src/commands/worker.ts", "apps/worker/src/runtime/backoff.ts", "apps/worker/src/runtime/heartbeat.ts", "apps/worker/src/runtime/mailbox-batch.ts", "apps/worker/src/runtime/shutdown.ts", "apps/worker/src/runtime/startup.ts", "apps/worker/src/runtime/supervisor.ts", "apps/worker/test/ci-workflow.test.ts", "apps/worker/test/cli.test.ts", "apps/worker/test/compose.test.ts", "apps/worker/test/drift.test.ts", "apps/worker/test/no-secret-leak.test.ts", "apps/worker/test/node-version.test.ts", "apps/worker/test/registry-cli.test.ts", "apps/worker/test/setup.test.ts", "apps/worker/test/supervisor.test.ts", "apps/worker/test/user-facing-text.test.ts", "apps/worker/test/worker.test.ts", "apps/worker/tsconfig.json", "backups/.gitkeep", "biome.json", "commitlint.config.js", "compose.yaml", "config/config.example.yaml", "db/bootstrap.sql", "docs/adr/0003-traces-and-mail-app-relabels.md", "lefthook.yml", "package.json", "packages/core/package.json", "packages/core/src/config/env.ts", "packages/core/src/config/errors.ts", "packages/core/src/config/index.ts", "packages/core/src/config/load.ts", "packages/core/src/config/schema.ts", "packages/core/src/config/slug.ts", "packages/core/src/index.ts", "packages/core/src/log.ts", "packages/core/test/config.test.ts", "packages/core/test/env.test.ts", "packages/core/test/example-config.test.ts", "packages/core/test/log.test.ts", "packages/core/tsconfig.json", "packages/db/drizzle.config.ts", "packages/db/migrations/0000_extensions.sql", "packages/db/migrations/0001_registry_and_message.sql", "packages/db/migrations/0002_message_force_grants.sql", "packages/db/migrations/0003_scoped_tables.sql", "packages/db/migrations/0004_scoped_tables_force_grants.sql", "packages/db/migrations/meta/0000_snapshot.json", "packages/db/migrations/meta/0001_snapshot.json", "packages/db/migrations/meta/0002_snapshot.json", "packages/db/migrations/meta/0003_snapshot.json", "packages/db/migrations/meta/0004_snapshot.json", "packages/db/migrations/meta/_journal.json", "packages/db/package.json", "packages/db/src/app-db.ts", "packages/db/src/connect.ts", "packages/db/src/index.ts", "packages/db/src/owner/backup.ts", "packages/db/src/owner/migrate.ts", "packages/db/src/owner/registry.ts", "packages/db/src/registry-plan.ts", "packages/db/src/registry-read.ts", "packages/db/src/rls.ts", "packages/db/src/schema/index.ts", "packages/db/src/schema/mailbox.ts", "packages/db/src/schema/scoped.ts", "packages/db/src/scope.ts", "packages/db/src/status.ts", "packages/db/test/catalog.test.ts", "packages/db/test/connect.test.ts", "packages/db/test/global-setup.ts", "packages/db/test/isolation.test.ts", "packages/db/test/migrate.test.ts", "packages/db/test/owner-rls.test.ts", "packages/db/test/registry-plan.test.ts", "packages/db/test/registry.test.ts", "packages/db/test/scope.test.ts", "packages/db/test/support/catalog.ts", "packages/db/test/support/db.ts", "packages/db/test/support/seed.ts", "packages/db/tsconfig.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "scripts/compose-smoke.sh", "scripts/pg-dump-via-compose.sh", "tsconfig.base.json", "tsconfig.json", "vitest.config.ts"]
covered_digest: "v2:sha256:636f9eee2b0b9dac660963249e7e29f8a156470a2ab7a96adee637bfb28f75c2"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "CI job compose-smoke builds and runs the full stack with scripts/compose-smoke.sh and fails the build when setup exits non-zero or the worker never becomes healthy (01-12; supports SC1 / FND-01)"
    status: failed
    reason: "Review finding CR-01, reproduced. The job can never pass on GitHub's Linux runners, so the build is always red. scripts/compose-smoke.sh:43 sets `umask 077` before line 66 runs `cp config/config.example.yaml config/config.yaml`, which makes the file mode 0600 and owned by the runner (uid 1001). setup and worker run as node (uid 1000) with ./config bind-mounted read-only, so loadConfig gets EACCES. Separately, ./backups comes from checkout as 0755 owned by uid 1001. On a fresh DB all 5 migrations are pending, so migrate() calls ensureWritableDir('/backups') (packages/db/src/owner/migrate.ts:145), which throws. Reproduced in a throwaway sift:local container with 1001-owned paths: 'config read: EACCES' and 'backup directory /sim/backups is not writable; on Linux run: chown 1000 /sim/backups'. The 01-12 summary lists both CI jobs green after a push as still pending, so this has never run on Linux. Docker Desktop on macOS hides it."
    artifacts:
      - path: "scripts/compose-smoke.sh"
        issue: "umask 077 applies to the config.yaml copy (line 43 -> 66); backups/ is never made writable for uid 1000"
      - path: ".github/workflows/ci.yml"
        issue: "compose-smoke job has no chown/chmod step for ./config and ./backups before the script"
      - path: "README.md"
        issue: "The quick start has no Linux step to make ./backups writable by uid 1000. On a Linux mini PC (a stated target) where the owner's uid is not 1000, setup fails on the first migration. The error text gives the container path /backups, not the host path ./backups."
    missing:
      - "In compose-smoke.sh, create config.yaml with a readable mode, e.g. (umask 022 && cp ...)"
      - "Make ./backups writable by uid 1000 in the smoke script or a CI step (chmod o+rwx backups, or sudo chown 1000 backups)"
      - "A README quick-start note for Linux hosts: chown 1000 ./backups when your uid is not 1000"
      - "Push and confirm both CI jobs (check, compose-smoke) are green"
  - truth: "SIGTERM or SIGINT stops scheduling, waits up to 20 s for in-flight batches, closes the pool and exits 0 (01-10, D-53)"
    status: partial
    reason: "Review finding WR-03, confirmed against the code. This is a warning, not a phase-goal blocker. The normal path works: worker.test.ts SIGTERM -> exit 0 passes. In apps/worker/src/commands/worker.ts:122-129, when supervisor.stop() returns drained:false, the finally block awaits db.close() (pool.end()) with no bound. In pg-pool 3.14.0 (index.js:127-143), end() resolves only when _clients is empty, so a batch stuck in a query keeps shutdown waiting until Compose sends SIGKILL at 30 s. No test covers close after a drain timeout. Phase 1 batches are a single status write, so the risk is low now and grows with Phase 2 IMAP batches."
    artifacts:
      - path: "apps/worker/src/commands/worker.ts"
        issue: "db.close() is not bounded after a drain timeout"
    missing:
      - "Bound or force the pool close after drained:false (Promise.race with a timeout, or destroy remaining clients)"
      - "Optionally set statement_timeout / idle_in_transaction_session_timeout on the app pool"
      - "A test for shutdown with a never-resolving batch"
  - truth: "The per-mailbox interval is worker.poll_interval_seconds (default 60) (01-10, D-52)"
    status: partial
    reason: "Review finding WR-08, confirmed. This is a warning. The schema accepts 10..3600 s (packages/core/src/config/schema.ts:10-11), and config.example.yaml documents '10 to 3600'. But the supervisor only starts runs on a fixed SUPERVISOR_TICK_MS = 15000 tick, so the effective interval is ceil(n/15)*15: 10 runs every 15 s and 20 every 30 s. The default of 60 is honoured exactly."
    artifacts:
      - path: "apps/worker/src/runtime/supervisor.ts"
        issue: "Runs are scheduled only on the 15 s tick, so intervals that are not multiples of 15 are rounded up"
    missing:
      - "Schedule from nextRunAt (tick timeout = min(tickMs, earliest nextRunAt - now)), or require multiples of 15 with a minimum of 15"
deferred:
  - truth: "FND-02: the config declares the LLM confidence threshold"
    addressed_in: "Phase 3"
    evidence: "Phase 3 success criterion 3: 'An LLM result below the confidence threshold is marked for review rather than given a category'; CLS-04 (default 0.75). CONTEXT D-59/D-71 place `tiers` thresholds in Phase 3. ROADMAP SC2 for Phase 1 does not include the threshold."
human_verification:
  - test: "On the target home machine (Mac mini or Linux mini PC), follow the README quick start: copy the three example files, fill in passwords, run `docker compose up -d`"
    expected: "db healthy, setup exits 0 (backup written to ./backups, 5 rows in drizzle.__drizzle_migrations, mailboxes registered), worker reaches healthy"
    why_human: "SC1 is defined on the owner's target machine. On Linux with owner uid != 1000, expect the ./backups failure described in gap 1 until it is fixed."
  - test: "After a real bring-up with real Bridge passwords: grep -r for each real password in config/, and in a pg_dump of the sift database"
    expected: "No match anywhere"
    why_human: "The automated half (sentinel test) passes. The real secrets exist only on the owner's machine."
  - test: "Push to GitHub and check the Actions run"
    expected: "Job `check` is green (lint, typecheck, catalog + isolation + all tests against the PG18 service). Job `compose-smoke` is green once gap 1 is fixed."
    why_human: "CI on GitHub-hosted runners cannot be observed from here. SC3's 'fails the build' depends on the check job actually running there."
  - test: "Confirm the 01-06 backstop truth: every isolation assertion in packages/db/test/isolation.test.ts and owner-rls.test.ts compares row sets by id (sortedIds / arrayContaining), never by position"
    expected: "No positional comparison of query results"
    why_human: "Non-inferable (verification: backstop) truth. A static read found only sortedIds()/arrayContaining/every-based comparisons, but the protocol requires explicit evidence, which a static read does not provide."
---

# Phase 1: Foundation and Isolation Verification Report

**Phase Goal:** The owner can start the stack on the home machine and the database enforces mailbox isolation before any mail-derived data exists.
**Verified:** 2026-10-04T08:30:22Z
**Status:** gaps_found
**Re-verification:** No. This is the initial verification.

The database half of the goal is achieved and proven by behavioural tests: schema, forced RLS, catalog gate, two-mailbox isolation, the scoped API and secret handling. The "start the stack" half has one confirmed blocker. The CI full-stack smoke job cannot pass on Linux (CR-01, reproduced), and the same root cause, `./backups` not being writable by uid 1000, can stop the first `docker compose up` on a Linux home machine whose owner uid is not 1000. Bring-up on the real target machine still needs a human.

## Goal Achievement

### Observable Truths: Roadmap Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Owner runs Docker Compose on the target machine and gets a running Postgres (with pgvector) and worker, with migrations applied | ? UNCERTAIN (human) | compose.yaml defines db -> setup (service_completed_successfully) -> worker, with heartbeat healthcheck and loopback port; Dockerfile builds a non-root node image with pg_dump 18; setup runs config check -> migrate (backup first) -> config apply. Dev DB (read-only check): 5 migrations, vector 0.8.7, PG 18.6, forced RLS on all 7 scoped tables. I did not observe a full db+setup+worker stack (only sift-db-1 is running); the summary's isolated macOS smoke is a claim. On Linux, gap 1 applies. |
| SC2 | Mailbox password is read only from the env var named by password_env; config files and DB contain no password | ✓ VERIFIED (automated half) | Schema `PasswordEnv` accepts only an env var NAME (schema.ts); literal password/secret/token keys are rejected without echoing the value (config.test.ts:186-204); mailbox table stores `password_env` only. no-secret-leak.test.ts runs config apply plus a real worker process with sentinel passwords, then scans every config file, every row of every table (pg_tables) and all process output: 5/5 pass in isolation. It timed out in the full run at load avg ~100 (15 s window). Manual grep with real passwords is a human item. |
| SC3 | A schema check fails the build if any table holding mail-derived data lacks a non-null mailbox_id | ✓ VERIFIED | packages/db/test/support/catalog.ts scans every relation outside pg_catalog/information_schema that is not on a 2-entry allowlist and checks attnotnull on mailbox_id, the FK to mailbox, RLS enabled and forced, and exactly one standard policy. catalog.test.ts has negative tests: rogue table, `drop not null` on message.mailbox_id, stale allowlist, extra policy, privilege drift. All pass. CI job `check` runs `pnpm test` with SIFT_TEST_ADMIN_URL after bootstrapping PG18+pgvector, and DB tests throw rather than skip in CI. GitHub run not observed (human item). |
| SC4 | With two seeded mailboxes, queries under A's app.mailbox_id return/modify none of B's rows even without the app filter; with no setting they return nothing | ✓ VERIFIED | isolation.test.ts runs as a raw sift_app pg client with no WHERE filter, across all 7 scoped tables. Reads under A return only A's rows. Updates/deletes aimed at B affect 0 rows. An unfiltered UPDATE touches only A's rows and leaves B's updated_at unchanged. Inserting B rows under A fails with 42501. A fresh connection, and a reused one after commit, reads 0 rows. Non-UUID -> 22P02; upper-case UUID scopes to A; empty mailbox C reads 0. owner-rls.test.ts shows FORCE RLS binds sift_owner. All pass in the full run. Migrations 0001/0003/0004 carry the exact policy and FORCE on every scoped table. |

### Observable Truths: Plan must_haves (99 after removing 4 that restate SC1-SC4)

| Plan | Truths | Status | Evidence / notes |
|------|--------|--------|------------------|
| 01-01 workspace/CLI | 6 | ✓ 6 | `node apps/worker/src/cli.ts --help` exits 0 and lists all 7 commands with no build step. `pnpm lint` exit 0 (1 warning), `pnpm typecheck` exit 0, `pnpm test` (below). Biome guard reproduced in a scratch copy of biome.json: `import pg` / `drizzle-orm/sql` under apps/worker/src -> 2 noRestrictedImports errors; packages/db/src not flagged. pnpm-workspace has minimumReleaseAge 10080 + allowBuilds (artifact check). |
| 01-02 Postgres bootstrap | 6 | ✓ 6 | compose.yaml: pgvector/pgvector:0.8.7-pg18-trixie, `127.0.0.1:${SIFT_DB_PORT}` port, sift-pgdata:/var/lib/postgresql, initdb mount. Live roles: sift_owner (no super/bypass), sift_backup (bypass), sift_app (neither). compose.test.ts loopback/volume tests pass. |
| 01-03 schema + migrate | 9 | ✓ 9 | Migrations 0000-0004 read in full: uuidv7() PKs, NOT NULL mailbox_id with ON DELETE restrict FK, composite (mailbox_id, message_id) FKs for label/decision, one `mailbox_isolation` policy per table TO sift_app, sift_owner, FORCE RLS, grants per D-40. migrate.test + global-setup template DB pass. |
| 01-04 config | 12 | ✓ 12 | Zod strictObject schema; config/env/log/example-config tests pass (full run). |
| 01-05 catalog + CI | 9 | ✓ 9 | See SC3. Caveats WR-06 (column-level SELECT/INSERT grants unseen) and WR-07 (memberships in other RLS-bypassing roles unseen) are warnings; the stated truths hold as written. |
| 01-06 isolation | 11 | ✓ 10, ⚠️ 1 insufficient_spec | See SC4. The backstop truth "compare by id, never by position" abstains under the protocol; the static read supports it (human item 4). |
| 01-07 scoped API | 8 | ✓ 8 | scope.ts: every helper builds `and(eq(table.mailboxId, mailboxId), ...)`; set_config is parameterized. The @sift/db root export has no pool/client/drizzle. scope.test.ts "application filter without RLS (superuser connection)" passes. |
| 01-08 migrate + backup | 6 | ✓ 6 | migrate.ts takes the backup before ensureAppRole/migrator. migrate.test.ts 15/15 in isolation, including the unwritable-dir, no-backup-target and both-mailboxes-in-dump cases. The backup test timed out at 30 s in the full run under load. |
| 01-09 registry | 8 | ✓ 8 | registry/registry-plan/registry-cli tests pass. WR-05 (rename hint pairing with 2+ simultaneous renames) is a warning. |
| 01-10 worker runtime | 8 | ✓ 6, ✗ partial 2 | Startup order (checkMailboxEnv before createAppDb), tick/heartbeat, no-overlap, backoff and disable all pass supervisor/worker tests. Partial: bounded shutdown (WR-03) and exact poll interval (WR-08). See gaps 2-3. |
| 01-11 startup guard | 3 | ✓ 3 | connectWithRetry -> assertUnprivilegedRole -> checkDrift before the supervisor. The guard rejects rolsuper/rolbypassrls as stated. WR-02 (accepts sift_owner) is a warning; isolation still holds because the policy also binds sift_owner. |
| 01-12 compose stack | 7 | ✓ 6, ✗ 1 FAILED | Dockerfile/compose/credential split/healthcheck/node-version all hold (compose.test, node-version.test). FAILED: compose-smoke CI job cannot pass on Linux (gap 1). |
| 01-13 docs | 6 | ✓ 6 | README quick start, lifecycle and CONTRIBUTING loop present. user-facing-text.test.ts D-69 scan passes. |

**Score:** 98/103 must-haves verified. Not verified: SC1 (needs a human on the target machine), 01-12 compose-smoke (FAILED), 01-10 shutdown and poll interval (partial), 01-06 backstop (insufficient_spec). behavior_unverified: 0.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | FND-02 "LLM confidence threshold" in config | Phase 3 | Phase 3 SC3 plus CLS-04 (default 0.75); CONTEXT D-59/D-71 explicitly move the `tiers` thresholds to Phase 3 |

### Required Artifacts

`gsd-tools verify.artifacts` across all 13 plans: 67/67 artifacts pass for existence and substance. I read and confirmed by hand the artifacts that carry the goal: migrations 0000-0004, rls.ts, schema/index.ts, support/catalog.ts, catalog.test.ts, isolation.test.ts, seed.ts, scope.ts, connect.ts, migrate.ts, backup.ts, worker.ts, compose.yaml, Dockerfile, ci.yml, compose-smoke.sh, no-secret-leak.test.ts and README quick start.

### Key Link Verification

`gsd-tools verify.key-links`: 33/36 auto-verified. The 3 misses are parse failures, because the `from:` fields carry parentheticals. I confirmed them by hand:

| From | To | Via | Status |
|------|----|-----|--------|
| compose.yaml (setup) | apps/worker/src/commands/setup.ts | `command: ["sift", "setup"]` + /usr/local/bin/sift wrapper in Dockerfile | WIRED |
| compose.yaml (worker) | .env.mailboxes | `env_file: - .env.mailboxes` | WIRED |
| README.md quick start | scripts/compose-smoke.sh | README:396 `cp .env.mailboxes.example .env.mailboxes`; user-facing-text.test checks the order | WIRED |
| schema/scoped.ts | rls.ts | `mailboxIsolation()` on every scoped table -> migration policies | WIRED |
| worker.ts | connect.ts | connectWithRetry -> assertUnprivilegedRole -> checkDrift (lines 83-95) | WIRED |
| ci.yml check | db/bootstrap.sql + vitest | `docker exec ... psql -f - < db/bootstrap.sql`, then `pnpm test` with SIFT_TEST_ADMIN_URL | WIRED |
| ci.yml compose-smoke | scripts/compose-smoke.sh | `scripts/compose-smoke.sh --down` | WIRED but cannot pass on Linux (gap 1) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| mailbox registry | mailbox rows | config.yaml -> applyConfig (owner tx under advisory lock) | yes (registry-cli, no-secret-leak add both example mailboxes) | ✓ FLOWING |
| mailbox_status | state/last_seen/last_error | supervisor -> createMailboxCallbacks -> withMailbox(requireActive) -> status use-cases | yes (worker test sees 2 rows state 'ok'; error path stores [REDACTED]) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI lists all Phase 1 commands, no build | `node apps/worker/src/cli.ts --help` | 7 commands, exit 0 | ✓ PASS |
| Lint gate | `pnpm lint` | exit 0, 1 warning (noTemplateCurlyInString in node-version.test.ts:26) | ✓ PASS |
| Typecheck incl. @ts-expect-error scope checks | `pnpm typecheck` | exit 0 | ✓ PASS |
| Full test suite (run once) | `pnpm test` | 265 passed, 4 failed (all timeouts: no-secret-leak x2 [1 cascades], worker tracer, migrate backup), 0 skipped, load avg 42-114 | see re-runs |
| Re-run of the timed-out files alone | `vitest run <file>` | no-secret-leak 5/5, worker 2/2, migrate 15/15 | ✓ PASS |
| ISO-04 import guard | biome lint on a probe file in a scratch copy of biome.json | 2 noRestrictedImports errors under apps/worker/src | ✓ PASS |
| Dev DB state (read-only) | psql selects on sift-db-1 | 5 migrations, vector 0.8.7, role flags correct, rls+force on 7 tables, 0 mailboxes | ✓ PASS |
| CR-01 mechanism | throwaway `docker run --rm sift:local` with uid-1001-owned 0600 config / 0755 backups | config read EACCES; backups "not writable" | ✗ FAIL (gap 1) |

### Probe Execution

Step 7c: no `scripts/*/tests/probe-*.sh` exist and none are declared in the plans or summaries. scripts/compose-smoke.sh is the phase's runnable check. I did not run it, because it starts services and its `--down` path touches the sift-pgdata volume (WR-01). I reproduced its failure mechanism in isolation instead.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FND-01 | 01-02, 01-05, 01-08, 01-10, 01-11, 01-12, 01-13 | Stack up with Compose, migrations applied | ? PARTIAL / NEEDS HUMAN | Compose/Dockerfile/setup wired. Not observed end to end. CI smoke cannot pass and Linux uid != 1000 fails (gap 1). |
| FND-02 | 01-04, 01-09, 01-10, 01-11, 01-12, 01-13 | Mailbox + model settings in config.yaml; password only from env | ✓ SATISFIED (threshold deferred to Phase 3) | strict schema, password_env name only, sentinel test |
| FND-03 | 01-01, 01-03, 01-13 | apps/worker, packages/core, packages/db; Drizzle schema + migrations in packages/db | ✓ SATISFIED | layout present; drizzle-orm node-postgres only |
| ISO-01 | 01-03, 01-05, 01-06 | Non-null mailbox_id FK on every mail-derived table | ✓ SATISFIED | migrations + catalog gate + NULL insert test (23502) |
| ISO-02 | 01-02, 01-03, 01-05, 01-06, 01-11 | RLS keyed on app.mailbox_id, forced, missing setting -> no rows | ✓ SATISFIED | policies/FORCE in migrations; isolation tests |
| ISO-03 | 01-06 | Automated two-mailbox test without app filter | ✓ SATISFIED | isolation.test.ts |
| ISO-04 | 01-07 | App code filters by mailbox_id explicitly | ✓ SATISFIED | scope.ts helpers + superuser no-RLS test + Biome guard |

Every phase requirement ID (FND-01..03, ISO-01..04) is claimed by at least one plan. REQUIREMENTS.md maps no other ID to Phase 1, so nothing is orphaned. REQUIREMENTS.md marks FND-01 "Complete". This report disagrees until gap 1 is closed and SC1 is confirmed on the target.

### Test Quality Audit

| Test File | Linked Req | Skipped | Circular | Assertion Level | Verdict |
|-----------|-----------|---------|----------|-----------------|---------|
| packages/db/test/catalog.test.ts | ISO-01, ISO-02 (SC3) | 0 | no | Value (exact violation strings) + negative cases | ✓ |
| packages/db/test/isolation.test.ts | ISO-02, ISO-03 (SC4) | 0 | no (ground truth read as superuser) | Behavioral, by id sets and SQLSTATE codes | ✓ |
| packages/db/test/owner-rls.test.ts | ISO-02 (D-70) | 0 | no | Behavioral | ✓ |
| packages/db/test/scope.test.ts | ISO-04 | 0 | no | Behavioral + type-level @ts-expect-error | ✓ |
| apps/worker/test/no-secret-leak.test.ts | FND-02 (SC2) | 0 | no; has a positive control for the scanner | Behavioral (real CLI + worker processes, full DB scan) | ✓ |
| packages/db/test/migrate.test.ts | FND-01 | conditional `ctx.skip` only outside CI; `requirePgDump` throws under CI | no | Behavioral | ✓ |
| apps/worker/test/compose.test.ts | FND-01 | 0 | no | Static contract (cannot detect host uid/permission problems such as CR-01) | ⚠️ insufficient for the CI smoke truth |

Disabled tests on requirements: 0. Circular patterns: 0. Insufficient assertions: 1 (compose.test.ts is static; a warning).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| scripts/compose-smoke.sh | 43, 66 | `umask 077` applies to a file a uid-1000 container must read; backups/ never made writable | 🛑 Blocker | CI compose-smoke permanently red (gap 1) |
| scripts/compose-smoke.sh / compose.yaml | 18, 72 / 103-105 | COMPOSE_PROJECT_NAME does not isolate the pinned `sift-pgdata` volume; `--down` runs `down -v` (WR-01) | ⚠️ Warning | Data-loss risk for the owner's DB when run with a project override or CI=true locally |
| apps/worker/src/commands/worker.ts | 122-129 | Unbounded `db.close()` after drain timeout (WR-03) | ⚠️ Warning | gap 2 |
| apps/worker/src/runtime/supervisor.ts | tick | Fixed 15 s tick rounds intervals up (WR-08) | ⚠️ Warning | gap 3 |
| packages/db/src/connect.ts | 157-174 | Role guard accepts sift_owner (WR-02) | ⚠️ Warning | Worker could run with DDL rights; RLS still binds the owner |
| packages/db/test/support/catalog.ts | 126-136, 411-429 | Column-level SELECT/INSERT and other bypass-role memberships unseen (WR-06, WR-07) | ⚠️ Warning | Privilege-drift blind spots; ISO-01 non-null check unaffected |
| packages/db/src/owner/migrate.ts | 92-106 | Count-based pending vs drizzle timestamp compare (WR-04) | ⚠️ Warning | Out-of-order migration could be silently skipped |
| apps/worker/src/commands/config-apply.ts | 17-40 | Rename hint pairs slugs arbitrarily (WR-05) | ⚠️ Warning | Could steer the owner into mis-attaching history |
| (none) | - | TBD/FIXME/XXX/TODO/HACK | - | None found in tracked source |

### Decision Coverage

All 71 trackable CONTEXT.md decisions are honored by shipped artifacts (`check.decision-coverage-verify`: 71/71, none missing).

### Human Verification Required

### 1. Target-machine bring-up (SC1)

**Test:** On the Mac mini or Linux mini PC, follow README quick start steps 1-5 and run `docker compose up -d`.
**Expected:** db healthy; setup exits 0 after writing a dump to ./backups and recording 5 migrations; worker healthy.
**Why human:** The success criterion is defined on the owner's machine. On Linux with uid != 1000, expect the ./backups failure until gap 1 is fixed.

### 2. Real-password grep (SC2 manual half)

**Test:** After a real bring-up, grep config/ and a pg_dump of `sift` for each real Bridge password.
**Expected:** No match.
**Why human:** Real secrets exist only on the target machine.

### 3. CI on GitHub

**Test:** Push and inspect the Actions run.
**Expected:** `check` is green. `compose-smoke` is green after the gap 1 fix.
**Why human:** GitHub-hosted runners cannot be observed from here.

### 4. Backstop: id-based comparisons in isolation tests

**Test:** Read isolation.test.ts and owner-rls.test.ts assertions.
**Expected:** Only id-set comparisons (sortedIds, arrayContaining, every), with no positional indexing of query results.
**Why human:** Non-inferable truth; abstained under the honest-verifier protocol.

### Gaps Summary

The isolation guarantee, the core of this phase, is real and proven by behavioural tests. Forced RLS with one exact policy on all seven scoped tables binds both sift_app and sift_owner. A catalog gate fails on a nullable or missing mailbox_id and is wired into CI's `check` job. The two-mailbox test runs as raw sift_app with no filter. The scoped API adds its own mailbox filter. Mailbox secrets never persist.

The gap is in "the owner can start the stack." One root cause: Linux file ownership between the host and the uid-1000 container user, which Docker Desktop on macOS hides.
1. **Blocker (CR-01, reproduced):** The CI `compose-smoke` job can never pass on GitHub's Linux runners. config.yaml is created 0600 under `umask 077`, and ./backups is not writable by uid 1000. The build is permanently red, which also weakens the "fails the build" signal SC3 relies on.
2. Same root cause, owner-facing: on a Linux mini PC whose uid is not 1000, the first `docker compose up` fails in setup at the pre-migration backup. The README gives no remedy, and the error text names the container path rather than the host path.

Two non-blocking partials from the review are listed as gaps so the closure plan can pick them up: unbounded pool close on shutdown (WR-03) and poll-interval rounding (WR-08). The remaining review warnings (WR-01, WR-02, WR-04 to WR-07) do not falsify a success criterion as written. They are recorded under Anti-Patterns. WR-01 deserves priority because it can delete the owner's database volume.

---

_Verified: 2026-10-04T08:30:22Z_
_Verifier: Claude (gsd-verifier)_
