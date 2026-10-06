---
phase: 02-bridge-spike-and-imap-ingest
plan: 19
subsystem: ingest
status: complete
tags: [live-ingest, proton-bridge, imap, uidvalidity, resync, postgres, doc-contract, privacy-scan]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-13 worker ingest engine and logs, 02-14 logged-in Bridge, spike findings and privacy-scan helper, 02-16 sift mailbox list/resume, 02-11 light probe"
provides:
  - ".planning/phases/02-bridge-spike-and-imap-ingest/02-LIVE-INGEST.md: counts-only record of ROADMAP Phase 2 criteria 3, 4 and 5 on the owner's real Proton mailbox"
  - "apps/worker/test/live-ingest-record.test.ts: doc-contract test (sections, criterion/method/result lines, D-86 rule, D-84 value or documented override, privacy scan)"
affects: [phase-02-verification, phase-03, phase-04]

actuals:
  tokens: 4300
  tasks: 3
  commits: 2
plan_head_before: 312a3c9450eed026a7b72caec456f199a7a09cca
plan_head_after: 7921389b66ac2600a450bde278bf8c9e3e14708d

tech-stack:
  added: []
  patterns:
    - "Live-run evidence as a counts-only markdown record plus a doc-contract test that runs the shared privacy scan with the owner's username denylist"
    - "New-mail detection on a still-syncing Bridge by INTERNALDATE in the probe's newest-N sample, not by uidNext"

key-files:
  created:
    - .planning/phases/02-bridge-spike-and-imap-ingest/02-LIVE-INGEST.md
    - apps/worker/test/live-ingest-record.test.ts
  modified: []

key-decisions:
  - "Criterion 4 signal: T_bridge from the probe's newest-200 sample holding an entry with INTERNALDATE >= T_send, because Bridge's ongoing initial sync made uidNext grow ~120/min regardless of new mail"
  - "Criterion 5 by simulated mismatch (owner reply `ready: simulate`); live ingest result is partial per D-86 because Bridge's own UIDVALIDITY change was not observed"
  - "The D-84 doc-contract check accepts a Method initial_backfill_days that differs from the spike value only when the record documents a `**Deviation from D-84:**` citing the spike line (owner override 30 -> 1)"

patterns-established:
  - "Doc-contract tests for live records: assert the headings, the bold result lines with a strict regex, conditional rules (D-86), and privacyProblems(text, configDenylist(config.yaml))"

requirements-completed: [ING-01, ING-02, ING-03, ING-04]

coverage:
  - id: D1
    description: "Criterion 3 on the real mailbox: rows scoped to the mailbox, a worker restart adds no row for seen mail (R1 163/163, R2 0, 0 duplicates)"
    requirement: ING-02
    verification:
      - kind: manual_procedural
        ref: "02-LIVE-INGEST.md ## Criterion 3 (S1/S2 snapshots, R1, R2)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/live-ingest-record.test.ts#has one result line per criterion, the UIDVALIDITY method and the overall result"
        status: pass
    human_judgment: false
  - id: D2
    description: "Criterion 4 on the real mailbox: an external email became an eligible row with a body 34 s after Bridge reported it (limit 80 s), nothing restarted"
    requirement: ING-01
    verification:
      - kind: manual_procedural
        ref: "02-LIVE-INGEST.md ## Criterion 4 (data/live/c4poll.log)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Criterion 5 on the real mailbox by simulated mismatch: generation 1 -> 2, state ok, one resynced line, C1 0, C2 40940 = new 1 + older 40939, C3 58 = S4 eligible, 0 duplicates"
    requirement: ING-03
    verification:
      - kind: manual_procedural
        ref: "02-LIVE-INGEST.md ## Criterion 5 (S4, S5, data/live/c5-checks.json)"
        status: pass
    human_judgment: true
    rationale: "Bridge's own UIDVALIDITY change was not observed (D-86); whether a Bridge repair changes UIDVALIDITY remains unmeasured, so the result is recorded as partial"
  - id: D4
    description: "The record stays counts-only and its result lines stay well-formed"
    requirement: ING-04
    verification:
      - kind: unit
        ref: "apps/worker/test/live-ingest-record.test.ts"
        status: pass
    human_judgment: false

duration: 4h40m
completed: 2026-10-06
---

# Phase 2 Plan 19: Live Ingest on the Owner's Proton Mailbox Summary

**The Phase 2 worker ingested the owner's real Proton INBOX through Bridge v3.27.0: a restart added nothing (criterion 3), an external email became an eligible row 34 s after Bridge saw it (criterion 4), and a simulated UIDVALIDITY mismatch resynced 51,343 locations into generation 2 with 0 duplicates and no eligibility change (criterion 5); result `partial` per D-86.**

## Performance

- **Duration:** about 4h40m wall clock (15:03:19Z to about 19:44Z), most of it owner checkpoints, Bridge's initial sync and the backups ownership fix
- **Started:** 2026-10-06T15:03:19Z
- **Completed:** 2026-10-06T19:44Z
- **Tasks:** 3 (Task 2 a human-action checkpoint)
- **Files created:** 2

## Owner replies (verbatim)

- Ad-hoc mid-sync checkpoint (initial_backfill_days and start time): "1 day, start now"
- Task 2: "ready: simulate"

## Accomplishments

- **Criterion 3: pass** (Task 1, b5edfd7). S1 163 messages / S2 547, 0 outside the mailbox, R1 163 before and after the restart, R2 0, 0 duplicate (uidvalidity, UID) pairs or identity keys. 492 mid-sync historical rows were kept out of eligibility and the volume valve.
- **Criterion 4: pass.** T_send 19:17:44Z; polling from 19:18:42Z; U0 uidNext 50813; S3 last_uid 50922. T_bridge 19:20:35Z (probe 8, UID 51105, INTERNALDATE T_send + 153 s); T_db 19:21:09Z (row created 19:21:08.882Z by the cycle logged `stored` 1). **T_db - T_bridge = 34 s** against a limit of 60 s + 20 s = 80 s. Eligible: yes; body rows: 1; UID 51105 > 50922.
- **Criterion 5: pass (simulated mismatch).** Worker stopped 19:21:39-45Z; S4/T4 19:21:48Z (10403 messages, 58 eligible, 58 bodies, last_uid 51176, generation 1); dump `backups/sift-20261006T192158Z-pre-live-resync.dump` (4445734 bytes); `UPDATE 1` set uidvalidity 116082324 -> 116082325; worker started 19:22:39Z; one line `INBOX resynced: 10,403 matched, 1 new, 0 gone, 40,939 older than backfill window` at T5 19:24:55.994Z. S5 (19:25:19Z): 51343 messages = 51343 live locations, 0 removed, 59 eligible, 59 bodies, uidvalidity 116082324, last_uid 51345, generation 2, state ok. C1 0; C2 40940 = 1 + 40939; C3 58 = S4 eligible; 0 duplicates; held count none, `sift mailbox resume` not run.
- **Result line:** `**Live ingest:** partial: criterion 5 by simulated mismatch; Bridge's own UIDVALIDITY change was not observed`.
- Doc-contract test `live-ingest-record.test.ts`: 6 tests pass from the main checkout (with the config.yaml username denylist).

## Task Commits

1. **Task 1: tracer, criterion 3** - `b5edfd7` (docs)
2. **Task 2: owner checkpoint** - no commit (reply "ready: simulate")
3. **Task 3: criteria 4 and 5, record and doc-contract test** - `7921389` (test)

**Plan metadata:** recorded in the final docs commit

## Files Created/Modified

- `.planning/phases/02-bridge-spike-and-imap-ingest/02-LIVE-INGEST.md` - counts-only record: Method, mid-sync historical rows, criteria 3, 4, 5, Result
- `apps/worker/test/live-ingest-record.test.ts` - doc-contract test for the record

Local and untracked (git-ignored): `data/live/s1.json` to `s5.json`, `c4poll.log`, `c5-checks.json`, `worker-c5.jsonl`, timing files; `backups/sift-20261006T192158Z-pre-live-resync.dump`. `git status --porcelain data/ backups/` prints nothing.

## Decisions Made

See key-decisions in the frontmatter: the INTERNALDATE sample signal for criterion 4, the simulated mismatch with a partial result (D-86), and the D-84 test accepting a documented owner override.

## Deviations from Plan

1. **[Owner decision - D-84] initial_backfill_days 1 instead of the spike's 30.** At an ad-hoc checkpoint during Bridge's initial sync the owner changed `ingest.initial_backfill_days` from 30 to 1 and chose to start at once ("1 day, start now"), so the run started while Bridge was still syncing. The Method section records it; `02-SPIKE-FINDINGS.md`'s `**Post-spike initial_backfill_days:** 30` was left unedited. Consequently the planned test assertion "Method's value equals the spike value" was changed to "equals it, or the Method documents a `**Deviation from D-84:**` citing the spike line".
2. **[Rule 3 - Blocking, owner fix] backups/ not writable (bug-161).** The first `up` failed in `setup` because the macOS host's `backups/` was owned by uid 1000; the owner ran `sudo chown`. Worker downtime about 17:23Z to 17:53Z. The rerun was scoped (`docker compose up -d --build worker`) so the bridge container was never recreated.
3. **[Rule 1 - signal] Criterion 4 signal changed** from the probe's uidNext growing past U0 to the probe's newest-200 sample holding an entry with INTERNALDATE >= T_send (T_db: eligible row with body and INTERNALDATE >= T_send), because Bridge's ongoing initial sync appended old mail at about 120 UIDs/min. Proposed to the owner at the Task 2 checkpoint; no objection.
4. **[Owner choice] Criterion 5 by simulate**, not repair: the spike never ran a repair (SPK-04 `no-repair`), and the owner replied `ready: simulate`. Result `partial` per D-86.

**Total deviations:** 4 (2 owner decisions, 1 blocking environment fix by the owner, 1 measurement-signal change). **Impact on plan:** none of the criteria were weakened; the backfill override shortens the eligible window only.

## Issues Encountered

- **`pnpm test` under host load (bug-151 family, logged as bug-162).** First run: 10 files failed at suite level because the Dovecot test server was not running (`scripts/test-imap.sh up` fixed it) plus 2 migrate.test.ts failures. Second run with Dovecot up, host load average 108-205: 26 tests in 15 files failed with 15-60 s timeouts (plus two order/SCRAM assertions that also pass alone). Each of the 15 files rerun individually passed: 244/244. `pnpm typecheck` passed. No product code changed in this plan.

## Known Stubs

None.

## Next Phase Readiness

- ROADMAP Phase 2 criteria 3, 4 and 5 are shown on the real mailbox; criterion 5's Bridge-side trigger (a repair changing UIDVALIDITY) remains unobserved and is the open item behind the `partial` result.
- The resync stored 40,939 historical rows for INBOX mail older than the window (no bodies, not eligible); the database now mirrors the full INBOX as metadata.
- Bridge was still appending older mail during the run (S5 last_uid 51345, up from S3's 50922 in six minutes).

## Self-Check: PASSED

- FOUND: .planning/phases/02-bridge-spike-and-imap-ingest/02-LIVE-INGEST.md
- FOUND: apps/worker/test/live-ingest-record.test.ts
- FOUND: b5edfd7, 7921389
