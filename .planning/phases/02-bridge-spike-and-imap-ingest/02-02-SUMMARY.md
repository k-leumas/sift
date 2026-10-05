---
phase: 02-bridge-spike-and-imap-ingest
plan: 02
subsystem: config
tags: [zod, config-schema, tls-pin, starttls, ingest, yaml]

requires:
  - phase: 01-foundation
    provides: strict Zod config schema, loadConfig/parseConfigText, literal-secret pre-pass, config.example.yaml CI test (P1 D-61)
provides:
  - "mailboxes[].imap.tls.mode: starttls | implicit, default starttls (D-74, no plaintext mode per D-42)"
  - "mailboxes[].imap.tls.pin_sha256: optional base64 SHA-256 (PIN_SHA256_PATTERN, D-73)"
  - "mailboxes[].ingest.initial_backfill_days 0-365 default 30 and new_mail_cap 1-10000 default 200 (D-74, D-78)"
  - "constants TLS_MODES, PIN_SHA256_PATTERN, DEFAULT/MIN/MAX_INITIAL_BACKFILL_DAYS, DEFAULT/MIN/MAX_NEW_MAIL_CAP and types TlsMode, ImapTlsConfig, IngestConfig from @sift/core/config"
  - "config/config.example.yaml targets host bridge:1143 with a tls block (commented pin) and an ingest block"
affects: [02-11 probe, 02-13 worker, 02-15 sift bridge trust, 02-16 backfill CLI, 02-17 README technical settings, 02-18 pin capture]

actuals:
  tokens: 5700
  tasks: 2
  commits: 2
plan_head_before: dfe72876eada8a2124630fc8c7c6e8ce241ca2a4
plan_head_after: ea1024b048c3b4097c10eb954b53e14be77431b2

tech-stack:
  added: []
  patterns:
    - "New config blocks are strictObject with a block-level `<name> must be a mapping` error and a `.default({...})` so older files parse unchanged without a version bump"
    - "Bound messages are built once from the MIN/MAX constants and reused for invalid_type, min and max, so every out-of-range or non-integer value gets the same range text"

key-files:
  created: []
  modified:
    - packages/core/src/config/schema.ts
    - packages/core/src/config/index.ts
    - config/config.example.yaml
    - packages/core/test/config.test.ts
    - packages/core/test/example-config.test.ts
    - packages/db/test/registry.test.ts
    - packages/db/test/registry-plan.test.ts

key-decisions:
  - "02-02: pin_sha256 is trimmed before the shape check, so stray outer whitespace is tolerated but any inner space, hex digest, PEM or missing trailing = is rejected"
  - "02-02: tls and ingest each reject a non-mapping value with `tls must be a mapping` / `ingest must be a mapping`; a block-level schema error does not override Zod's unrecognized-key message, so strictness text is unchanged"
  - "02-02: tests pin the one-way names, defaults and owner-facing messages as literals rather than importing the constants, so a rename of a constant cannot silently change the contract"

patterns-established:
  - "configYaml mailbox helper takes mailboxExtra lines (4-space indent) for per-mailbox blocks next to imapExtra"
  - "Example-config placement test: walk up from a commented key to the nearest less-indented line to prove where uncommenting puts it, then parse a copy with it uncommented"

requirements-completed: [ING-01, ING-02, ING-03]

coverage:
  - id: D1
    description: "imap.tls.mode accepts starttls/implicit, defaults to starttls, rejects plain/none/tls/STARTTLS/false with a message naming both modes"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#imap.tls.mode (D-74, D-42)"
        status: pass
    human_judgment: false
  - id: D2
    description: "imap.tls.pin_sha256 optional; base64 SHA-256 accepted quoted or not; hex, missing =, inner space, PEM, 45 chars and non-text rejected with the fingerprint message"
    requirement: ING-01
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#imap.tls.pin_sha256 (D-73)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Per-mailbox ingest block: initial_backfill_days 0..365 default 30, new_mail_cap 1..10000 default 200, both edges and string/float rejections tested"
    requirement: ING-02
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#ingest bounds (D-26, D-74, D-75)"
        status: pass
      - kind: unit
        ref: "packages/core/test/config.test.ts#imap.tls and ingest defaults (D-74, D-78)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Strictness unchanged: tls.pin, ingest.cap and worker.ingest rejected as unrecognised keys; version stays 1; poll_interval_seconds default 60"
    requirement: ING-03
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#strictness of the new blocks (P1 D-57/D-59)"
        status: pass
    human_judgment: false
  - id: D5
    description: "config.example.yaml validates (Config OK: 2 mailboxes), uses host bridge port 1143, documents tls with a correctly nested commented pin and the ingest defaults"
    verification:
      - kind: unit
        ref: "packages/core/test/example-config.test.ts#config/config.example.yaml (D-61)"
        status: pass
      - kind: other
        ref: "SIFT_CONFIG=config/config.example.yaml node apps/worker/src/cli.ts config check --schema-only"
        status: pass
    human_judgment: false
  - id: D6
    description: "Registry drift plan unaffected by the new keys"
    verification:
      - kind: integration
        ref: "packages/db/test/registry-plan.test.ts; apps/worker/test/drift.test.ts"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-05
status: complete
---

# Phase 02 Plan 02: TLS and Ingest Config Settings Summary

**Strict Zod config gains per-mailbox `imap.tls` (starttls/implicit, base64 SHA-256 pin) and `ingest` (backfill 0-365 days default 30, new-mail cap 1-10000 default 200) with no version bump; the example config now targets the Compose `bridge` service.**

## Performance

- **Duration:** 6 min (measured from recorded start)
- **Started:** 2026-10-05T17:29:23Z
- **Completed:** 2026-10-05T17:35:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `schema.ts`: `ImapTls` (mode enum with no plaintext value, optional `pin_sha256` matching `/^[A-Za-z0-9+/]{43}=$/`) defaulted into `Imap.tls`, and `Ingest` defaulted into `Mailbox.ingest`; all bounds are named constants re-exported from `@sift/core/config`.
- `config.example.yaml`: both mailboxes use `host: bridge`, port 1143, a `tls:` block with `mode: starttls` and a commented `# pin_sha256:` line nested under `tls:` (with notes on where the fingerprint comes from and that quoting is optional), and an `ingest:` block with the defaults explained.
- 42 new test cases cover every accept/reject edge, defaults for Phase 1 style files, per-mailbox independence, strictness and the example's pin placement (parsed with the pin uncommented).

## Task Commits

1. **Task 1 (tracer): TLS and ingest settings flow from config.yaml through loadConfig to `sift config check`** - `710c445` (feat)
2. **Task 2: Boundary, default and strictness tests for every new key; drift unaffected** - `ea1024b` (test)

Tracer gate: automated-only `<verify>` re-run end to end and passed before Task 2 (`Config OK: 2 mailboxes`, example-config test, loadConfig defaults probe).

Commits were made directly on `main` (branching_strategy=none for this phase, as instructed by the orchestrator).

## TDD Notes

Task 2 is `tdd="true"` but the plan places the implementation in the Task 1 tracer, so its tests could not fail against HEAD. RED was demonstrated honestly instead: the new tests were run against `schema.ts`, `index.ts` and `config.example.yaml` restored from the plan base `dfe7287` (then restored from HEAD). Result: 38 new cases failed on assertions, 48 pass (all P1 cases plus the poll-interval-unchanged case); `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed). GREEN is the tracer commit `710c445`; no refactor commit was needed. The commit order is feat then test, by plan design.

## Files Created/Modified

- `packages/core/src/config/schema.ts` - TLS_MODES, PIN_SHA256_PATTERN, ingest bound constants, ImapTls and Ingest schemas, new output types
- `packages/core/src/config/index.ts` - re-exports of the new constants and types
- `config/config.example.yaml` - bridge host, tls block with commented pin, ingest block
- `packages/core/test/config.test.ts` - tls/pin/ingest/strictness cases; mailboxExtra helper; P1 unknown-key example changed from `tls` to `starttls`
- `packages/core/test/example-config.test.ts` - bridge host and defaults, pin placement, uncommented-pin parse
- `packages/db/test/registry.test.ts`, `packages/db/test/registry-plan.test.ts` - fixtures carry the new parsed defaults

## Decisions Made

See `key-decisions` in the frontmatter. Ranges 0-365 and 1-10000 remain planner's discretion (flagged in the plan), enforced at both edges.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] db test fixtures failed typecheck after MailboxConfig gained tls and ingest**
- **Found during:** Task 1
- **Issue:** `packages/db/test/registry.test.ts` and `registry-plan.test.ts` build `MailboxConfig` literals; the parsed output type now requires `imap.tls` and `ingest`, so `pnpm typecheck` failed (TS2322).
- **Fix:** Added `tls: { mode: 'starttls' }` and `ingest: { initial_backfill_days: 30, new_mail_cap: 200 }` (the schema defaults) to both fixture helpers. No assertions changed; both suites pass as before.
- **Files modified:** packages/db/test/registry.test.ts, packages/db/test/registry-plan.test.ts
- **Commit:** 710c445

**2. [Rule 1 - Bug] P1 unknown-key test used `tls` as its example of an unknown key**
- **Found during:** Task 1 (full `pnpm test`)
- **Issue:** `structure > reports an unknown key with its line number` wrote `tls: true` under `imap`; `tls` is now a real key, so the issue became `tls must be a mapping`.
- **Fix:** The example unknown key is now `starttls: true` (a plausible owner mistake); same line, column and `unrecognized key` assertion.
- **Files modified:** packages/core/test/config.test.ts
- **Commit:** 710c445

**3. [Interpretation] Pin placement check**
- The plan says the commented pin line's "line above is `tls:`". The example also has `mode: starttls` and explanatory comments inside the block, so the test walks up to the nearest less-indented line (must be `tls:`), asserts the only non-comment sibling is `mode: starttls` at the same indentation, and parses a copy with the pin uncommented. This proves the same property (uncommenting yields `mailboxes[].imap.tls.pin_sha256`) more strictly.

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug), 1 interpretation. **Impact:** test-fixture and test-example adjustments only; no behaviour beyond the plan.

## Issues Encountered

- `pnpm lint` reports one pre-existing warning in `apps/worker/test/node-version.test.ts` (noTemplateCurlyInString); not touched by this plan.

## Verification

- `pnpm vitest run packages/core packages/db/test/registry-plan.test.ts apps/worker/test/drift.test.ts`: 124 passed
- `SIFT_CONFIG=config/config.example.yaml node apps/worker/src/cli.ts config check --schema-only`: `Config OK: 2 mailboxes (personal, job-search); env vars not checked (--schema-only)`
- `pnpm test`: 29 files, 440 tests passed; `pnpm typecheck`: exit 0
- Acceptance greps: `pin_sha256` in schema.ts 5; `host: bridge` 2; `protonmail-bridge` 0; `^version: 1$` 1; no deferred hard-delete command in the example

## Next Phase Readiness

Ready for 02-03. The worker (02-13), probe (02-11), `sift bridge trust` (02-15) and backfill CLI (02-16) can read `mailbox.imap.tls` and `mailbox.ingest` from the parsed config.

## Self-Check: PASSED

- FOUND: packages/core/src/config/schema.ts, packages/core/src/config/index.ts, config/config.example.yaml, packages/core/test/config.test.ts, packages/core/test/example-config.test.ts
- FOUND commits: 710c445, ea1024b
