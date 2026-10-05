---
phase: 02-bridge-spike-and-imap-ingest
plan: 08
subsystem: infra
tags: [proton-bridge, grpc, go, docker, env-file, bind-mount, tls-pin, telemetry]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-01 Bridge image (entrypoint serve/keychain-init, spki_fingerprint), bridge-init Compose service with the four D-79/D-81 mounts, scripts/bridge-smoke.sh"
provides:
  - "sift-helper (Go, built inside Bridge's module as cmd/sift-helper): configure and repair over Bridge's gRPC frontend"
  - "envfile.go: UpsertEnv, WriteInPlace, BackupInPlace, WriteMailboxPasswords, PlanMailboxPasswords"
  - "bridge/entrypoint.sh modes init, configure, cli, repair; exit codes 1/2/3/4"
  - "configure output: telemetry/update read-back, account count and address mode, the `pin_sha256: <fingerprint>` paste line"
  - "bridge-smoke covers configure, repair, lock refusal, env-file refusals, no-TTY init/cli and a sentinel check"
affects: [02-14 live spike, 02-15 bridge-image CI, 02-17 README quick start, 02-19 owner-mailbox run]

actuals:
  tokens: 15800
  tasks: 2
  commits: 3
plan_head_before: 0a28765a2f2d56752152d880eadb63fc98f7c025
plan_head_after: 1c13da277abe3b21af466b94f2773a406e86cddd

tech-stack:
  added: [gopkg.in/yaml.v3 v3.0.1 (already in Bridge's go.mod/go.sum, checksum-verified download), Bridge internal/frontend/grpc client]
  patterns:
    - "Go helper compiled inside the pinned Bridge tree, tests run in every image build"
    - "Bind-mounted host files written in place only: open O_WRONLY|O_TRUNC on an existing regular file, write, fsync; backup chmod 0600, written, re-read and compared before the primary is opened"
    - "Bridge single-instance lock probed with `flock -n` as uid 1000 before any one-shot mode"
    - "Smoke scripts capture `docker logs` into a variable before matching (no `| grep -q` under pipefail)"

key-files:
  created:
    - bridge/helper/main.go
    - bridge/helper/envfile.go
    - bridge/helper/envfile_test.go
  modified:
    - bridge/Dockerfile
    - bridge/entrypoint.sh
    - scripts/bridge-smoke.sh
    - apps/worker/test/bridge-image.test.ts

key-decisions:
  - "02-08: sift-helper reads Bridge's gRPC server config with Bridge's own service.Config loader from /data/config/protonmail/bridge-v3/grpcServerConfig.json and sends the token as `server-token` metadata; the entrypoint deletes a stale config file before each start"
  - "02-08: only CONNECTED Bridge accounts give a password; a signed-out or locked account (no password, primary address only) produces a per-mailbox skip line instead of an empty value"
  - "02-08: an invalid password_env name or two mailboxes sharing a name with different passwords exits 1 with nothing written (neither backup nor env file)"
  - "02-08: configure continues when the STARTTLS fingerprint is unavailable (message on stderr); the worker fails closed without a pin and `sift bridge trust` gives the second reading"
  - "02-08: Bridge's own stdout/stderr is discarded in configure and repair so the owner sees only Sift's fixed lines; Bridge's log files in the volume remain"
  - "02-08: init tells the owner not to type `info` in the Bridge CLI, since that would show the IMAP password"

patterns-established:
  - "Mailbox-to-account matching and all file writing live in envfile.go, so Go unit tests cover them without a gRPC server"
  - "RED evidence for Go tests: `go test -json` converted to JUnit (name attribute before classname) for `gsd-tools check tdd-red-evidence`"

requirements-completed: [ING-01]

coverage:
  - id: D1
    description: "sift-helper is compiled and its Go tests run inside every image build; a Bridge gRPC API change fails the build"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#sift-helper is built and tested inside the image (D-39)"
        status: pass
      - kind: integration
        ref: "docker build -t sift-bridge:local bridge (RUN go test ./cmd/sift-helper/... -> ok)"
        status: pass
    human_judgment: false
  - id: D2
    description: "configure on a keychain-initialised volume without login: telemetry and automatic updates off (read back), accounts: 0, the pin_sha256 line equal to the served fingerprint, exit 3, env file unchanged, sentinel never printed"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "scripts/bridge-smoke.sh#configure turned telemetry and updates off, printed the pin (exit 3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "In-place env upsert with a verified 0600 backup: inode and mode kept, part-way failure leaves the backup intact and names the restore command, backup verify failure never opens the primary, missing/directory backup exits 2 with the touch hint"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "bridge/helper/envfile_test.go#TestUpsertEnv, TestUpsertEnvRejectsBadNamesAndValues, TestWriteInPlace, TestBackupInPlace, TestWriteMailboxPasswords, TestWriteMailboxPasswordsPartWayFailure, TestBackupVerifyFailureNeverOpensPrimary"
        status: pass
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#sift-helper writes the bind-mounted files in place only (D-81)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Mailbox matching by imap.username against Bridge addresses (case-insensitive), skip lines name only the slug"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "bridge/helper/envfile_test.go#TestPlanMailboxPasswords"
        status: pass
    human_judgment: false
  - id: D5
    description: "Entrypoint refusals: env file not mounted (bridge-init hint), directory (create-first), init and cli without a TTY (exit 2), a running Bridge on the volume (exit 1)"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "scripts/bridge-smoke.sh#missing or directory env file and no-TTY init and cli refused (exit 2); repair refused while the serve container holds the lock (exit 1)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#bridge/entrypoint.sh one-shot modes (D-39, D-43, D-73, D-79)"
        status: pass
    human_judgment: false
  - id: D6
    description: "repair triggers Bridge's repair over gRPC without a TTY and exits 0"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "scripts/bridge-smoke.sh#repair triggered over gRPC (exit 0)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Real Proton login through init, IMAP password written into the owner's bind-mounted .env.mailboxes with host inode/owner/mode kept, address-mode output for a real account, cache rebuild after repair"
    requirement: ING-01
    human_judgment: true
    rationale: "Needs the owner's Proton credentials; runs in the live-spike plans 02-14 and 02-19. The interactive init path itself (TTY, Bridge CLI, exit, configure) was driven through a pseudo-terminal without a login and ended with exit 3 as expected."

duration: 23min
completed: 2026-10-05
status: complete
---

# Phase 2 Plan 08: Bridge Init over gRPC Summary

**A Go helper built inside Bridge's own module talks to Bridge's gRPC frontend. It switches telemetry and automatic updates off and reads both back, prints the SPKI pin line, and writes each matching mailbox's IMAP password into the bind-mounted `.env.mailboxes`. The write is in place, after a verified 0600 backup. The whole flow is `docker compose run --rm bridge-init`.**

## Performance

- **Duration:** about 23 min
- **Started:** 2026-10-05T18:51:21Z
- **Completed:** 2026-10-05T19:14:48Z
- **Tasks:** 2
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- `bridge/helper/main.go` (`sift-helper`):
  - `configure` connects the way Bridge's GUI does: unix socket, TLS rooted in the config's own certificate, ServerName 127.0.0.1, and the `server-token` metadata.
  - It calls `SetIsTelemetryDisabled(true)` and `SetIsAutomaticUpdateOn(false)`, reads both back and prints `telemetry: off` / `automatic updates: off`. It fails if Bridge did not apply either setting.
  - It prints `accounts: <n>` and, per account, the address count, address mode and state, never the addresses. With no account it exits 3.
  - It then parses config.yaml leniently (slug, imap.username, imap.password_env) and writes the passwords. It calls `Quit` at the end.
  - `repair` calls `TriggerRepair`, prints `repair triggered`, waits 30 s and quits.
  - Errors name the step and the gRPC status code, never a value. `ExportTLSCertificates` is never used.
- `bridge/helper/envfile.go`:
  - `UpsertEnv`: replace in place, drop later duplicates, append new names, keep comments and CRLF. Names must match `^[A-Z_][A-Z0-9_]*$` and values must not contain CR, LF or NUL. Errors name the variable only.
  - `WriteInPlace`: an existing regular file only. It opens with `O_WRONLY|O_TRUNC`, writes through the `writeAll` hook and fsyncs.
  - `BackupInPlace`: chmod 0600, write, re-read and compare.
  - `WriteMailboxPasswords`: no backup, no write. A part-way failure names `cp .env.mailboxes.bak .env.mailboxes`.
  - `PlanMailboxPasswords`: case-insensitive address matching, with skip lines that name only the slug.
- `bridge/Dockerfile`: copies `helper/*.go` to `/src/cmd/sift-helper/` after `make build-nogui`, runs `go test ./cmd/sift-helper/...`, builds the helper, and ships it as `/usr/local/bin/sift-helper`.
- `bridge/entrypoint.sh` adds four modes:
  - `init`: TTY required. It runs keychain-init, then Bridge's own CLI for `login`, then configure.
  - `configure`: starts `bridge --grpc` in the background and waits up to 90 s for its config. It prints the fingerprint and the `pin_sha256:` paste line, runs the helper as root, then waits up to 30 s for Bridge to exit.
  - `cli`: TTY required.
  - `repair`.
  - Every one-shot mode first checks Bridge's single-instance lock with `flock -n` and refuses while the bridge service runs.
- `scripts/bridge-smoke.sh` ended with `bridge smoke OK`. New checks:
  - the lock refusal next to a running serve container
  - configure with no account: exit 3, telemetry and updates off, the pin equal to the served fingerprint, env file unchanged, sentinel never printed
  - the refusals with no env-file mount and with a directory mount
  - init and cli without a TTY
  - repair: exit 0
- Extra check outside the smoke: `init` was driven through a pseudo-terminal (`script` plus typing `exit`). The flow ran keychain, Bridge CLI banner, exit, fingerprint and pin line, telemetry and updates off, `accounts: 0`, and ended with exit 3.

## Task Commits

1. **Task 1: Tracer - configure over gRPC, telemetry/updates off, fingerprint, repair** - `d7ed467` (feat)
2. **Task 2 RED: failing env-file writer and matching tests** - `4442994` (test)
3. **Task 2 GREEN: in-place upsert with verified backup, init and cli modes** - `1c13da2` (feat)

Tracer feedback gate: interactive run, `end-of-phase` mode, verify is automated only. `bridge-image.test.ts` and `scripts/bridge-smoke.sh` were re-run on the committed tracer and both passed, so execution moved on to Task 2.

## TDD Gate Compliance

- RED `4442994`: `envfile_test.go` plus a compile-only stub `envfile.go`. Signatures and hooks are in place and every function returns "not implemented". All 8 tests failed on assertions, with no panics and no build errors. The evidence came from `go test -json` in the pinned Bridge tree, converted to JUnit. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` with target `TestUpsertEnv`. The image build fails at this commit by design, because `go test` runs in the build.
- GREEN `1c13da2`: all Go tests pass on the host and inside `docker build` (as root). No refactor commit was needed.

## Files Created/Modified

- `bridge/helper/main.go`: gRPC client, configure and repair, lenient config.yaml read, exit codes 0/1/2/3/4/64.
- `bridge/helper/envfile.go`: in-place writers, backup, upsert, mailbox matching, fixed messages.
- `bridge/helper/envfile_test.go`: table tests, including inode, mode, an injected part-way failure, a backup-verify failure that never opens the primary, and sentinel-free errors.
- `bridge/Dockerfile`: helper copy, test, build and ship.
- `bridge/entrypoint.sh`: init/configure/cli/repair, `require_env_file`, `require_bridge_stopped`, `require_tty`, `start_grpc_bridge`, `wait_bridge_exit`, `bridge_fingerprint` (shared with serve).
- `scripts/bridge-smoke.sh`: `run_mode` takes extra docker args (180 s), `expect_out`, the new checks, and a log-capture fix.
- `apps/worker/test/bridge-image.test.ts`: helper build order, the four mode cases, TTY-first, refusal texts, no rename/temp file/create flag in non-test Go files, and a `git check-ignore -v --no-index` check that the root backup file is ignored (pattern not negated).

## Decisions Made

See `key-decisions` in the frontmatter. In short:
- Bridge's own config loader and token key are used.
- Passwords come only from connected accounts.
- An invalid name exits 1 and writes nothing.
- A missing fingerprint does not abort configure.
- Bridge's console output is discarded in configure and repair.
- init warns the owner not to type `info`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Race in bridge-smoke's `docker logs | grep -q` under pipefail (code from 02-01)**
- **Found during:** Task 1 (first smoke run failed at `log lacks 'socat exited; stopping Bridge'`, although a manual reproduction showed the line was logged)
- **Issue:** With `set -o pipefail`, `grep -q` exits at the first match. A later line from `docker logs` then hits EPIPE, the pipeline fails, and the check flakes.
- **Fix:** capture `docker logs` into `serve_log` and match with `[[ == *...* ]]`, in both places. The failure message now includes the log.
- **Files modified:** scripts/bridge-smoke.sh
- **Committed in:** d7ed467

**2. [Rule 2 - Missing critical] Extra refusal and coverage checks beyond the plan's list**
- **Found during:** Task 1 and Task 2
- **Issue/Fix:**
  - The smoke now proves the single-instance-lock refusal by running `repair` beside the running serve container.
  - It also refuses `cli` without a TTY.
  - The helper gained `--grpc-config` (default: Bridge's settings path) and `repair --wait` (default 30 s).
- **Files modified:** scripts/bridge-smoke.sh, bridge/helper/main.go
- **Committed in:** d7ed467, 1c13da2

**3. [Plan detail] The configure smoke runs on the serve volume, not a second fresh volume**
- **Reason:** the pin must equal the fingerprint from the serve check, and that certificate belongs to the vault. The serve volume is keychain-initialised and never logged in, which is the plan's "fresh" condition.

**4. [Plan detail] The RED commit carries a compile-only stub `envfile.go`**
- **Reason:** without it, `go test` fails to build, and that would be INVALID_RED. With it, every test fails on an assertion.

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing-critical) and 2 documented plan-detail choices. **Impact:** none on scope. The smoke is now deterministic.

## Issues Encountered

- `pnpm lint` reports one warning, `noTemplateCurlyInString` in `apps/worker/test/node-version.test.ts:26`. It predates this plan and is out of scope.
- The full `pnpm test` run (34 files, 584 tests) passed on the first run. The known intermittent failure did not show, so its name is still unidentified.
- The branching strategy is `none`, so all commits are on `main`, as the orchestrator intended.

## Not Verifiable Without the Owner's Credentials (for 02-14 / 02-19)

- A real `login` in the Bridge CLI, with password, 2FA and possibly two-password mode.
- configure with one or more connected accounts: the `wrote <NAME> to .env.mailboxes (mailbox "<slug>")` lines, the backup line, and the host file keeping its inode, owner and mode through the real bind mount. The Go tests prove inode and mode on regular files, and the 02-01 probe proved in-place writes on a Compose bind mount.
- The account line showing `address mode: combined` for the owner's account (D-35).
- repair on a logged-in account, then the cache rebuild on the next `serve`, with UIDVALIDITY and INTERNALDATE compared (D-43, SPK-04).

## Next Phase Readiness

- Ready for 02-09. `docker compose run --rm bridge-init` is complete for the owner's live run in 02-14.

## Self-Check: PASSED

- FOUND: bridge/helper/main.go, bridge/helper/envfile.go, bridge/helper/envfile_test.go
- FOUND commits: d7ed467, 4442994, 1c13da2
- Plan verification: `docker build` (go test ok), `scripts/bridge-smoke.sh` -> `bridge smoke OK`, `pnpm vitest run apps/worker/test/bridge-image.test.ts` (50 passed), `pnpm test` (584 passed), `pnpm typecheck` (exit 0)
- Acceptance greps: SetIsTelemetryDisabled/SetIsAutomaticUpdateOn present; ExportTLSCertificates 0; `go test ./cmd/sift-helper` in Dockerfile; trusted.pem 0; `os\.Rename|CreateTemp|TempFile|O_CREATE` 0 in envfile.go and main.go; `/data/sift` 0; `func UpsertEnv|WriteInPlace|BackupInPlace` present; `docker compose run --rm bridge-init` in entrypoint
