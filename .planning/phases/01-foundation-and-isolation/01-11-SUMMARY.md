---
phase: 01-foundation-and-isolation
plan: 11
subsystem: worker
tags: [worker, startup, drift, postgres, retry, rls, secrets, sentinel, vitest]

requires:
  - phase: 01-07
    provides: createAppDb, internalsOf, readRegistry, createMailboxCallbacks inputs
  - phase: 01-09
    provides: planRegistryChanges, describeChange (@sift/db/registry-plan), applyConfig (@sift/db/registry)
  - phase: 01-10
    provides: sift worker command, createMailboxCallbacks, supervisor, heartbeat
provides:
  - "checkDrift(db, config): registry difference lines; worker exits 1 on drift and names `docker compose run --rm setup` (D-34)"
  - "@sift/db/connect: classifyConnectError, connectWithRetry, assertUnprivilegedRole, DatabaseStartupError (D-55, T-01-43, T-01-45)"
  - "Worker startup order: config -> password_env -> connectWithRetry -> assertUnprivilegedRole -> checkDrift -> supervisor"
  - "Sentinel test proving mailbox passwords never reach config files, any table row or process output (FND-02, success criterion 2)"
affects: [01-12 compose restart policy and target-machine checkpoint, phase 02 IMAP ingest]

actuals:
  tokens: 8145
  tasks: 3
  commits: 4
plan_head_before: 887c324c768f355a724c77efaed2f69c45b0f2c3
plan_head_after: 49cf36fdf101df03fd50e88caf3af49cea0601db

tech-stack:
  added: []
  patterns:
    - "Startup errors are mapped from their code to a fixed message; the driver's message (which can quote connection details) is never passed through"
    - "Each connect attempt is raced against the remaining deadline so a black-holed host cannot hang startup"
    - "Secret scans read the table list from pg_tables and carry a positive control"

key-files:
  created:
    - apps/worker/src/runtime/startup.ts
    - packages/db/src/connect.ts
    - apps/worker/test/drift.test.ts
    - packages/db/test/connect.test.ts
    - apps/worker/test/no-secret-leak.test.ts
  modified:
    - apps/worker/src/commands/worker.ts

key-decisions:
  - "Each connect attempt is bounded by the remaining deadline (treated as ETIMEDOUT), so the ~30 s budget holds even when packets are dropped"
  - "Fatal codes without a mapped message become 'database connection failed (<code>)'; the driver message is never logged"
  - "The sentinel scan covers every non-system schema from pg_tables (a superset of public and drizzle) and asserts both are present"
  - "The role guard runs before the drift check, so a superuser URL is refused before any registry read"

patterns-established:
  - "Worker startup guards return 1 through the existing try/finally so the pool is always closed"

requirements-completed: [FND-02, FND-01, ISO-02]

coverage:
  - id: D1
    description: "The worker exits 1 before scheduling when config.yaml differs from the registry, logs each difference and names `docker compose run --rm setup`; no mailbox_status row is written"
    requirement: FND-01
    verification:
      - kind: integration
        ref: "apps/worker/test/drift.test.ts#refuses on drift"
        status: pass
      - kind: integration
        ref: "apps/worker/test/worker.test.ts#starts, records status, stops cleanly"
        status: pass
    human_judgment: false
  - id: D2
    description: "Startup retries only ECONNREFUSED/ENOTFOUND/EAI_AGAIN/ETIMEDOUT/ECONNRESET/57P03 with jittered backoff until the deadline; 28P01 and 3D000 fail fast with messages that name SIFT_DATABASE_URL and never contain the URL or password"
    requirement: FND-01
    verification:
      - kind: unit
        ref: "packages/db/test/connect.test.ts#classifyConnectError"
        status: pass
      - kind: integration
        ref: "packages/db/test/connect.test.ts#fails fast on a wrong password without leaking it (28P01)"
        status: pass
      - kind: integration
        ref: "packages/db/test/connect.test.ts#fails fast on a database that does not exist (3D000)"
        status: pass
      - kind: integration
        ref: "packages/db/test/connect.test.ts#retries a closed port with backoff until the deadline"
        status: pass
    human_judgment: false
  - id: D3
    description: "The worker refuses to run as a superuser or BYPASSRLS role, in-process and as a spawned process, writing no mailbox_status rows"
    requirement: ISO-02
    verification:
      - kind: integration
        ref: "packages/db/test/connect.test.ts#refuses a superuser and names the role"
        status: pass
      - kind: integration
        ref: "packages/db/test/connect.test.ts#the worker exits 1 when SIFT_DATABASE_URL is a superuser URL"
        status: pass
    human_judgment: false
  - id: D4
    description: "Sentinel mailbox passwords appear in no config file, no row of any table (pg_tables) and no process output after config apply, a worker run and a redacted mailbox failure"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "apps/worker/test/no-secret-leak.test.ts (5 tests incl. positive control)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 11: Worker Startup Guards and Secret Sentinel Summary

**`sift worker` now connects with D-55 classified retry (only self-resolving errors, about 30 s, jittered backoff), refuses superuser/BYPASSRLS roles, and refuses to start when config.yaml drifts from the registry. A sentinel test proves mailbox passwords never reach config files, any table row or process output.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-04T06:57:17Z
- **Completed:** 2026-10-04T07:03:46Z
- **Tasks:** 3
- **Files modified:** 6 (5 new, 1 modified)

## Accomplishments

- On drift, the worker logs one JSON error line. The line carries a `differences` array (for example `update mailbox "personal": imap_port 1143 -> 1144` and `add mailbox "side"`) and the message `config.yaml differs from the mailbox registry; apply it with: docker compose run --rm setup`. The worker then exits 1 without writing any status.
- `@sift/db/connect` adds `classifyConnectError`, `connectWithRetry`, `assertUnprivilegedRole` and `DatabaseStartupError`:
  - Retries back off from 250 ms, doubling to a 5 s cap with ±20% jitter. Each retry logs `database not ready; retrying` with `{ code, attempt }`.
  - When the deadline passes, startup fails with `database not reachable after <s> s (<code>)`.
- Fatal startup errors carry fixed messages. 28P01 points the owner at `SIFT_DATABASE_URL / SIFT_DB_APP_PASSWORD`, 3D000 at the database name, and 42501/28000 at the role. The driver's own message is never passed through, so a URL or password cannot leak.
- The worker's startup order is now: config, password_env check, connect, role guard, drift check, supervisor.
- The sentinel test runs random passwords through three paths: `sift config apply`, a real worker run, and an in-process `onBatchError` whose message quotes the password. It then scans the temp and repo `config/` files, every captured output stream, and every row of every table listed in `pg_tables`. It also checks that `last_error` holds `[REDACTED]`.

## Task Commits

1. **Task 1: Tracer: the worker refuses on drift.** `08ba285` (feat). The tracer gate re-ran `<verify>` after formatting, and it passed.
2. **Task 2: Classified connect retry and the role guard (TDD)**
   - RED `2e350a9` (test). The suite failed because `../src/connect.ts` did not exist yet.
   - GREEN `cb70b18` (feat). All 19 connect tests pass, and so do worker.test.ts and drift.test.ts.
3. **Task 3: Sentinel test.** `49cf36f` (test).

**Plan metadata:** see the docs commit that follows.

## Files Created/Modified

- `apps/worker/src/runtime/startup.ts`: `checkDrift(db, config)`.
- `packages/db/src/connect.ts`: the `@sift/db/connect` module. The export already existed in packages/db/package.json.
- `apps/worker/src/commands/worker.ts`: runs `connectWithRetry`, `assertUnprivilegedRole` and `checkDrift` between `createAppDb` and `createSupervisor`. A `DatabaseStartupError` is logged as `{ code }` plus its message, and the worker exits 1.
- `apps/worker/test/drift.test.ts`: spawns the worker against a drifted config.
- `packages/db/test/connect.test.ts`: classification table, live 28P01/3D000/closed-port cases, the role guard in-process, and the worker process run with the admin URL.
- `apps/worker/test/no-secret-leak.test.ts`: the FND-02 sentinel test.

## Decisions Made

- Each connection attempt is raced against the remaining deadline. If it runs out, the attempt counts as ETIMEDOUT. Without this, a host that drops packets could keep `pool.query` pending well past the ~30 s budget.
- The role guard runs before the drift check. A privileged URL is therefore refused before the worker reads anything.
- The sentinel scan covers every schema except `pg_catalog` and `information_schema`. It asserts that `public` and `drizzle` are among them, so new schemas are scanned automatically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Per-attempt deadline bound in connectWithRetry**
- **Found during:** Task 2
- **Issue:** The plan bounds the retry loop, not each attempt. pg has no default connect timeout, so one hung attempt could exceed the deadline (T-01-47).
- **Fix:** `bounded()` races each `select 1` against the remaining deadline and rejects with code ETIMEDOUT (retryable). The abandoned promise gets a no-op catch.
- **Files modified:** packages/db/src/connect.ts
- **Verification:** connect.test.ts passes. The closed-port case ends within its 1.5 s deadline.
- **Committed in:** cb70b18

**2. [Rule 2 - Missing critical] Safe fallbacks for unmapped fatal errors and an unreadable role**
- **Found during:** Task 2
- **Issue:** The interfaces block lists messages only for 28P01, 3D000, 42501 and 28000. Passing any other driver message through could leak connection details (T-01-45).
- **Fix:** Any other fatal error becomes `database connection failed (<code or "no error code">)`. `assertUnprivilegedRole` also throws when it cannot read the current role's row.
- **Files modified:** packages/db/src/connect.ts
- **Committed in:** cb70b18

**3. [Rule 3 - Blocking] The sentinel test quotes identifiers in SQL instead of importing pg**
- **Found during:** Task 3
- **Issue:** `import pg from 'pg'` failed in apps/worker/test because @sift/worker has no `pg` dependency. Adding one would mean a package change outside files_modified.
- **Fix:** The table list query returns `quote_ident(schemaname) || '.' || quote_ident(tablename)`.
- **Files modified:** apps/worker/test/no-secret-leak.test.ts
- **Committed in:** 49cf36f

---

**Total deviations:** 3 auto-fixed (2 missing critical, 1 blocking)
**Impact on plan:** All three tighten secret hygiene or bound startup time. The interfaces match the plan. No scope creep.

## Issues Encountered

- An unexpected error from `checkDrift`, after connect and the role check have succeeded, still goes to `cli.ts`'s generic handler, which prints `error.message` to stderr. pg query errors do not include the connection string, and this path needs the database to fail between two queries. It is noted here for Phase 2 hardening and was not changed.

## Known Stubs

None.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness

- 01-12 can rely on the worker exiting 1 for drift, a privileged role or an unreachable database after about 30 s. The Compose restart policy covers the rest (D-55). The human half of success criterion 2 (grep `config/` and the `pg_dump` output for a sentinel) remains for the target-machine checkpoint.
- Full suite: 213/213 passing. `pnpm typecheck` and `pnpm lint` exit 0. No worker processes left running, and every test database was dropped by its own test.

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED
