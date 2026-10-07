---
phase: 02-bridge-spike-and-imap-ingest
plan: 21
subsystem: infra
tags: [ci, compose-smoke, mailbox_status, shell, vitest, uat-gap-closure, g-02-14]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-UAT.md gap G-02-14; worker mailbox_status writes (recordMailboxSeen, recordConnecting, recordSyncError); compose-smoke.sh and its shim test harness; 02-20 gap-closure commits to push"
provides:
  - "scripts/compose-smoke.sh no longer asks for a mailbox_status row in state ok (unreachable with the smoke's unroutable IMAP host)"
  - "A mailboxes-enabled floor of 1 and a SMOKE_TIMEOUT-bounded wait until every enabled mailbox has a connecting or error status row"
  - "Emulated-stack tests (runStack docker shim) for the pass case, the missing-row case and the absence of any ok query, with RED against the pre-fix script"
  - "A green ci run on main (37581267978, attempt 2) covering every 02-20 and 02-21 commit"
affects: [phase-02-verification, ci, compose-smoke]

actuals:
  tokens: 2600
  tasks: 3
  commits: 3
plan_head_before: 758185be8d6edcac2055f317fa80aead8fcd352d
plan_head_after: 8ec4ae80827c8a7c47759d64b513a006b5000d72

tech-stack:
  added: []
  patterns:
    - "Smoke assertions only use states reachable with the smoke's unroutable IMAP host (connecting or error, never ok)"
    - "Shell-script tests emulate a whole healthy stack with one docker shim that logs every psql SQL it receives"

key-files:
  created:
    - .planning/phases/02-bridge-spike-and-imap-ingest/02-21-SUMMARY.md
  modified:
    - scripts/compose-smoke.sh
    - apps/worker/test/compose-smoke.test.ts
    - .wolf/anatomy.md
    - .wolf/cerebrum.md
    - .wolf/buglog.json
    - .wolf/memory.md

key-decisions:
  - "The status wait counts only the state at the deadline: the worker inserts the row at its column default just before the connect to imap.smoke.invalid fails, so a briefly missing or default row is not a failure"
  - "No new environment knob: the existing SMOKE_TIMEOUT deadline bounds setup, health and the status wait together"
  - "The smoke hosts stay rewritten to imap.smoke.invalid; a smoke worker that ever reached ok would now fail the wait (T-02-80)"
  - "The attempt-1 check failure (imap-folder-source UIDVALIDITY test) was logged as bug-191 and not fixed here: it is outside 02-21's scope and passed on rerun"

patterns-established:
  - "compose-smoke.test.ts runStack(env): fake ps/inspect/compose exec answers chosen by SQL substring; SQL logged to sql.log for assertions"

requirements-completed: [ING-01]

coverage:
  - id: D1
    description: "compose-smoke.sh asserts a worker status reachable without IMAP (connecting or error per enabled mailbox, inside SMOKE_TIMEOUT) and keeps the migrations and registry checks (G-02-14)"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "SMOKE_ALLOW_VOLUME_REMOVAL=yes COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh --down -> exit 0, compose smoke OK"
        status: pass
      - kind: other
        ref: "bash -n scripts/compose-smoke.sh && shellcheck -S warning scripts/compose-smoke.sh"
        status: pass
    human_judgment: false
  - id: D2
    description: "Emulated-stack tests pin the status check: pass case, missing-row failure within SMOKE_TIMEOUT, no ok query; RED against the pre-fix script (G-02-14)"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "apps/worker/test/compose-smoke.test.ts#passes when every enabled mailbox reports connecting or error and none is ok"
        status: pass
      - kind: unit
        ref: "apps/worker/test/compose-smoke.test.ts#fails within SMOKE_TIMEOUT when an enabled mailbox has no connecting or error row"
        status: pass
      - kind: unit
        ref: "apps/worker/test/compose-smoke.test.ts#keeps the migrations and registry checks and never asks for an ok count"
        status: pass
    human_judgment: false
  - id: D3
    description: "The ci workflow passes on main for the pushed HEAD 8ec4ae8 (run 37581267978, attempt 2: check and compose-smoke success)"
    requirement: ING-01
    verification:
      - kind: other
        ref: "gh run view 37581267978 --json attempt,conclusion,headSha,jobs -> attempt 2, success, headSha 8ec4ae8, check success, compose-smoke success"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-10-07
status: complete
---

# Phase 2 Plan 21: compose-smoke status check reachable without IMAP Summary

**compose-smoke.sh no longer asks for a mailbox_status row in state ok, which no smoke worker can reach because every smoke IMAP host is imap.smoke.invalid. It now requires at least one enabled mailbox, then waits inside SMOKE_TIMEOUT until every enabled mailbox has a connecting or error status row. A real local smoke run and the ci run on main (37581267978, attempt 2) are green.**

## Performance

- **Duration:** 21 min of agent time (plus the owner's push and CI wait)
- **Started:** 2026-10-07T06:10:59Z
- **Completed:** 2026-10-07T06:32Z
- **Tasks:** 3 (1 tracer, 1 TDD test task, 1 owner checkpoint)
- **Files modified:** 6 (plus this SUMMARY)

## Accomplishments

- **Status check (Task 1, tracer).** `scripts/compose-smoke.sh` changes:
  - The Phase 1 ok-state count is gone.
  - New `atleast "mailboxes enabled" 1` check (`disabled_at is null`), so the wait cannot pass on an empty registry.
  - A loop runs one query every 2 s: enabled mailboxes with no status row in `('connecting', 'error')`. It stops at 0. At the existing deadline it fails with `mailbox status: <n> enabled mailboxes have no connecting or error status row after <timeout>s`; fail() dumps the compose logs. A failed query fails with `query failed: mailbox status`.
  - On success it logs `mailbox status connecting or error = <n>`.
  - The header comment and the Env line now describe the check and say SMOKE_TIMEOUT bounds it.
- **Real local run.** `SMOKE_ALLOW_VOLUME_REMOVAL=yes COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh --down` exited 0. Output in order: `setup exited 0`, `worker healthy`, `migrations applied = 8`, `mailboxes registered = 2`, `mailboxes enabled = 2`, `mailbox status connecting or error = 2`, `compose smoke OK`. Afterwards `sift-smoke-*` volumes: 0; `sift-pgdata`: 1. The owner's sift-bridge-1, sift-worker-1, sift-db-1 and sift-test-imap-31143 kept running.
- **Emulated-stack tests (Task 2).** `compose-smoke.test.ts` gains `runStack(env)`, a docker shim that fakes a healthy smoke stack and logs each psql SQL. The new describe block "scripts/compose-smoke.sh checks the worker status reachable without IMAP (G-02-14)" has three cases: pass, missing row within SMOKE_TIMEOUT=3 (polls more than once), and migrations and registry checks present with no SQL holding `'ok'`. The existing runSmoke shim and its 33 cases are unchanged.
- **CI on main (Task 3).** The owner pushed main (HEAD 8ec4ae8). Run 37581267978, attempt 2: conclusion success, check success, compose-smoke success. The CI compose-smoke log shows the same lines as the local run, ending `compose smoke OK`.

## Task Commits

1. **Task 1: compose-smoke status check reachable without IMAP** - `36b51e0` (fix)
2. **Task 2: emulated-stack tests, RED against 758185b** - `e84c7a3` (test)
3. **OpenWolf anatomy, cerebrum, buglog bug-190, memory** - `8ec4ae8` (chore). The owner amended the original 363e8ed before pushing, adding the tooling files .gsd/dispatch-isolation-sentinel.json, .planning/milestone.lock, .planning/state.json and .wolf/hooks/_session.json.
4. **Task 3: owner push and CI check.** No code commit.

**Plan metadata:** this SUMMARY commit (docs), then the STATE/ROADMAP/REQUIREMENTS commit.

## CI verification (Task 3)

- `gh run view 37581267978 --json attempt,conclusion,headSha,jobs`: attempt 2, status completed, conclusion success, headSha `8ec4ae80827c8a7c47759d64b513a006b5000d72` (= `git rev-parse HEAD` = origin/main).
- Jobs (attempt 2): `check` success, `compose-smoke` success.
- Attempt 1: compose-smoke success, check failure. The only failure was `apps/worker/test/imap-folder-source.test.ts:388` "reports the new UIDVALIDITY after the server changes it" (`expected 1791354308 to be 1791354309`). The owner re-ran the failed job and it passed. See deviation 4.

## TDD Gate Compliance

The plan orders implementation first (tracer) and tests second, with RED taken against the plan base:
- **RED:** the final test file with `scripts/compose-smoke.sh` from `758185b` copied in. 3 failed, 33 passed. The pass case failed on `compose-smoke: FAILED: mailboxes ok: expected >= 1, got 0`. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed). The script was restored with `git checkout`; `git diff --quiet HEAD -- scripts/compose-smoke.sh` exits 0.
- **GREEN:** 36/36 against the committed script; `pnpm lint` exit 0 (1 old warning in node-version.test.ts) and `pnpm typecheck` exit 0.
- **Commits:** the implementation is `fix(02)` (36b51e0) and comes before the `test(02-21)` commit (e84c7a3), as the plan's tracer-first order requires. No REFACTOR was needed.

## Files Created/Modified

- `scripts/compose-smoke.sh` - mailboxes-enabled floor, bounded wait for connecting/error rows, header and Env docs
- `apps/worker/test/compose-smoke.test.ts` - runStack helper, sql.log helpers, G-02-14 describe block (3 cases)
- `.wolf/anatomy.md` - curated entries for both files
- `.wolf/cerebrum.md` - three Key Learnings (reachable smoke states, local smoke beside the live stack, runStack and biome braces)
- `.wolf/buglog.json` - bug-190 (the G-02-14 CI failure) and bug-191 (the UIDVALIDITY flake)
- `.wolf/memory.md` - session line

## Decisions Made

See key-decisions in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Lint] Test shim written without shell `${...}`**
- **Found during:** Task 2
- **Issue:** Biome's `noTemplateCurlyInString` warned twice on shell parameter expansions inside TS strings.
- **Fix:** `cut -d= -f3` for the service name; the default for SHIM_STATUS_MISSING is set with `[ -n "$SHIM_STATUS_MISSING" ] || SHIM_STATUS_MISSING=0`. RED and GREEN were re-run on the final file.
- **Files modified:** apps/worker/test/compose-smoke.test.ts
- **Committed in:** e84c7a3

**2. [Process] OpenWolf auto-scan output corrected**
- **Found during:** wrap-up of Tasks 1-2
- **Issue:** The OpenWolf hook replaced the two curated anatomy entries with weaker first-comment-line text, and auto-logged a false bug-190 ("Null/undefined access") for the test file.
- **Fix:** Rewrote both anatomy entries; turned bug-190 into the real G-02-14 entry.
- **Files modified:** .wolf/anatomy.md, .wolf/buglog.json
- **Committed in:** 8ec4ae8

**3. [Convention] Task 1 commit scope is fix(02)**
- **Found during:** Task 1
- **Issue:** The GSD convention is `{type}(02-21)`. The plan's own example used `fix(02): ... (G-02-14)`.
- **Fix:** Followed the plan; later commits use `02-21`.
- **Committed in:** 36b51e0

**4. [Out of scope] Intermittent UIDVALIDITY test failed CI attempt 1**
- **Found during:** Task 3
- **Issue:** Run 37581267978 attempt 1 failed `check` on `imap-folder-source.test.ts:388` (the second EXAMINE returned the old UIDVALIDITY). This is the Dovecot suite, unrelated to 02-21; check passed on the earlier runs for c899978 and 925ce49.
- **Fix:** None in this plan. The owner re-ran the failed job and attempt 2 passed. Logged as bug-191 (tags flaky, ci, dovecot, uidvalidity). Likely cause, not confirmed: a doveadm `--uid-validity` update is not always visible to the next EXAMINE.
- **Files modified:** .wolf/buglog.json
- **Committed in:** this SUMMARY commit

---

**Total deviations:** 4 (1 lint fix, 1 tooling correction, 1 convention, 1 out-of-scope flake logged)
**Impact on plan:** None on scope. The smoke still never reaches a real mail server.

## Issues Encountered

- CI attempt 1 failed on the UIDVALIDITY flake (deviation 4); attempt 2 was green.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

- G-02-14 is closed: compose-smoke checks a status reachable without IMAP, passes locally and in CI, and the ci workflow is green on main.
- Open follow-up: bug-191, the intermittent UIDVALIDITY test in imap-folder-source.test.ts. It can fail `check` on main until it is fixed.

## Self-Check: PASSED

- Files exist: scripts/compose-smoke.sh, apps/worker/test/compose-smoke.test.ts, this SUMMARY.
- Commits 36b51e0, e84c7a3 and 8ec4ae8 are on main and origin/main.
- Acceptance greps re-run: `state = 'ok'` 0; `'connecting', 'error'` 2; migrations applied 1; mailboxes registered 1; mailboxes enabled 1; imap.smoke.invalid 2; SMOKE_STATUS 0; G-02-14 in the test file 1.
- Plan verification: compose-smoke tests 36/36, lint 0, typecheck 0, shellcheck 0, local smoke OK, ci run green (attempt 2).

---
*Phase: 02-bridge-spike-and-imap-ingest*
*Completed: 2026-10-07*
