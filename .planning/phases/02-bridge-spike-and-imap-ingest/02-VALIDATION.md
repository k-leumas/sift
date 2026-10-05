---
phase: "2"
slug: "bridge-spike-and-imap-ingest"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-05"
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.2 (globalSetup migrates a template DB) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run <touched test file(s)>` |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm test` |
| **Estimated runtime** | ~90 seconds (Dovecot adapter tests add container startup) |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched test file(s)
- **After every plan wave:** Run `pnpm lint && pnpm typecheck && pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green, plus the owner-run spike and a manual end-to-end check
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

Seeded from RESEARCH.md § Validation Architecture; task IDs are filled once plans exist.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 02-01-T1 | 02-01 | 1 | ING-01 / D-30, D-38 | T-02-SC, T-02-01, T-02-04, T-02-62 | Bridge built from pinned tag+SHA; keychain fails closed (exit 78); STARTTLS through loopback port; fingerprint logged; healthcheck on the socat listener; a dead socat stops the container | static + docker smoke | `pnpm vitest run apps/worker/test/bridge-image.test.ts && scripts/bridge-smoke.sh` | ❌ W0 (created in task) | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | D-29..D-38, D-72, D-79, D-81 | T-02-02, T-02-03, T-02-06 | Compose: loopback port; external volume only on bridge and bridge-init; passphrase only on those two; .env.mailboxes, config and the long-syntax backup bind only on the one-shot bridge-init (profile tools), bridge still mounts only sift-bridge; Compose v2.2.3 resolves the long syntax without create_host_path; no worker depends_on bridge; smoke isolated | static + `docker compose convert` (dummy env) + smoke | `pnpm vitest run apps/worker/test/compose.test.ts apps/worker/test/compose-smoke.test.ts` plus the Task 2 convert check | ✅ (update) | ⬜ pending |
| 02-02-T1/T2 | 02-02 | 1 | D-73, D-74 (ING-01..03) | T-02-08, T-02-09, T-02-10 | tls.mode starttls/implicit only; pin_sha256 shape enforced; ingest defaults 30/200; strictness kept | unit | `pnpm vitest run packages/core packages/db/test/registry-plan.test.ts apps/worker/test/drift.test.ts` | ✅ (extend) | ⬜ pending |
| 02-03-T1/T2 | 02-03 | 1 | ING-02, ING-04 | T-02-11, T-02-12, T-02-13, T-02-63 | New tables pass catalog + isolation; check constraints; bigint UIDs; preflight refuses pre-existing rows; every fixture updated | DB integration | `pnpm vitest run packages/db` | ✅ (update) | ⬜ pending |
| 02-04-T1 | 02-04 | 1 | ING-01 / D-40, D-73 | T-02-15 | SPKI fingerprint equals openssl's on the wire | integration (Dovecot) | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/imap-pin.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-04-T2 | 02-04 | 1 | D-77 | T-02-SC | Exact pins, license allowlist, allowBuilds unchanged, frozen install | unit | `pnpm install --frozen-lockfile && pnpm vitest run apps/worker/test/dependencies.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-04-T3 | 02-04 | 1 | ING-01 (CI) | T-02-SC | CI starts the IMAP test server before Test, so IMAP tests fail loudly instead of never running | static | `pnpm vitest run apps/worker/test/ci-workflow.test.ts` | ✅ (extend) | ⬜ pending |
| 02-18-T1 | 02-18 | 2 | ING-01 / D-40, D-73, D-80 | T-02-15 | Pinned login end to end: capture, SPKI compare, login connection verified by `ca` plus the SPKI re-check | integration (Dovecot) | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/imap-connect.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-18-T2 | 02-18 | 2 | ING-01 / D-42, D-80 | T-02-14, T-02-16, T-02-60 | Capture connection carries only STARTTLS and the TLS handshake (wire-level: one plaintext line, zero bytes after the handshake); verification-off only in capture.ts; no filesystem import | wire-level (recording fake TLS server) + static | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/imap-capture.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-18-T3 | 02-18 | 2 | ING-01 / D-40, D-42, D-73, D-74, D-80 | T-02-15, T-02-17, T-02-18, T-02-59, T-02-60 | Pin mismatch before any client; certificate swapped between capture and login fails before any login command (chain and SPKI cases, both TLS modes); no pin + self-signed: cert_untrusted; no STARTTLS: no_starttls; fresh capture per call | integration + fake TLS server | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/imap-connect.test.ts apps/worker/test/imap-capture.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-05-T1/T2 | 02-05 | 1 | D-28, D-04 (ING-03) | T-02-19 | nudge() runs a due mailbox, never overlapping; shutdown aborts the batch signal | unit (fake timers) | `pnpm vitest run apps/worker/test/supervisor.test.ts` | ✅ (extend) | ⬜ pending |
| 02-06-T1/T2 | 02-06 | 2 | ING-02, ING-04 / D-07, D-14, D-23 | T-02-20, T-02-21, T-02-22, T-02-64, T-02-65 | Idempotent storeMessages (updated_at unchanged); same identity twice in one call merges; locations matched by identity key, not position; orphan-body delete; generation resync; ISO-04 on insertOrIgnore/upsert | DB integration | `pnpm vitest run packages/db/test/ingest.test.ts packages/db/test/scope.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-07-T1/T2 | 02-07 | 2 | ING-02 / D-12, D-13, D-06 | T-02-23, T-02-24 | pm: key wins for Bridge; NUL stripped; caps on code points | unit | `pnpm vitest run apps/worker/test/ingest-identity.test.ts apps/worker/test/ingest-message.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-08-T1/T2 | 02-08 | 2 | ING-01 / D-36, D-39, D-72, D-73, D-79, D-81 | T-02-26..T-02-30, T-02-61 | Telemetry and auto-update off; password only into .env.mailboxes, after a 0600 backup in the pre-created .env.mailboxes.bak (no backup, no write; refusal names the touch/chmod step); both files written in place, inode unchanged, no rename or temp file; fingerprint printed; no-TTY, non-file and wrong-service refusals | docker smoke + go test in build | `docker build -q bridge && scripts/bridge-smoke.sh` | ❌ W0 (created in task) | ⬜ pending |
| 02-09-T1/T2 | 02-09 | 3 | ING-01, ING-03 / D-11 | T-02-31, T-02-32 | EXAMINE read-only; flags unchanged after a full pass; n:* boundary; bounded downloads | integration (Dovecot) | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/imap-folder-source.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-10-T1/T2 | 02-10 | 3 | ING-02, ING-03 / D-04, D-19, D-26, D-75 | T-02-34, T-02-36, T-02-67 | Exactly-once, chunked, resumable; first-sync watermark tolerant of a lagging Bridge clock while keeping D-20; INTERNALDATE gate; valve on polling; throttled uncapped first backfill with progress after commits; periodic bounded removal diff; count-first CLI backfill of exactly the counted UIDs | unit (fakes) | `pnpm vitest run apps/worker/test/ingest-engine.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-10-T3 | 02-10 | 3 | ING-04 / D-22..D-25 | T-02-35, T-02-66 | UIDVALIDITY change: valve before any write; generation N+1, no new rows; generation N kept at every crash boundary; backfill cursor in the same transaction; counts logged | unit (fakes) | `pnpm vitest run apps/worker/test/ingest-resync.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-11-T1/T2 | 02-11 | 3 | SPK-01..04 / D-43 | T-02-38, T-02-39, T-02-68 | Probe output holds aggregates only; bounded scans; label test needs --uid, typed LABEL, a target under one hour old, and COPYUID plus the original before any expunge | integration (Dovecot) | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/bridge-probe.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-12-T1/T2 | 02-12 | 3 | D-03, D-26, D-34, D-75 | T-02-41, T-02-42, T-02-69 | Second ingester for a mailbox skips (64-bit key); session.run not re-entrant; lock released on throw/disconnect; status transition matrix | DB integration | `pnpm vitest run packages/db/test/lock.test.ts packages/db/test/status.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-13-T1/T3 | 02-13 | 4 | ING-01..04 (SC 3, 4, 5 on Dovecot) / D-11, D-75 | T-02-43, T-02-45, T-02-46 | Mail stored exactly once across restarts; resync without new rows; flags unchanged; backfill progress; removal diff every 10 minutes | integration (Dovecot + DB) | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/ingest-e2e.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-13-T2 | 02-13 | 4 | ING-01 / D-26, D-33, D-34, D-73 | T-02-43, T-02-44, T-02-73 | Grace -> connecting; pin mismatch fails closed naming sift bridge trust; busy lock skips; hold skips; exhaustive owner messages; hung logout frees the lock | integration | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/mailbox-batch.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-14-T3 | 02-14 | 4 | SPK-01..04 (SC 1, 2) | T-02-47, T-02-48, T-02-70 | Findings have required sections, a scope line and decisions, and no mail content or configured username | doc-contract unit | `pnpm vitest run apps/worker/test/spike-findings.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-15-T1 | 02-15 | 4 | D-73 | T-02-50, T-02-51 | trust shows what the worker sees, compares with the pin, never writes or logs in | integration (Dovecot) | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/bridge-trust.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-15-T2 | 02-15 | 4 | D-30, D-31 | T-02-SC, T-02-52 | Renovate regex matches tag+SHA; CI builds every Bridge bump | static | `pnpm vitest run apps/worker/test/bridge-image.test.ts && actionlint .github/workflows/bridge-image.yml` | ✅ (extend) | ⬜ pending |
| 02-16-T1..T3 | 02-16 | 5 | D-26, D-75 (ING-02, ING-03) | T-02-53, T-02-54, T-02-55 | Resume releases a hold; list shows states and progress; backfill counts, confirms, never collides with the worker | integration (Dovecot + DB) | `scripts/test-imap.sh up && pnpm vitest run apps/worker/test/mailbox-ops.test.ts packages/db/test/registry.test.ts` | ❌ W0 (created in task) | ⬜ pending |
| 02-17-T1/T2 | 02-17 | 6 | ING-01, SPK-04 / D-10, D-37, D-72..D-75, D-79..D-81 | T-02-56, T-02-57, T-02-58 | README quick start (touch/chmod of the backup file before `docker compose run --rm bridge-init`, order pinned), the backup file and security text pinned; the pre-D-79 command form absent; spike statements scoped to Bridge v3.27.0; Technical settings YAML valid | doc test | `pnpm vitest run apps/worker/test/user-facing-text.test.ts` | ✅ (extend) | ⬜ pending |
| 02-19-T1 | 02-19 | 6 | ING-01..04 (SC 3 on Proton) | T-02-71, T-02-74 | Owner's mailbox ingested through Bridge, scoped to its mailbox; a restart adds no row for mail already seen | live (owner's mailbox) | `docker compose exec -T db psql -U postgres -d sift -Atc "select s.state from mailbox_status s join mailbox b on b.id = s.mailbox_id where b.slug = 'personal'"` prints `ok` | ❌ (created in task) | ⬜ pending |
| 02-19-T3 | 02-19 | 6 | ING-03, ING-04 (SC 4, 5 on Proton) | T-02-71, T-02-72 | New mail within one poll; forced UIDVALIDITY resync without duplicates or eligibility changes; record counts only | doc-contract unit + live | `pnpm vitest run apps/worker/test/live-ingest-record.test.ts` | ❌ W0 (created in task) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Tracer-first plans create their own scaffolds in their first task; nothing must exist before a plan starts:

- [ ] `apps/worker/test/support/test-imap.ts` + `scripts/test-imap.sh` (Dovecot 2.4.5 on 127.0.0.1:31143, cert read from the running server) - 02-04 Task 1; CI step added in 02-04 Task 3
- [ ] `apps/worker/test/support/fake-imap-server.ts` (plain, STARTTLS and implicit-TLS fakes recording plaintext lines and decrypted bytes per connection, per-connection test certificates) - 02-18 Task 2
- [ ] `apps/worker/test/support/fake-folder-source.ts`, `fake-ingest-store.ts` (with `bumpUidValidity({ renumber })`, `append()`, `expunge()`) - 02-10 Task 1
- [ ] `packages/db/test/support/seed.ts` covers the new tables and NOT NULL columns - 02-03 Task 1; `seedImapMailbox` - 02-13 Task 1
- [ ] `packages/db/test/lock.test.ts`, `packages/db/test/ingest.test.ts`, `packages/db/test/status.test.ts` - 02-12, 02-06
- [ ] `scripts/bridge-smoke.sh` (Bridge image end to end) - 02-01 Task 1, extended by 02-08

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Bridge measurements (labels, CONDSTORE/QRESYNC, Message-ID consistency, UIDVALIDITY across restarts) | SPK-01..04 | Needs the owner's real Proton account and Bridge login | 02-14 Task 2 (owner logs in with `docker compose run --rm bridge-init`, pastes the pin, approves the scope); Claude runs the probes in 02-14 Task 3 and records `02-SPIKE-FINDINGS.md` |
| Real-mailbox ingest: stored once and scoped, restart adds nothing, a sent mail within one interval, forced UIDVALIDITY resync without duplicates | ING-01..ING-04 (SC 3, 4, 5) | Needs the real mailbox and Bridge login | 02-19: Claude runs the worker and the checks from the main checkout; the owner approves the resync method and sends one email (Task 2); counts recorded in `02-LIVE-INGEST.md` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
