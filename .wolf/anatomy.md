# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-10-10T12:00:01.352Z
> Files: 467 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.dockerignore` — Docker ignore rules (~35 tok)
- `.gitignore` — Git ignore rules (~660 tok)
- `.nvmrc` (~3 tok)
- `biome.json` — Biome linter/formatter configuration (~472 tok)
- `CLAUDE.md` — OpenWolf (~57 tok)
- `commitlint.config.js` — Conventional commits (D-16). config-conventional caps header and body lines at 100 chars. (~47 tok)
- `compose.yaml` — Sift stack: db -> setup (one-shot) -> worker, plus bridge (and the one-shot bridge-init). (~2346 tok)
- `CONTRIBUTING.md` — Contributing to Sift (~3680 tok)
- `Dockerfile` — Docker container definition (~475 tok)
- `lefthook.yml` — Git hooks (D-16). Installed by lefthook's postinstall and by `pnpm lefthook install`. (~96 tok)
- `LICENSE` — Project license (~9207 tok)
- `package.json` — Node.js package manifest (~286 tok)
- `pnpm-lock.yaml` — pnpm lock file (~29253 tok)
- `pnpm-workspace.yaml` (~79 tok)
- `README.md` — Project documentation (~11079 tok)
- `renovate.json` (~235 tok)
- `tsconfig.base.json` (~107 tok)
- `tsconfig.json` — TypeScript configuration (~50 tok)
- `vitest.config.ts` — Vitest test configuration (~156 tok)

## .claude/

- `settings.json` (~441 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## .github/

- `dependabot.yml` (~32 tok)

## .github/workflows/

- `bridge-image.yml` — CI: bridge-image (~328 tok)
- `ci.yml` — CI: ci (~951 tok)
- `release-tag.yml` — CI: release-tag (~291 tok)

## .gsd/

- `dispatch-isolation-sentinel.json` (~27 tok)

## .planning/

- `config.json` (~558 tok)
- `INGEST-CONFLICTS.md` — Conflict Detection Report (~252 tok)
- `PROJECT.md` — Sift (~3612 tok)
- `REQUIREMENTS.md` — Requirements: Sift (~2763 tok)
- `ROADMAP.md` — Roadmap: Sift (~4055 tok)
- `state.json` (~212 tok)
- `STATE.md` — Project State (~5266 tok)

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
- `01-01-SUMMARY.md` — Dependency graph (~3642 tok)
- `01-02-PLAN.md` (~4257 tok)
- `01-02-SUMMARY.md` — Dependency graph (~3265 tok)
- `01-03-PLAN.md` — Exports siftApp (~7367 tok)
- `01-03-SUMMARY.md` — Dependency graph (~4001 tok)
- `01-04-PLAN.md` — Exports SUPPORTED_CONFIG_VERSION (~7091 tok)
- `01-04-SUMMARY.md` — Dependency graph (~3958 tok)
- `01-05-PLAN.md` — Exports SCOPED_TABLE_NAMES (~5069 tok)
- `01-05-SUMMARY.md` — Dependency graph (~3926 tok)
- `01-06-PLAN.md` (~3781 tok)
- `01-06-SUMMARY.md` — Phase 1 Plan 06: Mailbox Isolation and Owner RLS Tests Summary (~1992 tok)
- `01-07-PLAN.md` — Exports requireDatabaseUrl (~5218 tok)
- `01-07-SUMMARY.md` — Phase 01 Plan 07: Scoped Data-Access API Summary (~3248 tok)
- `01-08-PLAN.md` — Exports MIGRATE_LOCK_KEY (~5019 tok)
- `01-08-SUMMARY.md` — Dependency graph (~3044 tok)
- `01-09-PLAN.md` — Exports RegistryField (~5253 tok)
- `01-09-SUMMARY.md` — Phase 01 Plan 09: Mailbox Registry Lifecycle Summary (~3157 tok)
- `01-10-PLAN.md` — Exports BACKOFF_CAP_MS (~4709 tok)
- `01-10-SUMMARY.md` — Phase 1 Plan 10: Worker Process and Supervisor Summary (~3068 tok)
- `01-11-PLAN.md` — Exports ConnectErrorClass (~4388 tok)
- `01-11-SUMMARY.md` — Phase 1 Plan 11: Worker Startup Guards and Secret Sentinel Summary (~2949 tok)
- `01-12-PLAN.md` — in: run, run (~5724 tok)
- `01-12-SUMMARY.md` — Phase 1 Plan 12: Docker Image, Compose Stack and sift setup Summary (~3638 tok)
- `01-13-PLAN.md` (~3545 tok)
- `01-13-SUMMARY.md` — Phase 1 Plan 13: Owner and Contributor Docs Summary (~2809 tok)
- `01-CONTEXT.md` — Phase 1: Foundation and Isolation - Context (~6215 tok)
- `01-DISCUSSION-LOG.md` — Phase 1: Foundation and Isolation - Discussion Log (~2217 tok)
- `01-RESEARCH.md` — Phase 1: Foundation and Isolation - Research (~20122 tok)
- `01-REVIEW-DISPOSITION.md` — Phase 01: Code Review Disposition (~1578 tok)
- `01-REVIEW-FIX.md` — Phase 1: Code Review Fix Report (~5369 tok)
- `01-REVIEW.md` — Phase 1: Code Review Report (re-review after CR-01, WR-01..WR-08 fixes) (~4924 tok)
- `01-SECURITY.md` — threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate) (~4472 tok)
- `01-UAT.md` — Current Test (~396 tok)
- `01-VALIDATION.md` — status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6) (~1704 tok)
- `01-VERIFICATION.md` — Phase 1: Foundation and Isolation Verification Report (~7239 tok)
- `COVERAGE.md` (~43 tok)
- `deferred-items.md` — Deferred Items (~227 tok)

## .planning/phases/02-bridge-spike-and-imap-ingest/

- `02-01-PLAN.md` — Declares cannot (~10493 tok)
- `02-01-SUMMARY.md` — Phase 2 Plan 01: Bridge Image and Compose Contract Summary (~3705 tok)
- `02-02-PLAN.md` — Exports Imap (~4633 tok)
- `02-02-SUMMARY.md` — Phase 02 Plan 02: TLS and Ingest Config Settings Summary (~2921 tok)
- `02-03-PLAN.md` (~7881 tok)
- `02-03-SUMMARY.md` — Phase 02 Plan 03: Ingest Schema (Identity, Location, Body Cache, Sync State) Summary (~3982 tok)
- `02-04-PLAN.md` — Exports spkiSha256 (~5490 tok)
- `02-04-SUMMARY.md` — Phase 02 Plan 04: Dovecot STARTTLS test server, SPKI pin and phase dependencies Summary (~3702 tok)
- `02-05-PLAN.md` — Trust Boundaries (~2958 tok)
- `02-05-SUMMARY.md` — Phase 2 Plan 05: Supervisor nudge() and shutdown AbortSignal Summary (~2377 tok)
- `02-06-PLAN.md` — Declares UniqueKey (~7685 tok)
- `02-06-SUMMARY.md` — Phase 2 Plan 06: Ingest Use-Cases over the Scoped API Summary (~3326 tok)
- `02-07-PLAN.md` — Exports FolderStatus (~6914 tok)
- `02-07-SUMMARY.md` — Phase 2 Plan 07: Ingest Contracts and Message Parsing Summary (~3030 tok)
- `02-08-PLAN.md` (~7810 tok)
- `02-08-SUMMARY.md` — Phase 2 Plan 08: Bridge Init over gRPC Summary (~4286 tok)
- `02-09-PLAN.md` — Exports toUidSet (~4402 tok)
- `02-09-SUMMARY.md` — Phase 2 Plan 09: IMAP FolderSource Adapter Summary (~3888 tok)
- `02-10-PLAN.md` — Exports CHUNK_SIZE (~10633 tok)
- `02-10-SUMMARY.md` — Phase 2 Plan 10: Sync Engine Summary (~4443 tok)
- `02-11-PLAN.md` — Exports SPIKE_LABEL_NAME (~6776 tok)
- `02-11-SUMMARY.md` — Phase 2 Plan 11: Bridge Spike Probe Summary (~4064 tok)
- `02-12-PLAN.md` — Exports INGEST_LOCK_SEED (~4500 tok)
- `02-12-SUMMARY.md` — Phase 2 Plan 12: Ingest Lock and Mailbox Status Summary (~3239 tok)
- `02-13-PLAN.md` — Exports STARTUP_GRACE_MS (~8075 tok)
- `02-13-SUMMARY.md` — Phase 2 Plan 13: Worker Ingest Wiring Summary (~4863 tok)
- `02-14-PLAN.md` (~7116 tok)
- `02-14-SUMMARY.md` — Phase 2 Plan 14: Proton Bridge Spike Summary (~3626 tok)
- `02-15-PLAN.md` — , scripts/bridge-smoke.sh and the workflow file itself; it checks out with actions/checkout pinned to a 40-hex SHA with a version comment and runs ... (~4901 tok)
- `02-15-SUMMARY.md` — Phase 2 Plan 15: Bridge trust command, Renovate pin bumps and Bridge image CI Summary (~3644 tok)
- `02-16-PLAN.md` — Exports BACKFILL_LOCK_WAIT_MS (~5673 tok)
- `02-16-SUMMARY.md` — Phase 2 Plan 16: Owner Mailbox Commands Summary (~3069 tok)
- `02-17-PLAN.md` (~6094 tok)
- `02-17-SUMMARY.md` — Phase 2 Plan 17: Owner and Contributor Docs for Bridge and Ingest Summary (~4163 tok)
- `02-18-PLAN.md` — Exports CapturedCertificate (~8301 tok)
- `02-18-SUMMARY.md` — Phase 2 Plan 18: Pinned, Fail-Closed IMAP Connection Summary (~3429 tok)
- `02-19-PLAN.md` (~7098 tok)
- `02-19-SUMMARY.md` — Phase 2 Plan 19: Live Ingest on the Owner's Proton Mailbox Summary (~2654 tok)
- `02-20-PLAN.md` — Declares readme (~7342 tok)
- `02-20-SUMMARY.md` — Phase 2 Plan 20: README Proton-only scope, NTP clock requirement and corrected backfill value Summary (~3694 tok)
- `02-21-PLAN.md` — Declares pnpm (~5297 tok)
- `02-21-SUMMARY.md` — Phase 2 Plan 21: compose-smoke status check reachable without IMAP Summary (~3233 tok)
- `02-CONTEXT.md` — Phase 2: Bridge Spike and IMAP Ingest - Context (~6840 tok)
- `02-DISCUSSION-LOG.md` — Phase 2: Bridge Spike and IMAP Ingest - Discussion Log (~2174 tok)
- `02-LIVE-INGEST.md` — Phase 2 Live Ingest: the worker against the owner's Proton mailbox (~3165 tok)
- `02-PATTERNS.md` — Phase 2: Bridge Spike and IMAP Ingest - Pattern Map (~4845 tok)
- `02-RESEARCH.md` — Phase 2: Bridge Spike and IMAP Ingest - Research (~22617 tok)
- `02-REVIEW-DISPOSITION.md` — Phase 02: Code Review Disposition (~904 tok)
- `02-REVIEW-FIX.md` — Phase 02: Code Review Fix Report (~2861 tok)
- `02-REVIEW.md` — Phase 02: Code Review Report (incremental, after review fixes and UAT gap closure) (~3216 tok)
- `02-REVIEWS.md` — Cross-AI Plan Review — Phase 2 (~19095 tok)
- `02-SECURITY.md` — threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate) (~11520 tok)
- `02-SPIKE-FINDINGS.md` — Phase 2 Spike Findings: Proton Bridge against the owner's mailbox (~3300 tok)
- `02-UAT.md` — Current Test (~9417 tok)
- `02-USER-SETUP.md` — Phase 2: User Setup Required (~548 tok)
- `02-VALIDATION.md` — status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6) (~3569 tok)
- `02-VERIFICATION.md` — Phase 2: Bridge Spike and IMAP Ingest Verification Report (~7894 tok)
- `COVERAGE.md` — Phase 2 External API Coverage (~1270 tok)
- `deferred-items.md` — Phase 2 Deferred Items (~354 tok)

## .planning/phases/02-bridge-spike-and-imap-ingest/.review-diagnostics/20261005T091231Z-gsd-review-qg318o/

- `gsd-review-codex.md` — 02-01 (~5648 tok)
- `gsd-review-cursor.err` (~29 tok)
- `gsd-review-cursor.md` (~72 tok)
- `gsd-review-ollama.md` (~68 tok)

## .planning/phases/02-bridge-spike-and-imap-ingest/.review-diagnostics/20261005T092942Z-gsd-review-uiKz1s/

- `gsd-review-cursor.md` — 02-01 (~11642 tok)

## .planning/phases/03-tiered-classification-with-traces/

- `03-01-PLAN.md` — Exports ConfigIssue (~6842 tok)
- `03-02-PLAN.md` — Exports DEFAULT_INITIAL_BACKFILL_DAYS (~3938 tok)
- `03-03-PLAN.md` — Declares Existing (~6490 tok)
- `03-04-PLAN.md` — Exports MatchableMessage (~5276 tok)
- `03-05-PLAN.md` — Exports MODEL_OPTIONS (~6967 tok)
- `03-06-PLAN.md` — Exports CandidateQuery (~5447 tok)
- `03-07-PLAN.md` — Exports InfraCode (~6432 tok)
- `03-08-PLAN.md` — Exports CLASSIFY_CHUNK_SIZE (~7992 tok)
- `03-09-PLAN.md` — Exports ClassifyInfraError (~5291 tok)
- `03-10-PLAN.md` (~5455 tok)
- `03-11-PLAN.md` (~3839 tok)
- `03-12-PLAN.md` — Exports USAGE (~5717 tok)
- `03-13-PLAN.md` — Exports BaselineRow (~4703 tok)
- `03-AI-SPEC.md` — AI-SPEC — Phase 3: Tiered Classification with Traces (~28765 tok)
- `03-CONTEXT.md` — Phase 3: Tiered Classification with Traces - Context (~4038 tok)
- `03-DISCUSSION-LOG.md` — Phase 3: Tiered Classification with Traces - Discussion Log (~1792 tok)
- `03-PATTERNS.md` — Phase 3: Tiered Classification with Traces - Pattern Map (~3773 tok)
- `03-RESEARCH.md` — Phase 3: Tiered Classification with Traces - Research (~17483 tok)
- `03-VALIDATION.md` — status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6) (~2575 tok)
- `COVERAGE.md` — API Coverage — Ollama REST API (local server at models.url) (~725 tok)

## .planning/quick/261007-2ke-add-commit-driven-versioning-local-pnpm-/

- `261007-2ke-PLAN.md` — /*.ts must be added to its `include` or they are never type-checked. (~9728 tok)
- `261007-2ke-SUMMARY.md` — Phase quick-261007-2ke Plan 01: Commit-driven versioning Summary (~2203 tok)

## .planning/tmp/

- `docs-work-manifest.json` (~379 tok)
- `verify-0001-multiple-mailboxes-single-owner.md.json` (~168 tok)
- `verify-0002-tiered-classification.md.json` (~36 tok)
- `verify-0003-traces-and-mail-app-relabels.md.json` (~44 tok)
- `verify-CONTRIBUTING.md.json` (~36 tok)

## .smoke/sift-smoke/backups/

- `sift-20261005T172350Z-pre-0004_scoped_tables_force_grants.dump` — Declares and (~346 tok)
- `sift-20261007T061209Z-pre-0007_ingest_tables_force_grants.dump` — Declares and (~346 tok)

## .smoke/sift-smoke/config/

- `config.yaml` — Sift configuration (version 1) (~883 tok)

## apps/worker/

- `package.json` — Node.js package manifest (~115 tok)
- `tsconfig.json` — TypeScript configuration (~22 tok)

## apps/worker/src/

- `cli.ts` — Exit code for usage errors (no command, unknown command). (~986 tok)
- `command.ts` — Process boundary handed to every command, so commands stay testable. (~1039 tok)

## apps/worker/src/commands/

- `bridge-probe.ts` — Largest earlier report --compare reads (a 200-entry sample is far smaller). (~2890 tok)
- `bridge-trust.ts` — The owner's other, independent reading of the fingerprint (D-73, D-79). The (~1742 tok)
- `config-apply.ts` — Show a path relative to the working directory when it lives under it. (~1341 tok)
- `config-check.ts` — Show a path relative to the working directory when it lives under it. (~580 tok)
- `mailbox-backfill.ts` — How long the backfill waits for the mailbox's ingest lock (D-03): one (~3855 tok)
- `mailbox-list.ts` — Left-align every column but the last to its widest cell. (~984 tok)
- `mailbox-rename.ts` — `sift mailbox rename <old-slug> <new-slug>` (D-32, D-63). Changes the slug (~519 tok)
- `mailbox-resume.ts` — `sift mailbox resume <slug>` (D-26). The volume valve holds new mail when a (~591 tok)
- `migrate.ts` — Show a path relative to the working directory when it lives under it. (~848 tok)
- `setup.ts` — Show a path relative to the working directory when it lives under it. (~591 tok)
- `worker.ts` — D-53: after the drain, wait this long for the pool to close, then end the (~1958 tok)

## apps/worker/src/imap/

- `capture.ts` — Read the certificate an IMAP server presents, without verifying it, so it can (~2695 tok)
- `connect.ts` — The worker's IMAP connection (D-40, D-42, D-73, D-74, D-80). Rule: never send (~2570 tok)
- `folder-source.ts` — Largest IMAP UID (RFC 3501 §2.3.1.1: unsigned 32-bit, non-zero). (~3490 tok)
- `pin.ts` — SPKI fingerprint of a PEM certificate: base64 of SHA-256 over the DER (~434 tok)

## apps/worker/src/ingest/

- `db-store.ts` — The sync engine's store over the database (02-13): every IngestStore method (~2038 tok)
- `identity.ts` — Headers hashed into the `hdr:` fallback key, in this order, plus RFC822.SIZE (~1343 tok)
- `message.ts` — Header fields fetched for every message with BODY.PEEK[HEADER.FIELDS (...)]: (~2964 tok)
- `plan.ts` — Pure decision helpers of the sync engine (02-10). No I/O: run.ts feeds them (~1004 tok)
- `run.ts` — The sync engine (02-10): pure orchestration over FolderSource and (~7628 tok)
- `types.ts` — Ingest contracts shared by the IMAP adapter (02-09), the sync engine (02-10) (~1610 tok)

## apps/worker/src/runtime/

- `backoff.ts` — Longest wait between attempts for a failing mailbox: 15 minutes (D-51). (~179 tok)
- `heartbeat.ts` — Heartbeat file location (D-54). A non-blank SIFT_HEARTBEAT_FILE wins; (~310 tok)
- `mailbox-batch.ts` — After the worker starts, connection failures (unreachable, timeout) show as (~4973 tok)
- `run-until-stopped.ts` — Exit code after too many missed heartbeats (IN-05): 75, EX_TEMPFAIL in (~613 tok)
- `shutdown.ts` — Resolve with the first SIGTERM or SIGINT (D-53). Both listeners are removed (~274 tok)
- `startup.ts` — Differences between config.yaml and the mailbox registry, one line per (~180 tok)
- `supervisor.ts` — The longest gap between supervisor ticks, each of which rereads the registry (~4400 tok)

## apps/worker/src/spike/

- `probe.ts` — The Bridge spike probe (SPK-01..04, D-43). It measures how an IMAP server (~8265 tok)

## apps/worker/test/

- `bridge-image.test.ts` — Body of a shell function `name() { ... }` in the entrypoint. (~4263 tok)
- `bridge-probe.test.ts` — Strings planted in every subject, From, To, body, Message-ID local part and folder name. (~7360 tok)
- `bridge-trust.test.ts` — Named in the config, never set: the command must not need it (D-80). (~2626 tok)
- `ci-workflow.test.ts` — Index of the first run step containing `command`, or -1. (~1250 tok)
- `cli.test.ts` — Deferred mailbox hard-delete command (D-69). It must not appear in any CLI output. (~800 tok)
- `compose-smoke.test.ts` — Repository files the smoke script reads before it first calls docker. (~6721 tok)
- `compose.test.ts` — A long-syntax volume entry (`type: bind`, `source`, `target`, ...). (~4554 tok)
- `dependencies.test.ts` — Supply-chain checks for the worker's npm dependencies (D-77): owner-approved (~1733 tok)
- `drift.test.ts` — Brings in the vitest ProvidedContext augmentation that types inject('testDb'). (~1218 tok)
- `imap-capture.test.ts` — FakeImapServer: fake, sourceFiles, source (~2204 tok)
- `imap-connect.test.ts` — Bridge v3.27.0's pre-login capability list (RESEARCH), which includes ID. (~3685 tok)
- `imap-folder-source.test.ts` — Minimal client double for the paths a real server cannot be made to take. (~4570 tok)
- `imap-pin.test.ts` — The four stages bridge/entrypoint.sh pipes a PEM through (spki_fingerprint). (~2341 tok)
- `ingest-e2e.test.ts` — The worker's own mailbox callbacks, end to end (02-13): the real database (~3357 tok)
- `ingest-engine.test.ts` — Mock: ago, harness, eligibleCount, fiveDays, started (~8014 tok)
- `ingest-identity.test.ts` — HASH: block, record (~3152 tok)
- `ingest-message.test.ts` — leaf: multipart (~2501 tok)
- `ingest-resync.test.ts` — Five eligible messages stored in generation 1; the watermark is the newest (1 minute ago). (~5543 tok)
- `lint-guard.test.ts` — Lint one file at apps/worker/src/<name> with the repository's biome.json. (~724 tok)
- `live-ingest-record.test.ts` — The owner's IMAP usernames when the main checkout has config/config.yaml; [] in CI. (~1152 tok)
- `mailbox-batch.test.ts` — Owner-visible mailbox states (02-13 Task 2; D-26, D-33, D-34, D-40, D-72, (~5144 tok)
- `mailbox-ops.test.ts` — Owner mailbox operations (02-16): `sift mailbox resume` releases a volume (~6167 tok)
- `no-secret-leak.test.ts` — FND-02 / success criterion 2 (automated half, T-01-46): a mailbox password (~2748 tok)
- `node-version.test.ts` — .nvmrc without the leading "v" and surrounding whitespace, e.g. 26.10.0. (~323 tok)
- `read-only-ingest.test.ts` — T-02-31 / D-11: ingest never changes the owner's mail. folder-source.ts (~750 tok)
- `registry-cli.test.ts` — Run the CLI with only the owner URL, the config path and PATH. No mailbox (~3013 tok)
- `run-until-stopped.test.ts` — A supervisor whose registry read always fails with a coded, URL-quoting error. (~1598 tok)
- `setup.test.ts` — Committed migrations, from the journal, so new migrations do not break this test. (~2468 tok)
- `spike-findings.test.ts` — The owner's IMAP usernames when the main checkout has config/config.yaml; [] in CI. (~1660 tok)
- `supervisor.test.ts` — A promise that never settles: a hung batch. (~7687 tok)
- `user-facing-text.test.ts` — D-69: until the mailbox hard-delete command exists, no owner-facing text and (~3520 tok)
- `worker-errors.test.ts` — Brings in the vitest ProvidedContext augmentation that types inject('testDb'). (~827 tok)
- `worker.test.ts` — Status rows read as the superuser, which bypasses RLS (test inspection only). (~1846 tok)

## apps/worker/test/fixtures/mail/

- `alternative.eml` (~224 tok)
- `attachment.eml` (~224 tok)
- `encoded-headers.eml` (~104 tok)
- `exact-64.eml` (~91 tok)
- `html-only.eml` (~164 tok)
- `no-message-id.eml` (~75 tok)
- `plain.eml` (~131 tok)

## apps/worker/test/support/

- `fake-folder-source.ts` — In-memory FolderSource for the sync engine tests (02-10). Synthetic mail (~2284 tok)
- `fake-imap-server.ts` — A recording fake IMAP server for wire-level tests (D-80): it records every (~2409 tok)
- `fake-ingest-store.ts` — In-memory IngestStore with the semantics of the @sift/db ingest use-cases (~4470 tok)
- `mailbox-harness.ts` — Shared pieces of the worker-callback tests (02-13): a config entry for a (~2027 tok)
- `privacy-scan.ts` — Address domains a committed spike or live-run document may name. (~806 tok)
- `test-imap.ts` — Helpers for the Dovecot test server started by `scripts/test-imap.sh up`. (~2244 tok)

## backups/

- `.gitkeep` (~0 tok)
- `sift-20261004T062924Z-pre-0004_scoped_tables_force_grants.dump` — Declares and (~346 tok)
- `sift-20261006T175316Z-pre-0007_ingest_tables_force_grants.dump` — Declares and (~7965 tok)

## bridge/

- `Dockerfile` — Docker container definition (~815 tok)
- `entrypoint.sh` — Entrypoint of the Sift Proton Bridge image (bridge/Dockerfile). (~4000 tok)

## bridge/helper/

- `envfile_test.go` — TestUpsertEnv, TestUpsertEnvRejectsBadNamesAndValues, TestWriteInPlace, TestBackupInPlace, TestWriteMailboxPasswords (~4811 tok)
- `envfile.go` — Writing the bind-mounted .env.mailboxes and its pre-created backup (~3019 tok)
- `main_test.go` — TestWaitUsersLoaded, TestWaitUsersLoadedStopsOnError, TestNoAccountIsNotLoading (~631 tok)
- `main.go` — Command sift-helper drives Proton Bridge's gRPC frontend for the Sift (~3586 tok)

## config/

- `config.example.yaml` — Sift configuration (version 1) (~876 tok)
- `config.yaml` — Sift configuration (version 1) (~416 tok)

## data/live/

- `bridge-log-peek.txt` (~6141 tok)
- `c4poll.log` (~312 tok)
- `c5-checks.json` (~84 tok)
- `probe-age.json` (~467 tok)
- `probe-age2.json` (~467 tok)
- `probe-pre-1.err` (~29 tok)
- `probe-pre-1.json` (~416 tok)
- `probe-pre-2.err` (~29 tok)
- `probe-pre-2.json` (~416 tok)
- `probe-watch.json` (~416 tok)
- `r1-after.txt` (~1 tok)
- `r1-before.txt` (~1 tok)
- `r2.txt` (~1 tok)
- `s1.json` (~106 tok)
- `s2.json` (~106 tok)
- `s3.json` (~108 tok)
- `s4.json` (~108 tok)
- `s5.json` (~122 tok)
- `sync-watch.log` (~711 tok)
- `t-up-end.txt` (~6 tok)
- `t-up-start.txt` (~6 tok)
- `t-up2-end.txt` (~6 tok)
- `t-up2-start.txt` (~6 tok)
- `t-update.txt` (~6 tok)
- `t-worker-start.txt` (~6 tok)
- `t1-restarted.txt` (~6 tok)
- `t1.txt` (~6 tok)
- `t4-stop-end.txt` (~6 tok)
- `t4-stop-start.txt` (~6 tok)
- `t4.txt` (~6 tok)
- `up.log` — 1 [internal] load build definition from Dockerfile (~1037 tok)
- `up2.log` — 1 [internal] load build definition from Dockerfile (~1010 tok)
- `worker-c5.jsonl` (~100 tok)
- `worker-t1.log` (~160 tok)
- `worker-t1b.log` (~446 tok)

## data/spike/

- `probe-0-sync-1.json` (~405 tok)
- `probe-0-sync-10.err` (~29 tok)
- `probe-0-sync-10.json` (~405 tok)
- `probe-0-sync-11.err` (~29 tok)
- `probe-0-sync-11.json` (~405 tok)
- `probe-0-sync-12.err` (~29 tok)
- `probe-0-sync-12.json` (~405 tok)
- `probe-0-sync-13.err` (~29 tok)
- `probe-0-sync-13.json` (~405 tok)
- `probe-0-sync-14.err` (~29 tok)
- `probe-0-sync-14.json` (~405 tok)
- `probe-0-sync-15.err` (~29 tok)
- `probe-0-sync-15.json` (~405 tok)
- `probe-0-sync-16.err` (~29 tok)
- `probe-0-sync-16.json` (~405 tok)
- `probe-0-sync-17.err` (~29 tok)
- `probe-0-sync-17.json` (~405 tok)
- `probe-0-sync-18.err` (~29 tok)
- `probe-0-sync-18.json` (~405 tok)
- `probe-0-sync-19.err` (~29 tok)
- `probe-0-sync-19.json` (~405 tok)
- `probe-0-sync-2.json` (~405 tok)
- `probe-0-sync-20.err` (~29 tok)
- `probe-0-sync-20.json` (~405 tok)
- `probe-0-sync-21.err` (~29 tok)
- `probe-0-sync-21.json` (~405 tok)
- `probe-0-sync-22.err` (~29 tok)
- `probe-0-sync-22.json` (~405 tok)
- `probe-0-sync-23.err` (~29 tok)
- `probe-0-sync-23.json` (~405 tok)
- `probe-0-sync-24.err` (~29 tok)
- `probe-0-sync-24.json` (~405 tok)
- `probe-0-sync-25.err` (~29 tok)
- `probe-0-sync-25.json` (~405 tok)
- `probe-0-sync-26.err` (~29 tok)
- `probe-0-sync-26.json` (~415 tok)
- `probe-0-sync-27.err` (~29 tok)
- `probe-0-sync-27.json` (~415 tok)
- `probe-0-sync-28.err` (~29 tok)
- `probe-0-sync-28.json` (~415 tok)
- `probe-0-sync-29.err` (~29 tok)
- `probe-0-sync-29.json` (~415 tok)
- `probe-0-sync-3.json` (~405 tok)
- `probe-0-sync-30.err` (~29 tok)
- `probe-0-sync-30.json` (~415 tok)
- `probe-0-sync-31.err` (~29 tok)
- `probe-0-sync-31.json` (~415 tok)
- `probe-0-sync-32.err` (~29 tok)
- `probe-0-sync-32.json` (~415 tok)
- `probe-0-sync-33.err` (~29 tok)
- `probe-0-sync-33.json` (~415 tok)
- `probe-0-sync-34.err` (~29 tok)
- `probe-0-sync-34.json` (~415 tok)
- `probe-0-sync-4.json` (~0 tok)
- `probe-0-sync-5.json` (~0 tok)
- `probe-0-sync-6.err` (~29 tok)
- `probe-0-sync-6.json` (~405 tok)
- `probe-0-sync-7.err` (~29 tok)
- `probe-0-sync-7.json` (~405 tok)
- `probe-0-sync-8.err` (~29 tok)
- `probe-0-sync-8.json` (~405 tok)
- `probe-0-sync-9.err` (~29 tok)
- `probe-0-sync-9.json` (~405 tok)
- `probe-1-baseline.err` (~31 tok)
- `probe-1-baseline.json` (~10417 tok)
- `probe-2-find.err` (~30 tok)
- `probe-2-find.json` (~10406 tok)
- `probe-2-find2.json` (~10406 tok)
- `probe-2-label-b.err` (~64 tok)
- `probe-2-label-b.json` (~1492 tok)
- `probe-2-label.err` (~97 tok)
- `probe-2-label.json` (~1468 tok)
- `probe-2-wait.err` (~47 tok)
- `probe-2-wait.json` (~437 tok)
- `probe-3-restart.err` (~30 tok)
- `probe-3-restart.json` (~10490 tok)
- `restart-at.txt` (~6 tok)
- `snap-1-baseline.json` (~95617 tok)
- `snap-1.err` (~0 tok)
- `snap-3-restart.json` (~95617 tok)
- `snapcmp-restart.json` (~96 tok)
- `sync-log.txt` (~673 tok)
- `wait-start.txt` (~11 tok)
- `worker-build-2.log` — 2 [internal] load .dockerignore (~9550 tok)
- `worker-build.log` — 1 [internal] load build definition from Dockerfile (~10859 tok)

## db/

- `bootstrap.sql` — db/bootstrap.sql (~959 tok)

## docs/adr/

- `0001-multiple-mailboxes-single-owner.md` — ADR 0001: Multiple mailboxes, single owner (~1166 tok)
- `0002-tiered-classification.md` — ADR 0002: Tiered classification, trained only on the owner's labels (~1454 tok)
- `0003-traces-and-mail-app-relabels.md` — ADR 0003: Decision traces, and learning from relabels in the mail app (~2415 tok)

## packages/core/

- `package.json` — Node.js package manifest (~84 tok)
- `tsconfig.json` — TypeScript configuration (~22 tok)

## packages/core/src/

- `index.ts` — Highest `version:` value in config.yaml that this build understands. (~211 tok)
- `log.ts` — Fields censored in every log line (D-23, T-01-16), at the depths Sift logs (~981 tok)

## packages/core/src/config/

- `env.ts` — Source label for issues that come from the process environment. (~810 tok)
- `errors.ts` — One config problem. Line and column are 1-based and present when the YAML node is known. (~328 tok)
- `index.ts` — Declares EnvCheck (~248 tok)
- `load.ts` — Alias expansion cap (T-01-14). A real config never needs anchors at all. (~2081 tok)
- `schema.ts` — Default Ollama endpoint as seen from inside the Compose network (D-60). (~3121 tok)
- `slug.ts` — Mailbox slug shape (D-63): lowercase ASCII words joined by single hyphens. (~394 tok)

## packages/core/test/

- `config.test.ts` — Extra raw lines appended inside the imap mapping (6-space indent). (~5454 tok)
- `env.test.ts` — A value that must never appear in any message. (~1734 tok)
- `example-config.test.ts` — Declares EXAMPLE (~1178 tok)
- `log.test.ts` — Declares capture (~1286 tok)

## packages/db/

- `drizzle.config.ts` — Drizzle ORM configuration (~124 tok)
- `package.json` — Node.js package manifest (~134 tok)
- `tsconfig.json` — TypeScript configuration (~22 tok)

## packages/db/migrations/

- `0000_extensions.sql` (~12 tok)
- `0001_registry_and_message.sql` — SQL: tables: mailbox, message, 2 alter(s) (~463 tok)
- `0002_message_force_grants.sql` — SQL: 1 alter(s), 1 function(s) (~177 tok)
- `0003_scoped_tables.sql` — SQL: tables: decision, folder_sync, label, label_event, 14 alter(s) (~1704 tok)
- `0004_scoped_tables_force_grants.sql` — SQL: 6 alter(s) (~427 tok)
- `0005_ingest_preflight.sql` — Preflight for 0006 (T-02-63): message and folder_sync gain NOT NULL and (~311 tok)
- `0006_ingest_tables.sql` — SQL: tables: message_body, message_location, 45 alter(s) (~2323 tok)
- `0007_ingest_tables_force_grants.sql` — SQL: 2 alter(s) (~157 tok)

## packages/db/migrations/meta/

- `_journal.json` (~353 tok)
- `0000_snapshot.json` (~96 tok)
- `0001_snapshot.json` (~1468 tok)
- `0002_snapshot.json` (~1468 tok)
- `0003_snapshot.json` (~5380 tok)
- `0004_snapshot.json` (~5380 tok)
- `0005_snapshot.json` (~5380 tok)
- `0006_snapshot.json` (~10030 tok)
- `0007_snapshot.json` (~10030 tok)

## packages/db/src/

- `app-db.ts` — Pool size. Defaults to 4. (~1433 tok)
- `connect.ts` — Worker startup against the database (D-55, Pitfall 11). Docker can restart (~2320 tok)
- `index.ts` — Database connection-string variables. Values are secrets and are never logged. (~634 tok)
- `ingest.ts` — Ingest use-cases over the scoped API (D-14, D-15, D-06, D-07, D-21, D-23). (~5548 tok)
- `lock.ts` — Seed of `hashtextextended(mailbox_id, seed)`: every mailbox gets its own (~1758 tok)
- `registry-plan.ts` — Pure diff between config.yaml and the mailbox registry (D-32, D-34). (~2384 tok)
- `registry-read.ts` — Every mailbox row, ordered by slug, disabled ones included. The registry (~161 tok)
- `rls.ts` — Roles are created outside drizzle-kit: sift_owner by db/bootstrap.sql and (~283 tok)
- `scope.ts` — A registered mailbox-scoped table: it has a mailbox_id column. (~5327 tok)
- `status.ts` — Worker-facing use-cases over scope.mailboxStatus (D-07, D-43 second layer). (~1102 tok)

## packages/db/src/owner/

- `backup.ts` — How many sift-*.dump files `sift migrate` keeps after a successful dump (D-29). (~1535 tok)
- `migrate.ts` — Session-level advisory lock held for the whole migrate run (D-30). (~3555 tok)
- `registry.ts` — Owner-side mailbox registry operations (FND-02, D-32, D-33). Every function (~3176 tok)
- `scram.ts` — PostgreSQL's default scram_iterations. (~476 tok)

## packages/db/src/schema/

- `index.ts` — Every mailbox-scoped table: NOT NULL mailbox_id, forced RLS, one policy. (~310 tok)
- `mailbox.ts` — Mailbox registry (D-06). Configuration, not mail-derived data, so it has no (~356 tok)
- `scoped.ts` — Mailbox-scoped tables (ISO-01). Each one has a NOT NULL mailbox_id that (~3368 tok)

## packages/db/test/

- `catalog.test.ts` — Run SQL statements on `url` in order. (~2329 tok)
- `connect.test.ts` — Worker startup against the database (D-55, Pitfall 11): only self-resolving (~2944 tok)
- `global-setup.ts` — Migrate one throwaway template database per run with the real migrate() (~1009 tok)
- `ingest.test.ts` — Ingest use-cases (ING-02, ING-04, D-14, D-15, D-07, D-17, D-21..D-25) on a (~8514 tok)
- `isolation.test.ts` — Mailbox isolation at the database level (ISO-03, success criterion 4). (~3908 tok)
- `lock.test.ts` — The cross-process ingest lock (D-03, RESEARCH Pattern 6, Pitfall 9). Two (~3464 tok)
- `migrate.test.ts` — The trivial migration withExtraMigration appends after the committed ones. (~8706 tok)
- `owner-rls.test.ts` — sift_owner owns the tables but FORCE RLS still applies to it (D-41), so (~1232 tok)
- `registry-plan.test.ts` — RegistryRowLike: mailbox, config, row (~2155 tok)
- `registry.test.ts` — The deferred mailbox hard-delete command (D-69): no output may name it. (~5015 tok)
- `scope.test.ts` — The scoped API (ISO-04, D-42..D-45): the only data-access surface app code (~10372 tok)
- `scram.test.ts` — The verifier PostgreSQL itself stores for `password`, read back from a (~990 tok)
- `status.test.ts` — Owner-visible mailbox states (D-26, D-33, D-34, D-75): connecting during (~1756 tok)

## packages/db/test/support/

- `catalog.ts` — Relations exempt from the scoped-table invariants (D-38). "Exempt" means (~5405 tok)
- `db.ts` — Provided by packages/db/test/global-setup.ts as inject('testDb'). (~1198 tok)
- `seed.ts` — Insert one mailbox row per slug as sift_owner and return slug -> id. (~1533 tok)

## scripts/

- `bridge-smoke.sh` — Bridge image smoke test: build bridge/Dockerfile, then on throwaway volumes (~3351 tok)
- `compose-smoke.sh` — Full-stack smoke test: build the image, bring up db -> setup -> worker, and (~3505 tok)
- `pg-dump-via-compose.sh` — Run pg_dump 18 inside the Compose db container (D-29 host-dev note). (~263 tok)
- `release-check.ts` — CI tag check: `node scripts/release-check.ts <vX.Y.Z>`, run at the checkout root (~930 tok)
- `release-plan.ts` — Pure release logic for `pnpm release`: version computation from Conventional (~1803 tok)
- `release.ts` — `pnpm release [--dry-run]`: cut a release locally from the Conventional Commits (~2225 tok)
- `test-imap.sh` — Dovecot IMAP server for tests: a real STARTTLS server with a self-signed (~1196 tok)

## test/

- `release-check.test.ts` — Each case spawns git and node a dozen times; slow under full-suite load (bug-189). (~2061 tok)
- `release-plan.test.ts` — A raw commit with a unique 40-hex sha. (~2248 tok)
- `release.test.ts` — Each case spawns git and node a dozen times; slow under full-suite load (bug-189). (~2486 tok)

## test/support/

- `release-repo.ts` — Throwaway git repositories for the `pnpm release` and release-check tests. (~1988 tok)
