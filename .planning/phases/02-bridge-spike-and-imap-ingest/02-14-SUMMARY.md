---
phase: 02-bridge-spike-and-imap-ingest
plan: 14
subsystem: imap
tags: [proton-bridge, imap, spike, condstore, qresync, identity, uidvalidity, privacy]

requires:
  - phase: 02-01
    provides: pinned Bridge v3.27.0 source build and keychain setup
  - phase: 02-02
    provides: config pin_sha256 and ingest.initial_backfill_days
  - phase: 02-08
    provides: bridge-init one-shot modes (init, configure, repair)
  - phase: 02-11
    provides: sift bridge probe (read-only report, IDLE wait, label test, compare)
provides:
  - 02-SPIKE-FINDINGS.md answering SPK-01..04 and D-43 from the owner's real Proton mailbox
  - ADR-0003 addendum (polling only, pm: identity first, label apply/remove method, D-09 prompt recipe)
  - apps/worker/test/support/privacy-scan.ts (privacyProblems, configDenylist), shared with 02-19
  - spike-findings doc-contract test
  - probe fix, the label-test COPY runs from a SELECTed source (Bridge refuses COPY from EXAMINE)
affects: [02-17, 02-19, phase-04-label-application, m2-relabel-learning]

actuals:
  tokens: 8359
  tasks: 3
  commits: 4
plan_head_before: 4034fce3c04e511f5a12bd2e62dcbb3656787a01
plan_head_after: a3c50c10733edf116336d0bc6592bf27072eae0c

tech-stack:
  added: []
  patterns:
    - "Spike documents are gated by a doc-contract test plus a privacy scan whose denylist includes the configured IMAP usernames"
    - "Bridge COPY needs a SELECTed source; every read stays on EXAMINE"

key-files:
  created:
    - apps/worker/test/spike-findings.test.ts
    - apps/worker/test/support/privacy-scan.ts
  modified:
    - .planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md
    - docs/adr/0003-traces-and-mail-app-relabels.md
    - apps/worker/src/spike/probe.ts
    - apps/worker/test/bridge-probe.test.ts

key-decisions:
  - "Sync capability to assume: polling only (Bridge v3.27.0 has no CONDSTORE/QRESYNC; ENABLE and STATUS HIGHESTMODSEQ answer BAD)"
  - "Identity key order confirmed: pm: (X-Pm-Internal-Id, on 100% of messages) then mid: then hdr:v1:; 1.6% of Message-IDs are shared by distinct Proton messages; hdr:v1 inputs unchanged"
  - "Phase 4 label application: SELECT source, UID COPY into Labels/<name>, record the COPYUID label UID, remove with UID STORE \\Deleted + UID EXPUNGE in the label folder"
  - "D-18/D-22 stands for restarts (UIDVALIDITY and INTERNALDATE unchanged across two restarts); a forced repair is unmeasured and treated as a UIDVALIDITY reset"
  - "Bridge's initial sync assigns UIDs newest-first: INTERNALDATE, not UID order, decides new mail; 02-19 starts the worker only after the sync finishes"
  - "Post-spike initial_backfill_days: 30 (owner, D-84)"

patterns-established:
  - "privacyProblems(text, configDenylist(path)): reports line numbers and problem kinds, never the matched text"

requirements-completed: [SPK-01, SPK-02, SPK-03, SPK-04]

coverage:
  - id: D1
    description: "02-SPIKE-FINDINGS.md answers SPK-01..04 and D-43 from the owner's real mailbox, with the scope line, decision lines and the post-spike backfill value"
    requirement: SPK-01
    verification:
      - kind: unit
        ref: "apps/worker/test/spike-findings.test.ts#has every section heading"
        status: pass
      - kind: unit
        ref: "apps/worker/test/spike-findings.test.ts#names one allowed sync capability to assume"
        status: pass
    human_judgment: true
    rationale: "Whether the recorded observations are the right basis for Phase 4 and M2 design is a judgment call; the test only proves the structure and privacy"
  - id: D2
    description: "ADR-0003 addendum links the findings and resolves raw-prompt retention as the prompt recipe (D-09)"
    requirement: SPK-02
    verification:
      - kind: unit
        ref: "apps/worker/test/spike-findings.test.ts#resolves raw-prompt retention: traces store the prompt recipe (D-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Committed spike documents hold aggregates only: no header lines, addresses or configured usernames"
    requirement: SPK-03
    verification:
      - kind: unit
        ref: "apps/worker/test/spike-findings.test.ts#holds aggregates only: no header lines, addresses or configured usernames"
        status: pass
      - kind: unit
        ref: "apps/worker/test/spike-findings.test.ts#flags a planted denylist word and a planted address without echoing them"
        status: pass
    human_judgment: false
  - id: D4
    description: "The label-test COPY runs from a SELECTed source, so it works against Bridge; stored INBOX flags stay unchanged"
    requirement: SPK-04
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#COPYs from a SELECTed source, since Bridge refuses COPY from an EXAMINEd one"
        status: pass
    human_judgment: false

duration: 65min
completed: 2026-10-06
status: complete
---

# Phase 2 Plan 14: Proton Bridge Spike Summary

**Measured against the owner's real Proton mailbox, Bridge v3.27.0 has no CONDSTORE or QRESYNC, so sync is polling only. It stamps a unique, folder-stable X-Pm-Internal-Id on every message, so the `pm:` key goes first. Labels are applied with a SELECTed `UID COPY` plus COPYUID and removed with `UID EXPUNGE`. UIDVALIDITY and INTERNALDATE survived two restarts.**

## Performance

- **Duration:** about 65 min for this continuation (2026-10-06 13:17 to 14:20 UTC); Task 1 ran on 2026-10-05
- **Tasks:** 3 of 3 (Task 1 tracer, Task 2 owner checkpoint, Task 3 probes and documents)
- **Files modified:** 6 by this plan

## Accomplishments

- Ran the approved `no-repair` spike on the owner's mailbox:
  - an IDLE wait
  - 34 light sync probes
  - a baseline scan of 2000 headers
  - a completed label test on one of the owner's own fresh test emails
  - a planned Bridge restart with a probe comparison and a fixed-range snapshot comparison
- Wrote `02-SPIKE-FINDINGS.md` (all eight sections, the scope line, and the decision lines for sync capability, identity key, D-18/D-22, Phase 4 and M2).
- Appended the ADR-0003 addendum.
- Added the shared `privacyProblems` / `configDenylist` helper and the doc-contract test. The test ran from the main checkout, where the config denylist held 2 entries.
- Found and fixed a probe bug that only a real Bridge exposes: COPY from an EXAMINEd source is refused.

## Task Commits

1. **Task 1: Tracer, Bridge stack built from the pinned release, probe in the worker image** - `4cab3ec` (docs; previous agent)
2. **Task 2: Owner login, address mode and approval** - checkpoint, no commit. The orchestrator's fix during the checkpoint is `7fd1580` (see Deviations).
3. **Task 3: Approved probes, findings, ADR addendum and doc-contract test** - `358cf37` (fix, probe deviation) and `a3c50c1` (docs)

`commits: 4` is measured from the plan ledger (4034fce..HEAD) and includes the orchestrator's `7fd1580`.

## Task 2 Owner Reply (verbatim)

> done: no-repair, backfill 30.

Init output line: `account 1: addresses: 15, address mode: combined, state: connected`.

## Files Created/Modified

- `.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md` - spike findings, aggregates only
- `docs/adr/0003-traces-and-mail-app-relabels.md` - `## Addendum (2026-10): Proton Bridge spike (M1)`
- `apps/worker/test/support/privacy-scan.ts` - `privacyProblems(text, extraDenylist)`, `configDenylist(configPath)`
- `apps/worker/test/spike-findings.test.ts` - doc-contract and privacy test (14 cases)
- `apps/worker/src/spike/probe.ts` - labelTest SELECTs the source for the COPY only
- `apps/worker/test/bridge-probe.test.ts` - regression case; stored flags are compared without the session-only `\Recent`

## Decisions Made

See key-decisions above. All of them come from the observations in the findings document.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The label-test COPY was refused by Bridge**
- **Found during:** Task 3, step 3b
- **Issue:** `labelTest` kept INBOX EXAMINEd for the `UID COPY`. Bridge (gluon) answered "the mailbox is read-only", so ImapFlow returned no COPYUID and the probe reported `label copy not confirmed` with `labelCopyMayRemain`. A read-only check showed the label folder at 0 messages and uidNext 1, so nothing was copied. Dovecot accepts COPY from EXAMINE (RFC 3501), so 02-11's tests could not catch it.
- **Fix:** SELECT the source only for the COPY; every read stays on EXAMINE. The tests compare stored flags without `\Recent`, which any SELECT clears. A regression test asserts that the COPY runs with INBOX selected read-write.
- **Files modified:** apps/worker/src/spike/probe.ts, apps/worker/test/bridge-probe.test.ts
- **Commit:** 358cf37
- **Live rerun:** the rerun used the fixed source mounted into the worker container, because the image rebuild failed (see Issues). The test then completed with COPYUID, byte-equal Message-ID and X-Pm-Internal-Id, removal from the label, and the INBOX copy present throughout.

**2. [Rule 3 - Blocking] The test email's UID had to be found without the IDLE wait**
- **Found during:** Task 3, step 3a
- **Issue:** Bridge was in its initial sync. The IDLE wait ended after 25 s on EXISTS from synced old mail (newUid 126), so its UID was not the test email and was not used. The newest-by-sequence sample showed only old mail because Bridge syncs newest-first.
- **Fix:** a bounded, read-only snapshot script used the worker's config loader and pinned `openImap`, EXAMINE only, and printed only UIDs and ages. It found three INBOX messages under one hour old (UIDs 1156, 1157, 1384). A Message-ID hash comparison against the Sent folder (booleans only) showed all three were self-sent, so all were the owner's test emails. The newest, UID 1384, was tested.
- **Files modified:** none in the repository (the scripts live in the session scratchpad)

**3. [Rule 3 - Blocking] Restart comparison while Bridge was syncing**
- **Issue:** The sync never settled within the plan's 30-minute polling limit; uidNext was still rising at about 200 per minute. The probe's newest-200 sample moves by the number of newly synced messages, so a probe-only comparison has limited overlap.
- **Fix:** the plan's `--compare` report was kept: 123 entries matched with 0 changes, and the 77 missing equal the 77 messages synced in between. A fixed UID 1 to 2000 snapshot, with UID, INTERNALDATE and SHA-256 of the identity headers, was added before and after the restart: 1998 of 1998 matched, 0 UID changes, 0 INTERNALDATE changes.
- **Report location:** `data/spike/` (git-ignored, aggregate-only, named by the plan), not the scratchpad.

### Orchestrator deviations during the Task 2 checkpoint

**4. [Rule 1 - Bug] bridge-init read the user list before Bridge finished loading the account** (fixed by the orchestrator, `7fd1580`, bug-154)
- The owner's first `bridge-init` run showed `state: locked` and wrote nothing. sift-helper read GetUserList right after Bridge started, while the account was still LOCKED (primary address only, no password). It then sent Quit, which cancelled the load.
- `waitUsersLoaded` now polls for up to 120 s (Go tests in `bridge/helper/main_test.go`). On the rerun the init showed state connected, 15 addresses and combined mode, wrote the IMAP password, and made the backup.

**5. Owner config placement corrected by the orchestrator**
- The pin is `JTVRu7KoovkCADlnXNj8i6swhqbdjqntEpcJtcwjIIY=`, as printed by the init run and pasted by the owner. The orchestrator corrected its placement in config.yaml: `tls` moved under `imap`, the host changed from `protonmail-bridge` to `bridge`, and `ingest.initial_backfill_days: 0` was added.
- `sift config check` then printed `Config OK: 1 mailboxes (personal); password env vars present`.

**6. Unplanned owner Bridge restart (13:22:57Z)**
- During the sync, the owner stopped Bridge and ran an interactive `bridge-init` once. The orchestrator reports this as a cancelled account load, and the owner has since been asked not to touch Bridge.
- Two light probes failed while Bridge was down; I restarted Bridge at 13:25.
- The findings record this as restart 1: UIDVALIDITY was unchanged and the sync resumed with no renumbering. It did not affect the planned restart comparison, whose baseline was taken after it.

## Issues Encountered

- **Worker image rebuild failed** (`docker compose build worker`, exit 17): apt.postgresql.org dropped the TLS connection while `postgresql-client-18` was downloading. This is an environment/network problem and out of scope. The running `sift:local` image therefore does not yet contain 358cf37; the live label test used a read-only source mount. One retry failed the same way (exit 17). Logged in `deferred-items.md`.
- **Full-suite flakiness under load:** two `pnpm test` runs while Bridge was syncing on the same Docker host had 1 and 4 timeouts against Dovecot or Postgres, each in different tests. The four affected files passed in isolation (86 of 86), and the next full run passed 840 of 840.
- **Repair not measured:** the owner approved `no-repair`, so INTERNALDATE and UIDVALIDITY across a forced cache rebuild remain open for 02-19.

## User Setup Required

None beyond Task 2. **No `Sift Spike` label copy remains in the owner's mailbox.** The read-only check after the test shows the label folder at 0 messages (uidNext 2: one copy made and removed). The empty `Sift Spike` label itself remains, as the plan expects; the owner may delete it in the Proton client if they like. The owner's three self-sent test emails remain in INBOX untouched.

## Next Phase Readiness

- 02-17 can quote the findings with their scope line. 02-19 must:
  - start the worker after Bridge's initial sync has settled
  - check `initial_backfill_days` against the recorded value of 30
  - treat a repair as a UIDVALIDITY reset
- Phase 4 and M2 have written decisions: polling only, `pm:` identity, and SELECTed COPY with COPYUID.

## Self-Check: PASSED

- FOUND: 02-SPIKE-FINDINGS.md, docs/adr/0003 addendum, apps/worker/test/spike-findings.test.ts, apps/worker/test/support/privacy-scan.ts
- FOUND commits: 4cab3ec, 7fd1580, 358cf37, a3c50c1
- Acceptance:
  - the Sync capability grep prints 1
  - `## Addendum` matches
  - `data/spike/probe-1-baseline.json` is ignored, and `git status --porcelain data/` is empty
  - `bridge-init configure` appears 0 times in the findings
  - spike-findings.test.ts passes 14 of 14 from the main checkout
- `pnpm typecheck` exits 0; `pnpm test` passes 840 of 840; `pnpm lint` exits 0 (1 existing warning)
