---
phase: 02-bridge-spike-and-imap-ingest
plan: 13
subsystem: ingest
status: complete
tags: [worker, ingest, imap, postgres, advisory-lock, mailbox-status, tls-pin, backfill, uidvalidity, e2e, tdd]
requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-02 per-mailbox imap.tls and ingest config; 02-05 runBatch(mailbox, signal); 02-06 ingest use-cases; 02-09 createFolderSource; 02-10 runIngest and REMOVAL_DIFF_INTERVAL_MS; 02-12 withIngestLock, IngestSession and status use-cases; 02-18 openImap, closeImap, classifyImapError"
provides:
  - "apps/worker/src/ingest/db-store.ts: createDbStore(session), one session.run per IngestStore method"
  - "apps/worker/src/runtime/mailbox-batch.ts: createMailboxCallbacks(db, secrets, ingest), MailboxIngestOptions, MailboxSyncError, MailboxSyncErrorKind, OwnerMessageContext, ownerMessageFor, STARTUP_GRACE_MS, BRIDGE_INIT_COMMAND"
  - "apps/worker/src/commands/worker.ts: ingest wiring and a pool of max(4, mailboxes + 2) connections"
  - "packages/db/test/support/seed.ts: seedImapMailbox"
  - "apps/worker/test/support/mailbox-harness.ts: config builders, recording log, superuser count/status/folder_sync reads, ownerSql"
  - "apps/worker/test/support/test-imap.ts: expungeMessage"
affects: [02-15, 02-16, 02-19]
actuals:
  tokens: 17400
  tasks: 3
  commits: 5
plan_head_before: e654e61eba475c4d85cf93e577aa067afba54e22
plan_head_after: 8c4ee1eb2c1f1cf1ca428094325a938ecf697b43
tech-stack:
  added: []
  patterns:
    - "IngestStore over IngestSession: every method is exactly one session.run, so a chunk and its watermark move, or a resync's generation switch and backfill cursor, commit together"
    - "IMAP-origin tagging: the FolderSource is wrapped so only errors it threw are classified for the owner; database and engine errors keep the redacted path"
    - "Owner-facing status text is a fixed template over slug, host, port and the password_env name, picked by an exhaustive switch with a never check"
key-files:
  created:
    - apps/worker/src/ingest/db-store.ts
    - apps/worker/test/ingest-e2e.test.ts
    - apps/worker/test/mailbox-batch.test.ts
    - apps/worker/test/support/mailbox-harness.ts
  modified:
    - apps/worker/src/runtime/mailbox-batch.ts
    - apps/worker/src/commands/worker.ts
    - packages/db/test/support/seed.ts
    - apps/worker/test/no-secret-leak.test.ts
    - apps/worker/test/worker.test.ts
    - apps/worker/test/support/test-imap.ts
key-decisions:
  - "02-13: the removal-diff time is set only after a run that actually diffed (or resynced). Setting it after every synced run, as the plan text read, would push the next diff back forever whenever polls come more often than 10 minutes"
  - "02-13: only errors thrown by the FolderSource (and connect errors) become MailboxSyncError; a database error during ingest keeps the redacted recordSyncError path, so a pg ECONNRESET is never shown as 'IMAP server unreachable'. A protocol-class IMAP error on a client that is no longer usable counts as unreachable"
  - "02-13: unclassified errors store the first coded error in the cause chain (the pg error), not Drizzle's 'Failed query: ... params: ...' wrapper, whose params can hold subjects and addresses"
  - "02-13: protocol has its own owner text (`IMAP server at <host>:<port> gave an unexpected response for mailbox <slug>; see the worker log (docker compose logs worker)`); OwnerMessageContext carries the password_env name for the password_missing text"
  - "02-13: a volume hold skips the run when state is needs_attention and approved_new_count is null; with an approval the cap is approved + new_mail_cap and recordSyncSuccess clears both counts"
patterns-established:
  - "Worker-callback tests: seedImapMailbox + a hand-built SiftConfig with the same IMAP identity, a fresh Dovecot user per test, superuser reads through mailbox-harness.ts"
  - "Faults the test server cannot produce are injected through MailboxIngestOptions.openImap (coded errors, a createClient spy, a client whose logout never resolves)"
requirements-completed: [ING-01, ING-02, ING-03, ING-04]
coverage:
  - id: D1
    description: "The worker's own callbacks store new mail from a real IMAP server exactly once, scoped to its mailbox, across polls and a restart, over a pinned STARTTLS connection"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "apps/worker/test/ingest-e2e.test.ts#stores new mail exactly once, scoped to its mailbox, across polls and a restart"
        status: pass
    human_judgment: false
  - id: D2
    description: "Startup grace (connecting), classified unreachable, auth, pin-mismatch, untrusted-cert and no-STARTTLS states with exact owner texts; every failure rejects runBatch; one failing mailbox leaves another ok; no password in last_error"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "apps/worker/test/mailbox-batch.test.ts#startup grace (D-34)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/mailbox-batch.test.ts#classified connection errors (D-33, D-40, D-73)"
        status: pass
      - kind: test
        ref: "apps/worker/test/mailbox-batch.test.ts#ownerMessageFor"
        status: pass
    human_judgment: false
  - id: D3
    description: "A busy lock skips with a log line and no status write; a surge above the cap is held, skipped without connecting, then stored after an approval with the hold cleared; a hung LOGOUT still frees the lock"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "apps/worker/test/mailbox-batch.test.ts#busy lock and volume hold (D-03, D-26)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/mailbox-batch.test.ts#hung logout (02-18, T-02-73)"
        status: pass
    human_judgment: false
  - id: D4
    description: "First backfill in throttled slices with backfill progress 2/5, 4/5, then cleared, next to new mail"
    requirement: ING-03
    verification:
      - kind: integration
        ref: "apps/worker/test/ingest-e2e.test.ts#backfills in throttled slices with visible progress, next to new mail"
        status: pass
    human_judgment: false
  - id: D5
    description: "Forced UIDVALIDITY change: no new message rows, every live location in generation 2, folder_sync ok with the resync summary"
    requirement: ING-04
    verification:
      - kind: integration
        ref: "apps/worker/test/ingest-e2e.test.ts#resyncs after a forced UIDVALIDITY change without new message rows"
        status: pass
    human_judgment: false
  - id: D6
    description: "Flags unchanged by a run (D-11); abort before the run stores nothing and records no error; expired bodies swept; removal diff at most once per 10 minutes"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "apps/worker/test/ingest-e2e.test.ts#read-only, abortable, swept (D-04, D-07, D-11)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/ingest-e2e.test.ts#diffs removals at most once per 10 minutes per mailbox"
        status: pass
    human_judgment: false
  - id: D7
    description: "The spawned worker shows connecting (no error) for an unreachable IMAP host and exits 0 on SIGTERM; no secret persists"
    requirement: ING-01
    verification:
      - kind: integration
        ref: "apps/worker/test/worker.test.ts#starts, records status, stops cleanly"
        status: pass
      - kind: integration
        ref: "apps/worker/test/no-secret-leak.test.ts"
        status: pass
    human_judgment: false
  - id: D8
    description: "ROADMAP success criteria 3-5 on the owner's Proton mailbox through Bridge"
    requirement: ING-04
    verification: []
    human_judgment: true
    rationale: "Proven here on the Dovecot test server only; plan 02-19 runs the worker against the owner's mailbox through Bridge"
duration: 14min
completed: 2026-10-05
---

# Phase 2 Plan 13: Worker Ingest Wiring Summary

**Each worker tick now runs ingest for every due mailbox. It takes the mailbox's advisory lock, checks the mailbox is active and not held, and logs in over STARTTLS with the configured pin. It then runs the sync engine against a database store whose every method is one transaction on the lock's connection. The outcome is recorded as a specific, secret-free mailbox status. End-to-end tests against Dovecot and Postgres prove exactly-once storage across a restart, throttled backfill progress, a UIDVALIDITY resync, unchanged flags, the volume hold and the 10-minute removal cadence.**

## Performance

- **Duration:** 14 min (2026-10-05T20:52:45Z to 21:06:58Z), not counting context loading
- **Tasks:** 3 (a tracer, then two TDD tasks)
- **Files:** 4 created, 6 modified
- **Branch:** commits are on `main`, as intended for this phase (branching_strategy none)

## Accomplishments

- **Database store (`createDbStore`):** each IngestStore method is one `session.run` over the @sift/db use-cases, and no method calls another one.
  - commitChunk stores the chunk and moves the watermark in the same transaction.
  - finishResync switches the generation and writes the recomputed backfill cursor together.
  - markVanished reads the message ids, marks the locations vanished and deletes orphan bodies in one transaction.
- **Mailbox run (`runBatch`):** the steps run in this order.
  1. Find the config entry by IMAP identity (`not_in_config` if there is none).
  2. Read the password from env (`password_missing` if it is not set).
  3. Take `withIngestLock`.
  4. In one `requireActive` transaction, record the mailbox as seen and read the hold.
  5. Call `openImap` with `tls: { mode, pinSha256: pin_sha256 }`.
  6. Run `runIngest`. The cap is `approved + new_mail_cap` when the owner approved a hold. `trustPmHeader` is set for `proton_labels`. Backfill progress goes through its own `session.run`, and `removalDiff` runs at most once per `REMOVAL_DIFF_INTERVAL_MS`.
  7. `closeImap` runs in a `finally` inside the lock.
  8. The outcome becomes a status: `mailbox synced`, `needs_attention` with the held count, or no write for `ingest stopped between chunks`.
- **Owner-visible states:**
  - Unreachable or timeout inside `STARTUP_GRACE_MS` (60 s) records `connecting` with no error.
  - After the grace window, and for every other kind, last_error gets the exact owner text from the plan. `ownerMessageFor` picks it with an exhaustive switch whose `never` check makes a new kind fail typecheck.
  - A busy lock logs `ingest busy (another process holds mailbox)` and writes nothing.
  - A held mailbox logs `waiting for sift mailbox resume <slug>` and does not connect.
- **Worker wiring:** `createMailboxCallbacks(db, secrets, { config, env: io.env, log })` and `maxConnections: Math.max(4, config.mailboxes.length + 2)`. Startup order, logging and exit codes are unchanged.

## Task Commits

1. **Task 1 (tracer): the worker's mailbox run stores new mail exactly once:** `2665cb8` (feat). Tracer gate: the automated verify was re-run after formatting and passed (6/6), so expansion went ahead.
2. **Task 2 (TDD): owner-visible states:** RED `1e48367` (test), GREEN `c1378ba` (feat).
3. **Task 3 (TDD): worker wiring and end-to-end behaviour:** RED `f8cb88f` (test), GREEN `8c4ee1e` (feat).

**Plan metadata:** see the `docs(02-13)` commit that adds this file.

## TDD Gate Compliance

- **Task 2 RED (`1e48367`):** `pnpm vitest run apps/worker/test/mailbox-batch.test.ts` exited 1, with 19 of 25 cases failing on assertions. The not-yet-written exports (`STARTUP_GRACE_MS`, `BRIDGE_INIT_COMMAND`, `ownerMessageFor`) were value-returning scaffolding in the working tree and were never committed. Six cases passed against the tracer, as expected, because Task 1 already gave that behaviour: busy lock, volume hold, hung logout and password redaction. `gsd-tools check tdd-red-evidence` gave `RED_EVIDENCE_OK` (target_test_failed).
- **Task 2 GREEN (`c1378ba`):** 25 of 25 pass, plus the ingest-e2e tracer.
- **Task 3 RED (`f8cb88f`):** the plan-base `mailbox-batch.ts` (Phase 1's no-op batch) was put in the working tree, then restored. Against it, `ingest-e2e.test.ts` and `worker.test.ts` failed 8 of 9 on assertions. The only pass was "missing env fails fast", which is unchanged behaviour. Result: `RED_EVIDENCE_OK`. With Task 1's implementation the new cases pass, because the tracer had already wired the behaviour they check. The GREEN commit adds the pool sizing.
- **Task 3 GREEN (`8c4ee1e`):** the ingest-e2e, worker, worker-errors and mailbox-batch tests pass (34/34), and lint and typecheck exit 0.
- No refactor commits were needed.

## Files Created/Modified

- `apps/worker/src/ingest/db-store.ts`: `createDbStore`
- `apps/worker/src/runtime/mailbox-batch.ts`:
  - `createMailboxCallbacks(db, secrets, ingest)` and `MailboxIngestOptions`
  - `MailboxSyncError`, `MailboxSyncErrorKind`, `OwnerMessageContext` and `ownerMessageFor`
  - `STARTUP_GRACE_MS` and `BRIDGE_INIT_COMMAND`
  - `trackedSource` (IMAP-origin tagging) and `storedError`
- `apps/worker/src/commands/worker.ts`: ingest options and pool size
- `packages/db/test/support/seed.ts`: `seedImapMailbox`
- `apps/worker/test/ingest-e2e.test.ts`: 7 cases (tracer, backfill, resync, flags, abort, sweep, cadence)
- `apps/worker/test/mailbox-batch.test.ts`: 25 cases
- `apps/worker/test/support/mailbox-harness.ts`: shared builders and superuser reads
- `apps/worker/test/support/test-imap.ts`: `expungeMessage`
- `apps/worker/test/no-secret-leak.test.ts` and `worker.test.ts`: the new third argument, and the status they wait for (see Deviations)

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] worker.ts wiring and the spawned-worker tests moved into Task 1**
- **Found during:** Task 1
- **Issue:** The new required third argument of `createMailboxCallbacks` broke `worker.ts`, which Task 3 owns, at typecheck time and at runtime. With real ingest, the example config's host `bridge` no longer resolves, so the spawned worker tests could not reach state `ok` any more.
- **Fix:**
  - Task 1 passed `{ config, env: io.env, log }`. Task 3 then added the pool size.
  - The spawned worker tests now wait for a per-mailbox status. From Task 3 on, `worker.test.ts` requires `connecting` with no last_error, which proves D-34.
  - no-secret-leak keeps all its redaction assertions.
- **Files modified:** apps/worker/src/commands/worker.ts, apps/worker/test/worker.test.ts, apps/worker/test/no-secret-leak.test.ts
- **Commit:** 2665cb8, f8cb88f

**2. [Rule 1 - Bug] Removal-diff cadence time set only after a diff**
- **Found during:** Task 1
- **Issue:** The plan says to set `lastRemovalDiffAt` after every synced or resynced outcome. With the default 60 s poll, the next diff would then be pushed back forever.
- **Fix:** The time is set only after a run that diffed, or after a resync, which checks every location. The Task 3 cadence test checks "10 minutes after the last diff".
- **Files modified:** apps/worker/src/runtime/mailbox-batch.ts
- **Commit:** 2665cb8

**3. [Rule 2 - Correctness] Classify only IMAP failures**
- **Found during:** Task 2
- **Issue:** `classifyImapError` reads codes only. Wrapping every ingest failure would have shown a Postgres `ECONNRESET` as "IMAP server unreachable" and any database error as an IMAP protocol error. Both are misleading states, which the owner explicitly rejects.
- **Fix:** The FolderSource is wrapped to remember the errors it threw, and only those (plus connect errors) become `MailboxSyncError`. A protocol-class error on a client that is no longer `usable` counts as unreachable.
- **Files modified:** apps/worker/src/runtime/mailbox-batch.ts
- **Commit:** c1378ba

**4. [Rule 2 - Security] No mail fields from Drizzle's query text in last_error**
- **Found during:** Task 2
- **Issue:** Drizzle wraps pg errors as `Failed query: <sql> params: ...`, and in ingest those params are subjects and addresses. Stored as is, they would put mail content into the owner-visible status.
- **Fix:** `storedError` stores the first coded error in the cause chain (the pg error), the same error the supervisor logs. Test: "stores the database error, not Drizzle's failed query text with its params".
- **Files modified:** apps/worker/src/runtime/mailbox-batch.ts, apps/worker/test/mailbox-batch.test.ts
- **Commit:** c1378ba

**5. [Rule 2 - Completeness] Owner text for the protocol class and the password_env name**
- **Found during:** Task 2
- **Issue:** The interfaces block lists no text for `protocol`, and its `ctx` has no field for the variable name that the `password_missing` text needs.
- **Fix:** Added a protocol template (host, port, slug and a pointer to the worker log) and an optional `passwordEnv` in `OwnerMessageContext`.
- **Files modified:** apps/worker/src/runtime/mailbox-batch.ts
- **Commit:** c1378ba

**6. [Rule 3 - Blocking] Test support additions**
- **Found during:** Tasks 1 and 3
- **Issue:** Neither test file could share builders or reads with the other, and the test server had no expunge helper for the cadence case.
- **Fix:** Added `apps/worker/test/support/mailbox-harness.ts` (shared by both test files and no-secret-leak) and `expungeMessage` (doveadm expunge).
- **Commit:** 2665cb8, f8cb88f

**Total deviations:** 6 auto-fixed (2 blocking, 1 bug, 3 correctness/security). **Impact:** no scope change. Each fix keeps a plan truth intact: a misleading status, a removal diff that never runs, or mail content in last_error would each have broken one.

## Issues Encountered

- During Task 3's RED setup, `git show $BASE:apps/...` in zsh read `:a` as a history modifier. The bad path made `git show` fail, and the redirect had already emptied two working files. The `git checkout` that followed then discarded the uncommitted `maxConnections` edit in worker.ts. The edit was re-applied before any commit, and the RED run was repeated with `"${BASE}:path"`. Logged in .wolf/buglog.json.

## Known Stubs

None.

## Threat Flags

None. The connections and writes are the ones in the plan's threat model:
- T-02-43: fixed owner texts, plus the redaction path and `storedError`
- T-02-44: pinned openImap, with a pin-mismatch test proving no client is created
- T-02-45: every write through `session.run`
- T-02-46: the volume hold
- T-02-73: the hung-logout test

## User Setup Required

None.

## Next Phase Readiness

- 02-16 (CLI backfill, `sift mailbox resume`, the listing) can rely on these behaviours:
  - The worker skips a mailbox in `needs_attention` until `approved_new_count` is set.
  - With an approval it processes up to approved + cap.
  - It logs `ingest busy (another process holds mailbox)` while a CLI backfill holds the lock.
- 02-19 runs this worker against the owner's Proton mailbox through Bridge for ROADMAP success criteria 3 to 5.

## Self-Check: PASSED

- FOUND: apps/worker/src/ingest/db-store.ts, apps/worker/test/ingest-e2e.test.ts, apps/worker/test/mailbox-batch.test.ts, apps/worker/test/support/mailbox-harness.ts
- FOUND commits: 2665cb8, 1e48367, c1378ba, f8cb88f, 8c4ee1e
- Plan verification: `scripts/test-imap.sh up && pnpm vitest run apps/worker` and the full `pnpm test` pass (44 files, 810 tests), and `pnpm lint` and `pnpm typecheck` exit 0
- Acceptance greps (Tasks 1 to 3) all match, and the negative greps for pg, drizzle-orm, internalsOf and packages/db/src under apps/worker/src find nothing
