---
phase: 01-foundation-and-isolation
plan: 09
subsystem: database
tags: [postgres, pg, advisory-lock, rls, cli, mailbox-registry, config]

requires:
  - phase: 01-03
    provides: mailbox registry table, mailbox_status (forced RLS), migrations
  - phase: 01-04
    provides: loadConfig, formatIssue, validateSlug, SiftConfig/MailboxConfig types
  - phase: 01-05
    provides: freshDatabase / seedScopedRows test harness
provides:
  - "@sift/db/registry-plan: pure planRegistryChanges, findRenameSuspects, describeChange, mailboxValuesFromConfig"
  - "@sift/db/registry: applyConfig, renameMailbox, listMailboxes, CONFIG_APPLY_LOCK_KEY (815309002)"
  - "CLI: sift config apply [--confirm], sift mailbox list, sift mailbox rename <old> <new>"
affects: [01-10, 01-11, 01-12, 01-13, worker drift check, setup service, README]

actuals:
  tokens: 10654
  tasks: 2
  commits: 3
plan_head_before: cad26f81509d8b6094e65cb895431b7ac5f0f5fe
plan_head_after: e1f8974ae0e486738ec75a8316f6c994cf6db616

tech-stack:
  added: []
  patterns:
    - "Owner registry writes: one pg.Client, begin, pg_advisory_xact_lock(CONFIG_APPLY_LOCK_KEY), select ... for update, parameterized writes, commit; refusal and no-op roll back"
    - "Owner reads of RLS tables: set_config('app.mailbox_id', id, true) per mailbox inside one read-only transaction"
    - "Pure diff module with type-only imports so the worker can reuse it without loading pg"
    - "apps/*/test files that use packages/db/test/support add a /// <reference path> to global-setup.ts for the inject('testDb') typing"

key-files:
  created:
    - packages/db/src/registry-plan.ts
    - packages/db/src/owner/registry.ts
    - apps/worker/src/commands/config-apply.ts
    - apps/worker/src/commands/mailbox-list.ts
    - apps/worker/src/commands/mailbox-rename.ts
    - packages/db/test/registry-plan.test.ts
    - packages/db/test/registry.test.ts
    - apps/worker/test/registry-cli.test.ts
  modified: []

key-decisions:
  - "config apply validates the schema only (loadConfig, no checkMailboxEnv and no env overrides): the registry depends on mailboxes only, and setup never gets mailbox secrets (D-67)"
  - "Refused rename prints one rename hint per removed/added pair, lists unmatched slugs when the counts differ, and always ends with No changes applied."
  - "mailbox list shows disabled mailboxes as 'disabled since YYYY-MM-DD' (UTC date); a mailbox with no status row shows 'never run'"
  - "renameMailbox also rejects old == new slug, and takes the same advisory lock as config apply so the two cannot interleave"

patterns-established:
  - "Registry change lines: add mailbox \"x\" | update mailbox \"x\": field a -> b | re-enable mailbox \"x\" | disable mailbox \"x\" (no longer in config.yaml; its data is kept)"
  - "D-69 guard in tests: collect every CLI stdout/stderr and assert none matches the deferred-command regex"

requirements-completed: [FND-02]

coverage:
  - id: D1
    description: "sift config apply adds configured mailboxes without mailbox password vars in the environment, and a second run reports the registry already matches"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "apps/worker/test/registry-cli.test.ts#adds every configured mailbox without mailbox secrets in the environment"
        status: pass
      - kind: integration
        ref: "apps/worker/test/registry-cli.test.ts#a second apply reports that the registry already matches"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-33 guards: a likely rename is refused without --confirm with a byte-identical registry; empty, broken and mailbox-less configs exit 1 and change nothing; --confirm disables and adds"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "packages/db/test/registry.test.ts#refuses a disappearing slug next to a new one and leaves the registry byte-identical"
        status: pass
      - kind: integration
        ref: "packages/db/test/registry.test.ts#config apply with %s config file exits 1 and changes nothing"
        status: pass
      - kind: integration
        ref: "packages/db/test/registry.test.ts#config apply refuses a likely rename, names the rename command and writes nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "One transaction under pg_advisory_xact_lock: concurrent applies serialize, a mid-apply failure rolls back every write"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "packages/db/test/registry.test.ts#serializes two concurrent applies without a unique violation"
        status: pass
      - kind: integration
        ref: "packages/db/test/registry.test.ts#rolls back every write when a later change fails"
        status: pass
    human_judgment: false
  - id: D4
    description: "Update, disable and re-enable semantics (same id on return); pure plan returns [] exactly when registry matches"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "packages/db/test/registry.test.ts#disables a removed slug and re-enables it under the same id when it returns"
        status: pass
      - kind: unit
        ref: "packages/db/test/registry-plan.test.ts#returns no changes when the registry matches config"
        status: pass
    human_judgment: false
  - id: D5
    description: "sift mailbox rename keeps the mailbox id and scoped rows, rejects unknown/existing/invalid slugs; sift mailbox list shows disabled since; no output names the deferred command (D-69)"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "packages/db/test/registry.test.ts#changes only the slug and keeps every scoped row under the same id"
        status: pass
      - kind: integration
        ref: "packages/db/test/registry.test.ts#mailbox rename keeps the id and tells the owner to update config and rerun setup"
        status: pass
      - kind: integration
        ref: "packages/db/test/registry.test.ts#no output of config apply, mailbox list or mailbox rename names the deferred command (D-69)"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-10-04
status: complete
---

# Phase 01 Plan 09: Mailbox Registry Lifecycle Summary

**`sift config apply` reconciles config.yaml into the mailbox registry in one advisory-locked transaction, with a rename-suspect refusal (overridable by `--confirm`). `sift mailbox rename` keeps the mailbox id. `sift mailbox list` reads each status row under app.mailbox_id. A pure registry diff is ready for the worker's drift check.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-10-04T06:36:06Z
- **Completed:** 2026-10-04T06:43:41Z
- **Tasks:** 2
- **Files modified:** 8 (all new)

## Accomplishments

- `@sift/db/registry-plan` is pure and imports types only. `planRegistryChanges` returns adds, updates and enables in config order, then disables in slug order. It returns `[]` exactly when the registry matches config (D-34 reuse). `findRenameSuspects` and `describeChange` are exported alongside it.
- `@sift/db/registry`:
  - `applyConfig` takes `pg_advisory_xact_lock(815309002)`, then runs `select ... for update` and writes with parameterized SQL. A refusal or a no-op rolls back.
  - `renameMailbox` validates the slug first, then updates under the same lock. It maps error 23505 and a 0-row update to owner-facing messages.
  - `listMailboxes` sets `app.mailbox_id` before each mailbox's status read (forced RLS, D-41).
- CLI:
  - `config apply` validates the schema only (D-67) and prints change lines. A refused rename prints the rename command plus its Docker form, "run setup again" and the `--confirm` alternative. A broken or empty config prints "No changes applied." and exits 1.
  - `mailbox list` prints an aligned table. Status is `disabled since <date>`, `ok`, `error: <80 chars>` or `never run`.
  - `mailbox rename` prints the config/setup follow-up.
- The full suite went from 140 to 172 tests, all passing. Typecheck and `biome ci` are clean, and the shipped-source grep for the deferred command finds nothing.

## Task Commits

1. **Task 1 (tracer): `sift config apply` writes the registry and `sift mailbox list` shows it.** Commit `543e61a` (feat). The tracer gate was interactive and end-of-phase, with automated-only verify. I re-ran the verify and it passed, so expansion continued.
2. **Task 2 (TDD): guards, rename, re-enable and disable semantics.**
   - RED `2444e85` (test).
   - GREEN `e1f8974` (feat).
   - No refactor commit was needed.

**Plan metadata:** recorded in the docs commit that follows this SUMMARY.

## Files Created/Modified

- `packages/db/src/registry-plan.ts`: the pure registry diff and change descriptions
- `packages/db/src/owner/registry.ts`: applyConfig, renameMailbox, listMailboxes and CONFIG_APPLY_LOCK_KEY
- `apps/worker/src/commands/config-apply.ts`: `sift config apply [--confirm]`
- `apps/worker/src/commands/mailbox-list.ts`: `sift mailbox list`
- `apps/worker/src/commands/mailbox-rename.ts`: `sift mailbox rename <old> <new>`
- `packages/db/test/registry-plan.test.ts`: 10 pure diff tests
- `packages/db/test/registry.test.ts`: 19 DB and CLI tests covering guards, concurrency, rollback, rename identity and D-69 output
- `apps/worker/test/registry-cli.test.ts`: 3 tracer tests, run with only SIFT_OWNER_DATABASE_URL, SIFT_CONFIG and PATH set

## Decisions Made

- `config apply` uses `loadConfig` only. It skips `applyEnvOverrides` (which only touches models.url) and `checkMailboxEnv` (D-67).
- A refused rename gives one hint block per removed/added pair, and lists unmatched slugs when the counts differ.
- `disabled since` shows the UTC date (`YYYY-MM-DD`).
- `renameMailbox` rejects an old slug equal to the new one. It shares the config-apply advisory lock.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Typing for `inject('testDb')` in an apps/worker test**
- **Found during:** Task 1.
- **Issue:** `tsc -p apps/worker/tsconfig.json` failed with TS2345 on `packages/db/test/support/db.ts`, because the vitest `ProvidedContext` augmentation lives in `packages/db/test/global-setup.ts`, which the worker tsconfig does not include.
- **Fix:** I added `/// <reference path="../../../packages/db/test/global-setup.ts" />` to `apps/worker/test/registry-cli.test.ts`, which is in this plan's files. No tsconfig changes.
- **Verification:** `pnpm typecheck` is clean.
- **Committed in:** `543e61a`.

**2. [Rule 1 - Bug] The CLI rename test's config changed the IMAP username along with the slug**
- **Found during:** Task 2 (GREEN).
- **Issue:** The test YAML derived `username` from the slug. After renaming `jobs` to `job-search`, the next apply showed an `imap_username` update instead of "already matches". The bug was in the test, not in the code.
- **Fix:** The test maps `job-search` to the `jobs` account, so the renamed mailbox keeps its IMAP account.
- **Committed in:** `e1f8974`.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 test bug).
**Impact on plan:** Neither changed scope.

## TDD Gate Compliance

- **RED `2444e85`:** the target test failed on an assertion. In `packages/db/test/registry.test.ts`, the CLI `mailbox rename` test expected exit 0 and got 1, because the command module did not exist yet. `check tdd-red-evidence` returned RED_EVIDENCE_OK (19 tests, 7 failing).
- **GREEN `e1f8974`:** all 32 plan tests pass, and the full suite passes 172 of 172.
- **REFACTOR:** not needed.

## Issues Encountered

None.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- The worker drift check (D-34) can call `planRegistryChanges(config, readRegistry(db))` and treat a non-empty result as drift. `describeChange` gives the lines to list.
- The setup command (D-27) can call the config-apply `run` after migrate.
- The dev database `sift` was not touched. Every apply ran against throwaway test databases.

## Self-Check: PASSED

- All 8 files exist on disk.
- Commits `543e61a`, `2444e85` and `e1f8974` are in `git log`.
- Acceptance greps:
  - `checkMailboxEnv` appears 0 times in config-apply.ts.
  - `pg_advisory_xact_lock` appears 1 time in registry.ts.
  - The runtime-DB-import grep on registry-plan.ts returns 0.
  - `validateSlug` appears 2 times in registry.ts.
  - The deferred-command grep over shipped source exits 1.
- Plan verification: `pnpm vitest run packages/db/test/registry-plan.test.ts packages/db/test/registry.test.ts apps/worker/test/registry-cli.test.ts` passes 32 of 32.

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*
