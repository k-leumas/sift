---
phase: 03-tiered-classification-with-traces
plan: 11
subsystem: cli
tags: [rules-yaml, config-check, mailbox-rename, compose, docker, read-only-mount]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-01 @sift/core/rules: loadRules, resolveDataPath (SIFT_DATA), rulesPathFor"
provides:
  - "sift config check (full mode) validates every mailbox's data/mailboxes/<slug>/rules.yaml with positioned problems (D-05)"
  - "sift mailbox rename refuses before any database call until <data>/mailboxes/<new>/rules.yaml exists (D-07)"
  - "compose: worker and setup mount ${SIFT_DATA_HOST_DIR:-./data}:/data:ro with SIFT_DATA=/data"
  - "compose-smoke: its own .smoke/<project>/data, exported as SIFT_DATA_HOST_DIR"
affects: [03-09, 03-12, 03-13, worker, readme, compose-smoke]

actuals:
  tokens: 7300
  tasks: 3
  commits: 5
plan_head_before: bfbd3977813cc898efbdc9c104ca7aa75c00f994
plan_head_after: ef5bbadc7672b27ae3490551606f30bb87a77981

tech-stack:
  added: []
  patterns:
    - "Owner-file preconditions are checked before any database call, and Sift only checks: it never creates, moves or edits a file under the data directory"
    - "Owner data mounts are read-only; SIFT_<X>_HOST_DIR overrides exist only for compose-smoke"

key-files:
  created:
    - apps/worker/test/config-check-rules.test.ts
    - apps/worker/test/mailbox-rename-guard.test.ts
  modified:
    - apps/worker/src/commands/config-check.ts
    - apps/worker/src/commands/mailbox-rename.ts
    - compose.yaml
    - scripts/compose-smoke.sh
    - packages/core/test/env.test.ts
    - packages/db/test/registry.test.ts
    - apps/worker/test/compose.test.ts
    - apps/worker/test/compose-smoke.test.ts

key-decisions:
  - "The rules check runs only after the password-env check passes; a missing password stops config check before any rules file is read"
  - "config check reads every mailbox's rules file before returning 1, so all problems in all files show in one run"
  - "The rename guard skips invalid new slugs so renameMailbox keeps reporting them (no TypeError from rulesPathFor)"
  - "setup also gets the read-only data mount, because sift mailbox rename runs in the setup service and needs to see the moved rules file"

patterns-established:
  - "Tests that spawn the full config check or a CLI rename pass SIFT_DATA pointing at a temp dir with rules files"

requirements-completed: [CLS-01]

coverage:
  - id: D1
    description: "sift config check prints every rules.yaml problem as file:line:col path: message and exits 1; all-valid prints '...; password env vars present; rules files valid'"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "apps/worker/test/config-check-rules.test.ts"
        status: pass
      - kind: integration
        ref: "packages/core/test/env.test.ts#exits 0 when the variables are present, never printing their values"
        status: pass
    human_judgment: false
  - id: D2
    description: "--schema-only and setup read no rules files (no data directory needed)"
    verification:
      - kind: unit
        ref: "apps/worker/test/config-check-rules.test.ts#--schema-only reads no rules files and keeps its line (no data directory at all)"
        status: pass
      - kind: other
        ref: "git diff bfbd397..HEAD -- apps/worker/src/commands/setup.ts (empty)"
        status: pass
    human_judgment: false
  - id: D3
    description: "sift mailbox rename refuses before any DB call until the new rules file exists, then renames as before (same id)"
    verification:
      - kind: integration
        ref: "apps/worker/test/mailbox-rename-guard.test.ts"
        status: pass
      - kind: integration
        ref: "packages/db/test/registry.test.ts#registry CLI (config apply, mailbox list, mailbox rename)"
        status: pass
    human_judgment: false
  - id: D4
    description: "worker and setup mount the data dir read-only at /data with SIFT_DATA=/data; compose-smoke uses its own data dir"
    verification:
      - kind: unit
        ref: "apps/worker/test/compose.test.ts#mounts the data directory read-only at /data and points SIFT_DATA at it"
        status: pass
      - kind: unit
        ref: "apps/worker/test/compose-smoke.test.ts#never reads or rewrites the owner .env, .env.mailboxes or config.yaml"
        status: pass
      - kind: other
        ref: "docker compose --env-file /dev/null config (dummy vars): setup and worker /data read_only: true"
        status: pass
    human_judgment: false
  - id: D5
    description: "The real Docker stack reads rules files through the mount (worker on the owner's machine, compose-smoke on Linux CI)"
    verification: []
    human_judgment: true
    rationale: "No real compose-smoke run or live stack was started in this plan; the mount was verified by parsing compose.yaml and docker compose config only"

duration: 25min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 11: Rules File Edges (config check, rename guard, data mount) Summary

**`sift config check` now validates every mailbox's `data/mailboxes/<slug>/rules.yaml` and prints each problem with its position. `sift mailbox rename` refuses, before touching the database, until the owner has moved the rules folder. The worker and setup containers mount the data directory read-only at `/data` (`SIFT_DATA=/data`).**

## Performance

- **Duration:** 25 min
- **Started:** 2026-10-10T20:48:52Z
- **Completed:** 2026-10-10T21:14:30Z
- **Tasks:** 3 (1 tracer, 2 TDD)
- **Files modified:** 10

## Accomplishments

- Full `sift config check` (D-05): after the password-env check passes, it resolves the data dir (`SIFT_DATA`, default `./data`) and calls `loadRules` for every configured mailbox. Each problem goes to stderr as `<file>:<line>:<col> <path>: <message>`, with the file shown relative to the working directory. It checks every mailbox before exiting 1. When all files are valid it prints `Config OK: N mailboxes (...); password env vars present; rules files valid`. `--schema-only` and `sift setup` read no rules files, so a bad rules.yaml cannot stop setup or the stack.
- `sift mailbox rename <old> <new>` (D-07): when the new slug is valid and `<data>/mailboxes/<new>/rules.yaml` is missing, it prints `... does not exist. Move the mailbox's rules folder first (data/mailboxes/<old> to data/mailboxes/<new>); Sift never moves your files. Then run this again.` and exits 1 before the database URL is even read. Once the file exists, the rename works as before. An invalid new slug still gets renameMailbox's own message.
- Compose: worker and setup have `${SIFT_DATA_HOST_DIR:-./data}:/data:ro` and `SIFT_DATA: /data`. The header comment explains the mount, that `SIFT_DATA_HOST_DIR` is smoke-only, and that Linux owners should `mkdir -p data/mailboxes/<slug>` before the first `up` so Docker does not create the directory as root. `compose.test.ts` pins the exact volume lists, the env var, and that no service mounts the owner's data dir writable (T-03-41).
- compose-smoke creates `.smoke/<project>/data/mailboxes` (umask 022) and exports `SIFT_DATA_HOST_DIR=$smoke_dir/data`, so the smoke stack never mounts the owner's `./data`.

## Task Commits

1. **Task 1 (tracer): config check reads each mailbox's rules.yaml**: `f9a246a` (feat). Tracer gate: the verify was re-run end to end after the commit and passed (27/27, typecheck 0) before expanding.
2. **Task 2 (TDD): rename refuses until the new rules folder exists**: RED `e3c8ea0` (test), GREEN `79bb18b` (feat)
3. **Task 3 (TDD): read-only data mount and compose-smoke data dir**: RED `06cfaf2` (test), GREEN `ef5bbad` (feat)

No refactor commits were needed.

## TDD Gate Compliance

- **Task 2 RED** `e3c8ea0`: target `sift mailbox rename refuses until the new rules file exists (D-07) > refuses before any database call, naming the missing file and the folder to move`, run alone with `-t` and the Vitest JUnit reporter. `gsd check tdd-red-evidence` gave `RED_EVIDENCE_OK` (target_test_failed). Semantic assessment: the target ran and failed on the planned assertion. stderr was `sift mailbox rename: connect ECONNREFUSED 127.0.0.1:1` instead of the refusal line, which shows the rename reached the database. The other two tests were skipped by `-t`. No load, syntax or fixture faults.
- **Task 2 GREEN** `79bb18b`: 3/3 guard tests and the registry tests pass (23/23).
- **Task 3 RED** `06cfaf2`: target `ordering and lifecycle (D-27, D-53, D-54, D-60) > mounts the data directory read-only at /data and points SIFT_DATA at it`, run with JUnit and `-t`. Verdict `RED_EVIDENCE_OK`. Semantic assessment: it failed on the planned assertion (`setup data mount: expected [] to deeply equal [ Array(1) ]`, no `/data` mount yet). In the full RED run, the exact-volume-list test and the compose-smoke exportedEnv test also failed on assertions. The T-03-41 test passed in RED, which is expected: with no data mount there is nothing writable to find.
- **Task 3 GREEN** `ef5bbad`: 73/73 compose and compose-smoke tests pass.
- The evidence records and JUnit reports were kept in the project dir only while the classifier ran, then deleted. They contain temp paths and were not committed.

## Decisions Made

- Rules files are checked only after the password check passes. The plan said "after the password check", and keeping the existing early return means one config problem does not bury the owner in rules errors.
- setup gets the read-only data mount as well as the worker. `sift mailbox rename` runs in the setup service (README: `docker compose run --rm setup sift mailbox rename ...`), so the guard has to see the owner's moved file there. Setup itself still never reads rules files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Registry CLI rename tests needed a data directory**
- **Found during:** Task 2
- **Issue:** `packages/db/test/registry.test.ts` (in Task 2's verify, but not in the plan's files list) spawns `sift mailbox rename jobs job-search` and `nope home` from the repo root with no SIFT_DATA. The new guard would refuse both before reaching the database results those tests expect.
- **Fix:** the describe's `beforeAll` creates `<tmp>/data/mailboxes/{job-search,home}/rules.yaml`, and every spawned call gets `SIFT_DATA` pointing there. The tests also stop depending on the owner's real `./data`.
- **Files modified:** packages/db/test/registry.test.ts
- **Verification:** registry.test.ts passes (20 tests, with the guard test 23/23)
- **Committed in:** `79bb18b`

**2. [Rule 2 - Missing critical] WORKER_ENV_ALLOWED gains SIFT_DATA**
- **Found during:** Task 3
- **Issue:** compose.test.ts allow-lists the worker's environment keys, so the new `SIFT_DATA` had to be added to the allow-list.
- **Fix:** added `SIFT_DATA` to `WORKER_ENV_ALLOWED`. Nothing secret is involved.
- **Committed in:** `06cfaf2`

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 2). **Impact:** test-only changes needed for the planned behaviour. No scope creep.

## Verification

- Plan verify: `pnpm vitest run` over config-check-rules, mailbox-rename-guard, compose, compose-smoke, env, example-config and registry tests: 7 files, 123 tests passed
- `pnpm typecheck`: exit 0
- `pnpm lint`: no errors (1 pre-existing warning in `apps/worker/test/node-version.test.ts`, out of scope)
- Full `pnpm vitest run`: 1461/1465 passed under full parallel load. The 4 failures were Dovecot-backed IMAP tests in files this plan did not touch (bridge-probe, imap-folder-source, imap-pin). Rerun with `--no-file-parallelism`, they pass 64/64 (bug-214 load timeouts).
- `docker compose --env-file /dev/null config` with dummy vars renders `/data` on setup and worker with `read_only: true`
- Acceptance greps: `loadRules` and `rules files valid` in config-check.ts; `rulesPathFor` and `never moves your files` in mailbox-rename.ts; `grep -c '/data:ro' compose.yaml` = 2; `grep -c 'SIFT_DATA: /data' compose.yaml` = 2; `SIFT_DATA_HOST_DIR` in compose-smoke.sh; setup.ts unchanged

## Issues Encountered

- Vitest `tap-flat` RED output was malformed because the target's own diff is multi-line, so `-t` alone did not help (cerebrum Do-Not-Repeat). Switching to the JUnit reporter, with the target named `<describe> > <it>`, gave a valid record (bug-222).

## Threat Flags

None. No new network endpoint or auth path was added. The new file access is a read-only existence check and read-only rules reads under `SIFT_DATA`, both covered by T-03-41 and T-03-42.

## User Setup Required

None for this plan. Owners need `data/mailboxes/<slug>/rules.yaml` for the full `sift config check` to pass. 03-13 documents that in the README, including the rename folder move.

## Next Phase Readiness

- The worker container can read rules files at `/data` (03-09 reads `SIFT_DATA` through `resolveDataPath`).
- 03-13 must update the README: the quick start creates the rules file, and "Rename a mailbox" says to move `data/mailboxes/<old>` to `data/mailboxes/<new>` first. Linux owners should create `data/` before the first `up`.
- A real compose-smoke run and the owner's live stack were not exercised here (coverage D5).

## Self-Check: PASSED

- Created files exist: apps/worker/test/config-check-rules.test.ts, apps/worker/test/mailbox-rename-guard.test.ts
- Commits f9a246a, e3c8ea0, 79bb18b, 06cfaf2, ef5bbad are ancestors of HEAD; `git rev-list --count bfbd397..ef5bbad` = 5

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*
