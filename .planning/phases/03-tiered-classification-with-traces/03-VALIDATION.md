---
phase: "03"
slug: "tiered-classification-with-traces"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
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

Filled in from PLAN.md task IDs once plans exist. Requirement → test mapping from research:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| CLS-01 | From/domain/phrase matching, AND/OR, first-wins, nearest miss, determinism | unit | `pnpm vitest run packages/core/test/exact-rules.test.ts` | ❌ W0 | ⬜ pending |
| CLS-01 | rules.yaml strict schema, YAML-path errors, example parses | unit | `pnpm vitest run packages/core/test/rules.test.ts` | ❌ W0 | ⬜ pending |
| CLS-02 / SEC-01 | Fence holds; system message email-free and byte-stable | unit | `pnpm vitest run packages/core/test/prompt.test.ts` | ❌ W0 | ⬜ pending |
| CLS-03 / CLS-05 | Retry once, review codes, no repair | integration (fake Ollama) | `pnpm vitest run apps/worker/test/classify-llm-tier.test.ts` | ❌ W0 | ⬜ pending |
| CLS-04 | Threshold boundaries, config override, out-of-range rejected | unit + integration | `pnpm vitest run packages/core/test/config.test.ts apps/worker/test/classify-llm-tier.test.ts` | partial | ⬜ pending |
| CLS-06 | Ollama down → pending, recovery, cap 25, single flight, no duplicate auto decision | integration | `pnpm vitest run apps/worker/test/classify-run.test.ts` | ❌ W0 | ⬜ pending |
| CLS-06 | Partial unique index refuses 2nd worker decision; re-run appends | DB | `pnpm vitest run packages/db/test/classify.test.ts` | ❌ W0 | ⬜ pending |
| TRC-01..04, TRC-06 | Spans schema, fixed order, FKs, replay byte-equal | integration | `pnpm vitest run apps/worker/test/classify-trace.test.ts` | ❌ W0 | ⬜ pending |
| TRC-04 | prompt_version catalog/grants; rule_set versioning by hash | DB | `pnpm vitest run packages/db/test/catalog.test.ts packages/db/test/classify.test.ts` | partial | ⬜ pending |
| SEC-01 | No sentinel leakage to logs/last_error; models.url origin only | integration | `pnpm vitest run apps/worker/test/classify-leak.test.ts` | ❌ W0 | ⬜ pending |
| D-17 | `sift classify` CLI | integration | `pnpm vitest run apps/worker/test/classify-cli.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/worker/test/support/fake-ollama.ts` — scripted fake Ollama (`/api/version`, `/api/tags`, `/api/show`, `/api/chat`)
- [ ] `apps/worker/test/support/classify-harness.ts` (or extend `mailbox-harness.ts`) — rules.yaml temp dir, `expectReplayableDecision`, `models.url` off port 11434
- [ ] `apps/worker/test/fixtures/mail/hostile-*.eml` (≥ 12) and injection pairs (5)
- [ ] `packages/db/test/support/seed.ts` and `isolation.test.ts` updated for new NOT NULL columns
- [ ] `data/mailboxes/example/rules.example.yaml` + `.gitignore` negation + CI parse test

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live model baseline (E4-live, E11-live, E12) | CLS-02, CLS-04, SEC-01 | Needs a real local Ollama model; non-deterministic | `ollama pull qwen3:1.7b`, run the AI-SPEC §5 baseline on synthetic data, record the table in VERIFICATION |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
