# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-10-04T19:06:27.572Z
> Files: 179 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../private/tmp/claude-501/-Users-samuel-dev-sift/0f2aabd8-04df-4c56-9836-c66f3dd17f23/scratchpad/

- `envkeys.sh` — Print which keys are set (non-empty) in the repo env file; never values. (~89 tok)
- `ignore-matrix.txt` (~47 tok)
- `make-compose-env.sh` — Creates /Users/samuel/dev/sift/.env from fresh random values if it is missing. (~157 tok)
- `make-dev-env.sh` — Creates /Users/samuel/dev/sift/.env.development from .env.development.example, (~386 tok)
- `mk-mailboxes-env.sh` — Create the repo's mailbox env file from the committed example (empty values, (~113 tok)
- `red-evidence.mjs` — Usage: node red-evidence.mjs <testFile> <targetTestName> <expected> <actual> <outJson> (~256 tok)

## ../../.claude/projects/-Users-samuel-dev-sift/memory/

- `tooling-dirs-are-code.md` (~227 tok)

## ./

- `.dockerignore` (~33 tok)
- `.gitignore` — Git ignore rules (~590 tok)
- `.nvmrc` (~3 tok)
- `biome.json` (~416 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `commitlint.config.js` — Conventional commits (D-16). config-conventional caps header and body lines at 100 chars. (~47 tok)
- `compose.yaml` — Sift stack: db -> setup (one-shot) -> worker. (~1155 tok)
- `CONTRIBUTING.md` — Contributing to Sift (~2385 tok)
- `Dockerfile` — Docker container definition (~475 tok)
- `lefthook.yml` — Git hooks (D-16). Installed by lefthook's postinstall and by `pnpm lefthook install`. (~96 tok)
- `LICENSE` — Project license (~9207 tok)
- `package.json` — Node.js package manifest (~188 tok)
- `pnpm-workspace.yaml` (~79 tok)
- `README.md` — Project documentation (~7324 tok)
- `tsconfig.base.json` (~107 tok)
- `tsconfig.json` — TypeScript configuration (~40 tok)
- `vitest.config.ts` — /*.test.ts', 'apps/*/test/**/*.test.ts'], (~150 tok)

## .claude/

- `settings.json` (~441 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## .github/

- `dependabot.yml` (~32 tok)

## .github/workflows/

- `ci.yml` — workflow ci, job check: pgvector pg18 service, actions pinned to commit SHAs (IN-07), setup-node .nvmrc, PG18 client, docker exec bootstrap.sql, lint/typecheck/test (~713 tok)

## .planning/

- `config.json` (~549 tok)
- `INGEST-CONFLICTS.md` — Conflict Detection Report (~252 tok)
- `PROJECT.md` — Sift (~3473 tok)
- `REQUIREMENTS.md` — Requirements: Sift (~2759 tok)
- `ROADMAP.md` — Roadmap: Sift (~2453 tok)
- `STATE.md` — Project State (~817 tok)

## .planning/intel/

- `API-SURFACE.md` — API Surface (~62 tok)
- `constraints.md` — Constraints (from SPECs) (~121 tok)
- `context.md` — Context (from DOCs) (~2906 tok)
- `decisions.md` — Decisions (from ADRs) (~1797 tok)
- `requirements.md` — Requirements (from PRDs) (~108 tok)
- `SYNTHESIS.md` — Ingest Synthesis Summary (~747 tok)

## .planning/intel/classifications/

- `0001-multiple-mailboxes-single-owner-7e2a5c9f.json` (~210 tok)
- `0002-tiered-classification-8ef7a2c1.json` (~190 tok)
- `0003-traces-and-mail-app-relabels-61647230.json` (~213 tok)
- `README-9f7a2c5e.json` (~165 tok)

## .planning/phases/01-foundation-and-isolation/

- `01-01-PLAN.md` — /src noRestrictedImports override (ISO-04 static guard)" (~6659 tok)
- `01-01-SUMMARY.md` — Dependency graph (~3599 tok)
- `01-02-PLAN.md` (~4257 tok)
- `01-02-SUMMARY.md` — Dependency graph (~3265 tok)
- `01-03-PLAN.md` — that: mailboxIsolation, migrate, requireTestDb + 4 more (~7367 tok)
- `01-03-SUMMARY.md` — Dependency graph (~4001 tok)
- `01-04-PLAN.md` — SUPPORTED_CONFIG_VERSION: resolveConfigPath, parseConfigText, loadConfig + 7 more (~7091 tok)
- `01-04-SUMMARY.md` — Dependency graph (~3860 tok)
- `01-05-PLAN.md` — SCOPED_TABLE_NAMES: requireTestDb, freshDatabase, connect, collectCatalogViolations (~5069 tok)
- `01-05-SUMMARY.md` — Dependency graph (~3926 tok)
- `01-06-PLAN.md` (~3783 tok)
- `01-06-SUMMARY.md` — Phase 1 Plan 06: Mailbox Isolation and Owner RLS Tests Summary (~1992 tok)
- `01-07-PLAN.md` — level: requireDatabaseUrl, redactText, createAppDb + 6 more (~5218 tok)
- `01-07-SUMMARY.md` — Phase 01 Plan 07: Scoped Data-Access API Summary (~3248 tok)
- `01-08-PLAN.md` — MIGRATE_LOCK_KEY: migrate, backupFileName, ensureWritableDir, writeBackup, pruneBackups (~5019 tok)
- `01-08-SUMMARY.md` — Dependency graph (~3044 tok)
- `01-09-PLAN.md` — RegistryField: mailboxValuesFromConfig, planRegistryChanges, findRenameSuspects + 4 more (~5230 tok)
- `01-09-SUMMARY.md` — Phase 01 Plan 09: Mailbox Registry Lifecycle Summary (~3157 tok)
- `01-10-PLAN.md` — BACKOFF_CAP_MS: computeBackoff, createSupervisor, createMailboxCallbacks + 3 more (~4708 tok)
- `01-10-SUMMARY.md` — Phase 1 Plan 10: Worker Process and Supervisor Summary (~3068 tok)
- `01-11-PLAN.md` — ConnectErrorClass: machine, classifyConnectError, connectWithRetry, assertUnprivilegedRole, checkDri (~4374 tok)
- `01-11-SUMMARY.md` — Phase 1 Plan 11: Worker Startup Guards and Secret Sentinel Summary (~2949 tok)
- `01-12-PLAN.md` — in: run, run (~5691 tok)
- `01-12-SUMMARY.md` — Phase 1 Plan 12: Docker Image, Compose Stack and sift setup Summary (~3632 tok)
- `01-13-PLAN.md` (~3545 tok)
- `01-13-SUMMARY.md` — Phase 1 Plan 13: Owner and Contributor Docs Summary (~2735 tok)
- `01-CONTEXT.md` — Phase 1: Foundation and Isolation - Context (~6215 tok)
- `01-DISCUSSION-LOG.md` — Phase 1: Foundation and Isolation - Discussion Log (~2217 tok)
- `01-RESEARCH.md` — Phase 1: Foundation and Isolation - Research (~20122 tok)
- `01-REVIEW-FIX.md` — Phase 1: Code Review Fix Report (~4733 tok)
- `01-REVIEW.md` — Phase 1: Code Review Report (re-review after CR-01, WR-01..WR-08 fixes) (~4924 tok)
- `01-VALIDATION.md` — status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6) (~1563 tok)
- `01-VERIFICATION.md` — Phase 1: Foundation and Isolation Verification Report (~7681 tok)
- `COVERAGE.md` (~43 tok)
- `deferred-items.md` — Deferred Items (~227 tok)

## .planning/tmp/

- `docs-work-manifest.json` (~379 tok)
- `verify-0001-multiple-mailboxes-single-owner.md.json` (~168 tok)
- `verify-0002-tiered-classification.md.json` (~36 tok)
- `verify-0003-traces-and-mail-app-relabels.md.json` (~44 tok)
- `verify-CONTRIBUTING.md.json` (~36 tok)

## apps/worker/

- `package.json` — Node.js package manifest (~45 tok)

## apps/worker/src/

- `cli.ts` — Exit code for usage errors (no command, unknown command). (~773 tok)
- `command.ts` — Process boundary handed to every command, so commands stay testable. (~732 tok)

## apps/worker/src/commands/

- `config-apply.ts` — sift config apply [--confirm]: loadConfig (schema only, D-67) -> applyConfig; prints describeChange lines / already matches / rename hint + No changes applied. (exit 1) (~1098 tok)
- `config-check.ts` — sift config check [--schema-only]: loadConfig + applyEnvOverrides + D-35 checkMailboxEnv; prints formatIssue lines, exit 1 on any (~520 tok)
- `mailbox-list.ts` — sift mailbox list: SLUG STATUS LAST SEEN LAST SYNC table; status disabled since <date> | ok | error: <80> | never run (~709 tok)
- `mailbox-rename.ts` — sift mailbox rename <old> <new>: usage exit 2, renameMailbox, prints config/setup follow-up; errors exit 1 (~519 tok)
- `migrate.ts` — sift migrate: owner URL + app password (+ SIFT_BACKUP_DATABASE_URL/DIR, SIFT_PG_DUMP) -> migrate(); prints Backup written / Applied n / No pending migrations.; errors redacted (~848 tok)
- `setup.ts` — Show a path relative to the working directory when it lives under it. (~591 tok)
- `worker.ts` — Show a path relative to the working directory when it lives under it. (~1309 tok)

## apps/worker/src/runtime/

- `backoff.ts` — computeBackoff(failures, intervalMs, random): interval*2^failures, +/-20% jitter, capped at BACKOFF_CAP_MS 900000 (D-51) (~181 tok)
- `heartbeat.ts` — defaultHeartbeatFile(env) (SIFT_HEARTBEAT_FILE or <tmpdir>/sift/heartbeat); createHeartbeat(file) writes ISO timestamp via temp+rename (D-54) (~310 tok)
- `mailbox-batch.ts` — createMailboxCallbacks(db, secrets): readRegistry, Phase 1 no-op runBatch (withMailbox requireActive: recordMailboxSeen+recordSyncSuccess), onBatchError (disabled->recordDisabled else redacted recordSyncError), onMailboxStopped (~542 tok)
- `run-until-stopped.ts` — runUntilStopped(supervisor, log, waitForSignal): signal -> exit 0, supervisor.stalled -> one error log line + exit EXIT_HEARTBEAT_STALLED=75 (IN-05); bounded drain either way (~520 tok)
- `shutdown.ts` — waitForShutdownSignal(abort?): first SIGTERM/SIGINT; listeners removed so a second signal force-exits (D-53); abort removes them too (IN-05) (~260 tok)
- `startup.ts` — checkDrift(db, config): planRegistryChanges(config, readRegistry).map(describeChange); [] = no drift (D-34) (~180 tok)
- `supervisor.ts` — createSupervisor(deps): 15s setTimeout-chained ticks; readRegistry -> heartbeat -> run due enabled mailboxes; skip-not-queue, backoff, disable stop, optional redact, stop() bounded drain; missed-heartbeat counter + overdue-tick timer -> `stalled` (IN-05). SUPERVISOR_TICK_MS, SHUTDOWN_TIMEOUT_MS, MAX_MISSED_HEARTBEATS (~2400 tok)

## apps/worker/test/

- `ci-workflow.test.ts` — static contract test for .github/workflows/ci.yml (image, setup steps, bootstrap, lint<typecheck<test order, env) (~764 tok)
- `cli.test.ts` — Deferred mailbox hard-delete command (D-69). It must not appear in any CLI output. (~559 tok)
- `compose-smoke.test.ts` — runs compose-smoke.sh in a temp repo copy with docker/uname/id/sudo shims: CR-01 modes, WR-01 volume, CR-02 backup dir, WR-09 docker-state guard, IN-08 own files/image (~3500 tok)
- `compose.test.ts` — Environment as a key -> value map, from either the map or the list form. (~2094 tok)
- `drift.test.ts` — spawns sift worker on a drifted config (personal port 1144 + mailbox side): exit 1, differences, setup command, no status rows (~1218 tok)
- `lint-guard.test.ts` — IN-02: lints probe files at apps/worker/src in a scratch copy with the real biome.json; relative/deep imports of packages/*/src are rejected (~724 tok)
- `no-secret-leak.test.ts` — FND-02 / success criterion 2 (automated half, T-01-46): a mailbox password (~2633 tok)
- `node-version.test.ts` — .nvmrc without the leading "v" and surrounding whitespace, e.g. 26.10.0. (~323 tok)
- `registry-cli.test.ts` — 01-09 tracer: config apply + mailbox list via spawned CLI with no mailbox secrets in env (~659 tok)
- `run-until-stopped.test.ts` — IN-05: stall -> exit 75 with the exact pino line (no URL), signal -> exit 0, abortable signal listeners (~1598 tok)
- `setup.test.ts` — Version-18 check for a host PostgreSQL client binary. (~2096 tok)
- `supervisor.test.ts` — 01-10: fake-timer tests for computeBackoff and supervisor (first tick, cadence, no overlap, independent failure, backoff, disable, new mailbox, registry failure, redact, drain, missed heartbeats IN-05) (~4500 tok)
- `user-facing-text.test.ts` — 01-13: D-69 word scan over README, CONTRIBUTING, example env/config, compose.yaml, Dockerfile, apps/worker/src, packages/{core,db}/src; README quick-start and CONTRIBUTING contract assertions; `pnpm <script>` names must exist in package.json (~2400 tok)
- `worker-errors.test.ts` — IN-04: in-process worker run with SELECT on mailbox revoked; unexpected pg error logged via pino, redacted, SQLSTATE, exit 1, no stderr (~792 tok)
- `worker.test.ts` — 01-10 tracer: spawns sift worker on freshDatabase (applyConfig first), waits for ok status + heartbeat, SIGTERM exit 0; missing env -> one JSON line, exit 1 (~1768 tok)

## config/

- `config.example.yaml` — Sift configuration (version 1) (~368 tok)
- `config.example.yaml` — Shipped example config v1: two mailboxes (personal, job-search), models, worker; rerun-setup comment (~330 tok)

## db/

- `bootstrap.sql` — db/bootstrap.sql (~836 tok)

## docs/adr/

- `0001-multiple-mailboxes-single-owner.md` — ADR 0001: Multiple mailboxes, single owner (~1166 tok)
- `0002-tiered-classification.md` — ADR 0002: Tiered classification, trained only on the owner's labels (~1454 tok)
- `0003-traces-and-mail-app-relabels.md` — ADR 0003: Decision traces, and learning from relabels in the mail app (~1833 tok)

## packages/core/

- `package.json` — Node.js package manifest (~52 tok)

## packages/core/src/

- `index.ts` — Highest `version:` value in config.yaml that this build understands. (~211 tok)
- `log.ts` — Fields censored in every log line (D-23, T-01-16), at the depths Sift logs (~486 tok)

## packages/core/src/config/

- `env.ts` — Source label for issues that come from the process environment. (~810 tok)
- `env.ts` — checkMailboxEnv (D-35 line), applyEnvOverrides (SIFT_MODELS_URL), secretValues (~700 tok)
- `errors.ts` — One config problem. Line and column are 1-based and present when the YAML node is known. (~328 tok)
- `errors.ts` — ConfigIssue, formatPath (mailboxes[0].imap.port), formatIssue (<src>:<line>:<col> <path>: <msg>) (~300 tok)
- `index.ts` — Declares ConfigIssue (~120 tok)
- `index.ts` — @sift/core/config barrel (~180 tok)
- `load.ts` — Alias expansion cap (T-01-14). A real config never needs anchors at all. (~1376 tok)
- `load.ts` — parseConfigText/loadConfig: yaml LineCounter positions, literal-secret pre-pass, required-key sentinel, file-order issues (~1900 tok)
- `schema.ts` — Default Ollama endpoint as seen from inside the Compose network (D-60). (~2149 tok)
- `schema.ts` — Zod 4 strict schema for config v1, HttpUrl, slug transform, duplicate slug/IMAP checks (superRefine when:true) (~1900 tok)
- `slug.ts` — Mailbox slug shape (D-63): lowercase ASCII words joined by single hyphens. (~394 tok)
- `slug.ts` — validateSlug + SLUG_PATTERN, SLUG_MAX_LENGTH=40, RESERVED_SLUGS (D-63) (~330 tok)

## packages/core/src/log.ts

- `log.ts` — createLogger (pino JSON, REDACT_PATHS, service sift), REDACTED, redactText (split/join + postgres URL password) (~520 tok)

## packages/core/test/

- `config.test.ts` — Extra raw lines appended inside the imap mapping (6-space indent). (~2907 tok)
- `config.test.ts` — Slug, boundary, duplicate, literal-secret and structure rules via parseConfigText (~2700 tok)
- `env.test.ts` — A value that must never appear in any message. (~1734 tok)
- `env.test.ts` — checkMailboxEnv, applyEnvOverrides, secretValues, CLI env step (~1500 tok)
- `example-config.test.ts` — Declares EXAMPLE (~458 tok)
- `example-config.test.ts` — D-61: example validates; CLI --schema-only exit 0; missing file exit 1 (~330 tok)
- `log.test.ts` — Declares capture (~810 tok)
- `log.test.ts` — pino redaction depths and redactText (~700 tok)

## packages/db/

- `drizzle.config.ts` — Paths are relative to the repo root, where `pnpm db:generate` runs. (~124 tok)
- `package.json` — Node.js package manifest (~98 tok)

## packages/db/migrations/

- `0002_message_force_grants.sql` (~166 tok)
- `0004_scoped_tables_force_grants.sql` (~398 tok)

## packages/db/src/

- `app-db.ts` — createAppDb: opaque AppDb {close} over pg.Pool+drizzle (WeakMap internals, pool error handler); internal internalsOf (not exported) (~614 tok)
- `connect.ts` — @sift/db/connect: classifyConnectError, connectWithRetry (250ms doubling cap 5s ±20%, 30s deadline, per-attempt bound), assertUnprivilegedRole, DatabaseStartupError (~1798 tok)
- `index.ts` — Database connection-string variables. Values are secrets and are never logged. (~392 tok)
- `registry-plan.ts` — pure (type-only imports): planRegistryChanges, findRenameSuspects, describeChange, mailboxValuesFromConfig, RegistryChange (~1551 tok)
- `registry-read.ts` — Every mailbox row, ordered by slug, disabled ones included. The registry (~161 tok)
- `rls.ts` — Roles are created outside drizzle-kit: sift_owner by db/bootstrap.sql and (~283 tok)
- `scope.ts` — withMailbox (UUID check, tx-local set_config, frozen closable Scope), scopedTable/appendOnlyTable/mailboxStatus helpers, requireActive, error classes (~2600 tok)
- `status.ts` — Worker-facing use-cases over scope.mailboxStatus (D-07, D-43 second layer). (~435 tok)

## packages/db/src/owner/

- `backup.ts` — BACKUP_KEEP, BackupTarget, BackupFailedError, backupFileName, ensureWritableDir (chown 1000 hint), writeBackup (pg_dump -> 0600 wx file, PGPASSWORD only), pruneBackups (~1535 tok)
- `migrate.ts` — migrate(): advisory lock -> pending detection -> required backup (BackupRequiredError) -> ensureAppRole -> drizzle migrator; returns { applied, backupFile } (~1618 tok)
- `registry.ts` — @sift/db/registry: CONFIG_APPLY_LOCK_KEY, applyConfig (xact lock, for update, refused-rename/unchanged rollback), renameMailbox, listMailboxes (app.mailbox_id per status read) (~2400 tok)
- `scram.ts` — IN-03: scramSha256Verifier(password, salt?, iterations?) builds PG's SCRAM-SHA-256 stored verifier client-side (node-pg SASLprep); migrate sends it instead of plaintext (~476 tok)

## packages/db/src/schema/

- `index.ts` — Every mailbox-scoped table: NOT NULL mailbox_id, forced RLS, one policy. (~276 tok)
- `mailbox.ts` — Mailbox registry (D-06). Configuration, not mail-derived data, so it has no (~356 tok)
- `scoped.ts` — Mailbox-scoped tables (ISO-01). Each one has a NOT NULL mailbox_id that (~1076 tok)

## packages/db/test/

- `catalog.test.ts` — catalog schema check: clean schema returns [], 9 negative tests (rogue table, nullable mailbox_id, grants, 2nd policy, BYPASSRLS role, FK/key/trigger drift) (~1500 tok)
- `connect.test.ts` — classify table, live 28P01/3D000/closed-port retry, role guard in-process and via worker CLI with the admin URL (~2219 tok)
- `global-setup.ts` — Migrate one throwaway template database per run with the real migrate() (~971 tok)
- `isolation.test.ts` — D-48 isolation suite on raw sift_app clients over SCOPED_TABLE_NAMES: A-only reads, B-aimed writes 0 rows, 42501/23503/22P02/23502 edges, stale/fresh/upper-case/empty scope (~4000 tok)
- `migrate.test.ts` — Declares TestDatabase (~1494 tok)
- `owner-rls.test.ts` — D-70: unscoped sift_owner DELETE removes nothing; under A removes all A rows, none of B (~1200 tok)
- `registry-plan.test.ts` — 10 pure planRegistryChanges/findRenameSuspects/describeChange tests (~1290 tok)
- `registry.test.ts` — 19 tests: applyConfig guards/snapshot/concurrency/rollback/re-enable, renameMailbox, CLI apply/list/rename + D-69 output check (~3976 tok)
- `scope.test.ts` — 23 scoped API tests: no-RLS superuser proof, concurrency/rollback, guards, requireActive, status use-cases, readRegistry, export surface, 5 @ts-expect-error (~5048 tok)
- `scram.test.ts` — IN-03: verifier equals PG's own for the same salt (incl. SASLprep chars); a role created with it logs in over TCP; wrong password 28P01 (~990 tok)

## packages/db/test/support/

- `catalog.ts` — collectCatalogViolations(client, allowlist?), CATALOG_ALLOWLIST, STANDARD_POLICY_EXPR: pg_catalog checks for RLS/policy/mailbox_id/privileges/roles/registry/keys/triggers (~4932 tok)
- `db.ts` — Provided by packages/db/test/global-setup.ts as inject('testDb'). (~967 tok)
- `seed.ts` — Insert one mailbox row per slug as sift_owner and return slug -> id. (~925 tok)

## scripts/

- `compose-smoke.sh` — Full-stack smoke test. Own volume <project>-pgdata-smoke, own files in .smoke/<project>/ (.env via --env-file, .env.mailboxes, config with imap.smoke.invalid, backups), image sift-smoke:local; refuses projects with non-smoke containers (~2000 tok)
- `pg-dump-via-compose.sh` — SIFT_PG_DUMP wrapper: pg_dump 18 inside the Compose db container, --dbname host rewritten to db:5432 (scram, not loopback trust) (~250 tok)
