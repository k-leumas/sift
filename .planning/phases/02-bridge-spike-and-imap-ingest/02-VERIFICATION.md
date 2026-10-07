---
phase: 02-bridge-spike-and-imap-ingest
verified: 2026-10-07T06:48:15Z
status: human_needed
score: 194/195 must-haves verified (5/5 roadmap success criteria; 189/190 plan truths, 2 by accepted override); 1 needs an owner decision
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
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-20-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-20-SUMMARY.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-21-PLAN.md
  - .planning/phases/02-bridge-spike-and-imap-ingest/02-21-SUMMARY.md
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
covered_digest: "v2:sha256:2a30ec6227bfdbfec7455528c62927765825c6697e4fbca9ae5ed3770039d8ac"
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "The findings state whether UIDVALIDITY and INTERNALDATE stayed the same across a Bridge restart and across a forced repair"
    reason: "Owner approved no-repair; restarts measured; a repair is treated as a UIDVALIDITY reset (D-22), whose resync path is proven live (simulated) and on Dovecot (real bump)"
    accepted_by: "Samuel Kimama"
    accepted_at: "2026-10-07T04:01:40Z"
  - must_have: "The ingest lock is held from the count through the ingest, so the worker cannot ingest the counted set in between"
    reason: "WR-02: two lock sessions avoid ImapFlow's 120 s idle drop and an unbounded worker block; runBackfill refuses a changed UIDVALIDITY and counted mail stored meanwhile merges by identity (D-03, D-14 preserved)"
    accepted_by: "Samuel Kimama"
    accepted_at: "2026-10-07T04:23:15Z"
re_verification:
  previous_status: human_needed
  previous_score: 181/183
  gaps_closed:
    - "G-02-4: 02-SPIKE-FINDINGS.md records post-spike initial_backfill_days 3 with dated history; owner config/config.yaml has 3; 3-day backfill corroborated in the database"
    - "G-02-8: README Requirements asks for an NTP-synced host clock, with reason and macOS/Linux checks, pinned by test"
    - "G-02-9: README states Sift supports only Proton Mail, through Proton Bridge, for now (intro and Requirements); other-server wording removed, pinned by test"
    - "G-02-14: compose-smoke asserts connecting/error status per enabled mailbox; ci run 37581267978 (headSha 8ec4ae8) green in check and compose-smoke"
    - "Previous human items 1-6 resolved through 02-UAT.md tests 2, 5, 7, 8, 9, 10 (overrides recorded for SPK-04 repair and the WR-02 lock split; worker redeployed with review fixes)"
  gaps_remaining: []
  regressions:
    - "02-17 must-have 3 is now false as written: 02-20 removed the README clauses 'servers with a public-CA certificate may omit the pin' and '`imap.tls.mode` is starttls or implicit', per the owner's Proton-only decision (G-02-9). Needs an owner override, not a code fix."
coincidental_reliance_items:
  - truth: "02-21: compose-smoke waits until every enabled mailbox has a connecting or error status row, which proves the worker loop started and reports status"
    reason: undeclared-precondition
    harden: "The proof holds only on a fresh smoke database (CI runner, or --down). On a reused smoke volume (the documented local rerun without --down) the previous run's error rows satisfy the wait before the new worker runs a batch (02-REVIEW WR-02). Bound the query by last_seen_at >= the worker container's StartedAt."
human_verification:
  - test: "Owner decision: accept an override for 02-17 must-have 3. Its README clauses 'servers with a public-CA certificate may omit the pin' and '`imap.tls.mode` is starttls or implicit' were removed by 02-20 under your Proton-only decision (G-02-9). The rest of that truth still holds (init prints the fingerprint, paste it at imap.tls.pin_sha256, a regenerated certificate stops the mailbox until `sift bridge trust <slug>`, Sift never connects without TLS)."
    expected: "An overrides entry for the 02-17 pin/TLS-mode truth is added to this file (suggested text in the report body), or you ask for the clauses back (which would contradict G-02-9)."
    why_human: "A later plan deliberately superseded an earlier plan's must-have on the owner's decision; only the owner can accept the deviation."
  - test: "README read-through (02-UAT test 11, skipped by you; 02-17 D7). Read the README quick start as a first-time owner, now that 02-20 changed the intro, Requirements, Technical settings, Security model and Managing mailboxes text."
    expected: "The steps from clone to a Bridge-connected, ingesting worker are clear and complete, including the interactive Bridge login, the pin paste and the new NTP clock requirement."
    why_human: "Readability and completeness for a new owner are judgment calls; the doc tests pin strings and order, not comprehension. You deferred it to after the G-02-8/G-02-9 edits, which are now done."
---

# Phase 2: Bridge Spike and IMAP Ingest Verification Report

**Phase Goal:** Proton Bridge's behaviour is known rather than assumed, and one real mailbox's mail is reliably in the database.
**Verified:** 2026-10-07T06:48:15Z
**Status:** human_needed
**Re-verification:** Yes. This run follows the UAT gap closure by plans 02-20 (G-02-4, G-02-8, G-02-9) and 02-21 (G-02-14).

## Goal Achievement

The goal is met. All four UAT gaps are closed in the code, the docs and, where the gap needed it, in the owner's running stack and on GitHub. I checked each one directly; I did not rely on the SUMMARY claims.

Two items need the owner, and neither is a code gap:

1. 02-20 removed two README clauses that an earlier plan (02-17) required. That was a deliberate change on the owner's Proton-only decision, so it needs an override.
2. The owner skipped the README read-through in UAT and planned to do it after these README edits.

Since the previous verification, the only code or doc commits are 925ce49 (Dependabot pnpm/action-setup bump, CI green), a4565c4 (README) and 36b51e0 (compose-smoke.sh). Nothing under `apps/worker/src` or `packages/` changed: `git diff c899978 HEAD -- apps/worker/src packages config/config.example.yaml packages/core/src/config/schema.ts CONTRIBUTING.md` is empty. The commits after the CI-verified 8ec4ae8 touch only `.planning/` and `.wolf/`.

### Observable Truths (roadmap success criteria; regression check)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Findings document from a real mailbox: labels as folders, apply/remove, CONDSTORE/QRESYNC, Message-ID consistency, UIDVALIDITY across restarts | ✓ VERIFIED | Unchanged except the G-02-4 value line. spike-findings.test.ts passes (with the new "exactly one value line" case). The SPK-04 repair gap is covered by the accepted override |
| 2 | Findings say which sync capability to assume and what label application must do | ✓ VERIFIED | Unchanged; doc-contract test passes |
| 3 | Mail appears exactly once, scoped to the mailbox; restart adds no duplicates | ✓ VERIFIED | My read-only counts query, 06:46Z: 103,505 messages, 103,504 live locations, 0 duplicate identity keys, 0 duplicate live (mailbox, folder, uidvalidity, uid), 0 messages with more than one live location, rows in 1 mailbox. The one message without a live location is a D-07 removal (also the one eligible message without a body). The worker was restarted and redeployed several times since the first sync (UAT 1, 2; 02-20 owner restart) |
| 4 | New mail shows up within one polling interval without a restart | ✓ VERIFIED | `personal` ok, last_sync_at 06:45:57Z (11 s before my query); 6 rows created during 05:20-06:00Z from polls. No code change since the live measurement in 02-LIVE-INGEST.md |
| 5 | A forced UIDVALIDITY change resyncs without duplicating or re-classifying | ✓ VERIFIED | INBOX folder_sync: generation 2, state ok. No engine change. CI attempt 1 hit an intermittent failure in the Dovecot UIDVALIDITY adapter test (bug-191); the test fixture, not the product, is the suspected cause, and attempt 2 passed (see Anti-Patterns) |

**Roadmap score:** 5/5

### Gap-closure truths (02-20, 02-21)

| Plan | Truth | Status | Evidence |
|------|-------|--------|----------|
| 02-20 #1 | README states `Sift supports only Proton Mail, through Proton Bridge, for now` before `## Why` and in Requirements, with the owner's reasons | ✓ VERIFIED | README:11 (bold "Proton Mail only, for now." paragraph: simpler logic, small test surface, security-minded) and README:393; `grep -c` = 2; test "states the Proton-only scope in the intro and in Requirements" passes |
| 02-20 #2 | No README line implies other mail servers; non-Bridge code paths untouched | ✓ VERIFIED | All plan greps are 0: `any IMAP client`, `other IMAP servers`, `non-Proton`, `fastmail`, `implicit`, `public certificate authority`, `For a Bridge mailbox`, `for Proton,`, `An IMAP account per mailbox`. I read every reworded line in the a4565c4 diff. The new pin sentence ("without it the worker checks the certificate the normal way, which a self-signed certificate fails") matches connect.ts:71-72 (`pin === undefined` gives `{ minVersion: 'TLSv1.2' }`, Node's default verification). `apps/worker/src` and `packages` unchanged. No pre-existing test pin was removed (the a4565c4 test diff has no `-` lines) |
| 02-20 #3 | Requirements bullet `A host clock kept in sync over NTP`: why, macOS and Linux checks | ✓ VERIFIED | README:396. It covers Proton-set INTERNALDATE, the shared host clock, the cap at the worker clock, the 5-minute re-read (matches `WATERMARK_OVERLAP_MS = 300_000`, run.ts:39), the NTP default, System Settings > General > Date & Time, `sntp time.apple.com` and `timedatectl` / `System clock synchronized: yes`. It leaves out the internal ids WR-03 and D-19 (a SUMMARY deviation; the facts are all there) |
| 02-20 #4 | user-facing-text.test.ts pins the scope sentence (both places), the clock bullet and stale-phrase absence; Technical settings YAML still schema-valid | ✓ VERIFIED | New describe block, user-facing-text.test.ts:189-228: section slicing fails if a heading is missing; 9 stale phrases checked case-insensitively. The file passes |
| 02-20 #5 | Findings have exactly one `**Post-spike initial_backfill_days:** <N>` line reading 3, plus a dated correction that keeps the 30 history and names the CLI command | ✓ VERIFIED | `^...: 3$` = 1; `^...: [0-9]*$` = 1; `done: no-repair, backfill 30.` = 1; `Correction (2026-10-07` = 1; `sift mailbox backfill personal --days 3` = 1 (findings:99-101) |
| 02-20 #6 | 02-LIVE-INGEST.md keeps its 30-to-1 deviation and adds a dated correction citing 3; the test matches the value exactly | ✓ VERIFIED | LIVE-INGEST:12 (deviation kept) and :13 (correction). live-ingest-record.test.ts:86-88 uses `${spike}(?![0-9])`, so a cited 30 no longer satisfies a spike of 3. The test passes |
| 02-20 #7 | Owner config has `initial_backfill_days: 3`, the owner ran the 3-day backfill, and the defaults stay 30 | ✓ VERIFIED | `grep -n initial_backfill_days config/config.yaml` gives `32: initial_backfill_days: 3` (git-ignored, one line). Schema, example and README default are unchanged (`initial_backfill_days: 30` still in README). **The SUMMARY has no counts, but the database corroborates the backfill.** 38 already-stored historical rows were promoted to eligible in one burst at 05:49:50-51Z. The eligibility boundary sits between INTERNALDATE 2026-10-04 03:57Z (still historical) and 07:18Z (eligible), which matches a 3-day window from 05:49Z on 10-07. No eligible rows date from 10-03. 130 of 131 eligible messages have a body; the exception is the removed message |
| 02-21 #1 | compose-smoke.sh no longer requires an ok mailbox_status row | ✓ VERIFIED | `grep -c "state = 'ok'"` = 0; `imap.smoke.invalid` still rewritten (2 hits) |
| 02-21 #2 | After worker healthy, the script waits within SMOKE_TIMEOUT until every enabled mailbox has a connecting or error row, and fails with a mailbox-status message otherwise | ✓ VERIFIED (coincidental-reliance) | compose-smoke.sh:265-284: `not exists ... state in ('connecting', 'error')` loop, 2 s sleep, `$SECONDS -ge $deadline` fail message, `query failed: mailbox status`. The "proves the loop started" part relies on a fresh smoke database (see coincidental_reliance_items / review WR-02) |
| 02-21 #3 | Migrations and registry checks still run; new mailboxes-enabled floor of 1 | ✓ VERIFIED | Lines 257-261: `migrations applied` 5, `mailboxes registered` 1, `mailboxes enabled` 1 (`disabled_at is null`) |
| 02-21 #4 | Emulated-stack tests: pass case, missing-row failure, no ok query; RED against pre-fix script | ✓ VERIFIED | compose-smoke.test.ts:580-610 (runStack shim answers by SQL substring; ok-state answer 0). The file passes. RED is recorded in the SUMMARY (3 failed against 758185b, `mailboxes ok: expected >= 1, got 0`); I did not re-run RED |
| 02-21 #5 | Local real run ends `compose smoke OK`; ci run for pushed main HEAD succeeds in every job | ✓ VERIFIED | `gh run view 37581267978`: attempt 2, completed, success, headSha 8ec4ae8 (= origin/main), jobs check success and compose-smoke success. The CI compose-smoke log shows `migrations applied = 8`, `mailboxes registered = 2`, `mailboxes enabled = 2`, `mailbox status connecting or error = 2`, `compose smoke OK`. I did not re-run the local Docker smoke; the CI run is the same script on a fresh runner |

### Earlier plan truths (regression check)

The two earlier owner-decision truths (02-14 repair, 02-16 lock span) now carry accepted overrides. They count as PASSED (override).

One earlier truth changed status:

| Plan | Truth | Status | Evidence |
|------|-------|--------|----------|
| 02-17 #3 | "The README explains the certificate pin: init prints the fingerprint, the owner pastes it at `imap.tls.pin_sha256`, a regenerated Bridge certificate stops the mailbox until the owner compares the new fingerprint (`sift bridge trust <slug>`) and updates config; **servers with a public-CA certificate may omit the pin; `imap.tls.mode` is starttls or implicit** and Sift never connects without TLS" | ? UNCERTAIN (owner decision) | The bold clauses were removed by a4565c4 under G-02-9 (the owner's Proton-only scope, cerebrum Decision Log 2026-10-07; the G-02-9 gap explicitly lists the "implicit" lines). README:281 now says every mailbox needs the pin, and README:325-326 name only STARTTLS. The rest of the truth holds: README:326, 467, 548; `Sift never connects without TLS` at README:234 |

**This looks intentional.** To accept it, add to the frontmatter `overrides:`:

```yaml
  - must_have: "The README explains the certificate pin: init prints the fingerprint, the owner pastes it at imap.tls.pin_sha256, a regenerated Bridge certificate stops the mailbox until the owner compares the new fingerprint; servers with a public-CA certificate may omit the pin; imap.tls.mode is starttls or implicit and Sift never connects without TLS"
    reason: "Superseded by the owner's Proton-only decision (G-02-9, 02-20): the README names only Bridge, STARTTLS and a required pin; the implicit-TLS and unpinned code paths stay but are no longer documented"
    accepted_by: "Samuel Kimama"
    accepted_at: "<ISO timestamp>"
```

The other 02-17 README truths still hold. Their pins in user-facing-text.test.ts all pass, and a4565c4 removed none. They cover the quick-start order, session tokens, full-disk encryption, the 30-day default and combined address mode, change tracking scoped to v3.27.0, the Bridge login, the Technical settings schema, the bind address, hard-delete and `bridge-init`.

**Score:** 194/195 must-haves verified (0 present, behavior-unverified; 2 by override); 1 needs an owner decision.

### Required Artifacts (gap closure)

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `README.md` | Proton-only scope, NTP bullet, other-server wording gone | ✓ VERIFIED | Lines 11, 109, 234, 281, 325-326, 393-396, 410, 512, 523 |
| `apps/worker/test/user-facing-text.test.ts` | Scope, clock and stale-phrase pins | ✓ VERIFIED | Contains `A host clock kept in sync over NTP`; passes |
| `02-SPIKE-FINDINGS.md` | `**Post-spike initial_backfill_days:** 3` with dated history | ✓ VERIFIED | Line 99 plus correction at 101 |
| `02-LIVE-INGEST.md` | Dated correction citing 3 | ✓ VERIFIED | Line 13 |
| `apps/worker/test/live-ingest-record.test.ts`, `spike-findings.test.ts` | Exact value match; exactly one value line | ✓ VERIFIED | Both pass in the main checkout (config/config.yaml present, so the username denylist is active) |
| `scripts/compose-smoke.sh` | Status check reachable without IMAP | ✓ VERIFIED | Contains `'connecting', 'error'`; `bash -n` and `shellcheck -S warning` exit 0 |
| `apps/worker/test/compose-smoke.test.ts` | Emulated-stack G-02-14 tests | ✓ VERIFIED | Contains `G-02-14`; passes |

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| README.md | user-facing-text.test.ts | scope sentence, clock bullet, stale phrases | WIRED |
| 02-SPIKE-FINDINGS.md | live-ingest-record.test.ts | `Post-spike initial_backfill_days` value cited exactly | WIRED |
| config/config.yaml (owner) | 02-SPIKE-FINDINGS.md | D-84: config 3 = recorded 3 | WIRED |
| .github/workflows/ci.yml | scripts/compose-smoke.sh | `run: scripts/compose-smoke.sh --down` (ci.yml:101) | WIRED |
| scripts/compose-smoke.sh | mailbox_status | superuser psql through `query` | WIRED (CI log shows 2 rows) |
| scripts/compose-smoke.sh | smoke config | hosts rewritten to imap.smoke.invalid | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| message / message_location | Owner's INBOX | Bridge → runIngest → storeMessages | 103,505 messages, all in one mailbox, 0 duplicates | ✓ FLOWING |
| message.eligible_for_classification | 3-day backfill | `sift mailbox backfill personal --days 3` → runBackfill → promoteEligible | 38 rows promoted at 05:49:50Z; boundary at ~3 days | ✓ FLOWING |
| mailbox_status | Owner-visible state | recordSyncSuccess | `personal` ok, last_sync_at 06:45:57Z, no error | ✓ FLOWING |
| folder_sync.internal_date_watermark | Poll gate | advanceFolderSync | 06:34:50Z, not ahead of the DB clock (06:46Z); review WR-01 is latent on this database | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 02-20 and 02-21 doc and smoke tests | `pnpm vitest run user-facing-text spike-findings live-ingest-record compose-smoke --maxWorkers=3` | 4 files, 137/137 | ✓ PASS |
| CI workflow and compose contract after the Dependabot bump | `pnpm vitest run ci-workflow compose --maxWorkers=3` | 2 files, 44/44 | ✓ PASS |
| Smoke script static checks | `bash -n` and `shellcheck -S warning scripts/compose-smoke.sh` | exit 0 / exit 0 | ✓ PASS |
| CI on main | `gh run view 37581267978 --json attempt,conclusion,jobs` | attempt 2 success; check and compose-smoke success | ✓ PASS |
| CI compose-smoke assertions | `gh run view ... --log --job <compose-smoke>` | `mailbox status connecting or error = 2`, `compose smoke OK` | ✓ PASS |
| Live stack | read-only counts on sift-db-1 | see truths 3-4 and the 02-20 #7 evidence | ✓ PASS |

I did not run the full `pnpm test` (bug-189: host load with live containers).

### Probe Execution

No `scripts/*/tests/probe-*.sh` exists, and neither 02-20 nor 02-21 declares a probe. Step 7c does not apply.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SPK-01 | 02-11, 02-14 | Labels as folders, apply/remove | ✓ SATISFIED | Findings unchanged |
| SPK-02 | 02-11, 02-14 | CONDSTORE/QRESYNC | ✓ SATISFIED | Findings unchanged |
| SPK-03 | 02-11, 02-14 | Message-ID consistency | ✓ SATISFIED | Findings unchanged |
| SPK-04 | 02-11, 02-14, 02-17, 02-20 | UIDVALIDITY across restarts and resyncs; capability decision | ✓ SATISFIED (override) | Restarts measured; the repair is covered by the accepted override (2026-10-07T04:01:40Z); the D-84 value record is corrected (02-20) |
| ING-01 | 02-01 ... 02-19, 02-20, 02-21 | Worker connects through Bridge and reads the configured folder | ✓ SATISFIED | Live stack ok; README scoped to Bridge; CI smoke proves the worker loop reports status |
| ING-02 | 02-02 ... 02-19 | Stored once with identity, UID, UIDVALIDITY, body | ✓ SATISFIED | 0 duplicates at 103,505 rows |
| ING-03 | 02-02 ... 02-19, 02-20 | New mail picked up by polling | ✓ SATISFIED | Live polls; NTP requirement documented (G-02-8) |
| ING-04 | 02-03 ... 02-19 | folder_sync UIDVALIDITY; safe resync | ✓ SATISFIED | Generation 2 ok; resync tests (CI flake bug-191 is test-side) |

There are no orphaned requirements. REQUIREMENTS.md maps exactly these eight IDs to Phase 2, and every plan ID is accounted for.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| 02-20/02-21 changed files | - | TBD/FIXME/XXX/TODO/HACK | none found | - |
| `scripts/compose-smoke.sh` | 265-284 | No lower bound on when the status row was written (02-REVIEW WR-02) | ⚠️ Warning | Local reruns without `--down` can pass on the previous run's rows. CI (fresh runner, `--down`) is unaffected. The comment "only the state at the deadline counts" (line 270) also misdescribes the loop, which passes at the first good poll |
| `apps/worker/src/ingest/run.ts` | 297-327 | A watermark already stored in the future is never lowered (02-REVIEW WR-01) | ⚠️ Warning | Delayed mail could become historical on every cycle while the stored watermark is ahead. Latent: the owner's INBOX watermark (06:34:50Z) is not in the future. Not a plan must-have; the NTP bullet (G-02-8) reduces the chance |
| `apps/worker/test/imap-folder-source.test.ts` | 388 | Intermittent UIDVALIDITY assertion (bug-191) | ⚠️ Warning | Failed CI attempt 1 of run 37581267978; the rerun passed. It can turn `check` red on main until fixed |
| `.env.example` | 27-28 | "If you lose it, run `docker compose run --rm bridge-init` again" | ⚠️ Warning | Carried from the previous verification: wrong recovery advice on an existing volume (exit 78). Still unfixed |
| 02-REVIEW IN-01..IN-05 | - | Misleading cert_expired text for unpinned mailboxes, skipped clock warnings, progress reset, duplicate helpers, a lost CLI test | ℹ️ Info | Advisory, none blocks the goal |

### Prohibitions

- **Test-tier** (02-01 ... 02-19): unchanged code; the enforcing tests I re-ran pass. 02-21's T-02-80 rule (no smoke worker reaches a real server) is enforced by the host rewrite and by the check accepting only connecting/error; CI shows 2 such rows.
- **Judgment-tier** (02-11, 02-14, 02-19): the owner confirmed them in 02-UAT test 10. 02-20 and 02-21 declare no new prohibitions.

### Human Verification Required

1. **Override for 02-17 must-have 3.** Accept the suggested override above, or ask for the removed README clauses back, which would contradict G-02-9. Why human: a later plan superseded an earlier must-have on the owner's decision.
2. **README read-through (UAT test 11, 02-17 D7).** Read the quick start as a new owner after the 02-20 edits. Expected: clear and complete from clone to an ingesting worker. Why human: comprehension, not strings.

Not raised again: UAT test 12, the Renovate Bridge bump PR. It is blocked on a third party, and the bridge-image workflow already passed on GitHub (run 37572704376). It stays in 02-UAT.md.

### Gaps Summary

No gaps remain. All four UAT gaps are closed:

- **G-02-9 and G-02-8:** the README now states the Proton-only scope and the NTP requirement, and tests pin both.
- **G-02-4:** the backfill value 3 is recorded with dated history, set in the owner's config, and backed by database evidence of the 3-day backfill.
- **G-02-14:** compose-smoke checks a status reachable without IMAP, and ci run 37581267978 is green in both jobs.

The phase goal holds:

- Bridge's behaviour is documented from the owner's mailbox.
- 103,505 messages sit in one mailbox, each stored once, and polling is current.

The status is `human_needed`, not `passed`, for two reasons:

- The Proton-only README rewrite legitimately invalidated two clauses of an 02-17 must-have, which needs an owner override.
- The owner's deferred README read-through is still open.

The review warnings WR-01 (latent future watermark) and WR-02 (stale rows on local smoke reruns) are advisory and are not plan must-haves. WR-02 weakens what a local rerun of the smoke proves, but not what CI proves.

The orchestrator should also mark G-02-4, G-02-8, G-02-9 and G-02-14 as closed in 02-UAT.md, which still reads `status: diagnosed`.

---

_Verified: 2026-10-07T06:48:15Z_
_Verifier: Claude (gsd-verifier)_
