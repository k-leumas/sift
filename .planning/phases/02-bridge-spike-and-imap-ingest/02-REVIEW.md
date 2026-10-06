---
phase: 02-bridge-spike-and-imap-ingest
reviewed: 2026-10-06T20:04:02Z
depth: standard
files_reviewed: 99
files_reviewed_list:
  - .env.example
  - .github/workflows/bridge-image.yml
  - .github/workflows/ci.yml
  - apps/worker/package.json
  - apps/worker/src/cli.ts
  - apps/worker/src/command.ts
  - apps/worker/src/commands/bridge-probe.ts
  - apps/worker/src/commands/bridge-trust.ts
  - apps/worker/src/commands/mailbox-backfill.ts
  - apps/worker/src/commands/mailbox-list.ts
  - apps/worker/src/commands/mailbox-resume.ts
  - apps/worker/src/commands/worker.ts
  - apps/worker/src/imap/capture.ts
  - apps/worker/src/imap/connect.ts
  - apps/worker/src/imap/folder-source.ts
  - apps/worker/src/imap/pin.ts
  - apps/worker/src/ingest/db-store.ts
  - apps/worker/src/ingest/identity.ts
  - apps/worker/src/ingest/message.ts
  - apps/worker/src/ingest/plan.ts
  - apps/worker/src/ingest/run.ts
  - apps/worker/src/ingest/types.ts
  - apps/worker/src/runtime/mailbox-batch.ts
  - apps/worker/src/runtime/supervisor.ts
  - apps/worker/src/spike/probe.ts
  - apps/worker/test/bridge-image.test.ts
  - apps/worker/test/bridge-probe.test.ts
  - apps/worker/test/bridge-trust.test.ts
  - apps/worker/test/ci-workflow.test.ts
  - apps/worker/test/cli.test.ts
  - apps/worker/test/compose-smoke.test.ts
  - apps/worker/test/compose.test.ts
  - apps/worker/test/dependencies.test.ts
  - apps/worker/test/imap-capture.test.ts
  - apps/worker/test/imap-connect.test.ts
  - apps/worker/test/imap-folder-source.test.ts
  - apps/worker/test/imap-pin.test.ts
  - apps/worker/test/ingest-e2e.test.ts
  - apps/worker/test/ingest-engine.test.ts
  - apps/worker/test/ingest-identity.test.ts
  - apps/worker/test/ingest-message.test.ts
  - apps/worker/test/ingest-resync.test.ts
  - apps/worker/test/live-ingest-record.test.ts
  - apps/worker/test/mailbox-batch.test.ts
  - apps/worker/test/mailbox-ops.test.ts
  - apps/worker/test/no-secret-leak.test.ts
  - apps/worker/test/registry-cli.test.ts
  - apps/worker/test/setup.test.ts
  - apps/worker/test/spike-findings.test.ts
  - apps/worker/test/supervisor.test.ts
  - apps/worker/test/support/fake-folder-source.ts
  - apps/worker/test/support/fake-imap-server.ts
  - apps/worker/test/support/fake-ingest-store.ts
  - apps/worker/test/support/mailbox-harness.ts
  - apps/worker/test/support/privacy-scan.ts
  - apps/worker/test/support/test-imap.ts
  - apps/worker/test/user-facing-text.test.ts
  - apps/worker/test/worker.test.ts
  - bridge/Dockerfile
  - bridge/entrypoint.sh
  - bridge/helper/envfile_test.go
  - bridge/helper/envfile.go
  - bridge/helper/main_test.go
  - bridge/helper/main.go
  - compose.yaml
  - config/config.example.yaml
  - CONTRIBUTING.md
  - docs/adr/0003-traces-and-mail-app-relabels.md
  - packages/core/src/config/index.ts
  - packages/core/src/config/schema.ts
  - packages/core/test/config.test.ts
  - packages/core/test/example-config.test.ts
  - packages/db/migrations/0005_ingest_preflight.sql
  - packages/db/migrations/0006_ingest_tables.sql
  - packages/db/migrations/0007_ingest_tables_force_grants.sql
  - packages/db/src/index.ts
  - packages/db/src/ingest.ts
  - packages/db/src/lock.ts
  - packages/db/src/owner/migrate.ts
  - packages/db/src/owner/registry.ts
  - packages/db/src/schema/index.ts
  - packages/db/src/schema/scoped.ts
  - packages/db/src/scope.ts
  - packages/db/src/status.ts
  - packages/db/test/ingest.test.ts
  - packages/db/test/isolation.test.ts
  - packages/db/test/lock.test.ts
  - packages/db/test/migrate.test.ts
  - packages/db/test/owner-rls.test.ts
  - packages/db/test/registry-plan.test.ts
  - packages/db/test/registry.test.ts
  - packages/db/test/scope.test.ts
  - packages/db/test/status.test.ts
  - packages/db/test/support/seed.ts
  - README.md
  - renovate.json
  - scripts/bridge-smoke.sh
  - scripts/compose-smoke.sh
  - scripts/test-imap.sh
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-10-06T20:04:02Z
**Depth:** standard (configured deep; downgraded because the scope is over 50 files)
**Files Reviewed:** 99
**Status:** issues_found

## Summary

I read every file in scope. The most attention went to the security- and correctness-critical paths:

- the IMAP TLS stack: `capture.ts`, `connect.ts` and `pin.ts`;
- the sync engine: `run.ts`, `plan.ts` and `message.ts`/`identity.ts`;
- the database ingest use-cases, the scoped API, the ingest lock and the status helpers: `packages/db/src/ingest.ts`, `scope.ts`, `lock.ts` and `status.ts`;
- the worker and CLI wiring: `mailbox-batch.ts`, `mailbox-backfill.ts` and `supervisor.ts`;
- the Bridge container: `entrypoint.sh`, `helper/main.go` and `helper/envfile.go`;
- Compose and the phase 2 migrations.

Tests were read for reliability only.

**What holds up:**

- The TLS design is sound and fails closed:
  - capture writes only `<tag> STARTTLS` and refuses plaintext pipelined after the tagged OK;
  - the login connection trusts only the captured certificate and re-checks the SPKI pin;
  - `guardPlaintext` blocks every pre-TLS command except CAPABILITY and STARTTLS.
- The removal diff cannot mistake a failed SEARCH for "everything vanished".
- Resync stays all-or-nothing through generations.
- Chunk commits and watermark moves share one transaction.
- The advisory lock keeps one connection per mailbox and discards broken connections.

**What is wrong:**

- **Large folders cannot finish a resync.** Every "IN (ids)" helper binds one parameter per id. A folder with more than about 65,535 live locations therefore cannot complete a resync: the generation switch exceeds PostgreSQL's bind-parameter limit on every retry, and the mailbox stays `resyncing` forever (CR-01).
- **The IMAP password file stays world-readable.** Bridge init writes the IMAP password into `.env.mailboxes` without enforcing the 0600 mode that locked decision D-39 requires. The quick start creates that file with `cp`, so it keeps the umask mode, usually 0644 (CR-02).
- **Warnings:**
  - a privacy fallback that would store and log Drizzle's `params:` text, which can hold mail fields;
  - the CLI backfill confirmation prompt, which outlives ImapFlow's 120 s socket timeout and blocks the worker's lock while it waits;
  - an unclamped INTERNALDATE watermark;
  - a `trustPmHeader` guard that is always true;
  - a misleading message when the pinned certificate expires;
  - stale backfill progress after a resync.

No structural (fallow) findings were provided, so that section is omitted.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Resync and removal break on folders with more than 65,535 live locations (PostgreSQL bind-parameter limit)

**File:** `packages/db/src/ingest.ts:408-419`, `packages/db/src/ingest.ts:427-446`, `packages/db/src/ingest.ts:517-538`, `apps/worker/src/ingest/db-store.ts:178-190`, `packages/db/src/scope.ts:204-209`

**Issue:** `matchConditions` turns every array match into `inArray(column, [...value])`, and Drizzle binds one parameter per element. PostgreSQL (and node-postgres's Int16 Bind count) caps a statement at 65,535 parameters.

`finishResync` passes every old-generation live location of the folder to `markLocationsRemoved(...)` in one `UPDATE ... WHERE id IN (...)`. It then passes every gone message to `deleteOrphanBodies`, which runs `find({ messageId: [...] })` and `delete({ messageId: [...] })`.

For an INBOX with more than about 65k stored messages, any UIDVALIDITY change makes `finishResync` fail on every retry. The spike shows that a Bridge repair or cache rebuild changes UIDVALIDITY, so this is a reachable path. The result:

- The folder stays `state = 'resyncing'` forever.
- Polling and the removal diff never run again.
- Phase 4 label application stays paused (D-24).
- The owner sees only a generic error.

`markVanished` (the D-17 diff) has the same limit when an owner archives a very large batch.

This is deterministic for a valid input size, not a flaky failure.

**Fix:** Bind the id list as one array parameter, or batch it. For example, add an array matcher to the scoped API:

```ts
// scope.ts matchConditions: one parameter regardless of length
if (Array.isArray(value)) {
  if (value.length === 0) empty = true;
  else conditions.push(sql`${column} = any(${[...value]})`); // pg sends a single array param
}
```

Alternatively, chunk the calls in `markLocationsRemoved`, `deleteOrphanBodies` and `db-store.markVanished` into slices of at most 10,000 ids, all inside the same transaction. Add a DB test that resyncs a folder with 70,000 live locations.

### CR-02: `.env.mailboxes` receives the IMAP password but is never forced to mode 0600 (D-39)

**File:** `bridge/helper/envfile.go:217-243` (also `envfile.go:161-186`, `README.md:426`)

**Issue:** D-39 requires that bridge-init "creates/keeps the file at mode 0600".

`BackupInPlace` sets `.env.mailboxes.bak` to 0600 before writing (line 196). `WriteMailboxPasswords` writes the live file with `WriteInPlace`, which by design keeps the host mode, and never checks or sets it.

The README quick start creates the file with `cp .env.mailboxes.example .env.mailboxes` (step 4) and never runs `chmod 600`. Under the usual 022 umask the file is therefore 0644. Every local account can then read the Bridge IMAP password, and with it the whole mailbox. The backup that holds the same secret is locked down, but the primary file is not.

**Fix:** Chmod the env file before writing the secret, as the backup already does, and document the step:

```go
// WriteMailboxPasswords, after the backup succeeded and before WriteInPlace(envPath, next):
if err := os.Chmod(envPath, 0o600); err != nil {
    return &ExitError{Code: exitEnvFile, Msg: "cannot set .env.mailboxes to mode 0600; nothing was written"}
}
```

Also change README step 4 to `cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes`. Optionally, have the worker warn at startup when `env_file` permissions are wider than 0600. It cannot see the host file, so this belongs in a host-side check such as `scripts/` or `sift setup` docs.

## Warnings

### WR-01: The privacy fallback returns Drizzle's "Failed query ... params:" wrapper when no coded cause exists

**File:** `apps/worker/src/runtime/mailbox-batch.ts:197-204`, `apps/worker/src/runtime/supervisor.ts:113-130`, `apps/worker/src/commands/mailbox-backfill.ts:224-227`

**Issue:** `storedError` and `codedCause` walk the cause chain for an error with a string `code` and otherwise fall back to the top-level error. For a `DrizzleQueryError`, that top-level message is `Failed query: insert into "message" ... params: <identity key>,<subject>,<from address>,<headers json>,...`.

That text is stored in `mailbox_status.last_error` (only password values are redacted), logged by the supervisor's `describeError` (`summary.message = redact(error.message)`), and printed by the CLI backfill. The privacy rule is no mail content in logs, errors or `last_error` (T-02-37/T-02-43).

The leak is not reached today only by accident:

- A connection that dies mid-statement makes Drizzle's `rollback` fail too, and the rollback's own wrapper (empty params) propagates instead.
- Every server-side error has a SQLSTATE.

Any codeless client-side failure where the rollback succeeds would expose the params, for example a pg value-serialisation `TypeError` or a future driver change. The only test (`mailbox-batch.test.ts:424-440`) covers a coded cause.

**Fix:** Never fall back to a wrapper's message. Check for `DrizzleQueryError` (`import { DrizzleQueryError } from 'drizzle-orm'`) or a `query`/`params` property, and substitute fixed text:

```ts
export function storedError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (typeof (current as { code?: unknown }).code === 'string') return current;
    current = current.cause;
  }
  return error instanceof DrizzleQueryError || (error as { params?: unknown })?.params !== undefined
    ? new Error('database query failed (no SQLSTATE); see the worker log for the error name')
    : error;
}
```

Use the same helper in `supervisor.codedCause`, `worker.databaseCause` and `migrate.migrationFailure` (see IN-01). Add a test with a codeless cause.

### WR-02: CLI backfill waits for the owner while holding the IMAP connection and the ingest lock, and ImapFlow drops the idle connection after 120 s

**File:** `apps/worker/src/commands/mailbox-backfill.ts:140-198` (prompt at 169-178), `apps/worker/src/imap/connect.ts:58,146`

**Issue:** `ingest` opens the IMAP client, runs `countBackfill`, and then awaits `deps.confirm(...)`, the interactive "Type yes to continue" prompt, before `runBackfill`. During the prompt:

1. **The connection times out.** The client is idle: no command, no IDLE (`disableAutoIdle: true`) and no mailbox lock. ImapFlow's socket-timeout handler (`socketTimeout: SOCKET_TIMEOUT_MS = 120_000`) therefore takes the error branch and closes the connection. An owner who reads the count and answers after two minutes gets `IMAP server unreachable at bridge:1143` from `runBackfill`'s `examine`, a misleading failure.
2. **The worker is blocked.** The session-level advisory lock (and its pooled connection) is held for as long as the owner leaves the prompt open. The worker logs `ingest busy` every poll and ingests nothing for that mailbox, with no bound.

**Fix:** Split count and run into two lock and IMAP sessions. `runBackfill` already re-examines and refuses a changed UIDVALIDITY, so this is safe:

```ts
const plan = await withLockAndImap((engine) => countBackfill(engine, days)); // closes IMAP, releases lock
deps.stdout(`Found ...`);
if (!(await deps.confirm(plan.count, days))) return 0;
return withLockAndImap((engine) => runBackfill(engine, plan));
```

If the lock must span both steps, at least send a NOOP keepalive while waiting and bound the prompt, for example to 60 s.

### WR-03: The INTERNALDATE watermark has no upper bound, so one future-dated message makes all later mail "historical"

**File:** `apps/worker/src/ingest/run.ts:284-290`, `apps/worker/src/ingest/run.ts:461-462`, `packages/db/src/ingest.ts:342-347`

**Issue:** Polling and resync move the watermark to `laterOf(watermark, r.parsed.internalDate)` for every eligible record, and `advanceFolderSync` only ever moves it forward. Nothing clamps it to the worker's clock.

A single message with an INTERNALDATE in the future fixes the watermark at that future time. This can come from a server clock jump, an imported or APPENDed message with a forward date, or a Bridge/Proton timestamp glitch.

Every later message is then "historical" (`isCandidateNew` false): stored without a body and never eligible for classification until real time passes that date. The failure is silent: counts still look like normal ingest, and nothing in `mailbox_status` shows it. The watermark is the D-18/D-19 core, and this breaks it permanently with no recovery path short of manual SQL.

**Fix:** Clamp the watermark at commit time and log when the clamp applies:

```ts
const ceiling = deps.now().getTime() + FIRST_SYNC_CLOCK_ALLOWANCE_MS;
const capped = (d: Date) => (d.getTime() > ceiling ? new Date(ceiling) : d);
if (r.eligible) watermark = laterOf(watermark, capped(r.parsed.internalDate));
```

Log a `warn` (counts and timestamps only) when a record's INTERNALDATE exceeds the ceiling.

### WR-04: `trustPmHeader` is always true, and the first of several X-Pm-Internal-Id values is trusted

**File:** `apps/worker/src/runtime/mailbox-batch.ts:322`, `apps/worker/src/commands/mailbox-backfill.ts:161`, `apps/worker/src/ingest/message.ts:137`, `packages/core/src/config/schema.ts:139-143`

**Issue:** The comments promise that `pm:` is trusted "only for Bridge mailboxes" (Pitfall 12). The flag is `entry.labels.apply_as === 'proton_labels'`, but `apply_as` is `z.enum(['proton_labels'])`, its only allowed value. The guard is therefore a tautology. Any mailbox, including a non-Bridge host verified by public-CA TLS (no pin), keys messages by a sender-controllable `X-Pm-Internal-Id`.

Because D-14 merges on key conflict, a forged header lets a sender's mail dedupe into an existing row and escape classification. The RESEARCH Pitfall 12 is exactly this case.

Separately, `parseMessage` takes `rawHeaders['x-pm-internal-id']?.[0]`. If a sender-supplied header ever survives beside Bridge's (Bridge prepending versus appending is not verified by the spike), the first value is used without a check that only one exists.

**Fix:** Derive trust from something that actually identifies Bridge, such as `entry.imap.tls.pin_sha256 !== undefined` or an explicit `imap.server: proton_bridge` key. Also refuse `pm:` unless exactly one value is present:

```ts
const pmValues = rawHeaders['x-pm-internal-id'] ?? [];
const pmInternalId = pmValues.length === 1 ? (pmValues[0] ?? null) : null;
```

### WR-05: An expired pinned certificate is reported as a "pin mismatch", while `sift bridge trust` reports "It matches"

**File:** `apps/worker/src/runtime/mailbox-batch.ts:82-85`, `apps/worker/src/imap/connect.ts:211-227`, `apps/worker/src/commands/bridge-trust.ts:112-115`

**Issue:** The pinned login connection uses `ca: [capturedPem]`, so OpenSSL still enforces the certificate's validity dates.

When Bridge's self-signed certificate expires but keeps its key, the handshake fails with `CERT_HAS_EXPIRED`. That code maps to `cert_untrusted`, which with a pin produces the `pinMismatch` text: "certificate ... does not match imap.tls.pin_sha256 ... run sift bridge trust".

`sift bridge trust` then prints "It matches imap.tls.pin_sha256." and exits 0. The owner is left with contradictory guidance and no actionable step. Bridge certificates are short-lived enough for this to happen in practice.

**Fix:** Separate the expiry codes (`CERT_HAS_EXPIRED`, `CERT_NOT_YET_VALID`) into their own class, for example `cert_expired`, with an owner message such as "Bridge's certificate expired on <date>; restart Bridge so it renews it, then re-pin if the fingerprint changed". Make `bridge trust` exit non-zero with the same hint when `validTo` is in the past, even if the fingerprint matches.

### WR-06: First-backfill progress in `mailbox_status` is never cleared when a resync drops the backfill

**File:** `apps/worker/src/ingest/run.ts:469-484`, `apps/worker/src/runtime/mailbox-batch.ts:348-371`, `packages/db/src/status.ts:21-30`

**Issue:** When a UIDVALIDITY resync happens during the first backfill and no message of the window is found under the new UIDVALIDITY (`first === undefined`), `finishResync` clears the folder's backfill columns. Nothing reports `{ finished: true }`, and `recordSyncSuccess` deliberately leaves the progress columns as they are.

`backfill_done`/`backfill_total` stay set forever, and `sift mailbox list` shows "ok, backfilling X of Y" permanently for a backfill that no longer exists.

**Fix:** In `mailbox-batch.ts`, on the `resynced` outcome, reset progress from the folder's new backfill state. For example, have `runIngest` return the backfill state in the `resynced` outcome and call `recordBackfillProgress(scope, { done: 0, total, finished: total === undefined })`. Alternatively, clear the progress columns in the same transaction as `finishResync` when `backfill` is null.

## Info

### IN-01: Four copies of the "first coded cause" helper

**File:** `apps/worker/src/runtime/supervisor.ts:113-120`, `apps/worker/src/runtime/mailbox-batch.ts:197-204`, `apps/worker/src/commands/worker.ts:52-59`, `packages/db/src/owner/migrate.ts:78-88`

**Issue:** The same cause-chain walk is implemented four times with slightly different fallbacks. That is how the WR-01 fallback went unnoticed.

**Fix:** Move one implementation, including the fixed-text fallback for query wrappers, into `@sift/core/log` or `@sift/db`, and use it everywhere.

### IN-02: A missing UIDNEXT turns into NaN UIDs

**File:** `apps/worker/src/imap/folder-source.ts:213-215`, `apps/worker/src/ingest/run.ts:201,233`

**Issue:** `examine` returns `uidNext: mailbox.uidNext` unchecked. If a server omits UIDNEXT, ImapFlow leaves it undefined. `firstSync` then computes `lastUid: NaN` and filters out the whole backfill window (`uid <= NaN`), and the folder_sync insert fails with a generic database error.

**Fix:** Validate in `examine`: `if (!Number.isInteger(mailbox.uidNext) || mailbox.uidNext < 1) throw new Error('FolderSource.examine: server sent no UIDNEXT')`. That classifies as `protocol` with a clear owner message.

### IN-03: A volume-valve hold also pauses the first backfill

**File:** `apps/worker/src/runtime/mailbox-batch.ts:293-296`, `apps/worker/src/ingest/run.ts:266-273,529-536`

**Issue:** D-75 says the first backfill "is not stopped by `ingest.new_mail_cap`". While a hold awaits `sift mailbox resume`, though, `runBatch` returns before connecting, and `pollNewMail`'s `needs_attention` return happens before `backfillSlice`. The first backfill therefore stops for as long as the hold lasts.

**Fix:** Either document that a hold pauses everything, or run the backfill slice before returning `needs_attention`. It touches only UIDs at or below `untilUid`, never held new mail.

### IN-04: The valve counts mail already stored by a CLI backfill as new

**File:** `apps/worker/src/ingest/run.ts:260-273`, `apps/worker/src/ingest/run.ts:601-608`

**Issue:** `countBackfill` selects every UID since the cut-off, including UIDs above `last_uid` that polling has not seen yet. `runBackfill` stores them without moving `last_uid`. The next poll counts them again by date alone (no identity dedup before the cap), so a large CLI backfill can trigger a hold for mail the owner just ingested.

**Fix:** Limit the CLI backfill to `uid <= state.lastUid`, since new mail belongs to polling. Alternatively, subtract known identities before applying the cap.

---

_Reviewed: 2026-10-06T20:04:02Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
