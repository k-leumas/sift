---
phase: 02-bridge-spike-and-imap-ingest
reviewed: 2026-10-07T06:41:25Z
depth: deep
files_reviewed: 36
files_reviewed_list:
  - .env.example
  - .env.mailboxes.example
  - .github/workflows/ci.yml
  - apps/worker/src/commands/bridge-trust.ts
  - apps/worker/src/commands/mailbox-backfill.ts
  - apps/worker/src/commands/worker.ts
  - apps/worker/src/imap/capture.ts
  - apps/worker/src/imap/connect.ts
  - apps/worker/src/ingest/message.ts
  - apps/worker/src/ingest/run.ts
  - apps/worker/src/runtime/mailbox-batch.ts
  - apps/worker/src/runtime/supervisor.ts
  - apps/worker/test/bridge-trust.test.ts
  - apps/worker/test/compose-smoke.test.ts
  - apps/worker/test/compose.test.ts
  - apps/worker/test/imap-connect.test.ts
  - apps/worker/test/ingest-engine.test.ts
  - apps/worker/test/ingest-identity.test.ts
  - apps/worker/test/ingest-resync.test.ts
  - apps/worker/test/live-ingest-record.test.ts
  - apps/worker/test/mailbox-batch.test.ts
  - apps/worker/test/mailbox-ops.test.ts
  - apps/worker/test/spike-findings.test.ts
  - apps/worker/test/supervisor.test.ts
  - apps/worker/test/user-facing-text.test.ts
  - bridge/entrypoint.sh
  - bridge/helper/envfile_test.go
  - bridge/helper/envfile.go
  - CONTRIBUTING.md
  - packages/core/src/log.ts
  - packages/core/test/log.test.ts
  - packages/db/src/scope.ts
  - packages/db/test/ingest.test.ts
  - packages/db/test/scope.test.ts
  - README.md
  - scripts/compose-smoke.sh
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 02: Code Review Report (incremental, after review fixes and UAT gap closure)

**Reviewed:** 2026-10-07T06:41:25Z
**Depth:** deep
**Files Reviewed:** 36
**Status:** issues_found

## Summary

This is an incremental review of everything that changed since `3ab4be9`:

- the eight fixes from the first review: CR-01, CR-02 and WR-01 to WR-06;
- the 02-20 changes: Proton-only README scope, the NTP requirement and the spike-value pin;
- the 02-21 compose-smoke status check (G-02-14);
- the Dependabot bump of `pnpm/action-setup`.

Full files were read for cross-file context. I traced these call chains:

- `codedCause` through supervisor, `storedError` → `recordSyncError`, the CLI backfill and `worker.ts`;
- `anyOf` through `matchConditions` → `find`/`update`/`delete` → `finishResync`/`markVanished`;
- `clockCap` against `advanceFolderSync`/`finishResync` in `packages/db/src/ingest.ts`;
- the WR-06 progress callback into `recordBackfillProgress`;
- the WR-02 two-session backfill through `withIngestLock`;
- the CR-02 chmod against the bridge-init uid model (the helper runs as root).

**What holds up:**

- **CR-01:** `= any($1)` binds one array parameter, and each element goes through the column encoder.
- **CR-02:** the chmod runs as root before any secret is written, and the inode is preserved.
- **WR-01:** the shared `codedCause` never returns a query wrapper.
- **WR-02:** the CLI backfill holds neither the lock nor an IMAP connection during the prompt, and the second session re-checks UIDVALIDITY.
- **WR-04:** the pin-based trust and the single-value rule are correct.
- **WR-05:** expiry is its own class.
- **WR-06:** progress is reset after the commit.

No new critical issues.

**What is wrong:**

- **WR-01 (below):** the WR-03 fix does not heal a watermark that is already stored in the future. `advanceFolderSync` only moves forward, so the stored value stays in place. Every cycle then substitutes "now at cycle start", which turns any mail older than the 5-minute overlap at poll time into historical rows.
- **WR-02 (below):** the new compose-smoke status check passes without the current worker doing anything when the smoke volume is reused. That is the documented local invocation (no `--down`).
- **Info:** a misleading `cert_expired` message for unpinned mailboxes, skipped cap warnings on early returns, a narrow path where WR-06's progress reset is lost, leftover duplicate cause helpers, and a lost command-level test.

The earlier IN-02, IN-03 and IN-04 are untouched by this diff and stay open (see 02-REVIEW-DISPOSITION.md). They are not repeated here.

No structural (fallow) findings were provided, so that section is omitted.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: A watermark already stored in the future is never lowered, so "read as now" makes delayed mail historical on every cycle

**File:** `apps/worker/src/ingest/run.ts:297-299`, `apps/worker/src/ingest/run.ts:313-327`, `packages/db/src/ingest.ts:341-346`

**Issue:** The WR-03 fix comment says: "A watermark stored ahead of the clock (before WR-03) is read as now." In `pollNewMail`, `startWatermark = clock.cap(state.watermark)`. The chunk commit then sends `watermark = max(startWatermark, capped dates)`, which is at most now.

`advanceFolderSync` ignores any watermark lower than the stored one (`to.internalDateWatermark.getTime() > row.internalDateWatermark.getTime()`). The stored future value therefore stays until real time passes it, which can be days for the exact case WR-03 targeted. Only a resync (`finishResync` overwrites the column) clears it.

While it stays, each cycle's candidate-new gate is `internalDate > (cycle-start now) - 5 min` instead of "after the last eligible INTERNALDATE". Any mail that reached the server more than 5 minutes before the cycle that sees it becomes a historical row: no body, never classified. Such delays happen with:

- `poll_interval_seconds` above 300 (allowed up to 3600);
- a worker restart;
- Bridge being down;
- error backoff (D-51);
- the lock held by a CLI backfill;
- a volume hold.

This is the silent D-18 failure WR-03 set out to remove, only narrowed. The cap also re-logs `INTERNALDATE ahead of the worker clock` on every cycle that has new mail, with the stale watermark as `latestInternalDate`.

No test covers this branch: every WR-03 test starts from a watermark at or before `NOW`, and the fake store is also forward-only (`fake-ingest-store.ts:358-361`).

**Fix:** Write the capped value back once, when the stored watermark is ahead of the clock. Options:

- a store call that may lower the watermark;
- an explicit `resetWatermark` flag in the commit's advance;
- a one-off correction in `getFolder`/`createDbStore`.

For example:

```ts
// pollNewMail, before computing newUids
const startWatermark = clock.cap(state.watermark);
if (startWatermark.getTime() < state.watermark.getTime()) {
  // Legacy future watermark (pre-WR-03): lower it once so later cycles gate on
  // the last eligible INTERNALDATE again, not on "now at cycle start".
  await deps.store.lowerWatermark(state.folder, startWatermark);
}
```

`packages/db/src/ingest.ts` would gain `lowerFolderWatermark(scope, folder, to)`, which sets `internal_date_watermark = least(internal_date_watermark, $to)`. Alternatively, ship a migration that does the same per mailbox inside a `set_config` loop (FORCE RLS). Add an engine test that starts from a watermark two days ahead, polls with a gap longer than the overlap, and expects the delayed mail to be eligible.

### WR-02: The compose-smoke status check passes on stale rows when the smoke volume is reused

**File:** `scripts/compose-smoke.sh:265-284` (documented invocation: `CONTRIBUTING.md:100`)

**Issue:** The new wait succeeds as soon as every enabled mailbox has a `mailbox_status` row in `connecting` or `error`. It has no lower bound on when that row was written.

The smoke database volume `<project>-pgdata-smoke` is removed only with `--down`, and the documented local command (`COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh`) does not pass `--down`. On every rerun, the rows from the previous run are therefore already `error`. `recordMailboxSeen` only upserts `last_seen_at` and leaves `state` alone, so the check passes on its first query, before the new worker has run a single batch.

A worker whose loop never reaches a mailbox would pass, for example:

- a regression in `runBatch`;
- a supervisor that never schedules;
- a crash right after the heartbeat.

G-02-14 was meant to catch exactly that. CI uses `--down`, so CI is not affected; local reruns are.

**Fix:** Require a row written by this run. `last_seen_at` is set by both `recordConnecting` and `recordSyncError`, so compare it with the worker container's start time:

```bash
started=$(docker inspect -f '{{.State.StartedAt}}' "$(container worker)")
no_status_sql="select count(*) from mailbox m where m.disabled_at is null
  and not exists (select 1 from mailbox_status s
    where s.mailbox_id = m.id and s.state in ('connecting', 'error')
      and s.last_seen_at >= '$started'::timestamptz)"
```

Extend `compose-smoke.test.ts` so that the shim answers `StartedAt` and the test asserts that the status query carries the bound.

## Info

### IN-01: The `cert_expired` owner message speaks of the pin and `sift bridge trust` even for unpinned mailboxes

**File:** `apps/worker/src/runtime/mailbox-batch.ts:87-88`

**Issue:** Unlike `cert_untrusted`, the new case ignores `ctx.pinned`. For an unpinned mailbox (still accepted by the schema), an expired public-CA certificate produces "...refuses it even if it matches imap.tls.pin_sha256...run sift bridge trust". That points the owner at a pin they never set. The owner has stated they never want a misleading error.

**Fix:** Branch on `ctx.pinned` as `cert_untrusted` does. The unpinned text should drop the pin clause and keep "check this machine's clock".

### IN-02: The clock-cap warning is skipped on early returns

**File:** `apps/worker/src/ingest/run.ts:305-311`, `run.ts:318`, `run.ts:458`, `run.ts:465-471`, `run.ts:479`, `run.ts:501`, `run.ts:527`

**Issue:** `clock.report()` runs only on the success paths. A cycle that capped the start watermark or some records, then returned `needs_attention` or `aborted`, logs nothing. That includes a resync over the cap, which can repeat every cycle while a hold lasts. The "counts and timestamps are logged" guarantee therefore has holes exactly in the cycles that end abnormally.

**Fix:** Call `clock.report()` in a `try/finally` around each function body, or before each early `return`.

### IN-03: If the WR-06 progress write fails, a dropped backfill's progress is never cleared

**File:** `apps/worker/src/ingest/run.ts:536-548`

**Issue:** `onBackfillProgress` runs after `finishResync` has committed. If that write fails (a pg error on the session), `runIngest` throws, and two things follow:

- **The resync log line is lost.** The D-25 "exactly one resync line" (`deps.log.info(... formatResyncLine ...)`) is never emitted for a resync that did commit.
- **Stale progress stays forever** in the `backfill: null` case. The next cycle finds `state.backfill === null` and never reports progress again, so the stale `backfill_done/total` that WR-06 fixed can come back.

**Fix:** Log the resync line before the progress callback. In `mailbox-batch.ts`, on a `synced` outcome with `backfill === null`, clear any leftover progress columns (an idempotent `recordBackfillProgress({ finished: true })` when the status still has them).

### IN-04: The cause-chain helper is still duplicated, plus a no-op alias

**File:** `apps/worker/src/commands/worker.ts:42-54`, `packages/db/src/owner/migrate.ts:77-88`

**Issue:**

- `databaseCause` is now just `return codedCause(error)`.
- `sqlStateOf` is named for SQLSTATE but returns any string code, for example `ECONNRESET`.
- `migrationFailure` in `migrate.ts` is still a fourth copy of the walk, without the wrapper guard. That is the earlier IN-01 only partly done. Today it is safe only because migration params are empty.

**Fix:**

- Inline `codedCause` at the call site.
- Rename `sqlStateOf` to `codeOf`.
- Build `migrationFailure` on `codedCause` (wrap the result in `MigrationFailedError` when it is coded).

### IN-05: The CLI "stopped between chunks" path lost its command-level test

**File:** `apps/worker/test/mailbox-ops.test.ts:513-531`, `apps/worker/src/commands/mailbox-backfill.ts:223-225`

**Issue:** The old abort test was rewritten to abort at the prompt. Nothing now drives `backfillMailbox` to an `aborted` outcome from `runBackfill`. The exit code 1 and the "run it again to finish" text are therefore untested at the command level, and the engine test does not cover them.

**Fix:** Add a test that aborts the signal from inside a wrapped `openImap` used in the second session, or after the first `commitChunk`. Assert exit 1 and the between-chunks message.

**Also:**

- The reflowed doc comment at `apps/worker/src/commands/bridge-trust.ts:55` is 131 characters long.
- The compose-smoke comment "only the state at the deadline counts" (`scripts/compose-smoke.sh:270`) does not match the loop, which passes at the first all-good poll.

---

_Reviewed: 2026-10-07T06:41:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
