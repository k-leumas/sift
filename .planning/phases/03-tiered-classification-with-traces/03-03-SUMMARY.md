---
phase: 03-tiered-classification-with-traces
plan: 03
subsystem: database
tags: [postgres, drizzle, rls, migrations, check-constraints, traces]

requires:
  - phase: 02-ingest
    provides: message/folder_sync ingest schema (0005-0007), seedScopedRows, catalog gate
provides:
  - decision D-27 trace columns (outcome, category, confidence double precision, tier, review_reason, rule_set_id, prompt_version_id, model, decided_by, trace_format_version, spans) with 10 CHECKs
  - partial unique index decision_one_worker_per_message (one worker decision per message, reruns append)
  - rule_set version/hash/format_version/snapshot, append-only for sift_app (grant + Scope.ruleSet AppendOnlyTableApi)
  - unscoped prompt_version table (Drizzle export promptVersion), catalog-allowlisted with SELECT, INSERT only
  - message_pending_idx partial index for the pending scan
  - migrations 0008 (preflight), 0009 (generated), 0010 (grants)
  - test helpers SEED_SPANS(_JSON), SEED_SNAPSHOT_JSON, RANDOM_HASH_SQL, newRuleSetRow, newDecisionRow
affects: [03-05 trace schema, 03-06 prompt registry, 03-07+ classification writes, phase 4 apply, TRC-05 CLI]

actuals:
  tokens: 49000
  tasks: 2
  commits: 3
plan_head_before: 00b3ea6925e00364bb3ce47b55a7b4fd89c12075
plan_head_after: 28a24368418e26931f1a9b0dbdbcd4c72b350103

tech-stack:
  added: []
  patterns:
    - "Phase schema trio: custom preflight (per-mailbox set_config loop) -> generated -> custom grants"
    - "Text + CHECK enums with explicit NULL handling; tests assert err.constraint per check"
    - "Append-only scoped table = APPEND_ONLY_TABLE_NAMES + REVOKE + AppendOnlyTableApi"

key-files:
  created:
    - packages/db/src/schema/prompt-version.ts
    - packages/db/migrations/0008_classification_preflight.sql
    - packages/db/migrations/0009_classification_tables.sql
    - packages/db/migrations/0010_classification_grants.sql
    - packages/db/test/classify-schema.test.ts
  modified:
    - packages/db/src/schema/scoped.ts
    - packages/db/src/schema/index.ts
    - packages/db/src/scope.ts
    - packages/db/test/support/catalog.ts
    - packages/db/test/support/seed.ts
    - packages/db/test/catalog.test.ts
    - packages/db/test/migrate.test.ts
    - packages/db/test/isolation.test.ts
    - packages/db/test/scope.test.ts
    - packages/db/test/ingest.test.ts

key-decisions:
  - "03-03: rule_set moved above decision in scoped.ts so decision_rule_set_fk references an initialised table; schema output unchanged"
  - "03-03: test-helper complete rows (seed.ts, scope/ingest inserts) landed with the schema task, since Task 1's migrate test and typecheck need them"
  - "03-03: classify-schema asserts the SQLSTATE and the constraint name per case; Postgres applies CHECKs in name order, so an exact-rule row with a confidence reports decision_confidence_check"

requirements-completed: [TRC-01, TRC-04, CLS-06]

coverage:
  - id: D1
    description: "decision carries the D-27 typed trace columns and a spans array; inconsistent rows are refused with 23514 per check, including the NULL-sneak cases"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "packages/db/test/classify-schema.test.ts#the database refuses inconsistent decisions with 23514 (D-13, D-27, D-31)"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify-schema.test.ts#stores 0.7499 as double precision and reads back exactly 0.7499 (CLS-04 precision edge)"
        status: pass
    human_judgment: false
  - id: D2
    description: "At most one worker decision per message (23505 decision_one_worker_per_message); rerun rows append next to it"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "packages/db/test/classify-schema.test.ts#refuses a second worker decision with 23505 and keeps rerun rows next to the first"
        status: pass
    human_judgment: false
  - id: D3
    description: "rule_set and prompt_version are versioned rows decisions reference by FK; both append-only for sift_app; prompt_version allowlisted in the catalog gate"
    requirement: TRC-04
    verification:
      - kind: integration
        ref: "packages/db/test/classify-schema.test.ts#decision foreign keys (TRC-04)"
        status: pass
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports no violations on the migrated schema"
        status: pass
      - kind: unit
        ref: "packages/db/test/scope.test.ts#keeps cross-mailbox writes and append-only mutations out of the types"
        status: pass
    human_judgment: false
  - id: D4
    description: "Migration 0008 refuses a database with decision or rule_set rows and applies nothing; an empty one migrates"
    verification:
      - kind: integration
        ref: "packages/db/test/migrate.test.ts#refuses a database whose rule_set table already has rows and applies nothing"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify-schema.test.ts#migration 0008 preflight (refuses decision or rule_set rows it did not write)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every packages/db test passes on the new schema; pnpm db:generate reports no schema changes"
    verification:
      - kind: integration
        ref: "pnpm vitest run packages/db (13 files, 274 tests)"
        status: pass
      - kind: other
        ref: "pnpm db:generate -> No schema changes"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 03: Classification Schema (decision trace, rule_set snapshots, prompt_version) Summary

**decision gets the D-27 trace columns with 10 NULL-safe CHECKs and a partial unique index allowing one worker decision per message; rule_set becomes an append-only versioned snapshot; a new unscoped prompt_version table, all via migrations 0008-0010**

## Performance

- **Duration:** 14 min
- **Started:** 2026-10-10T18:58:59Z
- **Completed:** 2026-10-10T19:12:37Z
- **Tasks:** 2
- **Files modified:** 19 (incl. 3 drizzle snapshots and the journal)

## Accomplishments
- 0008 preflight loops over mailboxes under app.mailbox_id and RAISEs the documented text when decision or rule_set already has rows. The migrator test shows nothing is applied: 8 migrations recorded, no decision.outcome column, no prompt_version table.
- 0009 (generated) adds only the planned columns, FKs (decision_rule_set_fk paired on mailbox_id, decision_prompt_version_fk), checks, decision_message_idx, decision_one_worker_per_message, message_pending_idx and the prompt_version table. 0010 grants SELECT, INSERT on prompt_version and revokes UPDATE, DELETE on rule_set.
- classify-schema.test.ts (51 tests) runs as sift_app. It covers the valid shapes (exact, LLM labelled at 0.75, low_confidence at 0.7499 read back exactly as double precision, invalid_output with no confidence, bounds 0 and 1, every reason) and 23 inconsistent rows, each refused with 23514 and the expected constraint (NULL sneaks and NaN included). It also covers 23502 on required columns, three FK refusals including another mailbox's rule set, worker uniqueness next to two rerun rows, rule_set and prompt_version checks and uniqueness, and 42501 on UPDATE/DELETE for decision, rule_set and prompt_version.
- Scope.ruleSet is now AppendOnlyTableApi (insert, find). The type tests and the runtime key checks cover it.

## Task Commits

1. **Task 1 (tracer): migrations, schema, catalog, classify-schema test** - `32f8373` (feat)
2. **Task 2 RED: append-only ruleSet tests + complete isolation rows** - `9488ab0` (test)
3. **Task 2 GREEN: Scope.ruleSet as AppendOnlyTableApi** - `28a2436` (feat)

No REFACTOR commit was needed.

## TDD (Task 2)

- **RED:** scope.test.ts expects `Object.keys(s.ruleSet)` to be `['find','insert']` and `s.ruleSet.update`/`delete` to be undefined, with @ts-expect-error. ingest.test.ts adds `s.ruleSet` to the no-insertOrIgnore/upsert probe. The run failed on exactly those 2 assertions ("expected [AsyncFunction update] to be undefined"; keys included delete). The other 80 tests passed. `gsd check tdd-red-evidence` returned RED_EVIDENCE_OK (target_test_failed, JUnit). Semantic assessment: the target ran and failed on the planned append-only assertion, with no load or fixture faults.
- **GREEN:** `ruleSet: appendOnlyTable(ctx, ruleSet)` plus the interface type. packages/db: 274/274 pass, and typecheck passes.

## Decisions Made
- rule_set is defined before decision in scoped.ts so the composite FK has an initialised table to point at. The generated SQL is unaffected.
- prompt_version's version and hash use Drizzle `.unique()`, so the constraint names are `prompt_version_version_unique` and `prompt_version_hash_unique`, matching mailbox's `.unique()` convention.
- The isolation decision insert reads the rule set with `(select id from rule_set where mailbox_id = $1 order by version limit 1)` and uses decided_by 'rerun'. Every isolation case passed with it: RLS WITH CHECK still returns 42501 before NOT NULL and the FKs, so no explicit id was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Complete test rows moved into Task 1**
- **Found during:** Task 1 (verify: migrate test and `pnpm typecheck`)
- **Issue:** migrate.test.ts calls seedScopedRows, which still wrote key-only decision/rule_set rows. scope.test.ts and ingest.test.ts inserted `{ messageId }` / `{}`, which no longer typechecks.
- **Fix:** seed.ts now writes a complete rule_set (next version, random hash, snapshot) and an exact worker decision. It also exports the helpers newRuleSetRow and newDecisionRow. scope.test.ts and ingest.test.ts inserts use them. Task 2 kept the scope.ts API change, its RED tests and the isolation helper.
- **Files modified:** packages/db/test/support/seed.ts, packages/db/test/scope.test.ts, packages/db/test/ingest.test.ts
- **Committed in:** 32f8373

**2. [Rule 3 - Blocking] TypeScript inference break in scope.test.ts (bug-210)**
- **Found during:** Task 1 typecheck
- **Issue:** `withMailbox(admin, A, (s) => s[key].update({}))` over a union of keys only inferred while rule_set's key-only row type was a supertype of the others.
- **Fix:** ruleSet came out of the mutable update/delete lists, since it is now append-only and the DB revokes those writes. The generic is now explicit: `withMailbox<{ mailboxId: string }[]>`.
- **Committed in:** 32f8373

**3. [Rule 2 - Missing coverage] Migrator-level 0008 test**
- **Found during:** Task 1
- **Issue:** The plan allowed running the 0008 SQL as the owner. That alone cannot prove the "nothing applied" truth.
- **Fix:** Added a migrate.test.ts case modelled on the Phase 2 preflight test (migrate to 0007, insert a key-only rule_set row, then migrate), in addition to the SQL-file test in classify-schema.test.ts.
- **Committed in:** 32f8373

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 missing coverage)
**Impact on plan:** Same files and scope as planned, but the test-helper work ran in Task 1 instead of Task 2. No architectural change.

## Issues Encountered
- `pnpm lint` reports 1 warning that was already there (noTemplateCurlyInString in apps/worker/test/node-version.test.ts). It is unrelated and was left alone.

## Verification
- `pnpm vitest run packages/db/test/classify-schema.test.ts packages/db/test/catalog.test.ts packages/db/test/migrate.test.ts`: 88/88 pass (tracer verify, re-run as the tracer gate)
- `pnpm vitest run packages/db`: 13 files, 274/274 pass, including registry.test.ts (which 03-02 could only typecheck) and owner-rls, isolation, scope and ingest
- `pnpm vitest run apps/worker/test/registry-cli.test.ts apps/worker/test/setup.test.ts`: 12/12 pass
- `pnpm typecheck` exits 0; `pnpm db:generate` prints "No schema changes"
- Acceptance greps: 3 classification migrations, 11 journal tags, decision_one_worker_per_message, doublePrecision('confidence'), 'public.prompt_version', REVOKE line and `readonly ruleSet: AppendOnlyTableApi<typeof ruleSet>` all match; decided_by appears in seed.ts and isolation.test.ts

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness
- 03-05/03-06 can validate spans in code and register prompt_version rows (lock 815309003). Classification writes can insert complete decisions through `s.decision.insert` and snapshots through `s.ruleSet.insert`.
- Ready for 03-04.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*

## Self-Check: PASSED

All 6 created files exist; commits 32f8373, 9488ab0, 28a2436 and 8ac1eb1 are ancestors of HEAD; classify-schema.test.ts re-run 51/51.
