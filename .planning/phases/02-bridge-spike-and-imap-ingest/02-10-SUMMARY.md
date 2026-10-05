---
phase: 02-bridge-spike-and-imap-ingest
plan: 10
subsystem: ingest
status: complete
tags: [ingest, sync-engine, uidvalidity, resync, backfill, watermark, volume-valve, generations, tdd]

requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-07 ingest contracts (FolderSource, IngestStore, FolderState, ChunkAdvance, IngestOutcome, ResyncCounts) and message.ts (parseMessage, selectTextPart, toBodyText, BODY_DOWNLOAD_MAX_BYTES); 02-06 ingest use-case semantics mirrored by the fake store; 02-09 FolderSource behaviour (failed searches throw, n:* returns the highest UID)"
provides:
  - "apps/worker/src/ingest/plan.ts: isCandidateNew, aboveLastUid, chunk, pendingGenerationFor, backfillWindow, formatResyncLine"
  - "apps/worker/src/ingest/run.ts: runIngest, countBackfill, runBackfill, IngestDeps, BackfillPlan (count, since, uids, uidValidity), BackfillOutcome, BackfillRefusedError, CHUNK_SIZE, RESYNC_BATCH_SIZE, WATERMARK_OVERLAP_MS, BACKFILL_SLICE_SIZE, BACKFILL_CHUNK_PAUSE_MS, REMOVAL_DIFF_INTERVAL_MS, FIRST_SYNC_CLOCK_ALLOWANCE_MS"
  - "apps/worker/test/support/fake-folder-source.ts: FakeFolderSource (append, expunge, bumpUidValidity({ renumber }), calls, failOn) and fakeMail()"
  - "apps/worker/test/support/fake-ingest-store.ts: FakeIngestStore (one transaction per call, events, overlaps, commitLog, failOn, holdCommit, read helpers)"
affects: [02-12, 02-13, 02-16, 02-19]

actuals:
  tokens: 23700
  tasks: 3
  commits: 5
plan_head_before: 0a69e23be26c4b3d2862f0c43b1cce752c961965
plan_head_after: fac473b025b5f3c169fe4ee8defbe9f006ceab5b

tech-stack:
  added: []
  patterns:
    - "Pure engine over two interfaces: run.ts imports only types.ts, message.ts and plan.ts (no imapflow, no @sift/db), so every rule is tested on in-memory fakes"
    - "One store call in flight at a time: progress is awaited only after the chunk's commitChunk resolved; the fake store counts overlaps and the tests assert zero"
    - "Two-pass resync: a write-free count pass applies the volume valve, then a commit pass writes at the pending generation; finishResync switches generations and the backfill cursor together"
    - "Fake store transactions: each call works on a structuredClone of the data and keeps it only when nothing threw, so an injected failure writes nothing"

key-files:
  created:
    - apps/worker/src/ingest/plan.ts
    - apps/worker/src/ingest/run.ts
    - apps/worker/test/support/fake-folder-source.ts
    - apps/worker/test/support/fake-ingest-store.ts
    - apps/worker/test/ingest-engine.test.ts
    - apps/worker/test/ingest-resync.test.ts
  modified: []

key-decisions:
  - "02-10: BackfillPlan carries the uidValidity it was counted under; countBackfill and runBackfill refuse with reason 'resyncing' when the server UIDVALIDITY differs from the synced folder or from the plan, because counted UIDs from another UIDVALIDITY name different messages"
  - "02-10: a resync's lastUid is max(UIDNEXT - 1 from its EXAMINE, highest listed UID), so an empty or shrunken folder does not re-fetch 1:* on every later poll"
  - "02-10: window dates are fetched over min:max of the SEARCH SINCE result and narrowed to that set (the adapter's toUidSet lives next to imapflow, which the engine must not import)"
  - "02-10: IngestOutcome counts: synced.stored/historical are the new-mail records of the poll path (backfill shows only in its progress); aborted.stored is every record the cycle committed before it stopped; a pre-aborted signal returns aborted before EXAMINE"
  - "02-10: the cycle order is EXAMINE, getFolder, first sync or resync, poll (valve before any header fetch), removal diff when due, first-backfill slice, deleteExpiredBodies(now)"

patterns-established:
  - "Engine tests use FakeFolderSource + FakeIngestStore with an injected no-op sleep and a fixed clock; resync crash/retry is a table of failOn/abort rows"
  - "RED for a TDD task on top of a tracer: add throw-only scaffolding for not-yet-written exports in the working tree (never committed) so the RED run fails on assertions, not on a module link error"

requirements-completed: [ING-02, ING-03, ING-04]

coverage:
  - id: D1
    description: "First sync: start point UIDNEXT - 1, watermark = max(newest server INTERNALDATE, now - 10 min), logged with ISO watermark and age; empty folder, lagging clock and D-20 quiet-inbox cases"
    verification:
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#first sync (D-18, D-20, D-74, D-83)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Throttled, uncapped first backfill in slices with progress reported only after each commit resolved, cursor cleared at the end"
    verification:
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#first backfill (D-74, D-75)"
        status: pass
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#never stops the first backfill, which only proceeds in slices (D-75)"
        status: pass
    human_judgment: false
  - id: D3
    description: "New mail stored once, in ascending chunks, resumable after an abort; n:* adjacency, no FETCH when nothing is new; strict INTERNALDATE gate; watermark only moves forward"
    verification:
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#new mail (ING-02, ING-03, D-04)"
        status: pass
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#INTERNALDATE gate on polling (D-18..D-21)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Polling volume valve before any header fetch or write; removal diff bounded and gated by removalDiff; body-cache sweep once per synced cycle"
    verification:
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#volume valve on polling (D-26)"
        status: pass
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#removal diff (D-07, D-17)"
        status: pass
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#body-cache sweep (D-07)"
        status: pass
    human_judgment: false
  - id: D5
    description: "countBackfill/runBackfill: exact counted UIDs, no writes when counting, uncapped run, promotion, no cursor movement, refusals"
    verification:
      - kind: test
        ref: "apps/worker/test/ingest-engine.test.ts#CLI backfill: count, then run exactly the counted set (D-75)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Generation-based UIDVALIDITY resync: valve before writes, crash/retry at every boundary, double UIDVALIDITY change, backfill restart, D-25 line"
    verification:
      - kind: test
        ref: "apps/worker/test/ingest-resync.test.ts#UIDVALIDITY resync (D-22..D-25)"
        status: pass
      - kind: test
        ref: "apps/worker/test/ingest-resync.test.ts#volume valve before any resync write (D-23, D-26)"
        status: pass
      - kind: test
        ref: "apps/worker/test/ingest-resync.test.ts#crash and retry at every resync boundary (D-23, D-25)"
        status: pass
      - kind: test
        ref: "apps/worker/test/ingest-resync.test.ts#resync during a pending first backfill (D-75)"
        status: pass
    human_judgment: false

duration: "14 min (timer 2026-10-05T19:54:40Z to 20:08:38Z; context loading before it)"
completed: 2026-10-05
---

# Phase 2 Plan 10: Sync Engine Summary

**The pure sync engine over FolderSource and IngestStore: a first sync with a clock-tolerant watermark, a 30-day backfill that runs in throttled slices, and chunked, resumable new-mail ingest behind an INTERNALDATE gate and a volume valve. It also does the removal diff, a count-then-run CLI backfill, and a two-pass generation resync that checks volume before writing anything. Every rule is proven on in-memory fakes, with 56 tests.**

## Performance

- **Duration:** 14 min on the recorded timer (19:54:40Z to 20:08:38Z), not counting context loading
- **Tasks:** 3 (a tracer, then two TDD tasks)
- **Files:** 6 created (2 source, 2 test helpers, 2 test suites)
- **Branch:** commits are on `main`, as intended for this phase (branching_strategy none)

## Accomplishments

- **First sync (D-18, D-20, D-74, D-83):**
  - The start point is UIDNEXT - 1.
  - The watermark is the later of two values: the newest server INTERNALDATE (from the backfill window's dates and `fetchDates('*')`) and now - `FIRST_SYNC_CLOCK_ALLOWANCE_MS`.
  - The info line `first sync watermark` carries `{ folder, watermark (ISO), watermarkAgeSeconds }`.
  - With initial_backfill_days > 0, a backfill cursor covers the exact window.
- **First backfill (D-75):**
  - Each cycle processes at most one slice of 200 messages, after the new-mail work, outside the cap.
  - Chunks are committed with `promoteEligible` and a 250 ms pause between them.
  - Progress is awaited only after its chunk's `commitChunk` resolved. When nothing is left, the cursor is cleared and a final `finished` progress is reported.
- **Polling (ING-02, ING-03, D-04, D-19..D-21):**
  - Polling stops early when UIDNEXT <= last_uid + 1.
  - `n:*` records at or below last_uid are dropped.
  - The strict `>` gate against watermark - 5 min applies to every record.
  - Chunks of 50 are committed in ascending order. Each advances last_uid, and the watermark (forward only) to the latest eligible INTERNALDATE.
  - The abort check runs between chunks.
- **Volume valve (D-26):** the polling count comes from dates alone. Above `newMailCap`, the run returns `needs_attention` with no header fetch and no write. Historical mail and the first backfill never count toward the cap.
- **Removal diff (D-07, D-17):**
  - It runs only when `removalDiff` (default true) is set, over live locations of the current UIDVALIDITY and generation that are at or below the cycle-start last_uid.
  - One `listUids(min:max)` call checks them, then `markVanished`, which deletes orphan bodies.
  - `deleteExpiredBodies(now)` runs once per synced cycle.
- **CLI backfill (D-75):**
  - `countBackfill(deps, days)` returns the exact ascending UIDs plus the UIDVALIDITY they were counted under, with no store writes.
  - `runBackfill(deps, plan)` ingests exactly those UIDs that are still present, uncapped. It moves no last_uid, watermark or cursor.
  - Both refuse (`BackfillRefusedError`) before the first sync, while resyncing, and under a changed UIDVALIDITY.
- **Resync (D-22..D-26, D-75):**
  - `beginResync` runs, but not on a reuse.
  - A write-free count pass follows: dates for every listed UID, headers and knownIdentities only for the date candidates. The valve is checked there.
  - The commit pass writes locations for known mail and historical rows for unknown old mail at the pending generation, in paused batches of 500.
  - New mail is then processed with bodies.
  - `finishResync` gets a forward-only watermark, the counts and the recomputed backfill cursor in the same call. The D-25 line is logged once.

## Task Commits

1. **Task 1 (tracer): first sync, backfill slices and chunked new-mail ingest over fakes.** Commit `149eb73` (feat). Tracer gate: the verify command (`pnpm vitest run apps/worker/test/ingest-engine.test.ts && pnpm typecheck`) was re-run after formatting and passed (15/15), so expansion went ahead.
2. **Task 2: INTERNALDATE gate, polling valve, removals, count-then-run CLI backfill.** TDD:
   - RED: `d474984` (test)
   - GREEN: `2d26f45` (feat)
   - REFACTOR: none needed
3. **Task 3: generation-based UIDVALIDITY resync.** TDD:
   - RED: `46aed4a` (test)
   - GREEN: `fac473b` (feat; it also contains the loop-based min/max fix)
   - REFACTOR: none needed

## TDD Gate Compliance

- **Task 2 RED (`d474984`):** `pnpm vitest run apps/worker/test/ingest-engine.test.ts` exited 1, with 15 of 37 failing on assertions: the valve, the removal diff, the sweep, the CLI backfill and the new REMOVAL_DIFF_INTERVAL_MS constant. Throw-only scaffolding for the new exports sat in the working tree and was never committed, so the module linked. The boundary and order cases passed because the tracer already had `isCandidateNew`, which is expected. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK`.
- **Task 2 GREEN (`2d26f45`):** 37 of 37 pass. The Task 1 exact event-tail assertion now ends with the new `deleteExpiredBodies` call.
- **Task 3 RED (`46aed4a`):** `pnpm vitest run apps/worker/test/ingest-resync.test.ts` exited 1, with 13 of 19 failing. The engine did not have a resync path yet, so the crash rows failed their state assertions. The 6 pure-helper cases passed against tracer code. Verdict: `RED_EVIDENCE_OK`.
- **Task 3 GREEN (`fac473b`):** 56 of 56 pass across both suites. Lint and typecheck exit 0.

## Files Created/Modified

- `apps/worker/src/ingest/plan.ts`: pure helpers, with doc comments citing D-18..D-21, D-23, D-25 and D-75
- `apps/worker/src/ingest/run.ts`: runIngest (first sync, poll, valve, removal diff, backfill slice, sweep, resync), countBackfill and runBackfill
- `apps/worker/test/support/fake-folder-source.ts`: FakeFolderSource with RFC 3501 set semantics (including `n:*`), day-granular SEARCH SINCE, byte-capped downloads and call and failure injection; also `fakeMail()`
- `apps/worker/test/support/fake-ingest-store.ts`: FakeIngestStore with the 02-06 semantics: identity merge, bodies only when eligible, promoteEligible, monotonic advance, orphan-body delete, and finishResync supersede/vanish with `gone` counted as distinct messages. It also has events, overlaps, a commitLog, failOn and holdCommit.
- `apps/worker/test/ingest-engine.test.ts`: 37 cases
- `apps/worker/test/ingest-resync.test.ts`: 19 cases, including the 5-row crash/retry table

## Decisions Made

See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] A CLI backfill plan counted under another UIDVALIDITY**
- **Found during:** Task 2
- **Issue:** The interface `BackfillPlan { count, since, uids }` does not say which UIDVALIDITY its UIDs belong to. If Bridge rebuilt between the count and the run, `runBackfill` would ingest whatever messages now have those UIDs, not the set the owner confirmed. That breaks the Codex HIGH L310 guarantee.
- **Fix:** `BackfillPlan` gained `uidValidity`. Both functions examine the folder. `runBackfill` refuses with `BackfillRefusedError('resyncing')` when the server, the folder state or the plan disagree. Test: "refuses a plan counted under another UIDVALIDITY".
- **Files modified:** apps/worker/src/ingest/run.ts
- **Commit:** 2d26f45

**2. [Rule 1 - Bug] Spreading UID arrays into Math.min and Math.max**
- **Found during:** Task 3 review
- **Issue:** `Math.max(...listed)` in resync and `Math.min(...uids)` in the removal diff and the window fetch pass every UID as a call argument. On a mailbox with very many UIDs that throws a RangeError (maximum call stack / argument count) at runtime.
- **Fix:** Loop-based `minOf` and `maxOf`.
- **Files modified:** apps/worker/src/ingest/run.ts
- **Commit:** fac473b

**3. [Rule 1 - Bug] A resync's last_uid on an empty or shrunken folder**
- **Found during:** Task 3
- **Issue:** The plan says last_uid is the "highest UID seen". For an empty folder that is 0, so every later poll would run `fetchDates('1:*')`.
- **Fix:** Use `max(UIDNEXT - 1, highest listed UID)`. This is safe because UIDNEXT comes from the EXAMINE before the listing, and any UID at or above it is listed.
- **Commit:** fac473b

### Other notes

- **Acceptance-criteria conflict in the plan:** Task 1 asks that `grep -nE "600_?000" run.ts` match only the FIRST_SYNC_CLOCK_ALLOWANCE_MS declaration. Task 2 then requires `export const REMOVAL_DIFF_INTERVAL_MS = 600_000`. The final file has exactly these two named-constant declarations (lines 49 and 54) and no inline literal, which meets both criteria's intent (D-83: no inline 10 minutes).
- `runIngest` returns `aborted` with 0 stored before EXAMINE when the signal is already aborted. 02-13 expects "aborted before the run: no rows stored".
- Between the Task 1 and Task 3 commits, a UIDVALIDITY mismatch threw `folder X needs a resync`. That was the TDD gap Task 3 closed, and it never shipped past this plan.

**Total deviations:** 3 auto-fixed (1 missing-critical, 2 bugs). **Impact:** each is a correctness hardening within the plan's contracts. The only interface addition is `BackfillPlan.uidValidity`, which 02-16's CLI has to pass back unchanged.

## Issues Encountered

None. The full suite (`pnpm test`) passed 706 of 706 across 39 files on the first run. The intermittent failure seen in earlier runs did not occur, so it could not be identified.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

- 02-13 can map `runIngest` outcomes directly:
  - `removalDiff` comes from its REMOVAL_DIFF_INTERVAL_MS cadence.
  - `newMailCap` is the cap plus the approved count.
  - `onBackfillProgress` is awaited only after a commit resolved, and the fake proves the engine never overlaps store calls.
- 02-16's CLI must keep `BackfillPlan.uidValidity` from `countBackfill` and pass the plan unchanged to `runBackfill`.

## Self-Check: PASSED

- All 6 created files exist on disk.
- Commits 149eb73, d474984, 2d26f45, 46aed4a and fac473b are in `git log`.
- `pnpm vitest run apps/worker/test/ingest-engine.test.ts apps/worker/test/ingest-resync.test.ts` gives 56/56. `pnpm lint`, `pnpm typecheck` and `pnpm test` (706/706) exit 0.
- Acceptance greps pass:
  - no imapflow or @sift/db import in run.ts or plan.ts
  - runIngest, countBackfill and runBackfill are exported
  - BACKFILL_SLICE_SIZE = 200
  - FIRST_SYNC_CLOCK_ALLOWANCE_MS = 600_000
  - REMOVAL_DIFF_INTERVAL_MS = 600_000
  - `first sync watermark` and `watermark: watermark.toISOString()` are present
  - formatResyncLine is used
