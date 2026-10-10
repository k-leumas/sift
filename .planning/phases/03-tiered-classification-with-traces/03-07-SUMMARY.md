---
phase: 03-tiered-classification-with-traces
plan: 07
subsystem: classify
tags: [ollama, fetch, llm, retry, preflight, single-flight, fake-server, prompt-injection]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-05 @sift/core/classify: renderMessages, makeNonce, llmOutputSchema, ollamaFormat, validateLlmOutput, MODEL_OPTIONS, REQUEST_FLAGS, RETRY_NOTE, LlmAttemptSpan"
  - phase: 03-tiered-classification-with-traces
    provides: "03-01 ./classify export of @sift/core"
provides:
  - "createOllamaClient: fetch LlmClient with the D-16/D-24 result union (ok, infra, input_too_long, aborted)"
  - "runLlmTier: call, re-validate, retry once with the closed-set note, LlmAttemptSpan per attempt, E11 context-budget check"
  - "createPreflight: /api/version, /api/tags, /api/show; fails closed on missing, remote and non-completion models"
  - "createSingleFlight, gateClient, gatePreflight: one Ollama request at a time (D-19)"
  - "apps/worker/test/support/fake-ollama.ts: scripted, recording node:http fake with compromised mode and a character budget"
affects: [03-08, 03-09, 03-10, phase-04-apply]

actuals:
  tokens: 17600
  tasks: 3
  commits: 5
plan_head_before: e71911d71e600d3cd3b6fc51882199da662af940
plan_head_after: d599cdc4b268f89b5b6fc910e4e4a89c10cfc35e

tech-stack:
  added: []
  patterns:
    - "Transport results are a discriminated union; the client never throws for an expected failure and never logs"
    - "Shutdown is checked before the error name, so a combined AbortSignal.any cannot turn shutdown into a timeout"
    - "Wire-level tests: every outcome is asserted against a real local HTTP server, with the chat-call count in each case"

key-files:
  created:
    - apps/worker/src/classify/ollama-client.ts
    - apps/worker/src/classify/llm-tier.ts
    - apps/worker/src/classify/preflight.ts
    - apps/worker/src/classify/single-flight.ts
    - apps/worker/test/support/fake-ollama.ts
    - apps/worker/test/classify-llm-tier.test.ts
    - apps/worker/test/classify-ollama-client.test.ts
    - apps/worker/test/classify-preflight.test.ts
  modified: []

key-decisions:
  - "input_too_long only for HTTP 400 with the context-length text; a 5xx that mentions context stays infra server_error (an outage is never a decision)"
  - "The input_too_long attempt span carries a fixed detail, never Ollama's error text, which can quote the prompt (T-03-25)"
  - "The client reports a missing response model as null instead of copying the request model, so a trace never invents a value"
  - "Metric counters that are not finite non-negative numbers become null, so a strange server cannot make the span fail its schema"
  - "Preflight matches a configured name without a tag against `<name>:latest`; any set remote_host/remote_model value (not only strings) fails closed"
  - "Fake script arrays that run out answer 500, so an unplanned extra call fails a test instead of being answered"

patterns-established:
  - "okAnswer/contentAnswer(extra): extra.message merges into message (thinking, tool_calls), other keys go to the response top level"

requirements-completed: [CLS-02, CLS-03, CLS-05, SEC-01]

coverage:
  - id: D1
    description: "Every /api/chat request is exactly the E11 request: stream, think, truncate, shift false, keep_alive 30m, the four options, the snapshot's format, two messages, no tools key"
    requirement: CLS-02
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#sends the exact request over HTTP and returns a validated verdict with its attempt"
        status: pass
    human_judgment: false
  - id: D2
    description: "Retry once only for invalid output; 34 scripted bad answers end as review out_of_category or invalid_output, the second attempt differs only by nonce and retry note; never a third call"
    requirement: CLS-03
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#closed output: off-list answers twice end as review out_of_category (E1, D-24)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#invalid answers twice end as review invalid_output, never repaired (E1, D-24)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#retry outcomes (D-24)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Only validated message.content counts: tool_calls, extra keys and thinking never change the verdict; empty content and {} end as review invalid_output (CLS-05 empty edge)"
    requirement: CLS-05
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#only validated message.content counts (CLS-05, E2)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#invalid answers twice end as review invalid_output, never repaired (E1, D-24)"
        status: pass
    human_judgment: false
  - id: D4
    description: "input_too_long (context 400 or prompt_eval_count >= 7936) is review after one call; infra on either attempt and shutdown give no verdict"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#input_too_long is a review after one call, never retried (E5, E11, Pitfall 3)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#an outage is never a verdict (E5, D-16)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Client classifies every transport outcome at the wire: unreachable (refused, DNS), timeout, 404, 429, 503, 500, other 400, non-chat 200, reset mid-body, abort"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-ollama-client.test.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "A compromised model can only pick an in-list category (labelled) or end in review; the fenced prompt keeps email text out of the system message"
    requirement: SEC-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-llm-tier.test.ts#a compromised model is bounded by the closed output (E4)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Preflight fails closed before any chat call on missing, remote (remote_host / remote_model) or non-completion models and returns version and digest on success"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-preflight.test.ts#createPreflight (local model only, fail closed)"
        status: pass
    human_judgment: false
  - id: D8
    description: "FIFO single-flight gate: s1,e1,s2,e2,s3,e3 order; gated chats and preflights never overlap at the fake (maxInFlight 1, ungated positive control > 1)"
    verification:
      - kind: unit
        ref: "apps/worker/test/classify-preflight.test.ts#createSingleFlight (D-19)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-preflight.test.ts#gated Ollama calls never overlap at the fake (D-19, E6)"
        status: pass
    human_judgment: false

duration: 13min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 07: Ollama Client, LLM Tier, Preflight and Single Flight Summary

**A fetch-based Ollama client whose result union keeps outages (infra) apart from model answers, a call-validate-retry-once tier that records every attempt byte for byte, a local-model preflight that refuses cloud and missing models before any mail is sent, a FIFO single-flight gate, and the scripted fake Ollama every classification test runs against**

## Performance

- **Duration:** about 13 min
- **Started:** 2026-10-10T20:31:50Z
- **Completed:** 2026-10-10T20:45:04Z
- **Tasks:** 3
- **Files modified:** 8 (all created)

## Accomplishments
- `ollama-client.ts` sends `{ model, messages, format, options, ...REQUEST_FLAGS }` and nothing else. It sorts every failure into unreachable, timeout, model_missing, busy, server_error or rejected, plus input_too_long and aborted. It never throws for these and never logs.
- `llm-tier.ts` makes at most two attempts with a fresh nonce each. The only extra on the second attempt is the closed-set retry note after the fence. Each attempt becomes an `LlmAttemptSpan` with the raw content exactly as sent, any non-empty thinking text, done_reason, snake_case metrics and the validation result. An ok answer whose prompt_eval_count reaches 7936 (8192 - 256) is review input_too_long.
- `preflight.ts` reads only /api/version, /api/tags and /api/show. It returns the Ollama version and model digest, or fails closed with model_missing, remote_model or model_unsuitable.
- `single-flight.ts` is the AI-SPEC FIFO gate plus `gateClient`/`gatePreflight`. Nothing is created at module scope.
- `fake-ollama.ts` serves all four endpoints. It records method, path, body and origin, tracks the peak number of requests in flight, and supports scripts (status, json/body, delay, hang, reset mid-body), compromised mode and a character budget.
- 81 tests across the three files. The full apps/worker suite passes (709/709) and `pnpm typecheck` and `pnpm lint` exit 0.

## Task Commits

1. **Task 1: Tracer, fenced request to the fake and back as a validated verdict** - `045d088` (feat)
2. **Task 2 RED: response matrix and client outcome tests** - `22ad1fb` (test)
3. **Task 2 GREEN: E11 context-budget check** - `ecdbb53` (feat)
4. **Task 3 RED: preflight and single-flight tests** - `dfd080d` (test)
5. **Task 3 GREEN: preflight and single-flight gate** - `d599cdc` (feat)

REFACTOR: none needed.

## TDD Gate Compliance

- **Task 2 RED (`22ad1fb`):** I ran only the target, `-t "prompt_eval_count 7936"`, with the tap-flat reporter. It exited 1 and the other 38 tests were skipped. `gsd check tdd-red-evidence` returned **RED_EVIDENCE_OK target_test_failed**. Semantic assessment: the target ran and failed on the planned assertion ("expected 'decided' to be 'review'"), because the context-budget check did not exist yet. There were no load, fixture or syntax faults. In the whole-file run only the 7936 and 9000 cases failed. The other matrix and client cases passed at RED by design, since the Task 1 tracer had already built that code.
- **Task 2 GREEN (`ecdbb53`):** 59/59 pass.
- **Task 3 RED (`dfd080d`):** wrong-value scaffolding for `preflight.ts` and `single-flight.ts` sat in the working tree only and was never committed. 17 of 22 tests failed, every one an AssertionError. The target, `-t "remote_host is infra remote_model"` with tap-flat, returned **RED_EVIDENCE_OK target_test_failed**. Semantic assessment: the stub preflight accepted a cloud model, which is the exact gap the test exists for. Five tests passed at RED by design: two gate-isolation cases, the ungated positive control, "missing version and digest are null" and "show without capabilities passes".
- **Task 3 GREEN (`d599cdc`):** 81/81 pass across the three files.
- Each `test(03-07)` commit comes before its `feat(03-07)` commit.

## Files Created/Modified
- `apps/worker/src/classify/ollama-client.ts` - LlmClient, LlmCallResult, InfraCode, LLM_CALL_TIMEOUT_MS, ERROR_TEXT_MAX_CHARS, plus errorText/causeCode/statusCode/fetchFailure/isRecord for internal reuse
- `apps/worker/src/classify/llm-tier.ts` - runLlmTier, LlmTierResult
- `apps/worker/src/classify/preflight.ts` - createPreflight, PreflightResult, PREFLIGHT_TIMEOUT_MS
- `apps/worker/src/classify/single-flight.ts` - createSingleFlight, SingleFlight, gateClient, gatePreflight
- `apps/worker/test/support/fake-ollama.ts` - startFakeOllama, okAnswer, contentAnswer, FAKE_MODEL/FAKE_DIGEST/FAKE_VERSION, CONTEXT_LENGTH_ERROR
- `apps/worker/test/classify-{llm-tier,ollama-client,preflight}.test.ts` - 81 tests

## Decisions Made
See key-decisions in the frontmatter. The two that differ from the AI-SPEC sample code are (1) input_too_long applies to a 400 only, where the sample matched the context text on any non-OK status, and (2) the response model can be null, where the sample fell back to the request model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] Ollama's context-length error text kept out of the attempt span**
- **Found during:** Task 1 (llm-tier.ts)
- **Issue:** The AI-SPEC sample put the 400's error text into the attempt's validation detail. That detail goes into decision.spans, and T-03-25 says Ollama error text, which can quote the prompt, must never be logged or stored.
- **Fix:** The attempt detail is now a fixed sentence. A test asserts that the fake's error text does not appear anywhere in the result.
- **Files modified:** apps/worker/src/classify/llm-tier.ts, apps/worker/test/classify-llm-tier.test.ts
- **Committed in:** 045d088, 22ad1fb

**2. [Rule 1 - Bug] A 5xx mentioning "context" would have been recorded as a decision**
- **Found during:** Task 1 (ollama-client.ts)
- **Issue:** The sample checked the context regex before the status. A runner 500 such as "failed to grow the context length buffer" would then have become review input_too_long, which records an outage as a classification (D-16, E5).
- **Fix:** Only a 400 can be input_too_long. A test covers it.
- **Committed in:** 045d088, 22ad1fb

**3. [Rule 1 - Bug] Non-object or odd JSON bodies and metrics**
- **Found during:** Task 1 (ollama-client.ts)
- **Issue:** In the sample, a 200 whose body is `null` would throw on `body.message`, and a negative or non-finite metric would fail the span schema later on.
- **Fix:** Every body is checked to be an object first, and a counter that is not a finite non-negative number becomes null. Tests cover a 200 array, done false, a negative eval_count and a string load_duration.
- **Committed in:** 045d088, 22ad1fb

---

**Total deviations:** 3 auto-fixed (1 Rule 2, 2 Rule 1)
**Impact on plan:** Each one tightens the D-16/D-24 boundary or T-03-25. There is no scope creep and no new dependency.

## Issues Encountered
- `pnpm lint` shows one warning that was already there (noTemplateCurlyInString in apps/worker/test/node-version.test.ts). It is unrelated.
- The `http://ollama.invalid` client case uses the system resolver. On this Mac it returns ENOTFOUND at once; the test also accepts EAI_AGAIN.

## Known Stubs
None.

## User Setup Required
None. No external service configuration required.

## Next Phase Readiness
- 03-08 can compose the pass from these parts: `gatePreflight(createPreflight(url), gate)` once per tick, then `runLlmTier(gateClient(createOllamaClient(url), gate), ...)` per message. A decided or review result goes straight into `decide({ llm: { verdict, context } })`. The span context takes `responseModel`, `ollamaVersion` and `modelDigest`. An infra result writes nothing, and its `detail` must not be logged or stored.
- The worker (03-09) creates one `createSingleFlight()` at startup.
- Recorded assumption kept: a per-message poison 500 stays infra (flagged for the owner in the plan).

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*

## Self-Check: PASSED
