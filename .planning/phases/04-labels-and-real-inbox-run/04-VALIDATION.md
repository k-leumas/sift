---
phase: "4"
slug: "labels-and-real-inbox-run"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-17"
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.2 |
| **Config file** | `vitest.config.ts` (global setup `packages/db/test/global-setup.ts`) |
| **Quick run command** | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run <pure test files>` (no Docker) |
| **Full suite command** | `scripts/test-imap.sh up && pnpm test` (needs sift-db-1 and Dovecot), plus `pnpm lint` and `pnpm typecheck` |
| **Estimated runtime** | ~120 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the pure tests touched (`SIFT_TEST_ADMIN_URL= pnpm exec vitest run <files>`), plus `pnpm lint` and `pnpm typecheck`
- **After every plan wave:** Run `scripts/test-imap.sh up && pnpm test`
- **Before `/gsd-verify-work`:** Full suite green, plus compose-smoke and bridge-smoke locally, before the live-run checkpoint
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled in from the PLAN.md task IDs once plans exist. Requirement → test map from research:

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| ACT-01 | Gate COPYs into `Labels/<Cat>` from a SELECTed source, records COPYUID; CREATE when missing; case rule | integration (Dovecot) | `pnpm exec vitest run apps/worker/test/label-writer.test.ts` | ❌ W0 | ⬜ pending |
| ACT-01 | Label step applies newest first, capped per tick, writes applied action + label + label_event | integration (DB + Dovecot) | `pnpm exec vitest run apps/worker/test/labels-run.test.ts` | ❌ W0 | ⬜ pending |
| ACT-01/02 | Reconcile table incl. moves, review removal, dry_run, paused, retries → failed | unit (pure) | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/labels-plan.test.ts` | ❌ W0 | ⬜ pending |
| ACT-02 | Review decision: no IMAP write, `held` record with reason | integration | `pnpm exec vitest run apps/worker/test/labels-run.test.ts` | ❌ W0 | ⬜ pending |
| ACT-03 | Every wire write has exactly one label_event; intent/resync after simulated crash | integration | `pnpm exec vitest run apps/worker/test/labels-run.test.ts apps/worker/test/label-writer.test.ts` | ❌ W0 | ⬜ pending |
| ACT-04 | `label.applied_by='sift'`, `owner_confirmed=false`; CHECK rejects otherwise; append-only grants | DB | `pnpm exec vitest run packages/db/test/labels.test.ts packages/db/test/catalog.test.ts` | ❌ / ✅ | ⬜ pending |
| ACT-05 | Only the gate and probe call ImapFlow write methods; every non-gate mailboxOpen is readOnly | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/read-only-ingest.test.ts` | ✅ (update) | ⬜ pending |
| ACT-05 | Allowlist refuses CLOSE/EXPUNGE/STORE \Seen/APPEND/MOVE/DELETE before the wire; gate refuses INBOX/Trash/Folders/unrecorded UID/no UIDPLUS | unit + fake server | `pnpm exec vitest run apps/worker/test/imap-write-allowlist.test.ts` | ❌ W0 | ⬜ pending |
| TRC-05 | `sift trace` search/exact/--all/--json/rules-changed hint; opens no IMAP | integration (DB) | `pnpm exec vitest run apps/worker/test/trace-cli.test.ts` | ❌ W0 | ⬜ pending |
| TRC-05 | README psql recipes and commands pinned to code | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/user-facing-text.test.ts` | ✅ (update) | ⬜ pending |
| D-01/05/09/19 | `sift labels` mode switch, count confirmation, retry; `mailbox list` mode and counts | integration | `pnpm exec vitest run apps/worker/test/labels-cli.test.ts packages/db/test/registry.test.ts` | ❌ / ✅ | ⬜ pending |
| D-11 | `labels.case_sensitive` strict schema, example config, README YAML | unit | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run packages/core/test/config.test.ts packages/core/test/example-config.test.ts` | ✅ (update) | ⬜ pending |
| SEC-02 | Worker internal-only, relay present, no `extra_hosts` on worker | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/compose.test.ts` | ✅ (update) | ⬜ pending |
| SEC-02 | Telemetry denylist; network call-site allowlist | static | `pnpm exec vitest run apps/worker/test/dependencies.test.ts apps/worker/test/network-call-sites.test.ts` | ✅ / ❌ | ⬜ pending |
| SEC-02 | Relay forwards only to the models.url host:port, logs no payload | unit | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/egress-relay.test.ts` | ❌ W0 | ⬜ pending |
| SEC-02 | Outside address refused from the worker container | smoke (Docker) | `SMOKE_ALLOW_VOLUME_REMOVAL=yes COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh --down` | ✅ (extend) | ⬜ pending |
| E2E-01 | 04-LIVE-RUN.md is aggregates-only and complete | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/live-run-record.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/worker/test/label-writer.test.ts` — gate against Dovecot (`test-imap.ts` has `createFolder`, flag and UID helpers)
- [ ] `apps/worker/test/imap-write-allowlist.test.ts` — uses `fake-imap-server.ts` to prove refusal before the wire
- [ ] `apps/worker/test/labels-plan.test.ts`, `labels-run.test.ts`, `labels-cli.test.ts`, `trace-cli.test.ts`, `egress-relay.test.ts`, `network-call-sites.test.ts`, `live-run-record.test.ts`
- [ ] `packages/db/test/labels.test.ts` plus seed helpers in `packages/db/test/support/seed.ts` for labels, action records and events
- [ ] A Bridge-like fake for gluon semantics (re-COPY gives a new UID, missing UID gives OK without COPYUID, COPY from EXAMINE gets NO)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live run on the `personal` Proton mailbox; ~20 sampled traces explained | E2E-01 | Needs the owner's real Proton account, Bridge and target machine | Run Sift end to end, record aggregates in 04-LIVE-RUN.md, sample traces with `sift trace` |
| Labels visible in the Proton mail client | ACT-01 | Proton client UI | Open Proton web/app, confirm labelled messages appear under `Labels/<Cat>` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
