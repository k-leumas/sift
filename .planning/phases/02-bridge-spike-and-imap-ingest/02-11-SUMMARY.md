---
phase: 02-bridge-spike-and-imap-ingest
plan: 11
subsystem: spike
status: complete
tags: [imap, imapflow, proton-bridge, spike, condstore, idle, labels, uidvalidity, privacy, cli]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-18 openImap/closeImap/classifyImapError (STARTTLS + SPKI pin, disableAutoEnable); 02-07 normaliseMessageId and parseHeaderBlock; 02-04 Dovecot test server and helpers (appendMessage, createFolder, messageFlags, setFlags, bumpUidValidity)"
provides:
  - "apps/worker/src/spike/probe.ts: ProbeReport, preAuthCapabilities, runProbe, waitForNew, labelTest, compareReports, parseProbeReport, encodeModifiedUtf7, spikeLabelPath, labelTestPlan, isLabelConfirmation, SPIKE_LABEL_NAME, LABEL_TEST_MAX_AGE_MS, LABEL_CONFIRMATION"
  - "CLI `sift bridge probe <slug> [--label-test] [--uid <n>] [--wait-new-seconds <n>] [--compare <file|->] [--sample <n>] [--scan-limit <n>]`"
  - "CommandIO.stdin (optional AsyncIterable), wired to process.stdin in cli.ts"
affects: [02-14, 02-19]

actuals:
  tokens: 16800
  tasks: 2
  commits: 4
plan_head_before: fa911914e82975231c9c930fffe4fbe9a9e10f9c
plan_head_after: fdf01142531840667c87e67b05a9203ca21443b7

tech-stack:
  added: []
  patterns:
    - "Raw IMAP commands through ImapFlow's internal exec(): call result.next(), read a tagged NO/BAD from err.responseStatus, record anything else as 'none'"
    - "Aggregate-only spike report: counts, capability atoms, special-use roles, UIDs, dates and sha256 hashes; folder names never reported except the spike label"
    - "Write paths gated on server evidence: expunge only the COPYUID-named copy, only after the original is re-confirmed, only with UIDPLUS"

key-files:
  created:
    - apps/worker/src/spike/probe.ts
    - apps/worker/src/commands/bridge-probe.ts
    - apps/worker/test/bridge-probe.test.ts
  modified:
    - apps/worker/src/command.ts
    - apps/worker/src/cli.ts
    - apps/worker/test/cli.test.ts

key-decisions:
  - "02-11: ENABLE CONDSTORE QRESYNC and STATUS (HIGHESTMODSEQ UIDNEXT UIDVALIDITY MESSAGES) go out raw through ImapFlow's exec(); a tagged NO or BAD is recorded from err.responseStatus, any other failure is 'none'. folderStatus and uidValidity come from client.status() without HIGHESTMODSEQ, so a gluon refusal of the raw STATUS still leaves the counts"
  - "02-11: the label test removes the label-folder copy only when COPYUID named it, the original is confirmed present after the COPY, and the server has UIDPLUS (ImapFlow falls back to a plain EXPUNGE without it, which would also remove other \\Deleted messages in the label folder). Otherwise it reports 'label copy not confirmed' with labelCopyMayRemain true and tells the owner on stderr to remove the label in the Proton client"
  - "02-11: --uid without --label-test, and --compare - together with --label-test (both read stdin), exit 2; --wait-new-seconds is capped at 3600; the earlier --compare report is read and validated before connecting, so bad input changes nothing"
  - "02-11: waitForNew stops at the first EXISTS (or the timeout), ends IDLE with a NOOP, and takes newUid as the highest UID at or above the old UIDNEXT"
  - "02-11: the report adds capabilities.greeting (the greeting's [CAPABILITY] atoms) next to preAuth (the pre-login CAPABILITY reply), because RESEARCH found they differ on Bridge; pre-auth capabilities are skipped (empty) for implicit-TLS mailboxes, which have no plaintext phase"

patterns-established:
  - "Patch a live ImapFlow client's exec() in tests to inject tagged NO/BAD for chosen commands while the rest still reach Dovecot"
  - "Commands that read stdin take it from CommandIO.stdin; tests pass Readable.from([text])"

requirements-completed: [SPK-01, SPK-02, SPK-03, SPK-04]

coverage:
  - id: D1
    description: "`sift bridge probe <slug>` prints one aggregate-only JSON report from the real test server through the worker's STARTTLS + pin path: capabilities (upper-cased), CONDSTORE/QRESYNC positive control, folder counts and special-use roles, folderStatus, UIDVALIDITY, identity statistics and a hashed sample"
    requirement: SPK-02
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#reports capabilities, folders, identity statistics and a sample, privately"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#reports the spike label UIDVALIDITY when the label exists, and no other folder"
        status: pass
    human_judgment: false
  - id: D2
    description: "No subject, sender, recipient, body, email address, raw Message-ID, internal ID or personal folder name reaches stdout or stderr (sentinel and address-pattern scan), and the password never appears in errors"
    requirement: SPK-03
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#reports capabilities, folders, identity statistics and a sample, privately"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#a rejected login exits 1 with the error class and never the password"
        status: pass
    human_judgment: false
  - id: D3
    description: "Bounded scans and edges: --scan-limit 0..10000 and --sample 0..200 (out of range exits 2), 0/0 skips the header scan, an empty mailbox gives zero counts; NO, BAD and no answer to ENABLE/STATUS are recorded, never thrown"
    requirement: SPK-02
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#--scan-limit 0 --sample 0 skips the header scan"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#an empty mailbox gives zero counts and no error (SPK-01 empty edge)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#records BAD, NO and no answer instead of throwing"
        status: pass
    human_judgment: false
  - id: D4
    description: "--label-test --uid <u> with typed LABEL copies only that UID into Labels/Sift Spike, compares raw Message-ID and X-Pm-Internal-Id bytes, removes the copy from the label folder only and leaves INBOX flags and count unchanged; unconfirmed, missing --uid, too-old and missing targets write nothing; without COPYUID nothing is expunged"
    requirement: SPK-01
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#sift bridge probe --label-test (SPK-01, D-11)"
        status: pass
    human_judgment: false
  - id: D5
    description: "--wait-new-seconds IDLEs and reports existsEventSeen, newMessageArrived and idle.newUid; --compare <file|-> reports UIDVALIDITY changes, added/missing folders and sample UID/INTERNALDATE changes; unparseable input exits 1 naming only the source"
    requirement: SPK-04
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#sift bridge probe --wait-new-seconds (D-27, D-43)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-probe.test.ts#report comparison (SPK-04, D-43)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Behaviour against the owner's real Proton Bridge mailbox (gluon's actual answers, label semantics, IDLE delivery, UIDVALIDITY across restart/repair)"
    verification: []
    human_judgment: true
    rationale: "Deliberately not run here; it is the human checkpoint of plan 02-14 on the owner's real account"

duration: 18min
completed: 2026-10-05
---

# Phase 2 Plan 11: Bridge Spike Probe Summary

**`sift bridge probe <slug>`: one rerunnable command that reports Bridge's IMAP behaviour as aggregates only. It covers capabilities and raw ENABLE/STATUS answers, label-folder counts, Message-ID and internal-ID statistics, a hashed sample, IDLE new-mail detection and report-to-report UIDVALIDITY comparison. A label test is gated by an explicit UID, a typed LABEL, a one-hour age limit and COPYUID evidence.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-10-05T20:13:44Z
- **Completed:** 2026-10-05T20:32:00Z
- **Tasks:** 2 (tracer + TDD)
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- The read-only probe connects with the worker's own `openImap` (STARTTLS, SPKI pin, `disableAutoEnable: true`). Before login it reads the greeting and one plaintext CAPABILITY over `node:net`, sending only CAPABILITY and LOGOUT. It then sends ENABLE CONDSTORE QRESYNC and a raw STATUS with HIGHESTMODSEQ and records their tagged status, and it summarises LIST without folder names. It EXAMINEs the folder and reads four header fields of at most max(scan-limit, sample) newest messages.
- Identity statistics: internal ID present or absent, Message-ID absent, `@protonmail.internalid` IDs, duplicate Message-IDs with distinct internal IDs, Message-ID different from X-Pm-External-Id, and Date versus INTERNALDATE skew (p50 and p95). The sample holds (uid, INTERNALDATE, sha256 of the internal ID).
- The label test is bounded and typed-confirmed. It needs an explicit `--uid`, refuses targets older than one hour, and copies one UID into `Labels/Sift Spike`. It compares the raw header bytes of both copies. It expunges only the COPYUID-named copy, only after the original is re-confirmed and only with UIDPLUS; otherwise it leaves the copy and tells the owner.
- `--wait-new-seconds` IDLE observation reports idle.newUid, which 02-14 passes to `--label-test --uid`. `--compare <file|->` compares two reports for SPK-04 and D-43.
- The Dovecot test server is the positive control: it advertises CONDSTORE and QRESYNC, and ENABLE and STATUS answer OK.

## Task Commits

1. **Task 1: Tracer, a read-only probe report through the CLI** - `8364fe8` (feat)
2. **Task 2 RED: label test, IDLE wait and compare cases** - `ed9b8e5` (test)
3. **Task 2 GREEN: bounded label test, IDLE wait, report comparison** - `9e0168e` (feat)
4. **Task 2 REFACTOR: shared fail-closed EXAMINE and INTERNALDATE helpers** - `fdf0114` (refactor)

All commits are on `main` (branching_strategy none, sequential executor), as intended for this phase.

## TDD Gate Compliance

- **RED (`ed9b8e5`):** `pnpm vitest run apps/worker/test/bridge-probe.test.ts` exited 1. 15 of 33 tests failed on assertions: missing labelTest, idle and compare report fields, exit 0 instead of 2 for the new flag rules, and wrong values from the scaffolding. The working tree had value-returning scaffolding for the new exports, which was never committed. `gsd-tools check tdd-red-evidence` gave `RED_EVIDENCE_OK` (target_test_failed, fail 15). The tracer's 18 cases passed, which is expected.
- **GREEN (`9e0168e`):** all 33 probe tests pass.
- **REFACTOR (`fdf0114`):** runProbe, labelTest and waitForNew share `examine()`, which refuses a read-write EXAMINE grant, and `internalDateOf()`. Tests still pass.

## Files Created/Modified

- `apps/worker/src/spike/probe.ts` - probe library: report type, pre-auth capabilities, runProbe, labelTest, waitForNew, compareReports, parseProbeReport, modified UTF-7 encoder
- `apps/worker/src/commands/bridge-probe.ts` - `sift bridge probe` command: flag parsing and bounds, config and password_env, connect, the probe, wait, label test, compare and the redacted error class
- `apps/worker/test/bridge-probe.test.ts` - 33 tests against Dovecot, including the privacy sentinel scan
- `apps/worker/src/command.ts` - COMMANDS entry; `CommandIO.stdin`
- `apps/worker/src/cli.ts` - passes `process.stdin`
- `apps/worker/test/cli.test.ts` - help lists the probe usage

## Decisions Made

See key-decisions in the frontmatter. In short:
- Raw ENABLE and STATUS go through `exec()` and their statuses are recorded.
- Counts come from `status()` without HIGHESTMODSEQ.
- The UIDPLUS requirement is added to the removal gate.
- Stdin conflicts and `--uid` without `--label-test` are usage errors.
- The wait stops at the first EXISTS.
- `capabilities.greeting` is added to the report.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] CommandIO had no stdin**
- **Found during:** Task 2
- **Issue:** The typed LABEL confirmation and `--compare -` need stdin, and CommandIO had none.
- **Fix:** Added optional `stdin?: AsyncIterable<string | Buffer>` to CommandIO and passed `process.stdin` in cli.ts. cli.ts was not in files_modified.
- **Files modified:** apps/worker/src/command.ts, apps/worker/src/cli.ts
- **Commit:** 9e0168e

**2. [Rule 2 - Missing critical] UIDPLUS added to the expunge gate**
- **Found during:** Task 2
- **Issue:** Without UIDPLUS, ImapFlow's messageDelete sends a plain EXPUNGE, which would also remove any other \Deleted message in the label folder.
- **Fix:** labelTest removes the copy only when the server advertises UIDPLUS, besides COPYUID and the original still being present. It also checks that the label folder opened read-write.
- **Files modified:** apps/worker/src/spike/probe.ts
- **Commit:** 9e0168e

**3. [Rule 2 - Missing critical] Stdin and flag conflicts are usage errors**
- **Found during:** Task 2
- **Issue:** `--compare -` together with `--label-test` would consume the confirmation line as report text. `--uid` alone would be silently ignored.
- **Fix:** Both exit 2 with the usage, and tests cover them. `--wait-new-seconds` is capped at 3600 so a typo cannot hold IDLE for days.
- **Files modified:** apps/worker/src/commands/bridge-probe.ts
- **Commit:** 9e0168e

**4. [Rule 2 - Missing critical] Report extensions for clarity**
- **Found during:** Tasks 1 and 2
- **Issue:** The interface had no place for the greeting's capability code, which RESEARCH found differs from the pre-auth CAPABILITY reply on Bridge. It also could not say that a label copy may remain.
- **Fix:** Added `capabilities.greeting` and `labelTest.labelCopyMayRemain`. Both are additive; every specified field is unchanged.
- **Files modified:** apps/worker/src/spike/probe.ts
- **Commit:** 8364fe8, 9e0168e

**5. [Rule 2 - Missing critical] Modified UTF-7 for the raw STATUS folder name**
- **Found during:** Task 1
- **Issue:** The raw STATUS is sent outside ImapFlow's own path encoding, so a non-ASCII configured folder would have been sent unencoded.
- **Fix:** Added `encodeModifiedUtf7` (RFC 3501 5.1.3) with a unit test. The name is sent as a quoted string.
- **Files modified:** apps/worker/src/spike/probe.ts
- **Commit:** 8364fe8

---

**Total deviations:** 5 auto-fixed (1 blocking, 4 missing critical). **Impact:** all tighten safety or privacy, or were needed for the specified stdin behaviour. No scope creep.

## Issues Encountered

- The first RED evidence record returned INVALID_RED (fixture_or_load_failure) for two reasons. Throw-only scaffolding made the failures look like load errors, and a `targetFile` equal to the Vitest junit class name triggered the same verdict. Value-returning scaffolding and no `targetFile` gave RED_EVIDENCE_OK. This is recorded in cerebrum.
- The full suite passed on the first run (40 files, 739 tests), so the intermittent failure mentioned by the orchestrator did not appear.

## Known Stubs

None.

## Threat Flags

None. The only new write path is the label test that the plan modelled (T-02-39, T-02-68). The plaintext pre-auth socket sends only CAPABILITY and LOGOUT, as the plan specified.

## User Setup Required

None. The live run against the owner's Proton Bridge is plan 02-14's human checkpoint and was not run here.

## Next Phase Readiness

The probe is ready for 02-14. Run the wait first (`--wait-new-seconds N --scan-limit 0 --sample 0`), read idle.newUid, and pass it to `--label-test --uid <n>`. Save one report, restart or repair Bridge, and rerun with `--compare <saved>`.

## Self-Check: PASSED

- FOUND: apps/worker/src/spike/probe.ts, apps/worker/src/commands/bridge-probe.ts, apps/worker/test/bridge-probe.test.ts
- FOUND commits: 8364fe8, ed9b8e5, 9e0168e, fdf0114
- Acceptance: help lists `sift bridge probe <slug>` once and no purge; `disableAutoEnable: true`, `SPIKE_LABEL_NAME = 'Sift Spike'`, `'LABEL'` and `LABEL_TEST_MAX_AGE_MS = 3_600_000` match. `pnpm vitest run` of bridge-probe, cli and imap-connect passes; `pnpm lint` exits 0 (1 existing warning in node-version.test.ts); `pnpm typecheck` exits 0; `pnpm test` passes 739/739.
