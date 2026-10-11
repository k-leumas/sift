---
phase: 03-tiered-classification-with-traces
plan: 22
subsystem: classification
tags: [ollama, cli, readme, cr-01, wr-03, cls-06, vitest]

# Dependency graph
requires:
  - phase: 03-17
    provides: "OLLAMA_MESSAGE_FAILURE_LOG warn line { mailbox, message, code, status } and the first sift classify stderr line for it"
  - phase: 03-18
    provides: "unclassifiedNotice(ids), the 'ok; <notice>' rendering in sift mailbox list, MESSAGE_FAILURE_PASSES (3) hold-back"
provides:
  - "sift classify stderr line 'message <id>: Ollama failed on this message (HTTP <status>); skipped', or '(<code>)' such as '(timeout)' when there is no HTTP status"
  - "README: the unclassified-messages notice and the three-pass hold-back in the 'Problems show in the mailbox list' bullet; the skip line in the sift classify paragraph"
  - "user-facing-text.test.ts pins the README notice to unclassifiedNotice(['<id>']) and the CLI text to commands/classify.ts"
affects: [03-20, classification, docs, verification-gap-1]

actuals:
  tokens: 3200
  tasks: 2
  commits: 3
plan_head_before: 06f35a822237ec668dcf249692e74d9810b2df47
plan_head_after: 9bd3267a1093ce8185e478cbbab64ab6d30b757e

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner doc text pinned to the function that prints it (README contains `ok; ${unclassifiedNotice(['<id>'])}`)"

key-files:
  created: []
  modified:
    - apps/worker/src/commands/classify.ts
    - apps/worker/test/classify-cli.test.ts
    - README.md
    - apps/worker/test/user-facing-text.test.ts

key-decisions:
  - "The 03-17 stderr line was reworded in place to the plan's target, not duplicated: '(HTTP 500)' when there is a status, '(timeout)' (the code) when there is none; the code is no longer shown next to a status"
  - "The 03-17 single-message CLI test moved into the new CR-01 describe with the new wording, next to the three-message 500 case and the timeout case"

patterns-established:
  - "CLI skip lines for a message print only the id and a status or code, read field by field from the warn object (T-03-74)"

requirements-completed: [CLS-06]

coverage:
  - id: D1
    description: "sift classify names a message Ollama failed on alone by id (HTTP status, or the code for a timeout), classifies the others, counts it in '; 1 skipped' and exits 0"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#a 500 on one message: its id on stderr, the others classified, exit 0"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#a 500 on the one message --message selects: its id on stderr, exit 0, no decision"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#a timeout on one message: its id and (timeout) on stderr, the others classified"
        status: pass
    human_judgment: false
  - id: D2
    description: "The skip line carries no mail text and no Ollama error text (T-03-74)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#no command printed a subject, sender, body or model reason"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-leak.test.ts (6 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "README explains the 'ok; <notice>' mailbox list line, the three-pass hold-back until restart, and the sift classify skip line; pinned against the code"
    requirement: CLS-06
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#quotes the owner lines exactly as the code prints them"
        status: pass
    human_judgment: true
    rationale: "Whether the README wording is clear to the owner is a reading judgment; the test proves only that the quoted lines match the code"

# Metrics
duration: 8min
completed: 2026-10-11
status: complete
---

# Phase 3 Plan 22: sift classify skip line and README notice Summary

**`sift classify` now prints `message <id>: Ollama failed on this message (HTTP 500); skipped` (or `(timeout)`) for a message Ollama fails on alone, classifies the rest and exits 0. The README explains that line and the `ok; 1 message could not be classified (ids: <id>); ...` notice in `sift mailbox list`, and a doc test ties both to the code (CR-01, WR-03, CLS-06).**

## Performance

- **Duration:** 8 min
- **Started:** 2026-10-11T08:28:06Z
- **Completed:** 2026-10-11T08:36:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `commands/classify.ts`: the log adapter's `OLLAMA_MESSAGE_FAILURE_LOG` branch prints `HTTP <status>` when the warn object has a numeric status, otherwise the failure code. It reads only `message`, `code` and `status` from the object. The summary line is unchanged; the message was already counted as skipped.
- `classify-cli.test.ts`: a new describe "sift classify names a message Ollama failed on alone (CR-01, T-03-74)" with three cases. (1) Three pending LLM-bound messages, with a 500 for the middle sender: exact stderr, `Classified 2 messages of <slug>: 2 labelled, 0 review; 1 skipped.`, the two others decided, and no line containing the error text. (2) The `--message` case from 03-17, now with the new wording. (3) A hang for one sender with `timeoutMs: 2000`: exact stderr `(timeout)`. The fake's reasons and error texts are registered in the file's output scan.
- `README.md`: the "Problems show in the mailbox list" bullet now quotes `ok; 1 message could not be classified (ids: <id>); see docker compose logs worker`, says what it means (ids listed, at most three, then a count), and says that after three such passes the worker stops sending that message to Ollama until it restarts. The "Redo decisions with `sift classify`" paragraph says that such a message is skipped with one line naming its id, while the others are classified. Both additions are outside Quick start and quote no position-pinned command (bug-234).
- `user-facing-text.test.ts`: asserts that the README contains `ok; ${unclassifiedNotice(['<id>'])}`, and adds `'Ollama failed on this message ('` to the texts listed for `apps/worker/src/commands/classify.ts`.

## Task Commits

1. **Task 1 (tracer): sift classify names a message Ollama failed on alone** - `fd5b557` (feat)
2. **Task 2 RED: pin the README notice and the skip line** - `23953d7` (test)
3. **Task 2 GREEN: README explains the notice and the skip line** - `9bd3267` (docs)

**Plan metadata:** the SUMMARY commit and the state commit that follow.

## Files Created/Modified

- `apps/worker/src/commands/classify.ts` - skip line wording (status, else code)
- `apps/worker/test/classify-cli.test.ts` - CR-01 describe (3 cases); the 03-17 case moved into it
- `README.md` - notice and hold-back in the mailbox list bullet; skip line in the sift classify paragraph
- `apps/worker/test/user-facing-text.test.ts` - README notice pin and CLI source text

## Decisions Made

- **Reconciled with 03-17's existing line.** 03-17 already printed `message <id>: Ollama failed on this message (<code>, HTTP <status>); skipped`. I reworded that same line to the plan's target and did not add a second one. With a status it now shows `(HTTP 500)`; without one it shows the code, e.g. `(timeout)`. The 03-17 CLI test asserted `(server_error, HTTP 500)`, so I updated it and moved it into the new CR-01 describe.
- Tracer gate: interactive run, `human_verify_mode` end-of-phase, automated-only `<verify>`. I re-ran the verify after formatting; it passed, so no checkpoint was needed.

## TDD Gate Compliance

- **RED** `23953d7`: target `README quick start (D-28, D-56, D-58) > quotes the owner lines exactly as the code prints them`. The vitest TAP output for that diff is multi-line, so the classifier would reject it as malformed TAP (bug-222). I captured a JUnit report instead (`--reporter=junit -t ...`) and `check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`target_test_failed`, exit 1). Semantic assessment: the target ran and failed on the new assertion (line 154, `expected README to contain 'ok; 1 message could not be classified…'`). It was not a load, fixture or unrelated failure. The source-text pin passed already, because Task 1 had put the text in classify.ts.
- **GREEN** `9bd3267`: committed as `docs(03-22)` rather than `feat(03-22)`, because the change is README-only and commitlint's conventional types make `docs` the accurate one. `workflow.tdd_mode` is off, so this is recorded for the record only.
- **REFACTOR:** none needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test asserting old behaviour] 03-17 CLI test wording**
- **Found during:** Task 1
- **Issue:** The existing test expected `(server_error, HTTP 500)`. The plan's target wording is `(HTTP 500)`.
- **Fix:** I updated the expectation and moved the test into the CR-01 describe. The orchestrator asked for this reconciliation.
- **Files modified:** apps/worker/test/classify-cli.test.ts
- **Verification:** classify-cli + classify-refetch 40/40
- **Committed in:** fd5b557

**2. [Rule 3 - Blocking] Biome formatting of the new stderr call**
- **Found during:** Task 1 (`pnpm lint`)
- **Issue:** The one-line `deps.stderr(...)` exceeded the formatter width.
- **Fix:** Ran `biome format --write` on the two Task 1 files.
- **Files modified:** apps/worker/src/commands/classify.ts
- **Committed in:** fd5b557

---

**Total deviations:** 2 auto-fixed (1 test wording, 1 formatting)
**Impact on plan:** None on scope; both were needed for the plan's target wording and a clean lint.

## Issues Encountered

- `pnpm lint` reports one warning, in apps/worker/test/node-version.test.ts (noTemplateCurlyInString). It predates this plan, so it is out of scope, and lint exits 0.

## Verification

- `pnpm vitest run apps/worker/test/classify-cli.test.ts apps/worker/test/user-facing-text.test.ts apps/worker/test/classify-refetch.test.ts apps/worker/test/classify-leak.test.ts`: 4 files, 152/152 pass
- `pnpm typecheck`: exit 0
- `pnpm lint`: exit 0 (the 1 pre-existing warning)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both owner surfaces now name a message Ollama fails on alone: `sift mailbox list` (03-18) and `sift classify` (this plan).
- 03-20 (wiring the `llm_error` review reason from 03-19) is next. This plan does not touch that behaviour. If 03-20 turns some skipped messages into review decisions, the README sentences added here and the CR-01 CLI cases will need to follow.

## Self-Check: PASSED

- FOUND: apps/worker/src/commands/classify.ts, apps/worker/test/classify-cli.test.ts, README.md, apps/worker/test/user-facing-text.test.ts
- FOUND commits: fd5b557, 23953d7, 9bd3267

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-11*
