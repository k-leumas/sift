---
phase: 01-foundation-and-isolation
verified: 2026-10-05T02:12:30Z
status: passed
score: 100/103 must-haves verified (roadmap success criteria 3/4; SC1 needs the target machine)
covered_files: [".dockerignore", ".env.development.example", ".env.example", ".env.mailboxes.example", ".github/dependabot.yml", ".github/workflows/ci.yml", ".gitignore", ".nvmrc", ".planning/phases/01-foundation-and-isolation/01-01-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-01-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-02-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-02-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-03-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-03-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-04-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-04-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-05-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-05-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-06-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-06-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-07-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-07-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-08-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-08-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-09-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-09-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-10-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-10-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-11-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-11-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-12-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-12-SUMMARY.md", ".planning/phases/01-foundation-and-isolation/01-13-PLAN.md", ".planning/phases/01-foundation-and-isolation/01-13-SUMMARY.md", "CONTRIBUTING.md", "Dockerfile", "README.md", "apps/worker/package.json", "apps/worker/src/cli.ts", "apps/worker/src/command.ts", "apps/worker/src/commands/config-apply.ts", "apps/worker/src/commands/config-check.ts", "apps/worker/src/commands/mailbox-list.ts", "apps/worker/src/commands/mailbox-rename.ts", "apps/worker/src/commands/migrate.ts", "apps/worker/src/commands/setup.ts", "apps/worker/src/commands/worker.ts", "apps/worker/src/runtime/backoff.ts", "apps/worker/src/runtime/heartbeat.ts", "apps/worker/src/runtime/mailbox-batch.ts", "apps/worker/src/runtime/run-until-stopped.ts", "apps/worker/src/runtime/shutdown.ts", "apps/worker/src/runtime/startup.ts", "apps/worker/src/runtime/supervisor.ts", "apps/worker/test/ci-workflow.test.ts", "apps/worker/test/cli.test.ts", "apps/worker/test/compose-smoke.test.ts", "apps/worker/test/compose.test.ts", "apps/worker/test/drift.test.ts", "apps/worker/test/lint-guard.test.ts", "apps/worker/test/no-secret-leak.test.ts", "apps/worker/test/node-version.test.ts", "apps/worker/test/registry-cli.test.ts", "apps/worker/test/run-until-stopped.test.ts", "apps/worker/test/setup.test.ts", "apps/worker/test/supervisor.test.ts", "apps/worker/test/user-facing-text.test.ts", "apps/worker/test/worker-errors.test.ts", "apps/worker/test/worker.test.ts", "apps/worker/tsconfig.json", "backups/.gitkeep", "biome.json", "commitlint.config.js", "compose.yaml", "config/config.example.yaml", "db/bootstrap.sql", "docs/adr/0003-traces-and-mail-app-relabels.md", "lefthook.yml", "package.json", "packages/core/package.json", "packages/core/src/config/env.ts", "packages/core/src/config/errors.ts", "packages/core/src/config/index.ts", "packages/core/src/config/load.ts", "packages/core/src/config/schema.ts", "packages/core/src/config/slug.ts", "packages/core/src/index.ts", "packages/core/src/log.ts", "packages/core/test/config.test.ts", "packages/core/test/env.test.ts", "packages/core/test/example-config.test.ts", "packages/core/test/log.test.ts", "packages/core/tsconfig.json", "packages/db/drizzle.config.ts", "packages/db/migrations/0000_extensions.sql", "packages/db/migrations/0001_registry_and_message.sql", "packages/db/migrations/0002_message_force_grants.sql", "packages/db/migrations/0003_scoped_tables.sql", "packages/db/migrations/0004_scoped_tables_force_grants.sql", "packages/db/migrations/meta/0000_snapshot.json", "packages/db/migrations/meta/0001_snapshot.json", "packages/db/migrations/meta/0002_snapshot.json", "packages/db/migrations/meta/0003_snapshot.json", "packages/db/migrations/meta/0004_snapshot.json", "packages/db/migrations/meta/_journal.json", "packages/db/package.json", "packages/db/src/app-db.ts", "packages/db/src/connect.ts", "packages/db/src/index.ts", "packages/db/src/owner/backup.ts", "packages/db/src/owner/migrate.ts", "packages/db/src/owner/registry.ts", "packages/db/src/owner/scram.ts", "packages/db/src/registry-plan.ts", "packages/db/src/registry-read.ts", "packages/db/src/rls.ts", "packages/db/src/schema/index.ts", "packages/db/src/schema/mailbox.ts", "packages/db/src/schema/scoped.ts", "packages/db/src/scope.ts", "packages/db/src/status.ts", "packages/db/test/catalog.test.ts", "packages/db/test/connect.test.ts", "packages/db/test/global-setup.ts", "packages/db/test/isolation.test.ts", "packages/db/test/migrate.test.ts", "packages/db/test/owner-rls.test.ts", "packages/db/test/registry-plan.test.ts", "packages/db/test/registry.test.ts", "packages/db/test/scope.test.ts", "packages/db/test/scram.test.ts", "packages/db/test/support/catalog.ts", "packages/db/test/support/db.ts", "packages/db/test/support/seed.ts", "packages/db/tsconfig.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "scripts/compose-smoke.sh", "scripts/pg-dump-via-compose.sh", "tsconfig.base.json", "tsconfig.json", "vitest.config.ts"]
covered_digest: "v2:sha256:8b84619e4d7dd310a725274a401c3c0650c7f6f11d5113eef5754155bbf67e7f"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 98/103
  gaps_closed:
    - "CR-01: compose-smoke prepares config.yaml (0644, dir 0755) and a backup dir owned by uid 1000 on Linux; reproduced fixed in a real Linux container with uid 1001 vs 1000 (the pre-fix script fails the same check). The GitHub run itself remains a human item."
    - "WR-03: SIGTERM shutdown closes the pool within a bound after a drain timeout (AppDb.close({ timeoutMs }) ends stuck clients; worker.ts passes CLOSE_TIMEOUT_MS = 3 s)"
    - "WR-08: the per-mailbox interval is worker.poll_interval_seconds exactly (tick at min(15 s, next idle mailbox due))"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "FND-02: the config declares the LLM confidence threshold"
    addressed_in: "Phase 3"
    evidence: "Phase 3 success criterion 3: 'An LLM result below the confidence threshold is marked for review rather than given a category'; CLS-04 (default 0.75). CONTEXT D-59/D-71 place `tiers` thresholds in Phase 3. ROADMAP SC2 for Phase 1 does not include the threshold."
human_verification:
  - test: "On the target home machine (Mac mini or Linux mini PC), follow the README quick start: copy the three example files, fill in passwords, on Linux with `id -u` != 1000 run `sudo chown 1000 backups`, then `docker compose up -d`"
    expected: "db healthy, setup exits 0 (backup written to ./backups, 5 rows in drizzle.__drizzle_migrations, mailboxes registered), worker reaches healthy"
    why_human: "SC1 is defined on the owner's target machine. No full db+setup+worker stack was started during verification (verifier does not start services)."
  - test: "After a real bring-up with real Bridge passwords: grep -r for each real password in config/, and in a pg_dump of the sift database"
    expected: "No match anywhere"
    why_human: "The automated half (no-secret-leak sentinel test) passes. The real secrets exist only on the owner's machine."
  - test: "Push main to GitHub and check the Actions run"
    expected: "Job `check` is green (lint, typecheck, catalog + isolation + all tests against the PG18 service). Job `compose-smoke` is green: setup exits 0, worker healthy, 'compose smoke OK'."
    why_human: "GitHub-hosted runners cannot be observed from here. The CR-01 mechanism is fixed in a Linux container reproduction, but the job has never run on a runner (image build, sudo -n chown, full stack)."
  - test: "Confirm the 01-06 backstop truth: every isolation assertion in packages/db/test/isolation.test.ts and owner-rls.test.ts compares row sets by id (sortedIds / arrayContaining / every), never by position, and no Phase 1 query depends on row order"
    expected: "No positional comparison of query results"
    why_human: "Non-inferable (verification: backstop) truth. A scan for positional indexing found only two single-row reads (owner-rls.test.ts:40 count(*) row, isolation.test.ts:237 current_setting row), neither a row-set comparison; the protocol still requires explicit evidence, which a static read does not provide."
---

# Phase 1: Foundation and Isolation Verification Report

**Phase Goal:** The owner can start the stack on the home machine and the database enforces mailbox isolation before any mail-derived data exists.
**Verified:** 2026-10-05T02:12:30Z
**Status:** human_needed
**Re-verification:** Yes, after gap closure (previous: gaps_found, 98/103, 2026-10-04T08:30:22Z)

All three earlier gaps are closed. I checked the code and tests for each one myself rather than relying on the commit messages. CR-01 is also fixed in a real Linux kernel reproduction. The rest of the phase has no regressions: lint and typecheck pass, and the full suite is green with the dev Postgres up (28 files, 353 tests, 0 failed, 0 skipped). Migrations, RLS policies, rls.ts, scope.ts and schema are byte-identical to the previous verification. What remains needs a human: bring-up on the target machine, the real-password grep, a GitHub Actions run, and one backstop truth that cannot be inferred from the code.

## Goal Achievement

### Observable Truths: Roadmap Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Owner runs Docker Compose on the target machine and gets a running Postgres (with pgvector) and worker, with migrations applied | ? UNCERTAIN (human) | compose.yaml wires db -> setup (`service_completed_successfully`) -> worker, with a heartbeat healthcheck, a loopback-only port and `restart: unless-stopped`. The README quick start now has the Linux `sudo chown 1000 backups` step. Read-only check of the dev DB: 5 migrations, vector 0.8.7, PG 18.6, RLS enabled and forced on all 7 scoped tables. I did not start a full stack. |
| SC2 | Mailbox password is read only from the env var named by password_env; config files and DB contain no password | ✓ VERIFIED (automated half) | `PasswordEnv` accepts only an env var name. Literal secrets are rejected. no-secret-leak.test.ts runs config apply plus a real worker with sentinel passwords, then scans every config file, every table row and all output. It passes in the full run (it timed out under load last time). The real-password grep is a human item. |
| SC3 | A schema check fails the build if any table holding mail-derived data lacks a non-null mailbox_id | ✓ VERIFIED | The support/catalog.ts gate and its negative tests (rogue table, `drop not null`, stale allowlist, extra policy, column-level grants, memberships, REPLICATION) all pass. ci.yml `check` bootstraps PG18 + pgvector and runs `pnpm test` with SIFT_TEST_ADMIN_URL, and DB tests throw rather than skip in CI. The actual GitHub run is a human item. |
| SC4 | With two seeded mailboxes, queries under A's app.mailbox_id return/modify none of B's rows even without the app filter; with no setting they return nothing | ✓ VERIFIED | isolation.test.ts covers all 7 tables as raw sift_app with no WHERE filter. owner-rls.test.ts covers sift_owner. Both pass in the full run. The migrations that carry the policies and FORCE are unchanged since the last verification. |

### Observable Truths: Plan must_haves (99 after removing 4 that restate SC1-SC4)

| Plan | Truths | Status | Evidence / notes |
|------|--------|--------|------------------|
| 01-01 workspace/CLI | 6 | ✓ 6 | `node apps/worker/src/cli.ts --help` exits 0 and lists all 7 commands. `pnpm lint` exits 0 (1 warning). `pnpm typecheck` exits 0. The ISO-04 import guard now has its own automated test (lint-guard.test.ts, including the IN-02 relative/deep-import rule). |
| 01-02 Postgres bootstrap | 6 | ✓ 6 | compose.yaml image, loopback port and volume are unchanged in substance. The volume name is now `${SIFT_PGDATA_VOLUME:-sift-pgdata}`, the WR-01 smoke override, and the owner default is unchanged. Live role flags: sift_app, sift_owner and sift_backup have no superuser or REPLICATION, and only sift_backup has BYPASSRLS. The bootstrap.sql diff is a comment only. |
| 01-03 schema + migrate | 9 | ✓ 9 | Migrations 0000-0004 and their snapshots are unchanged. migrate.test.ts passes, including the new WR-04 identity-based skip detection. |
| 01-04 config | 12 | ✓ 12 | The schema.ts change only extracts the shared `imapIdentityKey`, which now trims values (IN-01). Config tests pass. |
| 01-05 catalog + CI | 9 | ✓ 9 | See SC3. The old WR-06/WR-07 caveats are fixed and covered by catalog.test.ts:115/135/161. |
| 01-06 isolation | 11 | ✓ 10, ? 1 insufficient_spec | See SC4. The backstop truth abstains under the protocol (human item 4). |
| 01-07 scoped API | 8 | ✓ 8 | scope.ts is unchanged. scope.test.ts passes, including the superuser no-RLS application-filter test. |
| 01-08 migrate + backup | 6 | ✓ 6 | migrate.test.ts passes in the full run (it timed out under load last time). |
| 01-09 registry | 8 | ✓ 8 | registry, registry-plan and registry-cli tests pass. WR-05 is fixed: renames pair by IMAP identity (registry-plan.test.ts:143). |
| 01-10 worker runtime | 8 | ✓ 8 | **Gap 2 (WR-03) closed. Gap 3 (WR-08) closed.** See below. |
| 01-11 startup guard | 3 | ✓ 3 | connectWithRetry -> assertUnprivilegedRole -> checkDrift is unchanged. The guard now also refuses sift_owner, members of other roles and REPLICATION (connect.test.ts:184/197/224). |
| 01-12 compose stack | 7 | ✓ 6, ? 1 (human) | **Gap 1 (CR-01) mechanism closed.** The compose-smoke CI truth now waits only on an observed GitHub run (human item 3). See below. |
| 01-13 docs | 6 | ✓ 6 | The README quick start now has the Linux step. user-facing-text.test.ts passes. |

**Score:** 100/103 must-haves verified. Not verified: SC1 (needs the target machine), the 01-12 compose-smoke CI truth (needs a GitHub run), and the 01-06 backstop (insufficient_spec). behavior_unverified: 0.

### Gap closure detail

**Gap 1, CR-01 (compose-smoke on Linux): CLOSED in code, CI run pending a human.**
- scripts/compose-smoke.sh: `(umask 022 && mkdir -p ".smoke/$project/config")` runs before `umask 077`. config.yaml is written by `(umask 022 && sed ... > "$smoke_dir/config/config.yaml")`. On Linux, when the host uid is not 1000 and the backup dir is not owned by 1000, the script runs `sudo -n chown 1000 <backup dir>` and fails with a clear message, before any docker call, if it cannot. The .env files stay 0600.
- I reproduced this independently in a throwaway `sift:local` container (a real Linux kernel): a uid-1001 "runner" ran the script with CI=true, a docker shim and a sudo shim that I then applied as root. HEAD result: config dir `755 1001`, config.yaml `644 1001`, backups `700 1000`, both .env files `600`. As `node` (uid 1000), `sift config check --schema-only` gave "Config OK: 2 mailboxes", and a file write into backups succeeded. Negative control with the pre-fix script (`3249ce5~1`): config.yaml `600 1001`, backups `755 1001`, `config check` failed with EACCES, and the backups write threw.
- compose-smoke.test.ts (CR-01 block, 5 tests) passes, including the Linux uid-1001 chown branch, which ran because the host uid is 501.
- The README quick start step 5 now tells Linux owners whose uid is not 1000 to run `sudo chown 1000 backups`.
- ci.yml needs no extra step, because the script runs the chown itself. GitHub runners have passwordless sudo.

**Gap 2, WR-03 (bounded pool close): CLOSED.** packages/db/src/app-db.ts `close({ timeoutMs })` waits up to timeoutMs for `pool.end()`. After that it ends every tracked client (a TrackedClient subclass registered at construction, so clients mid-handshake are included, IN-12), destroys their sockets and waits at most 1 s more. apps/worker/src/commands/worker.ts calls `db.close({ timeoutMs: CLOSE_TIMEOUT_MS = 3_000 })` in `finally`: 20 s drain + 3 s + 1 s stays inside the 30 s `stop_grace_period`. Tests: scope.test.ts "ends a client stuck in a lock wait once the timeout passes" (a real lock wait, forced:true, under 5 s, and the stuck query rejects) and "ends a client still in its startup handshake" pass. supervisor.test.ts "stop gives up after the timeout and resolves drained false" passes. worker.test.ts SIGTERM -> exit 0 passes.

**Gap 3, WR-08 (exact poll interval): CLOSED.** supervisor.ts `nextTickAt` = min(now + 15 s, the earliest `nextRunAt` of any idle mailbox). `runMailbox` sets `nextRunAt = startedAt + slots * pollIntervalMs` and calls `wakeAt`. Tests "runs every 10000/20000/61000 ms exactly", "still touches the heartbeat at least every 15 s", "keeps the interval measured from the run start" and "does not spin when the registry read keeps failing" all pass.

**IN-05 (since the last verification):** after 3 missed heartbeats in a row the supervisor resolves `stalled`. runUntilStopped then logs the step, reason and redacted error, drains, and returns 75. worker.ts adds an unref'd 2 s backstop exit. compose uses `restart: unless-stopped`. Tests in run-until-stopped.test.ts and supervisor.test.ts (the "missed heartbeats (IN-05)" block, 6 tests) pass. compose-smoke treats any worker restart as a failure, which stays correct.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | FND-02 "LLM confidence threshold" in config | Phase 3 | Phase 3 SC3 plus CLS-04 (default 0.75). CONTEXT D-59/D-71 move the `tiers` thresholds to Phase 3. |

### Required Artifacts

The goal-carrying artifacts were confirmed in the previous verification (67/67 for existence and substance), and the isolation-critical ones are unchanged since. I re-read every artifact touched since 99d9b2e that bears on a gap or must-have: compose-smoke.sh, compose.yaml, ci.yml, README.md step 5, worker.ts, app-db.ts, supervisor.ts, run-until-stopped.ts, schema.ts diff and bootstrap.sql diff. New artifacts: run-until-stopped.ts (substantive, imported and used by worker.ts), scram.ts (used by migrate's ensureAppRole and tested by scram.test.ts), and compose-smoke.test.ts, lint-guard.test.ts and worker-errors.test.ts (all run in the suite).

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| compose.yaml (setup) | apps/worker/src/commands/setup.ts | `command: ["sift", "setup"]` + /usr/local/bin/sift wrapper | WIRED |
| compose.yaml (worker) | .env.mailboxes | `env_file: ${SIFT_MAILBOXES_ENV_FILE:-.env.mailboxes}` | WIRED |
| ci.yml check | db/bootstrap.sql + vitest | `docker exec ... psql -f - < db/bootstrap.sql`, then `pnpm test` with SIFT_TEST_ADMIN_URL | WIRED |
| ci.yml compose-smoke | scripts/compose-smoke.sh | `scripts/compose-smoke.sh --down` (CI=true is set by GitHub) | WIRED; Linux mechanism fixed; runner run is a human item |
| worker.ts | app-db.ts bounded close | `finally { await db.close({ timeoutMs: CLOSE_TIMEOUT_MS }) }` | WIRED |
| worker.ts | run-until-stopped.ts | `exitCode = await runUntilStopped(supervisor, log, waitForShutdownSignal, SHUTDOWN_TIMEOUT_MS)` | WIRED |
| worker.ts | connect.ts | connectWithRetry -> assertUnprivilegedRole -> checkDrift | WIRED |
| schema/scoped.ts | rls.ts | `mailboxIsolation()` on every scoped table -> migration policies | WIRED (unchanged) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| mailbox registry | mailbox rows | config.yaml -> applyConfig (owner tx under advisory lock) | yes (registry-cli and no-secret-leak tests) | ✓ FLOWING |
| mailbox_status | state/last_seen/last_error | supervisor -> createMailboxCallbacks -> withMailbox -> status use-cases | yes (worker tracer test sees rows in state 'ok') | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI lists all Phase 1 commands, no build | `node apps/worker/src/cli.ts --help` | 7 commands, exit 0 | ✓ PASS |
| Lint gate | `pnpm lint` | exit 0, 1 warning (noTemplateCurlyInString, node-version.test.ts:26) | ✓ PASS |
| Typecheck | `pnpm typecheck` | exit 0 (root, core, db, worker) | ✓ PASS |
| Full test suite (run once, dev Postgres up) | `pnpm test` | 28 files, 353 passed, 0 failed, 0 skipped, 52 s | ✓ PASS |
| Gap-closure tests, named | `vitest run compose-smoke supervisor scope run-until-stopped compose --reporter=verbose` | 105/105, including the CR-01 (5), WR-08 (8), bounded close (3) and IN-05 tests | ✓ PASS |
| CR-01 on a real Linux kernel | throwaway `sift:local` container, uid-1001 runner runs HEAD compose-smoke.sh, checked as node (uid 1000) | config 644, backups 700 owned 1000; config check OK; backups writable | ✓ PASS |
| CR-01 negative control | same with `git show 3249ce5~1:scripts/compose-smoke.sh` | config 600 -> EACCES; backups 755 owned 1001 -> write fails | ✓ (reproduction is sensitive) |
| Dev DB state (read-only) | psql selects on sift-db-1 | 5 migrations, vector 0.8.7, PG 18.6, RLS+FORCE on 7 tables, role flags correct | ✓ PASS |

### Probe Execution

Step 7c: no `scripts/*/tests/probe-*.sh` exist, and none are declared in the plans or summaries. scripts/compose-smoke.sh is the phase's runnable full-stack check. I did not run it, because it builds images and starts services. Its file-preparation stage was run for real in the Linux reproduction above, and its guards are covered by compose-smoke.test.ts.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FND-01 | 01-02, 01-05, 01-08, 01-10, 01-11, 01-12, 01-13 | Stack up with Compose, migrations applied | ? NEEDS HUMAN | Compose, Dockerfile and setup are wired. The Linux uid blocker is fixed, and the README has the Linux step. Not observed end to end on the target or on a CI runner. |
| FND-02 | 01-04, 01-09, 01-10, 01-11, 01-12, 01-13 | Mailbox + model settings in config.yaml; password only from env | ✓ SATISFIED (threshold deferred to Phase 3) | Strict schema, password_env holds a name only, sentinel test passes |
| FND-03 | 01-01, 01-03, 01-13 | apps/worker, packages/core, packages/db; Drizzle schema + migrations in packages/db | ✓ SATISFIED | Layout present |
| ISO-01 | 01-03, 01-05, 01-06 | Non-null mailbox_id FK on every mail-derived table | ✓ SATISFIED | Migrations, catalog gate and NULL-insert tests |
| ISO-02 | 01-02, 01-03, 01-05, 01-06, 01-11 | RLS keyed on app.mailbox_id, forced, missing setting -> no rows | ✓ SATISFIED | Policies and FORCE in migrations; isolation and owner-rls tests |
| ISO-03 | 01-06 | Automated two-mailbox test without app filter | ✓ SATISFIED | isolation.test.ts |
| ISO-04 | 01-07 | App code filters by mailbox_id explicitly | ✓ SATISFIED | scope.ts helpers, superuser no-RLS test, Biome guard + lint-guard.test.ts |

All 7 phase IDs are claimed by at least one plan. The REQUIREMENTS.md traceability table maps exactly these 7 IDs to Phase 1, so nothing is orphaned. The table still says "Gaps Found" for all 7, which is now stale and should be updated once the human items are signed off.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| packages/db/src/owner/backup.ts | 56 | Error text says `on Linux run: chown 1000 /backups`, which is the container path. The owner's host path is ./backups. | ℹ️ Info | Could mislead an owner; README step 5 gives the right host command |
| apps/worker/test/compose.test.ts | 191 | Test title "restarts the worker only when it exits with an error" no longer matches `restart: unless-stopped` (the assertion is correct) | ℹ️ Info | Naming only |
| apps/worker/test/node-version.test.ts | 26 | Biome warning noTemplateCurlyInString | ℹ️ Info | Lint still exits 0 |
| (changed files since 99d9b2e) | - | TBD/FIXME/XXX/TODO/HACK | - | None found |

All earlier review warnings (WR-01, WR-02, WR-04 to WR-07, WR-09, CR-02) are dispositioned as fixed in 01-REVIEW-DISPOSITION.md. Each has a named test that passes in the full run: compose-smoke.test.ts WR-01/WR-09/CR-02 blocks, connect.test.ts:184/197/224, migrate.test.ts:267, registry-plan.test.ts:143, and catalog.test.ts:115/135/161.

### Human Verification Required

### 1. Target-machine bring-up (SC1)

**Test:** On the Mac mini or Linux mini PC, follow README quick start steps 1-5. On Linux with `id -u` != 1000, run `sudo chown 1000 backups`. Then run `docker compose up -d`.
**Expected:** db healthy; setup exits 0 after writing a dump to ./backups and recording 5 migrations; worker healthy.
**Why human:** The success criterion is defined on the owner's machine.

### 2. Real-password grep (SC2 manual half)

**Test:** After a real bring-up, grep config/ and a pg_dump of `sift` for each real Bridge password.
**Expected:** No match.
**Why human:** The real secrets exist only on the target machine.

### 3. CI on GitHub

**Test:** Push and inspect the Actions run.
**Expected:** `check` green; `compose-smoke` green, ending in "compose smoke OK".
**Why human:** GitHub-hosted runners cannot be observed from here. The compose-smoke job has never run on a runner.

### 4. Backstop: id-based comparisons in isolation tests

**Test:** Read the assertions in isolation.test.ts and owner-rls.test.ts.
**Expected:** Only id-set comparisons (sortedIds, arrayContaining, every), and no positional indexing of query results.
**Why human:** This is a non-inferable truth, so I abstained under the honest-verifier protocol. A scan found only two single-row reads, neither of them a row-set comparison.

### Gaps Summary

No gaps remain. The three gaps from the 2026-10-04 verification are closed. I checked each one against the code and passing tests, and checked CR-01 against a real Linux uid boundary with a negative control. Nothing regressed: the isolation layer (migrations, policies, rls.ts, scope.ts) is unchanged, and the whole suite passes against the dev Postgres. The phase now needs only the human sign-offs above: bring-up on the target machine, a GitHub Actions run, the real-password grep and the backstop read.

---

_Verified: 2026-10-05T02:12:30Z_
_Verifier: Claude (gsd-verifier)_
