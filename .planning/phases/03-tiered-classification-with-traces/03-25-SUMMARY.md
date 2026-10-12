---
phase: 03-tiered-classification-with-traces
plan: 25
subsystem: classification
tags: [llm-output, jsonb, unicode, surrogate, postgres, trace, WR-04]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-16 WR-01 control-character check in validateLlmOutput and the stripNul spans backstop in recordDecision"
provides:
  - "validateLlmOutput rejects a reason that is not well-formed UTF-16 as schema_mismatch 'reason: lone_surrogate' (one retry, then review invalid_output)"
  - "wellFormed<V>(value) in packages/db/src/ingest.ts (internal, beside stripNul)"
  - "recordDecision backstop: wellFormed(stripNul(parseDecisionSpans(input.spans)))"
  - "End-to-end regression for ROADMAP SC5: five lone-surrogate answers in a row plus an older valid message, all decided in one pass"
affects: [03-26, phase-04-trace-viewer, classify-run]

actuals:
  tokens: 3774
  tasks: 2
  commits: 3
plan_head_before: cf796f7316e2640232e1969d0637d0484d1d7eb6
plan_head_after: bb0cc78b802aee73c36b0c7ba962f3ad4a2d4067

tech-stack:
  added: []
  patterns:
    - "Decision-bound text: reject the model's reason at the boundary (isWellFormed), repair only Ollama-supplied strings in the spans backstop (toWellFormed)"
    - "Surrogates in source and tests are built at runtime with String.fromCharCode; files stay pure ASCII"

key-files:
  created: []
  modified:
    - packages/core/src/classify/llm-output.ts
    - apps/worker/test/classify-control-chars.test.ts
    - packages/core/test/llm-output.test.ts
    - packages/db/src/ingest.ts
    - packages/db/src/classify.ts
    - packages/db/test/classify.test.ts

key-decisions:
  - "WR-04 predicate is String.prototype.isWellFormed() on the parsed, trimmed reason with its own fixed detail 'reason: lone_surrogate', the same predicate 03-26 uses in the rules schema; REASON_CONTROL_CHARACTERS, llmOutputSchema and the prompt hash are unchanged"
  - "run.ts throw path left unchanged on purpose: after this plan no model or Ollama string can fail the decision insert; any write-time rejection other than a DB/connection failure would still reach that path with no terminal state (known residual)"

patterns-established:
  - "wellFormed beside stripNul: deep walk over strings, arrays and plain objects (keys included), Dates untouched, internal to @sift/db"

requirements-completed: [CLS-06, CLS-03, TRC-01, SEC-01]

coverage:
  - id: D1
    description: "A lone-surrogate model reason is invalid output: retried once, then stored as review invalid_output; the other message is labelled"
    requirement: CLS-03
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-control-chars.test.ts#a model reason with a lone surrogate (WR-04, CLS-06) > a lone high surrogate (U+D800) twice"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-control-chars.test.ts#a model reason with a lone surrogate (WR-04, CLS-06) > a lone low surrogate (U+DC00) twice"
        status: pass
    human_judgment: false
  - id: D2
    description: "Five lone-surrogate answers in a row plus an older valid message: one pass, failures 0, six replayable decisions, nothing pending, no 'classify: message failed' log line (ROADMAP SC5)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-control-chars.test.ts#a model reason with a lone surrogate (WR-04, CLS-06) > five lone-surrogate answers in a row and an older valid message"
        status: pass
    human_judgment: false
  - id: D3
    description: "Output contract rejects unpaired high/low surrogates, a reversed pair and a trailing lone surrogate; accepts valid pairs unchanged; detail never quotes the reason"
    requirement: SEC-01
    verification:
      - kind: unit
        ref: "packages/core/test/llm-output.test.ts#lone surrogates in the reason (WR-04)"
        status: pass
    human_judgment: false
  - id: D4
    description: "recordDecision stores unpaired surrogates in raw, thinking, done_reason and response_model as U+FFFD, keeps a valid pair, no jsonb error"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "packages/db/test/classify.test.ts#stores an llm decision whose attempt holds lone surrogates in thinking, raw, done_reason and response_model as U+FFFD (WR-04 backstop)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-10-12
status: complete
---

# Phase 3 Plan 25: Lone-surrogate model reasons (WR-04) Summary

**validateLlmOutput now fails a reason holding an unpaired UTF-16 surrogate as schema_mismatch 'reason: lone_surrogate' (retry, then review invalid_output), and recordDecision maps every unpaired surrogate in the spans to U+FFFD. A hostile email can no longer leave a message pending forever, and five such emails can no longer make the pass throw.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-12T21:25:03Z
- **Completed:** 2026-10-12T21:31:03Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Closed the remaining 03-VERIFICATION gap on the worker side (ROADMAP SC5 / CLS-06, review WR-04). The verifier's reproduction (3 throwing passes, 0 decisions) is now a regression test. It passes with one pass, failures 0, six decisions and nothing pending.
- Code-level output check: `isWellFormed()` on the parsed, trimmed reason, after the WR-01 control-character check. Schema, `ollamaFormat` and prompt material are unchanged, and EXPECTED_PROMPT_HASH still matches, so no new prompt_version row is created.
- Database backstop: `wellFormed` (internal, beside `stripNul`) runs over the NUL-stripped parsed spans before `assertConsistent` and the insert. This covers the strings Ollama supplies: raw, thinking, done_reason and response_model.

## Task Commits

1. **Task 1 (tracer): lone-surrogate reasons decided in the first pass.** `c6306b1` (fix)
2. **Task 2 (tdd): output-contract cases and the spans backstop.** RED `c5a1d3c` (test), GREEN `bb0cc78` (feat). No refactor was needed.

## Files Created/Modified

- `packages/core/src/classify/llm-output.ts`: adds the `reason: lone_surrogate` rejection and its WR-04 doc comment. The file is pure ASCII.
- `apps/worker/test/classify-control-chars.test.ts`: adds `LONE_SURROGATE_FAILURE` and gives `expectHeldForReview` a second parameter that defaults to the control-character failure. The new describe has 3 cases (U+D800, U+DC00, five in a row).
- `packages/core/test/llm-output.test.ts`: new describe `lone surrogates in the reason (WR-04)` with 6 reject cases, 2 accept cases and a sentinel check. The file still has 6 non-ASCII lines, as before.
- `packages/db/src/ingest.ts`: new `export function wellFormed<V>(value: V): V`, @internal, not re-exported from index.ts.
- `packages/db/src/classify.ts`: `const spans = wellFormed(stripNul(parseDecisionSpans(input.spans)));` plus a doc comment on the WR-04 backstop and the replay trade-off.
- `packages/db/test/classify.test.ts`: the WR-04 backstop case.

## Proofs

**Task 1 mutation proof (case c).** I disabled the check (`if (false && !result.data.reason.isWellFormed())`) in a copy backed by a scratch file, then restored it with `command cp -f` and confirmed with `diff -q`. Case c then failed: the pass **threw** instead of reporting `failures > 0`. On the fifth consecutive failure, classifyCandidates rethrew the error: `Error: Failed query: insert into "decision" ...`, caused by `error: invalid input syntax for type json`, SQLSTATE `22P02`, detail `Unicode low surrogate must follow a high surrogate.` (where: `"result":{"reason":"Looks fine\ud800 ...`). So without the check, `classifyMailbox` rejects and no decision is stored. With the check, the outcome is `failures: 0`.

**Task 2 RED.** The backstop case failed on the insert with SQLSTATE `22P02`, detail `Unicode low surrogate must follow a high surrogate.`. The detail quotes the first bad value: `"response_model":"qwen3\udc00...`. The RED evidence record (JUnit report, target `re-runs, latest decision, body restore and the review reasons (D-17, D-32, TRC-04) > stores an llm decision whose attempt holds lone surrogates ... (WR-04 backstop)`) returned `RED_EVIDENCE_OK` / `target_test_failed`, with 1 failed and 23 skipped. Semantic assessment: the target ran and failed on the decision insert because jsonb rejects the unpaired surrogate. That is the behaviour the plan meant to fix. It was not a setup, import or fixture fault. The llm-output cases already passed after Task 1 and were pinned in the RED commit as regression tests, as 03-16 did. The record was moved out of `.vitest/` to the scratchpad.

## Decisions Made

- `isWellFormed()` was chosen over a Cs property escape in REASON_CONTROL_CHARACTERS, as the plan decided. It is the same predicate as 03-26's rules schema, and the trace detail stays accurate because a surrogate is not a control character.
- `run.ts` is unchanged (the plan's decision). The `failures: 0` and no-`classify: message failed` assertions show that the throw path is not reached for this cause.

## Known Residuals (plan checker and cross-AI review advisories)

- **Throw path for other write-time rejections.** This plan only stops model and Ollama strings from failing the decision insert. Any other write-time rejection that is not a DB or connection failure would still reach run.ts's catch/rethrow path, with no terminal state for the message. Examples: a future CHECK constraint, or a trace field that some later change adds without the backstop. Today such a failure is counted and logged, and five in a row rethrow. A terminal state for arbitrary write failures would need a new review reason, a CHECK change and a migration, which is a one-way door that needs an owner checkpoint. It is out of scope here and not in the verifier's missing list.
- **Replay of a repaired raw (T-03-81, accepted).** If an Ollama-compatible server returns an unpaired surrogate in raw, the stored attempt no longer matches the server's output byte for byte. Real Ollama never emits one. The model's reason itself is never repaired.

## Deviations from Plan

None. The plan was executed exactly as written.

Note on the commit branch: commits went straight to `main`. The executor's pre-commit assertion reports `main` as protected, but this project uses `git.branching_strategy: none`. Every earlier sequential 03-xx plan committed to main, and the orchestrator dispatched this run sequentially on the main working tree. Commits used explicit pathspecs and hooks ran (biome and commitlint passed). No `--no-verify`.

## Issues Encountered

None.

## Verification

- `pnpm vitest run` over classify-control-chars, classify-run, classify-llm-tier, classify-hermetic, llm-output, prompt-version, db classify and db ingest: 8 files, 232 tests passed.
- `pnpm typecheck`: passed. `pnpm lint`: 1 warning, the existing noTemplateCurlyInString in apps/worker/test/node-version.test.ts, which is unrelated.
- `git diff --quiet 1aae7bc -- apps/worker/src/classify/run.ts packages/core/test/prompt-version.test.ts packages/core/src/classify/prompt.ts packages/core/src/classify/prompt-version.ts`: exit 0.
- 03-26's files (packages/core/src/rules/schema.ts, apps/worker/test/config-check-rules.test.ts, packages/core/test/rules.test.ts) were not touched.
- All acceptance criteria for both tasks pass: the greps, the ASCII counts (0 for every file, 6 for llm-output.test.ts), and no `wellFormed` in packages/db/src/index.ts.

## User Setup Required

None. No external service configuration required.

## Next Phase Readiness

The worker side of WR-04 / SC5 is closed. WR-05 (unpaired surrogates in rules.yaml) is plan 03-26, which runs next on the same tree. After 03-26, phase 3 is ready for re-verification.

## Self-Check: PASSED

- FOUND: all 6 modified files
- FOUND: c6306b1, c5a1d3c, bb0cc78 (ancestors of HEAD)

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-12*
