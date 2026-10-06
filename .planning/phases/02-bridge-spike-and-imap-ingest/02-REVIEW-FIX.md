---
phase: 02-bridge-spike-and-imap-ingest
fixed_at: 2026-10-06T21:20:00Z
review_path: .planning/phases/02-bridge-spike-and-imap-ingest/02-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-10-06T21:20:00Z
**Source review:** .planning/phases/02-bridge-spike-and-imap-ingest/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (CR-01, CR-02, WR-01..WR-06; IN-* left alone as instructed)
- Fixed: 8
- Skipped: 0

Every fix has a new or extended test. For each test, a run against the pre-fix source failed (RED) and the fixed source passed, except as noted: the CR-02 Go tests and the WR-04 two-header test were checked by inspection only.

## Fixed Issues

### CR-01: Resync and removal break on folders with more than 65,535 live locations

**Files modified:** `packages/db/src/scope.ts`, `packages/db/test/scope.test.ts`, `packages/db/test/ingest.test.ts`
**Commit:** 9d1daa6
**Applied fix:**
- The scoped API's array match no longer uses `inArray`. It now emits `column = any($1)`, binding the whole list as one array parameter, and each element goes through the column's own encoder.
- `find`, `update` and `delete` all use `matchConditions`, so this one change covers `markLocationsRemoved`, `deleteOrphanBodies`, `finishResync` and `db-store.markVanished`.
- Tests added:
  - A pg `Client.query` spy shows that `find`, `update` and `delete` with 70,001 ids each send one array value.
  - A real-DB `finishResync` over 70,000 live locations settles the folder: 1 superseded, 69,999 vanished.
  - Against the old code, both tests failed with `bind message has 4466 parameter formats but 0 parameters` (08P01).

### CR-02: `.env.mailboxes` receives the IMAP password but is never forced to mode 0600 (D-39)

**Files modified:** `bridge/helper/envfile.go`, `bridge/helper/envfile_test.go`, `bridge/entrypoint.sh`, `README.md`, `CONTRIBUTING.md`, `.env.mailboxes.example`, `.env.example`, `apps/worker/test/user-facing-text.test.ts`, `apps/worker/test/compose.test.ts`
**Commit:** ecdcdc8
**Applied fix:**
- `WriteMailboxPasswords` now chmods the env file to 0600 after the verified backup and before the in-place write. The chmod is a new `chmodFile` test hook, which `BackupInPlace` also uses.
  - `chmod` keeps the inode and owner, so D-81's no-rename, in-place write is unchanged.
  - If the chmod fails, nothing is written. The helper exits 2 with "cannot set .env.mailboxes to mode 0600; nothing was written. On the host: chmod 600 .env.mailboxes".
- The setup instructions now create the file with `cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes`:
  - README quick start step 4, CONTRIBUTING, the `.env.mailboxes.example` header and the `.env.example` note.
  - The helper's and the entrypoint's "create first" hint.
- Go tests:
  - A 0644 env file ends at 0600 with the same inode.
  - A refused chmod never opens the env file.
- The doc tests pin the new command.
- `go test` passed inside `docker compose build bridge`.

### WR-01: The privacy fallback returns Drizzle's "Failed query ... params:" wrapper when no coded cause exists

**Files modified:** `packages/core/src/log.ts`, `packages/core/test/log.test.ts`, `apps/worker/src/runtime/mailbox-batch.ts`, `apps/worker/src/runtime/supervisor.ts`, `apps/worker/src/commands/worker.ts`, `apps/worker/test/mailbox-batch.test.ts`, `apps/worker/test/supervisor.test.ts`
**Commit:** 5a807c8
**Applied fix:**
- One shared `codedCause` (and `QueryFailedError`) now lives in `@sift/core/log`. It returns the first coded error in the cause chain.
- When there is no coded cause and the top-level error is a query wrapper, it returns fixed text naming only the innermost error's class: "database query failed without an error code (TypeError)".
- The wrapper is recognised by shape: a `Failed query:` prefix, or `query` plus `params` fields. Apps may not import drizzle-orm, so `instanceof` is not available.
- Callers switched to it:
  - `storedError`, which covers `mailbox_status.last_error` and the CLI backfill output;
  - the supervisor's log summary;
  - `worker.databaseCause`.
- `owner/migrate.ts` was left alone (IN-01 territory). Migration params are empty, so there is nothing to leak there.
- Tests: unit tests for `codedCause`, a DB test showing `last_error` gets the fixed text, and a supervisor stall-log test.

### WR-02: CLI backfill waits for the owner while holding the IMAP connection and the ingest lock

**Files modified:** `apps/worker/src/commands/mailbox-backfill.ts`, `apps/worker/test/mailbox-ops.test.ts`
**Commit:** 9bc7e5f
**Applied fix:**
- `backfillMailbox` now runs the count and the ingest as two separate lock sessions. Each session:
  - retries the lock for `lockWaitMs`;
  - re-checks that the mailbox is active;
  - opens its own fresh pinned IMAP connection.
- Nothing is held while the owner reads the prompt.
- This is safe because `runBackfill` already re-examines the folder and refuses a changed UIDVALIDITY. Counted UIDs that the worker stores in between merge by identity (D-14). The backfill still ingests exactly the counted UIDs.
- Tests:
  - New: during `confirm`, a second `withIngestLock` acquires the lock and no IMAP client is usable. Two connections are opened in total. This test failed on the old code.
  - Changed: the "aborted at the prompt" test now expects "stopped before it started; nothing changed". That message is accurate, since nothing is stored. The engine test still covers an abort between chunks.

### WR-03: The INTERNALDATE watermark has no upper bound

**Files modified:** `apps/worker/src/ingest/run.ts`, `apps/worker/test/ingest-engine.test.ts`, `apps/worker/test/ingest-resync.test.ts`
**Commit:** 2a7c63c
**Status:** fixed: requires human verification (logic change)
**Applied fix:**
- A new `clockCap` helper caps INTERNALDATEs at `deps.now()` before they reach the watermark. It applies in three places:
  - the newest date at first sync;
  - eligible records while polling;
  - new mail during a resync.
- The cycle-start watermark is capped too, so a future watermark already stored by the old code is read as "now".
- One `warn` per cycle reports the count, the latest INTERNALDATE and the time "now" (timestamps only).
- The cap is "now" rather than "now + 10 min" as the review suggested. With the 5-minute overlap (D-19), a ceiling of now + 10 min would still make mail arriving in the next 5 minutes historical.
- The D-83 first-sync floor is unchanged.
- Tests (all three failed on the old code):
  - a future-dated poll is capped and later mail is still eligible;
  - a future newest date at first sync is capped;
  - the watermark after a resync is capped.

### WR-04: `trustPmHeader` is always true, and the first of several X-Pm-Internal-Id values is trusted

**Files modified:** `apps/worker/src/ingest/message.ts`, `apps/worker/src/runtime/mailbox-batch.ts`, `apps/worker/src/commands/mailbox-backfill.ts`, `apps/worker/test/ingest-identity.test.ts`, `apps/worker/test/mailbox-batch.test.ts`
**Commit:** 9255831
**Status:** fixed: requires human verification (trust rule)
**Applied fix:**
- A new `trustsPmHeader(entry)` returns `entry.imap.tls.pin_sha256 !== undefined`, and the worker and the CLI backfill both use it.
  - This follows the review's first option. It adds no config key, so no locked D-74 schema decision changes.
- `parseMessage` uses `X-Pm-Internal-Id` only when exactly one value is present.
- Tests:
  - a pinned mailbox is trusted and an unpinned one is not;
  - with two `X-Pm-Internal-Id` values, the message falls back to `mid:`.
- For the human to check:
  - **Unpinned mailboxes change key.** They previously keyed messages with this header as `pm:` and will now key new ones as `mid:`. Today only the owner's Bridge mailbox exists, and it is pinned, so its keys are unchanged.
  - **Some non-Bridge servers still get trust.** A server with a pinned self-signed certificate (not Bridge) would still be trusted. An explicit `imap.server: proton_bridge` key would need an owner decision, because config keys are a one-way decision (D-74).

### WR-05: An expired pinned certificate is reported as a "pin mismatch", while `sift bridge trust` reports "It matches"

**Files modified:** `apps/worker/src/imap/connect.ts`, `apps/worker/src/imap/capture.ts`, `apps/worker/src/runtime/mailbox-batch.ts`, `apps/worker/src/commands/bridge-trust.ts`, `apps/worker/test/imap-connect.test.ts`, `apps/worker/test/mailbox-batch.test.ts`, `apps/worker/test/bridge-trust.test.ts`
**Commit:** df25a93
**Applied fix:**
- `CERT_HAS_EXPIRED` and `CERT_NOT_YET_VALID` are now their own class, `cert_expired`. The owner message says the certificate is outside its validity dates, so it is refused even if it matches the pin, and asks the owner to check the clock and run `sift bridge trust <slug>`.
- `CapturedCertificate` gains `validFrom`. When the certificate is outside its dates, `sift bridge trust` prints both dates and exits 1, whether or not the fingerprint matches, and offers no pin to paste.
- The message makes no claim about how Bridge renews its certificate, because that was not verified.
- Tests:
  - classification of both codes;
  - the owner message;
  - `bridge trust` with a faked `Date` one year ahead.

### WR-06: First-backfill progress in `mailbox_status` is never cleared when a resync drops the backfill

**Files modified:** `apps/worker/src/ingest/run.ts`, `apps/worker/test/ingest-resync.test.ts`
**Commit:** c7a580c
**Applied fix:**
- After `finishResync` commits, a resync that touched a pending first backfill reports progress through the existing `onBackfillProgress` callback. In the worker, that callback writes `mailbox_status` through `recordBackfillProgress`. It reports:
  - `{ finished: true }` when the backfill was dropped, which clears the columns;
  - `{ done: 0, total: <new total> }` when the backfill restarted.
- Tests (both failed on the old code):
  - progress resets to the restarted window, and only after `finishResync` ends;
  - progress is cleared when the window has no message under the new UIDVALIDITY.

## Notes for the verifier

- **Plan wording changed by WR-02:** 02-16-PLAN's must-have said "the ingest lock is held from the count through the ingest". That is a plan-level design point, not a locked D-xx decision. Its intent still holds:
  - the worker and the CLI never ingest at the same time (D-03);
  - exactly the counted UIDs are ingested;
  - mail stored meanwhile merges by identity rather than duplicating.
- **Where verification ran:** in the main checkout `/Users/samuel/dev/sift`, on branch `main`. No worktree was used, because the orchestrator pinned the root to the main checkout and the test database and Dovecot server run there.
  - `pnpm typecheck`: exit 0.
  - `pnpm lint`: exit 0. It reports 1 warning, which was already there.
  - `pnpm test`: 923 of 934 tests passed. The 11 failures were all 30 s or 60 s timeouts under load (bug-151/162 class), in six files: bridge-probe, compose-smoke, imap-capture, imap-folder-source, imap-pin and ingest-e2e.
  - Each of those six files passes when rerun alone: 34/34, 33/33, 11/11, 20/20, 10/10 and 7/7.
  - Go helper tests: `go test ./cmd/sift-helper/...` passed inside `docker compose build bridge`. The running bridge container was not restarted.

---

_Fixed: 2026-10-06T21:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
