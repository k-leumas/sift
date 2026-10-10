---
phase: 03-tiered-classification-with-traces
plan: 08
subsystem: classify
tags: [classification, ollama, exact-rules, keyset, ingest-lock, trace, replay, postal-mime]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-02 tiers.llm.confidence_threshold; 03-04 matchExactRules, decide, ruleSetVersionOf; 03-06 candidates, ensureRuleSet, ensurePromptVersion, recordDecision; 03-07 runLlmTier, createPreflight, single flight, fake Ollama"
provides:
  - "classifyMailbox: the per-mailbox pass (rules every pass, newest-first keyset chunks of 5 under the ingest lock, 25 chat calls and 500 examined per pass, outage stops LLM work only)"
  - "classifyCandidates + newPassState: the shared candidate classifier (decidedBy worker | rerun, cap or no cap) for 03-12"
  - "createClassifyRuntime, loadMailboxRules, rulesProblemMessage, infraOwnerMessage, ClassifyOutcome for 03-09 (mailbox_status) and 03-12"
  - "untrustedEmailOf / matchableOf from stored rows (From display name via postal-mime addressParser)"
  - "classify-harness.ts with expectReplayableDecision (E8) and the E1 invariant query"
affects: [03-09, 03-10, 03-12, 03-13, phase-04-apply]

actuals:
  tokens: 21200
  tasks: 3
  commits: 3
plan_head_before: 339f49f5cbae37ca211b2de5e280248b553a6a54
plan_head_after: 6209554cb7b2ea5850f2705e6899a0ef9d0a0df7

tech-stack:
  added: []
  patterns:
    - "One message at a time in a plain for...of loop; each decision is one short session.run, never held open across an LLM call"
    - "Pass state is a plain object shared by the chunks; state.ruleSetId is set only after the transaction commits"
    - "Mutation checks (one behaviour broken at a time) prove tests that pass at RED are not vacuous"

key-files:
  created:
    - apps/worker/src/classify/run.ts
    - apps/worker/src/classify/untrusted-email.ts
    - apps/worker/test/support/classify-harness.ts
    - apps/worker/test/classify-run.test.ts
    - apps/worker/test/classify-trace.test.ts
  modified:
    - apps/worker/test/support/mailbox-harness.ts
    - apps/worker/test/support/fake-ollama.ts

key-decisions:
  - "A deterministic per-message HTTP 500 stays infra (03-07 assumption kept): the pass stops LLM work, the message stays pending and comes back first next pass; exact-rule mail keeps being decided"
  - "infraOwnerMessage reads the timeout length from the client's own 'no answer in N ms' detail (preflight 10 s, chat 120 s); any other detail is shown only when it is a bare code"
  - "rules_invalid lists problems as 'line <l> <path>: <message>', pluralises 'problem', and passes a file-level not-found/unreadable message through unchanged"
  - "state.ruleSetId is cached only after its transaction commits, so a rolled-back rule_set row is never referenced"
  - "fake-ollama records its answer per request, so the replay check compares raw output with what was really sent"

requirements-completed: [CLS-01, CLS-02, CLS-04, CLS-06, TRC-01, TRC-03, TRC-04]

coverage:
  - id: D1
    description: "Exact-rule match decides labelled with no Ollama request; other mail goes to the LLM after one preflight; a second pass writes nothing (CLS-01, CLS-02, D-15)"
    requirement: CLS-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#decides one by an exact rule with no request and one by the LLM, both replayable"
        status: pass
    human_judgment: false
  - id: D2
    description: "26 LLM-bound messages: exactly 25 calls newest first, exact rules continue past the cap, the oldest stays pending until the next pass; same-date messages decided once across chunks; empty pass makes no request and no rule_set (D-14, D-18, E6)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#makes exactly 25 calls newest first, keeps deciding exact rules, leaves the oldest pending"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#decides every message sharing one INTERNALDATE exactly once across chunks"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#with nothing pending makes no request, not even the preflight, and writes no rule_set"
        status: pass
    human_judgment: false
  - id: D3
    description: "Outages (unreachable, model_missing, remote_model, a mid-pass 500) write no decision for LLM-bound mail, make no further call, still write exact-rule decisions and recover next pass (D-16, E5)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#outages are never decisions (D-16, E5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "input_too_long and invalid output are local reviews; a throwing message is skipped and logged by id and code only; five in a row stop the pass; shutdown aborts with no decision"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#one bad message never stops the others (CLS-06, E6)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#shutdown aborts the in-flight call, writes no decision and is not infra"
        status: pass
    human_judgment: false
  - id: D5
    description: "Missing or invalid rules.yaml is rules_invalid naming the file and each problem's line and YAML path (first 5, then 'and N more'); a rules edit never re-classifies and the next decision uses rule_set v2; a held lock returns busy (D-05, D-15, D-17)"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#shutdown, rules files, re-runs and the lock"
        status: pass
    human_judgment: false
  - id: D6
    description: "Pass logs carry slug, ids, counts and codes only: no subject, body, model reason, Ollama error text or fence marker (SEC-01, T-03-26)"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-run.test.ts#no pass logged a subject, body, model reason or Ollama error text"
        status: pass
    human_judgment: false
  - id: D7
    description: "Eight decision paths each pass expectReplayableDecision (spans, FKs, prompt hash, raw = fake answer, byte-exact re-render) with columns matching spans, full llm span context (categories, judgment, digest, version, threshold) and body expiry = decision + 7 days (E8, E10, E14, TRC-01/03/04)"
    requirement: TRC-04
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-trace.test.ts#every decision path is replayable and closed"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-trace.test.ts#0.85 is review low_confidence and 0.9 is labelled, both replayable"
        status: pass
    human_judgment: false
  - id: D8
    description: "E1 invariant: 0 labelled decisions outside their own rule_set snapshot across the test database, with a positive control showing the query counts a violation"
    requirement: CLS-04
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-trace.test.ts#E1 invariant over the whole database"
        status: pass
    human_judgment: false
  - id: D9
    description: "The shared worker test harness points models.url at http://ollama.invalid; the full worker suite still passes (749/749)"
    verification:
      - kind: other
        ref: "pnpm vitest run apps/worker --maxWorkers=4"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 08: Classification Pass Summary

**One pass over a mailbox's pending mail: read rules.yaml, scan newest first in locked keyset chunks of five, decide each message by the owner's exact rule or the local LLM within a 25-call cap, treat any Ollama outage as "stays pending", and write every decision through recordDecision with a trace that replays byte for byte.**

## Performance
- **Duration:** about 18 min (2026-10-10T21:19:46Z to 21:38:16Z)
- **Tasks:** 3 (tracer, then two tdd tasks)
- **Files:** 5 created, 2 modified

## Accomplishments
- `run.ts` has `classifyMailbox`, which returns done, rules_invalid, infra, busy or aborted. It also has `classifyCandidates`, the shared per-message loop that 03-12 will call with `decidedBy: 'rerun'` and `newPassState(null)`. The helpers are `createClassifyRuntime` (always gated), `loadMailboxRules`, `rulesProblemMessage` and `infraOwnerMessage`.
- `untrusted-email.ts` builds the prompt fields and the exact-rule fields from stored rows only. The display name comes from the decoded From header through postal-mime's `addressParser`.
- `classify-harness.ts` holds `expectReplayableDecision`, which checks the trace against the fake's real request and answer, and the E1 invariant query.
- 29 tests across the two new files. The full worker suite passes (749/749), and `pnpm typecheck` and `pnpm lint` exit 0. Lint shows one warning that was already there.

## Task Commits
1. **Task 1 (tracer): the pass, untrusted email, harness, `ollama.invalid`** - `f51ee44` (feat)
2. **Task 2: pass behaviour under load and failure** - `25b8558` (test)
3. **Task 3: E8 path matrix, E1 invariant, body expiry** - `6209554` (test)

Tracer gate: interactive run with end-of-phase verification and an automated-only verify. I re-ran the verify, it passed, and I continued with no checkpoint.

## TDD Gate Compliance
- **Unexpected GREEN (fail-fast rule 1, investigated):** all 18 Task 2 cases and all Task 3 cases passed the first time they ran. The Task 1 action had already built the whole of `run.ts`, including the cap, keyset, outage, isolation and shutdown paths. Neither task had a missing feature to drive, so neither has a `feat` commit. `workflow.tdd_mode` is false, and the plan type is `execute`.
- **To prove the tests bite**, I broke one behaviour at a time in the working tree, ran the tests, and restored the file. None of these changes was committed.
  - cap check `<= 0` changed to `< 0`: the cap test fails (26 calls).
  - `llmBlocked` skip removed: the mid-pass 500 test fails.
  - always rethrow: the isolation and 5-in-a-row tests fail.
  - keyset cursor dropped: the outage test fails (I strengthened it to have more than one chunk of skipped mail) and so does the isolation test.
  - subject added to the failure log: the log-scan test fails.
  - preflight on every message: the cap test fails (one /api/tags expected).
  - digest set to null, or one judgment line dropped from the span: 7 trace tests fail.
  - display name dropped: the fenced-fields test fails.
  - prompt rendered from other fields: the trace suite fails.
- **Machine-checked failing run:** I ran the cap test under the cap mutation with the junit reporter. `gsd check tdd-red-evidence` returned **RED_EVIDENCE_OK target_test_failed** (expected llmCalls 25 and labelled 27, got 26 and 28). Semantic assessment: the target ran and failed on the planned assertion. That run was against a deliberately broken implementation, not a missing one.

## Files Created/Modified
- `apps/worker/src/classify/run.ts`: the pass, the candidate classifier, the runtime, rules loading and messages, and the constants (CLASSIFY_CHUNK_SIZE 5, LLM_CALLS_PER_TICK 25, MAX_EXAMINED_PER_TICK 500, MAX_CONSECUTIVE_MESSAGE_FAILURES 5, RULES_PROBLEMS_IN_STATUS 5).
- `apps/worker/src/classify/untrusted-email.ts`: untrustedEmailOf, matchableOf.
- `apps/worker/test/support/classify-harness.ts`: seeding, rules files, runtime, superuser reads, expectReplayableDecision, LABELLED_OUTSIDE_SNAPSHOT_SQL, labelledOutsideSnapshot.
- `apps/worker/test/classify-run.test.ts` (663 lines), `apps/worker/test/classify-trace.test.ts`.
- `apps/worker/test/support/mailbox-harness.ts`: models.url is now `http://ollama.invalid`.
- `apps/worker/test/support/fake-ollama.ts`: each RecordedRequest now carries `response`.

## How the pass handles a deterministic per-message HTTP 500 (03-07 carry-forward)
A 500 is infra, never a decision. When one message always gets a 500, the pass blocks LLM work for the rest of that pass and returns `infra server_error` ("Ollama at <origin> failed (HTTP 500); see the Ollama log", never Ollama's text). The message stays pending. Exact-rule mail in the same pass is still decided. On the next pass that same message is again the newest pending LLM-bound one, so it gets the first call, the pass blocks again, and nothing older reaches the LLM until it stops failing. This is the recorded assumption in its strict form: no outage becomes a decision. The owner sees the error in status through 03-09. The cost is head-of-line blocking on a truly poisoned message. That is flagged for the owner here and not changed.

## Decisions Made
See key-decisions. Infra `detail` is never logged or stored. Only a bare code reaches the owner message, and only the code and status reach the warn line (T-03-25, T-03-26).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] A rolled-back rule_set row could have been reused**
- **Found during:** Task 1
- **Issue:** As written in the plan, state.ruleSetId was set inside the decision transaction. If recordDecision then threw, the rule_set insert rolled back, but the cached id stayed. Every later message would then fail on the foreign key.
- **Fix:** The id is returned from session.run and cached only after the commit.
- **Commit:** f51ee44

**2. [Rule 1 - Bug] The timeout owner message always said 120 s**
- **Found during:** Task 1
- **Issue:** A preflight timeout (10 s) would have been reported as "timeout after 120 s".
- **Fix:** The seconds come from the client's own code-generated `no answer in N ms` detail, with 120 s as the fallback.
- **Commit:** f51ee44

**3. [Rule 3 - Blocking] The fake did not record what it answered**
- **Found during:** Task 1 (expectReplayableDecision must compare raw output with the fake's response)
- **Fix:** I added `RecordedRequest.response` to fake-ollama.ts. That file is not in the plan's files_modified list.
- **Commit:** f51ee44

**4. [Rule 1 - Test] The outage test did not exercise the keyset cursor**
- **Found during:** Task 2 mutation checks
- **Fix:** It now seeds more than one chunk of LLM-bound mail ahead of the exact-rule message.
- **Commit:** 25b8558

**5. [Rule 1 - Test] Wrong response_model expectation for input_too_long (bug-225)**
- **Fix:** A context-length 400 has no response model, so null is correct.
- **Commit:** 6209554

**Total deviations:** 5 auto-fixed (1 Rule 2, 3 Rule 1, 1 Rule 3). **Impact:** These are correctness and test-strength changes only. No scope creep, and no new dependency (postal-mime was already approved).

## Issues Encountered
- Commits are on `main`. `git.base-branch --is-protected main` reports true, but the orchestrator ran this plan sequentially with branching_strategy none and said committing on main is intended.

## Known Stubs
None.

## Next Phase Readiness
- 03-09 can call `classifyMailbox` after a synced/resynced ingest, with one `createClassifyRuntime({ dataDir, modelsUrl, gate })` per worker. It then maps rules_invalid and infra `message` to mailbox_status. busy and aborted write no status.
- 03-12 can call `classifyCandidates(session, candidates, { ..., decidedBy: 'rerun', state: newPassState(null) })` under its own lock.
- The poisoned-message head-of-line case above is the one behaviour the owner may want to revisit.

## Self-Check: PASSED
- All 5 created files are on disk. Commits f51ee44, 25b8558 and 6209554 are ancestors of HEAD. evaluation-scope resolves 3 plan commits.
- Plan verification: `pnpm vitest run apps/worker/test/classify-run.test.ts apps/worker/test/classify-trace.test.ts` gives 29/29, and `pnpm typecheck` exits 0.
