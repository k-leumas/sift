---
phase: 02-bridge-spike-and-imap-ingest
plan: 16
subsystem: owner-cli
status: complete
tags: [cli, mailbox, volume-valve, backfill, advisory-lock, imap, tdd]
requires:
  - phase: 02-bridge-spike-and-imap-ingest
    provides: "02-02 per-mailbox imap.tls and ingest config; 02-10 countBackfill/runBackfill/BackfillPlan/BackfillRefusedError; 02-12 withIngestLock, recordNeedsAttention, mailbox_status valve and backfill columns; 02-13 createDbStore, ownerMessageFor, the registry-to-config lookup; 02-18 openImap/closeImap"
provides:
  - "packages/db/src/owner/registry.ts: resumeMailbox(ownerUrl, slug), ResumeResult, MailboxState; MailboxListing.heldNewCount/approvedNewCount/backfillDone/backfillTotal/messageCount"
  - "apps/worker/src/commands/mailbox-resume.ts: sift mailbox resume <slug>"
  - "apps/worker/src/commands/mailbox-backfill.ts: sift mailbox backfill <slug> [--days <n>] [--yes], backfillMailbox, BACKFILL_LOCK_WAIT_MS, MIN/MAX/DEFAULT_BACKFILL_DAYS, USAGE"
  - "apps/worker/src/commands/mailbox-list.ts: MESSAGES column; connecting, needs attention (resume approved) and backfilling texts"
  - "apps/worker/src/runtime/mailbox-batch.ts: configEntryFor, trackedSource, ingestKind, storedError now exported"
affects: [02-19]
actuals:
  tokens: 14300
  tasks: 3
  commits: 5
plan_head_before: 494daa2790cfd8e5c1292710131dff70f0bcdaa5
plan_head_after: e40d703b7a558cdaac25539d81f497eca5cd53ad
tech-stack:
  added: []
  patterns:
    - "Owner command over the worker's engine: the CLI takes the mailbox's ingest lock and builds the same IngestDeps (tracked FolderSource, createDbStore(session)) as the worker, so it shares the pinned connection path, the error classification and the owner texts"
    - "Lock wait as retry: withIngestLock is non-blocking, so the CLI retries every 2 s until a deadline, then refuses with a fixed line"
key-files:
  created:
    - apps/worker/src/commands/mailbox-resume.ts
    - apps/worker/src/commands/mailbox-backfill.ts
    - apps/worker/test/mailbox-ops.test.ts
  modified:
    - packages/db/src/owner/registry.ts
    - apps/worker/src/commands/mailbox-list.ts
    - apps/worker/src/command.ts
    - apps/worker/src/runtime/mailbox-batch.ts
    - apps/worker/test/cli.test.ts
    - apps/worker/test/registry-cli.test.ts
    - packages/db/test/registry.test.ts
key-decisions:
  - "02-16: the backfill reuses the worker's configEntryFor, trackedSource, ingestKind and storedError (now exported from mailbox-batch.ts) instead of copying them, so a backfill failure reads exactly like the worker's (pin mismatch, unreachable, rejected login) and only FolderSource errors are classified as IMAP errors"
  - "02-16: an aborted backfill (Ctrl-C between chunks) exits 1 with `Backfill of <slug> stopped between chunks; run it again to finish.`; an abort while still waiting for the lock exits 1 and changes nothing"
  - "02-16: a disabled mailbox is refused inside the lock via requireActive (`mailbox <slug> is disabled; nothing changed`); a registered mailbox missing from the loaded config gets its own line rather than the worker's recreate-the-worker text"
  - "02-16: the CLI's AppDb uses 2 connections (lock session plus the registry read)"
patterns-established:
  - "In-process command tests with a CommandIO capture helper and a Readable.from stdin, for prompts"
requirements-completed: [ING-02, ING-03]
coverage:
  - id: D1
    description: "sift mailbox resume approves the held count in needs_attention, reports not-waiting (ok, never run) unchanged, exits 1 for an unknown slug and 2 for bad usage, never prints the owner URL"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "apps/worker/test/mailbox-ops.test.ts#sift mailbox resume (D-26)"
        status: pass
      - kind: test
        ref: "apps/worker/test/cli.test.ts#--help exits 0 and lists every Phase 1 command"
        status: pass
    human_judgment: false
  - id: D2
    description: "listMailboxes returns valve counts, backfill progress and message counts; mailbox list renders connecting, needs attention (resume approved), ok backfilling x of y, error, disabled and never run, with a MESSAGES column"
    requirement: ING-03
    verification:
      - kind: integration
        ref: "packages/db/test/registry.test.ts#listMailboxes: states, valve, backfill progress and message counts (02-16)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/registry-cli.test.ts#sift mailbox list states, backfill progress and message counts (02-16, D-75)"
        status: pass
    human_judgment: false
  - id: D3
    description: "sift mailbox backfill counts, asks, and ingests exactly the counted messages uncapped without moving last_uid, the watermark or the backfill cursor; declined stores nothing and releases the lock; rerun stores no duplicates; mail arriving after the count is not ingested"
    requirement: ING-03
    verification:
      - kind: integration
        ref: "apps/worker/test/mailbox-ops.test.ts#sift mailbox backfill (D-03, D-75) > count, confirm, ingest"
        status: pass
      - kind: integration
        ref: "apps/worker/test/mailbox-ops.test.ts#ingests exactly the counted messages, not mail that arrived after the count"
        status: pass
    human_judgment: false
  - id: D4
    description: "Lock wait then refusal while the worker holds the mailbox; not-synced, resync, pin-mismatch, unknown-slug and abort texts; CLI usage, stdin yes, --yes; no password or database URL in output"
    requirement: ING-02
    verification:
      - kind: integration
        ref: "apps/worker/test/mailbox-ops.test.ts#waits for the ingest lock, then refuses while the worker holds it (D-03)"
        status: pass
      - kind: integration
        ref: "apps/worker/test/mailbox-ops.test.ts#the command line"
        status: pass
    human_judgment: false
duration: 15min
completed: 2026-10-06
---

# Phase 2 Plan 16: Owner Mailbox Commands Summary

**The owner can now release a volume hold with `sift mailbox resume <slug>`. `sift mailbox list` shows connecting, held, first-backfill progress and how many messages each mailbox stores. `sift mailbox backfill <slug> --days N` counts the last N days, asks for `yes`, then ingests exactly the counted messages with no new-mail cap. It holds the mailbox's ingest lock from the count through the ingest, so it never runs alongside the worker.**

## Performance

- **Duration:** 15 min (2026-10-06T14:25:45Z to 14:40:37Z), not counting context loading
- **Tasks:** 3 (a tracer, then two TDD tasks with RED and GREEN commits)
- **Files:** 3 created, 7 modified
- **Branch:** `main`, as intended (branching_strategy none)

## Accomplishments

- **Resume (D-26):** `resumeMailbox` works in one owner transaction under `app.mailbox_id`. It locks the status row and sets `approved_new_count = held_new_count` only when the state is `needs_attention`.
  - The command prints `Resumed <slug>: the next check processes up to <n> held messages, plus new mail up to the per-cycle limit.`
  - On any other state it prints `Mailbox <slug> is not waiting for a resume (status: <state or never run>).` and exits 0.
- **List (D-75):** the listing now carries the held and approved counts, backfill done/total and a message count, read per mailbox under its `app.mailbox_id`.
  - The STATUS column uses an exhaustive switch with a `never` check.
  - Numbers are formatted as `1,250`.
  - The header is `SLUG  STATUS  MESSAGES  LAST SEEN  LAST SYNC`.
- **Backfill (D-03, D-75):**
  - `backfillMailbox` finds the registry row by slug and the config entry by IMAP identity.
  - It retries `withIngestLock` every 2 s up to `BACKFILL_LOCK_WAIT_MS` (60 s).
  - Inside the lock it rechecks the mailbox is active, opens the pinned connection, then runs `countBackfill`, the count line, `confirm` and `runBackfill(plan)`.
  - The ingested set is exactly `plan.uids`, and `plan.uidValidity` is passed back unchanged.
  - Failures map to fixed owner lines: the worker's `ownerMessageFor` texts, not synced, resyncing, busy, disabled and aborted.
- **CLI:**
  - `--days` must be a whole number from 1 to 365; the default is 3.
  - `--yes` skips the prompt but the count line is still printed.
  - Without `--yes`, the command prints `Ingest them? Type yes to continue:` and reads one stdin line; only `yes` (any case) confirms.
  - SIGINT aborts between chunks.
  - Both new commands are registered in `command.ts`, and `--help` lists them.

## Task Commits

1. **Task 1 (tracer): resume end to end:** `2378935` (feat)
2. **Task 2: list states and counts:** `05df445` (test, RED), `9315058` (feat, GREEN)
3. **Task 3: backfill:** `cc6db6c` (test, RED), `e40d703` (feat, GREEN)

## TDD Gate Compliance

- Task 2 RED: `pnpm vitest run packages/db/test/registry.test.ts apps/worker/test/registry-cli.test.ts`. 3 of 28 tests failed on assertions (missing listing fields, no MESSAGES header). `check tdd-red-evidence` returned RED_EVIDENCE_OK.
- Task 3 RED: `pnpm vitest run apps/worker/test/mailbox-ops.test.ts` against uncommitted scaffolding that returned wrong values, so the run failed on assertions rather than at module load. 21 of 26 tests failed, and the checker returned RED_EVIDENCE_OK. The scaffolding was replaced by the real module before the GREEN commit.
- Each `test(02-16)` commit comes before its `feat(02-16)` commit. No refactor commits were needed.

## Verification

- Tracer gate (end-of-phase mode, automated-only verify): `pnpm vitest run apps/worker/test/mailbox-ops.test.ts apps/worker/test/cli.test.ts` was re-run and passed. Then 9 tests passed.
- Task 2: the registry and registry-cli tests pass (28 tests); typecheck exits 0.
- Task 3: `scripts/test-imap.sh up`; mailbox-ops, cli, mailbox-batch and ingest-e2e pass (30 + 31 tests); `pnpm lint` and `pnpm typecheck` exit 0.
- Acceptance checks:
  - `--help` lists `sift mailbox resume <slug>` once and `sift mailbox backfill <slug> [--days <n>] [--yes]` once.
  - `grep -ci purge` on the `--help` output prints 0.
  - The greps for `export async function resumeMailbox`, `BACKFILL_LOCK_WAIT_MS = 60_000`, `countBackfill`, `needs attention:`, `backfilling` and `'connecting'` all match.
- Full `pnpm test`: 865 of 868 passed. The 3 failures were 30 s timeouts in bridge-probe, imap-folder-source and imap-pin. None of those files was changed in this plan, and each passed when rerun alone (34, 20 and 10 tests). This is the known load from the owner's Bridge syncing on the same Docker host (bug-151), not a regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported four helpers from mailbox-batch.ts**
- **Found during:** Task 3
- **Issue:** the backfill needs the worker's registry-to-config lookup, IMAP-origin error tracking, dropped-connection classification and coded-error root. All four were module-private, and mailbox-batch.ts is not in the plan's file list.
- **Fix:** exported `configEntryFor`, `trackedSource`, `ingestKind` and `storedError` unchanged, instead of copying them.
- **Files modified:** apps/worker/src/runtime/mailbox-batch.ts
- **Commit:** e40d703

**2. [Rule 1 - Bug] Test slug clash in mailbox-ops.test.ts**
- **Found during:** Task 3 RED
- **Issue:** the resume tests had already registered `personal` in the file's database, so the backfill block's `seedImapMailbox('personal')` failed in its beforeAll and three tests were reported as skipped.
- **Fix:** the backfill describe uses its own fresh database. Logged as bug-158.
- **Files modified:** apps/worker/test/mailbox-ops.test.ts
- **Commit:** cc6db6c

**Total deviations:** 2 auto-fixed (1 blocking, 1 test bug). **Impact:** no behaviour change for the worker; the exports are additive.

## Known Stubs

None.

## Issues Encountered

- Full-suite IMAP timeouts under host load (bug-151), described under Verification. They passed when each file was rerun alone.

## Next Phase Readiness

- Ready for 02-17 and 02-19. 02-19 can use `sift mailbox list` to watch the owner's mailbox: connecting, backfill progress, holds and message counts. It can use `sift mailbox resume` if a surge is held.

## Self-Check: PASSED

- Created files exist: mailbox-resume.ts, mailbox-backfill.ts, mailbox-ops.test.ts
- Commits exist: 2378935, 05df445, 9315058, cc6db6c, e40d703
