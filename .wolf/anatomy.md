# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-10-07T07:11:30.690Z
> Files: 312 tracked | Anatomy hits: 0 | Misses: 0

## ../../../../private/tmp/claude-501/-Users-samuel-dev-sift/0f2aabd8-04df-4c56-9836-c66f3dd17f23/scratchpad/

- `envkeys.sh` — Print which keys are set (non-empty) in the repo env file; never values. (~89 tok)
- `ignore-matrix.txt` (~47 tok)
- `make-compose-env.sh` — Creates /Users/samuel/dev/sift/.env from fresh random values if it is missing. (~157 tok)
- `make-dev-env.sh` — Creates /Users/samuel/dev/sift/.env.development from .env.development.example, (~386 tok)
- `mk-mailboxes-env.sh` — Create the repo's mailbox env file from the committed example (empty values, (~113 tok)
- `red-evidence.mjs` — Usage: node red-evidence.mjs <testFile> <targetTestName> <expected> <actual> <outJson> (~256 tok)

## ../../../../private/tmp/claude-501/-Users-samuel-dev-sift/94ce255b-8898-4053-b508-5955670c177f/scratchpad/

- `linux-repro.sh` — Runs inside a throwaway sift:local container as root. Emulates a GitHub (~490 tok)

## ../../../../private/tmp/claude-501/-Users-samuel-dev-sift/b001d22c-9411-4df8-899f-145aa6d2b0ec/scratchpad/

- `add-bridge-passphrase.sh` — Appends SIFT_BRIDGE_KEYCHAIN_PASSPHRASE to the repo's real compose env file (~176 tok)
- `c4poll.sh` — Criterion 4 poll: counts, UIDs and timings only. No mail content is printed. (~499 tok)
- `edit_iso.py` — Children first, so a RESTRICT foreign key never masks the RLS result. (~1579 tok)
- `edit_scope.py` — The NOT NULL fields of a new message (D-12); identity_key is unique per mailbox. (~3634 tok)
- `find-fresh.ts` — Read-only: EXAMINE INBOX, FETCH UID+INTERNALDATE for a bounded UID range, (~472 tok)
- `gojson-to-junit.cjs` — Convert `go test -json` output (stdin) into a minimal JUnit/Surefire XML on (~288 tok)
- `key-present.cjs` — Presence-only check: prints whether a KEY= line exists with a non-empty value. (~194 tok)
- `probe-configure.sh` — Probe: run a one-shot bridge mode with the bridge-init mounts on volume sbx-probe. (~312 tok)
- `quickstart.md` — Mac: install and start Ollama natively, then pull the default models (~2771 tok)
- `snap.sh` — Counts-only snapshot of the `personal` mailbox. Usage: snap.sh <step>  -> data/live/<step>.json (~389 tok)
- `sync-watch.sh` — Light-probe Bridge every 60 s until uidNext is unchanged across two probes (or MAX_MIN). (~252 tok)

## ../../../../private/tmp/claude-501/-Users-samuel-dev-sift/cf7bcac0-bbd2-4db4-b2fd-0efe2c1e87fd/scratchpad/

- `nyan-watch.sh` — Nyan-cat watcher for the Sift Phase 2 planner. Read-only: it only looks at file names, (~763 tok)
- `planner-nyan.html` — Phase 2 Planner Watch (~1345 tok)

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
- `CONTRIBUTING.md` — Contributing to Sift (~3304 tok)
- `Dockerfile` — Docker container definition (~475 tok)
- `lefthook.yml` — Git hooks (D-16). Installed by lefthook's postinstall and by `pnpm lefthook install`. (~96 tok)
- `LICENSE` — Project license (~9207 tok)
- `package.json` — Node.js package manifest (~188 tok)
- `pnpm-workspace.yaml` (~79 tok)
- `README.md` — Project documentation; Proton-only scope (intro + Requirements), NTP host clock requirement, pin required for Bridge (~11312 tok)
- `renovate.json` (~235 tok)
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

- `bridge-image.yml` — CI: bridge-image (~328 tok)
- `ci.yml` — CI: ci (~952 tok)

## .planning/

- `config.json` (~549 tok)
- `INGEST-CONFLICTS.md` — Conflict Detection Report (~252 tok)
- `PROJECT.md` — Sift (~3473 tok)
- `REQUIREMENTS.md` — Requirements: Sift (~2759 tok)
- `ROADMAP.md` — Roadmap: Sift (~3297 tok)
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
- `01-UAT.md` — Current Test (~347 tok)
- `01-VALIDATION.md` — status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6) (~1563 tok)
- `01-VERIFICATION.md` — Phase 1: Foundation and Isolation Verification Report (~6725 tok)
- `COVERAGE.md` (~43 tok)
- `deferred-items.md` — Deferred Items (~227 tok)

## .planning/phases/02-bridge-spike-and-imap-ingest/

- `02-01-PLAN.md` — Declares cannot (~10493 tok)
- `02-01-SUMMARY.md` — Phase 2 Plan 01: Bridge Image and Compose Contract Summary (~3616 tok)
- `02-02-PLAN.md` — Declares Imap (~4633 tok)
- `02-02-SUMMARY.md` — Phase 02 Plan 02: TLS and Ingest Config Settings Summary (~2921 tok)
- `02-03-PLAN.md` (~7691 tok)
- `02-03-SUMMARY.md` — Phase 02 Plan 03: Ingest Schema (Identity, Location, Body Cache, Sync State) Summary (~3982 tok)
- `02-04-PLAN.md` — shared: spkiSha256, peerSpkiSha256, pemFromDer + 8 more (~5490 tok)
- `02-04-SUMMARY.md` — Phase 02 Plan 04: Dovecot STARTTLS test server, SPKI pin and phase dependencies Summary (~3702 tok)
- `02-05-PLAN.md` — Trust Boundaries (~2958 tok)
- `02-05-SUMMARY.md` — Phase 2 Plan 05: Supervisor nudge() and shutdown AbortSignal Summary (~2369 tok)
- `02-06-PLAN.md` — Declares UniqueKey (~7685 tok)
- `02-06-SUMMARY.md` — Phase 2 Plan 06: Ingest Use-Cases over the Scoped API Summary (~3326 tok)
- `02-07-PLAN.md` — and: stripNul, truncateCodePoints, normaliseMessageId + 7 more (~6841 tok)
- `02-07-SUMMARY.md` — Phase 2 Plan 07: Ingest Contracts and Message Parsing Summary (~3030 tok)
- `02-08-PLAN.md` (~7810 tok)
- `02-08-SUMMARY.md` — Phase 2 Plan 08: Bridge Init over gRPC Summary (~4286 tok)
- `02-09-PLAN.md` — ImapFlow: toUidSet, createFolderSource (~4402 tok)
- `02-09-SUMMARY.md` — Phase 2 Plan 09: IMAP FolderSource Adapter Summary (~3888 tok)
- `02-10-PLAN.md` — CHUNK_SIZE: runIngest, countBackfill, runBackfill (~10494 tok)
- `02-10-SUMMARY.md` — Phase 2 Plan 10: Sync Engine Summary (~4443 tok)
- `02-11-PLAN.md` — SPIKE_LABEL_NAME: preAuthCapabilities, runProbe, waitForNew, labelTest, compareReports (~6776 tok)
- `02-11-SUMMARY.md` — Phase 2 Plan 11: Bridge Spike Probe Summary (~4064 tok)
- `02-12-PLAN.md` — INGEST_LOCK_SEED: recordConnecting, recordNeedsAttention, readHold, recordBackfillProgress (~4500 tok)
- `02-12-SUMMARY.md` — Phase 2 Plan 12: Ingest Lock and Mailbox Status Summary (~3239 tok)
- `02-13-PLAN.md` — fails: ownerMessageFor, createMailboxCallbacks, createDbStore, seedImapMailbox (~8075 tok)
- `02-13-SUMMARY.md` — Phase 2 Plan 13: Worker Ingest Wiring Summary (~4863 tok)
- `02-14-PLAN.md` (~7014 tok)
- `02-14-SUMMARY.md` — Phase 2 Plan 14: Proton Bridge Spike Summary (~3631 tok)
- `02-15-PLAN.md` — , scripts/bridge-smoke.sh and the workflow file itself; it checks out with actions/checkout pinned t (~4901 tok)
- `02-15-SUMMARY.md` — Phase 2 Plan 15: Bridge trust command, Renovate pin bumps and Bridge image CI Summary (~3644 tok)
- `02-16-PLAN.md` — yes: resumeMailbox, backfillMailbox (~5673 tok)
- `02-16-SUMMARY.md` — Phase 2 Plan 16: Owner Mailbox Commands Summary (~3069 tok)
- `02-17-PLAN.md` (~6094 tok)
- `02-17-SUMMARY.md` — Phase 2 Plan 17: Owner and Contributor Docs for Bridge and Ingest Summary (~4163 tok)
- `02-18-PLAN.md` — cert_untrusted: capturePeerCertificate, openImap, closeImap + 3 more (~8301 tok)
- `02-18-SUMMARY.md` — Phase 2 Plan 18: Pinned, Fail-Closed IMAP Connection Summary (~3429 tok)
- `02-19-PLAN.md` — reviews round 1: live ingest on the owner's Proton mailbox (ROADMAP SC 3-5): worker through Bridge, restart check, new-mail timing, forced UIDVALIDITY resync, counts-only 02-LIVE-INGEST.md + doc test (~6692 tok)
- `02-19-SUMMARY.md` — Phase 2 Plan 19: Live Ingest on the Owner's Proton Mailbox Summary (~2648 tok)
- `02-20-PLAN.md` — Declares readme (~7342 tok)
- `02-21-PLAN.md` — Declares pnpm (~5297 tok)
- `02-21-SUMMARY.md` — Phase 2 Plan 21: compose-smoke status check reachable without IMAP Summary (~3233 tok)
- `02-CONTEXT.md` — Phase 2: Bridge Spike and IMAP Ingest - Context (~5019 tok)
- `02-DISCUSSION-LOG.md` — Phase 2: Bridge Spike and IMAP Ingest - Discussion Log (~2174 tok)
- `02-LIVE-INGEST.md` — Phase 2 Live Ingest: the worker against the owner's Proton mailbox; Method keeps the 30->1 deviation plus a 2026-10-07 correction citing spike value 3 (~3164 tok)
- `02-LIVE-INGEST.md` — Phase 2 live ingest record on the owner's mailbox (counts only): Method, mid-sync historical rows, criterion 3 (criteria 4-5 pending) (~1900 tok)
- `02-PATTERNS.md` — Phase 2: Bridge Spike and IMAP Ingest - Pattern Map (~4845 tok)
- `02-RESEARCH.md` — Phase 2: Bridge Spike and IMAP Ingest - Research (~22318 tok)
- `02-REVIEW-FIX.md` — Phase 02: Code Review Fix Report (~2861 tok)
- `02-REVIEW.md` — Phase 02: Code Review Report (incremental, after review fixes and UAT gap closure) (~3216 tok)
- `02-SECURITY.md` — Phase 02 security contract: 103-row threat register (all closed), accepted risks, auditor observations (~9000 tok)
- `02-SPIKE-FINDINGS.md` — Phase 2 Spike Findings: Proton Bridge against the owner's mailbox; post-spike initial_backfill_days 3 with a dated correction keeping the spike-time 30 (~3299 tok)
- `02-USER-SETUP.md` — Phase 2: User Setup Required (~548 tok)
- `02-VALIDATION.md` — status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6) (~3569 tok)
- `02-VERIFICATION.md` — Phase 2: Bridge Spike and IMAP Ingest Verification Report (~7894 tok)
- `COVERAGE.md` — Phase 2 External API Coverage (~1267 tok)
- `deferred-items.md` — Phase 2 Deferred Items (~192 tok)

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
- `command.ts` — Process boundary handed to every command, so commands stay testable. (~975 tok)

## apps/worker/src/commands/

- `bridge-probe.ts` — sift bridge probe <slug> (02-11): flags --label-test --uid --wait-new-seconds --compare <file|-> --sample --scan-limit; preAuthCapabilities + openImap(disableAutoEnable) + runProbe; JSON report on stdout, counts-only stderr (~3200 tok)
- `bridge-trust.ts` — The owner's other, independent reading of the fingerprint (D-73, D-79). The (~1485 tok)
- `config-apply.ts` — sift config apply [--confirm]: loadConfig (schema only, D-67) -> applyConfig; prints describeChange lines / already matches / rename hint + No changes applied. (exit 1) (~1098 tok)
- `config-check.ts` — sift config check [--schema-only]: loadConfig + applyEnvOverrides + D-35 checkMailboxEnv; prints formatIssue lines, exit 1 on any (~520 tok)
- `mailbox-backfill.ts` — How long the backfill waits for the mailbox's ingest lock (D-03): one (~3586 tok)
- `mailbox-backfill.ts` — sift mailbox backfill <slug> [--days n] [--yes]: backfillMailbox counts (countBackfill), confirms, runBackfill under withIngestLock retried for BACKFILL_LOCK_WAIT_MS; owner texts (~3600 tok)
- `mailbox-list.ts` — sift mailbox list: SLUG STATUS MESSAGES LAST SEEN LAST SYNC; exhaustive status switch: connecting, needs attention (+ resume approved), ok + backfilling x of y, error, disabled, never run (~900 tok)
- `mailbox-rename.ts` — sift mailbox rename <old> <new>: usage exit 2, renameMailbox, prints config/setup follow-up; errors exit 1 (~519 tok)
- `mailbox-resume.ts` — sift mailbox resume <slug>: resumeMailbox approves the held count in needs_attention; not-waiting line exit 0; unknown slug exit 1 (~500 tok)
- `mailbox-resume.ts` — `sift mailbox resume <slug>` (D-26). The volume valve holds new mail when a (~591 tok)
- `migrate.ts` — sift migrate: owner URL + app password (+ SIFT_BACKUP_DATABASE_URL/DIR, SIFT_PG_DUMP) -> migrate(); prints Backup written / Applied n / No pending migrations.; errors redacted (~848 tok)
- `setup.ts` — Show a path relative to the working directory when it lives under it. (~591 tok)
- `worker.ts` — Show a path relative to the working directory when it lives under it. (~1309 tok)

## apps/worker/src/imap/

- `capture.ts` — capturePeerCertificate (D-80): verification-off handshake writing only `C1 STARTTLS` (starttls) or nothing (implicit); closes with close_notify; SIFT_NO_STARTTLS / SIFT_TLS_CAPTURE_TIMEOUT codes; no state, no fs (~2600 tok)
- `connect.ts` — openImap (capture -> pin compare -> ca:[captured] + SPKI checkServerIdentity; no pin = default verification), guardPlaintext (only CAPABILITY/STARTTLS before TLS; ID/LOGOUT skipped), closeImap (5 s logout bound), classifyImapError (codes/flags via cause, 5 levels), PinMismatchError (~2500 tok)
- `folder-source.ts` — createFolderSource(client): read-only FolderSource over ImapFlow (EXAMINE, fetchAll, maxBytes+1 truncation, fail-closed SEARCH/part/folder guards); toUidSet. (~2805 tok)
- `pin.ts` — spkiSha256(pem), peerSpkiSha256(cert) (hashes SPKI from cert.raw; Node's pubkey is a bare point for EC), pemFromDer (~420 tok)

## apps/worker/src/ingest/

- `db-store.ts` — The sync engine's store over the database (02-13): every IngestStore method (~2038 tok)
- `identity.ts` — pure identity keys (D-12/D-13/D-82): stripNul, truncateCodePoints, normaliseMessageId (null if empty/<>/>998 bytes), stableHeaderHash, identityKey pm:/mid:/hdr:v1: (~1341 tok)
- `message.ts` — HEADER_FIELDS + caps; parseHeaderBlock (libmime, never throws), parseMessage, selectTextPart, attachmentsOf, toBodyText (html-to-text, maxDepth 200) (~2400 tok)
- `plan.ts` — Pure sync-engine helpers (02-10): isCandidateNew (strict > watermark-overlap), aboveLastUid (n:* filter), chunk, pendingGenerationFor (reuse vs fresh generation), backfillWindow, formatResyncLine (D-25) (~1002 tok)
- `run.ts` — Sync engine (02-10): runIngest (first sync with clock-tolerant watermark, poll + valve, removal diff, backfill slice, sweep, two-pass generation resync), countBackfill/runBackfill (BackfillPlan carries uidValidity), BackfillRefusedError, tuning constants (~7084 tok)
- `types.ts` — ingest contracts only: FolderSource, IngestStore, HeaderRecord, BodyNode, ParsedMessage, MessageRecord, FolderState, IngestOutcome (~1610 tok)

## apps/worker/src/runtime/

- `backoff.ts` — computeBackoff(failures, intervalMs, random): interval*2^failures, +/-20% jitter, capped at BACKOFF_CAP_MS 900000 (D-51) (~181 tok)
- `heartbeat.ts` — defaultHeartbeatFile(env) (SIFT_HEARTBEAT_FILE or <tmpdir>/sift/heartbeat); createHeartbeat(file) writes ISO timestamp via temp+rename (D-54) (~310 tok)
- `mailbox-batch.ts` — After the worker starts, connection failures (unreachable, timeout) show as (~4766 tok)
- `run-until-stopped.ts` — runUntilStopped(supervisor, log, waitForSignal): signal -> exit 0, supervisor.stalled -> one error log line + exit EXIT_HEARTBEAT_STALLED=75 (IN-05); bounded drain either way (~520 tok)
- `shutdown.ts` — waitForShutdownSignal(abort?): first SIGTERM/SIGINT; listeners removed so a second signal force-exits (D-53); abort removes them too (IN-05) (~260 tok)
- `startup.ts` — checkDrift(db, config): planRegistryChanges(config, readRegistry).map(describeChange); [] = no drift (D-34) (~180 tok)
- `supervisor.ts` — createSupervisor (D-49..D-53): tick loop, backoff, skip-not-queue, heartbeat stall; nudge(id) (D-28); runBatch(mailbox, shutdown signal aborted at stop()) (~4700 tok)

## apps/worker/src/spike/

- `probe.ts` — Spike probe (SPK-01..04, D-43): ProbeReport, preAuthCapabilities, runProbe (raw ENABLE/STATUS via exec, LIST counts, identity stats, hashed sample), labelTest (COPYUID-gated), waitForNew (IDLE), compareReports, parseProbeReport, encodeModifiedUtf7 (~7000 tok)

## apps/worker/test/

- `bridge-image.test.ts` — The all-interfaces IPv4 address, assembled from parts so this file does not (~1257 tok)
- `bridge-probe.test.ts` — Probe vs Dovecot: privacy sentinels, CONDSTORE positive control, BAD/NO/none, label test (confirmed, unconfirmed, too old, no COPYUID, COPY from SELECTed source), IDLE new UID, --compare file/stdin (~7000 tok)
- `bridge-trust.test.ts` — Named in the config, never set: the command must not need it (D-80). (~2379 tok)
- `ci-workflow.test.ts` — Index of the first run step containing `command`, or -1. (~1250 tok)
- `cli.test.ts` — Deferred mailbox hard-delete command (D-69). It must not appear in any CLI output. (~623 tok)
- `compose-smoke.test.ts` — runs compose-smoke.sh in a temp repo copy with docker/uname/id/sudo shims: CR-01 modes, WR-01 volume, CR-02 backup dir, WR-09 docker-state guard, IN-08 own files/image; runStack emulates a healthy stack and logs psql SQL for the G-02-14 status wait (pass, missing row, no ok query) (~6700 tok)
- `compose.test.ts` — A long-syntax volume entry (`type: bind`, `source`, `target`, ...). (~4554 tok)
- `dependencies.test.ts` — Supply-chain checks for the worker's npm dependencies (D-77): owner-approved (~1733 tok)
- `drift.test.ts` — spawns sift worker on a drifted config (personal port 1144 + mailbox side): exit 1, differences, setup command, no status rows (~1218 tok)
- `imap-capture.test.ts` — FakeImapServer: fake, sourceFiles, source (~2197 tok)
- `imap-connect.test.ts` — Bridge v3.27.0's pre-login capability list (RESEARCH), which includes ID. (~3648 tok)
- `imap-folder-source.test.ts` — FolderSource tests: toUidSet, client-double guards, Dovecot cases (MIME fixtures, exact-64 truncation, n:*, D-11 flags unchanged, UIDVALIDITY). (~4514 tok)
- `imap-pin.test.ts` — The four stages bridge/entrypoint.sh pipes a PEM through (spki_fingerprint). (~2315 tok)
- `ingest-e2e.test.ts` — The worker's own mailbox callbacks, end to end (02-13): the real database (~1363 tok)
- `ingest-engine.test.ts` — 37 engine cases: first sync (empty, lagging clock, D-20), backfill slices/progress ordering, polling, valve, removal diff, sweep, CLI backfill (~7492 tok)
- `ingest-identity.test.ts` — 02-07 identity keys, D-13 normalisation, hdr:v1 hash, hostile header blocks (~2988 tok)
- `ingest-message.test.ts` — 02-07 body part selection, HTML to text, code-point caps, attachment metadata (~2600 tok)
- `ingest-resync.test.ts` — 19 cases: plan helpers, UIDVALIDITY resync, valve before writes, 5-row crash/retry table, double UIDVALIDITY change, backfill restart (~4809 tok)
- `lint-guard.test.ts` — IN-02: lints probe files at apps/worker/src in a scratch copy with the real biome.json; relative/deep imports of packages/*/src are rejected (~724 tok)
- `read-only-ingest.test.ts` — T-02-31/D-11 static guard: no ImapFlow write call or non-readOnly mailboxOpen in apps/worker/src outside spike/probe.ts; self-checks patterns on the probe (~700 tok)
- `live-ingest-record.test.ts` — Doc-contract test for 02-LIVE-INGEST.md: sections, criterion/method/result lines, D-86 simulated-mismatch rule, D-84 backfill value or documented override (cited value matched exactly), privacy scan (~1007 tok)
- `mailbox-batch.test.ts` — Owner-visible mailbox states (02-13 Task 2; D-26, D-33, D-34, D-40, D-72, (~4529 tok)
- `mailbox-ops.test.ts` — Owner mailbox operations (02-16): `sift mailbox resume` releases a volume (~1350 tok)
- `mailbox-ops.test.ts` — 02-16: resume (D-26) and backfill (D-03, D-75) against the real DB and Dovecot; backfill block has its own fresh database (~5000 tok)
- `no-secret-leak.test.ts` — FND-02 / success criterion 2 (automated half, T-01-46): a mailbox password (~2633 tok)
- `node-version.test.ts` — .nvmrc without the leading "v" and surrounding whitespace, e.g. 26.10.0. (~323 tok)
- `read-only-ingest.test.ts` — T-02-31 / D-11: ingest never changes the owner's mail. folder-source.ts (~746 tok)
- `registry-cli.test.ts` — 01-09 tracer: config apply + mailbox list via spawned CLI with no mailbox secrets in env; 02-16 in-process list rendering of every state (~1400 tok)
- `run-until-stopped.test.ts` — IN-05: stall -> exit 75 with the exact pino line (no URL), signal -> exit 0, abortable signal listeners (~1598 tok)
- `setup.test.ts` — Version-18 check for a host PostgreSQL client binary. (~2096 tok)
- `spike-findings.test.ts` — Doc-contract test for 02-SPIKE-FINDINGS.md and the ADR-0003 addendum: sections, decision lines, backfill line (exactly one value line), privacy scan with config username denylist (~1452 tok)
- `supervisor.test.ts` — Fake-timer supervisor tests: cadence, backoff, disable, drain, heartbeat stall, nudge (D-28), shutdown signal (~7500 tok)
- `user-facing-text.test.ts` — README/CONTRIBUTING pins, D-69 deferred-command scan, Technical settings YAML schema check, Proton-only scope + NTP clock + absent other-server phrases (G-02-8/9) (~3015 tok)
- `worker-errors.test.ts` — IN-04: in-process worker run with SELECT on mailbox revoked; unexpected pg error logged via pino, redacted, SQLSTATE, exit 1, no stderr (~792 tok)
- `worker.test.ts` — 01-10 tracer: spawns sift worker on freshDatabase (applyConfig first), waits for ok status + heartbeat, SIGTERM exit 0; missing env -> one JSON line, exit 1 (~1768 tok)

## apps/worker/test/fixtures/mail/


## apps/worker/test/support/

- `fake-folder-source.ts` — FakeFolderSource (RFC 3501 sets incl. n:*, day-granular SEARCH SINCE, append/expunge/bumpUidValidity({renumber}), calls, failOn) and fakeMail() (02-10) (~2284 tok)
- `fake-imap-server.ts` — startFakeImapServer (plain/starttls/implicit, per-connection certs, records plaintextLines + decrypted tlsBytes, greeting '' = never greets) and makeTestCertificates (openssl EC: captured, unrelated, issuedByCaptured) (~2400 tok)
- `fake-ingest-store.ts` — FakeIngestStore mirroring the 02-06 use-cases; one structuredClone transaction per call; events/overlaps, commitLog, failOn, holdCommit, read helpers (02-10) (~4465 tok)
- `mailbox-harness.ts` — Shared pieces of the worker-callback tests (02-13): a config entry for a (~1961 tok)
- `privacy-scan.ts` — privacyProblems(text, denylist) (line numbers + kinds, never matched text) and configDenylist(configPath) (imap usernames + local parts; [] without config). Shared with 02-19 (~806 tok)
- `test-imap.ts` — Helpers for the Dovecot test server started by `scripts/test-imap.sh up` (appendMessage, createFolder, messageFlags, setFlags, bumpUidValidity, testImapPin). (~2300 tok)

## bridge/

- `Dockerfile` — Docker container definition (~686 tok)
- `entrypoint.sh` — Entrypoint of the Sift Proton Bridge image (bridge/Dockerfile). (~1846 tok)

## bridge/helper/

- `envfile_test.go` — TestUpsertEnv, TestUpsertEnvRejectsBadNamesAndValues, TestWriteInPlace, TestBackupInPlace, TestWrite (~3963 tok)
- `envfile.go` — 02-08 UpsertEnv, WriteInPlace (O_WRONLY|O_TRUNC, no create/rename), BackupInPlace (0600, re-read verify), WriteMailboxPasswords (exit codes, fixed msgs), PlanMailboxPasswords; test hooks writeAll/openForWrite/afterBackupWrite (~2670 tok)
- `main_test.go` — TestWaitUsersLoaded, TestWaitUsersLoadedStopsOnError, TestNoAccountIsNotLoading (~589 tok)
- `main.go` — Command sift-helper drives Proton Bridge's gRPC frontend for the Sift (~3347 tok)

## config/

- `config.example.yaml` — Sift configuration (version 1) (~368 tok)
- `config.example.yaml` — Shipped example config v1: two mailboxes (personal, job-search), models, worker; rerun-setup comment (~330 tok)
- `config.yaml` — Sift configuration (version 1) (~416 tok)

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
- `index.ts` — Declares EnvCheck (~248 tok)
- `index.ts` — @sift/core/config barrel (~180 tok)
- `load.ts` — Alias expansion cap (T-01-14). A real config never needs anchors at all. (~1376 tok)
- `load.ts` — parseConfigText/loadConfig: yaml LineCounter positions, literal-secret pre-pass, required-key sentinel, file-order issues (~1900 tok)
- `schema.ts` — Default Ollama endpoint as seen from inside the Compose network (D-60). (~3121 tok)
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
- `0005_ingest_preflight.sql` — DO block: per-mailbox set_config check; RAISEs if message/folder_sync hold rows (T-02-63) (~330 tok)
- `0006_ingest_tables.sql` — generated: message_location, message_body, message identity/metadata cols, folder_sync/mailbox_status state + checks (~2400 tok)
- `0007_ingest_tables_force_grants.sql` — FORCE RLS, grants, set_updated_at triggers for message_location/message_body (~170 tok)

## packages/db/src/

- `app-db.ts` — createAppDb: opaque AppDb {close} over pg.Pool+drizzle (WeakMap internals, pool error handler); internal internalsOf (not exported) (~614 tok)
- `connect.ts` — @sift/db/connect: classifyConnectError, connectWithRetry (250ms doubling cap 5s ±20%, 30s deadline, per-attempt bound), assertUnprivilegedRole, DatabaseStartupError (~1798 tok)
- `index.ts` — Database connection-string variables. Values are secrets and are never logged. (~392 tok)
- `ingest.ts` — 12 ingest use-cases (02-06): storeMessages (identity-key grouping, ids by key not position, stripNul, promoteEligible), folder_sync get/create/advance(monotonic)/setFolderBackfill, liveLocations, markLocationsRemoved, deleteOrphanBodies, knownIdentityKeys, begin/finishResync, deleteExpiredBodies (~5000 tok)
- `lock.ts` — 02-12: withIngestLock (pg_try_advisory_lock(hashtextextended(id, INGEST_LOCK_SEED=815309)) on a dedicated pooled client; {acquired:false} when busy), IngestSession.run (runScoped on the lock client, not re-entrant: IngestSessionBusyError), client error listener, discard dead/unknown-lock clients, waits for in-flight run (~1700 tok)
- `registry-plan.ts` — pure (type-only imports): planRegistryChanges, findRenameSuspects, describeChange, mailboxValuesFromConfig, RegistryChange (~1551 tok)
- `registry-read.ts` — Every mailbox row, ordered by slug, disabled ones included. The registry (~161 tok)
- `rls.ts` — Roles are created outside drizzle-kit: sift_owner by db/bootstrap.sql and (~283 tok)
- `scope.ts` — A registered mailbox-scoped table: it has a mailbox_id column. (~5308 tok)
- `status.ts` — mailbox_status use-cases: recordMailboxSeen, recordSyncSuccess (clears held/approved), recordSyncError (redacted), recordDisabled, recordConnecting (D-34), recordNeedsAttention (held + 'sift mailbox resume <slug>', D-26), readHold, recordBackfillProgress (D-75) (~1100 tok)

## packages/db/src/owner/

- `backup.ts` — BACKUP_KEEP, BackupTarget, BackupFailedError, backupFileName, ensureWritableDir (chown 1000 hint), writeBackup (pg_dump -> 0600 wx file, PGPASSWORD only), pruneBackups (~1535 tok)
- `migrate.ts` — migrate(): advisory lock -> pending detection -> required backup (BackupRequiredError) -> ensureAppRole -> drizzle migrator; returns { applied, backupFile } (~1618 tok)
- `registry.ts` — Owner-side mailbox registry operations (FND-02, D-32, D-33). Every function (~2825 tok)
- `scram.ts` — IN-03: scramSha256Verifier(password, salt?, iterations?) builds PG's SCRAM-SHA-256 stored verifier client-side (node-pg SASLprep); migrate sends it instead of plaintext (~476 tok)

## packages/db/src/schema/

- `index.ts` — Every mailbox-scoped table: NOT NULL mailbox_id, forced RLS, one policy. (~310 tok)
- `mailbox.ts` — Mailbox registry (D-06). Configuration, not mail-derived data, so it has no (~356 tok)
- `scoped.ts` — Mailbox-scoped tables (ISO-01). Each one has a NOT NULL mailbox_id that (~3315 tok)

## packages/db/test/

- `catalog.test.ts` — catalog schema check: clean schema returns [], 9 negative tests (rogue table, nullable mailbox_id, grants, 2nd policy, BYPASSRLS role, FK/key/trigger drift) (~1500 tok)
- `connect.test.ts` — classify table, live 28P01/3D000/closed-port retry, role guard in-process and via worker CLI with the admin URL (~2219 tok)
- `global-setup.ts` — Migrate one throwaway template database per run with the real migrate() (~971 tok)
- `ingest.test.ts` — Ingest use-cases (ING-02, ING-04, D-14, D-15, D-07, D-17, D-21..D-25) on a (~8514 tok)
- `isolation.test.ts` — D-48 isolation suite on raw sift_app clients over SCOPED_TABLE_NAMES: A-only reads, B-aimed writes 0 rows, 42501/23503/22P02/23502 edges, stale/fresh/upper-case/empty scope (~4000 tok)
- `lock.test.ts` — 10 ingest-lock tests with two app-role AppDbs (application_name per 'process'): contention, one backend per holder, nested/overlapping run refused with no SQL, fn throw, pg_terminate_backend (lock freed, client discarded), in-flight run, closed session, invalid id (~3000 tok)
- `migrate.test.ts` — The trivial migration withExtraMigration appends after the committed ones. (~8608 tok)
- `owner-rls.test.ts` — D-70: unscoped sift_owner DELETE removes nothing; under A removes all A rows, none of B (~1200 tok)
- `registry-plan.test.ts` — 10 pure planRegistryChanges/findRenameSuspects/describeChange tests (~1290 tok)
- `registry.test.ts` — 19 tests: applyConfig guards/snapshot/concurrency/rollback/re-enable, renameMailbox, CLI apply/list/rename + D-69 output check (~3976 tok)
- `scope.test.ts` — The scoped API (ISO-04, D-42..D-45): the only data-access surface app code (~10372 tok)
- `scram.test.ts` — IN-03: verifier equals PG's own for the same salt (incl. SASLprep chars); a role created with it logs in over TCP; wrong password 28P01 (~990 tok)
- `status.test.ts` — 30 status tests: connecting, needs_attention + readHold, approved cleared on success, backfill progress, 25-pair it.each transition matrix (~1854 tok)

## packages/db/test/support/

- `catalog.ts` — collectCatalogViolations(client, allowlist?), CATALOG_ALLOWLIST, STANDARD_POLICY_EXPR: pg_catalog checks for RLS/policy/mailbox_id/privileges/roles/registry/keys/triggers (~4932 tok)
- `db.ts` — Provided by packages/db/test/global-setup.ts as inject('testDb'). (~967 tok)
- `seed.ts` — Insert one mailbox row per slug as sift_owner and return slug -> id. (~1533 tok)

## scripts/

- `bridge-smoke.sh` — Bridge image smoke test: build bridge/Dockerfile, then on throwaway volumes; incl. planted bridge-v3/insecure → exit 78 (~1650 tok)
- `compose-smoke.sh` — Full-stack smoke test. Own volume <project>-pgdata-smoke, own files in .smoke/<project>/ (.env via --env-file, .env.mailboxes, config with imap.smoke.invalid, backups), image sift-smoke:local; refuses projects with non-smoke containers; final checks: migrations, mailboxes registered/enabled, then waits (inside SMOKE_TIMEOUT) for a connecting or error status row per enabled mailbox (G-02-14; never ok) (~3300 tok)
- `pg-dump-via-compose.sh` — SIFT_PG_DUMP wrapper: pg_dump 18 inside the Compose db container, --dbname host rewritten to db:5432 (scram, not loopback trust) (~250 tok)
- `test-imap.sh` — Dovecot IMAP server for tests: a real STARTTLS server with a self-signed (~1116 tok)
