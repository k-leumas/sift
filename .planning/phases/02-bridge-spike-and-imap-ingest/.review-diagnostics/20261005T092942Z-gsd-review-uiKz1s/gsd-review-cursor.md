## 02-01

**Summary**

The Bridge image and Compose split are specified tightly enough to implement: pinned tag plus commit, a fail-closed keychain, loopback publishing, and a one-shot `bridge-init` that is the only service allowed to see `.env.mailboxes`. The runtime health check does not observe the path other containers actually use, and a background `socat` can die without failing the container.

**Strengths**

- The long-running `bridge` service is limited to `sift-bridge:/data`, and the passphrase is not given to the worker. That matches the current Compose rule that each service receives only the secrets it needs (`compose.yaml:8-10`, `compose.yaml:80-93`).
- Publishing follows the existing loopback pattern (`compose.yaml:40-42`) instead of a wildcard bind.
- `bridge-init` is on the `tools` profile, so `docker compose up` does not start login. The long-syntax backup bind is there because a rename onto a single-file mount fails, which the plan records from a Compose v2.2.3 probe.
- Static tests are aimed at the same files the image is built from, in the style of the existing Compose contract tests.

**Concerns**

- **MEDIUM:** `socat` listens on the container IP, while the healthcheck opens `127.0.0.1:1143` (`02-01-PLAN.md:176`, `02-01-PLAN.md:183`). Docker publishes `1143` onto the container's non-loopback interface. Bridge's own loopback listener can answer the healthcheck after `socat` has exited, so `docker compose ps` stays healthy while the worker at `bridge:1143` cannot connect. `socat` is also started in the background under `set -euo pipefail`, so a bad `hostname -i` bind does not fail the entrypoint.
- **MEDIUM:** `.env.mailboxes.bak` is a long-syntax bind with no `create_host_path`. The plan proves `docker compose run` fails when the file is missing. It does not prove that `docker compose up` of `db`/`setup`/`worker` ignores that bind because `bridge-init` is profiled. If Compose v2.2.3 resolves it anyway, the existing stack cannot start until the owner creates a backup file.
- **LOW:** `command: ["init"]` is installed in this wave, but the entrypoint only implements `serve` and `keychain-init` until 02-08. An early `docker compose run --rm bridge-init` exits 64.

**Suggestions**

- Healthcheck the published path (the address `socat` binds), and fail `serve` if `socat` exits.
- Add a smoke assertion that `docker compose up` of `db setup worker` succeeds when `.env.mailboxes.bak` is absent, and fails only for `run bridge-init`.
- `exec` the `setpriv` binary directly. Bash will not `exec` a shell function, and skipping `exec` leaves `tini` supervising a shell that can exit while Bridge is in the background.

**Risk Assessment**

MEDIUM. The image pin, keychain refusal, and mount split are sound. A green healthcheck that does not cover `socat` will send later IMAP work at a listener that is not actually published.

## 02-02

**Summary**

The config extension matches the existing strict Zod 4 schema and does not disturb registry drift. Names, defaults, and placement are pinned before any consumer is written.

**Strengths**

- `worker.poll_interval_seconds` already exists at default 60 with range 10–3600 (`packages/core/src/config/schema.ts:8-11`, `packages/core/src/config/schema.ts:107-123`). The plan keeps that block and only adds `imap.tls` and per-mailbox `ingest`.
- `unlessMissing` (`packages/core/src/config/schema.ts:25-28`) is the right error hook for Zod 4.6.5, which is what `@sift/core` already uses.
- `planRegistryChanges` copies only host, port, username, folder, `password_env`, display name, and label mode (`packages/db/src/registry-plan.ts:12-19`, `packages/db/src/registry-plan.ts:69-78`). New TLS and ingest keys cannot show up as registry drift.
- `pin_sha256` is optional and must be 44-character base64. A truncated pin cannot silently disable the check. There is no plaintext mode.

**Concerns**

- **LOW:** A missing pin is valid config. 02-18 then uses public CA verification, which rejects Bridge's certificate. The owner-facing text for that case has to be written in 02-13; this plan's error string only covers a malformed pin.
- **LOW:** Bounds of 0–365 days and 1–10000 messages are planner choices, not measured against a real Proton mailbox.

**Suggestions**

- Keep the example pin commented, and say in the comment that `+` and `/` are normal in the fingerprint so the value should be quoted if a YAML parser ever complains.
- Assert in `example-config.test.ts` that a Phase 1 file with no `tls` and no `ingest` still parses to the new defaults.

**Risk Assessment**

LOW. The schema change is one-way, and the plan pins it with reject cases before the worker reads it.

## 02-03

**Summary**

The schema matches the locked isolation rules: non-null `mailbox_id`, composite foreign keys, forced RLS, and no body column on `message`. Constraint design for generations, backfill cursors, and the new mailbox states is precise. A few NOT NULL additions will break today's seed until this plan's own seed update lands.

**Strengths**

- `message` is still only id, mailbox, and timestamps (`packages/db/src/schema/scoped.ts:23-32`). Putting the body on `message_body` and identity on `UNIQUE (mailbox_id, identity_key)` is the right split.
- Child tables already use the composite foreign key the plan copies (`packages/db/src/schema/scoped.ts:65-71`). `SCOPED_TABLE_NAMES` is what isolation walks (`packages/db/src/schema/index.ts:15-23`), so adding `message_location` and `message_body` there extends ISO-03 instead of inventing a second suite.
- `mailbox_status.state` is text plus a check, not a Postgres enum (`packages/db/src/schema/scoped.ts:49-51`), and the plan keeps that. The custom migration pairs with `0004_scoped_tables_force_grants.sql`, which is where FORCE RLS, grants, and `set_updated_at` actually live.
- UID `4294967295` fits in a JS number (`Number.MAX_SAFE_INTEGER` is far above `2^32-1`), so `bigint` mode `number` on Drizzle 0.45.3 is a valid round-trip.

**Concerns**

- **MEDIUM:** `folder_sync` and `message` gain several NOT NULL columns with no defaults. The test seed inserts `folder_sync` as `(mailbox_id)` only (`packages/db/test/support/seed.ts:74-76`). Fresh test databases are fine after the seed update. An existing `sift-pgdata` volume that already has those rows will fail `0005` with no backfill. The plan only argues that production has no `message` rows.
- **LOW:** `live` is not a column. "Current generation" is whatever `folder_sync.generation` says, while a location is live whenever `removed_at` is null. Mid-resync, two generations are both visible. Later readers must treat `resyncing` as "do not act," which this plan cannot enforce by itself.
- **LOW:** `message_body.source = 'none'` still requires `body_text NOT NULL`. Empty string versus a missing row needs one rule so 02-06 and 02-07 do not diverge.

**Suggestions**

- In `0005`, add the NOT NULL columns with a temporary default, update any existing rows, then drop the default. Or document that Phase 1 volumes must be recreated.
- Add a partial index on `message_location (mailbox_id, folder) WHERE removed_at IS NULL` if the removal diff in 02-10 reads that set every poll.

**Risk Assessment**

MEDIUM. The catalog shape is right. The migration is one-way and brittle on any database that already ran the Phase 1 seed.

## 02-04

**Summary**

Putting Dovecot, the SPKI helper, and the only lockfile edit in one wave is the right cut. CI today never starts an IMAP server, so without the new step every later IMAP test would fail or never run.

**Strengths**

- `.github/workflows/ci.yml:74-83` runs `pnpm test` with only Postgres. The plan inserts `scripts/test-imap.sh up` before that, which matches the research note that service containers start too early to mount repo files.
- `dovecot/dovecot:2.4.5` on port 31143 is the stack the research already selected, including `doveadm mailbox update --uid-validity`.
- One plan owns `apps/worker/package.json` and `pnpm-lock.yaml`. License allowlist, exact versions, and an unchanged `allowBuilds` list are test-gated.
- `spkiSha256` is checked against the same openssl pipeline the Bridge entrypoint logs, so 02-01, config, and the worker share one encoding.

**Concerns**

- **MEDIUM:** The container name `sift-test-imap` is global. Two worktrees, or a local server left up from a previous run, will attach to the wrong certificate or the wrong accounts. CI is a single job, so this shows up on the developer machine.
- **LOW:** `peerSpkiSha256` is exported here and used by 02-18's `checkServerIdentity`, but the tracer only equates `spkiSha256(pem)` with openssl. A mismatch between `cert.pubkey` and the PEM SPKI is caught only later, when the Dovecot login test fails.
- **LOW:** `postal-mime` is installed for Phase 3 and unused in this phase. That is an explicit D-77 choice, not an accident, but it widens the production tree now.

**Suggestions**

- Key the container name by worktree or by `SIFT_TEST_IMAP_PORT`, and have `requireTestImap` say which container it expects.
- In `imap-pin.test.ts`, assert `peerSpkiSha256` equals `spkiSha256` for the same certificate.

**Risk Assessment**

LOW. The harness is the dependency the rest of the phase stands on, and the failure mode is a loud test, not a silent skip.

## 02-05

**Summary**

`nudge()` and a shutdown `AbortSignal` fit the existing scheduler. The overlap guard is already `running` keyed by mailbox id (`apps/worker/src/runtime/supervisor.ts:85-88`, `apps/worker/src/runtime/supervisor.ts:292-296`). The signal change is source-compatible with today's one-argument `runBatch`.

**Strengths**

- `runBatch` is a single positional callback (`apps/worker/src/runtime/supervisor.ts:57`, `apps/worker/src/runtime/mailbox-batch.ts:34`). A one-argument function stays assignable when the dependency type gains a second argument, so `pnpm typecheck` can pass before 02-13 uses the signal.
- `stop()` already drains in-flight work with a bound (`apps/worker/src/runtime/supervisor.ts:384-399`). Aborting at the start of `stop()` lets a chunked ingest notice shutdown instead of running until the timeout.
- A nudge while `running` has an entry only sets a flag. That preserves "skip, do not queue."
- `wakeAt` during a tick is safe: `loop` clears the timer, and an earlier due time is kept (`apps/worker/src/runtime/supervisor.ts:335-338`, `apps/worker/src/runtime/supervisor.ts:360-371`).

**Concerns**

- **MEDIUM:** On both success and failure, a pending nudge sets `nextRunAt = now()` after backoff is computed (`02-05-PLAN.md:89` against `apps/worker/src/runtime/supervisor.ts:220-224`). One nudge during a Bridge outage cancels exponential backoff for the next attempt. Nothing in Phase 2 calls `nudge`, so this is latent.
- **LOW:** There is one `AbortController` for the process. That is correct for shutdown. It is the wrong signal if a later caller wants to cancel one mailbox.
- **LOW:** A batch that ignores the signal still occupies the drain until `SHUTDOWN_TIMEOUT_MS` (20s). The plan tests a cooperative batch, not a stuck one. That matches current `stop()` behavior.

**Suggestions**

- Apply the nudge override only on the success path. Leave failure backoff intact unless the mailbox is idle.
- Add the "nudge while the batch is pending" case to the fake-timer harness before changing `runMailbox`.

**Risk Assessment**

LOW. The contract change is small, covered by the existing fake clock, and unused until a later plan passes the signal through.

## 02-06

**Summary**

The use-case list covers idempotent store, monotonic watermarks, orphan bodies, and generation finish. The batch upsert, as written, is not valid PostgreSQL when one chunk contains the same identity twice, and `RETURNING` is not ordered. Both break the D-14 behavior the plan itself requires.

**Strengths**

- Upsert is specified to prepend `mailbox_id` to the conflict target and to fill it on every row. That matches the ISO-04 rule already implemented in `scopedTable`, which adds `mailbox_id` itself rather than trusting RLS (`packages/db/src/scope.ts:142-150`).
- The existing status upsert shows `onConflictDoUpdate` plus `RETURNING` is already the local idiom (`packages/db/src/scope.ts:211-224`). Empty `.values([])` and empty `.set({})` are called out because Drizzle throws on them.
- `deleteOrphanBodies` keeps a body when any live location or a `decision` row exists. That is the D-07 rule, and it stays valid when Phase 3 starts writing decisions.
- NUL stripping is in the database boundary, so every caller gets it.

**Concerns**

- **HIGH:** Task 1 upserts every message in one `INSERT ... ON CONFLICT`, and Task 2 requires two items with the same identity key in one call to become one message and two locations (`02-06-PLAN.md:142-144`, `02-06-PLAN.md:174`). PostgreSQL rejects that statement with `ON CONFLICT DO UPDATE command cannot affect row a second time`. Two UIDs in one chunk that share a Message-ID are the D-14 case this phase exists to survive. Locations have the same trap if a chunk repeats `(folder, uidvalidity, uid)`.
- **HIGH:** The plan requires upsert results in input order so each location can be tied to its message id. `scopedTable.insert` returns `.returning()` with no `ORDER BY` (`packages/db/src/scope.ts:160-163`). PostgreSQL does not promise that `RETURNING` follows the `VALUES` list. Zipping by index attaches a location to the wrong message whenever a chunk mixes inserts and conflicts.
- **MEDIUM:** A no-op `ON CONFLICT DO UPDATE` still runs `set_updated_at`. Re-ingest is idempotent for row counts and not for `updated_at`. Anything that later treats `updated_at` as "content changed" will misfire.
- **LOW:** `finishResync` is several statements. Atomicity exists only if 02-13 wraps the whole function in one `session.run`. The function itself does not open a transaction.

**Suggestions**

- Dedupe messages by identity key inside `storeMessages` before the insert. Insert locations only after every message id is known. Look up ids with `knownIdentityKeys` / `RETURNING` keyed by identity, not by array index.
- Add a regression that stores two UIDs with one `mid:` key in a single `storeMessages` call and asserts one message row.
- If drizzle cannot return `xmax = 0` reliably, use the plan's own fallback (`ON CONFLICT DO NOTHING` plus a select) rather than guessing order.

**Risk Assessment**

HIGH. ING-02's "same message, another location" path is specified as a single batched upsert that Postgres will reject, and the success path can pair a body with the wrong row.

## 02-07

**Summary**

Identity and parsing are pure, capped, and separated from ImapFlow and `@sift/db`. The `pm:` / `mid:` / `hdr:` order matches the threat the phase is worried about: a sender-forged Message-ID must not merge into an existing row when Bridge supplies its own id.

**Strengths**

- Message-ID comes from the raw header, not the envelope, and only the domain is lowercased. That is a testable reading of D-13.
- Caps are in code points, with an explicit surrogate-pair rule, plus a 256 KiB download cap and an attachment count cap.
- `IngestStore` is a transaction-per-method port. The engine can be tested on a fake, and 02-13 can implement it over 02-06 without importing IMAP into `packages/db`.
- `knownIdentities` returning `Set<string>` is enough for D-22 (known versus unknown). Eligibility stays on the stored row and on `promoteEligible`, so the slimmer port is not a data loss.

**Concerns**

- **MEDIUM:** `HDR_HASH_INPUTS` omits Message-ID by design and is still assumption A6. Two different messages with the same Date, From, To, Cc, Subject, In-Reply-To, and size share an `hdr:` key. The plan defers confirmation to the live spike, but 02-13 can store real Dovecot mail, and a later hash change rekeys every row.
- **LOW:** `decodeHeaders` is specified as "binary or utf8, per libmime docs." The wrong choice splits RFC 2047 words. The tests cover one encoded fixture, so this is caught only if that fixture is strict.
- **LOW:** `html-to-text` includes script text unless selectors skip `script` and `style`. The behavior test requires the script body to be absent, which is the right gate, but the action's "options that drop script" needs those selectors written down so the executor does not rely on a default.

**Suggestions**

- Freeze the hash version in the key prefix (`hdr:v1:`) so a spike-driven input change does not collide with keys already stored.
- Add a fixture whose Message-ID local part differs only by case, and one whose only text part is `text/plain` with `Content-Disposition: attachment`.

**Risk Assessment**

MEDIUM. The parser boundary is in good shape. The hash inputs are still provisional, and they become permanent as soon as the first `hdr:` row is written.

## 02-08

**Summary**

Init writes the Bridge IMAP password into the mounted env file without printing it, backs up in place, and refuses a missing regular file. That matches the bind-mount constraint. The Go helper's dependency on Bridge's unexported gRPC API is the fragile part.

**Strengths**

- In-place truncate-and-write keeps the host inode, mode, and owner. A rename onto the bind is already known to return "device or resource busy."
- Backup happens before the first password write, and a missing `.env.mailboxes.bak` exits 2 with nothing written. `.gitignore:69-72` ignores `.env.*` except examples, so the backup stays untracked.
- The helper prints `wrote <NAME> ...` and not the value. Configure without a logged-in account exits 3, which the smoke test can assert.
- `init` refuses a non-TTY, so a piped `docker compose run -T` cannot prompt for the Proton password into logs.

**Concerns**

- **MEDIUM:** The helper imports Bridge `internal/` packages at the pinned tag. 02-15's Renovate bump can change `User.password` or the gRPC metadata key and still pass a compile only if this package is rebuilt in-tree. A green Bridge binary build does not typecheck the helper unless `bridge-smoke` runs `configure`.
- **MEDIUM:** A crash during the truncate-and-write leaves a partial `.env.mailboxes`. The backup is the recovery path, but only if the backup write finished first and the owner knows to copy it back. The plan says that order; the smoke test should kill the writer mid-write or this stays untested.
- **LOW:** `configure` rewrites the password line even when the owner only wanted address-mode text (02-14 runs configure again before repair). That is safe if the upsert is stable, and surprising if Bridge rotated the IMAP password.

**Suggestions**

- Compile `sift-helper` inside `scripts/bridge-smoke.sh` on every run, not only in the image build, so a proto drift fails the Bridge CI job.
- Write the new env bytes to memory, `fsync`, then truncate-and-write. If the backup `fsync` fails, do not open the primary.

**Risk Assessment**

MEDIUM. The secret-handling rules are explicit. The implementation depends on an unexported Bridge API that will move the first time the pin moves.

## 02-09

**Summary**

The adapter is a thin, read-only `FolderSource` over ImapFlow, with the tests that matter: EXAMINE, `BODY.PEEK`, unchanged flags, the RFC 3501 `n:*` case, and a real UIDVALIDITY bump. It correctly depends on the connection plan rather than opening sockets itself.

**Strengths**

- `mailboxOpen(folder, { readOnly: true })` and a grep ban on STORE, MOVE, COPY, and APPEND keep D-11 in this file.
- `fetchAll` instead of `for await` matches the known ImapFlow pitfall of issuing commands inside a fetch iterator.
- bigint UIDVALIDITY is converted at this boundary. The schema stores a number (`02-03`), and ImapFlow 2.x exposes `uidValidity` as bigint.
- The `n:*` behavior is specified as "report the highest UID unchanged" and left for 02-10 to drop. That split is testable on Dovecot without hiding the protocol quirk.

**Concerns**

- **MEDIUM:** `downloadText` sets `truncated` when the byte count reaches `maxBytes`. A part whose decoded size is exactly the cap is reported truncated, and a multi-byte character cut at the cap is repaired only later in `toBodyText`. The flag can be wrong in either direction if ImapFlow's `maxBytes` counts encoded bytes rather than decoded bytes.
- **LOW:** `searchSince` is IMAP `SINCE`, which is a date, not a timestamp. The engine's INTERNALDATE filter is what makes the window exact. If a caller trusts `searchSince` alone, the edges are off by a day.
- **LOW:** Every method except `examine` throws unless that folder is selected. A resync that examines once and then fetches is fine. A helper that fetches after a failed examine will throw a generic error unless the message names the folder.

**Suggestions**

- Treat `truncated` as true only when the server hit the cap and more bytes existed, and add a fixture whose plain part is exactly 64 bytes.
- Assert `messageFlags` before and after on a message that already has `\Flagged` and `\Answered`, not only on an unseen message.

**Risk Assessment**

LOW. This file cannot see Postgres. The Dovecot tests are the right proof for PEEK and UIDVALIDITY, and they fail closed when the test server is down.

## 02-10

**Summary**

The engine is the phase's real ingest policy: first-sync backfill in slices, INTERNALDATE gating, a volume valve, removals, and a generation resync. Polling is fail-closed. The resync path is not: it writes rows before it applies the valve, and the first watermark is wall-clock `now` rather than mail time.

**Strengths**

- The module imports only `FolderSource` and `IngestStore`. Idempotency, the cap, and resync retry can be tested without Dovecot or Postgres. The fake is required to mirror 02-06, including `promoteEligible` and monotonic cursors.
- The poll valve counts candidate-new mail before `fetchHeaders` and writes nothing (`02-10-PLAN.md:219`). Historical mail does not count toward the cap. The first backfill is intentionally uncapped and sliced at 200, which is D-75, not an accident.
- `n:*` rows at or below `lastUid` are dropped, and `UIDNEXT <= lastUid + 1` skips FETCH. Abort between chunks returns `aborted` and resumes from the last committed cursor.
- Resync of a known key adds a location and does not change eligibility. That is what "do not reclassify" means while decisions still hang off `message`.

**Concerns**

- **HIGH:** On UIDVALIDITY change the engine commits known and unknown-old rows, then applies the valve to the new-mail count (`02-10-PLAN.md:256-264`). D-23 says the previous generation stays authoritative until `finishResync`. A valve trip returns `needs_attention` after those commits, with `folder_sync` still `resyncing` and both generations `removed_at` null. `liveLocations` is specified as any generation (`02-06-PLAN.md:110`). The polling valve's "store unchanged" test does not cover this path. A Bridge cache rebuild that also looks like a burst of new mail leaves a half-written generation.
- **MEDIUM:** First sync sets `watermark` to `now()` (`02-10-PLAN.md:160`). New mail is eligible only when `INTERNALDATE > watermark - 5 minutes` (`02-10-PLAN.md:117`). If Bridge's INTERNALDATE is more than five minutes behind the worker clock, mail that arrives after startup is stored as historical and never classified. Docker usually shares the host clock; a paused laptop or a Bridge VM does not.
- **MEDIUM:** Every successful cycle runs `listUids` across `minLiveUid:maxLiveUid` (`02-10-PLAN.md:220`). D-17 asked for a periodic diff. A 30-day INBOX becomes a full UID SEARCH every poll, with no pause. The backfill path pauses 250 ms; the resync path's 500-UID header batches do not.
- **MEDIUM:** There is no automated run of this engine against Proton. See the cross-plan note. Dovecot's UIDVALIDITY bump does not prove Bridge keeps INTERNALDATE across a cache rebuild, which the plan itself flags as unresolved for ING-04.

**Suggestions**

- On the resync path, count candidate-new UIDs before any `commitChunk`. If the valve trips, call nothing that writes, and leave generation N untouched.
- Set the initial watermark from the folder's max INTERNALDATE at `UIDNEXT - 1`, or from Bridge's clock, and log the skew when it exceeds the overlap.
- Run the removal diff on a slower cadence than the new-mail poll, or bound it to UIDs at or below `lastUid`.

**Risk Assessment**

HIGH. The poll path matches the phase decisions. The resync path can persist a new generation before it decides the cycle is too large to process, which is the failure ING-04 cannot have.

## 02-11

**Summary**

`sift bridge probe` is an aggregates-only spike tool on the same pinned connection as the worker, with a positive CONDSTORE control on Dovecot and a compare mode for UIDVALIDITY. The label test is a real mailbox mutation living next to a read-only ingest phase.

**Strengths**

- Capability atoms are uppercased before comparison. IMAP atoms are case-insensitive, and a byte-wise check would mis-report Bridge.
- Folder names go through ImapFlow's modified UTF-7 decoding. The report counts `Labels` and `Folders` prefixes and special-use roles instead of printing the owner's label names.
- `--compare` matches samples by hash of `X-Pm-Internal-Id`, not by the raw id, and a folder present on only one side is added or missing rather than a crash.
- `--label-test` requires the typed word `LABEL` and is specified to expunge only the label-folder copy, then check that the INBOX UID remains.

**Concerns**

- **MEDIUM:** COPY, `\Deleted`, and UID EXPUNGE contradict D-11 for any code path that shares the worker binary. Confirmation is one word on stdin. If Bridge stores a label as the same message rather than a second copy, EXPUNGE can remove the only copy. Dovecot will not show that. 02-14 is the gate, but the command exists as soon as this plan lands.
- **LOW:** `--scan-limit` is on the CLI. The plan must cap header reads before identity stats. An unbounded scan of a large Proton mailbox during `probe` every 60 seconds (02-14's sync wait) will stall Bridge.
- **LOW:** Redaction is a must-have, but the Dovecot fixtures use `example.test`. A test that only checks those fixtures will not fail if a subject from the envelope is copied into JSON.

**Suggestions**

- Default the probe to read-only. Require `--label-test` and `LABEL`, and refuse `--label-test` unless the UID was passed explicitly.
- Put a synthetic subject and address in the fixture and assert the JSON contains neither.

**Risk Assessment**

MEDIUM. The report shape can answer SPK-01..04. The label test is safe only if the owner checkpoint is actually honored and Bridge's COPY semantics match Dovecot.

## 02-12

**Summary**

The lock follows the migrate path that already holds a session advisory lock on a dedicated client (`packages/db/src/owner/migrate.ts:77-105`). Routing chunk transactions through that same client is the right fix for pool deadlock. Status helpers for `connecting` and `needs_attention` belong here, after the check constraint exists.

**Strengths**

- `withMailbox` already sets `app.mailbox_id` transaction-locally and then closes the scope (`packages/db/src/scope.ts:255-291`). Extracting `runScoped` lets the lock session reuse that, including `requireActive`.
- Two `AppDb` instances are a fair stand-in for worker versus CLI. The test that expects exactly one backend during two `session.run` calls is the Pitfall 9 check.
- Unlock in `finally`, and `release(error)` when the backend was terminated, matches a crashed CLI: Postgres drops a session advisory lock on disconnect.
- `recordSyncSuccess` today only sets `ok` and clears `last_error` (`packages/db/src/status.ts:17-24`). Extending it to clear `held_new_count` and `approved_new_count` is what makes resume a one-shot approval rather than a sticky hold.

**Concerns**

- **MEDIUM:** `pg_try_advisory_lock(815309, hashtext(mailbox_id))` is a 32-bit hash. Two mailbox ids can collide and block each other. One owner and a handful of mailboxes makes this unlikely, and it is still a silent coupling.
- **MEDIUM:** `IngestSession.run` starts `orm.transaction` on the locked client. A second `session.run` from inside the first (02-13's progress callback, if it fires before the chunk transaction commits) issues another `BEGIN` on that client. node-pg will not nest that safely.
- **LOW:** `recordNeedsAttention` writes `last_error` text that includes the slug. That is owner-facing and fine. It must not include message subjects. The signature only takes a count and a slug, which keeps it that way.

**Suggestions**

- Document that `session.run` is not re-entrant, and test two overlapping `session.run` calls on one session as a rejection.
- Namespace the advisory key with a second constant, not `hashtext` alone, if a third mailbox is ever in scope. A collision test with two ids that share a hash is enough to pin the behavior.

**Risk Assessment**

MEDIUM. The lock design matches an existing pattern. Nested `session.run` and hash collisions are the ways it fails once the CLI and the worker actually overlap.

## 02-13

**Summary**

This is the worker integration that makes ING-01..04 true against Dovecot: lock, pin, engine, grace, hold, and resume. The control flow for a busy lock and a held mailbox is careful about not writing an error. It never runs the worker against Proton, so the phase's real-mailbox criteria stay unmet.

**Strengths**

- Busy lock logs and returns without `recordSyncError` (`02-13-PLAN.md:147`, behavior at `02-13-PLAN.md:199`). Because `runBatch` resolves, the supervisor does not take the failure path (`apps/worker/src/runtime/supervisor.ts:214-224`).
- A hold with no approval returns before `openImap`. The password is read from `password_env` and is not stored on the mailbox row (`packages/db/src/schema/mailbox.ts:6-7`).
- Startup grace maps `unreachable` and `timeout` to `connecting` for 60 seconds, then to a host:port error. Auth failure names `docker compose run --rm bridge-init`. Pin mismatch names `sift bridge trust`. Other mailboxes stay on their own batches.
- `commitChunk` plus `advanceFolderSync` in one `session.run` is the crash boundary D-04 needs. `closeImap` is in `finally`.
- The e2e seed uses `initial_backfill_days: 0`, then APPEND, then a second process. That is a direct test of criteria 3 and 4 against a real IMAP server, scoped by `mailbox_id`.

**Concerns**

- **HIGH:** Roadmap criteria 3 and 5 require the configured Proton mailbox in the database, with a UIDVALIDITY resync that does not duplicate or reclassify (`/.planning/ROADMAP.md:73-75`). This plan's end-to-end test is Dovecot. 02-14 never starts `sift worker` against Bridge. A Bridge-specific UID or INTERNALDATE quirk passes the spike's JSON compare and still duplicates rows in Postgres.
- **MEDIUM:** A busy or held `runBatch` that returns successfully resets `failures` and waits a full poll interval (`apps/worker/src/runtime/supervisor.ts:215-219`). The CLI can finish a second later and the worker still waits up to 60 seconds. That is safe, and it is slower than the "skip without backoff" wording suggests, because success scheduling is not "retry immediately."
- **MEDIUM:** `onBackfillProgress` calls `session.run` while `createDbStore` methods also call `session.run`. If the engine invokes the callback from inside `commitChunk`, the lock client nests transactions. See 02-12.
- **LOW:** `trustPmHeader` is `labels.apply_as === 'proton_labels'`. Every Phase 1 mailbox uses that mode, including a future non-Bridge IMAP host. A forged `X-Pm-Internal-Id` would then win. The mode is the only signal the schema has today.

**Suggestions**

- Add an owner checkpoint, after 02-14, that runs the worker against the pinned Bridge for one poll plus one restart and checks message, location, and body counts. Keep bodies out of the repo.
- Call `onBackfillProgress` only after `commitChunk` resolves. Test that with a store spy.
- Treat a busy lock as "do not move `nextRunAt` forward by a full interval" if the supervisor can learn a skip without a thrown error. Otherwise document the 60 second delay.

**Risk Assessment**

HIGH for the phase goal, MEDIUM for the Dovecot integration itself. The callback wiring is coherent and testable. It does not by itself put the owner's mailbox in the database.

## 02-14

**Summary**

The live spike is a real owner checkpoint with a read-only escape hatch, aggregate findings, and an ADR-0003 addendum. It answers SPK-01..04. It does not ingest the mailbox.

**Strengths**

- Probe JSON stays in `data/spike/`, which is git-ignored. The findings test rejects `Subject:`, `From:`, `To:`, and unexpected email domains.
- The owner must reply `done: full`, `done: no-repair`, or `done: read-only` before COPY or repair. Repair is the forced UIDVALIDITY event SPK-04 needs, and it is optional.
- Findings must end with an explicit sync capability (`polling only`, `CONDSTORE`, or `QRESYNC`) and a Phase 4 label method. That is roadmap criterion 2, not a vague note.
- The ADR addendum records D-09 (prompt recipe, not raw prompts) while the spike is in front of the owner, which is when that decision is cheapest to confirm.
- Login is the Bridge CLI with no echo. The checkpoint's automated check is presence of `SIFT_PERSONAL_IMAP_PASSWORD`, not its value.

**Concerns**

- **HIGH:** After the probes, the plan stops Bridge, runs `configure` and `repair`, and writes findings (`02-14-PLAN.md:186-216`). It never runs the worker and never selects from `message`. Roadmap criterion 3 (`/.planning/ROADMAP.md:73`) is "owner starts the worker and the configured mailbox's messages appear in the database exactly once." Criterion 5 is a resync of stored messages. This checkpoint cannot make either true.
- **MEDIUM:** `docker compose run bridge-init configure` during the spike rewrites `.env.mailboxes` (02-08). A partial configure failure during a cache-rebuild experiment can rotate or truncate the IMAP password while the owner thinks the step was read-only.
- **MEDIUM:** The label test is piped as `printf 'LABEL\n'` once the owner has approved. That bypasses the interactive confirmation for the agent. The owner's `done: full` is the authorization, and it is easy to run the same command later against the wrong UID.
- **LOW:** `depends_on` is 02-01, 02-08, and 02-11. Config keys from 02-02 arrive only because wave 1 finishes first. An executor that follows `depends_on` alone can probe before `pin_sha256` exists.

**Suggestions**

- Add a last step: start the worker, wait one poll, record counts of `message`, `message_location`, and `message_body` for that `mailbox_id`, restart the worker, and assert the counts are unchanged. No subjects in the findings.
- Skip `configure` on the repair path. Repair should not rewrite the env file.
- Depend on 02-02 explicitly.

**Risk Assessment**

HIGH relative to the phase goal. As a spike document it is careful. As the proof that ingest works on Proton, it never looks at the database.

## 02-15

**Summary**

`sift bridge trust` shows the fingerprint from the credential-free capture and does not write config or log in. Renovate is limited to the Bridge pin. The claim that tag and commit move together is an unverified Renovate behavior, with CI as the backstop.

**Strengths**

- Trust uses `capturePeerCertificate` and `spkiSha256`, refuses `openImap` and `writeFile`, and checks the config file is byte-identical. That matches D-73: the pin changes only when the owner edits YAML.
- The missing-pin case prints a paste line and exits 1, so an unset pin is not treated as success.
- `enabledManagers: ["custom.regex"]` stops Renovate from opening npm and GitHub Actions PRs. The regex is aimed at the three adjacent lines 02-01 freezes in the Dockerfile.
- `bridge-image.yml` runs `scripts/bridge-smoke.sh` on changes under `bridge/**`. A tag bump that fails the commit check cannot merge green.
- Actions stay SHA-pinned, consistent with `ci.yml`.

**Concerns**

- **MEDIUM:** `currentDigest` is how Renovate names a digest group. Assumption A2 hopes `github-tags` will fill it with the git commit. If a PR changes only `BRIDGE_VERSION`, the image build fails. That is fail-closed, and it does not satisfy D-31's "tag and SHA together" until someone has seen Renovate do it.
- **MEDIUM:** The smoke build compiles Bridge from source. `timeout-minutes: 30` on a fresh GitHub runner can be tight the first time the module cache is cold. A red CI job on every Bridge PR will train people to skip it.
- **LOW:** `sift bridge trust` from the worker container is the documented invocation. A host-side run against `localhost` also works only if the published port matches `imap.port`. The plan does not say what the example config's port 1143 means on the host when `SIFT_BRIDGE_PORT` is set.

**Suggestions**

- Record a dry-run of the regex manager against a fixture Dockerfile in the test, and treat a tag-only bump as a failing test of the Renovate config once A2 is understood. Until then, say in the PR template that the commit line is required.
- Give the Bridge workflow a longer timeout or a Go build cache.

**Risk Assessment**

MEDIUM. Trust itself is low risk. The pin-update loop is safe only because a wrong SHA fails the build, not because Renovate is known to update both lines.

## 02-16

**Summary**

Resume, list, and backfill are the owner controls the valve and the first sync need. Resume correctly sets `app.mailbox_id` before touching `mailbox_status`, because the owner role is inside the forced policy. Backfill reuses the engine and the lock.

**Strengths**

- `mailboxIsolation` applies to `sift_owner` as well as `sift_app` (`packages/db/src/rls.ts:17-25`), and FORCE RLS is already on `mailbox_status` (`packages/db/migrations/0004_scoped_tables_force_grants.sql:1`). `resumeMailbox` sets `app.mailbox_id` in the same transaction. Without that, the update would match zero rows.
- `listMailboxes` already sets the GUC per mailbox (`packages/db/src/owner/registry.ts:243`). Extending that query with `held_new_count` and `count(*)` from `message` stays inside the policy.
- Today's list switch only knows `ok`, `error`, `disabled`, and null (`apps/worker/src/commands/mailbox-list.ts:11-20`). An exhaustive switch over the five states will fail typecheck until `connecting` and `needs_attention` are rendered.
- Backfill prints the count, requires `yes` or `--yes`, refuses `resyncing` and `not_synced`, and waits on `withIngestLock`. `new_mail_cap` does not apply, which is the D-75 rule the engine already encodes via `runBackfill`.

**Concerns**

- **MEDIUM:** `depends_on` includes 02-15. Resume and backfill do not need Renovate or `bridge trust`. Wave 5 cannot start until the Bridge image workflow exists, which serializes owner tooling behind an unrelated CI job.
- **MEDIUM:** The backfill lock wait of 2 seconds, then "try again in a minute," is correct. The test uses `lockWaitMs` 1500. The production default must be written down. A default of several minutes holds a CLI process and a database connection open beside the worker.
- **LOW:** Resume of a `needs_attention` row sets `approved_new_count = held_new_count` and does not clear `needs_attention`. The worker clears both on `recordSyncSuccess`. If the worker is down, list shows "resume approved" forever. That is accurate, and the copy has to say the next check does the work, which the plan's sentence does.

**Suggestions**

- Drop 02-15 from `depends_on`. Depend on 02-13 and 02-02.
- Cap `lockWaitMs` in the CLI at the same order as one poll interval, and print the held slug without a stack trace.

**Risk Assessment**

LOW for the commands once the schema and engine exist. The extra dependency on 02-15 is the main planning defect.

## 02-17

**Summary**

The docs plan records the security sentences the rest of the phase implements: Bridge session tokens, the external volume, the backup file, the pin, and read-only ingest. It is sequenced last, so the footguns exist in Compose before the README mentions them.

**Strengths**

- The required sentence matches D-37, and the plan says the tokens are as sensitive as the password. That is the distinction owners get wrong.
- It documents `touch .env.mailboxes.bak && chmod 600`, clearing the contents rather than deleting the file, and `external: true` surviving `docker compose down -v`. Those are exactly the 02-01 and 02-08 behaviors.
- `.gitignore` already covers `.env.mailboxes.bak` (`.gitignore:69-72`). The README still needs to say the file holds IMAP passwords, because ignore rules are not a security explanation.
- Full-disk encryption as a deployment requirement is D-10, and this is the natural place to write it.

**Concerns**

- **LOW:** Wave 6 means a developer following waves 1–4 has a Compose file that requires an external volume and, possibly, a backup bind, with no README yet. 02-01's header comment has to carry that alone.
- **LOW:** The plan tells the owner to type `login`, the password, and 2FA into `docker compose run --rm bridge-init`. That is right only if 02-08's TTY attach is what landed. If the helper ever proxies the prompt, the docs would teach the unsafe path. Pin the doc to "Bridge's own CLI, no echo."
- **LOW:** Requirements tagged on this plan are ING-01 and SPK-04. Documentation does not satisfy either. Traceability should point at 02-13 and 02-14.

**Suggestions**

- Put the volume-create and backup-file steps into the Compose header in 02-01, and have 02-17 only expand them.
- Add a docs test, like the spike findings test, that the README contains the exact D-37 sentence and does not contain a wildcard bind example.

**Risk Assessment**

LOW. The content is determined by earlier decisions. The risk is staleness if 02-01 or 02-08 changes a command after this plan is written.

## 02-18

**Summary**

The connection plan is the security boundary for every later IMAP call: no plaintext, no credentials on an unverified socket, pin compared before login, and a second connection that both trusts the captured PEM and re-checks the SPKI. The wire test is what makes the `rejectUnauthorized: false` exception acceptable.

**Strengths**

- Capture is the only module allowed to turn verification off, and the acceptance grep is `rejectUnauthorized: false` under `apps/worker/src` equaling that one file. That is enforceable.
- A pin mismatch throws `PinMismatchError` before `new ImapFlow`. The login connection sets `ca` to the captured PEM and `checkServerIdentity` to the SPKI pin, because Node runs `checkServerIdentity` only after the chain verifies. A self-signed Bridge certificate cannot be pinned by the callback alone.
- The swapped-certificate cases (unrelated cert, and a cert signed by the captured one) must show zero login bytes in both STARTTLS and implicit mode. That is the actual D-80 control, stronger than a unit test of the error class.
- No filesystem import in `capture.ts` or `connect.ts`. The pin lives in config, which is D-73.
- `classifyImapError` maps socket failures, auth, pin, chain, and missing STARTTLS to stable classes so 02-13 does not match message text.

**Concerns**

- **MEDIUM:** ImapFlow might send a pre-auth `CAPABILITY` or `ID` on the login connection before STARTTLS completes, or it might drop `ca` on the upgrade. The plan says to extend the fake server until the tracer passes and to fail if the upgrade drops `ca`. That is the right response, and it is still an open protocol risk until that test exists. If ImapFlow sends any authenticated command on the capture connection, the "one plaintext STARTTLS line" test fails the build, which is what should happen.
- **LOW:** Without a pin, default CA and hostname verification is used. Bridge will fail `cert_untrusted`. The plan covers that. Host development against `localhost` with a pin works only when the captured key matches config, independent of the hostname. Say that in the error text so it is not "fixed" by disabling verification.
- **LOW:** `closeImap` bounds logout at 5 seconds and never throws. A hung server can still hold the lock connection if the caller awaits `closeImap` inside `withIngestLock`. 02-13's `finally` should race that timeout, and the plan should say the lock is released even when logout hangs.

**Suggestions**

- Keep the recording fake as the source of truth. Do not assert on ImapFlow logs.
- Add an implicit-mode case on Dovecot only if the test image can listen without STARTTLS. Otherwise keep implicit on the fake server so CI does not depend on a second port.

**Risk Assessment**

LOW. This is the strongest plan in the set. The dangerous exception is one function, and the tests are specified at the byte level.

## Cross-plan

The wave graph is mostly real. 02-13 reaches the database use-cases through 02-12 → 02-06 → 02-03, and the TLS connection through 02-09 → 02-18 → 02-04. 02-14 does not depend on 02-02, and 02-16 does not need 02-15. Those two edges should be fixed so a depends-on executor does not probe before the pin exists or hold resume for Renovate.

ING-02 is not implementable as 02-06 describes it. One `INSERT ... ON CONFLICT DO UPDATE` cannot contain the same identity twice, and unordered `RETURNING` cannot be zipped back onto locations. 02-10's resync valve then writes a new generation before it decides the cycle is too big. Those two defects survive every green Dovecot test that uses unique Message-IDs and never trips the cap mid-resync.

SPK-01..04 have a real home in 02-11 and 02-14. ING-01..04 have a real home in 02-09, 02-10, and 02-13 against Dovecot. Roadmap criteria 3 and 5 (`/.planning/ROADMAP.md:73-75`) require the configured Proton mailbox in Postgres, once, including across a UIDVALIDITY change. No plan starts the worker against Bridge or counts `message` rows afterward. The spike compares probe JSON. That leaves the phase goal "one real mailbox's mail is reliably in the database" unowned.

TLS pinning (02-18), RLS on the new tables (02-03), the env-only IMAP password (02-08, 02-13), and the read-only adapter (02-09) line up with the existing isolation and secret rules. The body cache, generation column, and `needs_attention` state are scoped to this phase and do not pull classification or label application forward.

## Overall risk

HIGH.

The phase can be built and can pass CI on Dovecot while still failing its Proton success criteria, and the central dedup write is specified in a form PostgreSQL will reject for the duplicate-Message-ID case the spike is there to measure. Fix the batch upsert and the resync valve before execution, and add one worker checkpoint that counts stored rows on the real mailbox without committing mail content.
