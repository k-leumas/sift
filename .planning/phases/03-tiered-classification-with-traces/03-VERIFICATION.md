---
phase: 03-tiered-classification-with-traces
verified: 2026-10-12T22:39:15Z
status: human_needed
score: 224/224 must-haves verified (6 roadmap success criteria + 217 plan truths + 1 derived regression truth; roadmap SCs 6/6)
covered_files: [".gitignore",".planning/phases/03-tiered-classification-with-traces/03-01-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-01-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-02-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-02-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-03-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-03-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-04-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-04-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-05-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-05-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-06-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-06-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-07-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-07-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-08-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-08-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-09-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-09-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-10-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-10-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-11-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-11-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-12-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-12-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-13-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-13-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-14-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-14-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-15-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-15-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-16-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-16-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-17-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-17-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-18-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-18-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-19-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-19-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-20-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-20-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-21-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-21-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-22-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-22-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-23-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-23-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-24-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-24-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-25-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-25-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-26-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-26-SUMMARY.md","CONTRIBUTING.md","README.md","apps/worker/package.json","apps/worker/src/classify/llm-tier.ts","apps/worker/src/classify/ollama-client.ts","apps/worker/src/classify/preflight.ts","apps/worker/src/classify/refetch.ts","apps/worker/src/classify/run.ts","apps/worker/src/classify/single-flight.ts","apps/worker/src/classify/untrusted-email.ts","apps/worker/src/command.ts","apps/worker/src/commands/classify.ts","apps/worker/src/commands/config-check.ts","apps/worker/src/commands/mailbox-list.ts","apps/worker/src/commands/mailbox-rename.ts","apps/worker/src/commands/worker.ts","apps/worker/src/runtime/mailbox-batch.ts","apps/worker/test/classify-batch.test.ts","apps/worker/test/classify-cli.test.ts","apps/worker/test/classify-control-chars.test.ts","apps/worker/test/classify-hermetic.test.ts","apps/worker/test/classify-injection.test.ts","apps/worker/test/classify-leak.test.ts","apps/worker/test/classify-llm-tier.test.ts","apps/worker/test/classify-ollama-client.test.ts","apps/worker/test/classify-preflight.test.ts","apps/worker/test/classify-refetch.test.ts","apps/worker/test/classify-run.test.ts","apps/worker/test/classify-trace.test.ts","apps/worker/test/cli.test.ts","apps/worker/test/compose-smoke.test.ts","apps/worker/test/compose.test.ts","apps/worker/test/config-check-rules.test.ts","apps/worker/test/llm-baseline.test.ts","apps/worker/test/mailbox-rename-guard.test.ts","apps/worker/test/registry-cli.test.ts","apps/worker/test/release-workflow.test.ts","apps/worker/test/support/classify-harness.ts","apps/worker/test/support/fake-ollama.ts","apps/worker/test/support/llm-baseline.ts","apps/worker/test/support/mailbox-harness.ts","apps/worker/test/user-facing-text.test.ts","apps/worker/test/worker-classify.test.ts","compose.yaml","config/config.example.yaml","data/mailboxes/example/rules.example.yaml","packages/core/package.json","packages/core/src/classify/canonical.ts","packages/core/src/classify/decide.ts","packages/core/src/classify/exact-rules.ts","packages/core/src/classify/index.ts","packages/core/src/classify/llm-output.ts","packages/core/src/classify/prompt-version.ts","packages/core/src/classify/prompt.ts","packages/core/src/classify/spans.ts","packages/core/src/config/index.ts","packages/core/src/config/load.ts","packages/core/src/config/schema.ts","packages/core/src/rules/hash.ts","packages/core/src/rules/index.ts","packages/core/src/rules/load.ts","packages/core/src/rules/path.ts","packages/core/src/rules/schema.ts","packages/core/src/yaml-issues.ts","packages/core/test/config.test.ts","packages/core/test/decide.test.ts","packages/core/test/env.test.ts","packages/core/test/exact-rules.test.ts","packages/core/test/example-config.test.ts","packages/core/test/example-rules.test.ts","packages/core/test/llm-output.test.ts","packages/core/test/prompt-version.test.ts","packages/core/test/prompt.test.ts","packages/core/test/rules-hash.test.ts","packages/core/test/rules.test.ts","packages/core/test/spans.test.ts","packages/db/migrations/0008_classification_preflight.sql","packages/db/migrations/0009_classification_tables.sql","packages/db/migrations/0010_classification_grants.sql","packages/db/migrations/0011_decision_llm_error_reason.sql","packages/db/migrations/meta/0008_snapshot.json","packages/db/migrations/meta/0009_snapshot.json","packages/db/migrations/meta/0010_snapshot.json","packages/db/migrations/meta/0011_snapshot.json","packages/db/migrations/meta/_journal.json","packages/db/package.json","packages/db/src/classify.ts","packages/db/src/index.ts","packages/db/src/ingest.ts","packages/db/src/prompt-version.ts","packages/db/src/schema/index.ts","packages/db/src/schema/prompt-version.ts","packages/db/src/schema/scoped.ts","packages/db/src/scope.ts","packages/db/src/status.ts","packages/db/test/catalog.test.ts","packages/db/test/classify-schema.test.ts","packages/db/test/classify.test.ts","packages/db/test/ingest.test.ts","packages/db/test/isolation.test.ts","packages/db/test/migrate.test.ts","packages/db/test/registry-plan.test.ts","packages/db/test/registry.test.ts","packages/db/test/scope.test.ts","packages/db/test/status.test.ts","packages/db/test/support/catalog.ts","packages/db/test/support/seed.ts","scripts/compose-smoke.sh"]
covered_digest: "v3:sha256:ecbb7d8f089e4d5b2c67b9ab6561851a4cdf256383faa19bef61067228b19c13"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 211/212
  gaps_closed:
    - "ROADMAP SC5 / CLS-06 (WR-04): a model reason with an unpaired surrogate is now schema_mismatch 'reason: lone_surrogate', retried once, then stored as review invalid_output; five in a row plus an older valid message are all decided in the first pass (03-25). Reproduced again against the real pass, DB and fake Ollama: the previous 3 throwing passes / 0 decisions no longer occur"
    - "WR-05 (owner side of the same gap): a rules file with an unpaired-surrogate escape fails sift config check and the worker returns rules_invalid naming the file and line before any rule_set insert (03-26)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Re-run UAT test 2 (03-23 D4, G-03-2): from the sift repository root, node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b"
    expected: "A ready line on stderr right after the model check, then one 'fixture N/10 <file>: <s> s' line per email as each finishes; at the end the Markdown table (10 rows, thinking null yes, one digest, 'flips: <n>') on stdout"
    why_human: "Needs the owner's local Ollama and model; CI only drives the fake. 03-UAT.md still records test 2 as 'issue' with no re-run"
  - test: "Re-run UAT test 8 (03-24 D4, G-03-8): open the README and find the quick start from the intro"
    expected: "The 'Get started' line under the status note links to Quick start; the quick start reads as one list numbered 1-12, each step led by a short bold imperative. Read the local README if GitHub main has not been pushed"
    why_human: "Findability and scanability are owner judgments; the tests only check the list shape and the link. 03-UAT.md still records test 8 as 'issue'"
  - test: "Owner decision on WR-06 (CR-01 residual): accept or change the per-pass budget of 2 messages Ollama fails on alone"
    expected: "Either confirm the accepted 03-17 rule ('at most 2 such messages per tick; one more is an outage') knowing the consequence, or ask for the reviewer's canary-instead-of-outage fix"
    why_human: "Owner-accepted design choice at the 03-19 checkpoint; run.ts is unchanged since, and 03-REVIEW.md (b27ae36) keeps WR-06 open. Cost: with k messages that each fail alone in one pass, the mailbox spends about 3k/2 passes in a misleading Ollama error status and backoff"
  - test: "Owner decision on WR-07: should llm_error need evidence beyond 3 failed passes a poll interval apart (for example a minimum time span)?"
    expected: "Accept as is, or ask for a minimum span / an intervening successful real chat before llm_error"
    why_human: "The outcome is a review decision, which the phase goal allows, so it is a policy choice, not a goal failure. Still open in 03-REVIEW.md"
---

# Phase 3: Tiered Classification with Traces Verification Report

**Phase Goal:** Every ingested message gets a category from exact rules or the local LLM, or is marked for review, and the reason is recorded as a replayable trace.
**Verified:** 2026-10-12T22:39:15Z
**Status:** human_needed
**Re-verification:** Yes, after gap closure plans 03-25 (WR-04) and 03-26 (WR-05)

## Goal Achievement

The one remaining gap (ROADMAP SC5 / CLS-06, the lone-surrogate path) is closed. I checked the code and ran my own end-to-end reproduction, separate from the plan's tests. The phase goal is met in code. What remains is four owner items carried forward: two UAT re-runs and two policy decisions. None of them is a goal failure.

### Re-verification of the gap (end to end)

I wrote a separate scratch test in the session scratchpad, outside the repository. It uses the real `classifyMailbox`, a fresh test database on sift-db-1 and the fake Ollama. It repeats the previous report's scenario exactly: the 5 newest LLM-bound messages answer `{"reason":"Fine\ud800",...}` (a trailing lone surrogate, the previous report's exact form, not the mid-sentence form the plan's test uses), plus one older message with a valid answer, over 3 worker passes.

| Scenario | Before (previous report) | Now |
|----------|--------------------------|-----|
| 5 trailing-surrogate answers plus 1 older valid message, 3 passes | pass 1/2/3: THREW `Failed query: insert into "decision"`; decisions 0; pending 6; chat calls 15 | pass 1: `done`, labelled 1, review 5, llmCalls 11, failures 0, unclassified []; passes 2-3: `done`, examined 0; decisions 6 (5 review `invalid_output`, 1 labelled Receipts); pending 0; chat calls 11; every decision passes `expectReplayableDecision` |
| Reversed pair (`\udc00\ud800`) mid-sentence; lone low surrogate (`\udfff`) as the whole reason | not tested | both stored as review `invalid_output`, failures 0 |
| Valid answer, but HTTP-level lone surrogates in `thinking`, `done_reason` and `model` | not tested | labelled, stored; the attempt shows U+FFFD in `thinking` and `done_reason` (the `wellFormed` backstop works on real server-side strings, not only on unit input) |
| rules.yaml `description: "Bills \ud800 here"` | `loadRules ok: true`; every decision insert then failed | `rules_invalid`: "rules file .../rules.yaml has 1 problem: line 6 categories[1].description: description must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape. ..."; 0 decisions, 0 chat calls |

Result: 4/4 pass. The behaviour the previous report saw (3 throwing passes, 0 decisions, the older valid message blocked) no longer happens.

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A message covered by a hardcoded exact rule is classified without any LLM call; its trace shows the rules checked and the match | VERIFIED | `run.ts` is unchanged since 1aae7bc (git diff --quiet). classify-run.test.ts passes alone. The rule-set hash is unchanged for valid files (rules-hash and example-rules tests pass) |
| 2 | Unmatched mail is classified by the local LLM into a mailbox category with confidence and a one-sentence reason; out-of-category or malformed output is retried once, then review | VERIFIED | `llm-tier.ts` is unchanged. The new `reason: lone_surrogate` rejection goes through the same retry, then review `invalid_output` (classify-control-chars D800/DC00 cases, and the scratch reversed-pair case) |
| 3 | An LLM result below the threshold is marked for review | VERIFIED | `decide.ts` is unchanged; decide.test.ts passes |
| 4 | Every classification has a decision row with one span per tier and the rule-set, prompt and model versions; the LLM span holds rules, raw output, validation and confidence | VERIFIED | `recordDecision` now runs `wellFormed(stripNul(parseDecisionSpans(...)))` (`classify.ts:145`), and the span shape is unchanged. The new decisions replay (`expectReplayableDecision` in the 03-25 test and in the scratch test). No migration was added |
| 5 | Injected instructions do not change the allowed categories or what the pipeline does, and one failed message does not stop the others | VERIFIED (gap closed) | `llm-output.ts:110` makes `!reason.isWellFormed()` a `schema_mismatch` with the fixed detail `reason: lone_surrogate`. The backstop in `ingest.ts:148-157` covers Ollama-supplied strings. The 03-25 five-in-a-row test and my separate reproduction (table above) both show one pass, failures 0, nothing pending. The CR-01 path (classify-batch, classify-run) passes alone |
| 6 | Every trace has a classifier span marked skipped ("not trained") between the exact-rules and LLM spans | VERIFIED | `spans.ts` is unchanged; spans.test.ts passes |

**Roadmap score:** 6/6 success criteria verified.

### Plan Must-Have Truths

| Plan | Truths | Result | Notes |
|------|--------|--------|-------|
| 03-01 .. 03-24 | 205 | 205 VERIFIED | Carried forward. Regression: the files those plans touched (only the 9 below changed since 1aae7bc) and every key test file pass (see Spot-Checks). Same 2 exclusions as before (03-18 superseded truth, 03-19 option-keep) |
| 03-25 T1 lone-surrogate reason: retry, then review invalid_output | 1 | VERIFIED | `llm-output.ts:110-112`; classify-control-chars "lone high/low surrogate twice" pass |
| 03-25 T2 five in a row plus older valid: first pass done, failures 0, 6 decisions, nothing pending, no 'message failed' log, replayable | 1 | VERIFIED | classify-control-chars.test.ts:258-314 passes; my separate 3-pass reproduction agrees (llmCalls 11 = 5x2 + 1) |
| 03-25 T3 a valid pair (emoji) still validates; unpaired high or low surrogates and a reversed pair are rejected | 1 | VERIFIED | llm-output.test.ts "lone surrogates in the reason (WR-04)" passes; scratch reversed pair is review |
| 03-25 T4 recordDecision maps unpaired surrogates in every span string to U+FFFD after the NUL strip and before assertConsistent; a valid pair is kept | 1 | VERIFIED | `classify.ts:145` order: wellFormed(stripNul(parse)), then `assertConsistent`; db classify.test.ts WR-04 backstop passes; scratch HTTP-level case is stored with U+FFFD |
| 03-25 T5 format schema and prompt material unchanged; EXPECTED_PROMPT_HASH matches; prompt-version.test.ts not modified | 1 | VERIFIED | `git diff --quiet 1aae7bc HEAD -- prompt.ts prompt-version.ts prompt-version.test.ts` exit 0; prompt-version.test.ts passes |
| 03-25 T6 the reason is rejected, never repaired | 1 | VERIFIED | The validator returns ok false before `decide`. The backstop sees only validated reasons, and in the scratch reversed-pair case the reason never reached `result` (review) |
| 03-26 T1 description / judgment / rule name: exactly one issue at path and line with the exact message | 1 | VERIFIED | `schema.ts:120-122`; rules.test.ts WR-05 describe passes; the scratch rules_invalid message matches word for word |
| 03-26 T2 from / domain / phrase entries rejected at `rules[i].match.<key>[j]` | 1 | VERIFIED | `schema.ts:217, 228, 239`; rules.test.ts passes |
| 03-26 T3 sift config check exits 1, empty stdout, one stderr line with file:line:col, path and message | 1 | VERIFIED | config-check-rules.test.ts "exits 1 for an unpaired surrogate in a description ... (WR-05)" passes |
| 03-26 T4 precedence: line break, then control character, then surrogate (one issue) | 1 | VERIFIED | `oneLine` else-if chain; rules.test.ts precedence cases pass. (IN-15: an over-long value can still get a second, length issue. That is outside this truth, which is about character classes) |
| 03-26 T5 a surrogate-pair escape or the emoji itself still loads; existing files keep the same content and D-03 hash | 1 | VERIFIED | rules-hash, example-rules and rules.test.ts pass unchanged |
| 03-26 T6 the worker fails closed with rules_invalid naming the file before any rule_set insert | 1 | VERIFIED | `run.ts:232` uses the same `loadRules`; scratch: `rules_invalid` naming the file and line 6, 0 decisions, 0 chat calls |
| Derived: Phase 2 D-26 valve not regressed | 1 | VERIFIED | classify-batch.test.ts CR-03 case passes alone |

**Score:** 224/224 (6 SCs + 217 plan truths + 1 derived). Behavior-unverified: 0. Superseded or not applicable and excluded: 2 (unchanged).

### Prohibitions

| Plan | Prohibition | Enforcement evidence | Status |
|------|-------------|----------------------|--------|
| 03-25 | No change to llmOutputSchema, ollamaFormat, prompt.ts, prompt-version.ts, prompt-version.test.ts | `git diff --quiet 1aae7bc HEAD` on the three files exit 0; the llm-output.ts diff touches neither the schema nor `REASON_CONTROL_CHARACTERS`; prompt-version.test.ts (hash pin) passes | VERIFIED |
| 03-25 | run.ts not modified | `git diff --quiet 1aae7bc HEAD -- apps/worker/src/classify/run.ts` exit 0 | VERIFIED |
| 03-25 | No new review reason, validation code or migration | `git diff --stat 1aae7bc HEAD -- packages/db/migrations` is empty; the new failure is `code: 'schema_mismatch'` | VERIFIED |
| 03-25, 03-26 | No raw lone surrogate, raw U+2028/2029 or backslash-u escape written into source or test files | No added line under apps/ or packages/ contains `\u` (git diff grep: 0). Non-ASCII counts: 0 in the changed source files; rules.test.ts 2 and llm-output.test.ts 6, none on changed lines | VERIFIED |
| 03-26 | Reject, never repair rules text | The schema adds only `refine` / `addIssue`, with no `overwrite` or transform for surrogates | VERIFIED |
| 03-26 | Existing control-character and line-break messages and the constants unchanged | No `-`/`+` diff lines touch `CONTROL_CHARACTERS =`, `LINE_BREAK =`, `CATEGORY_NAME_PATTERN =` or the two WR-02 messages | VERIFIED |
| 03-26 | Never echo the offending value | `UNPAIRED_SURROGATE` is fixed text; the scratch rules_invalid message quotes no value | VERIFIED |
| 03-15 .. 03-20 | Earlier test-tier prohibitions | The named tests pass alone (classify-batch, classify-run) | VERIFIED |

### Deferred Items

None.

### Advisory (New Scope, Unevidenced)

None. No Step 7 finding is rated a blocker. The residuals below are Info.

### Required Artifacts

`gsd-tools query verify.artifacts`: 03-25 4/4 pass, 03-26 3/3 pass (exit 0). Plans 03-01..03-24: 83/83 at the previous verification, and their files are unchanged except the 9 listed here.

| Artifact | Contains | Status |
|----------|----------|--------|
| packages/core/src/classify/llm-output.ts | `reason: lone_surrogate` (line 111) | VERIFIED, wired (called by llm-tier.ts) |
| packages/db/src/ingest.ts | `export function wellFormed` (line 148), internal, not in index.ts | VERIFIED, wired (classify.ts:8, :145) |
| packages/db/src/classify.ts | `wellFormed(stripNul(parseDecisionSpans` | VERIFIED |
| packages/core/src/rules/schema.ts | `noUnpairedSurrogate` (line 99), used at 120, 217, 228, 239 | VERIFIED, wired (loadRules, then config check and run.ts) |
| apps/worker/test/classify-control-chars.test.ts | WR-04 describe, 3 cases | VERIFIED, passes |
| apps/worker/test/config-check-rules.test.ts | WR-05 case | VERIFIED, passes |
| packages/core/test/rules.test.ts | WR-05 describe | VERIFIED, passes |

### Key Link Verification

`gsd-tools query verify.key-links`: 03-25 2/2, 03-26 2/2 (exit 0).

| From | To | Via | Status |
|------|----|-----|--------|
| llm-tier.ts | llm-output.ts | validateLlmOutput failure, then one retry, then review invalid_output | WIRED (exercised by the scratch reproduction) |
| db/classify.ts | db/ingest.ts | `wellFormed`, `stripNul` import | WIRED |
| commands/config-check.ts | rules/schema.ts | loadRules, then parseRulesText, then formatIssue | WIRED (config-check-rules test) |
| classify/run.ts | rules/schema.ts | the same loadRules; rules_invalid before ensureRuleSet | WIRED (scratch: 0 decisions) |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| review invalid_output decision (lone surrogate) | attempts[].validation `{schema_mismatch, reason: lone_surrogate}`, raw | validateLlmOutput in runLlmTier, then decide, then recordDecision | yes; read back from the DB and replayed | FLOWING |
| repaired attempt strings | thinking / done_reason with U+FFFD | Ollama HTTP body, then ollama-client, then the spans backstop | yes (scratch: read back from the DB) | FLOWING |
| rules_invalid status message | file, line, YAML path, fixed message | loadRules issues | yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Gap-closure test files | `pnpm vitest run` classify-control-chars, llm-output, db classify, rules, config-check-rules, prompt-version | 6 files, 203/203 passed | PASS |
| Separate end-to-end reproduction of the previous gap (4 scenarios) | scratch `wr04.scratch.test.ts` with a scratch vitest config (root = repo, fresh test DB, real classifyMailbox, fake Ollama) | 4/4 passed; numbers in the table above | PASS |
| Regression: classify-run, -batch, -llm-tier, -hermetic, -leak, -cli, -injection, -trace, -refetch, decide, spans, rules-hash, example-rules, db ingest, classify-schema | `pnpm vitest run` on the 15 files together | 340 passed, 5 failed, all at exactly 30 000 or 60 000 ms (timeouts); host load average 62-78 at the time | see next row |
| Re-run of the 3 timed-out files, one at a time | `pnpm vitest run` classify-batch / classify-injection / classify-refetch | 10/10, 23/23, 8/8 passed | PASS (timeouts were host load, bug-151/bug-162 family) |
| Orchestrator's flaky IMAP file | `pnpm vitest run apps/worker/test/imap-folder-source.test.ts` | 20/20 passed | PASS |
| Typecheck | `pnpm typecheck` | exit 0 | PASS |
| Full suite (orchestrator) | `pnpm vitest run --maxWorkers=4` | 1740 passed, 2 timeouts that pass alone | PASS (flake noted) |

The scratch files are in the session scratchpad. Nothing was written to the repository. The scratch test used its own temporary database and dropped it afterwards.

### Probe Execution

No `scripts/*/tests/probe-*.sh` exists and no plan declares a probe. Step 7c: not applicable.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| CLS-01 | 03-01, 03-04, 03-08, 03-21, 03-24, 03-26, ... | SATISFIED | SC1; a bad rules file is reported, never stored (03-26) |
| CLS-02 | 03-05, 03-07, 03-08, 03-23, 03-24, ... | SATISFIED | SC2, fenced prompt, live baseline (owner, 2026-10-12) |
| CLS-03 | 03-05, 03-07, 03-16, 03-25, ... | SATISFIED | SC2; control-character and lone-surrogate reasons are retried, then review |
| CLS-04 | 03-02, 03-03, 03-04, ... | SATISFIED | SC3 |
| CLS-05 | 03-04, 03-07, 03-10 | SATISFIED | Only validated content counts; unchanged |
| CLS-06 | 03-14..03-22, 03-25, 03-26 and earlier | SATISFIED | Exactly once per version: unchanged. One failure does not stop the others: the CR-01 path and now the WR-04 path (reproduced: one pass, failures 0) |
| TRC-01 | 03-03, 03-05, 03-06, 03-19, 03-20, 03-25, ... | SATISFIED | New review decisions carry full spans and replay |
| TRC-02 | 03-04 | SATISFIED | rules_checked, matches, nearest miss |
| TRC-03 | 03-05, 03-08 | SATISFIED | LLM span fields, examples [] |
| TRC-04 | 03-03, 03-04, 03-06 | SATISFIED | Versioned rule_set and prompt_version rows; no new prompt_version from 03-25 |
| TRC-06 | 03-04, 03-05 | SATISFIED | SC6; M2 slot judged by the owner (UAT 5) |
| SEC-01 | 03-05, 03-08, 03-10, 03-16, 03-25, ... | SATISFIED | Fixed detail text, never quotes the model; leak tests pass |

All 12 IDs are claimed by at least one plan (`requirements:` across the 26 plans gives exactly these 12). REQUIREMENTS.md maps no other ID to Phase 3 (TRC-05 and SEC-02 are Phase 4). No orphans.

Bookkeeping drift (Info) in `.planning/REQUIREMENTS.md`: CLS-04, CLS-05, TRC-02, TRC-03, TRC-04 and TRC-06 are still unchecked and show "Gaps Found" in the traceability table, although they are satisfied. Update them when the phase is closed.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| packages/core/src/classify/prompt.ts / llm-tier.ts | 59-60 / 182-191 | IN-13: the retry note for `schema_mismatch` names the wrong problem for a control-character or lone-surrogate reason, so the one retry is likely wasted | Info | The outcome is still review (goal-consistent). Fixing it needs a prompt_version change |
| packages/db/src/classify.ts | 131-145 | IN-14: a repaired `raw` is not flagged in the trace | Info | Only reachable with a non-Ollama server; accepted trade-off T-03-81 |
| packages/core/src/rules/schema.ts | 103-108 | IN-15: the docstring says "one issue per value", but length plus surrogate gives two | Info | Docstring accuracy only |
| packages/core/src/rules/schema.ts | 39, 127-138 | IN-16: CategoryName and label are safe only because the name pattern is ASCII | Info | Safe today; a hazard if Phase 4 widens the pattern |
| apps/worker/src/classify/run.ts | 617-626 | A decision-insert throw for any other cause still has no terminal state (03-25 known residual) | Info | No reachable model, Ollama or rules string triggers it now. Every span string goes through the backstop, and the rules are validated |
| apps/worker/src/classify/run.ts | 497-551, 504-541 | WR-06, WR-07 (unchanged) | Warning | Owner decisions, listed under Human Verification |
| various | - | IN-01..IN-12 (unchanged) | Info | Carried forward |

No TBD/FIXME/XXX markers in the 9 files changed since the previous verification. Neither the debt-marker gate nor the evidence gate fires.

### Human Verification Required

### 1. UAT test 2 re-run: live baseline progress (03-23, G-03-2)

**Test:** From the sift repository root: `node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b`.
**Expected:** A ready line on stderr right after the model check, then one `fixture N/10 <file>: <s> s` line per email; the table on stdout at the end (10 rows, `flips: <n>`).
**Why human:** Needs the owner's local model. 03-UAT.md still shows test 2 as `issue`.

### 2. UAT test 8 re-run: README quick start (03-24, G-03-8)

**Test:** Open the README and follow the "Get started" link.
**Expected:** It lands on Quick start, which reads as one list numbered 1-12, each step led by a bold imperative.
**Why human:** Findability is an owner judgment. 03-UAT.md still shows test 8 as `issue`.

### 3. WR-06 decision: per-pass budget

**Test:** Decide whether "at most 2 such messages per pass; one more is an outage" stays as accepted at 03-19.
**Expected:** Accept it as is, or ask for the reviewer's canary check in place of the automatic outage.
**Why human:** An owner-accepted design trade-off. run.ts is unchanged, and the review keeps it open.

### 4. WR-07 decision: time span before llm_error

**Test:** Decide whether three failed passes a poll interval apart are enough evidence for a permanent worker review decision.
**Expected:** Accept it as is, or ask for a minimum span or an intervening successful real chat.
**Why human:** The outcome stays within the goal (review), so this is a policy choice.

### Gaps Summary

There are no gaps. The SC5 / CLS-06 gap from the previous report is closed. The model-side fix (03-25) rejects an ill-formed reason at the validator and backstops every Ollama-supplied span string. The owner-side fix (03-26) makes config check and the worker reject an ill-formed rules file with file, line and YAML path. My separate 3-pass reproduction now shows one pass, all six messages decided and nothing pending, where the previous report showed three throwing passes and zero decisions. No regressions: the only files changed are the 9 in these plans, run.ts and the prompt material are unchanged, and every key test file passes when run alone.

The status is `human_needed` only because four owner items carry forward unresolved: UAT tests 2 and 8 still need re-runs, and WR-06 and WR-07 still need decisions. Once those are resolved, the phase can be marked passed.

---

_Verified: 2026-10-12T22:39:15Z_
_Verifier: Claude (gsd-verifier)_
