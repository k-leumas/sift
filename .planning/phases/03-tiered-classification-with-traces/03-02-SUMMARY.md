---
phase: 03-tiered-classification-with-traces
plan: 02
subsystem: config
tags: [config-yaml, zod, tiers, llm-threshold, backfill, readme]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: per-mailbox ingest block (initial_backfill_days, new_mail_cap) and the strict config schema
provides:
  - "config.yaml key tiers.llm.confidence_threshold (0 to 1 inclusive, default 0.75), strict Tiers/LlmTier blocks"
  - "@sift/core/config exports DEFAULT_CONFIDENCE_THRESHOLD, MIN_CONFIDENCE_THRESHOLD, MAX_CONFIDENCE_THRESHOLD, LlmTier, Tiers, TiersConfig, LlmTierConfig; SiftConfig.tiers"
  - "DEFAULT_INITIAL_BACKFILL_DAYS = 3 (D-20)"
  - "Example config and README Technical settings with an active tiers.llm block and the 3-day first read"
affects: [03-04, 03-08, worker, llm-tier, readme]

actuals:
  tokens: 6300
  tasks: 2
  commits: 3
plan_head_before: 8fbb70a22f5f308bdad7c4570ec2cdb74967e87d
plan_head_after: 5a954833e3087f54ce46cc9c0802b0c5c66bce20

tech-stack:
  added: []
  patterns:
    - "New config blocks follow Worker: strictObject + unlessMissing block error + .default({...}) on the parent so absent, {} and nested {} all yield the defaults"

key-files:
  created: []
  modified:
    - packages/core/src/config/schema.ts
    - packages/core/src/config/index.ts
    - packages/core/test/config.test.ts
    - packages/core/test/example-config.test.ts
    - packages/db/test/registry-plan.test.ts
    - packages/db/test/registry.test.ts
    - apps/worker/test/support/mailbox-harness.ts
    - apps/worker/test/user-facing-text.test.ts
    - config/config.example.yaml
    - README.md

key-decisions:
  - "confidence_threshold range is inclusive 0..1 with one message 'confidence_threshold must be a number from 0 to 1' for out-of-range, text and boolean values"
  - "README Technical settings keeps tiers.classifier and tiers.llm.examples_per_prompt as column-0 comment lines inside the now-active tiers block, so stripping # lines still yields valid YAML"
  - "Also exported LlmTierConfig (type) alongside TiersConfig for 03-08"

patterns-established:
  - "Threshold/position tests derive the expected line and column from the generated YAML instead of hardcoding them"

requirements-completed: [CLS-04]

coverage:
  - id: D1
    description: "tiers.llm.confidence_threshold defaults to 0.75 with no tiers key, tiers: {} and tiers: { llm: {} } (CLS-04 empty edge)"
    requirement: CLS-04
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#tiers.llm.confidence_threshold (D-25) defaults to 0.75"
        status: pass
    human_judgment: false
  - id: D2
    description: "Threshold accepts 0, 0.75, 0.9, 1; rejects -0.01, 1.01, \"0.9\", true at tiers.llm.confidence_threshold with line:column; classifier/examples_per_prompt unrecognized; non-mapping tiers/llm rejected"
    requirement: CLS-04
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#tiers.llm.confidence_threshold (D-25)"
        status: pass
    human_judgment: false
  - id: D3
    description: "First-sync backfill defaults to 3 days (absent or empty ingest); explicit 30 and 0 kept"
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#imap.tls and ingest defaults (D-74, D-78)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Example config: 3 days on both mailboxes, active tiers.llm.confidence_threshold 0.75, passes sift config check --schema-only"
    verification:
      - kind: unit
        ref: "packages/core/test/example-config.test.ts"
        status: pass
      - kind: other
        ref: "SIFT_CONFIG=config/config.example.yaml node apps/worker/src/cli.ts config check --schema-only -> Config OK: 2 mailboxes"
        status: pass
    human_judgment: false
  - id: D5
    description: "README Technical settings YAML has the active tiers.llm block and still loads; no '30 days'/'30-day' left"
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#keeps the active technical-settings keys valid for the strict config schema"
        status: pass
      - kind: other
        ref: "grep -c '30 days' README.md -> 0; grep -c '30-day' README.md -> 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "Owner-facing wording of the new example-config and README comments"
    verification: []
    human_judgment: true
    rationale: "Prose quality for a non-technical owner; no test asserts readability"

duration: 6min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 02: LLM Confidence Threshold Config and 3-Day Backfill Summary

**config.yaml now accepts a strict `tiers.llm.confidence_threshold` (0 to 1 inclusive, default 0.75, wrong values reported at their YAML path), the first-sync backfill default drops from 30 to 3 days, and the example config and README show both.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-10T18:49:36Z
- **Completed:** 2026-10-10T18:55:37Z
- **Tasks:** 2 (1 tracer, 1 TDD)
- **Files modified:** 10

## Accomplishments

- `Tiers` / `LlmTier` strict schemas in `packages/core/src/config/schema.ts`; `Config.tiers` defaults to `{ llm: { confidence_threshold: 0.75 } }`, so `SiftConfig['tiers']['llm']['confidence_threshold']` is always a number for 03-08.
- New exports from `@sift/core/config`: `DEFAULT_CONFIDENCE_THRESHOLD`, `MIN_CONFIDENCE_THRESHOLD`, `MAX_CONFIDENCE_THRESHOLD`, `LlmTier`, `Tiers`, `TiersConfig`, `LlmTierConfig`.
- `DEFAULT_INITIAL_BACKFILL_DAYS` is now 3. The key name and the 0 to 365 range are unchanged, and explicit values are kept.
- `config/config.example.yaml`: both mailboxes use `initial_backfill_days: 3`, with a comment pointing at `sift mailbox backfill`, and the file has an active `tiers.llm.confidence_threshold: 0.75` block.
- README: the Technical settings YAML has an active `tiers.llm.confidence_threshold`, while `classifier`, `examples_per_prompt`, `quick_confirm` and `relabel_sync` stay commented. The paragraph after it says the threshold is read today. Every first-read mention says 3 days.

## Task Commits

1. **Task 1 (tracer): tiers.llm.confidence_threshold end to end into SiftConfig** - `86723fd` (feat)
2. **Task 2 (TDD): 3-day backfill default, example config and README**
   - RED `123c28e` (test). 6 target tests failed on the planned assertions: default 30 instead of 3 in 3 config tests, 30 in the example-config mailboxes, no tiers block in the example file, and no active tiers block in README. There were no load, syntax or fixture errors, so the RED evidence is semantically valid. `workflow.tdd_mode` is false, so the classifier gate was not required.
   - GREEN `5a95483` (feat). All 189 tests in the 3 files pass.
   - REFACTOR: none needed.

Tracer feedback gate: interactive run, `human_verify_mode: end-of-phase`, automated-only verify. The verify was re-run, it passed, and expansion continued with no checkpoint.

## Verification

- `SIFT_TEST_ADMIN_URL= pnpm exec vitest run packages/core apps/worker/test/user-facing-text.test.ts`: 7 files, 290 tests passed.
- `SIFT_TEST_ADMIN_URL= pnpm exec vitest run packages/core/test/config.test.ts packages/db/test/registry-plan.test.ts`: 110 passed.
- `pnpm typecheck`: exit 0. This covers the `tiers` literal in `packages/db/test/registry.test.ts`, which needs the database to run. Docker is down, so it was type-checked only. Its behaviour is unchanged.
- `SIFT_CONFIG=config/config.example.yaml node apps/worker/src/cli.ts config check --schema-only` prints `Config OK: 2 mailboxes (personal, job-search)` and exits 0.
- All acceptance greps pass. `grep -c "30 days"` and `grep -c "30-day"` on README.md both print 0.

## Deviations from Plan

None in scope. Small additions:
- Exported `LlmTierConfig` (type) besides the planned `TiersConfig`.
- Added a test that `tiers.llm: 0.9` gives 'tiers.llm must be a mapping', and a test that an explicit `initial_backfill_days: 30` is kept (plan truth 3).
- README line ~491 ("when the 30-day read ran") was not in the plan's list. It now reads "when the first read ran", so the `30-day` grep reaches 0.

## Issues Encountered

- The first run of the threshold reject cases hardcoded line 20, but the fixture puts the key on line 21. The test now derives line and column from the generated text (logged as bug-207).

## Next Phase Readiness

- 03-04 and 03-08 can read `config.tiers.llm.confidence_threshold` directly; it is always set.

## Self-Check: PASSED

- Commits 86723fd, 123c28e, 5a95483 found on HEAD; all modified files present.
