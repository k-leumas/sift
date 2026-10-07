---
phase: "02"
slug: "bridge-spike-and-imap-ingest"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-07"
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Plan |
|----------|-------------|------|
| .env -> bridge and bridge-init containers | Keychain passphrase | 02-01 |
| .env.mailboxes -> bridge-init container | Mailbox password file, mounted only into the one-shot init service (D-39, D-79) | 02-01 |
| app code -> scoped API | The only data path for apps (ISO-04) | 02-06 |
| Bridge -> Proton API | Session tokens in the sift-bridge volume | 02-14 |
| Bridge -> Proton telemetry and update endpoints | Data leaving the machine | 02-08 |
| Bridge gRPC frontend -> sift-helper | IMAP password bytes inside the container | 02-08 |
| capture connection -> login connection | The certificate seen on the first connection must be the one the second connection presents | 02-18 |
| capture handshake | A deliberately unverified TLS session that must carry nothing beyond STARTTLS and the handshake (D-80) | 02-18 |
| CLI process <-> worker process | Concurrent ingest of one mailbox | 02-16 |
| committed phase records -> git | Findings and live-ingest records are committed; they must hold aggregates only | 02-20 |
| config.yaml (owner-edited) -> worker | Owner input decides TLS trust and how much mail is processed | 02-02 |
| container -> host .env.mailboxes (bind mount) | Secret written to the host | 02-08 |
| docs -> owner actions | Wrong or missing steps lead owners into insecure setups | 02-17 |
| host network -> bridge container port 1143 | IMAP listener exposed through socat | 02-01 |
| IMAP server (Bridge) -> worker | Untrusted mail bytes and server responses | 02-09 |
| IMAP server state (UIDs, dates, UIDVALIDITY) -> ingest decisions | A misbehaving or rebuilding server must not cause mass processing | 02-10 |
| local main -> shared remote | Pushing main publishes every gap-closure commit | 02-21 |
| npm registry -> worker dependencies | Third-party IMAP client and parsers | 02-04 |
| owner -> config.yaml pin | Whoever edits the pin decides which Bridge the worker talks to | 02-15 |
| owner CLI -> mailbox | The 3-day backfill reads more of the owner's mail into the database | 02-20 |
| owner CLI (setup or worker container) -> database | Owner commands change processing state | 02-16 |
| owner terminal -> Bridge CLI | Proton password and 2FA typed during init | 02-08 |
| owner's real mailbox -> Postgres -> snapshots and record | Personal data must stay in the database and git-ignored files | 02-19 |
| owner's real mailbox -> probe output | Personal mail must not leak into stdout, files or git | 02-11 |
| owner's real Proton mailbox -> probe reports -> findings doc | Personal data must not cross into git | 02-14 |
| probe -> owner's real mailbox | The only write path in Phase 2 that touches real mail | 02-11 |
| Proton/GitHub source -> Bridge image | Third-party source and Go modules enter the build | 02-01 |
| Renovate PR -> bridge/Dockerfile | Automated change to a pinned supply-chain input | 02-15 |
| sender-controlled headers and bodies -> parser | Every byte is untrusted (SEC-01 groundwork) | 02-07 |
| sift-bridge volume at rest | Session tokens and vault (as sensitive as the Proton password, D-37) | 02-01 |
| smoke stack -> owner's Docker resources | The local verification run shares the Docker daemon with the owner's running sift stack and volumes | 02-21 |
| smoke worker -> network | A smoke worker must never reach a real mail server | 02-21 |
| spike -> real mailbox | The only approved writes to real mail in Phase 2 | 02-14 |
| test IMAP container -> host loopback | A throwaway server with a fixed test password | 02-04 |
| this plan -> owner's database | The simulated method edits one row; the repair rebuilds Bridge's cache | 02-19 |
| untrusted mail fields -> Postgres | Header and body text from senders is stored | 02-06 |
| worker -> Bridge (IMAP) | Credentials and mail | 02-13 |
| worker -> IMAP server (Bridge) over the Compose network | Credentials and mail cross this TCP link | 02-18 |
| worker -> mailbox_status / logs | Owner-visible errors that must not carry secrets or mail | 02-13 |
| worker -> Postgres (sift_app) | Mail-derived rows under RLS | 02-13 |
| worker (sift_app) -> Postgres | Mail-derived rows written under app.mailbox_id | 02-03 |
| worker process <-> CLI process | Two writers for the same mailbox's data | 02-12 |

---

## Threat Register

Evidence paths are relative to the repository root unless shortened to a file name (apps/worker/src, apps/worker/test, packages/*/src, packages/db/migrations, bridge/).

| Threat ID | Plan | Category | Component | Severity | Disposition | Mitigation | Evidence | Status |
|-----------|------|----------|-----------|----------|-------------|------------|----------|--------|
| T-02-SC | 02-01 | Tampering | Bridge source clone, Go module and apt downloads in bridge/Dockerfile | high | mitigate | Tag plus full commit SHA check in the same RUN (`git rev-parse HEAD`), Go modules verified by the pinned go.sum, base images pinned to dated tags; no npm/pip/cargo installs in this plan | Tag+SHA check in same RUN (bridge/Dockerfile:23-25); GOTOOLCHAIN=local (:28); dated base images (:10,:39); go.sum enforced; bridge-image.test.ts:59-66 | closed |
| T-02-01 | 02-01 | Information Disclosure | Bridge vault silently falling back to unencrypted | high | mitigate | entrypoint canary (`pass show sift/canary`) and `bridge-v3/insecure` check exit 78 before Bridge starts; proven by scripts/bridge-smoke.sh | Canary + bridge-v3/insecure exit 78 (entrypoint.sh:141-150) before Bridge start (:208,:219); bridge-smoke.sh:245-261 | closed |
| T-02-02 | 02-01 | Information Disclosure | Copied sift-bridge volume | medium | mitigate | Vault key in pass/GPG behind SIFT_BRIDGE_KEYCHAIN_PASSPHRASE, which is not in the volume and reaches only the bridge and bridge-init services (compose.test.ts); the volume is mounted only by those two (D-72, D-79) | Passphrase from env only (compose.yaml:134,167); volume/passphrase scoped to bridge+bridge-init (compose.test.ts:362-387) | closed |
| T-02-03 | 02-01 | Elevation of Privilege | Bridge port exposed beyond loopback | high | mitigate | Publish `127.0.0.1:${SIFT_BRIDGE_PORT:-1143}:1143` only; compose.test.ts and the negative grep assert no wildcard bind | 127.0.0.1 bind (compose.yaml:141); compose.test.ts:281-283; bridge-image.test.ts:239-249 | closed |
| T-02-04 | 02-01 | Tampering | Self-update replacing the pinned binary | medium | mitigate | Launcher never copied (static test); auto-update switched off in the vault by 02-08 | Only bridge + sift-helper copied (Dockerfile:51-54; bridge-image.test.ts:68-72); auto-update off (helper main.go:182-192) | closed |
| T-02-05 | 02-01 | Information Disclosure | Passphrase visible via docker inspect / process environ | low | accept | Docker access is root-equivalent on this machine; the entrypoint unsets the variable before exec and never echoes it | Accepted; passphrase unset before exec (entrypoint.sh:151); no set -x (bridge-image.test.ts:107-109) | closed |
| T-02-06 | 02-01 | Information Disclosure | .env.mailboxes, its backup or config reachable from the long-running bridge service | medium | mitigate | Only the one-shot bridge-init service (profile tools, never started by `docker compose up`) mounts them; the bridge service mounts only sift-bridge; compose.test.ts and the `docker compose convert` check assert both, and serve mode never reads those paths (D-39, D-79, D-81) | bridge mounts only sift-bridge (compose.yaml:135-138); bridge-init profiles [tools] (:164); compose.test.ts:286-297,313-337,370-376 | closed |
| T-02-07 | 02-01 | Denial of Service | Restart loop of an uninitialised bridge | low | accept | Fixed exit-78 message names the fix; Docker restart backoff caps the loop; the worker does not depend on Bridge (D-32) | Accepted; fixed exit-78 message (entrypoint.sh:124); worker independent of bridge (compose.test.ts:389-392) | closed |
| T-02-62 | 02-01 | Denial of Service | socat dying (or never binding) while Bridge keeps running and the healthcheck stays green, so the worker cannot reach bridge:1143 and nothing restarts | medium | mitigate | serve supervises both children with `wait -n` and exits non-zero when either dies; the healthcheck targets the socat listener on the container IP; bridge-smoke kills socat and requires a non-zero container exit | wait -n then exit 1 (entrypoint.sh:242-251); healthcheck on container IP (compose.yaml:146); bridge-smoke.sh:159-175 | closed |
| T-02-SC | 02-02 | Tampering | package installs | low | accept | This plan installs no packages | Accepted; lockfile/manifests changed only in aec5ba7 (02-04) | closed |
| T-02-08 | 02-02 | Spoofing | A malformed or truncated pin silently disabling the pin check | high | mitigate | pin_sha256 must match the exact base64 SHA-256 shape; the worker pins only a parsed value (02-18/02-13) | Pin shape regex (core/config/schema.ts:24,98-105); config.test.ts:256-268; parsed pin used (mailbox-batch.ts:315, connect.ts:71-94) | closed |
| T-02-09 | 02-02 | Information Disclosure | A plaintext IMAP mode | high | mitigate | tls.mode allows only starttls and implicit (D-42); tested with plaintext-like spellings | TLS_MODES starttls/implicit only (schema.ts:17,91-97); config.test.ts:219 | closed |
| T-02-10 | 02-02 | Denial of Service | Unbounded backfill or cap values | medium | mitigate | Zod bounds 0-365 days and 1-10000 per cycle, tested at both edges | Bounds 0-365 / 1-10000 (schema.ts:28-34,125-134); edge tests config.test.ts:274-298 | closed |
| T-02-SC | 02-03 | Tampering | package installs | low | accept | This plan installs no packages | Accepted; no lockfile change outside 02-04 | closed |
| T-02-11 | 02-03 | Information Disclosure | message_location / message_body read across mailboxes | high | mitigate | NOT NULL mailbox_id, FORCE RLS, single standard policy, composite FKs; catalog check plus the isolation suite over SCOPED_TABLE_NAMES | NOT NULL mailbox_id, composite FKs, single policy (0006:3,19,65-68,81-82); FORCE RLS (0007:1-2); SCOPED_TABLE_NAMES (schema/index.ts:19-29); isolation + catalog tests | closed |
| T-02-12 | 02-03 | Tampering | Duplicate rows on re-ingest | medium | mitigate | UNIQUE (mailbox_id, identity_key) and UNIQUE (mailbox_id, folder, uidvalidity, uid) | UNIQUE constraints (0006:30,73) | closed |
| T-02-13 | 02-03 | Information Disclosure | Bodies stored permanently on message | medium | mitigate | No body column on message; body text only in message_body with expires_at (D-05, D-06) | No body column on message (schema/scoped.ts:58-78); body_text only in message_body with expires_at (:183-196) | closed |
| T-02-63 | 02-03 | Tampering | Migrating a database that already holds rows the new NOT NULL and UNIQUE columns cannot describe | medium | mitigate | 0005 preflight checks every mailbox under its app.mailbox_id and stops the whole migrator transaction with a fixed message; migrate() already backs up before applying; tested in migrate.test.ts | Per-mailbox preflight with fixed message (0005:7-19); backup first (owner/migrate.ts:97-98); migrate.test.ts:360-401 | closed |
| T-02-SC | 02-04 | Tampering | pnpm installs of imapflow, libmime, postal-mime, html-to-text and types | high | mitigate | Owner-approved list (D-77), exact pins older than the 7-day gate, license allowlist test, allowBuilds unchanged so install scripts stay blocked, frozen lockfile, resolved tree recorded in the SUMMARY; this is the only plan that writes the lockfile | Exact pins (apps/worker/package.json:8-11); allowBuilds unchanged, minimumReleaseAge 10080 (pnpm-workspace.yaml:6-11); license allowlist (dependencies.test.ts:31-139); --frozen-lockfile (Dockerfile:28, ci.yml:54); tree in 02-04-SUMMARY:140 | closed |
| T-02-SC | 02-05 | Tampering | package installs | low | accept | This plan installs no packages | Accepted; no installs | closed |
| T-02-19 | 02-05 | Denial of Service | Repeated nudges hammering Bridge | low | mitigate | nudge never bypasses the running guard; one follow-up run at most per successful in-flight run; a failed run drops the nudge and keeps its backoff (tested) | Running guard (supervisor.ts:398-401); one follow-up on success (:226); failure drops nudge (:230); supervisor.test.ts:606,638 | closed |
| T-02-SC | 02-06 | Tampering | package installs | low | accept | This plan installs no packages | Accepted; no installs | closed |
| T-02-20 | 02-06 | Denial of Service | NUL bytes in mail blocking a chunk forever | medium | mitigate | stripNul on every string and jsonb value before insert (Pitfall 7), tested | stripNul on every item (db/src/ingest.ts:94-102,160); ingest.test.ts:339 | closed |
| T-02-21 | 02-06 | Information Disclosure | Upsert writing or matching another mailbox's rows | high | mitigate | mailbox_id prepended to every conflict target and filled into rows; ISO-04 proof on an RLS-bypassing handle | mailboxId filled + leading conflict target (scope.ts:251-257,295,326); RLS-bypass suite scope.test.ts:224-230,326 | closed |
| T-02-22 | 02-06 | Information Disclosure | Bodies kept after mail left the folder unclassified | medium | mitigate | deleteOrphanBodies on vanish (D-07); deleteExpiredBodies sweep; both tested | deleteOrphanBodies (ingest.ts:427-445,537-538; db-store.ts:185-187); deleteExpiredBodies (run.ts:591); ingest.test.ts:575,603 | closed |
| T-02-64 | 02-06 | Tampering | A location or body attached to the wrong message because RETURNING rows were paired with inputs by position | high | mitigate | Message ids are looked up by identity key after insertOrIgnore; locations and bodies take their message id from that Map; shuffled-order test asserts every location's message_id matches its item's key | Id Map by identity_key (ingest.ts:174-177,220,239-245); order test ingest.test.ts:224 | closed |
| T-02-65 | 02-06 | Denial of Service | Two UIDs of one message (shared identity key) in a chunk making PostgreSQL reject the whole INSERT on every retry, wedging the folder | high | mitigate | storeMessages deduplicates keys before the insert and uses ON CONFLICT DO NOTHING for messages and bodies; upsert refuses repeated keys with a TypeError before SQL; same-key-in-one-call test | Key dedupe before insert (ingest.ts:158-171); ON CONFLICT DO NOTHING (:249); repeated-key TypeError (scope.ts:310-315); ingest.test.ts:161,364 | closed |
| T-02-SC | 02-07 | Tampering | package installs | low | accept | No installs here (packages installed and approved in 02-04) | Accepted; packages from 02-04 | closed |
| T-02-23 | 02-07 | Tampering | Forged Message-ID merging a new mail into an old row so it escapes classification | high | mitigate | pm: key from Bridge's overwritten X-Pm-Internal-Id wins for Bridge mailboxes; mid: is only a fallback; tested | pm: only when trusted, mid: fallback (identity.ts:106-115); single X-Pm-Internal-Id (message.ts:139-140); ingest-identity.test.ts:76-91,154-171 | closed |
| T-02-24 | 02-07 | Denial of Service | Oversized headers, bodies or attachment lists | medium | mitigate | Value, count and text caps (2000 / 20 / 32768 code points / 100 attachments), 262144-byte download cap | Caps (message.ts:44-52,100-101,238); BODY_DOWNLOAD_MAX_BYTES (run.ts:191) | closed |
| T-02-25 | 02-07 | Tampering | Script or style content leaking into stored text | low | mitigate | html-to-text selectors skip script, style and img explicitly; no HTML is stored | html-to-text skips img/script/style (message.ts:259-268); text only | closed |
| T-02-SC | 02-08 | Tampering | Go module resolution for sift-helper (yaml.v3, grpc) | medium | mitigate | Only modules already in Bridge's pinned go.mod/go.sum; any go mod download is checksum-verified; no npm/pip/cargo installs | Helper built inside Bridge module, no go get/tidy/GOFLAGS (Dockerfile:28,35-37) | closed |
| T-02-26 | 02-08 | Information Disclosure | IMAP password shown in terminal or logs | high | mitigate | Helper prints only `wrote NAME ...` lines; values validated and never echoed in errors; sentinel check in bridge-smoke.sh | Only `wrote NAME` output (envfile.go:275-278); errors name var not value (:78-101); Bridge output discarded (entrypoint.sh:283); sentinel (bridge-smoke.sh:190-212); envfile_test.go:173,293 | closed |
| T-02-27 | 02-08 | Information Disclosure | Bridge telemetry on by default | high | mitigate | SetIsTelemetryDisabled(true), read back and printed; verified by bridge-smoke.sh | SetIsTelemetryDisabled(true) + read-back (helper main.go:170-180); bridge-smoke.sh:207 | closed |
| T-02-28 | 02-08 | Tampering | Automatic update replacing the pinned Bridge | medium | mitigate | SetIsAutomaticUpdateOn(false) read back; launcher never shipped (02-01) | SetIsAutomaticUpdateOn(false) + read-back (main.go:182-192); launcher absent (Dockerfile:51-54) | closed |
| T-02-29 | 02-08 | Spoofing | Owner pinning a fingerprint they did not see from their own Bridge | medium | mitigate | init prints the fingerprint at login time; `sift bridge trust` (02-15) shows what the worker sees, so the owner compares two independent readings (D-73) | Fingerprint printed at init (entrypoint.sh:322-324); second reading via bridge-trust.ts:114-148 | closed |
| T-02-30 | 02-08 | Tampering | .env.mailboxes clobbered or replaced by a directory | medium | mitigate | Regular-file check (exit 2), 0600 host-side backup `.env.mailboxes.bak` before writing and no write without it (D-79), in-place write without temp file or rename into the existing files, inode and mode preserved (D-81); tested | Regular-file check exit 2 (envfile.go:221-229); no backup no write (:238-240); in-place O_TRUNC (:61-64); inode tests envfile_test.go:199-316 | closed |
| T-02-61 | 02-08 | Information Disclosure | Host-side `.env.mailboxes.bak` holding Bridge IMAP passwords | medium | mitigate | BackupInPlace forces mode 0600; the repository's `.env.*` ignore rule keeps it out of git (git-ignore case in bridge-image.test.ts); the owner pre-creates it with mode 600 (D-81); the output and README name the file so the owner can clear it (D-79) | Backup chmod 0600 (envfile.go:199); `.env.*` ignored (.gitignore:70); bridge-image.test.ts:214-225; named in README:332,443 | closed |
| T-02-SC | 02-09 | Tampering | package installs | low | accept | No installs in this plan | Accepted; no installs | closed |
| T-02-31 | 02-09 | Tampering | Ingest changing read state or flags | medium | mitigate | EXAMINE (readOnly) plus ImapFlow BODY.PEEK fetches; static ban on flag/copy/move/delete/append calls; flags-unchanged Dovecot test (D-11) | readOnly open, fail closed on read-write (folder-source.ts:203-210); static-ban grep re-run 0 hits; flags-unchanged tests (imap-folder-source.test.ts:324-350, ingest-e2e.test.ts:250-253) | closed |
| T-02-32 | 02-09 | Denial of Service | Huge part downloads | medium | mitigate | download maxBytes (262144 from 02-07); only the selected text part is fetched; attachments never downloaded | maxBytes+1, selected part only (folder-source.ts:290-311); attachments metadata only (message.ts:233-249) | closed |
| T-02-33 | 02-09 | Denial of Service | Fetch-iterator deadlock or unbounded UID command lines | low | mitigate | fetchAll only; toUidSet compresses UID lists | fetchAll only (folder-source.ts:221,232); toUidSet (:35-53) | closed |
| T-02-SC | 02-10 | Tampering | package installs | low | accept | No installs in this plan | Accepted; no installs | closed |
| T-02-34 | 02-10 | Denial of Service | Bridge cache rebuild or UIDVALIDITY reset presenting thousands of "new" UIDs | high | mitigate | INTERNALDATE gate on polling and resync, and the volume valve before any write (D-19, D-26); tested with renumbered UIDs | INTERNALDATE valve before fetch/write (run.ts:300-311,447-471); ingest-resync.test.ts:279, ingest-engine.test.ts:478 | closed |
| T-02-35 | 02-10 | Tampering | Partial resync corrupting location state | medium | mitigate | Generation tagging; the previous generation stays authoritative until finishResync in one transaction; retry tested (D-23) | Pending generation (run.ts:435-436); finishResync in one session.run (db-store.ts:201-219); crash/retry tests ingest-resync.test.ts:326-416 | closed |
| T-02-36 | 02-10 | Denial of Service | A 30-day first backfill starving new mail or Bridge | medium | mitigate | Per-cycle slice (200), pause between chunks, run after new-mail work each cycle (D-75) | Slice 200, 250 ms pause, backfill after new mail (run.ts:41,43,383,582-586); ingest-engine.test.ts:181,226 | closed |
| T-02-37 | 02-10 | Information Disclosure | Engine logs leaking mail content | medium | mitigate | Logs carry counts, UIDs and folder names only; identity keys and subjects are never logged | Logs carry folder/counts/dates only (run.ts:130-137,258-264,306-309,466-469,547; plan.ts:83-89; mailbox-batch.ts:367-396) | closed |
| T-02-66 | 02-10 | Tampering | A valve trip during a resync leaving a half-written new generation beside the old one | high | mitigate | Two-pass resync: the count pass writes nothing; over the cap returns before any commitChunk; store-event test asserts no commit, setBackfill or finishResync after a trip (D-23, D-26) | Count pass writes nothing, returns before commitChunk (run.ts:438-471); ingest-resync.test.ts:279-302 | closed |
| T-02-67 | 02-10 | Tampering | Worker and Bridge clocks disagreeing, so new mail after startup is stored as history and never classified | medium | mitigate | First-sync watermark = max(server's newest INTERNALDATE, now - 10 minutes), tolerating 15 minutes of lag with the overlap while keeping D-20; watermark age logged; lagging-clock and quiet-inbox tests | max(newest, now-10min) watermark, age logged (run.ts:49,254-264); ingest-engine.test.ts:117,140,157 | closed |
| T-02-SC | 02-11 | Tampering | package installs | low | accept | No installs in this plan | Accepted risk in 02-11-PLAN threat_model; no package-file commit after aec5ba7 (02-04) | closed |
| T-02-38 | 02-11 | Information Disclosure | Probe output containing subjects, senders, addresses or label names | high | mitigate | Report schema holds counts, hashes, UIDs and dates only; sentinel and email-pattern scan over stdout and stderr in tests | ProbeReport (probe.ts:30-99) counts/hashes/UIDs/dates only; sentinel+email scan bridge-probe.test.ts:125-129 | closed |
| T-02-39 | 02-11 | Tampering | Probe modifying mail beyond the approved test | high | mitigate | Read-only by default; the label test needs --label-test plus typed LABEL; it touches one UID in one dedicated label folder; flags-unchanged and count assertions | --label-test + --uid (bridge-probe.ts:143-144) + typed LABEL (probe.ts:482-484,563); flags/count tests bridge-probe.test.ts:448-485 | closed |
| T-02-40 | 02-11 | Information Disclosure | IMAP password in probe errors | medium | mitigate | redactText with the password value; classifyImapError classes instead of raw messages | redactText(message,[pass]) + classifyImapError (bridge-probe.ts:202,277); test bridge-probe.test.ts:345-350 | closed |
| T-02-68 | 02-11 | Tampering | The label test expunging the only copy of a message, or running against the wrong (older) message | high | mitigate | Explicit --uid only; targets older than one hour refused; expunge only of the COPYUID-identified label copy after the original is confirmed present; no-COPYUID and too-old cases tested | explicit --uid (bridge-probe.ts:143); 1h age gate (probe.ts:578); COPYUID-only expunge after original confirmed (probe.ts:628-633); tests bridge-probe.test.ts:499,555 | closed |
| T-02-SC | 02-12 | Tampering | package installs | low | accept | No installs in this plan | Accepted risk in 02-12-PLAN; no installs | closed |
| T-02-41 | 02-12 | Tampering | Worker and CLI ingesting one mailbox concurrently | medium | mitigate | Session advisory lock per mailbox (D-03), tested with two AppDb instances; auto-release on disconnect | session pg_try_advisory_lock (lock.ts:129-131); two-AppDb test lock.test.ts:97-129; disconnect release lock.test.ts:225 | closed |
| T-02-42 | 02-12 | Denial of Service | Pool exhaustion deadlock across mailboxes | medium | mitigate | Scoped transactions run on the lock's own client (one connection per active mailbox); connection count asserted in tests | holdSession on lock's own client (lock.ts:59,135); backend count asserted lock.test.ts:132-157 | closed |
| T-02-69 | 02-12 | Tampering | A nested or overlapping session.run sending a second BEGIN on the lock client, or two mailboxes sharing one advisory key | medium | mitigate | IngestSessionBusyError guard before any SQL (tested nested and overlapping); 64-bit hashtextextended key instead of 32-bit hashtext | IngestSessionBusyError before SQL (lock.ts:71); hashtextextended 64-bit key (lock.ts:130); tests lock.test.ts:159,183 | closed |
| T-02-SC | 02-13 | Tampering | package installs | low | accept | No installs in this plan | Accepted risk in 02-13-PLAN; no installs | closed |
| T-02-43 | 02-13 | Information Disclosure | IMAP password in last_error or logs | high | mitigate | Owner messages are fixed templates; other errors go through recordSyncError with redactText(secrets); no-secret-leak and mailbox-batch tests | fixed templates (mailbox-batch.ts:77-108); recordSyncError redaction (status.ts:45); supervisor.ts:117; tests mailbox-batch.test.ts:280-293, no-secret-leak.test.ts:154 | closed |
| T-02-44 | 02-13 | Spoofing | Worker connecting to an impostor Bridge | high | mitigate | openImap's TLS-only, pinned and twice-verified connection (02-18, D-80) with the pin from config (D-73); a mismatch is a fail-closed state naming `sift bridge trust <slug>`; tested against the test server | openImap with config pin (mailbox-batch.ts:310-316); mismatch names `sift bridge trust` (:79); no-client test mailbox-batch.test.ts:202-217 | closed |
| T-02-45 | 02-13 | Information Disclosure | Cross-mailbox writes from ingest | high | mitigate | Every write goes through IngestSession.run (app.mailbox_id plus explicit mailbox filter); ISO-04 lint guard on apps/**/src | all writes via session.run (db-store.ts:114-223); app.mailbox_id + explicit filter (scope.ts:455,271); ISO-04 lint guard biome.json:36-54 | closed |
| T-02-46 | 02-13 | Denial of Service | Mass ingestion after a Bridge rebuild | high | mitigate | Volume hold (needs_attention) before any write on polling and resync; approval needed to continue (D-26) | valve before writes in polling (run.ts:304-311) and resync count pass (run.ts:465-471); approval gate mailbox-batch.ts:303-306; tests mailbox-batch.test.ts:315, ingest-resync.test.ts:279 | closed |
| T-02-73 | 02-13 | Denial of Service | A server that never answers LOGOUT holding the mailbox's ingest lock and connection forever | low | mitigate | closeImap bounded at 5 s inside the lock's finally; hung-logout test proves the lock is free afterwards | closeImap bounded 5s (connect.ts:60,167-186) in lock finally (mailbox-batch.ts:352-356); hung-logout test mailbox-batch.test.ts:352-368 | closed |
| T-02-SC | 02-14 | Tampering | package installs | low | accept | No installs; images built from the pinned sources of 02-01/02-08 | Accepted risk in 02-14-PLAN; images from pinned sources | closed |
| T-02-47 | 02-14 | Information Disclosure | Real mail data committed via findings or reports | high | mitigate | Raw reports only under git-ignored data/spike; findings hold aggregates; doc-contract test scans for addresses and header lines; `git status` check in acceptance | data/ ignored (.gitignore:158); privacy scan spike-findings.test.ts:80-81; porcelain empty (re-run 2026-10-07) | closed |
| T-02-48 | 02-14 | Tampering | Spike modifying real mail beyond approval | high | mitigate | Owner approval levels (full / no-repair / read-only); the label test touches only the owner's fresh test email via the confirmed probe path (02-11) | process: owner approval `no-repair` (02-14-SUMMARY:139); label test via gated probe on fresh self-sent mail (02-SPIKE-FINDINGS:95-96) | closed |
| T-02-49 | 02-14 | Information Disclosure | Proton password or IMAP password exposure during login | high | mitigate | Login typed into Bridge's no-echo CLI; the password goes straight to .env.mailboxes (02-08); presence-only checks | Bridge no-echo CLI login (entrypoint.sh:362-375); helper writes .env.mailboxes; presence-only checks (02-14-SUMMARY:187) | closed |
| T-02-70 | 02-14 | Tampering | A spike step rewriting or truncating .env.mailboxes while the owner believes the step is read-only | medium | mitigate | The repair path runs only `bridge-init repair` (no configure); the address mode comes from the owner's init output | repair_mode runs only `sift-helper repair` (entrypoint.sh:385-394) | closed |
| T-02-SC | 02-15 | Tampering | Renovate-proposed Bridge bumps | medium | mitigate | Tag plus commit bumped together; the Dockerfile's commit check fails a mismatched bump; CI builds and smoke-tests each PR; the owner merges | renovate regex captures tag+commit (renovate.json:10); Dockerfile commit check (bridge/Dockerfile:22-25); PR CI (bridge-image.yml:13-17); no automerge | closed |
| T-02-50 | 02-15 | Spoofing | Blindly accepting an attacker's certificate | high | mitigate | The command never writes trust; the owner compares two independent readings (init output inside the Bridge container, and what the worker sees) before editing config (D-73) | bridge-trust.ts prints/compares only (:114-150); config unchanged test bridge-trust.test.ts:98; README:538-548 | closed |
| T-02-51 | 02-15 | Information Disclosure | Credentials sent while inspecting an unknown certificate | high | mitigate | Uses capturePeerCertificate only, whose connection carries nothing beyond STARTTLS and the TLS handshake (wire-tested in 02-18, D-80); static check that the command never calls openImap | capturePeerCertificate only (bridge-trust.ts:108); no openImap/password_env; wire test bridge-trust.test.ts:218-239 | closed |
| T-02-52 | 02-15 | Elevation of Privilege | Renovate managing unrelated dependencies against the repo's age gate | low | mitigate | enabledManagers limited to the custom regex manager | enabledManagers ["custom.regex"] (renovate.json:4); bridge-image.test.ts:286 | closed |
| T-02-SC | 02-16 | Tampering | package installs | low | accept | No installs in this plan | Accepted risk in 02-16-PLAN; no installs | closed |
| T-02-53 | 02-16 | Tampering | Backfill and worker ingesting one mailbox at once | medium | mitigate | withIngestLock held from count through ingest, with a bounded wait then refusal (D-03); tested with a held lock | withIngestLock with bounded wait/refusal (mailbox-backfill.ts:190-206); held-lock test mailbox-ops.test.ts:433-466 (lock split per WR-02 owner override 2026-10-07) | closed |
| T-02-54 | 02-16 | Denial of Service | An uncapped backfill the owner did not expect | medium | mitigate | Count printed and an explicit `yes` required before anything is ingested (D-75); --days limited to 1-365 | count + explicit yes (mailbox-backfill.ts:208-219,352-357); --days 1-365 (:267-271); tests mailbox-ops.test.ts:576-592 | closed |
| T-02-55 | 02-16 | Information Disclosure | Password or mail content in CLI output | medium | mitigate | Counts-only output lines; ownerMessageFor templates; redaction of the password value; tested | counts-only, ownerMessageFor, redaction (mailbox-backfill.ts:114,137,360); mailbox-ops.test.ts:312,635 | closed |
| T-02-SC | 02-17 | Tampering | package installs | low | accept | No installs in this plan | Accepted risk in 02-17-PLAN; no installs | closed |
| T-02-56 | 02-17 | Information Disclosure | Owner unaware the Bridge volume holds live session tokens | medium | mitigate | Verbatim D-37 wording plus the passphrase, backup and removal guidance, pinned by test | D-37 wording + passphrase guidance README:327-332; user-facing-text.test.ts:98,100 | closed |
| T-02-57 | 02-17 | Spoofing | Owner pasting a pin without comparing | medium | mitigate | README tells the owner to compare the init fingerprint with `sift bridge trust <slug>` before updating a pin (D-73) | compare-before-replace README:326,538-548; user-facing-text.test.ts:95 | closed |
| T-02-58 | 02-17 | Information Disclosure | Unencrypted disk holding mail metadata and cached bodies | medium | mitigate | Full-disk encryption documented as a requirement (D-10), pinned by test | full-disk encryption README:333,395; user-facing-text.test.ts:101-102 | closed |
| T-02-SC | 02-18 | Tampering | package installs | low | accept | This plan installs nothing; imapflow is installed and audited in 02-04 | Accepted risk in 02-18-PLAN; imapflow audited in 02-04 | closed |
| T-02-14 | 02-18 | Information Disclosure | STARTTLS stripping on the Compose network | high | mitigate | `doSTARTTLS: true` with `secure: false`, or implicit TLS; fake-server tests prove no login command without TLS (D-42) | doSTARTTLS/secure (connect.ts:139); plaintext guard (:102-126); imap-connect.test.ts:204-258 | closed |
| T-02-15 | 02-18 | Spoofing | Swapped Bridge or attacker presenting another certificate | high | mitigate | Capture, compare with the configured pin, then `ca` plus an SPKI checkServerIdentity on the login connection; a mismatch fails before a client exists (D-40, D-73) | capture→compare→ca+SPKI checkServerIdentity (connect.ts:74-96); imap-connect.test.ts:119-130 | closed |
| T-02-16 | 02-18 | Spoofing | Verification turned off on a connection that carries credentials or data | high | mitigate | Only capture.ts turns it off (static test); a wire-level test proves that socket carries only STARTTLS and the handshake; the exception is recorded in D-80, RESEARCH Open Question 2 and the cerebrum Decision Log | rejectUnauthorized:false only capture.ts:152 (static test imap-capture.test.ts:186-192); wire tests :39-75; D-80 recorded | closed |
| T-02-17 | 02-18 | Spoofing | Self-signed server accepted when no pin is configured | high | mitigate | No-pin path keeps Node's default chain and hostname verification; tested as cert_untrusted | no-pin path default verification (connect.ts:72); cert_untrusted test imap-connect.test.ts:132-135 | closed |
| T-02-18 | 02-18 | Information Disclosure | ImapFlow logging the login exchange | medium | mitigate | `logger: false`; classifyImapError never returns message text | logger:false (connect.ts:142; imap-connect.test.ts:337); classifyImapError codes only (connect.ts:240-274) | closed |
| T-02-59 | 02-18 | Spoofing | Server swapping its certificate between the capture and the login connection | high | mitigate | The login connection is verified twice (`ca: [captured PEM]` and the SPKI checkServerIdentity re-check); tested with an unrelated certificate and with one issued by the captured certificate, in both TLS modes, each failing before any login command (D-80) | double verification (connect.ts:83-95); swap tests both modes imap-connect.test.ts:181-202 | closed |
| T-02-60 | 02-18 | Tampering | Captured certificate persisted or reused across connections (stale trust, or a planted file) | medium | mitigate | In memory only, a local of each openImap call, recaptured on every call including after errors; static check for filesystem imports; spy test counts one capture per call (D-73, D-80) | cert local to loginTls (connect.ts:74); no-fs static test imap-capture.test.ts:198-201; spy test imap-connect.test.ts:144-177 | closed |
| T-02-SC | 02-19 | Tampering | package installs | low | accept | No installs; images built from the pinned sources of 02-01/02-08 and the locked workspace | Accepted risk in 02-19-PLAN; locked workspace | closed |
| T-02-71 | 02-19 | Information Disclosure | Live-ingest record or snapshots leaking mail content into git | high | mitigate | Snapshots are counts-only JSON under git-ignored data/live/; the record holds numbers only; live-ingest-record.test.ts runs the shared privacy scan with the owner's username denylist; `git status --porcelain data/ backups/` must be empty | data/, backups/* ignored (.gitignore:153,158); privacy scan live-ingest-record.test.ts:18,91-92; porcelain empty | closed |
| T-02-72 | 02-19 | Tampering | The forced UIDVALIDITY step damaging stored data | medium | mitigate | Owner approval per method; a pg_dump into git-ignored backups/ first; simulate edits only folder_sync.uidvalidity of one folder with the worker stopped; the resync itself is the tested 02-10 engine; C1-C3 checks | process: owner `ready: simulate`, pg_dump first, one-row edit, C1-C3 pass (02-LIVE-INGEST:85-117) | closed |
| T-02-74 | 02-19 | Tampering | The live run changing the owner's real mailbox | high | mitigate | Ingest is read-only (EXAMINE, BODY.PEEK, 02-09); the only Bridge-side action is the owner-approved repair through bridge-init | EXAMINE fail-closed on read-write (folder-source.ts:203-210); \Seen-unchanged test imap-folder-source.test.ts:350 | closed |
| T-02-SC | 02-20 | Tampering | package installs | low | accept | No installs in this plan | Accepted risk in 02-20-PLAN; no installs | closed |
| T-02-75 | 02-20 | Spoofing | README pin guidance | medium | mitigate | The rewritten pin bullet says the pin is required for Bridge and that X-Pm-Internal-Id trust depends on it (WR-04); `imap.tls.pin_sha256` stays pinned by user-facing-text.test.ts | README:109,326 pin required; user-facing-text.test.ts:103 | closed |
| T-02-76 | 02-20 | Tampering | Host clock drift turning new mail into history (missed mail) | medium | mitigate | README Requirements bullet for an NTP-synced host clock with macOS and Linux checks, pinned by test (G-02-8) | NTP bullet README:396; user-facing-text.test.ts:207-212 | closed |
| T-02-77 | 02-20 | Information Disclosure | Corrections in 02-SPIKE-FINDINGS.md and 02-LIVE-INGEST.md | low | mitigate | Corrections carry dates, config values and command names only; privacy-scan cases run in the main checkout with the config username denylist | dated corrections values-only; privacy scan spike-findings.test.ts:18,80; live-ingest-record.test.ts:92 | closed |
| T-02-78 | 02-20 | Denial of Service | Owner-run 3-day backfill | low | accept | Count-and-confirm CLI (D-75) under the ingest lock; the owner sees the count before anything is stored | Accepted risk; count-and-confirm under lock (mailbox-backfill.ts:208-222) | closed |
| T-02-SC | 02-21 | Tampering | package installs | low | accept | No installs in this plan | Accepted risk in 02-21-PLAN; no installs | closed |
| T-02-79 | 02-21 | Tampering | Local smoke run against the owner's Docker | high | mitigate | Run with COMPOSE_PROJECT_NAME=sift-smoke and SIFT_DB_PORT=55433. The script refuses sift-pgdata, sift-bridge and projects with non-smoke containers (WR-01, WR-09). --down only with SMOKE_ALLOW_VOLUME_REMOVAL=yes, and it removes only sift-smoke-* volumes; the acceptance check confirms sift-pgdata still exists | refuses sift-pgdata/sift-bridge (compose-smoke.sh:77-82), non-smoke projects (:98-107), --down gate (:86-90) | closed |
| T-02-80 | 02-21 | Information Disclosure | Smoke worker reaching a real mailbox | medium | mitigate | Hosts stay rewritten to imap.smoke.invalid. The new check accepts only connecting or error, so a smoke worker that ever synced (ok) would fail the smoke | imap.smoke.invalid (compose-smoke.sh:161-162); connecting/error only (:272-283) | closed |
| T-02-81 | 02-21 | Repudiation | A weakened smoke check turning CI green without proving anything | medium | mitigate | The emulated-stack tests fail when an enabled mailbox has no reachable-state row, and fail if an ok-state query returns. A mailboxes-enabled floor of 1 blocks a vacuous pass. RED against the pre-fix script is recorded | fail tests compose-smoke.test.ts:590-610; enabled floor (compose-smoke.sh:263); RED recorded (02-21-SUMMARY:134) | closed |
| T-02-82 | 02-21 | Tampering | Push to the shared main | low | mitigate | The owner pushes (blocking checkpoint); Claude only reads CI results through gh | owner pushed; Claude read CI via gh only (02-21-SUMMARY:114-127) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-05 (02-01) | Docker access is root-equivalent on this machine; the entrypoint unsets the variable before exec and never echoes it | Owner (plan 02-01 approval) | 2026-10-07 |
| AR-02-02 | T-02-07 (02-01) | Fixed exit-78 message names the fix; Docker restart backoff caps the loop; the worker does not depend on Bridge (D-32) | Owner (plan 02-01 approval) | 2026-10-07 |
| AR-02-03 | T-02-SC (02-02) | This plan installs no packages | Owner (plan 02-02 approval) | 2026-10-07 |
| AR-02-04 | T-02-SC (02-03) | This plan installs no packages | Owner (plan 02-03 approval) | 2026-10-07 |
| AR-02-05 | T-02-SC (02-05) | This plan installs no packages | Owner (plan 02-05 approval) | 2026-10-07 |
| AR-02-06 | T-02-SC (02-06) | This plan installs no packages | Owner (plan 02-06 approval) | 2026-10-07 |
| AR-02-07 | T-02-SC (02-07) | No installs here (packages installed and approved in 02-04) | Owner (plan 02-07 approval) | 2026-10-07 |
| AR-02-08 | T-02-SC (02-09) | No installs in this plan | Owner (plan 02-09 approval) | 2026-10-07 |
| AR-02-09 | T-02-SC (02-10) | No installs in this plan | Owner (plan 02-10 approval) | 2026-10-07 |
| AR-02-10 | T-02-SC (02-11) | No installs in this plan | Owner (plan 02-11 approval) | 2026-10-07 |
| AR-02-11 | T-02-SC (02-12) | No installs in this plan | Owner (plan 02-12 approval) | 2026-10-07 |
| AR-02-12 | T-02-SC (02-13) | No installs in this plan | Owner (plan 02-13 approval) | 2026-10-07 |
| AR-02-13 | T-02-SC (02-14) | No installs; images built from the pinned sources of 02-01/02-08 | Owner (plan 02-14 approval) | 2026-10-07 |
| AR-02-14 | T-02-SC (02-16) | No installs in this plan | Owner (plan 02-16 approval) | 2026-10-07 |
| AR-02-15 | T-02-SC (02-17) | No installs in this plan | Owner (plan 02-17 approval) | 2026-10-07 |
| AR-02-16 | T-02-SC (02-18) | This plan installs nothing; imapflow is installed and audited in 02-04 | Owner (plan 02-18 approval) | 2026-10-07 |
| AR-02-17 | T-02-SC (02-19) | No installs; images built from the pinned sources of 02-01/02-08 and the locked workspace | Owner (plan 02-19 approval) | 2026-10-07 |
| AR-02-18 | T-02-SC (02-20) | No installs in this plan | Owner (plan 02-20 approval) | 2026-10-07 |
| AR-02-19 | T-02-78 (02-20) | Count-and-confirm CLI (D-75) under the ingest lock; the owner sees the count before anything is stored | Owner (plan 02-20 approval) | 2026-10-07 |
| AR-02-20 | T-02-SC (02-21) | No installs in this plan | Owner (plan 02-21 approval) | 2026-10-07 |

*Accepted risks do not resurface in future audit runs.*

---

## Auditor Observations (non-blocking)

These do not change any status. Each declared mitigation is present; the notes record residual risk or test gaps for later phases.

1. **T-02-01 (resolved 2026-10-07):** the `bridge-v3/insecure` refusal was checked only statically. scripts/bridge-smoke.sh now plants the insecure vault file on an initialised volume and requires exit 78 with the refusal message, even with the right passphrase.
2. **T-02-31 (resolved 2026-10-07):** the ingest static ban was a one-time grep. apps/worker/test/read-only-ingest.test.ts now fails on any ImapFlow write call or non-read-only mailboxOpen outside `spike/probe.ts` (the owner-run probe), and self-checks its patterns against the probe's write calls.
3. **T-02-06:** the `docker compose convert` check was one-time (02-01-SUMMARY:108,235); compose.test.ts is the lasting coverage.
4. **T-02-67 / T-02-76 / review WR-01 (open):** a watermark already stored in the future is never lowered (run.ts:297-299). Latent; the README NTP requirement lowers the likelihood.
5. **T-02-23 / review WR-04:** any pinned mailbox is treated as Bridge (mailbox-batch.ts:195-197), so a pinned non-Bridge server would be trusted for `pm:` keys. WR-04 awaits human verification.
6. **T-02-19:** `nudge()` on an idle mailbox in backoff sets nextRunAt=now (supervisor.ts:402-404), skipping backoff. No Phase 2 caller.
7. **T-02-30:** CR-02 now forces the env file to 0600 in place (envfile.go:246, same inode) instead of preserving the mode — a stronger control than planned.
8. **T-02-81 / review WR-02 (open):** a reused local smoke volume can let rows from an earlier run satisfy the status wait (compose-smoke.sh:272-283). CI is unaffected (fresh runner plus `--down`).
9. **T-02-56:** the volume backup-exclusion and removal lines (README:330-331) are present but not pinned by their own test.
10. **T-02-40:** probe errors print the error class plus the redacted raw message (bridge-probe.ts:277), not the class alone; the password stays masked.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-07 | 103 (83 mitigate, 20 accept; register rows incl. per-plan T-02-SC) | 103 | 0 | gsd-security-auditor ×2 (plans 02-01..10, 02-11..21), ASVS L1, block_on high |
| 2026-10-07 | 103 | 103 | 0 | Follow-up: observations 1 and 2 closed by read-only-ingest.test.ts and the bridge-smoke insecure-vault step |

## Security Audit 2026-10-07
| Metric | Count |
|--------|-------|
| Threats found | 103 |
| Closed | 103 |
| Open | 0 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-07
