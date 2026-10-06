---
phase: 02-bridge-spike-and-imap-ingest
plan: 17
subsystem: docs
status: complete
tags: [docs, readme, contributing, bridge, tls-pin, security, privacy, doc-test]
requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-01 compose bridge/bridge-init services and the sift-bridge volume; 02-02 imap.tls and ingest config keys; 02-08 bridge-init init/configure output lines and the .env.mailboxes.bak backup; 02-14 spike findings and the ADR 0003 addendum; 02-15 sift bridge trust; 02-16 sift mailbox resume, list states and backfill"
provides:
  - "README.md: Bridge quick start (passphrase, volume, backup file, bridge-init, pin, up -d), Managing mailboxes (add via configure, needs attention and resume, backfill, bridge trust), Security model (TLS, pin, D-37 session wording, full-disk encryption), Privacy (body cache), Requirements (combined address mode, FDE), schema-valid Technical settings, scoped spike outcome"
  - "CONTRIBUTING.md: Bridge prerequisites in Development setup, a 'Developing against Bridge' subsection, the IMAP test server and the Bridge smoke in Checks"
  - "apps/worker/test/user-facing-text.test.ts: README/CONTRIBUTING pins for the Phase 2 commands, quick-start order (D-81), old-init-form and wildcard-bind negative cases, strict-schema parse of the active settings example, bridge files in the D-69 scan"
affects: [02-19]
actuals:
  tokens: 10200
  tasks: 2
  commits: 2
plan_head_before: 887fd2a9ca7db1a6e17e411f01e577bd1383dcf9
plan_head_after: e1cad051b7a3619b62c52464203445f88b62369b
tech-stack:
  added: []
  patterns:
    - "Doc examples are tested as code: the README's Technical settings YAML (comment lines stripped) goes through loadConfig on a temp file, so a copied example never fails sift config check"
    - "Forbidden literals in negative doc tests are built from string parts (old init form, wildcard bind, D-69 command), so the test file never matches its own scan"
key-files:
  created: []
  modified:
    - README.md
    - CONTRIBUTING.md
    - apps/worker/test/user-facing-text.test.ts
key-decisions:
  - "02-17: the README Technical settings example keeps later-milestone blocks (tiers, quick_confirm, relabel_sync) only as comments under '# Later milestones (not accepted by sift config check yet):'; pin_sha256 is shown commented, as in config.example.yaml, so the active YAML passes the strict schema"
  - "02-17: spike-dependent statements in the README are scoped 'as measured on Proton Bridge v3.27.0 in the M1 spike', quote the findings' scope line and link 02-SPIKE-FINDINGS.md and the ADR 0003 addendum; cross-folder matching is documented as X-Pm-Internal-Id with a Message-ID fallback for other servers"
  - "02-17: host development against Bridge uses a development config kept outside the repository (SIFT_CONFIG=~/sift-dev/config.yaml per command), because only config/config.yaml is git-ignored and it stays the Compose config"
  - "02-17: the README tells owners to rerun sift mailbox backfill once Bridge's own first sync has finished, since Bridge downloads newest mail first and the one-time 30-day read sees only what Bridge has synced"
patterns-established:
  - "Owner-facing init output is documented from the real fixed lines in bridge/entrypoint.sh and bridge/helper, with placeholders for fingerprint and counts"
requirements-completed: [ING-01, SPK-04]
coverage:
  - id: D1
    description: "README quick start from clone to a Bridge-connected worker: copy steps, passphrase, docker volume create sift-bridge, touch/chmod of .env.mailboxes.bak, docker compose run --rm bridge-init, pin_sha256, docker compose up -d, in that order"
    requirement: ING-01
    verification:
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#creates the volume and the backup file before the first Bridge login, then starts (D-81)"
        status: pass
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#README quick start (D-28, D-56, D-58) > contains %s"
        status: pass
    human_judgment: false
  - id: D2
    description: "No README, CONTRIBUTING, bridge/entrypoint.sh or compose.yaml line shows the pre-D-79 init command form; no README or CONTRIBUTING line shows the wildcard bind address; the Bridge login is gone from 'Arriving in later milestones'; bridge/Dockerfile and bridge/entrypoint.sh are in the D-69 scan"
    requirement: ING-01
    verification:
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#Bridge command form and bind addresses (D-79)"
        status: pass
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#no longer lists the Bridge login under later milestones"
        status: pass
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#D-69: the deferred mailbox hard-delete command is never named"
        status: pass
    human_judgment: false
  - id: D3
    description: "README security and privacy: exact D-37 sentence, TLS with no plaintext fallback, the SPKI pin and sift bridge trust, FileVault/LUKS requirement, body cache until classified plus 7 days, telemetry and updates off"
    requirement: ING-01
    verification:
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#README quick start (D-28, D-56, D-58) > contains %s"
        status: pass
    human_judgment: false
  - id: D4
    description: "Technical settings example: version: 1 first; active keys parse with the strict config schema; later-milestone blocks only as comments"
    requirement: ING-01
    verification:
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#keeps the active technical-settings keys valid for the strict config schema"
        status: pass
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#starts the technical-settings example with version: 1"
        status: pass
    human_judgment: false
  - id: D5
    description: "The spike outcome (polling only, no CONDSTORE/QRESYNC) reaches the README, scoped to Proton Bridge v3.27.0 and linked to the findings"
    requirement: SPK-04
    verification:
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#README quick start (D-28, D-56, D-58) > contains %s"
        status: pass
    human_judgment: false
  - id: D6
    description: "CONTRIBUTING developer loop: passphrase and sift-bridge volume before docker compose up -d db, Developing against Bridge (localhost, SIFT_BRIDGE_PORT, pin, host-side trust), scripts/test-imap.sh up, scripts/bridge-smoke.sh"
    requirement: ING-01
    verification:
      - kind: test
        ref: "apps/worker/test/user-facing-text.test.ts#CONTRIBUTING development loop and gates (D-22, D-31, D-47)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A new owner can actually follow the README alone from clone to an ingesting worker (wording clarity, completeness of the interactive Bridge login)"
    requirement: ING-01
    verification: []
    human_judgment: true
    rationale: "Readability and completeness for a first-time owner are judgment calls; the tests pin strings and order, not comprehension. 02-19's owner run is the natural check."
duration: 15min
completed: 2026-10-06
---

# Phase 2 Plan 17: Owner and Contributor Docs for Bridge and Ingest Summary

**README and CONTRIBUTING now cover Phase 2: a Bridge quick start with `docker compose run --rm bridge-init` and the certificate pin, the owner mailbox commands, the D-37 session wording, full-disk encryption, the body cache and the spike result scoped to Bridge v3.27.0. `user-facing-text.test.ts` pins the commands and their order, and parses the settings example with the strict config schema.**

## Performance

- **Duration:** about 15 min
- **Started:** 2026-10-06T14:45:46Z
- **Completed:** 2026-10-06T15:00:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- **Quick start (tracer):**
  - New steps, in order: set `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE`, `docker volume create sift-bridge`, the one-time `touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak`, then `docker compose run --rm bridge-init`.
  - The init step says what the owner types (`login`, address, password, 2FA, `exit`, not `info`) and that Bridge's command line does not echo it. It shows the real fixed output lines: the fingerprint, the `pin_sha256:` line, telemetry and updates off, the account line, the backup line and `wrote ... to .env.mailboxes`. It also covers the 2-minute account-load wait and `cp .env.mailboxes.bak .env.mailboxes` after an interrupted write.
  - The owner then pastes the pin and runs `docker compose up -d`.
  - Notes cover port 1143 and the desktop app (or `SIFT_BRIDGE_PORT`), `connecting` for up to a minute, `ok, backfilling <done> of <total>`, and Bridge's slow, newest-first first sync (scoped to v3.27.0).
  - The Bridge login is gone from "Arriving in later milestones", and every mention uses the D-79 form.
- **Managing mailboxes:**
  - Adding a mailbox: stop bridge, `bridge-init configure` (or full init for a new account), start bridge, setup, recreate the worker. Then empty but keep the backup file, including the `bind source path does not exist` recovery.
  - The status values.
  - Needs attention and `sift mailbox resume <slug>`.
  - `sift mailbox backfill <slug> --days 3`: count, confirm, `--yes`, 1 to 365 days, waits for the lock.
  - `sift bridge trust <slug>`: compare before you replace a pin, then `docker compose restart worker`.
- **Security model:**
  - TLS always, with no plaintext fallback (D-80).
  - The SPKI pin and its fail-closed regeneration path. Public-CA servers may omit the pin.
  - The verbatim D-37 sentence, followed by token sensitivity, which services mount the volume, the passphrase, no backups and survival of `down -v`, removing the session, and the `.env.mailboxes.bak` handling.
  - FileVault/LUKS listed as required (D-10).
- **Privacy, Requirements, Settings:**
  - Privacy: IMAP is the source of truth. Bodies are cached until classified plus 7 days (until classification ships, they stay), orphan bodies are deleted at once, attachments are metadata only, and Bridge telemetry is off.
  - Requirements: combined address mode (D-35) and full-disk encryption.
  - Technical settings:
    - `host: bridge` with the `tls:` and `ingest:` blocks and `worker.poll_interval_seconds`.
    - Later-milestone blocks stay, commented.
- **Learning from your mail app:** the CONDSTORE/QRESYNC sentence is replaced by the spike outcome (polling only, UID-set diff plus a UIDVALIDITY check, matching by `X-Pm-Internal-Id`). It is scoped to "Proton Bridge v3.27.0 in the M1 spike", quotes the findings' scope line, and links the findings and the ADR 0003 addendum. The M1 roadmap item links the findings too.
- **CONTRIBUTING:**
  - The passphrase in `.env` and `docker volume create sift-bridge` come before `docker compose up -d db`.
  - New "Developing against Bridge" subsection: `docker compose up -d bridge`, a `host: localhost` dev config outside the repo through `SIFT_CONFIG`, port 1143 or `SIFT_BRIDGE_PORT`, the same pin, `sift bridge trust <slug>` from the host, and the real IMAP password in `.env.development`.
  - Checks: `scripts/test-imap.sh up` (tests fail, never skip), `scripts/bridge-smoke.sh`, and what CI runs.
- **Doc test:**
  - New README and CONTRIBUTING strings.
  - The D-81 order case.
  - The old-init-form scan (README, CONTRIBUTING, entrypoint, compose) and the wildcard-bind scan, both with patterns built from parts.
  - The later-milestones check.
  - The strict-schema settings case.
  - The CONTRIBUTING volume-before-db case.
  - `bridge/Dockerfile` and `bridge/entrypoint.sh` added to SCANNED_FILES.

## Task Commits

1. **Task 1: Tracer - README quick start reaches a Bridge-connected worker, pinned by the doc test**: `4967bf0` (docs)
2. **Task 2: Security, privacy and settings docs, the spike outcome, and the contributor loop**: `e1cad05` (docs)

**Plan metadata:** recorded in the final docs commit.

## Files Created/Modified

- `README.md`: Quick start, Managing mailboxes, Security model, Privacy, Requirements, Technical settings, Learning from your mail app, Roadmap link
- `CONTRIBUTING.md`: intro, Development setup steps 4 and 5, Developing against Bridge, Checks
- `apps/worker/test/user-facing-text.test.ts`: new pins and cases

## Decisions Made

- The settings example shows `pin_sha256` commented, like `config.example.yaml`, instead of a fake value. The active YAML then passes the strict schema, and nobody copies a placeholder pin.
- The dev config lives outside the repository, because only `config/config.yaml` is git-ignored and a tracked `config.dev.yaml` could leak an owner address.
- The plan put the passphrase step after the `.env.mailboxes` copy. It is step 5 there, so the order test still covers copy, then volume, then backup file, then init, then pin, then up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Biome formatting blocked the Task 1 commit**
- **Found during:** Task 1 commit (lefthook `biome check`)
- **Issue:** the new `it.each([...])` call was not in Biome's layout.
- **Fix:** `biome check --write` on the test file, then the commit was retried. No content changed.
- **Files modified:** apps/worker/test/user-facing-text.test.ts
- **Commit:** 4967bf0

**2. [Rule 1 - Bug] CONTRIBUTING order case matched an earlier prose mention**
- **Found during:** Task 2 verification
- **Issue:** an `indexOf` order check found `docker compose up -d db` first in step 4's prose, not in the step 5 command block.
- **Fix:** the case now asserts the step 5 block itself: `docker volume create sift-bridge` directly followed by `docker compose up -d db`.
- **Files modified:** apps/worker/test/user-facing-text.test.ts
- **Commit:** e1cad05

**3. [Rule 2 - Accuracy] Documented behaviour from the shipped code, not the plan's wording**
- **Found during:** Tasks 1 and 2
- **Issue/Fix:**
  - The init output lines were copied from `bridge/entrypoint.sh` and `bridge/helper`. That includes the 120 s account-load wait (7fd1580) and the order (fingerprint first).
  - Cross-folder matching is documented as `X-Pm-Internal-Id` (spike SPK-03), not `Message-ID`.
  - Adding a mailbox includes `docker compose start bridge`, which the plan's sequence left out. Without it, Bridge stays stopped after `configure`.
  - Passphrase loss is documented as "remove the volume and log in again", which matches `keychain_init`/`keychain_unlock`.
- **Files modified:** README.md, CONTRIBUTING.md
- **Commits:** 4967bf0, e1cad05

**Total deviations:** 3 (2 test/format bugs, 1 accuracy group). **Impact:** none on scope. The docs match the shipped behaviour.

## Issues Encountered

- **Full `pnpm test`:**
  - Two full runs each had 1 to 3 Dovecot-backed IMAP tests time out at 30 s: `imap-folder-source.test.ts` (D-11 flags, UIDVALIDITY change) and `imap-pin.test.ts` (harness folder creation).
  - The host load average was 10 to 11 while the owner's Bridge synced on the same Docker host.
  - Both files pass when rerun alone (30/30). The other 902 tests passed. This is the known host-load pattern (bug-151); this plan changed no code those tests use.
- **Typecheck and lint:** `pnpm typecheck` exits 0. `pnpm lint` exits 0, with the one pre-existing `noTemplateCurlyInString` warning in `node-version.test.ts`.
- **Out of scope:** `.env.example` says a lost passphrase is recovered by rerunning `bridge-init`, which fails on an existing volume. Logged in `deferred-items.md`; the README states the correct recovery.

## Known Stubs

None.

## Threat Flags

None. Documentation and a test only; T-02-56, T-02-57 and T-02-58 are mitigated by the pinned D-37 sentence, the compare-before-replace pin guidance and the FileVault/LUKS requirement.

## User Setup Required

None.

## Next Phase Readiness

- 02-19 (owner mailbox run) can follow the README quick start and Managing mailboxes as written. Its run is also the human check that the docs are enough on their own (coverage D7).

## Self-Check: PASSED

- FOUND: README.md, CONTRIBUTING.md, apps/worker/test/user-facing-text.test.ts
- FOUND commits: 4967bf0, e1cad05
- Verification:
  - `pnpm vitest run apps/worker/test/user-facing-text.test.ts apps/worker/test/compose.test.ts`: 102 passed
  - `pnpm lint`: exit 0
  - `pnpm typecheck`: exit 0
- Acceptance greps:
  - D-37 sentence count 1; FileVault and LUKS match; `scripts/test-imap.sh up` in CONTRIBUTING; `pin_sha256` in README
  - The old init form and `purge`: 0 in every file checked
  - Wildcard bind: 0 in README and CONTRIBUTING
  - `sift mailbox backfill <slug> --days 3`: matches
