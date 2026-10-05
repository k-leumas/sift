---
phase: 02-bridge-spike-and-imap-ingest
plan: 01
subsystem: infra
tags: [proton-bridge, docker, compose, gnupg, pass, socat, tls-pin]

requires:
  - phase: 01-foundation
    provides: compose.yaml db/setup/worker stack, scripts/compose-smoke.sh and its shim test harness
provides:
  - bridge/Dockerfile building Proton Bridge v3.27.0 (commit 04e46eb4) from source, bridge binary only
  - bridge/entrypoint.sh modes serve and keychain-init, exit 78 on any keychain or vault refusal
  - log line `Bridge certificate SHA-256 (public key): <SPKI base64>` (the value owners pin, D-73)
  - Compose services bridge (sift-bridge only, 127.0.0.1:${SIFT_BRIDGE_PORT:-1143}) and bridge-init (profile tools)
  - external volume sift-bridge (${SIFT_BRIDGE_VOLUME:-sift-bridge})
  - scripts/bridge-smoke.sh end-to-end image check
affects: [02-08 bridge init, 02-14 live spike, 02-15 renovate, 02-18 pin capture, README quick start]

actuals:
  tokens: 12900
  tasks: 2
  commits: 2
plan_head_before: 4a483c96504a9ccf9558f86f40c64685497a8da5
plan_head_after: 31cfc8fbc40ab80faedb639a0731027801d95b91

tech-stack:
  added: [Proton Mail Bridge v3.27.0 (source build), golang:1.26.7-trixie, debian:trixie-20260918-slim, pass, gnupg, socat, tini, procps]
  patterns:
    - "Bridge entrypoint runs as root under tini; every gpg/pass/socat/bridge process runs as uid 1000 via setpriv"
    - "serve starts Bridge first, waits for 127.0.0.1:1143, then socat on the container IP; wait -n supervises both"
    - "Long-syntax bind for files that must pre-exist (no create_host_path)"
    - "compose-smoke builds/starts only db setup worker and owns a <project>-bridge-smoke volume"

key-files:
  created:
    - bridge/Dockerfile
    - bridge/entrypoint.sh
    - scripts/bridge-smoke.sh
    - apps/worker/test/bridge-image.test.ts
  modified:
    - compose.yaml
    - .env.example
    - scripts/compose-smoke.sh
    - apps/worker/test/compose.test.ts
    - apps/worker/test/compose-smoke.test.ts

key-decisions:
  - "02-01: entrypoint starts Bridge before socat: on a new vault Bridge picks its IMAP port with a free-port probe that also tries the wildcard address, so a socat already on <container IP>:1143 pushed Bridge to 1144"
  - "02-01: the canary check runs pass with PASSWORD_STORE_GPG_OPTS=--pinentry-mode=error under a 30 s timeout, so a wrong passphrase fails fast instead of waiting on a pinentry with no terminal"
  - "02-01: runtime image adds procps (pkill for the bridge smoke); setpriv and hostname come from the base image and the build fails if either is missing"

patterns-established:
  - "Bridge refusal messages are fixed text with exit 78; the passphrase reaches gpg only on stdin"
  - "Static image tests read bridge/Dockerfile and entrypoint.sh; the wildcard-address regex is assembled from parts"

requirements-completed: [ING-01]

coverage:
  - id: D1
    description: "Bridge image builds from tag v3.27.0, fails unless HEAD equals the pinned commit, ships only the bridge binary"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#bridge/Dockerfile pins the Bridge release (D-30, D-31)"
        status: pass
      - kind: integration
        ref: "scripts/bridge-smoke.sh (docker build step)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Served container answers STARTTLS on host 127.0.0.1:<port> via socat on the container IP and logs the SPKI fingerprint openssl computes from that port"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "scripts/bridge-smoke.sh#STARTTLS answered + logged fingerprint matches"
        status: pass
    human_judgment: false
  - id: D3
    description: "Keychain fails closed: wrong passphrase and never-initialised volume exit 78 before Bridge runs"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "scripts/bridge-smoke.sh#wrong passphrase refused / uninitialised volume refused"
        status: pass
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#bridge/entrypoint.sh fails closed (D-38, D-73)"
        status: pass
    human_judgment: false
  - id: D4
    description: "serve supervises socat and Bridge; killing socat stops the container non-zero; healthcheck probes the socat listener"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "scripts/bridge-smoke.sh#healthcheck command passes + socat death stopped the container"
        status: pass
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#bridge healthcheck probes the socat listener (D-32)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Compose contract: bridge mounts only sift-bridge on loopback; bridge-init (profile tools) alone mounts .env.mailboxes, config and the long-syntax backup bind; passphrase only in those two; worker never depends on Bridge"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "apps/worker/test/compose.test.ts#bridge service / bridge-init service / Bridge vault, secrets and mounts across services"
        status: pass
      - kind: other
        ref: "docker compose --env-file /dev/null --profile tools convert --format json (bridge 1 volume, bridge-init 4, no create_host_path)"
        status: pass
    human_judgment: false
  - id: D6
    description: "compose-smoke builds and starts only db setup worker on its own bridge volume, with a throwaway passphrase and a missing backup source"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "apps/worker/test/compose-smoke.test.ts#scripts/compose-smoke.sh keeps Bridge out of the smoke stack (D-79, D-81)"
        status: pass
      - kind: e2e
        ref: "SMOKE_ALLOW_VOLUME_REMOVAL=yes COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh --down"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-10-05
status: complete
---

# Phase 2 Plan 01: Bridge Image and Compose Contract Summary

**Proton Bridge v3.27.0 built from source at a verified commit, with a pass/GPG keychain that exits 78 instead of falling back to an unencrypted vault, socat exposing STARTTLS on the container IP under `wait -n` supervision, a logged SPKI fingerprint for config pinning, and a Compose contract where only the one-shot `bridge-init` service sees `.env.mailboxes` and config.**

## Performance

- **Duration:** about 18 min
- **Started:** 2026-10-05T17:08:15Z
- **Completed:** 2026-10-05T17:26:30Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- `bridge/Dockerfile`: a two-stage build. It clones tag v3.27.0, runs `test "$(git rev-parse HEAD)" = "${BRIDGE_COMMIT}"` in the same step, sets `GOTOOLCHAIN=local`, runs `make build-nogui`, and copies only `/src/bridge` into a slim trixie runtime with pass, gnupg, socat, openssl, procps and tini. The Renovate comment and the version and commit pins sit on three adjacent lines.
- `bridge/entrypoint.sh` has two modes:
  - `keychain-init` (idempotent): GPG key, pass store and canary.
  - `serve`: refuses with exit 78 when the passphrase is missing, the volume was never initialised, the canary will not decrypt, or an insecure vault directory exists. It unsets the passphrase, starts Bridge, waits for 127.0.0.1:1143, then starts socat on the container IP. It logs the SPKI fingerprint and stops both children when either exits.
- `scripts/bridge-smoke.sh` passed end to end against the real image: STARTTLS through the published loopback port, a logged fingerprint equal to openssl's, the healthcheck command, socat death giving a non-zero container exit, and exit 78 for a wrong passphrase and for an empty volume.
- `compose.yaml`:
  - `bridge` service on `127.0.0.1:${SIFT_BRIDGE_PORT:-1143}`, mounting only `sift-bridge:/data`.
  - Healthcheck against `$$(hostname -i ...)`.
  - `bridge-init` service (profile `tools`, `command: ["init"]`) with the four D-79/D-81 mounts, including the long-syntax backup bind.
  - External `sift-bridge` volume.
- `compose-smoke.sh` runs on `<project>-bridge-smoke`, refuses `sift-bridge`, fills `*_PASSPHRASE=` and appends a passphrase line to an older smoke .env if it lacks one. It points `SIFT_MAILBOXES_BAK_FILE` at a missing path and builds and starts only `setup worker` / `db setup worker`. The full compose smoke printed `compose smoke OK`.
- On the developer machine, the `sift-bridge` volume now exists and the real env file has a generated `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE`. The value was never printed.

## Task Commits

1. **Task 1: Tracer - Bridge image, fail-closed keychain, STARTTLS on loopback** - `e88d3e7` (feat)
2. **Task 2: bridge-init service, isolated smoke stack, contract tests** - `31cfc8f` (feat)

Tracer feedback gate: interactive run with `end-of-phase` mode and an automated-only verify. `bridge-image.test.ts` and `scripts/bridge-smoke.sh` were re-run on the committed entrypoint. Both passed, so execution moved on to Task 2.

## Files Created/Modified

- `bridge/Dockerfile`: pinned two-stage Bridge build, launcher never copied, no USER line (process model comment).
- `bridge/entrypoint.sh`: serve / keychain-init modes, exit codes 0/1/64/78.
- `scripts/bridge-smoke.sh`: image build plus throwaway-volume end-to-end check; prints `bridge smoke OK`.
- `apps/worker/test/bridge-image.test.ts`: static pin, hardening, healthcheck and no-wildcard assertions.
- `compose.yaml`: bridge and bridge-init services, the sift-bridge external volume, and header notes (volume create, SIFT_BRIDGE_PORT, smoke-only variables).
- `.env.example`: `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=` with a generation note, and a commented `SIFT_BRIDGE_PORT`.
- `scripts/compose-smoke.sh`: smoke bridge volume, passphrase fill, missing backup source, and only db/setup/worker.
- `apps/worker/test/compose.test.ts`: volume entries typed as strings or long-syntax objects, plus bridge, bridge-init and cross-service contract tests.
- `apps/worker/test/compose-smoke.test.ts`: the docker shim lets `volume` calls succeed and optionally `compose build`, and new Bridge isolation tests are added.

## Decisions Made

- Bridge starts before socat (see Deviations 1). The fingerprint printer starts after socat. Neither is ever `exec`'d.
- The canary check uses `--pinentry-mode=error` and a 30 s timeout. A wrong passphrase therefore exits 78 at once instead of waiting on a pinentry with no terminal.
- When the entrypoint unlocks the keychain, it re-asserts ownership and mode of `/data` (uid 1000, 0700). A volume created empty outside Compose therefore still works.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bridge moved its IMAP port to 1144 when socat started first**
- **Found during:** Task 1 (first `scripts/bridge-smoke.sh` run: no STARTTLS answer within 120 s)
- **Issue:** On a new vault, Bridge sets its IMAP port with `ports.FindFreePortFrom(1143)` (`internal/vault/types_settings.go:76`). `IsPortFree` also tries the wildcard address, so a socat already bound to `<container IP>:1143` made Bridge listen on 127.0.0.1:1144. socat then forwarded to nothing.
- **Fix:** serve starts Bridge first and waits up to 120 s for 127.0.0.1:1143. It aborts with exit 1 if Bridge dies or never listens. Only then does it start socat and the fingerprint printer. Supervision is unchanged.
- **Files modified:** bridge/entrypoint.sh
- **Verification:** `scripts/bridge-smoke.sh` ends with `bridge smoke OK`
- **Committed in:** e88d3e7

**2. [Rule 3 - Blocking] `pkill` missing from the runtime image**
- **Found during:** Task 1 (base image probe)
- **Issue:** debian trixie-slim has no procps, so the planned `docker exec <c> pkill -x socat` step could not run.
- **Fix:** added `procps` to the runtime apt layer. Also added a build-time `command -v hostname` next to `setpriv`.
- **Files modified:** bridge/Dockerfile
- **Committed in:** e88d3e7

**3. [Rule 3 - Blocking] Existing compose tests needed updating as services were added**
- **Found during:** Task 1
- **Issue:** compose.test.ts "defines db, setup and worker" listed the services exactly, and the compose-smoke shim failed every non-`ps` docker call, so `docker volume create` would have stopped every test there.
- **Fix:** Task 1 added `bridge` to the list (Task 2 renamed the test and added `bridge-init`). The shim now lets `docker volume ...` succeed, and the old "first docker call is compose build" assertions now check the first compose call.
- **Files modified:** apps/worker/test/compose.test.ts, apps/worker/test/compose-smoke.test.ts
- **Committed in:** e88d3e7, 31cfc8f

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All three were needed for the smoke and the tests to pass. There is no scope creep, and the interfaces block contracts are unchanged.

## Issues Encountered

- On macOS BSD grep, the acceptance grep `grep -n '127.0.0.1:${SIFT_BRIDGE_PORT:-1143}:1143' compose.yaml` matches nothing, because `{` is special there. With `grep -F` the same string matches line 141. compose.test.ts also asserts the exact port string.
- The commits landed on `main`. This follows the orchestrator's sequential-executor instruction and the project's `branching_strategy: none`, although `git.base-branch --is-protected main` reports true.
- Out of scope, not fixed: shellcheck SC2012 info in compose-smoke.sh (pre-existing `ls -nd`), and the biome warning in node-version.test.ts (pre-existing).

## User Setup Required

None for this plan. On this machine, `docker volume create sift-bridge` and the env passphrase are already done. A plain `docker compose up -d` now also starts `bridge`. On the uninitialised volume it exits 78 with "Bridge is not initialised: run docker compose run --rm bridge-init" and restarts with backoff, which is accepted under T-02-07. The `init` mode comes in 02-08.

## Next Phase Readiness

- 02-08 adds the `init`, `configure`, `cli` and `repair` modes to `bridge/entrypoint.sh`. It reuses `keychain_init`, `keychain_unlock`, `as_bridge`, `spki_fingerprint` and `scripts/bridge-smoke.sh`. `bridge-init` already has `command: ["init"]`, and until 02-08 lands it exits 64 with the usage message.
- 02-15 (Renovate) can match the three adjacent pin lines in `bridge/Dockerfile`.
- Assumption A8 (Proton accepts `BRIDGE_APP_VERSION=3.27.0`) is still untested until the live spike (02-14).

---
*Phase: 02-bridge-spike-and-imap-ingest*
*Completed: 2026-10-05*

## Self-Check: PASSED

- Files: bridge/Dockerfile, bridge/entrypoint.sh, scripts/bridge-smoke.sh, apps/worker/test/bridge-image.test.ts exist
- Commits: e88d3e7, 31cfc8f exist
- Verification: bridge-image/compose/compose-smoke tests pass; `bridge smoke OK`; `compose smoke OK`; compose convert check exit 0; `pnpm test` 400/400, `pnpm typecheck` exit 0
