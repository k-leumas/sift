---
phase: 02-bridge-spike-and-imap-ingest
plan: 04
subsystem: testing
tags: [imap, dovecot, starttls, tls-pin, spki, imapflow, supply-chain, ci]
status: complete

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-01 bridge/entrypoint.sh spki_fingerprint pipeline (the format pin.ts must equal)"
provides:
  - "scripts/test-imap.sh up/down/status: Dovecot 2.4.5 STARTTLS server sift-test-imap-<port> on 127.0.0.1 with a fresh CA:TRUE cert"
  - "apps/worker/src/imap/pin.ts: spkiSha256, peerSpkiSha256, pemFromDer"
  - "apps/worker/test/support/test-imap.ts: TEST_IMAP, requireTestImap, testImapCertPem, testImapPin, freshImapUser, appendMessage, createFolder, messageFlags, bumpUidValidity"
  - "imapflow 2.1.0, libmime 5.4.4, postal-mime 4.0.0, html-to-text 10.0.1 (+ @types/html-to-text 9.0.4, @types/libmime 5.3.0) at exact pins"
  - "apps/worker/test/dependencies.test.ts: pin, SPDX license allowlist, allowBuilds and libmime-resolution checks"
  - "CI step 'Start IMAP test server' before lint/typecheck/test"
affects: [02-09, 02-10, 02-11, 02-13, 02-15, 02-16, 02-18, 02-19, phase-03-body-parsing]

actuals:
  tokens: 10900
  tasks: 3
  commits: 4
plan_head_before: e0ba1779badf73efa652b27ec46ecad92b825a8e
plan_head_after: 7f907654423a0bd7b78ea1307fe4b0a3ff9946f3

tech-stack:
  added: [imapflow@2.1.0, libmime@5.4.4, postal-mime@4.0.0, html-to-text@10.0.1, "@types/html-to-text@9.0.4", "@types/libmime@5.3.0", "dovecot/dovecot:2.4.5 (test only)"]
  patterns:
    - "Test servers are scripts with up/down/status, named after their port, and helpers fail (never skip) naming the container, port and fix"
    - "Test certificates are made fresh per container and docker-cp'd in before start; the key never stays on the host"
    - "License checks evaluate SPDX expressions (OR = choose one allowed alternative, AND = all parts) and fail closed on anything else"

key-files:
  created:
    - scripts/test-imap.sh
    - apps/worker/src/imap/pin.ts
    - apps/worker/test/support/test-imap.ts
    - apps/worker/test/imap-pin.test.ts
    - apps/worker/test/dependencies.test.ts
  modified:
    - apps/worker/package.json
    - pnpm-lock.yaml
    - .github/workflows/ci.yml
    - apps/worker/test/ci-workflow.test.ts

key-decisions:
  - "Test IMAP certificate: the image's baked snakeoil cert is CA:FALSE, CN=localhost and its private key ships with the public image, so test-imap.sh makes a fresh self-signed CA:TRUE cert (SAN IP:127.0.0.1, like Bridge's) per container and docker-cp's it in before start"
  - "License check covers @sift/worker's whole production tree via --filter '@sift/worker...' (plain --filter @sift/worker stops at workspace links and missed @sift/core/@sift/db packages)"
  - "@zone-eu/mailsplit 5.4.17 (imapflow dependency) is dual-licensed (MIT OR EUPL-1.1+); used under MIT. The check reads SPDX OR/AND instead of widening the allowlist"
  - "Committed on main directly: branching_strategy=none for this phase (sequential executor on the main working tree)"

patterns-established:
  - "requireTestImap(): TCP connect + IMAP greeting within 5 s, else throws 'IMAP test server sift-test-imap-<port> not reachable at 127.0.0.1:<port>; run scripts/test-imap.sh up'"
  - "doveadm through docker exec with argument arrays; parse `-f tab` output by its header row"

requirements-completed: [ING-01]

coverage:
  - id: D1
    description: "scripts/test-imap.sh starts an idempotent Dovecot 2.4.5 STARTTLS server named sift-test-imap-<port> on 127.0.0.1"
    requirement: ING-01
    verification:
      - kind: other
        ref: "scripts/test-imap.sh up (twice) && scripts/test-imap.sh status; docker ps --filter name=sift-test-imap-31143 -q | wc -l == 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "spkiSha256 equals openssl's wire fingerprint (bridge/entrypoint.sh format) and peerSpkiSha256 of a real STARTTLS peer equals spkiSha256 of its PEM"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "apps/worker/test/imap-pin.test.ts#spkiSha256 equals the openssl pipeline over the certificate on the wire"
        status: pass
      - kind: integration
        ref: "apps/worker/test/imap-pin.test.ts#peerSpkiSha256 of a real STARTTLS peer certificate equals spkiSha256 of its PEM"
        status: pass
    human_judgment: false
  - id: D3
    description: "Test helpers (append, folders, flags, UIDVALIDITY bump) and the fail-never-skip requireTestImap"
    verification:
      - kind: integration
        ref: "apps/worker/test/imap-pin.test.ts#test server harness, #requireTestImap"
        status: pass
    human_judgment: false
  - id: D4
    description: "Approved packages installed at exact pins; license allowlist, allowBuilds and libmime resolution checked by a test"
    verification:
      - kind: unit
        ref: "pnpm install --frozen-lockfile && pnpm vitest run apps/worker/test/dependencies.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "CI starts the IMAP test server after the db bootstrap and before Test"
    verification:
      - kind: unit
        ref: "apps/worker/test/ci-workflow.test.ts#starts the IMAP test server after the bootstrap and before the tests"
        status: pass
      - kind: other
        ref: "actionlint .github/workflows/ci.yml"
        status: pass
    human_judgment: false

duration: 17min
completed: 2026-10-05
---

# Phase 02 Plan 04: Dovecot STARTTLS test server, SPKI pin and phase dependencies Summary

**A port-named Dovecot 2.4.5 STARTTLS test server with a per-container CA:TRUE certificate, an SPKI pin function proven equal to openssl's wire fingerprint and to Node's peer key, and imapflow/libmime/postal-mime/html-to-text at exact pins with a committed SPDX-aware license and build-script test.**

## Performance

- **Duration:** ~17 min
- **Started:** 2026-10-05T17:51Z
- **Completed:** 2026-10-05T18:09Z
- **Tasks:** 3
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments

- `scripts/test-imap.sh up|down|status`: `docker create` of `dovecot/dovecot:2.4.5` as `sift-test-imap-<port>` (`SIFT_TEST_IMAP_PORT`, default 31143) on `127.0.0.1:<port>`, a fresh `CN=sift-test-imap`, CA:TRUE, SAN IP:127.0.0.1 certificate copied in before start, then a poll (max `SIFT_TEST_IMAP_TIMEOUT`, 60 s) until `openssl s_client -starttls imap` returns a certificate. `up` reuses a running container or starts a stopped one, so it is idempotent. Passes shellcheck.
- `apps/worker/src/imap/pin.ts` (node:crypto only): `spkiSha256(pem)`, `peerSpkiSha256(cert)` (throws on a certificate without a public key), `pemFromDer(der)`.
- `apps/worker/test/support/test-imap.ts`: implements the interface block. Docker calls use argument arrays. `testImapCertPem` runs `docker exec <container> openssl x509 -in /etc/dovecot/ssl/tls.crt`, because the image has no `cat`. `SIFT_TEST_IMAP_CERT_FILE` overrides it.
- `imap-pin.test.ts` (9 tests): openssl wire cross-check, the same four openssl stages as bridge/entrypoint.sh, pemFromDer round trip and rejection, the peerSpkiSha256 cross-check over a hand-made STARTTLS, harness self-tests (unseen append; folder create plus UIDVALIDITY +1 twice), and requireTestImap's message for a closed port.
- Dependencies installed under D-77. `dependencies.test.ts` (9 tests) checks them, and CI now runs the Dovecot server before the tests.

## Task Commits

1. **Task 1: tracer, Dovecot test server and SPKI pin**: `f8c99b5` (feat). Tracer gate: end-of-phase mode with only automated verify, so verify was re-run and passed before expanding.
2. **Task 2: install approved packages with checks (TDD)**
   - RED: `1f29b8b` (test). 5 of 8 failing because the packages were not installed; `check tdd-red-evidence` gave RED_EVIDENCE_OK.
   - GREEN: `aec5ba7` (feat). Install, plus the SPDX expression fix in the test.
3. **Task 3: CI starts the IMAP test server**: `7f90765` (ci)

## Dependency review (D-77)

Publish dates (7-day gate, today 2026-10-05): imapflow 2.1.0 2026-09-27, postal-mime 4.0.0 2026-09-26, libmime 5.4.4 2026-09-15, html-to-text 10.0.1 2026-08-19, @types/libmime 5.3.0 2025-09-12, @types/html-to-text 9.0.4 2023-11-07. All are older than 7 days, and pnpm's supply-chain check passed. `pnpm install --frozen-lockfile` succeeds. No new package needed an install script (no ERR_PNPM_IGNORED_BUILDS), and `pnpm-workspace.yaml` `allowBuilds` is unchanged (esbuild, lefthook).

Resolved production tree added under @sift/worker (`pnpm list --filter @sift/worker --prod --depth Infinity`; @sift/core and @sift/db subtrees unchanged):

```
├─┬ html-to-text@10.0.1
│ ├─┬ @selderee/plugin-htmlparser2@0.12.0
│ │ ├── domelementtype@2.3.0
│ │ ├─┬ domhandler@5.0.3
│ │ └─┬ selderee@0.12.0 peer
│ │   └─┬ parseley@0.13.1
│ │     ├── leac@0.7.0
│ │     └── peberminta@0.10.0
│ ├── deepmerge-ts@8.0.2
│ ├─┬ dom-serializer@2.0.0
│ │ └── entities@4.5.0
│ ├─┬ htmlparser2@10.1.0
│ │ ├─┬ domutils@3.2.2
│ │ └── entities@7.0.1
│ └── selderee@0.12.0 [deduped]
├─┬ imapflow@2.1.0
│ ├─┬ @zone-eu/mailsplit@5.4.17
│ │ ├── libbase64@1.3.0
│ │ ├─┬ libmime@5.4.4
│ │ │ ├── encoding-japanese@2.4.0
│ │ │ ├─┬ iconv-lite@0.7.3
│ │ │ │ └── safer-buffer@2.1.2
│ │ │ ├── libbase64@1.3.0
│ │ │ └── libqp@2.1.1
│ │ └── libqp@2.1.1
│ ├── encoding-japanese@2.4.0
│ ├── iconv-lite@0.7.3 [deduped]
│ ├── libbase64@1.3.0
│ ├── libmime@5.4.4 [deduped]
│ ├── libqp@2.1.1
│ ├── pino@10.3.1 [deduped]
│ └─┬ socks@2.8.10
│   ├── ip-address@10.7.2
│   └── smart-buffer@4.2.0
├── libmime@5.4.4 [deduped]
└── postal-mime@4.0.0
```

There is one libmime version (5.4.4, the one imapflow pins). postal-mime has no dependencies and is installed now for Phase 3; Phase 2 code does not import it.

License summary (`pnpm licenses list --prod --filter @sift/worker`, 38 packages):

| License | Packages |
|---------|----------|
| MIT | @pinojs/redact, @selderee/plugin-htmlparser2, atomic-sleep, dom-serializer, encoding-japanese, html-to-text, htmlparser2, iconv-lite, imapflow, ip-address, leac, libbase64, libmime, libqp, on-exit-leak-free, parseley, peberminta, pino, pino-abstract-transport, pino-std-serializers, process-warning, quick-format-unescaped, real-require (0.2.0, 1.0.0), safe-stable-stringify, safer-buffer, selderee, smart-buffer, socks, sonic-boom, thread-stream |
| MIT-0 | postal-mime |
| BSD-2-Clause | domelementtype, domhandler, domutils, entities (4.5.0, 7.0.1) |
| BSD-3-Clause | deepmerge-ts |
| ISC | split2 |
| (MIT OR EUPL-1.1+) | @zone-eu/mailsplit (used under MIT) |

The committed test checks the whole tree including @sift/core and @sift/db (`--filter '@sift/worker...'`). Those add pg, pg-*, postgres-*, pgpass, xtend, zod (MIT), drizzle-orm (Apache-2.0), and pg-int8 and yaml (ISC). All are in the allowlist.

## Decisions Made

See key-decisions in the frontmatter. In short:

- **Own test certificate:** the image's certificate is a public, CA:FALSE snakeoil, so each container gets its own CA:TRUE certificate, matching what Bridge presents.
- **License check scope:** it covers the full production tree.
- **SPDX expressions:** the check reads them properly rather than adding EUPL to the allowlist.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] License check failed on a dual-licensed SPDX expression**
- **Found during:** Task 2 GREEN
- **Issue:** `@zone-eu/mailsplit@5.4.17` reports `(MIT OR EUPL-1.1+)`. A literal allowlist lookup rejects it, although the package can be used under MIT.
- **Fix:** `licenseAllowed()` evaluates SPDX expressions. An `OR` needs one fully allowed alternative and an `AND` needs every part. Nested parentheses, unknown values and a missing license fail closed. A unit test covers each case.
- **Files modified:** apps/worker/test/dependencies.test.ts
- **Commit:** aec5ba7

**2. [Rule 2 - Missing coverage] The license check would have skipped the workspace packages' dependencies**
- **Found during:** Task 2 RED
- **Issue:** `pnpm licenses list --prod --json --filter @sift/worker` stops at workspace links. Before the install it printed `{}`, and it never sees pino, pg, drizzle-orm and the rest that the worker runs.
- **Fix:** the test uses `--filter '@sift/worker...'`. It also asserts that the approved packages appear, so empty output cannot pass.
- **Files modified:** apps/worker/test/dependencies.test.ts
- **Commit:** 1f29b8b

**3. [Plan interpretation] testImapCertPem reads the certificate with openssl, not cat**
- The image has no `cat`, so `docker exec <container> openssl x509 -in /etc/dovecot/ssl/tls.crt` prints the same PEM.

Beyond the plan, the harness self-test also exercises createFolder and bumpUidValidity, and the pin test asserts that bridge/entrypoint.sh uses the same four openssl stages. These are small additions that make the shared helpers more trustworthy for later plans.

**Total deviations:** 2 auto-fixed (1 bug, 1 missing coverage) and 1 interpretation. **Impact:** stricter and broader checks than planned; no scope change.

## Issues Encountered

- The first full `pnpm test` run after Task 3 reported 1 failed of 471. The output was not captured, and two further full runs passed 471/471, so the failing test is unknown. All files of this plan passed in each targeted run. It may be a load-related flake in an existing suite. No action was taken.
- `pnpm lint` reports one warning, and it predates this plan: apps/worker/test/node-version.test.ts:26 noTemplateCurlyInString. Out of scope.

## Known Stubs

None.

## Threat Flags

None. T-02-SC is mitigated as planned: owner-approved list, exact pins older than the gate, license allowlist test, allowBuilds unchanged, frozen lockfile, and the tree recorded above. The test container listens on 127.0.0.1 only, with a fixed test password and a throwaway key.

## User Setup Required

None. Locally, run `scripts/test-imap.sh up` before `pnpm test`; CI does this itself.

## Next Phase Readiness

- Plan 02-18 can build capture and pinned login on `spkiSha256`, `peerSpkiSha256`, `pemFromDer`, `testImapPin()` and imapflow 2.1.0.
- Plans 02-09, 02-11, 02-13, 02-15 and 02-16 can use the Dovecot helpers. Only this plan writes the lockfile.

## Self-Check: PASSED

- FOUND: scripts/test-imap.sh, apps/worker/src/imap/pin.ts, apps/worker/test/support/test-imap.ts, apps/worker/test/imap-pin.test.ts, apps/worker/test/dependencies.test.ts
- FOUND commits: f8c99b5, 1f29b8b, aec5ba7, 7f90765 (4 = `git rev-list --count e0ba177..HEAD`)
- Acceptance: status exits 0 after up; a second up leaves 1 container; `grep -c 'dovecot/dovecot:2.4.5'` = 1; `export function spkiSha256` present; no `^`/`~` ranges; `"postal-mime": "4.0.0"` count 1; pnpm-workspace.yaml unchanged; CI step greps match
- Plan verification: up + the three test files gave 27/27; `pnpm lint` and `pnpm typecheck` exit 0; full `pnpm test` gave 471/471 (twice)
