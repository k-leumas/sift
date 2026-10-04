---
phase: 01-foundation-and-isolation
plan: 05
subsystem: database
tags: [postgres, rls, pg_catalog, catalog-test, ci, github-actions, pgvector]

# Dependency graph
requires:
  - phase: 01-foundation-and-isolation (plan 01-03)
    provides: "migrated schema (mailbox + 7 scoped tables, forced RLS, standard policy, explicit grants, set_updated_at triggers), SCOPED_TABLE_NAMES / APPEND_ONLY_TABLE_NAMES / MAILBOX_COLUMNS, freshDatabase()/connect()/requireTestDb() harness"
  - phase: 01-foundation-and-isolation (plan 01-02)
    provides: "db/bootstrap.sql (sift_owner, sift_backup, vector in template1)"
provides:
  - "collectCatalogViolations(client, allowlist?) in packages/db/test/support/catalog.ts: the pg_catalog schema check (D-37, D-38, D-66)"
  - "CATALOG_ALLOWLIST (schema-qualified keys) and STANDARD_POLICY_EXPR"
  - "packages/db/test/catalog.test.ts: clean-schema pass plus 9 fail-first negative tests"
  - ".github/workflows/ci.yml: workflow ci, job check (Biome, tsc, Vitest on Postgres 18 + pgvector)"
  - "apps/worker/test/ci-workflow.test.ts: static contract test for the workflow shape"
affects: [01-06, 01-07, 01-10, 01-12, 02, 03, 04]

# Actuals (#2632)
actuals:
  tokens: 7039    # chars/4 over the four files this plan created (28154 chars)
  tasks: 3
  commits: 3
plan_head_before: 154c934b22b2ab9ba3e602d83cd1789c83f4004a
plan_head_after: c9d6baf80ebac5f825c68e9a4ae552beff17c85f

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Schema invariants are asserted from pg_catalog in one place (collectCatalogViolations), returning human-readable `<schema>.<table>: <problem>` / `role <name>: <problem>` / `allowlist: <problem>` lines; tests compare with toEqual so an unexpected extra violation also fails"
    - "Negative catalog tests: clone the template with freshDatabase(), apply one regression as sift_owner (or admin for cluster objects), collect as superuser, drop"
    - "Cluster-wide test objects (roles) get a random suffix and are dropped in finally"
    - "CI env mirrors .env.development names with throwaway values; vitest's loadEnvFile never overrides them"

key-files:
  created:
    - packages/db/test/support/catalog.ts
    - packages/db/test/catalog.test.ts
    - .github/workflows/ci.yml
    - apps/worker/test/ci-workflow.test.ts
  modified: []

key-decisions:
  - "The composite-key check accepts a UNIQUE or PRIMARY KEY constraint whose ordered columns are exactly (mailbox_id, id); mailbox_status instead must have PK exactly (mailbox_id)"
  - "The D-04 FK check requires a position i with conkey[i] = child.mailbox_id and confkey[i] = parent.mailbox_id (positional pairing, stricter than both arrays merely containing it)"
  - "The updated_at trigger check also requires the trigger to be enabled (tgenabled <> 'D') and is limited to tables (relkind r/p)"
  - "If sift_app, sift_owner or sift_backup is missing, the check reports only that and stops, because has_table_privilege raises on an unknown role"
  - "Ownership checks cover pg_class, pg_proc and pg_namespace for both sift_app and sift_backup"
  - "actions/checkout pinned to @v7 (gh api releases/latest -> v7.0.1); pnpm/action-setup@v6 (v6.1.0), actions/setup-node@v7 (v7.0.0)"

patterns-established:
  - "A new table either passes collectCatalogViolations or gets a CATALOG_ALLOWLIST entry with a non-blank reason; views need an allowlist entry since they cannot carry RLS"
  - "CI validation without pushing: actionlint plus replaying the bootstrap and `pnpm test` against a throwaway pgvector container on another port with the CI env values"

requirements-completed: [ISO-01, ISO-02, FND-01]

coverage:
  - id: D1
    description: "Catalog check: every non-allowlisted relation has a NOT NULL mailbox_id with a single-column FK to public.mailbox, RLS enabled and forced, and exactly one standard policy (FOR ALL, permissive, {sift_app,sift_owner}, USING = WITH CHECK = STANDARD_POLICY_EXPR); the migrated schema reports no violations"
    requirement: ISO-01
    verification:
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports no violations on the migrated schema"
        status: pass
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a rogue table without mailbox_id or RLS"
        status: pass
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a nullable mailbox_id (ISO-01 empty edge)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exactly one permissive policy per scoped table, so a second OR-ed policy (ISO-02 ordering edge) is reported"
    requirement: ISO-02
    verification:
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a second permissive policy (ISO-02 ordering edge)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Allowlist (D-38): stale keys and blank reasons are reported"
    requirement: ISO-01
    verification:
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a stale allowlist entry and a blank reason"
        status: pass
    human_judgment: false
  - id: D4
    description: "sift_app privileges per table class (D-37, D-40) incl. column-level UPDATE, no TRUNCATE/REFERENCES/TRIGGER; role attributes, ownership, schema access and membership; sift_backup the only non-superuser BYPASSRLS role with no write privilege (D-66); sift_owner neither superuser nor BYPASSRLS"
    requirement: ISO-02
    verification:
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a TRUNCATE grant to sift_app"
        status: pass
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a non-superuser role with BYPASSRLS other than sift_backup"
        status: pass
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a column-level UPDATE grant on an append-only table"
        status: pass
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a missing grant, an extra registry column and a dropped trigger"
        status: pass
    human_judgment: false
  - id: D5
    description: "Registry columns equal MAILBOX_COLUMNS (D-06); UNIQUE (mailbox_id, id) on every scoped table but mailbox_status, whose PK is (mailbox_id) (D-07); scoped FKs pair mailbox_id (D-04); updated_at tables have the set_updated_at trigger"
    requirement: ISO-01
    verification:
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a scoped FK that does not pair mailbox_id and a missing composite key"
        status: pass
      - kind: integration
        ref: "packages/db/test/catalog.test.ts#reports a missing grant, an extra registry column and a dropped trigger"
        status: pass
    human_judgment: false
  - id: D6
    description: "GitHub Actions workflow ci/check runs Biome, tsc and Vitest against Postgres 18 + pgvector with db/bootstrap.sql applied (D-26)"
    requirement: FND-01
    verification:
      - kind: unit
        ref: "apps/worker/test/ci-workflow.test.ts"
        status: pass
      - kind: other
        ref: "actionlint .github/workflows/ci.yml -> no findings"
        status: pass
      - kind: other
        ref: "local replay: throwaway pgvector/pgvector:0.8.7-pg18-trixie on :55432, the workflow's docker exec bootstrap (exit 0), then pnpm test with the CI env values -> 8 files, 91 tests passed"
        status: pass
    human_judgment: true
    rationale: "The workflow can only run on GitHub's runners; the owner must push and confirm job `check` is green with catalog.test.ts and isolation tests passed (plan Task 3 human-check)"

# Metrics
duration: 6min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 05: Catalog Schema Check and CI Pipeline Summary

**`collectCatalogViolations` reads pg_catalog and reports every table missing a NOT NULL mailbox_id FK, forced RLS or the one standard policy, plus sift_app/sift_backup privilege, role, registry-column, composite-key, FK-pairing and trigger drift. The new GitHub Actions `ci` workflow runs it with lint, typecheck and the full suite on Postgres 18 + pgvector.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-10-04T06:05:02Z
- **Completed:** 2026-10-04T06:11:00Z
- **Tasks:** 3/3 (Task 1 tracer, Tasks 2 and 3 auto)
- **Files modified:** 4 created

## Accomplishments
- `CATALOG_ALLOWLIST` holds `public.mailbox` and `drizzle.__drizzle_migrations` with reasons. Allowlisted relations are checked differently, never skipped: each key must exist, and each reason must be non-blank.
- Every other relation (kinds r, p, v, m, f) must have:
  - a NOT NULL `mailbox_id`;
  - a single-column FK from it to `public.mailbox`;
  - RLS enabled and forced;
  - exactly one policy that is FOR ALL, permissive, for `{sift_app,sift_owner}`, with USING and WITH CHECK equal to `STANDARD_POLICY_EXPR`.
- sift_app privilege matrix:
  - normal scoped tables: all four DML privileges;
  - `decision` and `label_event`: SELECT and INSERT only (UPDATE is checked with `has_any_column_privilege`, so column grants count);
  - `mailbox`: SELECT only;
  - the migrations table: nothing;
  - TRUNCATE, REFERENCES and TRIGGER are denied on every table.
- Role checks:
  - sift_app is not superuser, BYPASSRLS, CREATEROLE or CREATEDB. It has no CREATE on public, no USAGE on drizzle, and no sift_owner membership.
  - sift_app and sift_backup own no relations, functions or schemas.
  - sift_owner is neither superuser nor BYPASSRLS.
  - sift_backup is the only non-superuser BYPASSRLS role and has no INSERT, UPDATE, DELETE or TRUNCATE anywhere.
- Structural checks:
  - the `mailbox` column list equals `MAILBOX_COLUMNS`;
  - every scoped table has `UNIQUE (mailbox_id, id)`, except `mailbox_status`, whose PK is `(mailbox_id)`;
  - scoped-to-scoped FKs pair `mailbox_id` positionally;
  - every table with `updated_at` has an enabled BEFORE UPDATE row trigger calling `set_updated_at()`.
- 10 catalog tests: the clean migrated schema returns `[]`, and 9 regressions are each reported by name. They cover a rogue table, a nullable mailbox_id, a stale or blank allowlist entry, a TRUNCATE grant, a second policy, an extra BYPASSRLS role, a column UPDATE on `decision`, a revoked DELETE, an extra registry column, a dropped trigger, an unpaired FK and a missing composite key.
- `.github/workflows/ci.yml` defines workflow `ci`, job `check`:
  - pgvector 0.8.7-pg18 service container;
  - `pnpm/action-setup@v6`, then setup-node@v7 with `.nvmrc`, then a frozen install;
  - PGDG `postgresql-client-18` added to `GITHUB_PATH`;
  - `docker exec` bootstrap from `db/bootstrap.sql`;
  - lint, typecheck and test as separate steps.

## Task Commits

1. **Task 1: Tracer - catalog check of the core invariant fails on a rogue table** - `4a964bf` (feat)
2. **Task 2: Full catalog assertions - privileges, roles, registry columns, composite keys, triggers** - `f776b11` (feat)
3. **Task 3: CI workflow running lint, typecheck and the DB test suite** - `c9d6baf` (feat)

**Plan metadata:** recorded in the `docs(01-05)` commit that adds this SUMMARY

## Files Created/Modified
- `packages/db/test/support/catalog.ts` - `collectCatalogViolations`, `CATALOG_ALLOWLIST`, `STANDARD_POLICY_EXPR`; four catalog queries (relations, policies, FKs, roles)
- `packages/db/test/catalog.test.ts` - clean-schema test plus 9 negative tests, each on its own fresh clone
- `.github/workflows/ci.yml` - workflow `ci`, job `check`
- `apps/worker/test/ci-workflow.test.ts` - parses the workflow with `yaml` and checks the image, setup steps, bootstrap, step order and env

## Decisions Made
- The composite key may be a UNIQUE or PRIMARY KEY constraint, but its ordered columns must be exactly `(mailbox_id, id)`.
- FK pairing is positional: `mailbox_id` must map to `mailbox_id` at the same index in conkey and confkey.
- A missing sift role is reported on its own, and the check stops there, because the privilege functions raise on an unknown role.
- Action pins come from `gh api .../releases/latest`: checkout@v7 (v7.0.1), pnpm/action-setup@v6 (v6.1.0), setup-node@v7 (v7.0.0).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Extra catalog assertions beyond the listed set**
- **Found during:** Task 2
- **Issue:** The plan's checks left some gaps:
  - schema ownership by sift_app/sift_backup;
  - disabled `set_updated_at` triggers;
  - sift_backup losing BYPASSRLS, which would make pg_dump of forced-RLS tables fail (D-66);
  - a missing sift role, which would make the check crash.
- **Fix:** Added a pg_namespace ownership count, `tgenabled <> 'D'`, a "sift_backup lacks BYPASSRLS" violation, and an early `role X: does not exist` return.
- **Files modified:** packages/db/test/support/catalog.ts
- **Commit:** f776b11

**2. [Rule 2 - Missing critical] More negative tests than the plan listed**
- **Found during:** Tasks 1-2
- **Issue:** Some new assertion classes (blank reason, missing grant, registry column, trigger, FK pairing, composite key) had no fail-first proof.
- **Fix:** Added a blank-reason case to Test 4, plus two more tests covering a revoked DELETE, an extra mailbox column, a dropped trigger, an unpaired scoped FK and a dropped composite key.
- **Files modified:** packages/db/test/catalog.test.ts
- **Commit:** 4a964bf, f776b11

**3. [Rule 1 - Bug avoidance] Unique name for the rogue BYPASSRLS role**
- **Found during:** Task 2
- **Issue:** Roles are cluster-wide. A fixed `rogue_bypass` could collide with a concurrent or crashed run.
- **Fix:** The role is named `rogue_bypass_<6 hex>` and dropped in `finally`. A post-run query confirmed no `rogue_bypass%` roles and no `sift_test_%` databases were left.
- **Commit:** f776b11

**4. [Rule 3 - Blocking] `apt-get update` before installing postgresql-common in CI**
- **Found during:** Task 3
- **Issue:** On a fresh runner, `apt-get install` can fail on stale package lists.
- **Fix:** The step runs `sudo apt-get update` first.
- **Commit:** c9d6baf

**Total deviations:** 4 auto-fixed (2 missing critical, 1 bug avoidance, 1 blocking). **Impact:** stricter checks and more fail-first coverage. No scope change, and nothing outside files_modified was touched.

## Issues Encountered
- Biome reformatted one long template literal in each Task 1/2 file. `biome check --write` fixed both before commit.

## Verification
- `pnpm vitest run packages/db/test/catalog.test.ts apps/worker/test/ci-workflow.test.ts`: 2 files, 15 tests passed.
- `pnpm test`: 8 files, 91 tests passed (76 before this plan); `pnpm lint` and `pnpm typecheck` exit 0.
- No CI runner exists locally, so the workflow was validated statically: by the contract test, by actionlint (no findings) and by the acceptance greps (`corepack enable` count 0). The CI steps were also replayed against a throwaway `pgvector/pgvector:0.8.7-pg18-trixie` container on 127.0.0.1:55432 using the workflow's throwaway env values. The bootstrap exited 0 and `pnpm test` passed 91/91. The container was then removed, and sift-db-1 was not touched.

## Pending Human Verification
- Task 3 human-check (end-of-phase): push the branch, open the Actions tab for workflow `ci`, and confirm job `check` is green. The test step log should show catalog.test.ts and the isolation tests as passed, not skipped.

## Next Phase Readiness
- Every later table must pass `collectCatalogViolations` or have a reasoned `CATALOG_ALLOWLIST` entry. The CI job enforces this once pushed.
- Ready for 01-06.

## Self-Check: PASSED
- FOUND: packages/db/test/support/catalog.ts, packages/db/test/catalog.test.ts, .github/workflows/ci.yml, apps/worker/test/ci-workflow.test.ts
- FOUND commits: 4a964bf, f776b11, c9d6baf
