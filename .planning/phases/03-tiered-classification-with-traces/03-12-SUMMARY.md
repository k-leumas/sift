---
phase: 03-tiered-classification-with-traces
plan: 12
subsystem: classify
tags: [cli, rerun, ingest-lock, imap, refetch, identity-key, ollama]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-06 candidates (messageIds/since/pendingOnly), restoreBody, latestDecision; 03-08 classifyCandidates, newPassState, loadMailboxRules, createClassifyRuntime, infraOwnerMessage; 03-07 fake Ollama, single flight"
provides:
  - "sift classify <slug> (--message <id> | --since <YYYY-MM-DD> | --all-pending) [--yes]: the one explicit re-run door (D-17)"
  - "classifyCommand(deps), parseClassifyArgs, parseDay, Selector, ClassifyCommandDeps, USAGE, CLASSIFY_CONFIRM_THRESHOLD 20, CLASSIFY_LOCK_WAIT_MS 300_000"
  - "refetchBodies(session, candidates, { entry, password, openImap }) and RefetchResult / RefetchFailedError (D-32 refetch half)"
  - "COMMANDS entry ['classify'] shown in sift --help"
affects: [03-13, phase-04-apply, phase-03-verification]

actuals:
  tokens: 15500
  tasks: 3
  commits: 4
plan_head_before: 0b2ba05d6ea87190885fe81485cf0178f9658a46
plan_head_after: 9a9bd30f1f147237eae3e0e6bfcbdc28745978ce

tech-stack:
  added: []
  patterns:
    - "CLI commands copy mailbox-backfill.ts: parseArgs strict, underLock retry loop, confirm after releasing the lock, SIGINT AbortController, redacted stderr"
    - "Config entry and password are resolved lazily, only when a body must be refetched"
    - "Mutation checks prove tests that pass at first run are not vacuous; a JUnit RED record backs one of them"

key-files:
  created:
    - apps/worker/src/commands/classify.ts
    - apps/worker/src/classify/refetch.ts
    - apps/worker/test/classify-cli.test.ts
    - apps/worker/test/classify-refetch.test.ts
  modified:
    - apps/worker/src/command.ts
    - apps/worker/test/cli.test.ts

key-decisions:
  - "03-12: every sift classify decision is decided_by rerun, also for a pending message (RESEARCH open question 3); latestDecision then returns it"
  - "03-12: the IMAP entry and password are needed only for a refetch, so a re-run of mail with cached bodies works without the password env; a missing one refuses with the worker's password_missing text"
  - "03-12: a refetch requires the stored location under the folder's current UIDVALIDITY and an equal re-derived identity key; a gone or changed message is one skip line by id and the command carries on (exit 0)"
  - "03-12: an Ollama outage prints two lines (owner message, then 'classified x of n; y left') and exits 1; left excludes messages skipped as gone, changed or decided meanwhile"
  - "03-12: the summary adds '; N skipped' when some selected messages were not classified; the lock-wait line and skip lines go to stderr"

patterns-established:
  - "A re-run re-reads each chunk under the lock (pendingOnly for --all-pending), so mail the worker decided while the owner was asked is skipped"

requirements-completed: [CLS-06, TRC-01]

coverage:
  - id: D1
    description: "--message on a decided message appends a rerun decision, keeps the worker one unchanged, latestDecision returns the rerun, both replay (D-17)"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#appends a rerun decision next to the worker one; the rerun is the current decision"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#a pending message re-run with --message is also decided_by rerun"
        status: pass
    human_judgment: false
  - id: D2
    description: "Exactly one selector, slug, UUID id and a real YYYY-MM-DD not after today, else usage and exit 2; usage listed in sift --help"
    verification:
      - kind: unit
        ref: "apps/worker/test/classify-cli.test.ts#sift classify arguments (D-17, P1 D-24)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/cli.test.ts#--help exits 0 and lists every Phase 1 command"
        status: pass
    human_judgment: false
  - id: D3
    description: "--since selects decided and undecided mail on or after the date; --all-pending pending only and skips what the worker decided meanwhile; unknown id, unknown slug and disabled mailbox exit 1 with nothing changed"
    requirement: CLS-06
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#sift classify selection"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#--all-pending skips messages the worker decided while the owner was asked"
        status: pass
    human_judgment: false
  - id: D4
    description: "Above 20 messages the count is shown and confirmation asked with the lock released; declined prints Nothing changed. and writes nothing; accepted decides all 30 with 30 chat calls (no per-pass cap); 3 messages ask nothing"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#sift classify count and confirmation (D-17)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A held ingest lock is waited on with one waiting line, then refused with 'the worker is classifying <slug> right now'; a lock released within the wait lets the run start (P2 D-03, T-03-45)"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#waits for the ingest lock, saying so once, then refuses with nothing written (P2 D-03)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#starts once the worker releases the lock within the wait"
        status: pass
    human_judgment: false
  - id: D6
    description: "Ollama outage after 2 of 5: exit 1, 'Ollama unreachable at ' and 'classified 2 of 5; 3 left', mailbox_status unchanged; invalid rules.yaml exits 1 with positioned issues and no request; Ctrl-C during a hanging call exits 1 with no decision"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#sift classify alongside the worker, outages and Ctrl-C"
        status: pass
    human_judgment: false
  - id: D7
    description: "An expired body is refetched read-only from Dovecot by identity, a rerun decision appended, and the restored body expires 7 days after it; identity mismatch, expunge and new UIDVALIDITY are skipped by id; no connection while cached; missing password refuses (D-32, T-03-44)"
    requirement: TRC-01
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-refetch.test.ts#sift classify refetches an expired body by identity (D-32)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/read-only-ingest.test.ts"
        status: pass
    human_judgment: false
  - id: D8
    description: "No command output in either test file holds a seeded subject, sender, body, model reason or the IMAP password (T-03-47)"
    verification:
      - kind: integration
        ref: "apps/worker/test/classify-cli.test.ts#no command printed a subject, sender, body or model reason"
        status: pass
      - kind: integration
        ref: "apps/worker/test/classify-refetch.test.ts#no run printed a subject, body or model reason, or the password"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 12: sift classify Re-run Summary

**`sift classify <slug>` re-runs one message, a date range or all pending mail. It counts the messages, asks above 20, waits for the worker's ingest lock, and appends decided_by rerun decisions through the worker's own classifier. Before classifying a message whose cached body has expired, it refetches the body from IMAP read-only, and only when the server copy's re-derived identity key matches the stored one.**

## Performance
- **Duration:** about 22 min (2026-10-10T22:02:18Z to 22:24:40Z)
- **Tasks:** 3 (a tracer, then two tdd tasks)
- **Files:** 4 created, 2 modified

## Accomplishments
- `commands/classify.ts`:
  - `run()` parses the command line strictly. It loads the config and SIFT_DATA, builds a runtime with its own single-flight gate, maps Ctrl-C to an abort, and reads a typed `yes`.
  - `classifyCommand()` refuses an unknown slug, a disabled mailbox or an invalid rules file. It then selects ids under the lock (keyset pages), prints the count and confirms above 20 with the lock released. It classifies chunks of 5, each under the lock, through `classifyCandidates` with `decidedBy: 'rerun'` and `newPassState(null)`.
  - On an outage or Ctrl-C it stops with fixed lines. It never writes mailbox_status.
- `classify/refetch.ts`: `refetchBodies` opens no connection when no body expired. Otherwise it opens one pinned connection and EXAMINEs the folder. It takes the live location under the current UIDVALIDITY, re-derives the identity key with `parseMessage`, downloads with BODY.PEEK, and calls `restoreBody` (expiry stays null until the rerun decision sets it). IMAP failures become one fixed owner line, never the server reply.
- Tests: 29 CLI cases, 7 refetch cases against Dovecot, and the help listing. The full worker suite passes (794/794). `pnpm typecheck` exits 0. `pnpm lint` shows only the existing warning.

## Task Commits
1. **Task 1 (tracer): command, registration, rerun tracer test** - `2d73e69` (feat)
2. **Task 2: selectors, confirmation, lock wait, outage, Ctrl-C** - `4530df4` (test)
3. **Task 3 RED: refetch tests** - `e2eae3d` (test)
4. **Task 3 GREEN: refetch by identity** - `9a9bd30` (feat)

Tracer gate: interactive run, end-of-phase verification, automated-only verify. I re-ran the verify (7/7 plus typecheck). It passed, and I went on with no checkpoint.

## TDD Gate Compliance
- **Task 2, unexpected GREEN (fail-fast rule 1, investigated):** all its cases passed the first time they ran, because the Task 1 action had already built selection, confirmation, the lock wait, the outage stop and the abort. There was no missing feature to drive, so Task 2 has no `feat` commit. `workflow.tdd_mode` is false and the plan type is `execute`.
  - To prove the tests bite, I broke one behaviour at a time and restored the file each time. None of these was committed. Each mutation made at least one target test fail:
    - confirm threshold raised to 1000
    - `decidedBy` set to 'worker'
    - the chunk re-read not pendingOnly
    - the waiting line printed on every retry
    - no stop on an outage
    - a 25-call cap
    - abort ignored
    - --since set to pendingOnly
    - a sender address printed
  - Machine-checked failing run: the cap mutation, run through JUnit, gave **RED_EVIDENCE_OK target_test_failed** (the summary said 25 classified, not 30). That run was against a deliberately broken implementation, not a missing one.
- **Task 3, a real RED:** I wrote the refetch tests, then ran the target against the committed Task 2 `classify.ts`, which skipped expired bodies. `gsd check tdd-red-evidence` returned **RED_EVIDENCE_OK target_test_failed**. Semantic assessment: the target ran and failed on its first planned assertion, because stderr held `body expired; skipped` (no refetch). There was no load, fixture or syntax fault. The RED commit `e2eae3d` holds only the test file. The GREEN commit `9a9bd30` adds the code. Two more mutations each fail one target test: dropping the identity check fails the mismatch test, and dropping the UIDVALIDITY match fails the T-03-44 test.

## Files Created/Modified
- `apps/worker/src/commands/classify.ts`: the command (run, classifyCommand, parseClassifyArgs, parseDay, constants).
- `apps/worker/src/classify/refetch.ts`: refetchBodies, RefetchResult, RefetchFailedError.
- `apps/worker/src/command.ts`: COMMANDS entry `['classify']`.
- `apps/worker/test/classify-cli.test.ts` (614 lines), `apps/worker/test/classify-refetch.test.ts`, `apps/worker/test/cli.test.ts` (usage).

## Decisions Made
See key-decisions. Recorded assumptions from the plan held: every CLI decision is rerun, and the command has its own single-flight gate. The per-message infra/500 behaviour of run.ts was not changed (open owner decision); in the re-run it stops the command with exit 1.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Test strength] Confirmed run seeds 30 messages, not 25**
- **Found during:** Task 2
- **Issue:** 25 equals the worker's LLM_CALLS_PER_TICK, so 25 chat calls cannot show that the re-run has no cap.
- **Fix:** I seed 30, and the test expects 30 calls, 24 labelled and 6 review (every fifth answer is low confidence).
- **Commit:** 4530df4

**2. [Rule 2 - Correctness] The IMAP entry and password are resolved only when a body must be refetched**
- **Found during:** Task 3
- **Issue:** Requiring the password up front would block re-runs of mail whose bodies are still cached, and would read a secret that is not needed.
- **Fix:** The entry and password are resolved on the first expired body. A missing one exits 1 with the worker's password_missing text, before any connection and with nothing written (tested).
- **Commit:** 9a9bd30

**3. [Rule 2 - Owner output] Small output additions the plan left open**
- The waiting line and the skip lines go to stderr.
- A message that throws prints `message <id>: could not be classified (<code>)`.
- The summary appends `; N skipped` when some selected mail was not classified.
- An outage's "left" count excludes messages skipped as gone, changed or decided meanwhile.
- **Commits:** 2d73e69, 9a9bd30

**Total deviations:** 3 auto-fixed (all Rule 2). **Impact:** test strength and owner-facing clarity only. No scope creep and no new dependency.

## Issues Encountered
- Commits are on `main`. The orchestrator ran this plan sequentially with branching_strategy none and said committing on main is intended.
- `readLine` and `pause` are copied from mailbox-backfill.ts, following the precedent in bridge-probe.ts. This kept the change inside files_modified. A shared CLI helper module could absorb all three copies later.
- One of my shell commands hung because it sourced a GSD reference markdown file. I killed it. No repository file was affected, and classify.ts was confirmed restored.

## Known Stubs
None.

## Next Phase Readiness
- The owner has the one explicit re-run door, for example after editing rules.yaml or pulling a new model. Each decision is appended, and the newest is current.
- Phase 4 can rely on a refetched body only ever being attached by identity under the current UIDVALIDITY.

## Self-Check: PASSED
- All 4 created files are on disk. Commits 2d73e69, 4530df4, e2eae3d and 9a9bd30 are ancestors of HEAD, and evaluation-scope resolves the plan's commits.
- Plan verification: `pnpm vitest run apps/worker/test/classify-cli.test.ts apps/worker/test/classify-refetch.test.ts apps/worker/test/cli.test.ts apps/worker/test/read-only-ingest.test.ts` gives 45/45 with Dovecot up. `pnpm typecheck` exits 0.
- Acceptance greps match: `path: ['classify']`, `export async function classifyCommand`, `decidedBy: 'rerun'`, `sift classify <slug>` in cli.test.ts, `CLASSIFY_CONFIRM_THRESHOLD = 20`, `CLASSIFY_LOCK_WAIT_MS = 300_000`, `export async function refetchBodies`, and `identityKey` in refetch.ts.
