---
phase: 03-tiered-classification-with-traces
plan: 06
subsystem: database
tags: [postgres, drizzle, rls, advisory-lock, keyset-pagination, traces, zod]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-03 decision trace columns, append-only rule_set, unscoped prompt_version; 03-05 parseDecisionSpans, REVIEW_REASONS, PromptMaterial; 03-04 decide() / DecisionDraft"
provides:
  - "Scope.classification.candidates(query): pending and re-run selection, newest INTERNALDATE first with an (internal_date, id) keyset cursor, mailbox-filtered in every subquery"
  - "recordDecision: the single decision write path (spans parsed, typed columns checked before SQL; first decision sets body expires_at = decided_at + 7 days)"
  - "ensureRuleSet (per-mailbox version max+1 by hash), latestDecision, restoreBody"
  - "ensurePromptVersion(db, material): unscoped, serialised by pg_advisory_xact_lock(815309003)"
  - "@sift/db exports DECISION_BODY_RETENTION_MS, PROMPT_VERSION_LOCK_KEY and the CandidateQuery/ClassifyCandidate/CandidateBody/ClassificationApi/RecordDecisionInput/DecisionRow types"
affects: [03-07 worker classification batch, 03-08+, TRC-05 trace CLI, phase-04 apply]

actuals:
  tokens: 11700
  tasks: 2
  commits: 3
plan_head_before: 4f5f98b7fbced367b9b78e1854ef36086dc28ea4
plan_head_after: 9fd17c59fcedcf6c5381dc22e9be0a71a69dc56b

tech-stack:
  added: []
  patterns:
    - "Table-API extension on Scope for queries the generic helpers cannot express (classificationApi beside messageBodyApi)"
    - "Unscoped shared-table upsert: internalsOf(db).orm.transaction + pg_advisory_xact_lock + select-then-insert"
    - "Use-case refuses before SQL: shared Zod schema parse, then field-named TypeError on any typed-column mismatch"

key-files:
  created:
    - packages/db/src/classify.ts
    - packages/db/src/prompt-version.ts
    - packages/db/test/classify.test.ts
  modified:
    - packages/db/src/scope.ts
    - packages/db/src/index.ts
    - packages/db/src/ingest.ts
    - packages/db/test/scope.test.ts

key-decisions:
  - "03-06: recordDecision stores createdAt = at, so decision.created_at and the body expiry share one clock and latestDecision orders by the decision time"
  - "03-06: recordDecision also checks traceFormatVersion = TRACE_FORMAT_VERSION, llm span model/confidence = the typed columns, and exact rules carry no prompt version, model or confidence"
  - "03-06: candidates() refuses non-UUID message ids, an invalid since and a malformed before cursor with TypeError before SQL, as well as a limit outside 1..1000"

patterns-established:
  - "Keyset cursor: (internal_date, id) < (sql.param(date, message.internalDate), sql.param(id, message.id)), ordered internal_date desc, id desc"

requirements-completed: [TRC-01, TRC-04, CLS-06]

coverage:
  - id: D1
    description: "Pending selection: eligible, live, undecided messages of the scope's mailbox, newest first with id tie-break, keyset paged; historical and vanished mail excluded"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#lists the eligible live undecided messages newest first, id breaking ties"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#pages with the (internal_date, id) keyset cursor"
        status: pass
    human_judgment: false
  - id: D2
    description: "Re-run selection by messageIds or since, decided flagged, body null when the body row is gone; empty id list and bad limits refused without SQL"
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#selects decided messages by id, marking them decided"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#selects eligible live messages since a date, decided or not"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#refuses a limit outside 1..1000 and returns [] for an empty id list without SQL"
        status: pass
    human_judgment: false
  - id: D3
    description: "ISO-04: candidates on an RLS-bypassing superuser handle returns only the scope's mailbox rows"
    verification:
      - kind: integration
        ref: "packages/db/test/scope.test.ts#classification.candidates under A returns only A messages, by its own filter (ISO-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "recordDecision is the single validated write path: malformed or inconsistent drafts and llm decisions without a prompt version refused before SQL; one worker decision per message (23505), reruns append; first decision sets body expiry +7 days, reruns never move it"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#records one validated decision; the message leaves the pending set and its body expires in 7 days"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#refuses a second worker decision with 23505 and appends a rerun"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#refuses a malformed or inconsistent draft before any SQL"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#refuses an llm decision without a prompt version before any SQL"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#a rerun leaves an existing body expiry unchanged"
        status: pass
    human_judgment: false
  - id: D5
    description: "Versioned rows on first use: rule_set 1, 2, 3 per mailbox; prompt_version one row under five concurrent first calls, next version per new hash, waits on lock 815309003; exact decisions store prompt_version_id and model null"
    requirement: TRC-04
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#five concurrent first calls on five handles store exactly one row"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#a new hash gets the next version; a known one returns its row"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#waits for advisory lock 815309003"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#numbers rule sets 1, 2, 3 per mailbox in creation order"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#stores an exact-rule decision with prompt_version_id and model null"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every REVIEW_REASONS value accepted by the database, an unknown one refused with 23514; latestDecision by created_at then id; restoreBody once with NUL stripped and expiry null"
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#accepts every REVIEW_REASONS value in an llm review decision (core and SQL lists agree)"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#refuses an unknown review reason with 23514"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#latestDecision orders by created_at, then id, and is null for an undecided message"
        status: pass
      - kind: integration
        ref: "packages/db/test/classify.test.ts#returns body null when the body row is gone, and restoreBody puts it back once"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 06: Classification Database Use-Cases Summary

**Scope.classification.candidates selects pending and re-run mail with a keyset cursor and a mailbox filter in every subquery. recordDecision is the one validated write path and starts the 7-day body expiry. Rule sets and prompt versions become versioned rows on first use, and prompt_version is serialised by advisory lock 815309003.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-10-10T20:12:26Z
- **Completed:** 2026-10-10T20:28:36Z
- **Tasks:** 2
- **Files modified:** 7 (3 created)

## Accomplishments
- `candidates()` is one Drizzle select: message, left-joined to its body, with EXISTS over live locations and over decisions. Each EXISTS binds the scope's mailbox_id, and so does the join. Order is internal_date desc, id desc, and the `before` cursor is a row comparison.
- `recordDecision` parses the spans with the shared core schema first. It then checks the typed columns against the trace: the action intent sets outcome, category and review reason, and the tier must match whether an llm span is present, its model and its confidence. Any mismatch throws a field-named TypeError before SQL. In the same scope it sets the body's expires_at to at + 7 days, only where expires_at is null.
- `ensurePromptVersion`: in one transaction it takes the advisory lock, selects by hash, otherwise inserts max(version)+1. Five handles calling at once produce exactly one row.
- `ensureRuleSet`, `latestDecision` and `restoreBody` (insert-or-ignore, NUL stripped, expiry null) are done. 20 new tests and 1 new ISO-04 case.

## Task Commits

1. **Task 1 (tracer): candidates, ensureRuleSet, recordDecision** - `413a981` (feat)
2. **Task 2 RED: failing prompt-version, re-run, latest and restore tests** - `a1bb3fc` (test)
3. **Task 2 GREEN: ensurePromptVersion, latestDecision, restoreBody** - `9fd17c5` (feat)

No REFACTOR commit was needed. After Task 1 the tracer gate re-ran its verify (classify + scope tests 49/49, typecheck 0) before Task 2 started.

## TDD Gate Compliance (Task 2, tdd="true")

- **RED (`a1bb3fc`):** stubs returned wrong values (`ensurePromptVersion` returned version 0 with no row, `latestDecision` returned null, `restoreBody` returned false). The full-file TAP run had 8 failures. Its multi-line diff diagnostics are not valid TAP, so the classifier returned INVALID_RED invalid_record. I then re-ran only the target with `-t "five concurrent first calls"` and the tap-flat reporter: exit 1, the target failed with "expected [] to have a length of 1 but got +0", and the other 19 tests were skipped. `gsd check tdd-red-evidence` returned **RED_EVIDENCE_OK target_test_failed**. Semantic assessment: the target ran and failed on the planned assertion (row count). There were no load, fixture or syntax faults. The REVIEW_REASONS and prompt-less llm cases also failed at RED. That was the stub's version 0 / empty id reaching the span schema and the uuid column, which is the missing feature and not a test fault. The candidates re-run cases passed at RED by design, because Task 1 had already built that query.
- **GREEN (`9fd17c5`):** classify, scope and isolation tests pass 76/76; `pnpm typecheck` exits 0.
- The `test(03-06)` commit comes before the `feat(03-06)` commit, as required.

## Files Created/Modified
- `packages/db/src/classify.ts`: recordDecision, ensureRuleSet, latestDecision, restoreBody, DECISION_BODY_RETENTION_MS
- `packages/db/src/prompt-version.ts`: ensurePromptVersion, PROMPT_VERSION_LOCK_KEY
- `packages/db/src/scope.ts`: CandidateQuery, CandidateBody, ClassifyCandidate, ClassificationApi, classificationApi, Scope.classification
- `packages/db/src/ingest.ts`: stripNul is now exported (internal reuse only, not from index.ts)
- `packages/db/src/index.ts`: new exports
- `packages/db/test/classify.test.ts`: real-database tests (717 lines)
- `packages/db/test/scope.test.ts`: Scope keys, export surface, ISO-04 candidates case

## Decisions Made
See key-decisions in the frontmatter. `CandidateBody` was exported as a named type next to the planned ones, so callers can name the body shape.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Additional consistency checks in recordDecision**
- **Found during:** Task 1
- **Issue:** The plan checks intent, tier and span count. A draft could still carry a different trace format version, an llm span model or confidence that differs from the typed columns, or an exact-rule decision with a prompt version, model or confidence. Today the database checks catch only some of these, and only after SQL.
- **Fix:** All of these throw a field-named TypeError before SQL. decide() output always passes.
- **Committed in:** 413a981

**2. [Rule 2 - Correctness] Input validation in candidates()**
- **Found during:** Task 1
- **Issue:** A non-UUID message id or cursor id would surface as a 22P02 from inside the transaction and poison the scope.
- **Fix:** TypeError before SQL for non-UUID ids, an invalid since date and a malformed before cursor. Tested alongside the limit cases.
- **Committed in:** 413a981

**3. [Rule 2 - Coverage] Advisory-lock wait test**
- **Found during:** Task 2
- **Issue:** The concurrency test proves there is one row. It does not prove the code waits on key 815309003.
- **Fix:** The test holds `pg_advisory_lock(815309003)` as the superuser, shows that the call stays pending, then releases the lock and the call resolves with version 3.
- **Committed in:** a1bb3fc, 9fd17c5

---

**Total deviations:** 3 auto-fixed (all Rule 2)
**Impact on plan:** All three refuse bad input earlier or prove a stated truth. The files and API are as planned.

## Issues Encountered
- Biome formatting and one useOptionalChain warning had to be fixed before the Task 1 commit (bug-216).
- The vitest tap-flat output is not parseable TAP when a failure has a multi-line diff. The RED record also has to sit inside the project directory (bug-217). The workaround is recorded in .wolf/cerebrum.md.
- The one pre-existing lint warning (noTemplateCurlyInString in apps/worker/test/node-version.test.ts) is unrelated and was left alone.

## Verification
- `pnpm vitest run packages/db`: 14 files, 295/295 pass
- `pnpm typecheck` exits 0; `pnpm lint` reports only the pre-existing warning
- All acceptance greps match (recordDecision, ensureRuleSet, parseDecisionSpans, `classification:` in runScoped, `from './classify.ts'`, ensurePromptVersion, `PROMPT_VERSION_LOCK_KEY = 815309003`, restoreBody, latestDecision); classify.test.ts is 717 lines (min 150)

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness
- 03-07 can build the worker batch: `candidates({ pendingOnly: true, limit, before })`, then `ensureRuleSet`, `ensurePromptVersion(db, promptMaterial())` once per process, then `recordDecision({ ...draft, messageId, ruleSetId, promptVersionId, decidedBy: 'worker' })`. After a refetch, `restoreBody` puts the body back.
- No blockers.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*

## Self-Check: PASSED

Created files exist (classify.ts, prompt-version.ts, classify.test.ts). Commits 413a981, a1bb3fc and 9fd17c5 are ancestors of HEAD, and evaluation-scope lists the 3 plan commits.
