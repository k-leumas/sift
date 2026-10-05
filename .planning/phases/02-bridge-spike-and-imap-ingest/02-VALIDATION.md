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
| TBD | TBD | TBD | SPK-01..04 | — | Findings doc has required sections and no mail content | doc-contract unit | `pnpm vitest run apps/worker/test/spike-findings.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | SPK (probe) | — | Probe output holds aggregates only (no subject/from/body) | unit | `pnpm vitest run apps/worker/test/bridge-probe.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ING-01 | — | No STARTTLS → fail before any LOGIN bytes (D-42) | unit | `pnpm vitest run apps/worker/test/imap-starttls.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ING-01 | — | Pin mismatch → `SIFT_BRIDGE_PIN_MISMATCH`; never `rejectUnauthorized: false` | unit + negative grep | `pnpm vitest run apps/worker/test/imap-pin.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ING-01 | — | Error classes map to connecting / unreachable / rejected login | unit | `pnpm vitest run apps/worker/test/mailbox-batch.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ING-02 | — | Idempotent ingest, identity kinds, NUL stripping, body cap | unit + DB integration | `pnpm vitest run apps/worker/test/ingest-engine.test.ts packages/db/test/ingest.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ING-02 | — | New tables pass catalog + isolation suites | DB integration | `pnpm vitest run packages/db/test/catalog.test.ts packages/db/test/isolation.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | ING-02 / D-11 | — | Flags unchanged by ingest; EXAMINE used | integration (Dovecot) | `pnpm vitest run apps/worker/test/imap-dovecot.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ING-03 | — | New message ingested next poll; `n:*` boundary no duplicate | unit + Dovecot | `pnpm vitest run apps/worker/test/ingest-engine.test.ts apps/worker/test/imap-dovecot.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | ING-04 | — | UIDVALIDITY change → resync, no new rows, generation N kept on failure | unit + Dovecot | `pnpm vitest run apps/worker/test/ingest-resync.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-26 | — | Over-cap → `needs_attention`, nothing stored; resume clears | unit + CLI | `pnpm vitest run apps/worker/test/mailbox-resume.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-03 | — | Concurrent ingest of one mailbox skips; lock released on disconnect | DB integration | `pnpm vitest run packages/db/test/lock.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-28 | — | `nudge()` runs due mailbox, never overlapping | unit | `pnpm vitest run apps/worker/test/supervisor.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | D-29..D-38 | — | Compose: bridge loopback, external volume, passphrase only on bridge, cert ro | static | `pnpm vitest run apps/worker/test/compose.test.ts` | ✅ | ⬜ pending |
| TBD | TBD | TBD | D-30/D-31 | — | Dockerfile pins tag+SHA; renovate.json validates | static | `pnpm vitest run apps/worker/test/bridge-image.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | D-02 | — | Config accepts/rejects `initial_backfill_days` and the cap | unit | `pnpm vitest run packages/core/test/config.test.ts packages/core/test/example-config.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/worker/test/support/fake-folder-source.ts` — in-memory `FolderSource` with `bumpUidValidity()`, `append()`, `expunge()`
- [ ] `apps/worker/test/support/tls-fixtures.ts` — two CA:true self-signed certs via `openssl req -x509 … -addext`
- [ ] `apps/worker/test/support/fake-imap-server.ts` — plaintext greeting without STARTTLS, records received lines
- [ ] Dovecot harness (rootless image, IMAP 31143, `SIFT_TEST_IMAP_URL`); CI step after checkout
- [ ] `packages/db/test/support/seed.ts` — seed new tables and new NOT NULL `message` columns
- [ ] `packages/db/test/lock.test.ts`, `packages/db/test/ingest.test.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Bridge measurements (labels, CONDSTORE/QRESYNC, Message-ID consistency, UIDVALIDITY across restarts) | SPK-01..04 | Needs the owner's real Proton account and Bridge login | Owner runs the scripted probe against the real mailbox; results recorded in `02-SPIKE-FINDINGS.md` |
| End-to-end ingest of a self-sent mail within one interval; restart adds no rows | ING-02, ING-03 | Needs the real mailbox | Start the worker, send a mail, check the DB row count before/after restart |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
