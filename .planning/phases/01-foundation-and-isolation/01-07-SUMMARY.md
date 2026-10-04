---
phase: 01-foundation-and-isolation
plan: 07
subsystem: database
tags: [drizzle, postgres, rls, scoped-api, isolation, pg-pool]

requires:
  - phase: 01-03
    provides: scoped Drizzle schema, migrations, per-file test DB clones, seedMailboxes/seedScopedRows
  - phase: 01-04
    provides: redactText from @sift/core/log
provides:
  - createAppDb (opaque AppDb over pg.Pool + drizzle, pool error handler)
  - withMailbox with transaction-local app.mailbox_id and a closable Scope
  - per-table scoped helpers (message, label, folderSync, ruleSet), append-only helpers (decision, labelEvent), mailboxStatus get/upsert
  - requireActive + MailboxDisabledError / MailboxNotFoundError / InvalidMailboxIdError / ScopeClosedError
  - recordMailboxSeen / recordSyncSuccess / recordSyncError (redacted) / recordDisabled
  - readRegistry (unscoped mailbox registry read)
affects: [01-08, 01-09, worker, ingest, classify, apply-labels]

actuals:
  tokens: 8695
  tasks: 2
  commits: 3
plan_head_before: 8f52e3e8a7c65994861dd52f6e012e1352af8714
plan_head_after: ef8056d727ad89ad12eaf289e0017ead1443aad9

tech-stack:
  added: []
  patterns:
    - "Opaque handles: AppDb and Scope internals live in module-private WeakMaps; app code only ever sees helpers"
    - "Generic scopedTable(ctx, table) adds eq(table.mailboxId, scope) to every find/update/delete and fills mailboxId on insert"
    - "Append-only tables get a helper object with only insert and find (D-40 at the type level)"

key-files:
  created:
    - packages/db/src/app-db.ts
    - packages/db/src/scope.ts
    - packages/db/src/status.ts
    - packages/db/src/registry-read.ts
    - packages/db/test/scope.test.ts
  modified:
    - packages/db/src/index.ts

key-decisions:
  - "Empty update set / empty upsert values are a no-op touch (set mailbox_id = mailbox_id, or updated_at = now()) instead of a Drizzle 'no values' error"
  - "Helpers reject mailboxId/id in update sets and mailboxId or unknown keys in Match at runtime too (defence beyond the types)"
  - "Scope and its table helpers are frozen objects; a Scope is closed in finally once the callback settles"
  - "AppDb.close() is idempotent (memoized pool.end())"

patterns-established:
  - "App data access: withMailbox(db, id, async (s) => s.<table>.<op>(...)); no raw SQL through the scope"
  - "Worker status writes go through status.ts use-cases, never mailboxStatus.upsert with raw error text"

requirements-completed: [ISO-04]

coverage:
  - id: D1
    description: "withMailbox opens a transaction, sets app.mailbox_id transaction-locally and hands fn a helper-only Scope"
    requirement: ISO-04
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#writes a message under A and reads it back only under A"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#hands the callback only per-table helpers"
        status: pass
    human_judgment: false
  - id: D2
    description: "Helpers filter by mailbox_id themselves: on an RLS-bypassing superuser connection find/update/delete under A only see and touch A rows"
    requirement: ISO-04
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#find() under A returns exactly A rows on every scoped table"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#a match on a B id under A finds, updates and deletes nothing"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#update({}) under A touches only A rows"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#delete() under A removes only A rows"
        status: pass
    human_judgment: false
  - id: D3
    description: "Insert omits mailboxId, update cannot set mailboxId/id, decision/labelEvent expose only insert/find (type level)"
    requirement: ISO-04
    verification:
      - kind: unit
        ref: "pnpm typecheck (5 @ts-expect-error in scope.test.ts, each confirmed to suppress TS2353/TS2339)"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#keeps cross-mailbox writes and append-only mutations out of the types"
        status: pass
    human_judgment: false
  - id: D4
    description: "Concurrent scopes on one pool stay isolated; a throwing callback rolls back and leaves no mailbox on the connection"
    requirement: ISO-04
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#runs concurrent scopes for A and B on one pool, each seeing only its own rows"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#rolls back when the callback throws and leaves no mailbox on the connection"
        status: pass
    human_judgment: false
  - id: D5
    description: "Guards: InvalidMailboxIdError before any query, ScopeClosedError after the callback, requireActive / MailboxDisabledError / MailboxNotFoundError (D-45)"
    requirement: ISO-04
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#guards"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#requireActive (D-45)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Status use-cases: single-row upsert, redacted + truncated last_error, success reset, seen and disabled"
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#mailbox status use-cases (D-07, D-51)"
        status: pass
    human_judgment: false
  - id: D7
    description: "readRegistry and the exact @sift/db export surface (no pool/client/orm export); Biome still rejects drizzle-orm under apps/worker/src"
    requirement: ISO-04
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#returns every mailbox row ordered by slug as sift_app, disabled ones included"
        status: pass
      - kind: unit
        ref: "packages/db/test/scope.test.ts#exports exactly the scoped API and nothing that yields a pool, client or orm"
        status: pass
      - kind: other
        ref: "biome lint apps/worker/src/zz-restricted-probe.ts (drizzle-orm import) exits non-zero"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-04
status: complete
---

# Phase 01 Plan 07: Scoped Data-Access API Summary

**`withMailbox` over an opaque pg-pool handle, with frozen per-table helpers that fill and filter `mailbox_id` themselves. A superuser connection that bypasses RLS proves the filter works on its own. The plan also adds append-only helper types, `requireActive`, status use-cases that redact `last_error`, and an unscoped registry read.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-10-04T06:17:52Z
- **Completed:** 2026-10-04T06:23:43Z
- **Tasks:** 2 (tracer + TDD)
- **Files modified:** 6

## Accomplishments
- `createAppDb` returns an object that exposes only `close()`. The pool and Drizzle instance sit in a module-private WeakMap, and the pool has an `error` handler that warns with the error code only.
- `withMailbox` validates the UUID, opens a transaction and runs `set_config('app.mailbox_id', $1, true)`. The callback gets a frozen Scope with `message/label/folderSync/ruleSet` (insert/find/update/delete), `decision/labelEvent` (insert/find only) and `mailboxStatus` (get/upsert). The Scope closes when the callback settles.
- ISO-04 without RLS: the same tests run on a superuser connection, and find/update/delete under A return and change only A rows. Matching on a B id under A finds, updates and deletes nothing.
- `requireActive` and `{ requireActive: true }` throw `MailboxDisabledError('mailbox "<slug>" is disabled')` before the callback runs. A disabled mailbox can still be scoped for reads (D-45).
- `recordSyncError` passes the error text through `redactText` with the given secrets and cuts it to 1000 characters (D-51). `readRegistry` returns every mailbox ordered by slug.
- The `@sift/db` root export surface is pinned by a test. `internalsOf` is not exported, and the Biome probe still rejects `drizzle-orm` imports under `apps/worker/src`.

## Task Commits

1. **Task 1: Tracer, withMailbox + message helper as sift_app under RLS:** `01b048c` (feat)
   - Tracer gate: interactive, `end-of-phase`, automated-only verify. Verify was re-run and passed before expansion.
2. **Task 2: All scoped tables, append-only/status helpers, requireActive, registry read, no-RLS proof (TDD)**
   - RED: `d3ab64c` (test). 19 target tests failed on the missing behavior; 5 covered Task 1 behavior and passed.
   - GREEN: `ef8056d` (feat). 23/23 pass.
   - REFACTOR: none needed.

**Plan metadata:** see the docs(01-07) commit that follows.

## Files Created/Modified
- `packages/db/src/app-db.ts`: `createAppDb`, opaque `AppDb`, `AppDbOptions`, internal `internalsOf`
- `packages/db/src/scope.ts`: `withMailbox`, the generic `scopedTable` / `appendOnlyTable` / `mailboxStatusApi` helpers, `requireActive`, the four error classes and the API types
- `packages/db/src/status.ts`: `recordMailboxSeen`, `recordSyncSuccess`, `recordSyncError` (redacted, at most 1000 chars), `recordDisabled`
- `packages/db/src/registry-read.ts`: `readRegistry`, `RegistryRow`
- `packages/db/src/index.ts`: exports the scoped API next to `requireDatabaseUrl`, and nothing that yields a pool, client, ORM or transaction
- `packages/db/test/scope.test.ts`: 23 tests (495 lines), including the no-RLS proof, concurrency, rollback, the guards, the status use-cases, the registry read, the export surface and 5 `@ts-expect-error` checks

## Decisions Made
- An empty update set or empty upsert values counts as a touch: `mailbox_id = mailbox_id`, or `updated_at = now()` for upsert. Drizzle throws on an empty SET, and the plan's `update({})` behavior needs this.
- The type-level restrictions are repeated at runtime. Update sets that contain `mailboxId`/`id`, and Match keys that are `mailboxId` or unknown, throw `TypeError`, so a cast cannot get around them.
- An empty `insert([])` returns `[]` without a query, because Drizzle rejects empty values.
- `AppDb.close()` is idempotent.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The concurrency test waits with a JS delay, not `pg_sleep`**
- **Found during:** Task 2
- **Issue:** The Scope deliberately has no raw-SQL escape hatch (D-43), so the test cannot call `pg_sleep(0.2)` inside the transaction.
- **Fix:** The callback awaits a 200 ms `node:timers/promises` delay between `set_config` and `find()`, with the pool at `maxConnections: 2`. The test records event order to prove both transactions were open at the same time.
- **Files modified:** packages/db/test/scope.test.ts
- **Committed in:** d3ab64c

**2. [Rule 2 - Missing critical] Runtime guards on the helper inputs**
- **Found during:** Task 1/2
- **Issue:** The types alone do not stop `mailboxId`/`id` reaching an update or upsert through a cast.
- **Fix:** Helpers throw `TypeError` for those keys, and for `mailboxId` or unknown Match keys. The tests cover update with `mailboxId` and with `id`.
- **Files modified:** packages/db/src/scope.ts
- **Committed in:** 01b048c, ef8056d

**3. [Test design] The disabled-mailbox test uses its own mailbox (`scope-c`) instead of disabling A**
- Keeps the A/B fixtures active for the other suites. It checks the same behavior (D-45).

**4. [Test strengthening] The rollback test checks the pooled connection directly**
- With `maxConnections: 1`, the test imports the internal `internalsOf` (inside packages/db, not exported) and asserts that `current_setting('app.mailbox_id', true)` is empty after the scopes end.

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical) plus 2 test-design adjustments
**Impact on plan:** No scope creep. All of them support T-01-25/T-01-26/T-01-27.

## TDD Gate Compliance
- RED `test(01-07)` d3ab64c comes before GREEN `feat(01-07)` ef8056d. No REFACTOR commit was needed.

## Issues Encountered
None. The Biome formatter rewrapped two files before commit, and the lefthook pre-commit and commitlint hooks passed on every commit.

## User Setup Required
None. No external service configuration is needed.

## Next Phase Readiness
- Plans 01-08 and 01-09 (worker and CLI) can use `createAppDb`, `withMailbox`, `requireActive`, the status use-cases and `readRegistry` from `@sift/db`.
- The full suite passes 131/131. `pnpm typecheck` and `pnpm lint` are clean.

## Self-Check: PASSED
- Created files exist: app-db.ts, scope.ts, status.ts, registry-read.ts, scope.test.ts (all FOUND)
- Commits exist: 01b048c, d3ab64c, ef8056d (all FOUND)
- Acceptance: one `set_config('app.mailbox_id', ${mailboxId}, true)` call; 0 `Pool|internalsOf` exports in index.ts; 5 `@ts-expect-error`; `redactText` used in status.ts; `adminUrl` + `createAppDb` no-RLS test present

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*
