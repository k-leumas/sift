---
phase: 03-tiered-classification-with-traces
plan: 14
subsystem: database
tags: [postgres, body-cache, retention, d-32, cr-02, vitest]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "recordDecision only-where-null expiry (03-06), restoreBody and the sift classify refetch (03-12)"
provides:
  - "DECISION_BODY_RETENTION_MS lives in packages/db/src/ingest.ts (re-exported unchanged from classify.ts and @sift/db)"
  - "decidedMessageIds(scope, ids) internal helper (not re-exported by index.ts)"
  - "restoreBody(scope, messageId, body, at?) gives a decided message's restored body expires_at = at + 7 days in the same insert"
  - "StoreOptions.at; storeMessages gives a body inserted for a decided message expires_at = at + 7 days"
  - "T-03-20 closed in 03-SECURITY.md with CR-02 evidence"
affects: [03-verification, gsd-secure-phase, phase-04-label-application]

actuals:
  tokens: 4800
  tasks: 2
  commits: 4
plan_head_before: 892868c27576629f4e6d8a526fba56b9930d4a88
plan_head_after: 1be8646e4a721a33e9b1f0a7f1efdb14bb2ac513

tech-stack:
  added: []
  patterns:
    - "A body written for an already-decided message gets its expiry at write time (one shared rule in packages/db, applied by restoreBody and storeMessages)"
    - "Shared constants used by both ingest.ts and classify.ts live in ingest.ts, so ingest.ts never imports classify.ts (no module cycle)"

key-files:
  created: []
  modified:
    - packages/db/src/ingest.ts
    - packages/db/src/classify.ts
    - apps/worker/src/classify/refetch.ts
    - apps/worker/test/classify-refetch.test.ts
    - packages/db/test/classify.test.ts
    - packages/db/test/ingest.test.ts
    - .planning/phases/03-tiered-classification-with-traces/03-SECURITY.md

key-decisions:
  - "CR-02 rule: a body written for a message that already has a decision expires DECISION_BODY_RETENTION_MS after the write; undecided bodies keep expires_at null until the first decision (D-32 unchanged)"
  - "DECISION_BODY_RETENTION_MS moved to ingest.ts and re-exported from classify.ts, so @sift/db's export surface is unchanged and there is no ingest -> classify import"
  - "storeMessages refuses a non-finite options.at with a TypeError, like restoreBody and recordDecision"

patterns-established:
  - "decidedMessageIds lookup before a body insertOrIgnore decides the row's expiresAt in the same statement"

requirements-completed: [CLS-06]

coverage:
  - id: D1
    description: "sift classify refetch restores a decided message's body with expires_at = restore time + 7 days, even when Ollama is down after the refetch (code 1, outage message, no new decision)"
    requirement: CLS-06
    verification:
      - kind: e2e
        ref: "apps/worker/test/classify-refetch.test.ts#gives the restored body its 7-day expiry even when Ollama is down after the refetch (CR-02)"
        status: pass
      - kind: e2e
        ref: "apps/worker/test/classify-refetch.test.ts#restores the body read-only, appends a rerun decision, and the body expires 7 days after it was restored"
        status: pass
    human_judgment: false
  - id: D2
    description: "restoreBody gives a decided message's body expires_at = at + 7 days, a later rerun decision does not move it, an undecided message's restored body keeps expires_at null, and an invalid Date throws before any SQL"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#restoreBody gives the body of a decided message expires_at = at + 7 days, kept by a rerun (CR-02)"
        status: pass
      - kind: unit
        ref: "packages/db/test/classify.test.ts#restoreBody refuses an invalid Date before any SQL (CR-02)"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#returns body null when the body row is gone, and restoreBody puts it back once"
        status: pass
    human_judgment: false
  - id: D3
    description: "storeMessages gives a body re-inserted for a decided message expires_at = at + 7 days, undecided bodies null, and an identical second call changes neither"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "packages/db/test/ingest.test.ts#bodies of decided messages (CR-02, D-32)"
        status: pass
      - kind: e2e
        ref: "apps/worker/test/ingest-e2e.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "03-SECURITY.md row T-03-20 names the restore and re-insert paths and their tests, status closed"
    verification:
      - kind: other
        ref: "grep -n T-03-20 .planning/phases/03-tiered-classification-with-traces/03-SECURITY.md"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 14: Decided-message body expiry at write time (CR-02) Summary

**restoreBody and storeMessages now give a body written for an already-decided message expires_at = write time + 7 days in the same insert (decidedMessageIds lookup), so an interrupted `sift classify` re-run or an ingest re-insert can no longer cache private mail text forever; T-03-20 closed.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-10-11T04:09:41Z
- **Completed:** 2026-10-11T04:21:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- `decidedMessageIds(scope, ids)` (internal, packages/db/src/ingest.ts) and `DECISION_BODY_RETENTION_MS` moved next to it; classify.ts re-exports the constant so `@sift/db` is unchanged.
- `restoreBody(scope, messageId, body, at = new Date())` inserts a decided message's body with `expiresAt = at + 7 d`; undecided stays null; a non-finite `at` throws `TypeError('restoreBody: at must be a valid Date')` before any SQL.
- `storeMessages(scope, items, { at })` gives every inserted body whose message has a decision `expiresAt = at + 7 d`; other bodies stay null; ON CONFLICT DO NOTHING keeps a repeat call a no-op.
- End-to-end refetch-then-outage test: the body is restored, the run exits 1 with `Ollama unreachable at ...`, no rerun decision is recorded, and the body's expiry lies between t0 + 7 d and end + 7 d.
- 03-SECURITY.md T-03-20: mitigation extended with the CR-02 paths and tests, status `closed`.

## Task Commits

1. **Task 1 (tracer): restored body of a decided message expires in 7 days even after an outage** - `ec4a49a` (fix)
2. **Task 2 RED: failing CR-02 cases** - `50e2a49` (test)
3. **Task 2 GREEN: storeMessages decided-message expiry and StoreOptions.at** - `12c3327` (feat)
4. **Task 2: T-03-20 closed** - `1be8646` (docs)

## Files Created/Modified

- `packages/db/src/ingest.ts` - DECISION_BODY_RETENTION_MS (moved), decidedMessageIds, StoreOptions.at, decided-message body expiry in storeMessages
- `packages/db/src/classify.ts` - re-exports the constant; restoreBody gains `at` and the decided expiry; doc comment rewritten (CR-02)
- `apps/worker/src/classify/refetch.ts` - comment at the restoreBody call now says the expiry is set at once (CR-02)
- `apps/worker/test/classify-refetch.test.ts` - rerun() takes an optional runtime; new CR-02 outage test; first test now asserts the expiry range (restore time .. rerun decision + 7 d)
- `packages/db/test/classify.test.ts` - restoreBody decided case (own fourth message) and invalid-Date case
- `packages/db/test/ingest.test.ts` - `bodies of decided messages (CR-02, D-32)` describe (3 cases)
- `.planning/phases/03-tiered-classification-with-traces/03-SECURITY.md` - T-03-20 row closed with evidence

## Mutation proof (CR-02 refetch test bites)

With restoreBody's expiry branch replaced by `null` (scratch copy, restored with `command cp -f`, `diff -q` confirmed identical), `pnpm vitest run apps/worker/test/classify-refetch.test.ts -t "CR-02"` failed: `AssertionError: expected null not to be null` (1 failed, 7 skipped). With the fix it passes.

## TDD Gate Compliance

Task 2 (`tdd="true"`):

- **RED** `50e2a49` - target `packages/db/test/ingest.test.ts > bodies of decided messages (CR-02, D-32) > gives a body re-inserted for a decided message expires_at = at + 7 days` failed with `expected null to deeply equal 2026-10-27T08:00:00.000Z` (exit 1, tap-flat, `-t`). `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`). Semantic assessment: the target ran and failed on the planned expiry assertion; the two sibling cases (undecided null, idempotent repeat) passed before the change, as they describe existing behaviour. The classify.test.ts CR-02 cases passed at RED time because Task 1 had already implemented restoreBody's rule; they guard it.
- **GREEN** `12c3327` - all four Task 2 test files pass (101 tests) and `pnpm typecheck` exits 0.
- **REFACTOR** - none needed.

## Decisions Made

- The constant moved to ingest.ts (classify.ts already imports stripNul from ingest.ts); classify.ts re-exports it so index.ts and every importer are unchanged.
- recordDecision is untouched: it still sets expires_at only where null, so neither a rerun decision nor a later restore extends an existing expiry (asserted in classify.test.ts).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing validation] storeMessages refuses an invalid `options.at`**
- **Found during:** Task 2 (GREEN)
- **Issue:** The new `at` option would turn a non-finite Date into an Invalid Date expiry for decided bodies.
- **Fix:** `TypeError('storeMessages: at must be a valid Date')` after the empty-items short-circuit, the same rule as restoreBody and recordDecision.
- **Files modified:** packages/db/src/ingest.ts
- **Verification:** Task 2 test files and typecheck pass.
- **Committed in:** `12c3327`

**2. [Rule 1 - Bug] Test title with an apostrophe in a single-quoted string**
- **Found during:** Task 2 (RED)
- **Issue:** `it('... a decided message's body ...')` broke the classify.test.ts transform.
- **Fix:** Reworded the title to "the body of a decided message".
- **Files modified:** packages/db/test/classify.test.ts
- **Committed in:** `50e2a49`

---

**Total deviations:** 2 auto-fixed (1 missing validation, 1 bug in a new test). **Impact on plan:** none on scope.

## Issues Encountered

- Commits land on `main`: `git.base-branch --is-protected main` reports true, but the orchestrator explicitly dispatched this as a sequential executor on the main working tree (`git.branching_strategy: none`, every prior phase commit is on main). Recorded here for the orchestrator.
- `pnpm lint` exits 0 with one pre-existing warning in apps/worker/test/node-version.test.ts (noTemplateCurlyInString), unrelated to this plan.

## Verification

- `pnpm vitest run apps/worker/test/classify-refetch.test.ts packages/db/test/classify.test.ts packages/db/test/ingest.test.ts packages/db/test/scope.test.ts apps/worker/test/ingest-e2e.test.ts` - 5 files, 109 tests passed
- `pnpm typecheck` - exit 0; `pnpm lint` - exit 0

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap 2 of 03-VERIFICATION.md is closed on both paths (refetch and ingest re-insert). Ready for 03-15.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*

## Self-Check: PASSED
