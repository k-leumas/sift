---
phase: 02-bridge-spike-and-imap-ingest
plan: 15
subsystem: bridge
status: complete
tags: [cli, tls-pin, bridge, renovate, ci, github-actions, supply-chain, tdd]
requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-01 bridge/Dockerfile pin block (renovate comment, ARG BRIDGE_VERSION, ARG BRIDGE_COMMIT) and its commit check; 02-02 MailboxConfig.imap.tls { mode, pin_sha256 }; 02-08 scripts/bridge-smoke.sh; 02-11 CLI table after bridge probe; 02-18 capturePeerCertificate, classifyImapError and the recording fake IMAP server"
provides:
  - "apps/worker/src/commands/bridge-trust.ts: `sift bridge trust <slug>` (run, USAGE)"
  - "renovate.json: custom regex manager for the Bridge tag and commit only"
  - ".github/workflows/bridge-image.yml: path-filtered bridge-image CI job running scripts/bridge-smoke.sh"
  - ".planning/phases/02-bridge-spike-and-imap-ingest/02-USER-SETUP.md: install the Renovate GitHub App"
affects: [02-16, 02-17, 02-19]
actuals:
  tokens: 5355
  tasks: 2
  commits: 3
plan_head_before: 8342708cd4d3205763d65e188748ebbd24c182a1
plan_head_after: 7b383bb1defddc9b555abf90f776b3398cfb7e08
tech-stack:
  added: [Renovate (GitHub App, config only)]
  patterns:
    - "Trust inspection goes through capturePeerCertificate alone: the command never reads password_env, never logs in and never writes; the owner compares two independent readings and edits config.yaml"
    - "Static tests for not-yet-existing config files read them with readIfPresent and assert existence first, so RED fails on an assertion instead of an ENOENT load error"
key-files:
  created:
    - apps/worker/src/commands/bridge-trust.ts
    - apps/worker/test/bridge-trust.test.ts
    - renovate.json
    - .github/workflows/bridge-image.yml
    - .planning/phases/02-bridge-spike-and-imap-ingest/02-USER-SETUP.md
  modified:
    - apps/worker/src/command.ts
    - apps/worker/test/cli.test.ts
    - apps/worker/test/bridge-image.test.ts
key-decisions:
  - "02-15: `sift bridge trust` prints the certificate's validTo as an ISO timestamp (toISOString) and exits 1 for both 'no pin' and 'pin differs', with the `  pin_sha256: <fingerprint>` line and `docker compose restart worker`; connection failures print one fixed text per classifyImapError class (unreachable/timeout, no_starttls, anything else), never the driver or server message"
  - "02-15: bridge-trust.ts repeats the bridge-init command text instead of importing BRIDGE_INIT_COMMAND from runtime/mailbox-batch.ts, which would load @sift/db and pg for a command that never touches the database"
  - "02-15: assumption A2 (Renovate's github-tags datasource fills currentDigest with the tag's commit) is not yet observed; the Dockerfile's commit check fails a version-only bump, and every Bridge PR body carries a note saying BRIDGE_COMMIT must move with BRIDGE_VERSION"
patterns-established:
  - "CLI commands that inspect a server without credentials: config via resolveConfigPath -> loadConfig -> applyEnvOverrides (no checkMailboxEnv), so they work with the mailbox's password_env unset"
requirements-completed: [ING-01]
coverage:
  - id: D1
    description: "`sift bridge trust <slug>` shows the SPKI fingerprint and expiry of the certificate the worker sees and compares it with imap.tls.pin_sha256: match exits 0; no pin or a different pin exits 1 with the line to paste and the restart command; the config file is byte-identical after every run"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#exits 0 and says so when the fingerprint matches the configured pin"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#exits 1 with the line to paste when no pin is configured"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#exits 1 with the line to paste when the configured pin differs"
        status: pass
    human_judgment: false
  - id: D2
    description: "Unknown slug, unreachable server and a server without STARTTLS exit 1 with fixed messages; a missing slug or an unknown option exits 2 with the usage"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#exits 1 for an unknown slug, without connecting"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#exits 2 with the usage when no slug or an unknown option is given"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#exits 1 with a fixed message when the server is unreachable"
        status: pass
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#exits 1 with a fixed message when the server offers no STARTTLS"
        status: pass
    human_judgment: false
  - id: D3
    description: "The trust command never logs in: on the recording STARTTLS fake, with password_env unset, its one connection carries exactly one plaintext line (`<tag> STARTTLS`) and zero bytes after the handshake; the source names no file-writing call and no login connection"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "apps/worker/test/bridge-trust.test.ts#never logs in: one STARTTLS line, the handshake, no bytes after it, no password (D-80)"
        status: pass
      - kind: other
        ref: "! grep -nE 'writeFile|rename\\(|openImap' apps/worker/src/commands/bridge-trust.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "`sift --help` lists `sift bridge trust <slug>` and still no purge command"
    verification:
      - kind: unit
        ref: "apps/worker/test/cli.test.ts#--help exits 0 and lists every Phase 1 command"
        status: pass
    human_judgment: false
  - id: D5
    description: "renovate.json manages only the Bridge pin: one custom regex manager whose matchStrings capture github-tags, ProtonMail/proton-bridge, the BRIDGE_VERSION and the BRIDGE_COMMIT values from bridge/Dockerfile; ignoreUnstable; a PR body note that BRIDGE_COMMIT must change with BRIDGE_VERSION"
    verification:
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#Renovate bumps the Bridge tag and commit together (D-31, T-02-SC)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The bridge-image workflow runs scripts/bridge-smoke.sh on PRs and pushes to main that touch bridge/**, the smoke script or the workflow, read-only, with a 45-minute timeout and the same SHA-pinned checkout as ci.yml; actionlint is clean"
    verification:
      - kind: unit
        ref: "apps/worker/test/bridge-image.test.ts#CI builds and smoke-tests every Bridge image change (D-31)"
        status: pass
      - kind: other
        ref: "actionlint .github/workflows/bridge-image.yml"
        status: pass
    human_judgment: false
  - id: D7
    description: "Renovate actually opens a Bridge PR that bumps the tag and the commit together, and the bridge-image job passes on GitHub's runner"
    verification: []
    human_judgment: true
    rationale: "Needs the Renovate GitHub App installed (02-USER-SETUP.md), a new upstream Bridge release and a real GitHub Actions run; assumption A2 (github-tags fills currentDigest) can only be observed on the first real bump"
duration: 6min
completed: 2026-10-05
---

# Phase 2 Plan 15: Bridge trust command, Renovate pin bumps and Bridge image CI Summary

**`sift bridge trust <slug>` reads the certificate the worker sees over a credential-free STARTTLS handshake and prints its SPKI fingerprint and the `pin_sha256:` line to paste; a regex-only Renovate config bumps the Bridge tag and commit together, and a path-filtered `bridge-image` CI job smoke-tests every bump**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-05T21:10:40Z
- **Completed:** 2026-10-05T21:16:42Z
- **Tasks:** 2
- **Files modified:** 7 (plus 02-USER-SETUP.md)

## Accomplishments

- D-73: the owner can see the fingerprint and expiry of the certificate the worker meets, and whether it matches `imap.tls.pin_sha256`. When it does not match, the command prints the line to paste and tells the owner to compare it first with what `docker compose run --rm bridge-init` printed. Trust changes only when the owner edits config.yaml.
- D-80 holds at the wire: with the mailbox's `password_env` unset, the command's single connection to the recording fake carries `<tag> STARTTLS` and the TLS handshake, and nothing after it.
- D-31: `renovate.json` enables only `custom.regex`, with one manager over `bridge/Dockerfile` that captures the version and commit together. `.github/workflows/bridge-image.yml` builds the image and runs the full smoke test (commit check, sift-helper tests, STARTTLS, one-shot modes) for any Bridge change, Renovate's PRs included.

## Task Commits

1. **Task 1 (tracer): `sift bridge trust <slug>`**: `b6725b6` (feat)
2. **Task 2 (TDD): Renovate config and the bridge-image workflow**
   - RED: `4f753f1` (test). 7 new cases failed on assertions (`renovate.json exists`, `bridge-image.yml exists`) and the 50 existing ones passed. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK`.
   - GREEN: `7b383bb` (feat)
   - REFACTOR: none needed

**Plan metadata:** see the docs(02-15) commit that adds this file.

## Files Created/Modified

- `apps/worker/src/commands/bridge-trust.ts`: the trust command. It parses one slug strictly, loads the config the same way bridge probe does (without the password check), calls `capturePeerCertificate({ host, port, mode })` and compares the result with the pin. Its output is limited to the fingerprint, the date and fixed texts.
- `apps/worker/src/command.ts`: registers `bridge trust`.
- `apps/worker/test/bridge-trust.test.ts`: 8 in-process cases against the Dovecot test server and the fake server. Every run also checks that the config file is byte-identical afterwards.
- `apps/worker/test/cli.test.ts`: the help list now includes `sift bridge trust <slug>`.
- `renovate.json`: config:recommended, `enabledManagers: ["custom.regex"]`, one regex manager, and a packageRule with ignoreUnstable and prBodyNotes.
- `.github/workflows/bridge-image.yml`: the `bridge-image` workflow. One `smoke` job on ubuntu-24.04 with a 45-minute timeout and `contents: read`, concurrency per ref, a checkout pinned to v7.0.1, then `scripts/bridge-smoke.sh`.
- `apps/worker/test/bridge-image.test.ts`: applies the matchStrings regex to the real Dockerfile and checks every captured group, the manager restriction, the PR note, the triggers, the permissions, the timeout and the pinned checkout (the same line as in ci.yml).

## Decisions Made

- The expiry is printed as an ISO timestamp (`new Date(validTo).toISOString()`, or the raw text if it does not parse). The interfaces block asks for an "ISO date".
- Failure texts reuse the worker's owner wording where it applies: `IMAP server unreachable at <host>:<port>` and `... does not offer STARTTLS; Sift never logs in without TLS`. Any other capture failure prints `... gave an unexpected response during the TLS handshake`. No error message from the driver or the server is ever printed.
- The bridge-init command text is repeated in bridge-trust.ts rather than imported from runtime/mailbox-batch.ts, so this command never loads the database modules.
- **Assumption A2 (flagged, not yet observed):** Renovate's `github-tags` datasource should fill `currentDigest` with the tag's commit SHA. Bridge v3 tags are lightweight, so the tag ref is the commit. If a bump changes only the tag, the Dockerfile's `test "$(git rev-parse HEAD)" = "${BRIDGE_COMMIT}"` fails the bridge-image check, which is the intended fail-safe. The PR body note tells the reviewer to set BRIDGE_COMMIT before merging. A2 is confirmed only by the first real Bridge PR.
- `renovate-config-validator` is not installed on this machine. Installing the Renovate CLI to validate the config is a package install, which this executor does not do on its own. The keys were checked against current Renovate docs via Context7 instead: `enabledManagers: ["custom.regex"]` is the documented form for custom managers, and so are `managerFilePatterns` and `prBodyNotes` in packageRules.

## Deviations from Plan

### Auto-added

**1. [Rule 2 - Missing coverage] Test for a server without STARTTLS, and for unknown options**
- **Found during:** Task 1
- **Issue:** The plan's truths say that a server without STARTTLS exits 1 with a fixed message, but the behavior list had no case for it. Usage errors from unknown options were not listed either.
- **Fix:** Added a case on a plain-mode fake server: exit 1, the fixed message, and no line written to the server. The usage test also covers `extra` positionals and `--write`.
- **Files modified:** apps/worker/test/bridge-trust.test.ts
- **Committed in:** b6725b6

---

**Total deviations:** 1 auto-added (Rule 2). **Impact:** test coverage only, no scope change.

Note: this phase uses `branching_strategy=none`, so all commits went to `main` as the orchestrator intended.

## TDD Gate Compliance

Task 2 (tdd="true"): RED `4f753f1` test(02-15) came before GREEN `7b383bb` feat(02-15). RED evidence was RED_EVIDENCE_OK, with 7 target failures, all assertion failures and no load errors. REFACTOR was not needed.

## Issues Encountered

None. The full gate passes: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm test` 45 files and 825 tests. `actionlint .github/workflows/bridge-image.yml` is clean.

## User Setup Required

**External service needs manual configuration.** See [02-USER-SETUP.md](./02-USER-SETUP.md):
- Install the Renovate GitHub App on k-leumas/sift, and merge its onboarding PR if one opens
- Verify through the Dependency Dashboard issue and the first Bridge bump PR

## Next Phase Readiness

- 02-17 (README/CONTRIBUTING) can document `docker compose run --rm --no-deps worker sift bridge trust <slug>`. It also owns the deferred note on SIFT_BRIDGE_PORT for host development configs.
- 02-19 (owner mailbox run) can use `sift bridge trust` to confirm the pin before starting the worker.
- The remaining Phase 2 plans are 02-14, 02-16, 02-17 and 02-19.

## Self-Check: PASSED

- FOUND: apps/worker/src/commands/bridge-trust.ts, apps/worker/test/bridge-trust.test.ts, renovate.json, .github/workflows/bridge-image.yml, 02-USER-SETUP.md
- FOUND commits: b6725b6, 4f753f1, 7b383bb
- Acceptance: help lists the trust usage once, no purge, no forbidden literal in bridge-trust.ts, every renovate/workflow grep matches, actionlint clean
