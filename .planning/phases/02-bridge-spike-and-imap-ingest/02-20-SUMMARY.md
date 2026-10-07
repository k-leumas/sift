---
phase: 02-bridge-spike-and-imap-ingest
plan: 20
subsystem: docs
tags: [readme, proton-bridge, ntp, doc-contract-tests, d-84, uat-gap-closure]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-UAT.md gaps G-02-4, G-02-8, G-02-9; 02-SPIKE-FINDINGS.md and 02-LIVE-INGEST.md records; README and its doc test"
provides:
  - "README states that Sift supports only Proton Mail, through Proton Bridge, for now (intro and Requirements), with the owner's reasons"
  - "README Requirements bullet for an NTP-synced host clock, with the reason and macOS/Linux checks"
  - "README no longer implies other IMAP servers (TLS mode, pin, identity fallback, provider asides)"
  - "02-SPIKE-FINDINGS.md post-spike initial_backfill_days 3 with a dated correction keeping the spike-time 30"
  - "02-LIVE-INGEST.md dated correction citing the corrected value 3"
  - "Doc-contract tests: exactly one findings value line; exact (no digit after) match of the cited spike value; scope, clock and stale-phrase pins"
affects: [phase-02-verification, readme, d-84]

actuals:
  tokens: 7080
  tasks: 3
  commits: 4
plan_head_before: c899978b55dc557d0c97d6a354499fc7fa1f80f4
plan_head_after: 31d9942cd0d929a3341866692291e41452f6ee57

tech-stack:
  added: []
  patterns:
    - "Number pins in doc tests use a no-digit-after boundary (regex with (?![0-9])), not toContain"
    - "README section checks slice between headings and fail when a heading is missing"

key-files:
  created:
    - .planning/phases/02-bridge-spike-and-imap-ingest/02-20-SUMMARY.md
  modified:
    - README.md
    - apps/worker/test/user-facing-text.test.ts
    - apps/worker/test/spike-findings.test.ts
    - apps/worker/test/live-ingest-record.test.ts
    - .planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md
    - .planning/phases/02-bridge-spike-and-imap-ingest/02-LIVE-INGEST.md
    - .wolf/anatomy.md
    - .wolf/cerebrum.md

key-decisions:
  - "The README clock bullet explains the reason in plain words and leaves out the internal ids WR-03 and D-19; the README cites no internal ids anywhere"
  - "The README says an unpinned Bridge mailbox fails: Node's normal verification rejects Bridge's self-signed certificate, so the worker refuses to log in and the mailbox shows a certificate error (checked in connect.ts)"
  - "The GREEN commit of the TDD task is docs(02-20), not feat, because the change is a phase record"

patterns-established:
  - "Dated correction paragraphs keep the earlier value as history and never repeat the value-line pattern"

requirements-completed: [SPK-04, ING-01, ING-03]

coverage:
  - id: D1
    description: "README states the Proton-only scope in the intro and in Requirements, with the owner's reasons (G-02-9)"
    requirement: SPK-04
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#states the Proton-only scope in the intro and in Requirements"
        status: pass
    human_judgment: false
  - id: D2
    description: "README no longer implies mail servers other than Proton Bridge (G-02-9)"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#no longer contains %s"
        status: pass
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#keeps the active technical-settings keys valid for the strict config schema"
        status: pass
    human_judgment: false
  - id: D3
    description: "README Requirements asks for an NTP-synced host clock, with the reason and the macOS/Linux checks (G-02-8)"
    requirement: ING-03
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#asks for an NTP-synced host clock in Requirements, with the macOS and Linux checks"
        status: pass
    human_judgment: false
  - id: D4
    description: "02-SPIKE-FINDINGS.md records post-spike initial_backfill_days 3 with dated history, and 02-LIVE-INGEST.md cites it exactly (G-02-4, D-84)"
    requirement: SPK-04
    verification:
      - kind: unit
        ref: "apps/worker/test/spike-findings.test.ts#has exactly one post-spike initial_backfill_days value line, so history cannot add one"
        status: pass
      - kind: unit
        ref: "apps/worker/test/live-ingest-record.test.ts#runs with the spike initial_backfill_days or documents the owner override (D-84)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Owner config has initial_backfill_days 3 for personal, and the owner ran the 3-day CLI backfill (G-02-4)"
    requirement: ING-01
    verification:
      - kind: manual_procedural
        ref: "grep -n initial_backfill_days config/config.yaml (main checkout) -> 32:      initial_backfill_days: 3"
        status: pass
      - kind: manual_procedural
        ref: "SIFT_CONFIG=config/config.yaml node apps/worker/src/cli.ts config check --schema-only -> Config OK: 1 mailboxes (personal)"
        status: pass
    human_judgment: true
    rationale: "The backfill ran interactively on the owner's mailbox. The owner reported pass but gave no counts, so the backfill result rests on the owner's word."

duration: 29min
completed: 2026-10-07
status: complete
---

# Phase 2 Plan 20: README Proton-only scope, NTP clock requirement and corrected backfill value Summary

**The README now says Sift supports only Proton Mail through Proton Bridge for now, and requires an NTP-synced host clock with macOS/Linux checks. The D-84 records hold the owner's value 3 with dated history, checked exactly by the doc-contract tests. The owner's config is set to 3, and the owner ran the 3-day backfill.**

## Performance

- **Duration:** 29 min
- **Started:** 2026-10-07T05:25:42Z
- **Completed:** 2026-10-07T05:54:18Z
- **Tasks:** 3 (2 automated, 1 owner checkpoint)
- **Files modified:** 8 (plus this SUMMARY)

## Accomplishments

- **Scope statement (G-02-9).** README states `Sift supports only Proton Mail, through Proton Bridge, for now` in two places, each with the owner's reasons (simpler logic, smaller test surface, more security-minded):
  - a bold "Proton Mail only, for now." paragraph before the Status blockquote;
  - the first Requirements bullet.
- **Other-server wording removed (G-02-9).** These README lines no longer imply other IMAP servers:
  - the mail-app aside;
  - the identity fallback, which now states the real `X-Pm-Internal-Id` trust rule (only on a pinned mailbox, and only with exactly one header);
  - the `host`, `mode` and pin text in Technical settings;
  - the Security model TLS and pin bullets (the pin is required for Bridge, and header trust depends on it);
  - the Quick start and Add a mailbox provider qualifiers;
  - the change-a-mailbox bullet, which now says Bridge writes the IMAP passwords.
- **NTP clock requirement (G-02-8).** A new Requirements bullet, `A host clock kept in sync over NTP`, says:
  - why: Proton sets INTERNALDATE, the worker and Bridge share the host clock, Sift caps arrival times at the worker's clock and looks back only 5 minutes;
  - that macOS and most Linux systems sync by default;
  - how to check: System Settings > General > Date & Time or `sntp time.apple.com` on macOS, `timedatectl` on Linux.
- **Doc tests for the README.** user-facing-text.test.ts gains a describe block "README scope and host requirements (G-02-8, G-02-9)":
  - the scope sentence must appear in both places;
  - the clock bullet must appear with both checks;
  - 9 stale phrases must be absent (case-insensitive).
- **D-84 records (G-02-4).**
  - 02-SPIKE-FINDINGS.md: the value line reads 3, with a dated correction that keeps the spike-time 30 and the owner's reply, and names `sift mailbox backfill personal --days 3`.
  - 02-LIVE-INGEST.md: a dated correction cites the corrected value; the run-time deviation text is unchanged.
  - The tests now require exactly one value line in the findings and an exact match of the cited value, so a cited 30 no longer satisfies a findings value of 3.
- **Owner step (Task 3).** The orchestrator edited `config/config.yaml` line 32 in the main checkout at the owner's request; it now reads `initial_backfill_days: 3`. The owner ran the 3-day backfill and reported "pass". The schema default, `config/config.example.yaml` and the README default stay 30.

## Task Commits

1. **Task 1: README Proton-only scope and NTP clock, pinned by the doc test** - `a4565c4` (docs)
2. **Task 2 RED: exact cited-value check and findings value 3** - `09fcde9` (test)
3. **Task 2 GREEN: live-ingest record cites the corrected value 3** - `3ae7eef` (docs)
4. **OpenWolf anatomy and cerebrum updates** - `31d9942` (chore)
5. **Task 3: owner checkpoint.** No commit, because `config/config.yaml` is git-ignored.

**Plan metadata:** this SUMMARY commit (docs)

## Owner checkpoint (Task 3)

- **Owner reply:** "pass".
- **First attempt failed.** The first backfill attempt failed with `IMAP server unreachable at bridge:1143` because the bridge and worker containers had exited. The owner restarted them and reran the backfill.
- **Backfill counts:** not captured (owner reported pass). Found, new and already-stored counts were not given.
- **Checks the orchestrator ran (main checkout):**
  - `grep -n initial_backfill_days config/config.yaml` printed `32:      initial_backfill_days: 3`.
  - `sift mailbox list` showed `personal` as `ok`, with 103,502 messages and last sync at 2026-10-07T05:51:57Z.
  - sift-bridge-1 and sift-worker-1 were running and healthy.
- **Checks this agent ran (read-only):**
  - `config check --schema-only` on the main config printed `Config OK: 1 mailboxes (personal); env vars not checked (--schema-only)`.
  - spike-findings and live-ingest-record tests: 21/21 passed with the owner's username denylist active (2 entries). The git-ignored config was copied into the worktree for this one run and then removed.
  - The privacy scan of both phase records found nothing.
  - `git diff c899978 -- config/config.example.yaml packages/core/src/config/schema.ts` is empty.

## TDD Gate Compliance

- **RED** `09fcde9` `test(02-20)`: run with findings at 3 and the record still citing only 30. Only the live-ingest D-84 case failed, on its assertion (20 passed, 1 failed). `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed).
- **GREEN** `3ae7eef`: both files pass, 21/21. It is committed as `docs(02-20)` rather than `feat`, because the change is a phase record.
- **REFACTOR:** none needed.

## Files Created/Modified

- `README.md` - Proton-only scope (intro and Requirements), NTP clock bullet, other-server wording removed, pin required for Bridge
- `apps/worker/test/user-facing-text.test.ts` - scope, clock and stale-phrase pins
- `apps/worker/test/spike-findings.test.ts` - exactly one post-spike value line
- `apps/worker/test/live-ingest-record.test.ts` - exact (no digit after) match of the cited spike value
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md` - value 3 plus dated correction
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-LIVE-INGEST.md` - dated correction citing 3
- `.wolf/anatomy.md`, `.wolf/cerebrum.md` - entries for the changed files; how to get Vitest junit output; worktree guard quirk

## Decisions Made

See key-decisions in the frontmatter. Otherwise the plan's wording instructions were followed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Wording] Clock bullet gives the reason without internal decision ids**
- **Found during:** Task 1
- **Issue:** The plan text put "(WR-03)" and "(D-19)" next to the reason. The README cites no internal ids anywhere, and owners cannot look them up.
- **Fix:** The bullet states the same facts in plain words (cap at the worker's clock; 5-minute look-back before the newest recorded arrival time).
- **Files modified:** README.md
- **Committed in:** a4565c4

**2. [Rule 1 - Accuracy] Unpinned Bridge wording checked against connect.ts**
- **Found during:** Task 1
- **Issue:** The plan asked to confirm what happens without a pin before writing it.
- **Fix:** connect.ts applies Node's default chain and hostname verification without a pin, and that rejects Bridge's self-signed certificate (classified cert_untrusted). The README says the worker refuses to log in and the mailbox shows a certificate error.
- **Files modified:** README.md
- **Committed in:** a4565c4

**3. [Rule 3 - Blocking] Junit RED evidence needs the reporter flag**
- **Found during:** Task 2, step 3
- **Issue:** `--outputFile.junit=<scratch>` alone wrote no file, because the root vitest config has no junit reporter.
- **Fix:** Reran with `--reporter=default --reporter=junit --outputFile.junit=<scratch>/red.xml`. Recorded in cerebrum.
- **Files modified:** .wolf/cerebrum.md
- **Committed in:** 31d9942

**4. [Convention] GREEN commit type is docs, not feat**
- **Found during:** Task 2, step 4
- **Issue:** The TDD convention expects `feat` for GREEN, but GREEN here is a phase-record correction.
- **Fix:** Committed as `docs(02-20)`, after the `test(02-20)` RED commit.
- **Committed in:** 3ae7eef

**5. [Process] .wolf/memory.md not appended in the worktree**
- **Found during:** wrap-up
- **Issue:** The main checkout has uncommitted changes to `.wolf/memory.md`, so a worktree commit to it would collide on merge.
- **Fix:** Left for the orchestrator to append after the merge. anatomy.md and cerebrum.md were committed.

---

**Total deviations:** 5 (2 wording/accuracy, 1 blocking tooling fix, 2 process/convention)
**Impact on plan:** None on scope. No code paths, defaults or example config were changed.

## Issues Encountered

- The owner's first backfill attempt failed (`IMAP server unreachable at bridge:1143`) because the bridge and worker containers had exited. The owner restarted them and the backfill passed.
- The worktree's Bash isolation guard rejected commands it read as git (including the word "digit" inside an inline node script). I worked around it with plain single-git commands and the Edit tool, and recorded this in cerebrum.

## Known Stubs

None.

## User Setup Required

None. The owner's config change and backfill are done.

## Next Phase Readiness

- G-02-4, G-02-8 and G-02-9 are closed on the doc side.
- G-02-4's owner step is done, but the backfill counts were not captured.
- The orchestrator still needs to append the 02-20 entries to `.wolf/memory.md` in the main checkout.

## Self-Check: PASSED

- All modified files and this SUMMARY exist in the worktree.
- Commits a4565c4, 09fcde9, 3ae7eef and 31d9942 are on `worktree-agent-a8cb7173010bb903a`.
- Every Task 1 and Task 2 acceptance grep was re-run and passes.
- Plan verification: 101/101 doc tests, `pnpm lint` exit 0, `pnpm typecheck` exit 0.

---
*Phase: 02-bridge-spike-and-imap-ingest*
*Completed: 2026-10-07*
