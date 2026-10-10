---
phase: "03"
slug: "tiered-classification-with-traces"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-10-10"
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.2 |
| **Config file** | `vitest.config.ts` (globalSetup `packages/db/test/global-setup.ts`, testTimeout 30 s) |
| **Quick run command** | `pnpm vitest run <touched test files> && pnpm typecheck` |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm test` (needs Postgres via `SIFT_TEST_ADMIN_URL` and `scripts/test-imap.sh up`) |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <touched test files> && pnpm typecheck`
- **After every plan wave:** Run `pnpm lint && pnpm typecheck && pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green, plus the manual live baseline (AI-SPEC §5)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled from the PLAN.md task IDs (2026-10-10). Tracer-first: each task creates the test file it is verified by, so "File Exists" is ❌ until that task runs. IMAP column: needs `scripts/test-imap.sh up`.

| Task ID | Wave | Requirement / Decision | Eval | Test Type | Automated Command | IMAP | File Exists | Status |
|---------|------|------------------------|------|-----------|-------------------|------|-------------|--------|
| 03-01-T1 | 1 | D-06 (character set) | — | checkpoint:decision | none (owner choice) | no | — | ✅ resolved (owner chose ascii) |
| 03-01-T2 | 1 | CLS-01, D-01, D-02, D-06, D-13 | — | unit | `pnpm vitest run packages/core/test/rules.test.ts packages/core/test/config.test.ts packages/core/test/env.test.ts packages/core/test/example-config.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-01-T3 | 1 | D-04 | — | unit | `pnpm vitest run packages/core/test/example-rules.test.ts packages/core/test/rules.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-02-T1 | 1 | CLS-04, D-25 | E10 (config) | unit | `pnpm vitest run packages/core/test/config.test.ts packages/db/test/registry-plan.test.ts && pnpm typecheck` | no | ✅ (edit) | ✅ green |
| 03-02-T2 | 1 | D-20, D-25 docs | — | unit | `pnpm vitest run packages/core/test/config.test.ts packages/core/test/example-config.test.ts apps/worker/test/user-facing-text.test.ts && pnpm typecheck` | no | ✅ (edit) | ✅ green |
| 03-03-T1 | 1 | TRC-01, TRC-04, CLS-06, D-27, D-29 | E1 (DB checks) | DB | `pnpm vitest run packages/db/test/classify-schema.test.ts packages/db/test/catalog.test.ts packages/db/test/migrate.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-03-T2 | 1 | ISO-01..04 regression, RESEARCH A4 | — | DB | `pnpm vitest run packages/db && pnpm typecheck` | no | ✅ (edit) | ✅ green |
| 03-04-T1 | 2 | CLS-01, TRC-02, D-08..D-12 | E9 | unit (table) | `pnpm vitest run packages/core/test/exact-rules.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-04-T2 | 2 | CLS-04, D-26, D-31 | E10 | unit | `pnpm vitest run packages/core/test/decide.test.ts packages/core/test/exact-rules.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-04-T3 | 2 | D-03 | — | unit | `pnpm vitest run packages/core/test/rules-hash.test.ts packages/core/test/rules.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-05-T1 | 1 | CLS-02, SEC-01, D-21, D-28 | E3 (render), E14 | unit | `pnpm vitest run packages/core/test/prompt.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-05-T2 | 1 | CLS-03, TRC-06, D-24, D-29 | E1 (code), E8 prerequisite | unit | `pnpm vitest run packages/core/test/llm-output.test.ts packages/core/test/spans.test.ts packages/core/test/prompt-version.test.ts packages/core/test/prompt.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-06-T1 | 2 | TRC-01, CLS-06, D-15, D-32 | E6 (DB) | DB | `pnpm vitest run packages/db/test/classify.test.ts packages/db/test/scope.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-06-T2 | 2 | TRC-04, D-17, D-29, D-32 | — | DB | `pnpm vitest run packages/db/test/classify.test.ts packages/db/test/scope.test.ts packages/db/test/isolation.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-07-T1 | 2 | CLS-02, D-22, D-23 | E11 | integration (fake) | `pnpm vitest run apps/worker/test/classify-llm-tier.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-07-T2 | 2 | CLS-03, CLS-05, D-16, D-24 | E1, E5 (client), E11 | integration (fake) | `pnpm vitest run apps/worker/test/classify-llm-tier.test.ts apps/worker/test/classify-ollama-client.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-07-T3 | 2 | D-19, SEC-01 (remote model) | E6 (single flight), E7 (part) | integration (fake) | `pnpm vitest run apps/worker/test/classify-preflight.test.ts apps/worker/test/classify-llm-tier.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-08-T1 | 3 | CLS-01, CLS-02, TRC-01, TRC-04 | E8, E9 | integration (DB + fake) | `pnpm vitest run apps/worker/test/classify-run.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-08-T2 | 3 | CLS-06, D-05, D-16, D-18 | E5, E6 | integration (DB + fake) | `pnpm vitest run apps/worker/test/classify-run.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-08-T3 | 3 | TRC-01, TRC-03, TRC-04, TRC-06 | E1 (invariant), E8, E10, E14 | integration (DB + fake) | `pnpm vitest run apps/worker/test/classify-trace.test.ts apps/worker/test/classify-run.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-09-T1 | 4 | CLS-02, D-14, D-19 | E8 | integration (IMAP + DB + fake) | `pnpm vitest run apps/worker/test/classify-batch.test.ts packages/db/test/status.test.ts apps/worker/test/mailbox-batch.test.ts apps/worker/test/ingest-e2e.test.ts && pnpm typecheck` | yes | ✅ | ✅ green |
| 03-09-T2 | 4 | CLS-06, D-05, D-16, D-19 | E5, E6 | integration (IMAP + DB + fake) | `pnpm vitest run apps/worker/test/classify-batch.test.ts apps/worker/test/mailbox-batch.test.ts && pnpm typecheck` | yes | ✅ | ✅ green |
| 03-09-T3 | 4 | D-14 (sift worker wiring) | — | e2e (spawned worker) | `pnpm vitest run apps/worker/test/worker-classify.test.ts apps/worker/test/worker.test.ts && pnpm typecheck` | yes | ✅ | ✅ green |
| 03-10-T1 | 5 | SEC-01, D-33 | E3 (wire) | integration (IMAP + fake) | `pnpm vitest run apps/worker/test/classify-injection.test.ts && pnpm typecheck` | yes | ✅ | ✅ green |
| 03-10-T2 | 5 | SEC-01, CLS-05, CLS-03 | E2, E3, E4 (CI) | integration (IMAP + fake) | `pnpm vitest run apps/worker/test/classify-injection.test.ts apps/worker/test/read-only-ingest.test.ts apps/worker/test/dependencies.test.ts && pnpm typecheck` | yes | ✅ | ✅ green |
| 03-10-T3 | 5 | SEC-01 | E7, hermeticity | integration + static | `pnpm vitest run apps/worker/test/classify-leak.test.ts apps/worker/test/classify-hermetic.test.ts && pnpm typecheck` | yes | ✅ | ✅ green |
| 03-11-T1 | 2 | CLS-01, D-05 | — | integration (in-process CLI) | `pnpm vitest run apps/worker/test/config-check-rules.test.ts packages/core/test/env.test.ts packages/core/test/example-config.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-11-T2 | 2 | D-07 | — | integration (DB) | `pnpm vitest run apps/worker/test/mailbox-rename-guard.test.ts packages/db/test/registry.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-11-T3 | 2 | data mount | — | static (compose) | `pnpm vitest run apps/worker/test/compose.test.ts apps/worker/test/compose-smoke.test.ts && pnpm typecheck` | no | ✅ (edit) | ✅ green |
| 03-12-T1 | 4 | CLS-06, D-17 | E6 (explicit re-run) | integration (DB + fake) | `pnpm vitest run apps/worker/test/classify-cli.test.ts apps/worker/test/cli.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-12-T2 | 4 | D-17 | — | integration (DB + fake) | `pnpm vitest run apps/worker/test/classify-cli.test.ts && pnpm typecheck` | no | ✅ | ✅ green |
| 03-12-T3 | 4 | D-32 | — | integration (IMAP + DB + fake) | `pnpm vitest run apps/worker/test/classify-refetch.test.ts apps/worker/test/read-only-ingest.test.ts apps/worker/test/classify-cli.test.ts && pnpm typecheck` | yes | ✅ | ✅ green |
| 03-13-T1 | 6 | docs (D-01, D-05, D-07, D-17, D-25) | — | unit (doc test) | `pnpm vitest run apps/worker/test/user-facing-text.test.ts && pnpm typecheck` | no | ✅ (edit) | ✅ green |
| 03-13-T2 | 6 | CLS-02, SEC-01 (live) | E4-live, E11-live, E12 baseline | integration (fake) + manual | `pnpm vitest run apps/worker/test/llm-baseline.test.ts apps/worker/test/classify-hermetic.test.ts && pnpm typecheck` | no | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Under tracer-first planning these scaffolds land with the first task that needs them, before any later task depends on them:

- [x] `apps/worker/test/support/fake-ollama.ts` — scripted fake Ollama (`/api/version`, `/api/tags`, `/api/show`, `/api/chat`) — 03-07-T1
- [x] `apps/worker/test/support/classify-harness.ts` — rules.yaml temp dir, `expectReplayableDecision`; `mailbox-harness.ts` `models.url` off the real Ollama port — 03-08-T1
- [x] `apps/worker/test/fixtures/mail/hostile-*.eml` (13) and injection pairs (5 pairs, 10 files) — 03-10-T1/T2
- [x] `packages/db/test/support/seed.ts` and `isolation.test.ts` updated for new NOT NULL columns — 03-03-T2
- [x] `data/mailboxes/example/rules.example.yaml` + `.gitignore` negation + CI parse test — 03-01-T3

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live model baseline (E4-live, E11-live, E12) | CLS-02, CLS-04, SEC-01 | Needs a real local Ollama model; non-deterministic | `ollama pull qwen3:1.7b`, run the AI-SPEC §5 baseline on synthetic data, record the table in VERIFICATION |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-10-10 (validate-phase: 45 mapped test files, 1065/1065 green)

## Validation Audit 2026-10-10

| Metric | Count |
|---|---|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Mapped test files | 45 |
| Tests passed | 1065 |
