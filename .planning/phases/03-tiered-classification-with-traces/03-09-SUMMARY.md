---
phase: 03-tiered-classification-with-traces
plan: 09
subsystem: worker
tags: [classification, worker, mailbox-status, ollama, single-flight, rules-yaml, supervisor]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-08 classifyMailbox, createClassifyRuntime, rulesProblemMessage, infraOwnerMessage; 03-07 createSingleFlight, fake Ollama; 03-01 resolveDataPath; 03-11 SIFT_DATA=/data mount"
provides:
  - "runBatch classifies after every synced/resynced ingest and writes mailbox status once (D-14)"
  - "ClassifyInfraError: an Ollama outage rejects the batch (backoff) and is recorded with last_sync_at of the ingest, never as connecting (D-16)"
  - "rules.yaml problems resolve the batch (no backoff) with last_error naming the file and its problems (D-05)"
  - "recordSyncError(scope, error, secrets, at?, { syncedAt? })"
  - "sift worker builds one ClassifyRuntime from SIFT_DATA and models.url with one process-wide single-flight gate (D-19); 'worker started' logs dataDir"
  - "startFakeOllama({ port }) for stop/restart tests"
affects: [03-10, 03-12, 03-13, phase-04-apply, readme]

actuals:
  tokens: 10227
  tasks: 3
  commits: 3
plan_head_before: 8635411618f5be8559ebc3b34e48e121f3b645be
plan_head_after: aaafe2e1618a8a21e6134c6370b020ee845a2b37

tech-stack:
  added: []
  patterns:
    - "The ingest lock callback returns the ingest time; classification and the single status write happen after the lock is released"
    - "An optional runtime in MailboxIngestOptions switches the behaviour on, so Phase 2 tests and callers keep the exact old path"

key-files:
  created:
    - apps/worker/test/classify-batch.test.ts
    - apps/worker/test/worker-classify.test.ts
  modified:
    - apps/worker/src/runtime/mailbox-batch.ts
    - apps/worker/src/commands/worker.ts
    - packages/db/src/status.ts
    - packages/db/test/status.test.ts
    - apps/worker/test/support/fake-ollama.ts

key-decisions:
  - "A classify pass that is busy (sift classify holds the lock) or aborted by shutdown still records ok with the ingest time: the ingest succeeded and pending mail is picked up next batch"
  - "ClassifyInfraError is handled in onBatchError before MailboxSyncError, so the IMAP startup grace never turns an Ollama error into connecting"
  - "An error thrown by classifyMailbox itself (database, disabled mailbox) propagates to onBatchError's existing branches unchanged"
  - "The rules_invalid warn line carries the mailbox slug only; the file and problems are in last_error"

requirements-completed: [CLS-06, CLS-02, TRC-01]

coverage:
  - id: D1
    description: "After a successful ingest, runBatch classifies the new mail in the same batch (exact rule with no chat request, the other through the fake), every decision replays, and status is ok with last_sync_at set (D-14)"
    requirement: CLS-02
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#ingests new mail and classifies it in the same batch, then records ok"
        status: pass
    human_judgment: false
  - id: D2
    description: "A broken or missing rules.yaml resolves the batch; status is error naming the file, the YAML path and sift config check, with last_sync_at set; another mailbox is classified and stays ok (D-05)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#resolves the batch, names the rules file in status and classifies the other mailbox"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ollama stopped: runBatch rejects with ClassifyInfraError unreachable, status error 'Ollama unreachable at <origin> (ECONNREFUSED)' inside the startup grace (never connecting), exact-rule mail decided, LLM mail pending; restarted: next batch ok and the pending mail decided. Missing model names ollama pull; a 500 stores a fixed message (D-16, E5)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#Ollama outages (D-16, E5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A mailbox held by the volume valve is not classified, stays needs_attention and sends nothing to Ollama; after resume the next batch stores and classifies the mail"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#does not classify a held mailbox, keeps needs_attention and classifies after resume"
        status: pass
    human_judgment: false
  - id: D5
    description: "Two mailboxes running at once with one shared runtime are both classified with fake.maxInFlight() 1 (D-19, E6)"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#classifies two concurrently running mailboxes with at most one request in flight"
        status: pass
    human_judgment: false
  - id: D6
    description: "Shutdown during a hung Ollama call resolves the batch with no decision and no error status; last_error and logs never carry mail text or Ollama's error text (T-03-31)"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#resolves the batch with no decision and no error when the signal fires mid-call"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-batch.test.ts#stores a fixed message for an Ollama 500, never Ollama's error text"
        status: pass
    human_judgment: false
  - id: D7
    description: "recordSyncError with syncedAt sets last_sync_at and clears the valve counts; without it they are untouched; redaction and the 1000-character cap still apply"
    verification:
      - kind: integration
        ref: "packages/db/test/status.test.ts#recordSyncError with and without syncedAt (D-05, D-16)"
        status: pass
    human_judgment: false
  - id: D8
    description: "A spawned sift worker (SIFT_DATA, models.url at the fake, no test hook) decides a backfilled bank message by the exact rule and a later message through the fake, status ok, dataDir in 'worker started', SIGTERM exit 0"
    requirement: CLS-02
    verification:
      - kind: e2e
        ref: "apps/worker/test/worker-classify.test.ts#decides a backfilled message by an exact rule and a new one through Ollama, then stops cleanly"
        status: pass
    human_judgment: false
  - id: D9
    description: "No Phase 2 regression: without a runtime, status ok is still written inside the ingest lock; full worker and db suites pass"
    verification:
      - kind: other
        ref: "pnpm vitest run apps/worker packages/db --maxWorkers=4 (1055/1055)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 09: Classification in the Worker Batch Summary

**The worker now classifies each mailbox's new mail right after ingest, in the same supervisor batch. It writes one status per batch. A broken rules file shows as an error naming the file and does not slow ingest. An Ollama outage backs the mailbox off with a fixed owner message and clears itself on the next healthy batch. One single-flight gate in `sift worker` keeps Ollama to one request at a time.**

## Performance
- **Duration:** about 15 min (2026-10-10T21:43:19Z to 21:58:58Z)
- **Tasks:** 3 (a tracer, then two tdd tasks)
- **Files:** 2 created, 5 modified

## Accomplishments
- `runBatch` returns the ingest time out of the lock. With a runtime, it runs `classifyMailbox`, then writes status once:
  - done, busy or aborted: `recordSyncSuccess(syncedAt)`.
  - rules_invalid: `recordSyncError(..., { syncedAt })` plus a slug-only warn line, and the batch resolves.
  - infra: it throws `ClassifyInfraError`.
- Without a runtime, the Phase 2 path is unchanged: status is still written inside the lock.
- `onBatchError` handles `ClassifyInfraError` first. It records the owner message with the ingest's `last_sync_at`, and the startup grace never applies.
- `sift worker` builds `createClassifyRuntime({ dataDir: resolveDataPath(env, cwd), modelsUrl: config.models.url, gate: createSingleFlight() })` once, and logs `dataDir` in its start line.
- Tests: 9 new cases (8 batch-level, 1 spawned worker) and 2 status cases. The full worker and db suites pass (1055/1055). `pnpm typecheck` exits 0. `pnpm lint` shows only the old warning in node-version.test.ts.

## Task Commits
1. **Task 1 (tracer): classification after ingest, ClassifyInfraError, syncedAt, worker wiring** - `c9052b9` (feat)
2. **Task 2: failure isolation at the batch level** - `5d9b899` (test)
3. **Task 3: spawned sift worker end to end** - `aaafe2e` (test)

Tracer gate: this was an interactive run with end-of-phase verification and an automated-only verify. I re-ran the verify (68/68 plus typecheck), it passed, and I went on with no checkpoint.

## TDD Gate Compliance
- **Unexpected GREEN (fail-fast rule 1, investigated):** all 8 Task 2 cases and the Task 3 case passed the first time they ran. Task 1's action had already built every path these cases test, so neither task has a `feat` commit. `workflow.tdd_mode` is false and the plan type is `execute`.
- **Proof the tests bite.** I broke one behaviour at a time in the working tree, ran the target test, and restored the file. None of these mutations was committed. Each one made its target test fail:
  - rules_invalid throws: the rules test fails.
  - `ClassifyInfraError` recorded as connecting: the outage test fails ('connecting' to be 'error').
  - classifying even when the ingest did not sync: the held-mailbox test fails.
  - aborted pass throws: the shutdown test fails.
  - LLM client not gated: the single-flight test fails (maxInFlight 2).
  - the 500 owner message appends Ollama's detail: the sentinel test fails.
  - worker.ts not passing `classify`: the spawned-worker test times out with no decision.
- **Machine-checked failing run:** I ran the ungated-client mutation through the junit reporter. `gsd check tdd-red-evidence` returned **RED_EVIDENCE_OK target_test_failed** (expected 2 to be 1). Semantic assessment: the target test ran and failed on the planned maxInFlight assertion. That run was against a deliberately broken implementation, not a missing one.

## Files Created/Modified
- `apps/worker/src/runtime/mailbox-batch.ts`: `classify?` option, `ClassifyInfraError`, classification after the lock, the single status write, and the onBatchError branch.
- `apps/worker/src/commands/worker.ts`: one gate, runtime from SIFT_DATA and models.url, `dataDir` in 'worker started', and an updated doc comment.
- `packages/db/src/status.ts`: `recordSyncError` takes `{ syncedAt }`. `packages/db/test/status.test.ts` covers both forms.
- `apps/worker/test/classify-batch.test.ts` (493 lines), `apps/worker/test/worker-classify.test.ts`.
- `apps/worker/test/support/fake-ollama.ts`: a `port` option.

## Decisions Made
See key-decisions. I left the per-message infra/500 behaviour of run.ts as it is (the owner's decision is still open). That behaviour now shows as `error` in the mailbox status, with backoff.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The fake Ollama could not be restarted at the same URL**
- **Found during:** Task 2 (the outage-then-recovery case has to keep one runtime, and the runtime holds the URL)
- **Fix:** I added `port?: number` to `FakeOllamaOptions`. That file is not in the plan's files_modified list.
- **Commit:** 5d9b899

**2. [Rule 1 - Test] The spawned-worker message needs the first backfill**
- **Found during:** Task 3 design. With initial_backfill_days 0, a first sync stores nothing that is already in the folder.
- **Fix:** The test config uses initial_backfill_days 1, so the bank message appended before start is backfilled, which makes it eligible (D-21). The second message is appended after the first decision and arrives through the next 10 s poll.
- **Commit:** aaafe2e

**Total deviations:** 2 auto-fixed (1 Rule 3, 1 Rule 1). **Impact:** test infrastructure only. No scope creep and no new dependency.

## Issues Encountered
- Commits are on `main`. The orchestrator ran this plan sequentially with branching_strategy none and said committing on main is intended.
- One of my mutation checks was a no-op (it only added a comment), so I replaced it with one that changes behaviour (bug-227).

## Known Stubs
None.

## Next Phase Readiness
- `sift mailbox list` (03-10) can show the classification errors as they are now stored in last_error and state.
- 03-12 (`sift classify`) shares the ingest lock. A worker pass that finds it held is `busy`, and status stays ok.
- The poisoned-message head-of-line case from 03-08 is still open for the owner. In the worker, it now shows as a mailbox `error` and the mailbox backs off.

## Self-Check: PASSED
- Both created files are on disk. Commits c9052b9, 5d9b899 and aaafe2e are ancestors of HEAD.
- Plan verification: `pnpm vitest run apps/worker/test/classify-batch.test.ts apps/worker/test/worker-classify.test.ts apps/worker/test/mailbox-batch.test.ts packages/db/test/status.test.ts` passes, and `pnpm typecheck` exits 0.
