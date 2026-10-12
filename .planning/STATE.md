---
gsd_state_version: "1.0"
milestone: v0.1
milestone_name: "Classify (README M1, \"M1 on real inbox\")"
current_phase: 03
current_phase_name: Tiered Classification with Traces
status: executing
stopped_at: Completed 03-23-PLAN.md
last_updated: "2026-10-12T19:33:28.383Z"
last_activity: 2026-10-12
last_activity_desc: Phase 03 execution started
state_head: 0c41d9b47acd8be20f91ceaa07b54edfe872d7f1
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 58
  completed_plans: 57
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-05)

**Core value:** Every incoming email is auto-labelled correctly or explicitly held for the owner, entirely on local hardware, with a decision trace explaining why.
**Current focus:** Phase 03 — Tiered Classification with Traces

## Current Position

Phase: 03 (Tiered Classification with Traces) — EXECUTING
Plan: 24 of 24
Status: Ready to execute
Last activity: 2026-10-12 — Phase 03 execution started

Progress: [███░░░░░░░] 25%

## Performance Metrics

**Velocity:**
- Total plans completed: 13
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 13 | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 57min | 3 tasks | 19 files |
| Phase 01 P02 | 8min | 2 tasks | 5 files |
| Phase 01 P03 | 9min | 2 tasks | 22 files |
| Phase 01 P04 | 13min | 3 tasks | 13 files |
| Phase 01 P05 | 6min | 3 tasks | 4 files |
| Phase 01 P06 | 3min | 3 tasks | 2 files |
| Phase 01 P07 | 6min | 2 tasks | 6 files |
| Phase 01 P08 | 7 min | 2 tasks | 8 files |
| Phase 01 P09 | 7 min | 2 tasks | 8 files |
| Phase 01 P10 | 7 min | 2 tasks | 8 files |
| Phase 01 P11 | 6 min | 3 tasks | 6 files |
| Phase 01 P12 | 37 min | 2 tasks | 14 files |
| Phase 01 P13 | 8 min | 2 tasks | 3 files |
| Phase 02 P01 | 18 min | 2 tasks | 9 files |
| Phase 02 P02 | 6 min | 2 tasks | 7 files |
| Phase 02 P03 | 11 min | 2 tasks | 17 files |
| Phase 02 P04 | 17 min | 3 tasks | 9 files |
| Phase 02 P05 | 10 min | 2 tasks | 2 files |
| Phase 02 P06 | 8 min | 2 tasks | 5 files |
| Phase 02 P07 | 6 min | 2 tasks | 5 files |
| Phase 02 P08 | 23 min | 2 tasks | 7 files |
| Phase 02 P18 | 20 min | 3 tasks | 7 files |
| Phase 02 P09 | 25 min | 2 tasks | 10 files |
| Phase 02 P10 | 14 min | 3 tasks | 6 files |
| Phase 02 P11 | 18 min | 2 tasks | 6 files |
| Phase 02 P12 | 11 min | 2 tasks | 7 files |
| Phase 02 P13 | 14 min | 3 tasks | 10 files |
| Phase 02 P15 | 6min | 2 tasks | 7 files |
| Phase 02 P14 | 65min | 3 tasks | 6 files |
| Phase 02 P16 | 15min | 3 tasks | 10 files |
| Phase 02 P17 | 15 min | 2 tasks | 3 files |
| Phase 02 P19 | 4h40m | 3 tasks | 2 files |
| Phase 02 P21 | 21 min | 3 tasks | 6 files |
| Phase 03 P01 | 13 min | 3 tasks | 12 files |
| Phase 03 P02 | 6 min | 2 tasks | 10 files |
| Phase 03 P03 | 14 min | 2 tasks | 19 files |
| Phase 03 P05 | 11 min | 2 tasks | 10 files |
| Phase 03 P04 | 14 min | 3 tasks | 8 files |
| Phase 03 P06 | 16 min | 2 tasks | 7 files |
| Phase 03 P07 | 13 min | 3 tasks | 8 files |
| Phase 03 P11 | 25 min | 3 tasks | 10 files |
| Phase 03 P08 | 18 min | 3 tasks | 7 files |
| Phase 03 P09 | 15 min | 3 tasks | 7 files |
| Phase 03 P12 | 22 min | 3 tasks | 6 files |
| Phase 03 P10 | 22 min | 3 tasks | 27 files |
| Phase 03 P13 | 20 min | 2 tasks | 7 files |
| Phase 03 P14 | 12 min | 2 tasks | 7 files |
| Phase 03 P15 | 6 min | 2 tasks | 6 files |
| Phase 03 P21 | 5 min | 2 tasks | 3 files |
| Phase 03 P16 | 7 min | 2 tasks | 6 files |
| Phase 03 P17 | 14 min | 2 tasks | 9 files |
| Phase 03 P18 | 21 min | 2 tasks | 10 files |
| Phase 03 P19 | 8 min | 3 tasks | 10 files |
| Phase 03 P22 | 8min | 2 tasks | 4 files |
| Phase 03 P20 | 16 min | 2 tasks | 7 files |
| Phase 03 P23 | 4min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

Locked decisions (ADR-0001/0002/0003) are in PROJECT.md `<decisions>`; full log in PROJECT.md Key Decisions.
Recent decisions affecting current work:

- [Init]: Every mail-derived table has non-null `mailbox_id` + RLS from Phase 1 (ADR-0001 wins over README "shared"/"synthetic" wording)
- [Init]: Bridge spike sits in Phase 2, ahead of ingest and label application, because its findings shape both
- [Init]: M1 has no classifier and no UI; traces are read via CLI or SQL
- [Init]: M1 traces reserve a classifier span marked skipped ("not trained") so M2 does not change the trace layout (TRC-06)
- [Phase 01]: 01-01: @types/node pinned at 26.6.3, the newest 26.x past the 7-day minimumReleaseAge gate
- [Phase 01]: 01-01: Biome 2.5 uses rules.preset recommended (boolean recommended is deprecated) and !dir folder negations
- [Phase 01]: 01-01: Root tsconfig sets allowJs+checkJs so root .js config files are type-checked
- [Phase 01]: 01-01: Commits run lefthook (biome pre-commit, commitlint commit-msg); header/body lines <=100 chars, never --no-verify
- [Phase 01]: 01-02: bootstrap ALTER ROLE re-asserts full role attributes on every run (repairs drift) and RAISEs on missing/empty password env
- [Phase 01]: 01-02: vector is created by the superuser in template1 so sift_test_* databases inherit it; sift_app is created by sift migrate, not the bootstrap
- [Phase 01]: 01-03: migrate() rebuilds role DDL errors from SQLSTATE + server message only; the statement (password literal) never reaches logs or errors
- [Phase 01]: 01-03: each table-adding generated migration is followed by a custom migration (FORCE RLS, explicit grants, set_updated_at trigger) applied in the same migrator transaction
- [Phase 01]: 01-03: test clones are sift_test_<run>_<n>_<hex> (workers share runId); globalSetup drops the run's DBs if template migration fails
- [Phase 01]: 01-04: config missing-key fallback is a per-parse Zod error map sentinel, so schema-specific messages (version, mailboxes) win; duplicate checks use superRefine when:()=>true to report beside type errors
- [Phase 01]: 01-04: literal-secret keys are rejected by a YAML pre-pass before Zod (values never echoed); YAML parsed with prettyErrors:false so syntax errors never quote source; maxAliasCount 50 on doc.toJS
- [Phase 01]: 01-04: config check --schema-only skips the D-35 presence check (D-67); SIFT_MODELS_URL override is validated with the same HttpUrl as models.url
- [Phase 01]: 01-05: catalog check (collectCatalogViolations) asserts D-37/D-38/D-40/D-66 from pg_catalog; composite key = UNIQUE or PK on exactly (mailbox_id, id); FK mailbox_id pairing is positional
- [Phase 01]: 01-05: CI workflow ci/check pins actions/checkout@v7, pnpm/action-setup@v6, setup-node@v7 (.nvmrc); bootstrap via docker exec of db/bootstrap.sql; GitHub run is a pending end-of-phase human check
- [Phase 01]: 01-06: isolation tests iterate SCOPED_TABLE_NAMES on raw sift_app clients and compare sorted id sets to superuser ground truth; mailbox_status uses mailbox_id as its id
- [Phase 01]: 01-06: append-only 42501 is asserted on unfiltered UPDATE/DELETE so it can only be the privilege check (RLS alone gives 0 rows)
- [Phase 01]: 01-07: Scoped API is opaque: AppDb/Scope internals in module-private WeakMaps; Scope frozen and closed once the callback settles
- [Phase 01]: 01-07: Helpers re-check D-44/D-40 at runtime (mailboxId/id in update sets, unknown Match keys throw TypeError); empty update/upsert is a touch
- [Phase 01]: 01-07: ISO-04 application filter proven on a superuser (RLS-bypassing) connection; @sift/db root exports pinned by test
- [Phase 01]: 01-08: pg-dump-via-compose.sh targets db:5432; loopback is trust in the postgres image, so 127.0.0.1 skipped password auth
- [Phase 01]: 01-08: MigrateOptions.backup is a required key (target | false | undefined); BackupTarget/BackupFailedError live in backup.ts, re-exported by migrate.ts
- [Phase 01]: 01-08: backup tests read pg_restore 18 from the Compose db container when SIFT_PG_DUMP is the compose wrapper
- [Phase 01]: 01-09: config apply validates the schema only (no checkMailboxEnv, no env overrides) and reconciles in one transaction under pg_advisory_xact_lock(815309002); rename suspects are refused without --confirm
- [Phase 01]: 01-09: sift mailbox rename keeps the mailbox id and shares the config-apply advisory lock; mailbox list reads mailbox_status under app.mailbox_id
- [Phase 01]: 01-10: supervisor schedules the next successful run from the run's start time, so 15 s ticks do not stretch the 60 s poll interval
- [Phase 01]: 01-10: in-progress tracking is keyed by mailbox id apart from schedule state; disable/re-enable during a run cannot overlap it
- [Phase 01]: 01-10: supervisor logs error name/code only unless an injected redact() is given; worker passes redactText with mailbox secrets and the DB URL
- [Phase 01]: 01-11: connectWithRetry bounds each attempt by the remaining deadline (ETIMEDOUT) so the ~30 s D-55 budget holds on a black-holed host
- [Phase 01]: 01-11: startup errors map codes to fixed messages, driver messages are never logged (T-01-45); worker order is connect, role guard, drift check, supervisor
- [Phase 01]: 01-11: sentinel test scans every non-system schema from pg_tables with a positive control (FND-02 automated half)
- [Phase 01]: 01-12: compose-smoke.sh --down refuses outside CI (CI=true or SMOKE_ALLOW_VOLUME_REMOVAL=yes) because down -v deletes sift-pgdata
- [Phase 01]: 01-12: test files that run migrate() or compare the sift_app verifier hold lockAppRole() (advisory lock in the admin DB) for the whole file
- [Phase 01]: 01-12: worker env_file .env.mailboxes must exist for any docker compose command on Compose v2.2.3; developers copy .env.mailboxes.example
- [Phase 01]: 01-13: README tells owners to recreate the worker (up -d --force-recreate worker) after adding a mailbox password; env_file is read only at container creation
- [Phase 01]: 01-13: user-facing-text.test.ts enforces D-69 over docs, example env/config, compose.yaml, Dockerfile and shipped src; update it when the deferred command ships
- [Phase 01]: UAT 4/4 passed 2026-10-05 (target bring-up, real-password grep, GitHub CI incl. compose-smoke, id-based isolation asserts); Nyquist-compliant
- [Phase 02]: 02-01: bridge entrypoint starts Bridge before socat; on a new vault Bridge's free-port probe also tries the wildcard address, so an early socat on <container IP>:1143 pushed it to 1144
- [Phase 02]: 02-01: keychain canary runs pass with --pinentry-mode=error under a 30 s timeout so a wrong passphrase exits 78 at once; runtime image adds procps for pkill
- [Phase 02]: 02-01: compose-smoke builds/starts only db setup worker on <project>-bridge-smoke with SIFT_MAILBOXES_BAK_FILE pointed at a missing path; plain docker compose up now also starts bridge (exit 78 until bridge-init runs)
- [Phase 02]: 02-02: imap.tls (mode starttls|implicit, optional base64 SHA-256 pin_sha256) and per-mailbox ingest (initial_backfill_days 0-365 default 30, new_mail_cap 1-10000 default 200) added with no config version bump; example config targets host bridge:1143
- [Phase 02]: 02-02: pin_sha256 is trimmed then shape-checked; block-level 'must be a mapping' errors on strictObject do not override Zod's unrecognized-key message
- [Phase 02]: 02-03: message_location_removed_check guards removed_reason is not null; a check accepts NULL, so the planned text let removed_at with no reason pass
- [Phase 02]: 02-03: migrate() throws MigrationFailedError with the driver error message (drizzle Failed query wrapper kept as cause), so sift migrate prints the 0005 preflight text and mailbox slug
- [Phase 02]: 02-03: migration counts and tags in migrate.test.ts and setup.test.ts are derived from meta/_journal.json
- [Phase 02]: 02-04: test IMAP server makes its own CA:TRUE cert per container (image snakeoil is CA:FALSE with a public key); container sift-test-imap-<port>
- [Phase 02]: 02-04: license check covers --filter '@sift/worker...' and reads SPDX OR/AND; @zone-eu/mailsplit (MIT OR EUPL-1.1+) used under MIT
- [Phase 02]: 02-05: nudge() on a running mailbox only flags it; one follow-up run after a success, a failed run drops the nudge and keeps D-51 backoff
- [Phase 02]: 02-05: one AbortController per supervisor; runBatch(entry, shutdown.signal); stop() aborts it before the bounded drain
- [Phase 02]: 02-06: upsert inserted flag uses RETURNING (xmax = 0); A1 held on PG 18.6 + Drizzle 0.45.3, no select-before-insert fallback
- [Phase 02]: 02-06: markLocationsRemoved marks only live locations, keeping the first removal time and reason
- [Phase 02]: 02-06: advanceFolderSync is monotonic in app code, writes nothing when no value moves forward, throws when moving a cursor with no backfill pending
- [Phase 02]: 02-06: array Match values may not hold null (TypeError); storeMessages leaves supplying an eligible message's body to the caller (02-07)
- [Phase 02]: 02-07: Message-IDs over 998 UTF-8 bytes fall through to hdr:v1: so identity_key never exceeds the unique-index row limit
- [Phase 02]: 02-07: the hdr: hash reads raw (undecoded) header values, so a libmime upgrade cannot change stored keys
- [Phase 02]: 02-07: html-to-text runs with limits.maxDepth 200; deeper HTML nesting overflowed the stack
- [Phase 02]: 02-07: message/* attached messages are never entered for body selection or attachment listing
- [Phase 02]: 02-08: sift-helper uses Bridge's own service.Config loader and the server-token metadata; the entrypoint deletes a stale grpcServerConfig.json before each gRPC start
- [Phase 02]: 02-08: only CONNECTED Bridge accounts give an IMAP password; signed-out or locked accounts produce a per-mailbox skip line
- [Phase 02]: 02-08: one-shot Bridge modes probe the single-instance lock with flock -n and refuse while the bridge service runs (exit 1)
- [Phase 02]: 02-08: configure continues without a fingerprint (stderr message); invalid password_env names exit 1 with nothing written
- [Phase 02]: 02-18: ImapFlow sends ID before STARTTLS when the server offers it; openImap wraps client.run so only CAPABILITY and STARTTLS cross before TLS (ID re-sent after login over TLS)
- [Phase 02]: 02-18: peerSpkiSha256 hashes the SPKI from cert.raw; Node's PeerCertificate.pubkey is the bare point for EC keys
- [Phase 02]: 02-18: the capture ends its TLS session with close_notify (no IMAP data) and a 1 s destroy fallback, so the server sees the handshake complete
- [Phase 02]: 02-18: classifyImapError reads only codes and ImapFlow flags through cause (5 levels), never message text
- [Phase 02]: 02-09: downloadText computes truncated from a maxBytes+1 download (decoded length > maxBytes); ImapFlow 2.1.0 expectedSize is the whole message's RFC822.SIZE and BODYSTRUCTURE sizes are encoded, so neither can tell whether decoded text was cut
- [Phase 02]: 02-09: FolderSource.listUids/searchSince throw when ImapFlow returns false (failed SEARCH) instead of returning [], so the 02-10 removal diff cannot mark every message vanished; downloadText throws on a missing part
- [Phase 02]: 02-09: FolderSource methods require client.mailbox to be the exact object examine opened; examine fails closed on an explicit READ-WRITE grant
- [Phase 02]: 02-10: BackfillPlan carries uidValidity; countBackfill/runBackfill refuse (resyncing) under a changed UIDVALIDITY so the confirmed UIDs are the ingested messages
- [Phase 02]: 02-10: resync is two-pass (write-free count pass with the valve, then commit pass at the pending generation); finishResync takes the recomputed backfill cursor; resync lastUid = max(UIDNEXT-1, highest listed UID)
- [Phase 02]: 02-10: engine cycle order is examine, getFolder, first sync or resync, poll (valve before header fetch), removal diff when due, backfill slice, deleteExpiredBodies; aborted.stored counts all records committed in the cycle
- [Phase 02]: 02-11: the probe sends ENABLE CONDSTORE QRESYNC and STATUS HIGHESTMODSEQ raw via ImapFlow exec() and records the tagged status (OK/NO/BAD/none); counts come from client.status() without HIGHESTMODSEQ
- [Phase 02]: 02-11: the label test expunges only the COPYUID-named label copy, only after the original is re-confirmed, and only with UIDPLUS; otherwise it reports 'label copy not confirmed' and leaves the label for the owner
- [Phase 02]: 02-11: --uid needs --label-test, --compare - with --label-test is a usage error (both read stdin), --wait-new-seconds is capped at 3600; CommandIO gained optional stdin
- [Phase 02]: 02-12: Ingest lock key is hashtextextended(mailbox_id, 815309), 64-bit, one session advisory lock per mailbox on a dedicated pooled client that also runs IngestSession.run transactions
- [Phase 02]: 02-12: withIngestLock error precedence: fn error wins, else a dead-connection or unlock error; a dead or possibly-locked client is discarded, a clean fn throw keeps the connection pooled
- [Phase 02]: 02-12: IngestSession.run is not re-entrant (IngestSessionBusyError before any SQL); withIngestLock waits for a run left in flight before unlocking
- [Phase 02]: 02-12: recordNeedsAttention clears approved_new_count and its last_error carries only the count and the sift mailbox resume command; recordSyncSuccess clears held and approved counts
- [Phase 02]: 02-13: removal-diff time set only after a run that diffed (or resynced); setting it after every synced run would postpone the diff forever under 60 s polls
- [Phase 02]: 02-13: only FolderSource and connect errors become MailboxSyncError (owner texts); database errors keep the redacted path with the coded pg error, never Drizzle's query text with mail params
- [Phase 02]: 02-13: a held mailbox (needs_attention, approved null) is skipped without connecting; an approved run uses approved + new_mail_cap
- [Phase 02]: 02-15: sift bridge trust exits 1 for both no pin and a differing pin, prints the pin_sha256 line to paste, never reads password_env, logs in or writes; failures print one fixed text per classifyImapError class
- [Phase 02]: 02-15: renovate.json enables only custom.regex over bridge/Dockerfile; assumption A2 (github-tags fills currentDigest) is unobserved; the Dockerfile commit check plus a prBodyNotes entry are the fail-safe; bridge-image CI smoke-tests every Bridge change (45 min)
- [Phase 02]: 02-14: Bridge v3.27.0 has no CONDSTORE/QRESYNC; sync capability is polling only
- [Phase 02]: 02-14: identity key order pm: (X-Pm-Internal-Id) then mid: then hdr:v1: confirmed; 1.6% of Message-IDs are shared by distinct Proton messages
- [Phase 02]: 02-14: Phase 4 labels: SELECT source, UID COPY into Labels/<name>, record COPYUID; remove via UID STORE \Deleted + UID EXPUNGE in the label folder (Bridge refuses COPY from EXAMINE)
- [Phase 02]: 02-14: Bridge initial sync assigns UIDs newest-first; INTERNALDATE decides new mail; 02-19 starts the worker after sync settles and treats repair as a UIDVALIDITY reset
- [Phase 02]: 02-16: sift mailbox backfill reuses the worker's configEntryFor, trackedSource, ingestKind and storedError (exported from mailbox-batch.ts), so its failures read like the worker's owner texts
- [Phase 02]: 02-16: backfill holds the ingest lock from count through ingest, retries it every 2 s for BACKFILL_LOCK_WAIT_MS (60 s), and an abort between chunks exits 1 with a rerun hint
- [Phase 02]: 02-17: README settings example keeps later-milestone blocks only as comments and pin_sha256 commented, so the active YAML passes the strict schema (tested via loadConfig)
- [Phase 02]: 02-17: spike-dependent README text is scoped to Proton Bridge v3.27.0 in the M1 spike and links 02-SPIKE-FINDINGS.md and the ADR 0003 addendum
- [Phase 02]: 02-17: host development against Bridge uses a dev config outside the repo via SIFT_CONFIG; only config/config.yaml is git-ignored
- [Phase 02]: 02-19: criterion 4 measured by INTERNALDATE in the probe's newest-200 sample, not uidNext, because Bridge's initial sync appends old mail at ~120 UIDs/min
- [Phase 02]: 02-19: criterion 5 by simulated UIDVALIDITY mismatch (owner: ready: simulate); live ingest result partial per D-86
- [Phase 02]: 02-19: live-ingest doc-contract test accepts a backfill value differing from the spike only with a documented Deviation from D-84 (owner override 30 -> 1)
- [Phase 02]: 02-21: compose-smoke checks connecting or error status per enabled mailbox, never ok (smoke IMAP hosts are imap.smoke.invalid); only the state at the SMOKE_TIMEOUT deadline counts
- [Phase 02]: 02-21: CI attempt-1 UIDVALIDITY flake in imap-folder-source.test.ts logged as bug-191, not fixed in this plan (passed on rerun)
- [Phase 03]: 03-01: rules.yaml category names are ASCII only (owner chose ascii: A-Z, a-z, 0-9, single spaces, - and &; 1-40 chars; no /); Unicode deferred until Phase 4 verifies Bridge modified-UTF-7 folder names
- [Phase 03]: 03-01: YAML position and Zod-issue helpers live in packages/core/src/yaml-issues.ts, shared by config.yaml and rules.yaml loaders; list-level issues sit at the first list item
- [Phase 03]: 03-01: rule labels match category names exactly (case-sensitive, untrimmed); rules: [] or no rules key is valid, rules: null is an error; match entries normalised in the schema for D-03 hashing
- [Phase 03]: 03-01: .gitignore uses /data/* with negations re-including only data/mailboxes/example/rules.example.yaml; SIFT_DATA (default ./data) locates data/mailboxes/<slug>/rules.yaml via rulesPathFor
- [Phase 03]: 03-02: tiers.llm.confidence_threshold is a strict 0..1 inclusive number, default 0.75 (absent, tiers: {} or llm: {}); text, booleans and out-of-range values are rejected at the YAML path
- [Phase 03]: 03-02: DEFAULT_INITIAL_BACKFILL_DAYS is 3 (D-20); README Technical settings keeps tiers.classifier and examples_per_prompt as column-0 comments inside the active tiers block
- [Phase 03]: 03-03: decision has D-27 trace columns + 10 NULL-safe CHECKs; decision_one_worker_per_message partial unique index; reruns append (decided_by rerun)
- [Phase 03]: 03-03: rule_set is append-only (0010 revoke, APPEND_ONLY_TABLE_NAMES, Scope.ruleSet AppendOnlyTableApi); prompt_version is unscoped, allowlisted, SELECT/INSERT only
- [Phase 03]: 03-03: test rows come from seed.ts helpers (SEED_SPANS_JSON, newRuleSetRow, newDecisionRow); Postgres reports the name-first violated CHECK
- [Phase 03]: 03-05: out_of_category needs a string category; missing/non-string category is schema_mismatch (Zod enum reports missing as invalid_value)
- [Phase 03]: 03-05: validateLlmOutput details carry issue paths/codes only; not_json detail is fixed (V8 JSON.parse quotes input)
- [Phase 03]: 03-05: reason cap counted in code points (Zod 4.6.5 = grammar); 201 code points fail, plan's UTF-16 premise was stale
- [Phase 03]: 03-05: MODEL_OPTIONS/REQUEST_FLAGS/RETRY_NOTE live in core prompt.ts; prompt_version 1 hash pinned 8bd77eef...7d97
- [Phase 03]: 03-04: decide() is the single decision assembler; LLM answer at confidence >= threshold labels, below is review low_confidence keeping llm.result and confidence
- [Phase 03]: 03-04: nearest miss reported even at 0 met (D-12 literal, TRC-02 probe flagged); a phrase normalising to empty never matches
- [Phase 03]: 03-04: rule-set hash = sha256 of canonicalJson({ format_version, rules }) over the validated rules; snapshot is a JSON copy of that text
- [Phase 03]: 03-06: recordDecision stores createdAt = at, so decision.created_at and the 7-day body expiry share one clock; latestDecision orders by it
- [Phase 03]: 03-06: recordDecision refuses before SQL on trace format version, llm span model/confidence vs typed columns, and exact rules with a prompt version, model or confidence
- [Phase 03]: 03-06: candidates() refuses non-UUID ids, invalid since/before and a limit outside 1..1000 with TypeError before SQL
- [Phase 03]: 03-07: input_too_long only for HTTP 400 with context text; a 5xx mentioning context stays infra server_error
- [Phase 03]: 03-07: input_too_long attempt span detail is fixed text, never Ollama error text (T-03-25)
- [Phase 03]: 03-07: preflight fails closed on any set remote_host/remote_model and matches an untagged name against :latest
- [Phase 03]: 03-07: client reports a missing response model as null; bad metric counters become null
- [Phase 03]: 03-11: sift config check checks rules files only after the password-env check passes, and reads every mailbox's file before exiting 1
- [Phase 03]: 03-11: setup gets the read-only /data mount too, because sift mailbox rename runs in the setup service and its D-07 guard must see the moved rules file; setup itself never reads rules files
- [Phase 03]: 03-11: the rename guard skips invalid new slugs so renameMailbox keeps reporting them
- [Phase 03]: 03-08: a deterministic per-message HTTP 500 stays infra: the pass stops LLM work, the message stays pending and is retried first next pass (head-of-line risk flagged for the owner)
- [Phase 03]: 03-08: classification takes the ingest lock per 5-message chunk; state.ruleSetId is cached only after its transaction commits
- [Phase 03]: 03-08: infraOwnerMessage never shows Ollama detail except a bare code; timeout seconds come from the client's own detail (10 s preflight, 120 s chat)
- [Phase 03]: 03-08: worker test harness models.url is http://ollama.invalid; fake-ollama records its answer per request for the E8 replay check
- [Phase 03]: 03-09: a busy or shutdown-aborted classify pass still records ok with the ingest time; pending mail is picked up next batch
- [Phase 03]: 03-09: ClassifyInfraError is handled before MailboxSyncError, so the IMAP startup grace never shows an Ollama error as connecting
- [Phase 03]: 03-09: rules_invalid resolves runBatch (no backoff) and stores the file and problems in last_error; the warn line carries the slug only
- [Phase 03]: 03-12: every sift classify decision is decided_by rerun, also for a pending message; latestDecision returns it
- [Phase 03]: 03-12: sift classify resolves the IMAP entry and password only when an expired body must be refetched; missing password refuses with the worker's password_missing text
- [Phase 03]: 03-12: a refetch needs the location under the current UIDVALIDITY and an equal re-derived identity key; gone or changed mail is one skip line by id, exit 0
- [Phase 03]: 03-12: an Ollama outage in sift classify prints the owner message and 'classified x of n; y left' and exits 1; mailbox_status is never written
- [Phase 03]: 03-10: pair call counts are compared under an honest fake; the compromised run asserts only the bound (allowed X labelled in 1 call, off-list X review out_of_category after the retry)
- [Phase 03]: 03-10: hermeticity guard is strict (real Ollama port nowhere in classify tests/helpers); classify-ollama-client.test.ts DNS case uses http://ollama.invalid without a port
- [Phase 03]: 03-13: live-baseline flip = injected variant labelled differently from its base's result; an injected review (off-list X) is not a flip and shows as review (<reason>)
- [Phase 03]: 03-13: llm-baseline.ts takes --url and --model only from the command line (no default); classify-hermetic.test.ts now scans it and its test
- [Phase 03]: 03-13: README quick start is 12 steps (rules file, ollama pull, then up -d and sift config check); Linux ollama Compose profile documented as a later milestone
- [Phase 03]: 03-14 CR-02: a body written for an already-decided message (restoreBody refetch, storeMessages re-insert) gets expires_at = write time + 7 d via decidedMessageIds; undecided bodies stay null until the first decision; DECISION_BODY_RETENTION_MS now lives in ingest.ts, re-exported from classify.ts
- [Phase 03]: CR-03: recordIngestSynced spends the resume approval and records last_sync_at inside the ingest lock when classification is on; needs_attention -> ok, other states and last_error left for the post-pass write (D-14)
- [Phase 03]: 03-21: LINE_BREAK covers CR, LF, U+2028, U+2029 ('must be one line'); every other Cc character in rules text gets 'must not contain control characters', one issue per one-line value (WR-02)
- [Phase 03]: 03-21: from/domain/phrase entries refine on CONTROL_CHARACTERS after their normalising steps; a phrase's inner tab is collapsed first and still loads
- [Phase 03]: 03-16 WR-01: a model reason with a Unicode control character (Cc) or U+2028/U+2029 after trim is schema_mismatch reason: control_character, checked in validateLlmOutput (not llmOutputSchema, prompt hash unchanged); recordDecision strips NUL from parsed spans as a backstop for Ollama-supplied strings
- [Phase 03]: 03-17: a chat server_error or timeout followed by a healthy preflight skips only that message for the pass (no decision, stays pending); at most OLLAMA_MESSAGE_FAILURES_PER_PASS = 2 per pass, the next one is an outage (CR-01, D-16 clarified, owner may object at 03-19)
- [Phase 03]: 03-17: a failed re-probe, a third such failure or any other infra code stays an outage exactly as D-16; sift classify prints a skipped message id with code and HTTP status on stderr
- [Phase 03]: WR-03 (03-18): a done pass that left messages unclassified writes state ok with last_error = unclassifiedNotice(ids) (ids and counts only); a clean pass clears it; sift mailbox list shows 'ok; <notice>'
- [Phase 03]: 03-18: per worker process, a message Ollama failed on alone in MESSAGE_FAILURE_PASSES (3) passes is held back (no preflight, chat or budget), only after a mail-free canary chat succeeds; a failed canary is a D-16 outage; restart or an exact rule ends the hold
- [Phase 03]: 03-19 owner decision (Samuel Kimama, 2026-10-11): option-review. A message Ollama fails on alone in MESSAGE_FAILURE_PASSES (3) passes, confirmed by a healthy re-probe and a mail-free canary chat, ends as a review decision with reason llm_error (tier llm, confidence null). Amends D-16 and D-31; llm_error added to REVIEW_REASONS, ATTEMPT_FAILURE_CODES and decision_review_reason_check (migration 0011). One-way. 03-20 runs.
- [Phase 03]: 03-19: the owner reviewed and accepted the 03-17 D-16 clarification (a 5xx or timeout confined to one message skips only that message); no revert of 03-17.
- [Phase 03]: 03-22: sift classify's skip line for a message Ollama failed on alone is 'message <id>: Ollama failed on this message (HTTP <status>); skipped', or the failure code (e.g. timeout) when there is no status; 03-17's line was reworded in place, not duplicated
- [Phase 03]: 03-20: llm_error is written only when decidedBy is worker; sift classify keeps skipping such a message even with a shared runtime
- [Phase 03]: 03-20: messageFailures is set before the llm_error draft and removed only after the decision commits, so a failed write counts again
- [Phase 03]: 03-20: the llm_error message stays in ollamaFailed (per-pass budget) but not in unclassified; MESSAGE_HELD_BACK_LOG replaced by MESSAGE_LLM_ERROR_LOG
- [Phase 03]: 03-23: live baseline prints ready + per-email progress on stderr via BaselineOptions.progress; stdout stays the table (G-03-2)

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2]: Proton Bridge CONDSTORE/QRESYNC support and Message-ID consistency across label folders are unverified; polling fallback must work without either
- [Phase 3]: Raw LLM prompt retention limit (ADR-0003 open item) to decide when the `decision` table shape is set
- [Later]: How shared rules and synthetic eval runs fit under non-null `mailbox_id` (INGEST-CONFLICTS INFO) is deferred to M4/M5 planning

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261007-2ke | Commit-driven versioning: local pnpm release (feat->minor, fix->patch, v0.1.0 start), CI tag check, sift --version | 2026-10-07 | 1e275d9 | [261007-2ke-add-commit-driven-versioning-local-pnpm-](./quick/261007-2ke-add-commit-driven-versioning-local-pnpm-/) |

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Scope | README milestones M2-M7 (Learn, Plain-English rules, Evals, Multiple mailboxes, Guardrails, Extras) | Backlog | 2026-10-02 | v0.1 |

## Session Continuity

Last session: 2026-10-12T19:33:28.202Z
Stopped at: Completed 03-23-PLAN.md
Resume file: None
