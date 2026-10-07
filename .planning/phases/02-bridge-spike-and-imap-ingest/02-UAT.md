---
status: partial
phase: 02-bridge-spike-and-imap-ingest
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md, 02-06-SUMMARY.md, 02-07-SUMMARY.md, 02-08-SUMMARY.md, 02-09-SUMMARY.md, 02-10-SUMMARY.md, 02-11-SUMMARY.md, 02-12-SUMMARY.md, 02-13-SUMMARY.md, 02-14-SUMMARY.md, 02-15-SUMMARY.md, 02-16-SUMMARY.md, 02-17-SUMMARY.md, 02-18-SUMMARY.md, 02-19-SUMMARY.md, 02-VERIFICATION.md]
started: 2026-10-07T03:22:35Z
updated: 2026-10-07T04:53:39Z
---

## Current Test

[testing paused — 1 items outstanding]

## Tests

### 1. Cold Start Smoke Test
expected: Stop the worker and db (`docker compose stop worker db`; leave Bridge running), clear nothing persistent, then `docker compose up -d --build worker` (pulls db back up). Worker boots without errors, migrations report up to date, and `docker compose run --rm -T setup sift mailbox list` shows personal ok with a message count that does not jump.
result: pass

### 2. Worker runs the review fixes
expected: The running worker image is built from HEAD (fixes 9d1daa6..c7a580c); the counts-only duplicate query from 02-LIVE-INGEST.md shows 0 identity keys with more than one message row and 0 (uidvalidity, UID) pairs with more than one live location.
result: pass
note: verified by Claude 2026-10-07T03:31Z; image created 2026-10-06T23:41:32Z after c7a580c, 0 duplicate identity keys, 0 duplicate live (folder, uidvalidity, uid), 103,496 messages = 103,496 live locations, personal ok

### 3. Real Proton login through bridge-init
expected: `bridge-init` logged in to the real Proton account, wrote the IMAP password into the bind-mounted .env.mailboxes with the host file's inode, owner and mode unchanged, and printed the address mode for the account (02-08 D7).
result: pass

### 4. Spike findings are the right basis for Phase 4 and M2
expected: 02-SPIKE-FINDINGS.md answers SPK-01..04 and D-43 from your real mailbox (gluon's actual answers, label semantics, IDLE, UIDVALIDITY across restart), with the scope line, decision lines and the post-spike backfill value, and you agree they are the right design basis (02-11 D6, 02-14 D1).
result: issue
reported: "initial_backfill_days: 3"
severity: minor
note: owner corrected only the backfill value; the other decision lines were not disputed. Findings record 30 (owner reply "backfill 30"), config/config.yaml has 1, example and schema default 30.

### 5. SPK-04 Bridge repair behaviour
expected: Either you accept the override (repair unmeasured; the design treats a repair as a UIDVALIDITY reset, proven by the simulated mismatch and on Dovecot), or you approve one `docker compose run --rm bridge-init repair` and UIDVALIDITY and INTERNALDATE before and after are recorded in 02-SPIKE-FINDINGS.md.
result: pass
note: owner accepted the override (repair unmeasured); overrides entry added to 02-VERIFICATION.md at 2026-10-07T04:01:40Z

### 6. ROADMAP criteria 3-5 on the real mailbox
expected: 02-LIVE-INGEST.md matches what you saw: the worker ingests from Proton through Bridge, new mail arrives once, and the simulated UIDVALIDITY mismatch moved generation 1 -> 2 with state ok, one resynced line, C2 40940 = new 1 + older 40939, C3 58 eligible and 0 duplicates (02-13 D8, 02-19 D3; recorded as partial because Bridge's own UIDVALIDITY change was not observed).
result: pass
note: re-checked 2026-10-07: INBOX generation 2 state ok, last_resync_summary new 1 + older 40939, UID 51105 single row gen 2 eligible, personal ok

### 7. 02-16 lock span changed by WR-02
expected: You accept that `sift mailbox backfill` takes the ingest lock twice (count, then ingest) with D-03, 'exactly the counted UIDs' and 'never duplicate' still holding, or you ask for the original single-lock behaviour.
result: pass
note: owner accepted two lock sessions; overrides entry added to 02-VERIFICATION.md at 2026-10-07T04:23:15Z

### 8. WR-03 watermark capped at worker clock
expected: You agree that a future-dated INTERNALDATE capped at the worker clock ('now', not 'now + 10 min') is the right trade-off with the 5-minute overlap (apps/worker/src/ingest/run.ts clockCap).
result: pass
note: owner accepted cap at "now"; asked for a README note so the host clock is NTP-synced (worker and Bridge share the host clock; INTERNALDATE is Proton server time). Logged as G-02-8.

### 9. WR-04 pm: trust requires a pin
expected: You accept that 'mailbox has pin_sha256' stands in for 'server is Proton Bridge' for trusting X-Pm-Internal-Id, or you want an explicit config key instead.
result: pass
note: owner keeps the pin rule; asked for a README note that Sift supports Proton Mail through Bridge only, for now (simpler logic, smaller test surface, security). Logged as G-02-9.

### 10. Judgment-tier prohibitions in 02-11, 02-14, 02-19
expected: The records match what happened: probe changed nothing beyond the one confirmed label copy; the mailbox changed only by the approved label test (empty `Sift Spike` label remains); 02-19 was ingest-only with no repair, and the single hand-edited row (folder_sync.uidvalidity, UPDATE 1) was done with the worker stopped after the dump backups/sift-20261006T192158Z-pre-live-resync.dump.
result: pass

### 11. README alone gets a new owner to an ingesting worker
expected: Reading the README quick start as a first-time owner, the steps from clone to a Bridge-connected, ingesting worker are clear and complete, including the interactive Bridge login (02-17 D7).
result: skipped
reason: "can i skip this one for now?" (owner deferred the README read-through; natural to redo after the G-02-8/G-02-9 README edits)

### 12. Renovate Bridge bump PR
expected: Renovate opens a Bridge PR that bumps the tag and the commit together and the bridge-image job passes on GitHub's runner (02-15 D7; needs the Renovate app and a new upstream Bridge release).
result: blocked
blocked_by: third-party
reason: "blocked" (Renovate app/PR for upstream v3.27.1 not yet seen; bridge-image workflow already passed on GitHub run 37572704376)

### 13. Re-run of 26 schema-rejected deliverables
expected: These 26 deliverables in 02-09, 02-10, 02-13, 02-16, 02-17 and 02-18 have passing automated tests, but their coverage blocks use `kind: test`/`kind: command`, which the classifier rejects. Re-run on 2026-10-07: full suite 932/934, the 2 failures were 30 s timeouts against the Dovecot test server that moved between runs and passed 54/54 when re-run alone (bug-151 family); typecheck clean. You accept the re-run as covering them.
result: pass
note: owner accepted the local re-run; GitHub check job also passed on the pushed code (run 37572838343)

### 14. 02-01 D1: Bridge image builds from tag v3.27.0, fails unless HEAD equals the pinned commit, ships on
expected: Bridge image builds from tag v3.27.0, fails unless HEAD equals the pinned commit, ships only the bridge binary
result: pass
source: automated
coverage_id: 02-01-D1

### 15. 02-01 D2: Served container answers STARTTLS on host 127.0.0.1:<port> via socat on the container IP a
expected: Served container answers STARTTLS on host 127.0.0.1:<port> via socat on the container IP and logs the SPKI fingerprint openssl computes from that port
result: pass
source: automated
coverage_id: 02-01-D2

### 16. 02-01 D3: Keychain fails closed: wrong passphrase and never-initialised volume exit 78 before Bridge
expected: Keychain fails closed: wrong passphrase and never-initialised volume exit 78 before Bridge runs
result: pass
source: automated
coverage_id: 02-01-D3

### 17. 02-01 D4: serve supervises socat and Bridge; killing socat stops the container non-zero; healthcheck
expected: serve supervises socat and Bridge; killing socat stops the container non-zero; healthcheck probes the socat listener
result: pass
source: automated
coverage_id: 02-01-D4

### 18. 02-01 D5: Compose contract: bridge mounts only sift-bridge on loopback; bridge-init (profile tools) 
expected: Compose contract: bridge mounts only sift-bridge on loopback; bridge-init (profile tools) alone mounts .env.mailboxes, config and the long-syntax backup bind; passphrase only in those two; worker never depends on Bridge
result: pass
source: automated
coverage_id: 02-01-D5

### 19. 02-01 D6: compose-smoke builds and starts only db setup worker on its own bridge volume, with a thro
expected: compose-smoke builds and starts only db setup worker on its own bridge volume, with a throwaway passphrase and a missing backup source
result: pass
source: automated
coverage_id: 02-01-D6

### 20. 02-02 D1: imap.tls.mode accepts starttls/implicit, defaults to starttls, rejects plain/none/tls/STAR
expected: imap.tls.mode accepts starttls/implicit, defaults to starttls, rejects plain/none/tls/STARTTLS/false with a message naming both modes
result: pass
source: automated
coverage_id: 02-02-D1

### 21. 02-02 D2: imap.tls.pin_sha256 optional; base64 SHA-256 accepted quoted or not; hex, missing =, inner
expected: imap.tls.pin_sha256 optional; base64 SHA-256 accepted quoted or not; hex, missing =, inner space, PEM, 45 chars and non-text rejected with the fingerprint message
result: pass
source: automated
coverage_id: 02-02-D2

### 22. 02-02 D3: Per-mailbox ingest block: initial_backfill_days 0..365 default 30, new_mail_cap 1..10000 d
expected: Per-mailbox ingest block: initial_backfill_days 0..365 default 30, new_mail_cap 1..10000 default 200, both edges and string/float rejections tested
result: pass
source: automated
coverage_id: 02-02-D3

### 23. 02-02 D4: Strictness unchanged: tls.pin, ingest.cap and worker.ingest rejected as unrecognised keys;
expected: Strictness unchanged: tls.pin, ingest.cap and worker.ingest rejected as unrecognised keys; version stays 1; poll_interval_seconds default 60
result: pass
source: automated
coverage_id: 02-02-D4

### 24. 02-02 D5: config.example.yaml validates (Config OK: 2 mailboxes), uses host bridge port 1143, docume
expected: config.example.yaml validates (Config OK: 2 mailboxes), uses host bridge port 1143, documents tls with a correctly nested commented pin and the ingest defaults
result: pass
source: automated
coverage_id: 02-02-D5

### 25. 02-02 D6: Registry drift plan unaffected by the new keys
expected: Registry drift plan unaffected by the new keys
result: pass
source: automated
coverage_id: 02-02-D6

### 26. 02-03 D1: Ingest tables migrate cleanly behind the 0005 preflight; catalog check clean for message_l
expected: Ingest tables migrate cleanly behind the 0005 preflight; catalog check clean for message_location and message_body (forced RLS, one policy, grants, triggers, composite FKs)
result: pass
source: automated
coverage_id: 02-03-D1

### 27. 02-03 D2: 0005 preflight refuses a database whose message table holds a Phase 1 shaped row: fixed me
expected: 0005 preflight refuses a database whose message table holds a Phase 1 shaped row: fixed message with the mailbox slug, 5 migrations still recorded, no identity_key column
result: pass
source: automated
coverage_id: 02-03-D2

### 28. 02-03 D3: Two-mailbox isolation over SCOPED_TABLE_NAMES including message_location and message_body:
expected: Two-mailbox isolation over SCOPED_TABLE_NAMES including message_location and message_body: cross-mailbox insert 42501, reads see only own rows, child rows pointing at another mailbox's message fail the composite FK
result: pass
source: automated
coverage_id: 02-03-D3

### 29. 02-03 D4: Scope.messageLocation and Scope.messageBody insert/find/update/delete only the scope's row
expected: Scope.messageLocation and Scope.messageBody insert/find/update/delete only the scope's rows, even on a connection that bypasses RLS
result: pass
source: automated
coverage_id: 02-03-D4

### 30. 02-03 D5: UID and UIDVALIDITY 4294967295 round-trip as JS numbers through bigint columns (SPK-04)
expected: UID and UIDVALIDITY 4294967295 round-trip as JS numbers through bigint columns (SPK-04)
result: pass
source: automated
coverage_id: 02-03-D5

### 31. 02-03 D6: Check constraints enforced by Postgres (23514): removed_at/reason pairing and values, fold
expected: Check constraints enforced by Postgres (23514): removed_at/reason pairing and values, folder_sync pending and backfill rules, mailbox_status needs_attention and backfill pairing, identity_key formats incl. unversioned hdr:, body source; duplicate identity_key gives 23505
result: pass
source: automated
coverage_id: 02-03-D6

### 32. 02-04 D1: scripts/test-imap.sh starts an idempotent Dovecot 2.4.5 STARTTLS server named sift-test-im
expected: scripts/test-imap.sh starts an idempotent Dovecot 2.4.5 STARTTLS server named sift-test-imap-<port> on 127.0.0.1
result: pass
source: automated
coverage_id: 02-04-D1

### 33. 02-04 D2: spkiSha256 equals openssl's wire fingerprint (bridge/entrypoint.sh format) and peerSpkiSha
expected: spkiSha256 equals openssl's wire fingerprint (bridge/entrypoint.sh format) and peerSpkiSha256 of a real STARTTLS peer equals spkiSha256 of its PEM
result: pass
source: automated
coverage_id: 02-04-D2

### 34. 02-04 D3: Test helpers (append, folders, flags, UIDVALIDITY bump) and the fail-never-skip requireTes
expected: Test helpers (append, folders, flags, UIDVALIDITY bump) and the fail-never-skip requireTestImap
result: pass
source: automated
coverage_id: 02-04-D3

### 35. 02-04 D4: Approved packages installed at exact pins; license allowlist, allowBuilds and libmime reso
expected: Approved packages installed at exact pins; license allowlist, allowBuilds and libmime resolution checked by a test
result: pass
source: automated
coverage_id: 02-04-D4

### 36. 02-04 D5: CI starts the IMAP test server after the db bootstrap and before Test
expected: CI starts the IMAP test server after the db bootstrap and before Test
result: pass
source: automated
coverage_id: 02-04-D5

### 37. 02-05 D1: nudge(mailboxId) runs an idle scheduled mailbox now through the normal tick loop, then ret
expected: nudge(mailboxId) runs an idle scheduled mailbox now through the normal tick loop, then returns to the poll interval measured from that run
result: pass
source: automated
coverage_id: 02-05-D1

### 38. 02-05 D2: A nudge while the mailbox runs never starts a concurrent run; exactly one follow-up after 
expected: A nudge while the mailbox runs never starts a concurrent run; exactly one follow-up after a success; a failed run drops the nudge and keeps backoff
result: pass
source: automated
coverage_id: 02-05-D2

### 39. 02-05 D3: nudge returns false and starts nothing for unknown or disabled mailboxes, before start and
expected: nudge returns false and starts nothing for unknown or disabled mailboxes, before start and after stop()
result: pass
source: automated
coverage_id: 02-05-D3

### 40. 02-05 D4: runBatch receives an AbortSignal that is aborted the moment stop() is called, before the d
expected: runBatch receives an AbortSignal that is aborted the moment stop() is called, before the drain; a cooperating batch lets stop() report drained true
result: pass
source: automated
coverage_id: 02-05-D4

### 41. 02-05 D5: Every pre-existing supervisor and run-until-stopped test still passes; full suite green
expected: Every pre-existing supervisor and run-until-stopped test still passes; full suite green
result: pass
source: automated
coverage_id: 02-05-D5

### 42. 02-06 D1: storeMessages stores message, location and body idempotently; a rerun inserts nothing and 
expected: storeMessages stores message, location and body idempotently; a rerun inserts nothing and keeps message updated_at
result: pass
source: automated
coverage_id: 02-06-D1

### 43. 02-06 D2: Identity merge (D-14) and key-based matching: same key in one call gives one message with 
expected: Identity merge (D-14) and key-based matching: same key in one call gives one message with two locations; shuffled order attaches every location to its own key's message; repeated location is one row
result: pass
source: automated
coverage_id: 02-06-D2

### 44. 02-06 D3: Scoped conflict helpers: upsert refuses repeated keys and empty update lists before SQL, f
expected: Scoped conflict helpers: upsert refuses repeated keys and empty update lists before SQL, forbidden keys rejected, append-only tables lack both helpers, empty array match runs no SQL
result: pass
source: automated
coverage_id: 02-06-D3

### 45. 02-06 D4: ISO-04: insertOrIgnore, upsert, array match and deleteExpired on a superuser (RLS-bypassin
expected: ISO-04: insertOrIgnore, upsert, array match and deleteExpired on a superuser (RLS-bypassing) handle touch only the scope's mailbox
result: pass
source: automated
coverage_id: 02-06-D4

### 46. 02-06 D5: Eligibility and body rules (D-21, D-02, Pitfall 7): historical gets no body, promoteEligib
expected: Eligibility and body rules (D-21, D-02, Pitfall 7): historical gets no body, promoteEligible promotes and adds the body, empty-text body row, NUL stripped
result: pass
source: automated
coverage_id: 02-06-D5

### 47. 02-06 D6: Folder sync state: get/create, monotonic advance, backfill write/clear/replace (D-18, D-75
expected: Folder sync state: get/create, monotonic advance, backfill write/clear/replace (D-18, D-75)
result: pass
source: automated
coverage_id: 02-06-D6

### 48. 02-06 D7: Removal, orphan-body and expiry lifecycle (D-07, D-17)
expected: Removal, orphan-body and expiry lifecycle (D-07, D-17)
result: pass
source: automated
coverage_id: 02-06-D7

### 49. 02-06 D8: Generation resync: beginResync/finishResync supersede vs vanish, orphan bodies deleted, fo
expected: Generation resync: beginResync/finishResync supersede vs vanish, orphan bodies deleted, folder_sync settled with summary and backfill in one call (ING-04, D-23..D-25, D-75)
result: pass
source: automated
coverage_id: 02-06-D8

### 50. 02-07 D1: Shared ingest contracts (FolderSource, IngestStore and the record types) with no IMAP clie
expected: Shared ingest contracts (FolderSource, IngestStore and the record types) with no IMAP client or database imports
result: pass
source: automated
coverage_id: 02-07-D1

### 51. 02-07 D2: Deterministic pm:/mid:/hdr:v1: identity keys with D-13 normalisation and Bridge-only pm: t
expected: Deterministic pm:/mid:/hdr:v1: identity keys with D-13 normalisation and Bridge-only pm: trust
result: pass
source: automated
coverage_id: 02-07-D2

### 52. 02-07 D3: Header parsing that never throws on hostile input and gives NUL-free, capped, RFC 2047-dec
expected: Header parsing that never throws on hostile input and gives NUL-free, capped, RFC 2047-decoded values
result: pass
source: automated
coverage_id: 02-07-D3

### 53. 02-07 D4: Body part selection, HTML to text without script/style/img/link targets, 32768 code-point 
expected: Body part selection, HTML to text without script/style/img/link targets, 32768 code-point cap, attachment metadata
result: pass
source: automated
coverage_id: 02-07-D4

### 54. 02-08 D1: sift-helper is compiled and its Go tests run inside every image build; a Bridge gRPC API c
expected: sift-helper is compiled and its Go tests run inside every image build; a Bridge gRPC API change fails the build
result: pass
source: automated
coverage_id: 02-08-D1

### 55. 02-08 D2: configure on a keychain-initialised volume without login: telemetry and automatic updates 
expected: configure on a keychain-initialised volume without login: telemetry and automatic updates off (read back), accounts: 0, the pin_sha256 line equal to the served fingerprint, exit 3, env file unchanged, sentinel never printed
result: pass
source: automated
coverage_id: 02-08-D2

### 56. 02-08 D3: In-place env upsert with a verified 0600 backup: inode and mode kept, part-way failure lea
expected: In-place env upsert with a verified 0600 backup: inode and mode kept, part-way failure leaves the backup intact and names the restore command, backup verify failure never opens the primary, missing/directory backup exits 2 with the touch hint
result: pass
source: automated
coverage_id: 02-08-D3

### 57. 02-08 D4: Mailbox matching by imap.username against Bridge addresses (case-insensitive), skip lines 
expected: Mailbox matching by imap.username against Bridge addresses (case-insensitive), skip lines name only the slug
result: pass
source: automated
coverage_id: 02-08-D4

### 58. 02-08 D5: Entrypoint refusals: env file not mounted (bridge-init hint), directory (create-first), in
expected: Entrypoint refusals: env file not mounted (bridge-init hint), directory (create-first), init and cli without a TTY (exit 2), a running Bridge on the volume (exit 1)
result: pass
source: automated
coverage_id: 02-08-D5

### 59. 02-08 D6: repair triggers Bridge's repair over gRPC without a TTY and exits 0
expected: repair triggers Bridge's repair over gRPC without a TTY and exits 0
result: pass
source: automated
coverage_id: 02-08-D6

### 60. 02-11 D1: `sift bridge probe <slug>` prints one aggregate-only JSON report from the real test server
expected: `sift bridge probe <slug>` prints one aggregate-only JSON report from the real test server through the worker's STARTTLS + pin path: capabilities (upper-cased), CONDSTORE/QRESYNC positive control, folder counts and special-use roles, folderStatus, UIDVALIDITY, identity statistics and a hashed sample
result: pass
source: automated
coverage_id: 02-11-D1

### 61. 02-11 D2: No subject, sender, recipient, body, email address, raw Message-ID, internal ID or persona
expected: No subject, sender, recipient, body, email address, raw Message-ID, internal ID or personal folder name reaches stdout or stderr (sentinel and address-pattern scan), and the password never appears in errors
result: pass
source: automated
coverage_id: 02-11-D2

### 62. 02-11 D3: Bounded scans and edges: --scan-limit 0..10000 and --sample 0..200 (out of range exits 2),
expected: Bounded scans and edges: --scan-limit 0..10000 and --sample 0..200 (out of range exits 2), 0/0 skips the header scan, an empty mailbox gives zero counts; NO, BAD and no answer to ENABLE/STATUS are recorded, never thrown
result: pass
source: automated
coverage_id: 02-11-D3

### 63. 02-11 D4: --label-test --uid <u> with typed LABEL copies only that UID into Labels/Sift Spike, compa
expected: --label-test --uid <u> with typed LABEL copies only that UID into Labels/Sift Spike, compares raw Message-ID and X-Pm-Internal-Id bytes, removes the copy from the label folder only and leaves INBOX flags and count unchanged; unconfirmed, missing --uid, too-old and missing targets write nothing; without COPYUID nothing is expunged
result: pass
source: automated
coverage_id: 02-11-D4

### 64. 02-11 D5: --wait-new-seconds IDLEs and reports existsEventSeen, newMessageArrived and idle.newUid; -
expected: --wait-new-seconds IDLEs and reports existsEventSeen, newMessageArrived and idle.newUid; --compare <file|-> reports UIDVALIDITY changes, added/missing folders and sample UID/INTERNALDATE changes; unparseable input exits 1 naming only the source
result: pass
source: automated
coverage_id: 02-11-D5

### 65. 02-12 D1: A second process gets { acquired: false } at once while another holds the mailbox's ingest
expected: A second process gets { acquired: false } at once while another holds the mailbox's ingest lock; other mailboxes are unaffected; after release it acquires
result: pass
source: automated
coverage_id: 02-12-D1

### 66. 02-12 D2: The holder does all session work on one connection, and nested or overlapping session.run 
expected: The holder does all session work on one connection, and nested or overlapping session.run calls are refused before any SQL
result: pass
source: automated
coverage_id: 02-12-D2

### 67. 02-12 D3: The lock never wedges a mailbox: freed on fn throw and on a terminated backend; dead clien
expected: The lock never wedges a mailbox: freed on fn throw and on a terminated backend; dead clients discarded; closed session and invalid id refused
result: pass
source: automated
coverage_id: 02-12-D3

### 68. 02-12 D4: connecting, needs_attention (held count + resume hint), readHold, backfill progress, and a
expected: connecting, needs_attention (held count + resume hint), readHold, backfill progress, and a 25-pair status transition matrix that never violates the mailbox_status checks
result: pass
source: automated
coverage_id: 02-12-D4

### 69. 02-13 D1: The worker's own callbacks store new mail from a real IMAP server exactly once, scoped to 
expected: The worker's own callbacks store new mail from a real IMAP server exactly once, scoped to its mailbox, across polls and a restart, over a pinned STARTTLS connection
result: pass
source: automated
coverage_id: 02-13-D1

### 70. 02-13 D3: A busy lock skips with a log line and no status write; a surge above the cap is held, skip
expected: A busy lock skips with a log line and no status write; a surge above the cap is held, skipped without connecting, then stored after an approval with the hold cleared; a hung LOGOUT still frees the lock
result: pass
source: automated
coverage_id: 02-13-D3

### 71. 02-13 D4: First backfill in throttled slices with backfill progress 2/5, 4/5, then cleared, next to 
expected: First backfill in throttled slices with backfill progress 2/5, 4/5, then cleared, next to new mail
result: pass
source: automated
coverage_id: 02-13-D4

### 72. 02-13 D5: Forced UIDVALIDITY change: no new message rows, every live location in generation 2, folde
expected: Forced UIDVALIDITY change: no new message rows, every live location in generation 2, folder_sync ok with the resync summary
result: pass
source: automated
coverage_id: 02-13-D5

### 73. 02-13 D6: Flags unchanged by a run (D-11); abort before the run stores nothing and records no error;
expected: Flags unchanged by a run (D-11); abort before the run stores nothing and records no error; expired bodies swept; removal diff at most once per 10 minutes
result: pass
source: automated
coverage_id: 02-13-D6

### 74. 02-13 D7: The spawned worker shows connecting (no error) for an unreachable IMAP host and exits 0 on
expected: The spawned worker shows connecting (no error) for an unreachable IMAP host and exits 0 on SIGTERM; no secret persists
result: pass
source: automated
coverage_id: 02-13-D7

### 75. 02-14 D2: ADR-0003 addendum links the findings and resolves raw-prompt retention as the prompt recip
expected: ADR-0003 addendum links the findings and resolves raw-prompt retention as the prompt recipe (D-09)
result: pass
source: automated
coverage_id: 02-14-D2

### 76. 02-14 D3: Committed spike documents hold aggregates only: no header lines, addresses or configured u
expected: Committed spike documents hold aggregates only: no header lines, addresses or configured usernames
result: pass
source: automated
coverage_id: 02-14-D3

### 77. 02-14 D4: The label-test COPY runs from a SELECTed source, so it works against Bridge; stored INBOX 
expected: The label-test COPY runs from a SELECTed source, so it works against Bridge; stored INBOX flags stay unchanged
result: pass
source: automated
coverage_id: 02-14-D4

### 78. 02-15 D1: `sift bridge trust <slug>` shows the SPKI fingerprint and expiry of the certificate the wo
expected: `sift bridge trust <slug>` shows the SPKI fingerprint and expiry of the certificate the worker sees and compares it with imap.tls.pin_sha256: match exits 0; no pin or a different pin exits 1 with the line to paste and the restart command; the config file is byte-identical after every run
result: pass
source: automated
coverage_id: 02-15-D1

### 79. 02-15 D2: Unknown slug, unreachable server and a server without STARTTLS exit 1 with fixed messages;
expected: Unknown slug, unreachable server and a server without STARTTLS exit 1 with fixed messages; a missing slug or an unknown option exits 2 with the usage
result: pass
source: automated
coverage_id: 02-15-D2

### 80. 02-15 D3: The trust command never logs in: on the recording STARTTLS fake, with password_env unset, 
expected: The trust command never logs in: on the recording STARTTLS fake, with password_env unset, its one connection carries exactly one plaintext line (`<tag> STARTTLS`) and zero bytes after the handshake; the source names no file-writing call and no login connection
result: pass
source: automated
coverage_id: 02-15-D3

### 81. 02-15 D4: `sift --help` lists `sift bridge trust <slug>` and still no purge command
expected: `sift --help` lists `sift bridge trust <slug>` and still no purge command
result: pass
source: automated
coverage_id: 02-15-D4

### 82. 02-15 D5: renovate.json manages only the Bridge pin: one custom regex manager whose matchStrings cap
expected: renovate.json manages only the Bridge pin: one custom regex manager whose matchStrings capture github-tags, ProtonMail/proton-bridge, the BRIDGE_VERSION and the BRIDGE_COMMIT values from bridge/Dockerfile; ignoreUnstable; a PR body note that BRIDGE_COMMIT must change with BRIDGE_VERSION
result: pass
source: automated
coverage_id: 02-15-D5

### 83. 02-15 D6: The bridge-image workflow runs scripts/bridge-smoke.sh on PRs and pushes to main that touc
expected: The bridge-image workflow runs scripts/bridge-smoke.sh on PRs and pushes to main that touch bridge/**, the smoke script or the workflow, read-only, with a 45-minute timeout and the same SHA-pinned checkout as ci.yml; actionlint is clean
result: pass
source: automated
coverage_id: 02-15-D6

### 84. 02-16 D2: listMailboxes returns valve counts, backfill progress and message counts; mailbox list ren
expected: listMailboxes returns valve counts, backfill progress and message counts; mailbox list renders connecting, needs attention (resume approved), ok backfilling x of y, error, disabled and never run, with a MESSAGES column
result: pass
source: automated
coverage_id: 02-16-D2

### 85. 02-16 D3: sift mailbox backfill counts, asks, and ingests exactly the counted messages uncapped with
expected: sift mailbox backfill counts, asks, and ingests exactly the counted messages uncapped without moving last_uid, the watermark or the backfill cursor; declined stores nothing and releases the lock; rerun stores no duplicates; mail arriving after the count is not ingested
result: pass
source: automated
coverage_id: 02-16-D3

### 86. 02-16 D4: Lock wait then refusal while the worker holds the mailbox; not-synced, resync, pin-mismatc
expected: Lock wait then refusal while the worker holds the mailbox; not-synced, resync, pin-mismatch, unknown-slug and abort texts; CLI usage, stdin yes, --yes; no password or database URL in output
result: pass
source: automated
coverage_id: 02-16-D4

### 87. 02-19 D1: Criterion 3 on the real mailbox: rows scoped to the mailbox, a worker restart adds no row 
expected: Criterion 3 on the real mailbox: rows scoped to the mailbox, a worker restart adds no row for seen mail (R1 163/163, R2 0, 0 duplicates)
result: pass
source: automated
coverage_id: 02-19-D1

### 88. 02-19 D2: Criterion 4 on the real mailbox: an external email became an eligible row with a body 34 s
expected: Criterion 4 on the real mailbox: an external email became an eligible row with a body 34 s after Bridge reported it (limit 80 s), nothing restarted
result: pass
source: automated
coverage_id: 02-19-D2

### 89. 02-19 D4: The record stays counts-only and its result lines stay well-formed
expected: The record stays counts-only and its result lines stay well-formed
result: pass
source: automated
coverage_id: 02-19-D4

### 14. CI passes on the pushed phase
expected: The ci workflow passes on main after the Phase 2 push (check and compose-smoke jobs green).
result: issue
reported: "errror: https://github.com/k-leumas/sift/actions/runs/37572838343/job/112635131344#step:3:911"
severity: major
note: compose-smoke FAILED "mailboxes ok: expected >= 1, got 0". scripts/compose-smoke.sh:157 points every mailbox at imap.smoke.invalid (no Bridge in CI), but :257 still asserts a mailbox reaches state ok, a Phase 1 (be4ce69) assertion from before the worker connected to IMAP. check job and bridge-image workflow passed.

## Summary

total: 90
passed: 86
issues: 2
pending: 0
skipped: 1
blocked: 1

## Gaps

- gap_id: G-02-4
  truth: "02-SPIKE-FINDINGS.md records the post-spike initial_backfill_days the owner intends"
  status: failed
  reason: "User reported: initial_backfill_days: 3"
  severity: minor
  test: 4
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
- gap_id: G-02-8
  truth: "README tells the owner to keep the host clock NTP-synced, since the watermark caps future INTERNALDATEs at the worker clock (WR-03) and Proton's server time sets INTERNALDATE"
  status: failed
  reason: "User reported: would making a note of this fact somewhere maybe in the readme this way the clocks can be set using the same timeserver and ideally never run into this situation"
  severity: minor
  test: 8
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
- gap_id: G-02-9
  truth: "README states that Sift supports only Proton Mail through Proton Bridge for now, and why (simpler logic, smaller test surface, security)"
  status: failed
  reason: "User reported: lets also make a note in the readme stating tha this only works with protonmail (for now) it simplifies our logic and shrinks the testing surface and more secuirty minded"
  severity: minor
  test: 9
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
- gap_id: G-02-14
  truth: "The ci workflow passes on main after the Phase 2 push"
  status: failed
  reason: "User reported: errror: https://github.com/k-leumas/sift/actions/runs/37572838343/job/112635131344#step:3:911"
  severity: major
  test: 14
  artifacts: []  # Filled by diagnosis
  missing: []    # Filled by diagnosis
