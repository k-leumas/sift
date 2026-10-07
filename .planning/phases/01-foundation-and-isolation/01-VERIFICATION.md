---
phase: 01-foundation-and-isolation
verified: 2026-10-07T23:04:05Z
status: human_needed
score: 103/103 must-haves verified (roadmap success criteria 4/4; 99/99 plan truths, 4 of them reworded by later-phase design but with their intent intact)
covered_files: [".dockerignore",".env.development.example",".env.example",".env.mailboxes.example",".github/dependabot.yml",".github/workflows/ci.yml",".gitignore",".nvmrc",".planning/phases/01-foundation-and-isolation/01-01-PLAN.md",".planning/phases/01-foundation-and-isolation/01-01-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-02-PLAN.md",".planning/phases/01-foundation-and-isolation/01-02-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-03-PLAN.md",".planning/phases/01-foundation-and-isolation/01-03-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-04-PLAN.md",".planning/phases/01-foundation-and-isolation/01-04-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-05-PLAN.md",".planning/phases/01-foundation-and-isolation/01-05-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-06-PLAN.md",".planning/phases/01-foundation-and-isolation/01-06-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-07-PLAN.md",".planning/phases/01-foundation-and-isolation/01-07-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-08-PLAN.md",".planning/phases/01-foundation-and-isolation/01-08-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-09-PLAN.md",".planning/phases/01-foundation-and-isolation/01-09-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-10-PLAN.md",".planning/phases/01-foundation-and-isolation/01-10-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-11-PLAN.md",".planning/phases/01-foundation-and-isolation/01-11-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-12-PLAN.md",".planning/phases/01-foundation-and-isolation/01-12-SUMMARY.md",".planning/phases/01-foundation-and-isolation/01-13-PLAN.md",".planning/phases/01-foundation-and-isolation/01-13-SUMMARY.md","CONTRIBUTING.md","Dockerfile","README.md","apps/worker/package.json","apps/worker/src/cli.ts","apps/worker/src/command.ts","apps/worker/src/commands/config-apply.ts","apps/worker/src/commands/config-check.ts","apps/worker/src/commands/mailbox-backfill.ts","apps/worker/src/commands/mailbox-list.ts","apps/worker/src/commands/mailbox-rename.ts","apps/worker/src/commands/mailbox-resume.ts","apps/worker/src/commands/migrate.ts","apps/worker/src/commands/setup.ts","apps/worker/src/commands/worker.ts","apps/worker/src/imap/capture.ts","apps/worker/src/imap/connect.ts","apps/worker/src/ingest/db-store.ts","apps/worker/src/runtime/backoff.ts","apps/worker/src/runtime/heartbeat.ts","apps/worker/src/runtime/mailbox-batch.ts","apps/worker/src/runtime/run-until-stopped.ts","apps/worker/src/runtime/shutdown.ts","apps/worker/src/runtime/startup.ts","apps/worker/src/runtime/supervisor.ts","apps/worker/test/ci-workflow.test.ts","apps/worker/test/cli.test.ts","apps/worker/test/compose-smoke.test.ts","apps/worker/test/compose.test.ts","apps/worker/test/drift.test.ts","apps/worker/test/lint-guard.test.ts","apps/worker/test/mailbox-batch.test.ts","apps/worker/test/no-secret-leak.test.ts","apps/worker/test/node-version.test.ts","apps/worker/test/registry-cli.test.ts","apps/worker/test/run-until-stopped.test.ts","apps/worker/test/setup.test.ts","apps/worker/test/supervisor.test.ts","apps/worker/test/user-facing-text.test.ts","apps/worker/test/worker-errors.test.ts","apps/worker/test/worker.test.ts","apps/worker/tsconfig.json","backups/.gitkeep","biome.json","commitlint.config.js","compose.yaml","config/config.example.yaml","db/bootstrap.sql","docs/adr/0003-traces-and-mail-app-relabels.md","lefthook.yml","package.json","packages/core/package.json","packages/core/src/config/env.ts","packages/core/src/config/errors.ts","packages/core/src/config/index.ts","packages/core/src/config/load.ts","packages/core/src/config/schema.ts","packages/core/src/config/slug.ts","packages/core/src/index.ts","packages/core/src/log.ts","packages/core/test/config.test.ts","packages/core/test/env.test.ts","packages/core/test/example-config.test.ts","packages/core/test/log.test.ts","packages/core/tsconfig.json","packages/db/drizzle.config.ts","packages/db/migrations/0000_extensions.sql","packages/db/migrations/0001_registry_and_message.sql","packages/db/migrations/0002_message_force_grants.sql","packages/db/migrations/0003_scoped_tables.sql","packages/db/migrations/0004_scoped_tables_force_grants.sql","packages/db/migrations/0005_ingest_preflight.sql","packages/db/migrations/0006_ingest_tables.sql","packages/db/migrations/0007_ingest_tables_force_grants.sql","packages/db/migrations/meta/0000_snapshot.json","packages/db/migrations/meta/0001_snapshot.json","packages/db/migrations/meta/0002_snapshot.json","packages/db/migrations/meta/0003_snapshot.json","packages/db/migrations/meta/0004_snapshot.json","packages/db/migrations/meta/0005_snapshot.json","packages/db/migrations/meta/0006_snapshot.json","packages/db/migrations/meta/0007_snapshot.json","packages/db/migrations/meta/_journal.json","packages/db/package.json","packages/db/src/app-db.ts","packages/db/src/connect.ts","packages/db/src/index.ts","packages/db/src/ingest.ts","packages/db/src/lock.ts","packages/db/src/owner/backup.ts","packages/db/src/owner/migrate.ts","packages/db/src/owner/registry.ts","packages/db/src/owner/scram.ts","packages/db/src/registry-plan.ts","packages/db/src/registry-read.ts","packages/db/src/rls.ts","packages/db/src/schema/index.ts","packages/db/src/schema/mailbox.ts","packages/db/src/schema/scoped.ts","packages/db/src/scope.ts","packages/db/src/status.ts","packages/db/test/catalog.test.ts","packages/db/test/connect.test.ts","packages/db/test/global-setup.ts","packages/db/test/ingest.test.ts","packages/db/test/isolation.test.ts","packages/db/test/lock.test.ts","packages/db/test/migrate.test.ts","packages/db/test/owner-rls.test.ts","packages/db/test/registry-plan.test.ts","packages/db/test/registry.test.ts","packages/db/test/scope.test.ts","packages/db/test/scram.test.ts","packages/db/test/status.test.ts","packages/db/test/support/catalog.ts","packages/db/test/support/db.ts","packages/db/test/support/seed.ts","packages/db/tsconfig.json","pnpm-lock.yaml","pnpm-workspace.yaml","scripts/compose-smoke.sh","scripts/pg-dump-via-compose.sh","tsconfig.base.json","tsconfig.json","vitest.config.ts"]
covered_digest: "v3:sha256:a0c4262379abb23e629e9bdec413e06e4c0e901bca7b4461c1663c4697b77390"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 100/103
  gaps_closed:
    - "Previously human-pending: 01-12 compose-smoke CI truth. Now observed: GitHub run 37586644324 on 7978cb0, job compose-smoke green ('setup exited 0', 'worker healthy', 'compose smoke OK')."
    - "Previously human-pending: SC1 target bring-up. Owner signed it off in 01-UAT.md test 1, and re-observed it on the Phase 2 stack in 02-UAT.md test 1 (cold start: worker boots, migrations up to date)."
    - "Previously insufficient_spec: 01-06 backstop (id-set comparisons). Owner signed it off in 01-UAT.md test 4. Phase 2 added no positional reads: the same three single-row or fixture reads remain, and none compares a row set."
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "FND-02: the config declares the LLM confidence threshold"
    addressed_in: "Phase 3"
    evidence: "Phase 3 success criterion 3: 'An LLM result below the confidence threshold is marked for review rather than given a category'; CLS-04 (default 0.75) mapped to Phase 3 in REQUIREMENTS.md. README lists `tiers.llm.confidence_threshold` under 'Later milestones (not accepted by sift config check yet)'."
human_verification:
  - test: "On the home machine, with real mail ingested and Bridge-written passwords in .env.mailboxes: grep -r for each real Bridge IMAP password in config/, and in a pg_dump of the sift database (taken as sift_backup, or the newest dump in ./backups)"
    expected: "No match anywhere"
    why_human: "Carried forward from the 2026-10-05 sign-off, which ran before any mail was stored and before bridge-init wrote passwords. Phase 2 added a new password-writing path (bridge-init -> .env.mailboxes and .env.mailboxes.bak) and real mail data (message headers jsonb, message_body). The automated sentinel test (no-secret-leak.test.ts) scans every table via pg_tables and passes in CI, but it does not run bridge-init or real IMAP ingest. The real secrets exist only on the owner's machine."
---

# Phase 1: Foundation and Isolation Verification Report

**Phase Goal:** The owner can start the stack on the home machine and the database enforces mailbox isolation before any mail-derived data exists.
**Verified:** 2026-10-07T23:04:05Z
**Status:** human_needed
**Re-verification:** Yes, a regression re-verification against HEAD 325a230. The previous report (2026-10-05) has status `passed` in its frontmatter, `human_needed` in its body, and a score of 100/103. All 4 of its human items were then signed off in 01-UAT.md. Since then Phase 2 (IMAP ingest) and quick task 261007-2ke (release tooling) changed 128 non-planning files, 46 of which the previous report covered.

Every Phase 1 must-have still holds at HEAD. The two new mail tables, message_location and message_body, plus folder_sync and message (which gained columns), fall under all three isolation layers:

- the catalog gate, which is generic over pg_class, so new tables are covered automatically;
- forced RLS, the standard policy and grants in migrations 0006 and 0007;
- the runtime two-mailbox tests, which loop over SCOPED_TABLE_NAMES (now 9 tables, matching the 9 non-allowlisted tables the migrations create).

The scoped API's new helpers and the ingest use-cases all filter by, or fill in, mailbox_id themselves. Redaction is unchanged, with WR-01 hardening added. CI on 7978cb0, which contains all Phase 2 code, is green: `check` passed 49 files and 952 tests with none skipped, including catalog (13), isolation (14), owner-rls (3) and no-secret-leak (5), and `compose-smoke` passed. The 7 commits after 7978cb0 touch only release tooling, the `--version` flag and package versions; none touches the database, isolation, compose or Dockerfile code. One human check stays applicable: the real-password grep, now that real mail and Bridge-written passwords exist.

## Goal Achievement

### Observable Truths: Roadmap Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Owner runs Docker Compose on the target machine and gets a running Postgres (with pgvector) and worker, with migrations applied | ✓ VERIFIED | compose.yaml still wires db (pgvector/pgvector:0.8.7-pg18-trixie, loopback port) -> setup (`service_completed_successfully`) -> worker (heartbeat healthcheck, `restart: unless-stopped`). The Phase 2 bridge service is independent: the worker does not wait for it. CI compose-smoke on 7978cb0 built a fresh stack: setup exited 0, at least 5 migrations recorded (now 8), worker healthy. On the target machine, the owner passed 01-UAT test 1, and 02-UAT test 1 (cold start on the Phase 2 stack: worker boots, migrations up to date). Bring-up now has a one-time `docker volume create sift-bridge` and a Bridge passphrase step, documented in README quick start steps 5-6 (see the supersession note below). |
| SC2 | Mailbox password is read only from the env var named by password_env; config files and DB contain no password | ✓ VERIFIED (automated) + human recheck | `PasswordEnv` still accepts only a name matching `^[A-Z_][A-Z0-9_]*$`, and the strict schema is unchanged. Every password read in apps/worker/src is `env[entry.imap.password_env]` (mailbox-batch.ts:290, mailbox-backfill.ts:133, bridge-probe.ts:195). recordSyncError still applies `redactText` and then truncates. The new `codedCause` (WR-01) keeps Drizzle's params text out of last_error. imapflow `logger: false`. capture.ts never sends credentials. no-secret-leak.test.ts scans every table from pg_tables as the superuser (so it covers message_location and message_body) and passes in CI. The real-password grep is carried forward as a human item. |
| SC3 | A schema check fails the build if any table holding mail-derived data lacks a non-null mailbox_id | ✓ VERIFIED | packages/db/test/support/catalog.ts and catalog.test.ts are byte-identical to the previous verification. The gate treats every relation in pg_class outside the 2-entry allowlist as scoped, so the Phase 2 tables are checked without any list edit: NOT NULL mailbox_id, a single-column FK to mailbox, RLS enabled and forced, exactly one standard policy, UNIQUE (mailbox_id, id), mailbox-aligned FKs, grants and the updated_at trigger. catalog.test.ts (13 tests) passed in CI run 37586644324. The global setup is unchanged: DB tests fail rather than skip in CI. |
| SC4 | With two seeded mailboxes, queries under A's app.mailbox_id return/modify none of B's rows even without the app filter; with no setting they return nothing | ✓ VERIFIED | isolation.test.ts iterates SCOPED_TABLE_NAMES, which now includes message_location and message_body. seed.ts seeds both, and insertStatement builds valid rows for them, so RLS is the only check that can fail. The composite-FK test now covers all 4 message children. owner-rls.test.ts covers the new tables through the same list. Both passed in CI (14 and 3 tests). The policies in 0006 and FORCE in 0007 are the standard D-41 text. |

### Observable Truths: Plan must_haves (99 after removing 4 that restate SC1-SC4)

| Plan | Truths | Status | Regression evidence at HEAD |
|------|--------|--------|-----------------------------|
| 01-01 workspace/CLI | 6 | ✓ 6 | `node apps/worker/src/cli.ts --help` exits 0 on Node 26.10.0 and lists every Phase 1 command plus the Phase 2 commands. `pnpm lint` exits 0 (1 warning), and `pnpm typecheck` exits 0 locally. biome.json (pg/drizzle-orm/src-deep-import guard), pnpm-workspace.yaml, lefthook.yml and commitlint.config.js are unchanged. App imports of `@sift/db/{registry,registry-plan,migrate,connect}` are declared package exports that Phase 1 already used. |
| 01-02 Postgres bootstrap | 6 | ✓ 6 | db/bootstrap.sql, .gitignore and the compose db service are unchanged. |
| 01-03 schema + migrate | 9 | ✓ 9 | 0000-0004 are unchanged. 0006 adds message_location and message_body with NOT NULL mailbox_id, `ON DELETE restrict` FKs, uuidv7() primary keys, composite (mailbox_id, message_id) FKs to message, and the standard policy. 0007 adds FORCE on both tables, `GRANT SELECT, INSERT, UPDATE, DELETE` to sift_app, and the triggers. No TRUNCATE is granted. migrate.test.ts (21) passed in CI. |
| 01-04 config | 12 | ✓ 12 (1 reworded) | The schema is still strict. password_env must be a name. The literal-secret rejection and slug, port and interval rules are unchanged. The config, env and log tests pass locally. Rewording: see the supersessions below (`imap.tls` and `mailboxes[].ingest` added by Phase 2). |
| 01-05 catalog + CI | 9 | ✓ 9 | See SC3. ci.yml only bumps action-setup and adds a Dovecot step for the IMAP tests; the PG18 + bootstrap + `pnpm test` path is unchanged. |
| 01-06 isolation | 12 (incl. backstop) | ✓ 12 | See SC4. Backstop: the owner signed it off in 01-UAT test 4. The positional reads at HEAD (`seededA[0]` fixture, `rowsOf(table, A)[0]` "any A row", the `current_setting` single row, and the owner-rls `count(*)` row) are the same set as in the signed-off version (`git show 22125de:...`). Phase 2 added only `rejects.toMatchObject` and `toHaveLength` assertions. |
| 01-07 scoped API | 8 | ✓ 8 (1 reworded) | scope.ts: every helper, including the new insertOrIgnore, upsert and messageBody.deleteExpired, adds `eq(table.mailboxId, mailboxId)` or fills mailboxId. ON CONFLICT targets prepend mailbox_id, and `mailboxId`, `id` and the timestamps are refused as set, match or target keys. ingest.ts runs only through Scope helpers (no raw SQL). IngestSession exposes only `mailboxId` and `run(fn(scope))`, built on the same runScoped as withMailbox. runScoped and isMailboxId are not re-exported from the root. scope.test.ts (41) passed in CI. Rewording: the root export surface grew with the Phase 2 ingest and lock use-cases; no export yields a pool, client, Drizzle instance or transaction. |
| 01-08 migrate + backup | 6 | ✓ 6 | owner/migrate.ts only adds MigrationFailedError, which surfaces the driver message such as the 0005 preflight text. The advisory lock, the backup-before-pending step and the 0600 dump are unchanged (backup.ts is unchanged). |
| 01-09 registry | 8 | ✓ 8 | owner/registry.ts adds resumeMailbox and listing columns. Both set app.mailbox_id per mailbox and filter `where mailbox_id = $1` (owner under FORCE RLS). registry tests (20), registry-plan (15) and registry-cli (8) passed in CI. |
| 01-10 worker runtime | 8 | ✓ 8 | SUPERVISOR_TICK_MS = 15_000. nextRunAt is computed from `pollIntervalMs`. The batch now runs as `withIngestLock` -> `session.run(..., { requireActive: true })`, the same runScoped path, and records seen, ok, error (redacted) or disabled through the status use-cases. SHUTDOWN_TIMEOUT_MS and CLOSE_TIMEOUT_MS are as before. The missing-env exit-1 path still comes before any DB connection. |
| 01-11 startup guard | 4 (incl. sentinel = SC2) | ✓ | connectWithRetry -> assertUnprivilegedRole -> checkDrift order is unchanged (worker.ts:122-134). connect.ts is unchanged, and connect.test.ts (22) passed in CI. |
| 01-12 compose stack | 8 | ✓ 8 (1 reworded) | The worker env is still only SIFT_DATABASE_URL (sift_app), SIFT_CONFIG, SIFT_HEARTBEAT_FILE and .env.mailboxes. setup gets owner and backup URLs plus SIFT_DB_APP_PASSWORD and no mailbox passwords. Healthcheck 120 s, stop_grace_period 30s and extra_hosts are unchanged. The Dockerfile is unchanged. The compose-smoke CI job is now observed green. Rewording: a clean bring-up now also needs the external `sift-bridge` volume (see below). |
| 01-13 docs | 6 | ✓ 6 (1 reworded) | The README quick start is the current working path (10 steps). Lifecycle text has no delete step. CONTRIBUTING:138-139 still names catalog.test.ts and isolation.test.ts as the gates. user-facing-text.test.ts passes locally. |

**Score:** 103/103 must-haves verified. behavior_unverified: 0.

#### Later-phase supersessions (intent intact, wording outdated)

Phase 2 changed these four Phase 1 truths on purpose. Each truth's protective intent still holds, so none is a regression. Each would need its wording changed if anyone re-plans against it.

| Truth (abridged) | What changed | Why the intent still holds |
|------------------|--------------|----------------------------|
| 01-04: "accepted sections are exactly version, mailboxes(...imap{host,port,username,password_env,folder}...), models, worker; no threshold/tiers" | `imap.tls{mode,pin_sha256}` and `mailboxes[].ingest{initial_backfill_days,new_mail_cap}` were added (Phase 2 D-73/D-74/D-78) | The top-level sections are unchanged and every object is still `z.strictObject`. There is still no threshold or tiers key. `tls.mode` has no plaintext value. |
| 01-07: "root export surface is exactly createAppDb, withMailbox, ..." | The ingest use-cases (storeMessages, folder-sync, resync, body sweep) and withIngestLock/IngestSession were added | Each export takes a Scope or an IngestSession. Nothing exported yields a pool, client, Drizzle instance or transaction (scope.ts, lock.ts read in full). |
| 01-12: "`docker compose up -d` on a clean checkout (after copying the three example files) ... worker healthy" | compose.yaml declares the external volume `sift-bridge` and requires `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE` | The one-time steps are documented (README quick start 5-6, compose.yaml header). db -> setup -> worker is unchanged and proven by CI compose-smoke. |
| 01-13: "README quick start: copy three files, then `docker compose up -d`" | The quick start now has 10 steps (Bridge login, pin) | The underlying truth, that the README quick start is the exact path that works today, holds: it matches compose.yaml and the bridge-init flow. |

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | FND-02 "LLM confidence threshold" in config | Phase 3 | Phase 3 SC3 plus CLS-04 (default 0.75), still Pending and mapped to Phase 3. |

### Required Artifacts (isolation-critical, re-read at HEAD)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/db/migrations/0006_ingest_tables.sql` | New scoped tables with NOT NULL mailbox_id, FK, RLS and the standard policy | ✓ VERIFIED | Both CREATE TABLEs have `mailbox_id uuid NOT NULL`, ENABLE RLS and `mailbox_isolation` FOR ALL TO sift_app, sift_owner with identical USING/WITH CHECK |
| `packages/db/migrations/0007_ingest_tables_force_grants.sql` | FORCE, grants, triggers | ✓ VERIFIED | FORCE on both tables, DML grant, two set_updated_at triggers |
| `packages/db/migrations/0005_ingest_preflight.sql` | Refuses a database with pre-existing message/folder_sync rows | ✓ VERIFIED | Checks each mailbox under its own app.mailbox_id and RAISEs inside the migrator transaction |
| `packages/db/src/schema/index.ts` | SCOPED_TABLE_NAMES covers every scoped table | ✓ VERIFIED | 9 names; the migrations create 10 tables = mailbox (allowlisted) + these 9 |
| `packages/db/src/schema/scoped.ts` | `mailboxIsolation()` on every scoped table | ✓ VERIFIED | 9 calls (lines 87-324) |
| `packages/db/src/scope.ts` | App-side mailbox filter on every helper | ✓ VERIFIED | See 01-07 above |
| `packages/db/src/ingest.ts`, `lock.ts` | New data access stays inside the scope | ✓ VERIFIED, WIRED | Imported by apps/worker/src/ingest/db-store.ts and runtime/mailbox-batch.ts |
| `packages/db/test/support/catalog.ts`, `rls.ts`, `connect.ts`, `app-db.ts`, `db/bootstrap.sql` | Unchanged gates | ✓ VERIFIED | Empty `git diff 22125de HEAD` |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| schema/scoped.ts (message_location, message_body) | rls.ts | `mailboxIsolation()` -> 0006 policies | WIRED |
| catalog gate | new tables | pg_class scan, every non-allowlisted relation is scoped | WIRED (automatic) |
| isolation.test.ts / owner-rls.test.ts | new tables | SCOPED_TABLE_NAMES + seedScopedRows | WIRED |
| no-secret-leak.test.ts | every table | `select ... from pg_tables` as superuser | WIRED (automatic) |
| runtime/mailbox-batch.ts | scoped API | withIngestLock -> session.run(requireActive) -> runScoped | WIRED |
| ingest/db-store.ts | packages/db/src/ingest.ts | one `session.run` per store method | WIRED |
| ci.yml check | catalog/isolation tests | PG18 service + bootstrap.sql + `pnpm test` | WIRED (run 37586644324 green) |
| ci.yml compose-smoke | scripts/compose-smoke.sh | `--down` | WIRED (run 37586644324 green) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| mailbox registry | mailbox rows | config.yaml -> applyConfig (owner tx under advisory lock) | yes (registry-cli in CI) | ✓ FLOWING |
| mailbox_status | state, last_error, valve counts | mailbox-batch -> session.run -> status use-cases | yes (CI smoke: status 'connecting or error' = 2 without IMAP) | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI without a build | `node apps/worker/src/cli.ts --help` | exit 0; every Phase 1 command listed | ✓ PASS |
| Lint | `pnpm lint` | exit 0, 1 warning (node-version.test.ts:26) | ✓ PASS |
| Typecheck | `pnpm typecheck` | exit 0 | ✓ PASS |
| Non-DB Phase 1 tests (local, one run) | `vitest run packages/core/test lint-guard compose node-version user-facing-text ci-workflow compose-smoke cli registry-plan` | 12 files, 305 passed, 0 failed | ✓ PASS |
| Full suite incl. DB (CI, 7978cb0) | `gh run view 37586644324 --log` | 49 files, 952 passed, 0 skipped; catalog 13, isolation 14, owner-rls 3, no-secret-leak 5, scope 41, migrate 21 | ✓ PASS |
| Full stack (CI, 7978cb0) | same run, compose-smoke job | "setup exited 0", "worker healthy", "compose smoke OK" | ✓ PASS |
| DB tests locally | — | not runnable: no local Postgres, Docker down | ? SKIP (covered by CI) |

### Probe Execution

Step 7c: no `scripts/*/tests/probe-*.sh` exist, and the plans and summaries declare none. scripts/compose-smoke.sh is the phase's full-stack check. I did not run it locally (Docker is down). Its result on 7978cb0 is taken from the CI log above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FND-01 | 01-02, 01-05, 01-08, 01-10, 01-11, 01-12, 01-13 | Stack up with Compose, migrations applied | ✓ SATISFIED | CI compose-smoke green; owner bring-up passed in 01-UAT test 1 and 02-UAT test 1 |
| FND-02 | 01-04, 01-09, 01-10, 01-11, 01-12, 01-13 | Mailbox + model settings in config.yaml; password only from env | ✓ SATISFIED (threshold deferred to Phase 3) | Strict schema; password_env holds a name only; sentinel test passes in CI; real-password recheck is a human item |
| FND-03 | 01-01, 01-03, 01-13 | Workspace layout; Drizzle schema + migrations in packages/db | ✓ SATISFIED | Layout unchanged; migrations 0000-0007 in packages/db |
| ISO-01 | 01-03, 01-05, 01-06 | Non-null mailbox_id FK on every mail-derived table | ✓ SATISFIED | All 9 scoped tables, including message_location and message_body; catalog gate + NULL-insert test |
| ISO-02 | 01-02, 01-03, 01-05, 01-06, 01-11 | RLS on app.mailbox_id, forced, missing setting -> no rows | ✓ SATISFIED | 0002/0004/0007 FORCE (9 tables); isolation + owner-rls in CI |
| ISO-03 | 01-06 | Automated two-mailbox test without app filter | ✓ SATISFIED | isolation.test.ts over all 9 tables |
| ISO-04 | 01-07 | App code also filters by mailbox_id | ✓ SATISFIED | scope.ts helpers; ingest.ts only via Scope; owner reads filter explicitly; Biome guard unchanged |

All 7 IDs are claimed by Phase 1 plans and marked Complete for Phase 1 in the REQUIREMENTS.md traceability table. Nothing is orphaned.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| packages/db/src/schema/index.ts | 19 | SCOPED_TABLE_NAMES is maintained by hand, and no test pins it to the catalog's set of scoped tables. The runtime isolation and owner-rls loops would silently skip a future table missing from the list. The catalog gate would still catch its structure. | ℹ️ Info | Holds today (9 = 9). A catalog test asserting equality would close it. |
| packages/db/src/owner/backup.ts | 56 | The error says `chown 1000 /backups` (container path); the host path is ./backups | ℹ️ Info | Carried over; README step 10 gives the right host command |
| apps/worker/test/compose.test.ts | 229 | The title "restarts the worker only when it exits with an error" does not match `restart: unless-stopped` | ℹ️ Info | Naming only (carried over) |
| apps/worker/test/node-version.test.ts | 26 | Biome noTemplateCurlyInString warning | ℹ️ Info | Lint still exits 0 |
| (covered source, tests, migrations, compose, README, CONTRIBUTING) | - | TBD/FIXME/XXX/TODO/HACK | - | None found |

### Human Verification Required

#### 1. Real-password grep after real ingest (SC2 manual half, carried forward)

**Test:** On the home machine, after bridge-init has written the real IMAP passwords and the worker has ingested mail, grep config/ and a pg_dump of `sift` for each real Bridge password.
**Expected:** No match.
**Why human:** The earlier sign-off (2026-10-05) predates stored mail and bridge-init. The automated sentinel test covers every table but not the bridge-init or real-IMAP paths, and the real secrets exist only on the owner's machine.

The other three items from the previous report are closed: SC1 (01-UAT test 1, re-observed in 02-UAT test 1), GitHub CI (run 37586644324 observed green) and the 01-06 backstop (01-UAT test 4, positional-read set unchanged since).

### Gaps Summary

There are no gaps and no regressions. Phase 2 added two mail tables and grew message and folder_sync while keeping every Phase 1 isolation guarantee:

- the new tables carry the standard forced-RLS policy and the D-40 grants;
- the generic catalog gate covers them with no allowlist change;
- the runtime two-mailbox and owner-delete tests iterate over them;
- the sentinel scan reads them;
- all new data access goes through the mailbox-filtered Scope API.

Redaction gained WR-01 hardening and lost nothing. CI is green on the commit that contains all Phase 2 code. The later commits do not touch the database or the stack. One owner check remains: re-run the real-password grep now that real mail and Bridge-written passwords exist.

---

_Verified: 2026-10-07T23:04:05Z_
_Verifier: Claude (gsd-verifier)_
