---
phase: 02-bridge-spike-and-imap-ingest
verified: 2026-10-06T21:37:46Z
status: human_needed
score: 181/183 must-haves verified (5/5 roadmap success criteria; 176/178 plan truths); 2 need an owner decision
covered_files:
  - .env.example
  - .env.mailboxes.example
  - .github/workflows/bridge-image.yml
  - .github/workflows/ci.yml
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-01-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-01-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-02-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-02-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-03-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-03-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-04-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-04-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-05-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-05-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-06-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-06-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-07-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-07-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-08-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-08-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-09-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-09-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-10-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-10-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-11-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-11-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-12-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-12-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-13-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-13-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-14-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-14-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-15-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-15-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-16-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-16-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-17-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-17-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-18-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-18-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-19-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-19-SUMMARY.md
  - CONTRIBUTING.md
  - README.md
  - apps/worker/package.json
  - apps/worker/src/cli.ts
  - apps/worker/src/command.ts
  - apps/worker/src/commands/bridge-probe.ts
  - apps/worker/src/commands/bridge-trust.ts
  - apps/worker/src/commands/mailbox-backfill.ts
  - apps/worker/src/commands/mailbox-list.ts
  - apps/worker/src/commands/mailbox-resume.ts
  - apps/worker/src/commands/worker.ts
  - apps/worker/src/imap/capture.ts
  - apps/worker/src/imap/connect.ts
  - apps/worker/src/imap/folder-source.ts
  - apps/worker/src/imap/pin.ts
  - apps/worker/src/ingest/db-store.ts
  - apps/worker/src/ingest/identity.ts
  - apps/worker/src/ingest/message.ts
  - apps/worker/src/ingest/plan.ts
  - apps/worker/src/ingest/run.ts
  - apps/worker/src/ingest/types.ts
  - apps/worker/src/runtime/mailbox-batch.ts
  - apps/worker/src/runtime/supervisor.ts
  - apps/worker/src/spike/probe.ts
  - apps/worker/test/bridge-image.test.ts
  - apps/worker/test/bridge-probe.test.ts
  - apps/worker/test/bridge-trust.test.ts
  - apps/worker/test/ci-workflow.test.ts
  - apps/worker/test/cli.test.ts
  - apps/worker/test/compose-smoke.test.ts
  - apps/worker/test/compose.test.ts
  - apps/worker/test/dependencies.test.ts
  - apps/worker/test/fixtures/mail/alternative.eml
  - apps/worker/test/fixtures/mail/attachment.eml
  - apps/worker/test/fixtures/mail/encoded-headers.eml
  - apps/worker/test/fixtures/mail/exact-64.eml
  - apps/worker/test/fixtures/mail/html-only.eml
  - apps/worker/test/fixtures/mail/no-message-id.eml
  - apps/worker/test/fixtures/mail/plain.eml
  - apps/worker/test/imap-capture.test.ts
  - apps/worker/test/imap-connect.test.ts
  - apps/worker/test/imap-folder-source.test.ts
  - apps/worker/test/imap-pin.test.ts
  - apps/worker/test/ingest-e2e.test.ts
  - apps/worker/test/ingest-engine.test.ts
  - apps/worker/test/ingest-identity.test.ts
  - apps/worker/test/ingest-message.test.ts
  - apps/worker/test/ingest-resync.test.ts
  - apps/worker/test/live-ingest-record.test.ts
  - apps/worker/test/mailbox-batch.test.ts
  - apps/worker/test/mailbox-ops.test.ts
  - apps/worker/test/no-secret-leak.test.ts
  - apps/worker/test/registry-cli.test.ts
  - apps/worker/test/setup.test.ts
  - apps/worker/test/spike-findings.test.ts
  - apps/worker/test/supervisor.test.ts
  - apps/worker/test/support/fake-folder-source.ts
  - apps/worker/test/support/fake-imap-server.ts
  - apps/worker/test/support/fake-ingest-store.ts
  - apps/worker/test/support/mailbox-harness.ts
  - apps/worker/test/support/privacy-scan.ts
  - apps/worker/test/support/test-imap.ts
  - apps/worker/test/user-facing-text.test.ts
  - apps/worker/test/worker.test.ts
  - bridge/Dockerfile
  - bridge/entrypoint.sh
  - bridge/helper/envfile.go
  - bridge/helper/envfile_test.go
  - bridge/helper/main.go
  - bridge/helper/main_test.go
  - compose.yaml
  - config/config.example.yaml
  - docs/adr/0003-traces-and-mail-app-relabels.md
  - packages/core/src/config/index.ts
  - packages/core/src/config/schema.ts
  - packages/core/src/log.ts
  - packages/core/test/config.test.ts
  - packages/core/test/example-config.test.ts
  - packages/core/test/log.test.ts
  - packages/db/migrations/0005_ingest_preflight.sql
  - packages/db/migrations/0006_ingest_tables.sql
  - packages/db/migrations/0007_ingest_tables_force_grants.sql
  - packages/db/migrations/meta/0005_snapshot.json
  - packages/db/migrations/meta/0006_snapshot.json
  - packages/db/migrations/meta/0007_snapshot.json
  - packages/db/migrations/meta/_journal.json
  - packages/db/src/index.ts
  - packages/db/src/ingest.ts
  - packages/db/src/lock.ts
  - packages/db/src/owner/migrate.ts
  - packages/db/src/owner/registry.ts
  - packages/db/src/schema/index.ts
  - packages/db/src/schema/scoped.ts
  - packages/db/src/scope.ts
  - packages/db/src/status.ts
  - packages/db/test/ingest.test.ts
  - packages/db/test/isolation.test.ts
  - packages/db/test/lock.test.ts
  - packages/db/test/migrate.test.ts
  - packages/db/test/owner-rls.test.ts
  - packages/db/test/registry-plan.test.ts
  - packages/db/test/registry.test.ts
  - packages/db/test/scope.test.ts
  - packages/db/test/status.test.ts
  - packages/db/test/support/seed.ts
  - renovate.json
  - scripts/bridge-smoke.sh
  - scripts/compose-smoke.sh
  - scripts/test-imap.sh
covered_digest: "v2:sha256:21cc9dc6dcc90b5e3c75973dc45dd79421174a693030b2667e54bc93a092b4be"
behavior_unverified: 0
overrides_applied: 2
behavior_unverified_items: []
overrides:
  - must_have: "The findings state whether UIDVALIDITY and INTERNALDATE stayed the same across a Bridge restart and across a forced repair"
    reason: "Owner approved no-repair; restarts measured; a repair is treated as a UIDVALIDITY reset (D-22), whose resync path is proven live (simulated) and on Dovecot (real bump)"
    accepted_by: "Samuel Kimama"
    accepted_at: "2026-10-07T04:01:40Z"
  - must_have: "The ingest lock is held from the count through the ingest, so the worker cannot ingest the counted set in between"
    reason: "WR-02: two lock sessions avoid ImapFlow's 120 s idle drop and an unbounded worker block; runBackfill refuses a changed UIDVALIDITY and counted mail stored meanwhile merges by identity (D-03, D-14 preserved)"
    accepted_by: "Samuel Kimama"
    accepted_at: "2026-10-07T04:23:15Z"
human_verification:
  - test: "Owner decision (SPK-04 / 02-14 must-have 5): Bridge repair behaviour is unmeasured. Either accept the gap with the suggested override (owner approved `no-repair`; the design treats a repair as a UIDVALIDITY reset, and the resync path is proven on the real mailbox by the simulated mismatch and on Dovecot by a real server-side UIDVALIDITY change), or approve one `docker compose run --rm bridge-init repair` and record UIDVALIDITY and INTERNALDATE before and after in 02-SPIKE-FINDINGS.md."
    expected: "Either an `overrides:` entry for the 02-14 repair truth is added to this file, or the findings state, from observation, whether a repair changes UIDVALIDITY."
    why_human: "Running a Bridge repair touches the owner's real Bridge cache and needs owner approval; accepting the unmeasured item is an owner judgement. No later roadmap phase covers it."
  - test: "Owner decision (02-16 must-have 5 / WR-02): `sift mailbox backfill` now takes the ingest lock twice (count, then ingest) instead of holding it from the count through the ingest. Accept the suggested override or reject the WR-02 fix."
    expected: "An `overrides:` entry for the 02-16 lock truth is added (recommended), because D-03 (worker and CLI never ingest at once), 'exactly the counted UIDs' and 'merge by identity, never duplicate' all still hold in code and tests."
    why_human: "The plan's must-have is false as written; whether the intent-preserving replacement is acceptable is an owner decision, not a code gap."
  - test: "Redeploy the worker with the review fixes: `docker compose up -d --build worker` (scoped to the worker so Bridge is not recreated), then `docker compose run --rm -T setup sift mailbox list` and the counts-only duplicate query from 02-LIVE-INGEST.md."
    expected: "personal shows ok; 0 identity keys with more than one message row; 0 (uidvalidity, UID) pairs with more than one live location; message count does not jump."
    why_human: "The running worker image (sift:local, 2026-10-06T14:43:11Z) predates every review fix (9d1daa6..c7a580c). The owner's INBOX now has 72,018 live locations, above the 65,535 bind-parameter limit of CR-01, so a UIDVALIDITY change on the running image would leave INBOX `resyncing` forever. The verifier was told not to recreate the owner's containers."
  - test: "Review the WR-03 clock-cap logic in apps/worker/src/ingest/run.ts (clockCap; cap is 'now', not 'now + 10 min')."
    expected: "Owner agrees that a future-dated INTERNALDATE capped at the worker clock keeps later mail eligible, and that capping at 'now' (rather than the review's now + 10 min) is the right trade-off with the 5-minute overlap."
    why_human: "The fixer flagged it as a logic change needing human verification; tests prove the behaviour, not that the trade-off is the intended one."
  - test: "Review the WR-04 trust rule: `trustsPmHeader(entry) = entry.imap.tls.pin_sha256 !== undefined`, and `pm:` only when exactly one X-Pm-Internal-Id is present."
    expected: "Owner accepts that 'pinned' stands for 'Proton Bridge' (a pinned non-Bridge server would still be trusted) or decides on an explicit config key (a D-74 one-way decision)."
    why_human: "Trust-rule design choice; the fixer flagged it. The owner's mailbox is pinned, and all 72,271 stored keys are `pm:`, so no stored key changes."
  - test: "Confirm the judgment-tier prohibitions: 02-11 (probe changed nothing beyond the one confirmed label copy), 02-14 (owner mailbox changed only by the approved label test; the empty `Sift Spike` label remains), 02-19 (ingest-only run, no repair; the only hand-edited row was folder_sync.uidvalidity, with the worker stopped and a dump taken first)."
    expected: "Owner confirms that the records in 02-SPIKE-FINDINGS.md and 02-LIVE-INGEST.md match what happened."
    why_human: "Judgment-tier prohibitions need human resolution. Non-authoritative verifier verdict: compliant, based on the records (dump `backups/sift-20261006T192158Z-pre-live-resync.dump`, worker stopped 19:21:39-45Z, `UPDATE 1`, Bridge start time unchanged)."
---

# Phase 2: Bridge Spike and IMAP Ingest Verification Report

**Phase Goal:** Proton Bridge's behaviour is known rather than assumed, and one real mailbox's mail is reliably in the database.
**Verified:** 2026-10-06T21:37:46Z
**Status:** human_needed
**Re-verification:** No (initial verification)

## Goal Achievement

The goal is met in the codebase and, at the time of verification, in the owner's running database. Every roadmap success criterion has direct evidence. Some comes from the live records. The rest comes from tests I ran myself and from read-only, counts-only queries against the owner's database.

Six items need the owner:

- two must-haves that are false as written but deliberately so;
- the running worker image, which predates the review fixes;
- two fixes the fixer flagged for human review;
- the judgment-tier prohibitions.

### Observable Truths (roadmap success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A findings document, based on a real Proton mailbox, states how labels appear as folders and how one is applied and removed, whether CONDSTORE and QRESYNC work, how consistent `Message-ID` is across label folders, and how UIDVALIDITY behaves across Bridge restarts | ✓ VERIFIED | 02-SPIKE-FINDINGS.md covers: Labels/ layout, `/` delimiter, CREATE, `UID COPY` + COPYUID, refusal of COPY from EXAMINE, `\Deleted` + `UID EXPUNGE`, INBOX copy kept (SPK-01); capability lists, ENABLE/STATUS HIGHESTMODSEQ answered `BAD` (SPK-02); X-Pm-Internal-Id 2000/2000, byte-equal Message-ID across folders, 0 missing, 1.6% duplicates (SPK-03); UIDVALIDITY and INTERNALDATE unchanged across two restarts, 1998/1998 fixed-snapshot match (SPK-04). `spike-findings.test.ts` passes (sections, decision lines, privacy scan with the configured-username denylist). |
| 2 | The findings document says which sync capability later relabel learning must assume and what label application must do accordingly | ✓ VERIFIED | `**Sync capability to assume:** polling only`; the "Phase 4 label application" paragraph covers the SELECTed source, `UID COPY`, COPYUID echo record, `UID STORE \Deleted` + `UID EXPUNGE`, "never a plain EXPUNGE", pausing during resync, and M2 relabel detection by UID-set diff keyed by `pm:`. ADR-0003 has the addendum (line 100). |
| 3 | Owner starts the worker and the configured mailbox's messages appear in the database exactly once each, scoped to that mailbox; restarting the worker adds no duplicates | ✓ VERIFIED | Live: R1 163/163 across the restart, R2 0, 0 duplicates, 0 rows outside the mailbox (02-LIVE-INGEST.md). Test: `ingest-e2e.test.ts` "stores new mail exactly once, scoped to its mailbox, across polls and a restart" passes (real Postgres + Dovecot). Current state (my read-only counts query, 21:32Z): 72,018 messages = 72,018 live locations, 0 duplicate identity keys, 0 duplicate (uidvalidity, UID), 0 messages with more than one live location, 1 mailbox holding rows. The worker has been restarted or recreated three times since the first sync. |
| 4 | A new email sent to the mailbox shows up in the database within one polling interval without restarting anything | ✓ VERIFIED | Live: T_db - T_bridge = 34 s (limit 60 s + 20 s), eligible row with a body, UID 51105 > S3 last_uid, nothing restarted. Code: the supervisor polls every `worker.poll_interval_seconds` (worker.ts:147); `pollNewMail` fetches `lastUid+1:*` every cycle. Test: e2e run 2 stores appended mail on the next run. |
| 5 | After a forced UIDVALIDITY change, Sift resyncs the folder without duplicating or re-classifying stored messages | ✓ VERIFIED | Live (simulated mismatch, D-86): generation 1 → 2, state ok, one `resynced:` line, C1 0, C2 40,940 = new + older, C3 58 = eligible before, 0 duplicates. Test: `ingest-e2e.test.ts` "resyncs after a forced UIDVALIDITY change without new message rows" uses a real server-side UIDVALIDITY bump on Dovecot (`bumpUidValidity`) and passes. Code: `storeMessages` never lowers eligibility (insertOrIgnore; promotion only with `promoteEligible`, which resync never passes). The CR-01 fix that keeps this working above 65,535 locations passes its 70,000-location real-DB test. Caveat: the live run used the pre-fix image (see Human Verification 3). |

**Roadmap score:** 5/5

### Plan must-haves (178 truths across 19 plans)

I checked the plan truths through the targeted test runs below (819 tests in 36 files, all passing), through code reads of the wiring (mailbox-batch.ts, run.ts, ingest.ts, scope.ts, mailbox-backfill.ts, the migrations) and through static greps (Dockerfile pin and commit guard, compose bindings, renovate, CI step, env-file chmod).

Two truths are not true as written:

| Plan | Truth | Status | Evidence |
|------|-------|--------|----------|
| 02-14 | "The findings state whether UIDVALIDITY and INTERNALDATE stayed the same across a Bridge restart **and across a forced repair**" | ? UNCERTAIN (owner decision) | Restarts were measured. The repair was not, by owner choice (`no-repair`); the findings say "not measured" and route a repair to the D-22 rescan. REQUIREMENTS SPK-04 ("across Bridge restarts and resyncs") is therefore only partly met, although REQUIREMENTS.md marks it Complete. No later phase picks it up. |
| 02-16 | "The ingest lock is held from the count through the ingest, so the worker cannot ingest the counted set in between; a declined confirmation stores nothing and releases the lock" | ? UNCERTAIN (owner decision) | Changed on purpose by WR-02 (9bc7e5f): mailbox-backfill.ts:228-243 runs `underLock(countBackfill)`, releases the lock and IMAP while the owner reads the prompt, then runs `underLock(runBackfill)`. `runBackfill` refuses a changed UIDVALIDITY (`plan.uidValidity !== state.uidValidity`). Counted UIDs that the worker stores in between merge by identity and get promoted. A declined prompt stores nothing and holds no lock. `mailbox-ops.test.ts` passes, including the new "lock free during confirm" case. The intent of D-03 holds. I judge this an acceptable deviation, and an improvement, since the old form held a pooled connection and the worker lock with no bound. |

**This looks intentional.** To accept these deviations, add to the frontmatter:

```yaml
overrides:
  - must_have: "The findings state whether UIDVALIDITY and INTERNALDATE stayed the same across a Bridge restart and across a forced repair"
    reason: "Owner approved no-repair; restarts measured; a repair is treated as a UIDVALIDITY reset (D-22), whose resync path is proven live (simulated) and on Dovecot (real bump)"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
  - must_have: "The ingest lock is held from the count through the ingest, so the worker cannot ingest the counted set in between"
    reason: "WR-02: two lock sessions avoid ImapFlow's 120 s idle drop and an unbounded worker block; runBackfill refuses a changed UIDVALIDITY and counted mail stored meanwhile merges by identity (D-03, D-14 preserved)"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
```

**Score:** 181/183 must-haves verified (0 present, behavior-unverified); 2 need an owner decision.

### Required Artifacts (key ones)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.planning/phases/02-.../02-SPIKE-FINDINGS.md` | Findings from the real mailbox | ✓ VERIFIED | 8 sections, scope line, decision lines; doc-contract test passes |
| `.planning/phases/02-.../02-LIVE-INGEST.md` | Counts-only live record | ✓ VERIFIED | Criteria 3, 4 and 5 pass; result `partial` (D-86); doc-contract test passes |
| `docs/adr/0003-traces-and-mail-app-relabels.md` | Addendum | ✓ VERIFIED | `## Addendum (2026-10): Proton Bridge spike (M1)` links the findings |
| `apps/worker/src/runtime/mailbox-batch.ts` | lock → active → pinned connect → runIngest → status | ✓ VERIFIED | 434 lines; wired from worker.ts:144 |
| `apps/worker/src/ingest/run.ts` | Engine: first sync, poll, valve, removals, backfill, resync | ✓ VERIFIED | 698 lines; no imapflow or @sift/db import |
| `apps/worker/src/ingest/db-store.ts` | IngestStore over @sift/db | ✓ VERIFIED | Used by mailbox-batch and mailbox-backfill |
| `apps/worker/src/imap/{capture,connect,folder-source,pin}.ts` | Pinned STARTTLS, read-only adapter | ✓ VERIFIED | imap-capture, imap-connect, imap-folder-source and imap-pin tests pass |
| `packages/db/src/{ingest,scope,lock,status}.ts` | Use-cases, `= any($1)` array match, advisory lock, states | ✓ VERIFIED | ingest, scope, lock and status tests pass (including the 70k resync) |
| `packages/db/migrations/0005-0007` | Preflight, tables, constraints, FORCE RLS | ✓ VERIFIED | UNIQUE (mailbox_id, identity_key), identity-key CHECK, location UNIQUE, pending/backfill CHECKs, FORCE RLS on message_location and message_body |
| `bridge/Dockerfile`, `bridge/entrypoint.sh`, `bridge/helper/*` | Pinned build, fail-closed keychain, init helper | ✓ VERIFIED | Pin and HEAD guard (Dockerfile:13-25); the running bridge container serves through the pin; envfile Go tests pass (run in isolation); `scripts/bridge-smoke.sh` passes (exit 0) |
| `compose.yaml` | bridge on loopback, external volume, bridge-init profile | ✓ VERIFIED | `127.0.0.1:${SIFT_BRIDGE_PORT:-1143}:1143`, `profiles: ["tools"]`, `external: true`; compose.test passes |
| `renovate.json`, `.github/workflows/bridge-image.yml` | Bridge pin bumps, image CI | ✓ VERIFIED (static) | ci-workflow and bridge-image tests pass. Never run on GitHub: main is 131 commits ahead of origin, and the workflow is not on the default branch |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| worker.ts | mailbox-batch.ts | `createSupervisor({...createMailboxCallbacks(db, secrets, {config, env, log})})` | WIRED |
| mailbox-batch.ts | lock.ts | `withIngestLock(db, mailbox.id, ...)` | WIRED |
| mailbox-batch.ts | connect.ts | `open({... tls: { mode, pinSha256: entry.imap.tls.pin_sha256 }})` | WIRED |
| mailbox-batch.ts | run.ts | `runIngest({ source: trackedSource(createFolderSource(client)), store: createDbStore(session), ... })` | WIRED |
| run.ts | message.ts / identity | `parseMessage(rec, { trustPmHeader })` | WIRED |
| db-store.ts | packages/db ingest.ts | `storeMessages`, `finishResync`, ... | WIRED |
| scope.ts | Postgres | `column = any($1)`, one array parameter (CR-01) | WIRED |
| mailbox-backfill.ts | run.ts / lock.ts | `underLock(countBackfill)` then `underLock(runBackfill)` | WIRED (two sessions; see 02-16 truth) |
| connect.ts | capture.ts / pin.ts | `capturePeerCertificate`, `peerSpkiSha256` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| message / message_location / message_body | Owner's INBOX | Bridge IMAP → FolderSource → runIngest → storeMessages | 72,018 messages, 63 eligible with bodies, all `pm:` keys, folder_sync generation 2, state ok, watermark 21:06:22Z | ✓ FLOWING |
| mailbox_status | Owner-visible state | recordSyncSuccess / recordNeedsAttention | `personal`: ok, last_sync_at 21:32:45Z, no error | ✓ FLOWING |

### Behavioral Spot-Checks (single named files, not the full suite)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SC3/SC4/SC5 on Dovecot + Postgres, resync engine, identity, doc contracts | `vitest run ingest-e2e ingest-resync ingest-engine spike-findings live-ingest-record ingest-identity` | 6 files, 121/121 | ✓ PASS |
| DB ingest (incl. 70k-location finishResync), scope `= any`, lock, CLI backfill (WR-02), mailbox batch | `vitest run packages/db/test/{ingest,scope,lock} mailbox-ops mailbox-batch` | 5 files, 133/133 | ✓ PASS |
| TLS capture/pin/connect, folder source read-only, bridge image static, probe privacy, no secret leak, bridge trust, docs pins, compose | `vitest run imap-capture imap-connect imap-folder-source bridge-image bridge-probe no-secret-leak bridge-trust user-facing-text compose` | 9 files, 276/276 | ✓ PASS |
| Config schema, supervisor nudge/abort, message parsing, status, migrate | `vitest run packages/core supervisor ingest-message status migrate` | 8 files, 221/221 | ✓ PASS |
| Dependencies/licences, CI, CLI, registry, isolation, pin, worker | `vitest run dependencies ci-workflow cli registry isolation imap-pin worker` | 7 files, 68/68 | ✓ PASS |
| env-file in-place write, verified backup, chmod 0600 (CR-02) | `go test` on envfile.go + envfile_test.go in a scratch module | ok | ✓ PASS |
| Type safety / lint | `pnpm typecheck`; `pnpm lint` | exit 0; 1 existing warning | ✓ PASS |
| Owner env files are 0600 | `stat -f %Lp .env.mailboxes .env.mailboxes.bak` (mode only) | 600 / 600 | ✓ PASS |
| Bridge image end to end (fail-closed exit 78, socat supervision, configure telemetry read-back, repair over gRPC) | `SIFT_BRIDGE_IMAGE=sift-bridge:verify-02 bash scripts/bridge-smoke.sh` (separate tag, port 11143, throwaway volumes) | exit 0: STARTTLS on 11143, logged fingerprint = openssl, healthcheck passes, socat death stops the container (exit 1), configure turns telemetry and updates off and prints the pin (exit 3), env-file and no-TTY refusals (exit 2), repair over gRPC (exit 0), wrong passphrase and uninitialised volume exit 78 | ✓ PASS |

I did not run the full `pnpm test` suite. The orchestrator reports 14 timeouts under Docker host load, and every affected file passes alone. My runs above cover those files (ingest-e2e, imap-*, bridge-probe and others) and found no failures. I treat this as a reliability warning, not a functional failure.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exists. `sift bridge probe` is a CLI against the owner's mailbox; I did not run it, as instructed. Its behaviour is covered by `bridge-probe.test.ts` against Dovecot, which passes.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SPK-01 | 02-11, 02-14 | Labels as folders, apply/remove, multiple folders at once | ✓ SATISFIED | Findings "Labels as folders"; INBOX and label copies coexist, with byte-equal headers |
| SPK-02 | 02-11, 02-14 | CONDSTORE/QRESYNC advertised and observed | ✓ SATISFIED | Not advertised; ENABLE and STATUS HIGHESTMODSEQ answered `BAD` |
| SPK-03 | 02-11, 02-14 | Message-ID consistency, missing/duplicate rate, hash fallback viability | ✓ SATISFIED | 0 missing, 1.6% duplicates, byte-equal across folders; `hdr:v1` kept, never needed on Bridge |
| SPK-04 | 02-11, 02-14, 02-17 | UIDVALIDITY across restarts **and resyncs**; capability decision | ? NEEDS HUMAN (partial) | Restarts and the decision are covered; the repair (resync) is unmeasured by owner choice. Override or measurement needed |
| ING-01 | 02-01, 02-02, 02-04, 02-08, 02-09, 02-12, 02-13, 02-15, 02-17, 02-18, 02-19 | Worker connects through Bridge with the env password and reads the configured folder | ✓ SATISFIED | mailbox-batch wiring; live run; e2e tests |
| ING-02 | 02-02, 02-03, 02-06, 02-07, 02-10, 02-12, 02-13, 02-16, 02-19 | Stored once with mailbox_id, UID, UIDVALIDITY, identity, headers, body; re-runs never duplicate | ✓ SATISFIED | Schema UNIQUEs; storeMessages idempotency tests; live 0 duplicates. UID and UIDVALIDITY live on message_location (D-15), the design's normalisation of "stored in message" |
| ING-03 | 02-02, 02-05, 02-09, 02-10, 02-13, 02-16, 02-19 | New mail picked up on a polling interval without restart | ✓ SATISFIED | Live 34 s; supervisor poll; e2e |
| ING-04 | 02-03, 02-06, 02-10, 02-13, 02-19 | folder_sync records UIDVALIDITY and last position; a change triggers a safe resync | ✓ SATISFIED | folder_sync columns and CHECKs; resync tests; live generation 2 |

No orphaned requirements: REQUIREMENTS.md maps exactly these eight IDs to Phase 2, and every one is claimed by a plan. REQUIREMENTS.md marks SPK-04 `[x] Complete`. That overstates it until the owner accepts the override.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (phase files, 109 impl/test files) | - | TBD/FIXME/XXX/TODO/HACK | none found | - |
| Running deployment (`sift-worker-1`, image 14:43:11Z) | - | Review fixes not deployed; INBOX at 72,018 live locations > 65,535 | ⚠️ Warning | CR-01 is reachable on the running image if UIDVALIDITY changes (for example, a Bridge repair). Fixed in code; redeploy needed |
| `.env.example` | 28 | "If you lose it, run `docker compose run --rm bridge-init`" | ⚠️ Warning | Wrong recovery advice on an existing volume (exit 78). Logged in deferred-items.md from 02-17 and still unfixed. The README states the correct recovery |
| Full `pnpm test` | - | 14 timeouts + 21 skips under host load | ⚠️ Warning | Reliability only; every affected file passes alone (bug-151/162 class) |
| 02-REVIEW IN-01..IN-04 | - | Duplicated cause helper; NaN on missing UIDNEXT; hold pauses the first backfill; valve counts CLI-backfilled mail | ℹ️ Info | Open by disposition; none blocks the goal |
| `.github/workflows/*` | - | Never executed on GitHub (main 131 commits ahead of origin) | ℹ️ Info | CI claims are static-test only until pushed |

### Prohibitions

- **Test-tier** (02-01, 02-06, 02-07, 02-08, 02-09, 02-10, 02-11, 02-14, 02-18, 02-19): enforcement is wired, and the enforcing tests passed in my runs. These include identity-key pairing and the no-duplicate-conflict-key rule (ingest.test), Message-ID never keying a Bridge mailbox (ingest-identity), flags unchanged (ingest-e2e, imap-folder-source), the valve before any resync write and old mail never eligible (ingest-resync, ingest-engine), no data over an unverified connection and no cert to disk (imap-capture, imap-connect), and privacy (spike-findings, live-ingest-record, bridge-probe, no-secret-leak). The Bridge-container prohibitions (02-01 unencrypted vault and no env or config mount in the bridge service, 02-08 telemetry and password exposure) are enforced by `scripts/bridge-smoke.sh` (exit 78 refusals, telemetry and updates read back off, sentinel password never printed) and by compose.test; both passed in this verification.
- **Judgment-tier** (02-11 #2, 02-14 #2, 02-19 #2 and #3): flagged as `unverified-prohibition — human review recommended`. Non-authoritative verdict: compliant, per the records. See Human Verification 6.

### Human Verification Required

1. **SPK-04 repair: accept or measure.** Add the override above, or approve one `bridge-init repair` and record UIDVALIDITY and INTERNALDATE before and after. Expected: an override entry, or a measured statement in the findings. Why human: it touches the owner's Bridge, and accepting it is an owner judgement.
2. **02-16 lock-span deviation (WR-02).** Accept the override above (recommended). Why human: the must-have is false as written, and the replacement keeps its intent.
3. **Redeploy the worker with the review fixes.** Run `docker compose up -d --build worker` (scoped), then `sift mailbox list` and the duplicate counts. Expected: ok, 0 duplicates. Why human: the running image predates 9d1daa6..c7a580c, INBOX is past the CR-01 limit, and the verifier must not recreate the owner's containers.
4. **WR-03 clock-cap trade-off.** Confirm that capping at "now" is intended. Why human: the fixer flagged it.
5. **WR-04 trust rule.** Accept "pinned means Bridge" or decide on an explicit config key. Why human: a trust-rule design choice under D-74.
6. **Judgment-tier prohibitions** (02-11, 02-14, 02-19). Confirm that the records match what happened.

### Gaps Summary

No code gaps block the goal. Bridge's behaviour is documented from the owner's real mailbox, and the decision for later phases is recorded. The owner's INBOX is in the database: 72,018 rows, each stored once, scoped to one mailbox, all keyed `pm:`. A restart, new mail and a forced resync all behave as the roadmap requires, both live and in the tests I ran.

The phase is not `passed` for three reasons:

1. Two plan must-haves are false as written but deliberate: the unmeasured Bridge repair, and the WR-02 lock split. Each needs an owner override.
2. The owner's running worker lacks the review fixes, and CR-01 is now reachable because INBOX has passed 65,535 locations.
3. Two review fixes, WR-03 and WR-04, were flagged for human review.

The full-suite timeouts are a reliability warning, not a functional failure. Every file involved passed in isolation in this verification.

---

_Verified: 2026-10-06T21:37:46Z_
_Verifier: Claude (gsd-verifier)_
