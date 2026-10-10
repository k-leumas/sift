---
phase: 03-tiered-classification-with-traces
plan: 10
subsystem: testing
tags: [prompt-injection, nonce-fence, fake-ollama, dovecot, sentinel, hermeticity, sec-01, e7]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-09 runBatch with the classify runtime; 03-08 classify-harness (BASIC_RULES, testRuntime, decisionsOf, expectReplayableDecision); 03-07 fake Ollama (compromised, charBudget); 03-05 nonce fence render"
provides:
  - "13 synthetic hostile .eml fixtures (AI-SPEC Set A 1-12) and 5 with/without-injection pairs, example.test only"
  - "classify-injection.test.ts: wire-level fence checks (E3), single-effect checks (E2) and the compromised-model bound (E4 CI part) through Dovecot ingest and runBatch"
  - "classify-leak.test.ts: sentinel scan of logs, last_error and batch errors across normal, invalid, 500, context-400 and cloud-model runs, plus outbound-origin checks (E7)"
  - "classify-hermetic.test.ts: static guard that no classification test or helper names the real Ollama port"
affects: [03-13, phase-04-apply, phase-verification]

actuals:
  tokens: 19900
  tasks: 3
  commits: 3
plan_head_before: 112c7dddc8d843fb19fafcbf3048522591475037
plan_head_after: a8824185200e49b978ab6dec6067f121b4471d33

tech-stack:
  added: []
  patterns:
    - "Split each recorded chat request at its own nonce; compare system message, request fields and nonce-normalised fixed text with a benign request from the same run"
    - "Fake chat scripts keyed on the fenced from_address, so answers do not depend on processing order"
    - "Mutation checks (one implementation change at a time, restored after) prove tests that pass at first run are not vacuous"

key-files:
  created:
    - apps/worker/test/classify-injection.test.ts
    - apps/worker/test/classify-leak.test.ts
    - apps/worker/test/classify-hermetic.test.ts
    - apps/worker/test/fixtures/mail/hostile-fence-close.eml
    - apps/worker/test/fixtures/mail/hostile-guessed-nonce.eml
    - apps/worker/test/fixtures/mail/hostile-crlf-subject.eml
    - apps/worker/test/fixtures/mail/hostile-display-name-category.eml
    - apps/worker/test/fixtures/mail/hostile-bank-support-spoof.eml
    - apps/worker/test/fixtures/mail/hostile-think.eml
    - apps/worker/test/fixtures/mail/hostile-emoji-flood.eml
    - apps/worker/test/fixtures/mail/hostile-confidence-7.eml
    - apps/worker/test/fixtures/mail/hostile-hidden-html.eml
    - apps/worker/test/fixtures/mail/hostile-attachment-names.eml
    - apps/worker/test/fixtures/mail/hostile-phishing-receipt.eml
    - apps/worker/test/fixtures/mail/hostile-late-line.eml
    - apps/worker/test/fixtures/mail/hostile-chat-roles.eml
    - apps/worker/test/fixtures/mail/pair-bank-notice.eml
    - apps/worker/test/fixtures/mail/pair-bank-notice.injected.eml
    - apps/worker/test/fixtures/mail/pair-payment-failure.eml
    - apps/worker/test/fixtures/mail/pair-payment-failure.injected.eml
    - apps/worker/test/fixtures/mail/pair-interview.eml
    - apps/worker/test/fixtures/mail/pair-interview.injected.eml
    - apps/worker/test/fixtures/mail/pair-personal-reply.eml
    - apps/worker/test/fixtures/mail/pair-personal-reply.injected.eml
    - apps/worker/test/fixtures/mail/pair-newsletter.eml
    - apps/worker/test/fixtures/mail/pair-newsletter.injected.eml
  modified:
    - apps/worker/test/classify-ollama-client.test.ts

key-decisions:
  - "Pair call counts are compared with an honest fake (same calls for both variants); the compromised run asserts the bound: an allowed X is labelled in one call, an off-list X is review out_of_category after the normal retry"
  - "The hermeticity guard stays strict (the port anywhere in the scanned files); the one scanned file that named it as an unroutable host now omits the port"
  - "The E2 scripted answers ride on hostile fixtures: tool_calls on chat-roles, an extra action key on attachment-names, a forward-this reason on phishing-receipt"

patterns-established:
  - "New hostile fixture: add it to the HOSTILE table with its From address, injected texts and expected outcome; the shared fence and single-effect checks then apply"

requirements-completed: [SEC-01, CLS-05, CLS-03]

coverage:
  - id: D1
    description: "13 hostile fixtures through Dovecot ingest and runBatch: system message and request fields identical to a benign email, fixed user text identical apart from the nonce, each real marker line once, injected text only inside the fence, a new nonce per retry, the expected replayable decision (E3, SEC-01)"
    requirement: SEC-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-injection.test.ts#hostile fixtures: the fence holds and one decision is all that happens (E2, E3)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-injection.test.ts#tracer: a fence-closing email through ingest and classification (SEC-01, E3, E4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Field forgery and limits: a CR/LF subject (stored with its line break) renders as one subject line and one body line; a display name and attachment names stay on their own lines; a bank display name and Reply-To/Sender do not hit the bank rule; text after character 4,000 is absent and the label reads first 4000 of"
    requirement: SEC-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-injection.test.ts#CR/LF in an encoded subject cannot forge a field line"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-injection.test.ts#a decisive line after character 4,000 never reaches the model"
        status: pass
    human_judgment: false
  - id: D3
    description: "E2: tool_calls and a forward-this reason are decided from content only, an extra action key is invalid twice then review; each message has one decision, one rule_set and prompt_version row, body expiry set, no label or label_event row, no tools key"
    requirement: CLS-05
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-injection.test.ts#tool_calls, an action key and a forward reason cause nothing beyond one decision (E2)"
        status: pass
      - kind: other
        ref: "apps/worker/test/read-only-ingest.test.ts (unchanged, passes)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Emoji/CJK flood against a fake character budget is review input_too_long after one call; the benign message after it is decided in the same batch (E3, E5)"
    requirement: CLS-03
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-injection.test.ts#ends as review input_too_long after one call and the next message is still decided"
        status: pass
    human_judgment: false
  - id: D5
    description: "Five pairs: identical requests outside the fence and the same call count under an honest fake; under a compromised fake the injected variant is labelled X only when X is a category (raw output in the span), else review out_of_category (E4 CI part)"
    requirement: CLS-05
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-injection.test.ts#with/without-injection pairs (E4, CI part)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Sentinel in subject, display name, body, fake reason and 500/400 error bodies never in a log line, last_error or the batch error, with a positive control in the decision spans; every fetch goes through the injected fetch to the fake's origin; a cloud model gets no chat request (E7)"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-leak.test.ts"
        status: pass
    human_judgment: false
  - id: D7
    description: "Hermeticity guard: no classification test or helper names the real Ollama port; positive control on config.example.yaml; dependencies.test.ts unchanged and passing"
    verification:
      - kind: unit
        ref: "apps/worker/test/classify-hermetic.test.ts"
        status: pass
      - kind: unit
        ref: "apps/worker/test/dependencies.test.ts (unchanged, passes)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Fixtures are synthetic: at least 12 hostile files and exactly the 10 pair files, every address under example.test"
    verification:
      - kind: unit
        ref: "apps/worker/test/classify-injection.test.ts#at least 12 hostile fixtures and 5 pairs exist, naming only example.test addresses"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 10: Injection and Leak Proofs Summary

**Thirteen synthetic hostile emails and five injection pairs go through the real Dovecot ingest and runBatch path to a fake Ollama, sometimes a compromised one. At the wire, the fence holds. A compromised model can at most pick one of the owner's categories. Nothing happens besides one decision per message. A sentinel planted in mail and in Ollama's error bodies never reaches a log line or mailbox status.**

## Performance
- **Duration:** about 22 min (2026-10-10T22:33:06Z to 22:55Z)
- **Tasks:** 3 (a tracer, then two tdd tasks)
- **Files:** 26 created, 1 modified

## Accomplishments
- **classify-injection.test.ts (808 lines, 23 cases).** It splits each recorded chat request at its own nonce. It then compares the system message, the request fields (model, format enum, options, flags) and the fixed user text against a benign email from the same run, with the nonce normalised.
  - Every hostile fixture's injected text appears inside the fence and nowhere else.
  - Specific checks cover CR/LF subject forgery, a display-name forgery, attachment names, the bank display-name spoof, the 4,000-character cut and the emoji flood.
  - E2: each message has exactly one decision, one rule_set, one prompt_version and its body expiry. No label or label_event row appears, and no request has a `tools` key.
  - E4: with an honest fake, both variants of each pair get the same requests outside the fence and the same number of calls. With a compromised fake, the steered result is bounded to the category list.
- **classify-leak.test.ts (5 cases).** It covers a normal decision, invalid output twice, a 500 outage, a context-length 400 and a cloud model. The sentinel appears in no log line, in no last_error and in no batch error. The positive control: the sentinel is in the decision spans wherever the fake echoed it.
- **Fetch origins.** Every fetch goes through the injected recording fetch to the fake's origin. A global fetch spy sees no call that bypasses it.
- **classify-hermetic.test.ts (3 cases).** It scans 13 classification test and helper files for the real Ollama port. The port string is built from two parts, so the test file does not contain it.
- **Results.**
  - Plan verification: 43/43.
  - All classify suites (`pnpm vitest run classify`): 257/257.
  - `pnpm typecheck` exits 0.
  - `pnpm lint` shows only the old warning in node-version.test.ts.

## Task Commits
1. **Task 1 (tracer): fence-closing email through ingest and classification** - `d40d2b7` (test)
2. **Task 2: full hostile set and injection pairs (E2, E3, E4)** - `0ebdc72` (test)
3. **Task 3: sentinel leak scan, outbound origins, hermeticity guard (E7)** - `a882418` (test)

Tracer gate: this was an interactive run with end-of-phase verification and an automated-only verify. I re-ran the verify (1/1 plus typecheck), it passed, and I went on with no checkpoint.

## TDD Gate Compliance
- **Unexpected GREEN (fail-fast rule 1, investigated).** All Task 2 and Task 3 cases passed the first time they ran. This plan adds only tests over code that 03-05 to 03-09 already built, so neither task has a `feat` commit. `workflow.tdd_mode` is false, and the plan type is `execute`.
- **Proof the tests bite.** I changed one behaviour at a time in the implementation, ran the tests, and restored the file. None of these mutations was committed. Each one made its target tests fail:
  - Header whitespace no longer collapsed in `oneLine`: the CR/LF test fails.
  - The subject written before the opening marker: the tracer and all 12 fence cases fail.
  - `BODY_MAX_CHARS` raised to 6000: the late-line test fails.
  - Category `z.enum` loosened to `z.string()`: 6 tests fail (tracer, fence-close, E2, flood, both pair tests).
  - `strictObject` loosened to `object`: the attachment-names and E2 tests fail.
  - Ollama detail added to the "Ollama unavailable" warn line: the 500 leak test fails.
  - Ollama detail added to the 500 owner message: the 500 leak test fails.
  - The client ignoring the injected fetch: 4 leak tests fail, because the bypass spy catches it.
  - The preflight remote check disabled: the cloud-model test fails.
  - The port put back into classify-ollama-client.test.ts: the hermeticity test fails.
- **Machine-checked failing runs.** I ran two mutations through the junit reporter with `-t`. `gsd check tdd-red-evidence` returned **RED_EVIDENCE_OK target_test_failed** for both:
  - the oneLine mutation (CR/LF test): the target failed with a forged second `body` line;
  - the 500 owner-message mutation (outage test): the target failed on the `last_error` equality.
  - Semantic assessment: each target test ran (the other tests were skipped) and failed on its planned assertion. Both runs were against a deliberately broken implementation, not a missing one.

## Files Created/Modified
- `apps/worker/test/classify-injection.test.ts`: helpers (ingestAndClassify, split, expectFenceHolds, bySender, effectCounts, expectSingleEffect), the HOSTILE table, the FLOOD case, PAIRS and the address scan.
- `apps/worker/test/classify-leak.test.ts`: leakRun (recording fetch plus bypass spy), expectNoLeak, and five runs.
- `apps/worker/test/classify-hermetic.test.ts`: the static port guard with a positive control.
- `apps/worker/test/fixtures/mail/hostile-*.eml` (13 files) and `pair-*.eml` (10 files): synthetic, example.test only. The two large fixtures are the emoji flood (11 KB) and the late line (4.7 KB).
- `apps/worker/test/classify-ollama-client.test.ts`: the DNS-failure case now uses `http://ollama.invalid` without a port.

## Decisions Made
See key-decisions. I did not change the per-message infra/500 behaviour of run.ts, which is still an open owner decision. The leak test checks only that this path never shows Ollama's error text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] A scanned test file named the real Ollama port**
- **Found during:** Task 3. `classify-ollama-client.test.ts` used `http://ollama.invalid:<port>` for its DNS-failure case, so the planned guard could not pass.
- **Fix:** I removed the port. The host is still unresolvable, so the test checks the same ENOTFOUND/EAI_AGAIN outcome. That file is not in the plan's files_modified list.
- **Commit:** a882418

**2. [Rule 1 - Test] Zero-width characters do not survive ingest**
- **Found during:** Task 2. I expected the U+200B characters around the hidden HTML text to reach the fence. html-to-text treats them as whitespace and drops them at ingest (bug-232).
- **Fix:** I dropped that one expectation. The hidden text itself is still asserted inside the fence.
- **Commit:** 0ebdc72

**3. [Rule 1 - Interpretation] Pair call counts**
- **Issue:** The plan asks for the same number of calls per pair and also expects an off-list injected label to end as out_of_category. A compromised fake that answers an off-list category forces the normal retry, so the call counts cannot be equal in that case. E4 states the call-count rule "for valid output".
- **Fix:** I compare call counts and request equality under an honest fake. Under the compromised fake, I assert the bound: an allowed X is labelled in 1 call, and an off-list X is review out_of_category after 2 calls.
- **Commit:** 0ebdc72

**Total deviations:** 3 (1 Rule 3, 2 Rule 1). **Impact:** test-only changes. No implementation code changed, there is no new dependency, and the dependency and read-only guards are unchanged.

## Issues Encountered
- Commits are on `main`. The orchestrator ran this plan sequentially with branching_strategy none and said committing on main is intended.
- My mutation runner restored files with `git checkout`, which also reverted my uncommitted edit to classify-ollama-client.test.ts. I re-applied the edit before the commit, and the tests passed again (bug-233).
- The Docker-backed cases take about 45 s for classify-injection.test.ts, mostly doveadm appends. Its timeouts are 120 s (the hostile batch's beforeAll) and 60 s for the other Docker-backed cases, with bug-214 in mind.

## Known Stubs
None.

## Threat Flags
None. These are test files only and add no new surface.

## User Setup Required
None.

## Next Phase Readiness
- 03-13's live baseline can run the same committed pairs and action-mail fixtures (bank notice, payment failure, interview, personal reply) through the live model, and record the flip count.
- The in-list steering residual (T-03-37) shows up concretely here: the compromised fake moves the bank notice to Noise and the personal reply to Noise. Phase 4 must decide on this before applying labels.

## Self-Check: PASSED
- All 3 test files and all 23 fixtures are on disk (13 hostile, 10 pair).
- Commits d40d2b7, 0ebdc72 and a882418 are ancestors of HEAD. evaluation-scope resolves the plan commits.
- read-only-ingest.test.ts and dependencies.test.ts are unchanged since the plan base, and they pass.
- Plan verification: `pnpm vitest run apps/worker/test/classify-injection.test.ts apps/worker/test/classify-leak.test.ts apps/worker/test/classify-hermetic.test.ts apps/worker/test/read-only-ingest.test.ts apps/worker/test/dependencies.test.ts` passes (43/43), and `pnpm typecheck` exits 0.
