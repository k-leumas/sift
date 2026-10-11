---
phase: 03-tiered-classification-with-traces
verified: 2026-10-11T00:10:00Z
status: gaps_found
score: 141/146 must-haves verified (6 roadmap success criteria + 139 plan truths + 1 derived regression truth; roadmap SCs 5/6)
covered_files: [".gitignore",".planning/phases/03-tiered-classification-with-traces/03-01-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-01-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-02-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-02-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-03-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-03-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-04-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-04-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-05-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-05-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-06-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-06-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-07-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-07-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-08-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-08-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-09-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-09-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-10-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-10-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-11-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-11-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-12-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-12-SUMMARY.md",".planning/phases/03-tiered-classification-with-traces/03-13-PLAN.md",".planning/phases/03-tiered-classification-with-traces/03-13-SUMMARY.md","CONTRIBUTING.md","README.md","apps/worker/src/classify/llm-tier.ts","apps/worker/src/classify/ollama-client.ts","apps/worker/src/classify/preflight.ts","apps/worker/src/classify/refetch.ts","apps/worker/src/classify/run.ts","apps/worker/src/classify/single-flight.ts","apps/worker/src/classify/untrusted-email.ts","apps/worker/src/command.ts","apps/worker/src/commands/classify.ts","apps/worker/src/commands/config-check.ts","apps/worker/src/commands/mailbox-rename.ts","apps/worker/src/commands/worker.ts","apps/worker/src/runtime/mailbox-batch.ts","apps/worker/test/classify-batch.test.ts","apps/worker/test/classify-cli.test.ts","apps/worker/test/classify-hermetic.test.ts","apps/worker/test/classify-injection.test.ts","apps/worker/test/classify-leak.test.ts","apps/worker/test/classify-llm-tier.test.ts","apps/worker/test/classify-ollama-client.test.ts","apps/worker/test/classify-preflight.test.ts","apps/worker/test/classify-refetch.test.ts","apps/worker/test/classify-run.test.ts","apps/worker/test/classify-trace.test.ts","apps/worker/test/cli.test.ts","apps/worker/test/compose-smoke.test.ts","apps/worker/test/compose.test.ts","apps/worker/test/config-check-rules.test.ts","apps/worker/test/llm-baseline.test.ts","apps/worker/test/mailbox-rename-guard.test.ts","apps/worker/test/support/classify-harness.ts","apps/worker/test/support/fake-ollama.ts","apps/worker/test/support/llm-baseline.ts","apps/worker/test/support/mailbox-harness.ts","apps/worker/test/user-facing-text.test.ts","apps/worker/test/worker-classify.test.ts","compose.yaml","config/config.example.yaml","data/mailboxes/example/rules.example.yaml","packages/core/package.json","packages/core/src/classify/canonical.ts","packages/core/src/classify/decide.ts","packages/core/src/classify/exact-rules.ts","packages/core/src/classify/index.ts","packages/core/src/classify/llm-output.ts","packages/core/src/classify/prompt-version.ts","packages/core/src/classify/prompt.ts","packages/core/src/classify/spans.ts","packages/core/src/config/index.ts","packages/core/src/config/load.ts","packages/core/src/config/schema.ts","packages/core/src/rules/hash.ts","packages/core/src/rules/index.ts","packages/core/src/rules/load.ts","packages/core/src/rules/path.ts","packages/core/src/rules/schema.ts","packages/core/src/yaml-issues.ts","packages/core/test/config.test.ts","packages/core/test/decide.test.ts","packages/core/test/env.test.ts","packages/core/test/exact-rules.test.ts","packages/core/test/example-config.test.ts","packages/core/test/example-rules.test.ts","packages/core/test/llm-output.test.ts","packages/core/test/prompt-version.test.ts","packages/core/test/prompt.test.ts","packages/core/test/rules-hash.test.ts","packages/core/test/rules.test.ts","packages/core/test/spans.test.ts","packages/db/migrations/0008_classification_preflight.sql","packages/db/migrations/0009_classification_tables.sql","packages/db/migrations/0010_classification_grants.sql","packages/db/migrations/meta/0008_snapshot.json","packages/db/migrations/meta/0009_snapshot.json","packages/db/migrations/meta/0010_snapshot.json","packages/db/migrations/meta/_journal.json","packages/db/src/classify.ts","packages/db/src/index.ts","packages/db/src/ingest.ts","packages/db/src/prompt-version.ts","packages/db/src/schema/index.ts","packages/db/src/schema/prompt-version.ts","packages/db/src/schema/scoped.ts","packages/db/src/scope.ts","packages/db/src/status.ts","packages/db/test/catalog.test.ts","packages/db/test/classify-schema.test.ts","packages/db/test/classify.test.ts","packages/db/test/ingest.test.ts","packages/db/test/isolation.test.ts","packages/db/test/migrate.test.ts","packages/db/test/registry-plan.test.ts","packages/db/test/registry.test.ts","packages/db/test/scope.test.ts","packages/db/test/status.test.ts","packages/db/test/support/catalog.ts","packages/db/test/support/seed.ts","scripts/compose-smoke.sh"]
covered_digest: "v3:sha256:a029dabed45e0f9c5933ceaa251df18d24c1ecd0022092af854a148d8eb4d112"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "ROADMAP SC5 / CLS-06: one failed message (for example Ollama unavailable) does not stop the others"
    status: partial
    reason: "Any infra result from a chat call (server_error, timeout) sets state.llmBlocked for the whole pass (run.ts:340-343). Pending mail is scanned newest first with a deterministic keyset, so a message that deterministically gets HTTP 500 or a 120 s timeout is the first LLM-bound message reached on every later pass. Every older LLM-bound message is never classified, the pass returns infra, runBatch throws ClassifyInfraError (mailbox-batch.ts:485-487) and the supervisor backs off up to 15 min, which also slows IMAP ingest for that mailbox. Status blames Ollama as a whole. No command can skip or quarantine the message (sift classify --message hits the same failure). The test 'a 500 on the third call stops LLM work for the pass' (classify-run.test.ts:391) codifies the per-pass half; nothing distinguishes a message-specific failure from an outage. Flagged for the owner in 03-07/03-08/03-09 and STATE.md, but no override has been recorded. Review CR-01."
    artifacts:
      - path: "apps/worker/src/classify/run.ts"
        issue: "draftFor (lines 338-344) turns every chat infra result into a pass-wide llmBlocked; no per-message failure memory, no way to tell one bad message from an outage"
      - path: "apps/worker/src/runtime/mailbox-batch.ts"
        issue: "infra outcome throws ClassifyInfraError, so a single poison message puts ingest and classification into exponential backoff indefinitely"
    missing:
      - "Tell a failure confined to one message from an outage (for example re-run the mail-free preflight after server_error/timeout; if it succeeds, skip only that message for this pass and continue, with a small per-pass budget)"
      - "A terminal state for a message that keeps failing (per-runtime failure count, then either a review decision with a new reason, which needs a REVIEW_REASONS / CHECK / D-16 amendment, or the message id surfaced in last_error)"
      - "Test: a fake that 500s on one specific message only; assert older LLM-bound messages are decided in the same or next pass and the mailbox does not stay in backoff"
  - truth: "03-12: a selected message whose body has expired is refetched ... and the refetched body then expires 7 days after that decision (D-32; T-03-20 'bodies kept longer than policy through re-runs')"
    status: partial
    reason: "restoreBody writes the refetched body with expires_at null (packages/db/src/classify.ts:222-240; refetch.ts:74-81) and relies on the same run's recordDecision to set the expiry. commands/classify.ts:306-323 refetches every expired body in the chunk before classifyCandidates runs. If the run then records no decision for a restored message (Ollama outage on the first message -> llmBlocked and exit 1 at line 331, Ctrl-C, or a per-message failure), the body keeps expires_at null. deleteExpired only removes rows with expires_at <= now (scope.ts:434-441) and deleteOrphanBodies keeps any message that has a decision (ingest.ts:442-444), and the worker never revisits decided mail (pendingOnly). The body is kept indefinitely, contradicting README.md:409 ('A body is deleted 7 days after the message's decision') and the 03-SECURITY.md closed status of T-03-20. Review CR-02."
    artifacts:
      - path: "apps/worker/src/classify/refetch.ts"
        issue: "restored body of an already-decided message gets expires_at null"
      - path: "packages/db/src/classify.ts"
        issue: "restoreBody has no expiresAt argument; recordDecision is the only writer of expires_at"
      - path: "packages/db/src/ingest.ts"
        issue: "storeBatch insertOrIgnore can likewise re-insert a body with expires_at null for a message that already has a decision"
    missing:
      - "When the message already has a decision, write the restored or re-inserted body with expires_at = now + 7 days at insert time"
      - "Test: refetch, then a forced outage before the decision; assert expires_at is not null"
  - truth: "Derived regression truth: Phase 3's restructured batch keeps Phase 2's fail-closed volume valve (D-26): a one-time sift mailbox resume approval is consumed by the batch that used it"
    status: failed
    reason: "With classification wired, the in-lock recordSyncSuccess is skipped for synced/resynced (mailbox-batch.ts:409-413), and the valve counts are cleared only by the post-pass status writes for done/busy/aborted/rules_invalid/infra (lines 468-487, status.ts:53-55). If classifyMailbox throws anything else (pg error, the MAX_CONSECUTIVE_MESSAGE_FAILURES rethrow at run.ts:424, a failed status write) or the process dies mid-pass, onBatchError's generic branch (line 520-522) calls recordSyncError without syncedAt, so approved_new_count stays set and state becomes error rather than needs_attention. The next batch passes the hold check (line 347) and ingests with newMailCap = hold.approved + cap (line 377), and repeats that on every batch until one succeeds. Phase 2 cleared the approval inside the ingest lock; the Phase 3 restructuring (03-09) lost that. Review CR-03."
    artifacts:
      - path: "apps/worker/src/runtime/mailbox-batch.ts"
        issue: "valve approval and last_sync_at cleared only after the classification pass, not with the ingest commit"
    missing:
      - "Clear held/approved counts and set last_sync_at inside the ingest lock right after a synced/resynced outcome, independent of classification; leave only state/last_error to the post-pass write"
      - "Test: resume, then a batch whose classification pass throws a non-infra error; assert approved_new_count is null and the next batch uses cap"
human_verification:
  - test: "Run the manual live baseline on synthetic data (03-13 Task 2, AI-SPEC section 5 E4-live, E11-live, E12): node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b"
    expected: "Markdown table with header '| fixture | category | confidence | attempts | thinking null | total_ms | flip | model digest |', exactly 10 data rows, 'yes' in every thinking-null cell, one model digest throughout, last line 'flips: <n>'. Paste the output under 'Live baseline (synthetic data)' below and note the categories of the four action-mail pairs for E12. A non-zero flip count is the accepted Phase 3 residual."
    why_human: "Owner step on the owner's machine against the real local model; CI and this verifier only use the fake Ollama (the verifier was told not to call the local Ollama)"
  - test: "Owner judgment on the TRC-06 forward-compatibility truth (03-05, verification: backstop): M2 can record a real classifier span at index 1 without changing the trace layout or TRACE_FORMAT_VERSION semantics for earlier decisions"
    expected: "The owner agrees that widening ClassifierSpanSchema (now status: z.literal('skipped'), reason: z.literal('not trained')) in M2 keeps the [exact_rules, classifier, (llm,) action] tuple order and that M1 decisions stay parseable"
    why_human: "Non-inferable backstop truth about a future change; presence of the span at index 1 is verified, the M2 compatibility claim is not testable today"
  - test: "Owner decision on CR-01 (poison message): fix it, or record an override accepting the D-16 trade-off"
    expected: "Either a gap-closure plan lands, or an overrides entry is added to this file with the owner's name and reason"
    why_human: "The planner flagged this trade-off for the owner (03-07 PLAN line 267, STATE.md line 240); no decision is recorded"
---

# Phase 3: Tiered Classification with Traces Verification Report

**Phase Goal:** Every ingested message gets a category from exact rules or the local LLM, or is marked for review, and the reason is recorded as a replayable trace.
**Verified:** 2026-10-11T00:10:00Z
**Status:** gaps_found
**Re-verification:** No (initial verification)

## Goal Achievement

The core contract holds. Exact rules decide without Ollama. The LLM tier is fenced, schema-constrained, retried once and then sent to review. The threshold is applied in `decide()`. Every decision is written through `recordDecision` with a fixed span layout and versioned rule_set and prompt_version rows. Injected text cannot widen the category set. The goal fails on one path: a message whose LLM call fails the same way every time (HTTP 500 or timeout) never gets a category or a review, and it stops every older LLM-bound message in its mailbox from being classified. Two smaller defects in phase-3 code break a body-retention promise and a Phase 2 fail-closed control.

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A message covered by a hardcoded exact rule (sender, domain, phrase) is classified without any LLM call; its trace shows the rules checked and the match | VERIFIED | `run.ts:316-320` returns `decide({exact})` before any preflight or chat; `exact-rules.ts` builds no RegExp (grep empty); `decide.ts:89-104` spans `[exact_rules, classifier, action]`; classify-run.test.ts (exact-rule decisions with 0 chat requests) and exact-rules.test.ts pass |
| 2 | A message no exact rule matches is classified by the local LLM into one of the mailbox's categories, with a confidence and a one-sentence reason; out-of-category or malformed output is retried once, then marked for review | VERIFIED | `llm-tier.ts:75-146` (MAX_ATTEMPTS 2, fresh nonce, closed-set retry note, review `out_of_category`/`invalid_output`); `llm-output.ts:23-28` strict schema, `z.enum(categories)`, reason max 200; classify-llm-tier.test.ts, llm-output.test.ts pass |
| 3 | An LLM result below the confidence threshold is marked for review rather than given a category | VERIFIED | `decide.ts:136-152` (`>= threshold` labels, otherwise review `low_confidence` with category null, confidence kept); config default 0.75; decide.test.ts boundary cases (0.7499 vs 0.75) pass |
| 4 | Every classification has a `decision` row with one span per tier that ran and the rule-set, prompt and model versions; the LLM span holds the rules included, raw output, validation result and confidence | VERIFIED | `spans.ts:190-197` tuple layouts; `run.ts:347-367` llm span context (model, digest, ollama version, prompt version and hash, categories, judgment rules, examples []); `recordDecision` (db/classify.ts:128-160) parses spans before insert; migrations 0008-0010 typed columns and CHECKs; classify-trace.test.ts `expectReplayableDecision` re-renders requests from stored data and passes |
| 5 | Injected instructions in a message do not change the allowed categories or what the pipeline does, and one failed message (for example Ollama unavailable) does not stop the others | FAILED (partial) | Injection half VERIFIED: `prompt.ts:108-209` (trusted system text only from rules, email inside nonce fence, header fields one-line and capped, nonce-collision guard); classify-injection.test.ts and classify-leak.test.ts pass. Isolation half FAILED: see Gap 1 (CR-01). A per-message deterministic 500/timeout sets pass-wide `llmBlocked` (`run.ts:340-343`) and is the first LLM-bound message reached on every later pass, so all older LLM-bound mail stays pending indefinitely and the mailbox stays in backoff |
| 6 | Every trace has a classifier span marked skipped ("not trained") between the exact-rules span and the LLM span | VERIFIED | `spans.ts:69-81` ClassifierSpanSchema literals `skipped` / `not trained`; both tuple layouts put it at index 1 (`spans.ts:194-197`); `decide.ts` inserts `CLASSIFIER_SKIPPED_SPAN` in both paths; spans.test.ts ordering and empty-edge cases pass. The M2 forward-compatibility clause is a backstop truth and goes to human verification |

**Roadmap score:** 5/6 success criteria verified.

### Plan Must-Have Truths (139) and Derived Truth

| Plan | Truths | Result | Notes |
|------|--------|--------|-------|
| 03-01 rules schema/loader | 11 | 11 VERIFIED | rules.test.ts, example-rules.test.ts; artifacts 5/5, links 3/3 |
| 03-02 config threshold/backfill | 6 | 6 VERIFIED | config.test.ts, example-config.test.ts, user-facing-text.test.ts |
| 03-03 schema/migrations | 10 | 10 VERIFIED | classify-schema.test.ts, catalog.test.ts, migrate.test.ts (green in the orchestrator's full run) |
| 03-04 matcher/decide/hash | 16 | 16 VERIFIED | exact-rules.test.ts, decide.test.ts, rules-hash.test.ts (run here: pass) |
| 03-05 prompt/output/spans/prompt version | 22 | 21 VERIFIED, 1 insufficient_spec (human) | The TRC-06 M2 forward-compat backstop truth needs owner judgment |
| 03-06 db queries/write path | 11 | 11 VERIFIED | classify.test.ts. The `restoreBody ... expires_at null` truth is met as written; its consequence is Gap 2 |
| 03-07 Ollama client/tier/preflight/gate | 8 | 8 VERIFIED | classify-ollama-client/llm-tier/preflight tests |
| 03-08 classification pass | 17 | 17 VERIFIED as specified | The outage truth holds for a real outage that ends. The per-message poison case is outside what the plan specified and is counted under SC5 |
| 03-09 worker batch | 8 | 8 VERIFIED | worker-classify.test.ts, classify-batch.test.ts (run here: pass); see derived truth below |
| 03-10 hostile fixtures/leak/hermetic | 9 | 9 VERIFIED | classify-injection/leak/hermetic tests |
| 03-11 config check/rename guard/ro mount | 5 | 5 VERIFIED | config-check-rules, mailbox-rename-guard, compose tests |
| 03-12 sift classify re-run | 9 | 8 VERIFIED, 1 FAILED (partial) | Refetched-body expiry: Gap 2 |
| 03-13 docs and baseline runner | 7 | 6 VERIFIED, 1 UNCERTAIN (human) | Manual live baseline not run (owner step) |
| Derived: Phase 2 D-26 valve not regressed | 1 | FAILED | Gap 3 |

**Score:** 141/146 (6 SCs + 139 plan truths + 1 derived). Not verified: SC5, the 03-12 refetch expiry truth, the derived valve truth, the 03-05 backstop truth (human), the 03-13 live baseline truth (human). Behavior-unverified: 0.

### Required Artifacts

`gsd-tools query verify.artifacts` on all 13 plans: 50/50 artifacts pass (exist, substantive). Wiring was spot-checked by hand. `commands/worker.ts:154-159` creates one `createSingleFlight()` gate and one `createClassifyRuntime`, and passes `classify` into `createMailboxCallbacks`. `mailbox-batch.ts:458-467` runs `classifyMailbox` after a synced ingest. `commands/classify.ts` reuses `classifyCandidates` with `decidedBy: 'rerun'`.

### Key Link Verification

`gsd-tools query verify.key-links` on all 13 plans: 29/29 links verified.

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| decision row | spans, category, confidence | `decide()` from `matchExactRules` on stored message plus `runLlmTier` on the Ollama response | yes (classify-trace replay test re-renders requests from DB rows) | FLOWING |
| llm span versions | prompt_version id/hash, model digest | `ensurePromptVersion(promptMaterial())`, preflight `/api/show` | yes | FLOWING |
| rule_set | snapshot/hash | `loadRules` on `data/mailboxes/<slug>/rules.yaml` each pass, then `ensureRuleSet` | yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Core decide/spans/rules/prompt/output contracts, pass, trace replay, injection, LLM tier | `npx vitest run packages/core/test/{decide,spans,exact-rules,prompt,llm-output}.test.ts apps/worker/test/{classify-trace,classify-injection,classify-run,classify-llm-tier}.test.ts` | 9 files, 245/245 passed | PASS |
| Worker batch, CLI re-run, refetch, leak | `npx vitest run apps/worker/test/{worker-classify,classify-batch,classify-cli,classify-refetch,classify-leak}.test.ts` | 5 files, 50/50 passed | PASS |
| Full suite (orchestrator run) | `npm test` | 1604/1609; the 5 failures are 30 s load timeouts in 4 IMAP/compose files (known flake bug-214), which pass 100/100 with `--no-file-parallelism`; typecheck and lint clean | PASS (flake noted) |
| Poison-message isolation | no test exists; `classify-run.test.ts:391` asserts the opposite (a 500 leaves later messages pending) | n/a | FAIL (source-level, Gap 1) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exists and no plan declares a probe. Step 7c: not applicable.

### Live baseline (synthetic data)

Not run. Owner step (03-13 Task 2, 03-USER-SETUP.md). Paste the runner output here when it is done.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| CLS-01 | 03-01, 03-04, 03-08, ... | SATISFIED | SC1 |
| CLS-02 | 03-05, 03-07, 03-08, ... | SATISFIED | SC2, fenced prompt |
| CLS-03 | 03-05, 03-07, ... | SATISFIED | SC2 |
| CLS-04 | 03-02, 03-03, 03-04, ... | SATISFIED | SC3 |
| CLS-05 | 03-04, 03-07, 03-10 | SATISFIED | only `message.content` read; `z.enum` categories; one draft per message; no tools key |
| CLS-06 | 03-03, 03-06, 03-08, ... | BLOCKED (partial) | Exactly-once per version: satisfied (partial unique index, pendingOnly). "A failure in one message (Ollama down, malformed mail) does not stop the others": fails for a per-message deterministic Ollama failure (Gap 1) |
| TRC-01 | 03-03, 03-05, 03-06, ... | SATISFIED | decision row with spans and a final (pending) action span, mailbox-scoped under RLS |
| TRC-02 | 03-04 | SATISFIED | rules_checked, matches, nearest miss |
| TRC-03 | 03-05, 03-08 | SATISFIED | llm span fields, examples [] |
| TRC-04 | 03-03, 03-04, 03-06 | SATISFIED | rule_set and prompt_version stored as versioned rows; replay test |
| TRC-06 | 03-04, 03-05 | SATISFIED | SC6 (M2 claim goes to human) |
| SEC-01 | 03-05, 03-08, 03-10, ... | SATISFIED | fence, trusted-only system message, no regex from mail, log redaction tests |

All 12 phase IDs are claimed by at least one plan. REQUIREMENTS.md maps no other ID to Phase 3 (TRC-05 is Phase 4). No orphans. REQUIREMENTS.md marks CLS-06 Complete. That status is wrong until Gap 1 is closed.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| apps/worker/src/classify/run.ts | 340-343 | message-specific infra failure treated as a pass-wide outage | Blocker | Gap 1 (CR-01) |
| apps/worker/src/classify/refetch.ts / packages/db/src/classify.ts | 74-81 / 222-240 | restored body with no expiry unless the same run decides it | Blocker | Gap 2 (CR-02) |
| apps/worker/src/runtime/mailbox-batch.ts | 409-413, 520-522 | valve cleared only on known pass outcomes | Blocker | Gap 3 (CR-03) |
| packages/core/src/classify/llm-output.ts | 25 | reason accepts control characters; a NUL makes the jsonb insert fail (22P05) every pass | Warning | WR-01. Can be triggered by injected text. Same family as Gap 1 (no terminal state); five in a row trigger Gap 3 |
| packages/core/src/rules/schema.ts | 65-72 | `oneLine` rejects only CR/LF; NUL passes config check, then ensureRuleSet fails | Warning | WR-02 |
| apps/worker/src/classify/run.ts / mailbox-batch.ts | 417-425 / 469-473 | per-message failures hidden: status `ok` | Warning | WR-03, same family as Gap 1 |
| packages/core/src/classify/prompt-version.ts | 50-63 | `PLACEHOLDER_*` names | Info | intentional template render, not a stub |

No TBD/FIXME/XXX markers in phase source files. The 7 Info findings from review (IN-01..07) are not goal-affecting and are left to the review disposition.

### Human Verification Required

### 1. Manual live baseline (E4-live, E11-live, E12)

**Test:** `node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b` on synthetic fixtures.
**Expected:** 10 rows, `thinking null` = yes everywhere, one digest, `flips: <n>`. Paste the output into "Live baseline (synthetic data)" above.
**Why human:** Needs the owner's local model. CI uses only the fake Ollama.

### 2. TRC-06 M2 forward compatibility (backstop)

**Test:** Review whether M2 can replace the skipped classifier span at index 1 without changing the tuple layout.
**Expected:** Owner agrees, or asks for a TRACE_FORMAT_VERSION plan.
**Why human:** This is a claim about a future change and cannot be tested today.

### 3. CR-01 owner decision

**Test:** Decide whether to fix the poison-message case or accept it.
**Expected:** A gap-closure plan, or an `overrides:` entry in this file.
**Why human:** The planner deferred this trade-off to the owner.

If the owner accepts the D-16 trade-off instead of fixing it, add to this file's frontmatter:

```yaml
overrides:
  - must_have: "one failed message (for example Ollama unavailable) does not stop the others"
    reason: "A per-message deterministic Ollama 500/timeout is accepted as an outage under D-16 for M1; owner monitors mailbox_status"
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
```

This verifier recommends a fix over an override. The fix is small, and without it the README target hardware (CPU-only) can hit the timeout variant on large prompts with no way to recover.

### Gaps Summary

Three gaps. All come from failure paths that the phase-3 restructuring introduced, not from the core classification contract.

1. **No isolation for a message that always fails in the LLM tier (CR-01; SC5, CLS-06).** This is the phase-goal gap. Such a message never gets a category or review, blocks all older LLM-bound mail in its mailbox for good, and keeps the mailbox (ingest included) in up-to-15-min backoff. WR-01 (NUL in the reason) and WR-03 (hidden per-message failures) have the same root cause: a message that keeps failing has no terminal state and stays invisible. A closure plan should handle all three together.
2. **Refetched bodies can be kept forever (CR-02).** An interrupted `sift classify` leaves restored bodies of already-decided messages with no expiry. This breaks the 03-12 truth, the README's 7-day promise and the closed status of T-03-20 in 03-SECURITY.md. The ingest re-insert path has the same issue.
3. **Volume-valve approval leaks after a pass throws (CR-03).** This regresses Phase 2's fail-closed D-26 valve. 03-09 moved the valve clearing out of the ingest lock. Gap 1's companion WR-01 makes the throw path reachable (five consecutive failures rethrow).

No later phase in the milestone covers any of these (Phase 4 covers labels, review actions, trace printing, label_event and the real-inbox run), so none is deferred.

---

_Verified: 2026-10-11T00:10:00Z_
_Verifier: Claude (gsd-verifier)_
