---
phase: 03-tiered-classification-with-traces
plan: 05
subsystem: classify
tags: [zod, ollama, prompt-injection, nonce-fence, json-schema, traces, sha256]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-01 ./classify export target in packages/core/package.json; rules snapshot shape (categories, judgment)"
provides:
  - "@sift/core/classify: trusted/untrusted prompt render with per-call 96-bit nonce fence (renderSystem, renderUser, renderMessages, makeNonce)"
  - "MODEL_OPTIONS, REQUEST_FLAGS, RETRY_NOTE as pure core constants (prompt_version hash material)"
  - "llmOutputSchema / ollamaFormat / validateLlmOutput: strict re-validation, no repair"
  - "decisionSpansSchema + span schemas and types, TRACE_FORMAT_VERSION 1, CLASSIFIER_SKIPPED_SPAN, LLM_SPAN_OPTIONS"
  - "canonicalJson + sha256Hex shared with the rule-set hash (03-04)"
  - "promptMaterial(): category-independent prompt hash, pinned in prompt-version.test.ts"
affects: [03-04, 03-06, 03-07, 03-08, 03-10, phase-04-apply, TRC-05]

actuals:
  tokens: 13400
  tasks: 2
  commits: 3
plan_head_before: eb3512d180c236c834685ad201f3dbd274c2936a
plan_head_after: 8f8e3f8c450c1ecae2331131b36ea57bf8daf33c

tech-stack:
  added: []
  patterns:
    - "Hash material is computed from placeholder renders plus constants, through promptMaterialFrom(parts) so a test swaps one part"
    - "Every span object is z.strictObject; layout is a z.union of two fixed tuples"
    - "Validation failure details carry issue paths and codes only, never model or parse-error text"

key-files:
  created:
    - packages/core/src/classify/prompt.ts
    - packages/core/src/classify/llm-output.ts
    - packages/core/src/classify/spans.ts
    - packages/core/src/classify/canonical.ts
    - packages/core/src/classify/prompt-version.ts
    - packages/core/src/classify/index.ts
    - packages/core/test/prompt.test.ts
    - packages/core/test/llm-output.test.ts
    - packages/core/test/spans.test.ts
    - packages/core/test/prompt-version.test.ts
  modified: []

key-decisions:
  - "out_of_category requires the answer's category to be a string; a missing or non-string category is schema_mismatch (Zod enum reports a missing value as invalid_value)"
  - "not_json detail is a fixed string: V8 JSON.parse messages quote the input"
  - "Reason cap is counted in code points (Zod 4.6.5 and the grammar agree); 200 emoji pass, 201 fail"
  - "LLM span adds a refine: a non-null result category must be one of the span's categories"
  - "Header fields use the same surrogate-safe cut as the body"
  - "EXPECTED_PROMPT_HASH = 8bd77eefeaa3de33f29d99ffb88d789e37cb3a3e88d77e995bd4d1193e707d97 (prompt_version 1 material)"

patterns-established:
  - "Pinned prompt hash: any template, retry note, option, flag, limit or schema-shape change fails prompt-version.test.ts and means a new prompt_version row"

requirements-completed: [CLS-02, CLS-03, SEC-01, TRC-01, TRC-03, TRC-06]

coverage:
  - id: D1
    description: "Trusted/untrusted prompt split with a nonce fence; every email field provably inside the fence, system message byte-identical across emails (E3, E14 inclusion)"
    requirement: CLS-02
    verification:
      - kind: unit
        ref: "packages/core/test/prompt.test.ts#renderMessages (D-21, SEC-01, E3)"
        status: pass
      - kind: unit
        ref: "packages/core/test/prompt.test.ts#renderSystem (E14 inclusion)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SEC-01 render-level edges: CR/LF/NUL field forgery blocked, 300-char headers, nonce collision throws, empty email, surrogate-safe 4,000-char body cut"
    requirement: SEC-01
    verification:
      - kind: unit
        ref: "packages/core/test/prompt.test.ts#SEC-01 edges"
        status: pass
    human_judgment: false
  - id: D3
    description: "Output schema, verified Ollama format and re-validation matrix without repair (adjacency, empty, encoding, ordering edges)"
    requirement: CLS-03
    verification:
      - kind: unit
        ref: "packages/core/test/llm-output.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "decision.spans schema: two fixed layouts, classifier span always at index 1, strict objects, 23 rejection cases"
    requirement: TRC-01
    verification:
      - kind: unit
        ref: "packages/core/test/spans.test.ts"
        status: pass
      - kind: unit
        ref: "packages/core/test/prompt.test.ts#trace span for a rendered request (D-27, D-28, TRC-03)"
        status: pass
    human_judgment: false
  - id: D5
    description: "TRC-06 adjacency: M2 can record a real classifier span at index 1 without a layout change"
    requirement: TRC-06
    verification: []
    human_judgment: true
    rationale: "Backstop edge by plan design: M2 cannot be observed in Phase 3; only the fixed index-1 position is tested"
  - id: D6
    description: "Category-independent prompt_version hash, pinned, sensitive to every hashed part"
    verification:
      - kind: unit
        ref: "packages/core/test/prompt-version.test.ts"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 05: LLM Prompt, Output and Trace Contracts Summary

**Nonce-fenced trusted/untrusted prompt render, strict no-repair output re-validation against the verified Ollama format, the fixed-order decision.spans schema, and a pinned category-independent prompt_version hash, all as pure code in @sift/core/classify**

## Performance

- **Duration:** about 11 min
- **Started:** 2026-10-10T19:17:21Z
- **Completed:** 2026-10-10T19:28:30Z
- **Tasks:** 2
- **Files modified:** 10 (all created)

## Accomplishments
- `prompt.ts` renders a system message built only from the rules snapshot and a user message where every email field sits inside `<<<EMAIL nonce>>>` markers. Headers are one line, capped at 300 characters, with control characters stripped. The body is cut at 4,000 UTF-16 units without splitting a surrogate pair, and a nonce collision throws. The file also holds MODEL_OPTIONS, REQUEST_FLAGS and the four RETRY_NOTE sentences, word for word as in the AI-SPEC.
- `llm-output.ts` gives an Ollama format that matches the AI-SPEC verified JSON byte for byte. `validateLlmOutput` sorts every bad answer into not_json, out_of_category or schema_mismatch and never repairs it. 42 cases are tested.
- `spans.ts` defines the trace layout as exact_rules, classifier (always skipped, "not trained"), an optional llm span, then a pending action. Every object is strict. The schema has no field for the rendered prompt.
- `canonical.ts` and `prompt-version.ts` hash the placeholder template, retry notes, schema shape, options, flags and limits. The hash is pinned at `8bd77eef...7d97`.

## Task Commits

1. **Task 1: Tracer: fenced request plus validated span** - `87db968` (feat)
2. **Task 2 RED: output matrix, span rejections, failing hash tests** - `2a4b7e2` (test)
3. **Task 2 GREEN: canonical JSON and prompt material hash** - `8f8e3f8` (feat)

REFACTOR: none needed.

## TDD Gate Compliance (Task 2, tdd="true")

- **RED (`2a4b7e2`):** `prompt-version.test.ts` ran against stubs in `canonical.ts` and `prompt-version.ts` that return wrong values: 21 of 23 failed, every one an AssertionError on the planned behaviour (unsorted JSON, empty hash, missing placeholders, an empty schema shape, hashes that do not change). Two passed early. The bigint case passed because `JSON.stringify` already throws TypeError on a bigint. The "recompute from the real parts" case passed because both stub hashes are empty. My review of the RED results: valid. No import, syntax or fixture errors. `llm-output.test.ts` and `spans.test.ts` exercise the code that Task 1 (the tracer) already built, so they passed at RED by design.
- **GREEN (`8f8e3f8`):** after the implementation, all four files pass (117 tests).
- The gate commits `test(03-05)` and then `feat(03-05)` are both present, in that order.

## Files Created/Modified
- `packages/core/src/classify/prompt.ts` - prompt render, nonce, body cut, constants, retry notes
- `packages/core/src/classify/llm-output.ts` - output schema, Ollama format, re-validation
- `packages/core/src/classify/spans.ts` - decision.spans schemas, types, TRACE_FORMAT_VERSION, LLM_SPAN_OPTIONS
- `packages/core/src/classify/canonical.ts` - canonicalJson, sha256Hex
- `packages/core/src/classify/prompt-version.ts` - PromptMaterial, promptMaterialFrom, PROMPT_MATERIAL_PARTS, promptMaterial
- `packages/core/src/classify/index.ts` - @sift/core/classify barrel
- `packages/core/test/{prompt,llm-output,spans,prompt-version}.test.ts` - 117 tests

## Decisions Made
See key-decisions in the frontmatter. Beyond the plan's interfaces, I also exported the span schemas (`*SpanSchema`), `ATTEMPT_FAILURE_CODES`, `LLM_SPAN_OPTIONS`, and from prompt-version.ts `PROMPT_MATERIAL_PARTS` and `promptMaterialFrom`, so 03-06 and 03-07 can build spans without restating any constant.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan premise: "Zod counts UTF-16 units" is false for Zod 4.6.5**
- **Found during:** Task 2 (llm-output.test.ts)
- **Issue:** The CLS-03 encoding-edge truth expects a reason of 101 astral emoji (202 UTF-16 units) to be schema_mismatch. Zod 4.6.5 measures `.max()` in code points (`checks.js` codePointLength), the same way the grammar does, so it accepts 101 emoji.
- **Fix:** Kept the AI-SPEC schema (no extra UTF-16 refine). The test now pins the real boundary instead: 200 emoji (400 units) pass, 201 fail. The guarantee the plan cares about, "the code is never looser than the grammar", still holds, because code and grammar now agree exactly. An extra UTF-16 check would reject answers the grammar allows, costing a retry and then a review. The AI-SPEC only accepted that cost; it was never a goal.
- **Verifier note:** the must_have truth "101 astral-plane emoji ... fails validation as schema_mismatch" is not met as worded. It should read "201 code points fail".
- **Files modified:** packages/core/test/llm-output.test.ts, llm-output.ts (comment)
- **Committed in:** 2a4b7e2, 8f8e3f8

**2. [Rule 1 - Bug] AI-SPEC out_of_category check misclassified `{}` and a missing category**
- **Found during:** Task 1 (llm-output.ts)
- **Issue:** `z.enum` reports a missing value as `invalid_value` at `category`, so the AI-SPEC check would have called `{}` out_of_category. The plan requires schema_mismatch.
- **Fix:** out_of_category now also requires `parsed.category` to be a string.
- **Committed in:** 87db968

**3. [Rule 2 - Security] The not_json detail echoed raw model text**
- **Found during:** Task 1 (llm-output.ts)
- **Issue:** The AI-SPEC passed `JSON.parse`'s `error.message` on as the detail. V8 quotes the input in that message, so model text that may echo the email would have reached logs.
- **Fix:** The detail is now a fixed string. Tests assert that no failure detail contains raw text.
- **Committed in:** 87db968

**4. [Rule 2 - Correctness] Extra cross-field check in the LLM span**
- **Found during:** Task 1 (spans.ts)
- **Issue:** Without it, a stored trace could hold a result category that is not among the span's own categories (a CLS-05 corruption).
- **Fix:** A superRefine on LlmSpanSchema, plus a rejection test.
- **Committed in:** 87db968, 2a4b7e2

---

**Total deviations:** 4 auto-fixed (2 Rule 1, 2 Rule 2)
**Impact on plan:** All four tighten correctness or security. One must_have truth (the emoji count) is reworded to match what Zod really does, and it is flagged for the verifier.

## Issues Encountered
- My first surrogate test had wrong arithmetic (expected 4102 instead of 4101), and Biome flagged a control-character regex. Both were fixed before the Task 1 commit.
- `pnpm lint` shows one warning that was already there, in apps/worker/test/node-version.test.ts (noTemplateCurlyInString). It is unrelated and out of scope.

## User Setup Required
None. No external service configuration required.

## Next Phase Readiness
- 03-04 can import `canonicalJson`/`sha256Hex` for the rule-set hash. 03-06 can validate `decision.spans` with `parseDecisionSpans` and use `TRACE_FORMAT_VERSION`. 03-07 can build requests from `renderMessages`, `MODEL_OPTIONS`, `REQUEST_FLAGS` and `RETRY_NOTE`, and spans from `LLM_SPAN_OPTIONS` and `bodySummary`. The prompt_version row comes from `promptMaterial()`.
- Plan verification: `pnpm vitest run packages/core` gives 321 tests passing across 10 files. `pnpm typecheck` exits 0.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*

## Self-Check: PASSED
