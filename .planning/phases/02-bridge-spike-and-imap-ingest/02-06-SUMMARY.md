---
phase: 02-bridge-spike-and-imap-ingest
plan: 06
subsystem: database
tags: [postgres, drizzle, upsert, on-conflict, ingest, rls, iso-04]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-03 message/message_location/message_body/folder_sync schema with checks, FORCE RLS and grants"
  - phase: 01
    provides: "scoped API (withMailbox, ScopedTableApi, appendOnlyTable) and status.ts use-case style"
provides:
  - "ScopedTableApi.insertOrIgnore(rows, { target }) and .upsert(rows, { target, update }) on mutable scoped tables only"
  - "Array-valued Match (inArray, empty array runs no SQL) and Scope.messageBody.deleteExpired(at)"
  - "@sift/db ingest use-cases: storeMessages, getFolderSync, createFolderSync, advanceFolderSync, setFolderBackfill, liveLocations, markLocationsRemoved, deleteOrphanBodies, knownIdentityKeys, beginResync, finishResync, deleteExpiredBodies"
  - "Types MessageInput, LocationInput, BodyInput, StoreItem, StoreResult, StoreOptions, FolderSyncRow, LiveLocation, ResyncSummary, AttachmentMeta, BackfillCursor"
affects: [02-07, 02-10, 02-13, 02-19, phase-03, phase-04]

actuals:
  tokens: 15143
  tasks: 2
  commits: 3
plan_head_before: 84da27b7067fa1b5ec5ab2392e73495424803494
plan_head_after: 813741ae4aeb8861a45d6964c16e9ab6929b50f2

tech-stack:
  added: []
  patterns:
    - "Batch writes match RETURNING rows to inputs by key columns, never by array index"
    - "Messages and bodies use ON CONFLICT DO NOTHING so re-ingest leaves updated_at untouched; locations use DO UPDATE with deduplicated keys"
    - "Ingest use-cases take scope first and open no transaction; multi-statement atomicity is the caller's single scope"

key-files:
  created:
    - packages/db/src/ingest.ts
    - packages/db/test/ingest.test.ts
  modified:
    - packages/db/src/scope.ts
    - packages/db/src/index.ts
    - packages/db/test/scope.test.ts

key-decisions:
  - "upsert's inserted flag uses RETURNING (xmax = 0); assumption A1 held on PG 18.6 with Drizzle 0.45.3, so the select-before-insert fallback was not needed"
  - "markLocationsRemoved only marks live locations (removed_at is null), so a location keeps its first removal time and reason"
  - "advanceFolderSync reads then writes in app code (monotonic max), writes nothing when no value moves forward, and throws if asked to move a backfill cursor that is not pending"
  - "Array Match values may not contain null (TypeError); null still means IS NULL as a scalar"
  - "storeMessages does not enforce that an eligible message has a body: supplying it is the caller's job (02-07 toBodyText always yields one)"

patterns-established:
  - "Conflict helpers: mailbox_id prepended to every conflict target and filled into every row; mailboxId/id/timestamps refused in rows, targets and update lists"
  - "A 'runs no SQL' proof: after a refused call, a later statement in the same scope still succeeds (a failed statement would abort the transaction with 25P02)"

requirements-completed: [ING-02, ING-04]

coverage:
  - id: D1
    description: "storeMessages stores message, location and body idempotently; a rerun inserts nothing and keeps message updated_at"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#is idempotent: a rerun inserts nothing and keeps every message updated_at"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#writes the message, its location and its body for each eligible item"
        status: pass
    human_judgment: false
  - id: D2
    description: "Identity merge (D-14) and key-based matching: same key in one call gives one message with two locations; shuffled order attaches every location to its own key's message; repeated location is one row"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#merges two UIDs of one identity key in one call into one message with two locations"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#attaches every location to the message of its own identity key, whatever the order"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#stores the same (folder, uidvalidity, uid) twice in one call as one location"
        status: pass
    human_judgment: false
  - id: D3
    description: "Scoped conflict helpers: upsert refuses repeated keys and empty update lists before SQL, forbidden keys rejected, append-only tables lack both helpers, empty array match runs no SQL"
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#refuses an upsert whose rows repeat a conflict key, before any SQL"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#keeps insertOrIgnore and upsert off the append-only tables (D-40)"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#matches nothing and runs no SQL for an empty array value"
        status: pass
    human_judgment: false
  - id: D4
    description: "ISO-04: insertOrIgnore, upsert, array match and deleteExpired on a superuser (RLS-bypassing) handle touch only the scope's mailbox"
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#insertOrIgnore and upsert under A conflict only with A rows (T-02-21)"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#an array match under A that names B ids finds, updates and deletes only A rows"
        status: pass
      - kind: integration
        ref: "packages/db/test/scope.test.ts#messageBody.deleteExpired under A leaves expired B bodies alone"
        status: pass
    human_judgment: false
  - id: D5
    description: "Eligibility and body rules (D-21, D-02, Pitfall 7): historical gets no body, promoteEligible promotes and adds the body, empty-text body row, NUL stripped"
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#promotes a stored historical message and stores its body with promoteEligible (D-02)"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#stores an eligible message without a text part with one body row of empty text"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#strips NUL from the subject, header values and attachment names (Pitfall 7)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Folder sync state: get/create, monotonic advance, backfill write/clear/replace (D-18, D-75)"
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#never moves last_uid, the watermark or the backfill cursor backwards"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#writes, clears and replaces all four backfill columns together"
        status: pass
    human_judgment: false
  - id: D7
    description: "Removal, orphan-body and expiry lifecycle (D-07, D-17)"
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#deletes a body only when its message has no live location and no decision"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#deletes only expired bodies, and none of another mailbox"
        status: pass
    human_judgment: false
  - id: D8
    description: "Generation resync: beginResync/finishResync supersede vs vanish, orphan bodies deleted, folder_sync settled with summary and backfill in one call (ING-04, D-23..D-25, D-75)"
    requirement: ING-04
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#finishResync supersedes matched locations, vanishes the rest and settles folder_sync"
        status: pass
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#finishResync replaces, clears or keeps the backfill cursor in the same call (D-75)"
        status: pass
    human_judgment: false

duration: 8min
completed: 2026-10-05
status: complete
---

# Phase 2 Plan 06: Ingest Use-Cases over the Scoped API Summary

**Mailbox-scoped `insertOrIgnore` and `upsert` (ON CONFLICT with `mailbox_id` prepended to the target, repeated keys refused before SQL), array-valued Match, and twelve `@sift/db` ingest use-cases. `storeMessages` merges identity keys, matches rows by key and never by position, and a rerun changes nothing. The other use-cases cover folder sync state, removals, the generation resync and the body-cache lifecycle.**

## Performance

- **Duration:** 8 min (measured from the ledger point after context loading)
- **Started:** 2026-10-05T18:29:34Z
- **Completed:** 2026-10-05T18:37:55Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `ScopedTableApi.insertOrIgnore` / `.upsert` on the mutable scoped tables only; `decision` and `labelEvent` still expose just `insert` and `find`.
- `storeMessages` deduplicates identity keys before its single message INSERT and looks message ids up by identity key. Locations and bodies are paired with the right message regardless of RETURNING order (T-02-64, T-02-65).
- `finishResync` swaps generations (superseded vs vanished), deletes orphan bodies and settles `folder_sync`. The persisted summary and the optional backfill cursor are written in the caller's one scope.
- Real-database tests: 26 in `ingest.test.ts` and 3 new ISO-04 proofs on an RLS-bypassing handle in `scope.test.ts`.

## Task Commits

1. **Task 1: Tracer, storeMessages through withMailbox** - `ca5cafa` (feat)
2. **Task 2: Folder state, removals, resync and body-cache use-cases**
   - RED: `a32c81a` (test)
   - GREEN: `813741a` (feat)

No refactor commit was needed.

## Files Created/Modified

- `packages/db/src/scope.ts` - `insertOrIgnore`, `upsert`, `UniqueKey`/`ConflictRow` types, array Match via `inArray` with empty-array short-circuit, `MessageBodyApi.deleteExpired`
- `packages/db/src/ingest.ts` - the twelve ingest use-cases, `stripNul`, input/result types
- `packages/db/src/index.ts` - re-exports of the use-cases and types
- `packages/db/test/ingest.test.ts` - real-database tests of every use-case
- `packages/db/test/scope.test.ts` - ISO-04 tests for the conflict helpers, array match and deleteExpired; export-surface list updated

## Decisions Made

- `(xmax = 0)` in RETURNING works for the `inserted` flag (assumption A1 held), so the select-before-insert fallback was not built.
- `markLocationsRemoved` restricts itself to live locations, so an already-removed location keeps its first removal time and reason. The return value is the number actually marked.
- `advanceFolderSync` is monotonic in app code (read, then write only the values that move forward), so a call that changes nothing writes nothing. It throws if asked to move a backfill cursor while no backfill is pending. The DB check would reject that anyway; the error just makes it explicit.
- An array Match value holding null throws TypeError. Scalar `null` still means IS NULL.
- `storeMessages` does not enforce a body for each eligible message. Supplying it is the caller's job, and 02-07's toBodyText always produces one.
- Committed directly to `main` (branching_strategy=none), as the orchestrator intended for this phase.

## Deviations from Plan

None. The plan executed as written. Updating the `@sift/db export surface` test in scope.test.ts to list the new exports was needed for the planned exports, not a change in scope.

## TDD Gate Compliance

- Task 2 RED (`a32c81a`): 15 tests failed: 14 ingest use-case tests (the functions did not exist yet, `TypeError: <fn> is not a function`) and the export-surface test. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target `packages/db/test/ingest.test.ts`, 66 tests, 15 failing).
- Some Task 2 behavior cases passed in RED because Task 1's tracer implementation already covered them: same-key merge, the repeated-location dedup, the upsert TypeError, append-only exclusion, NUL stripping, the empty-text body and the ISO-04 proofs. They are kept as regression tests.
- GREEN (`813741a`): all 80 ingest/scope/isolation tests pass.

## Issues Encountered

None. The full `pnpm test` run (32 files, 506 tests) passed on the first try, so the known intermittent failure did not show and could not be identified. The single `pnpm lint` warning (`noTemplateCurlyInString` in `apps/worker/test/node-version.test.ts`) predates this plan and is out of scope.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 02-10 (sync engine) and 02-13 (worker IngestStore) can call these use-cases directly. Each IngestStore method should map to one `withMailbox` scope (one `session.run`) so that `finishResync` stays atomic.
- Phase 4 readers must treat `folder_sync.state = 'resyncing'` as "do not act" (D-24). This is documented on `liveLocations`.

## Self-Check: PASSED

- FOUND: packages/db/src/ingest.ts, packages/db/test/ingest.test.ts, packages/db/src/scope.ts, packages/db/src/index.ts, packages/db/test/scope.test.ts
- FOUND commits: ca5cafa, a32c81a, 813741a

---
*Phase: 02-bridge-spike-and-imap-ingest*
*Completed: 2026-10-05*
