---
phase: "01"
slug: "foundation-and-isolation"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: true) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
created: "2026-10-03"
validated: "2026-10-05"
---

# Phase 01 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `01-RESEARCH.md` § Validation Architecture plus post-research decisions D-66..D-71 in `01-CONTEXT.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.x (root `vitest.config.ts`, `globalSetup` + `provide/inject`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run packages/core` (no DB) |
| **Full suite command** | `pnpm biome ci . && pnpm -r exec tsc -p . && pnpm vitest run` (needs `SIFT_TEST_ADMIN_URL` + `db/bootstrap.sql` applied) |
| **Estimated runtime** | ~5 s quick, ~60 s full |

DB harness: `globalSetup` connects with `SIFT_TEST_ADMIN_URL` (superuser, local Compose/CI only), applies `db/bootstrap.sql` idempotently, creates `sift_test_<hex> OWNER sift_owner`, runs the real `sift migrate` code as `sift_owner`, `provide`s URLs, and drops the DB with `DROP DATABASE … WITH (FORCE)`.

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run <touched package>` + `pnpm biome check`
- **After every plan wave:** full suite command
- **Before `/gsd-verify-work`:** full suite + `compose-smoke` CI job green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Requirement-level map. The planner and executor refine it to task IDs.

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| FND-01 | Stack builds/starts; setup exits 0; worker healthy; migrations applied | smoke (CI) | `scripts/compose-smoke.sh` (CI job `compose-smoke`) | ✅ | ✅ green |
| FND-01 | `.nvmrc` ↔ Dockerfile `ARG NODE_VERSION` in sync (D-68) | unit | `pnpm vitest run apps/worker/test/node-version.test.ts` | ✅ | ✅ green |
| FND-01 | migrate: advisory lock, pending detection, backup only when pending, keep 5 | integration | `pnpm vitest run packages/db/test/migrate.test.ts` | ✅ | ✅ green |
| FND-01 | Backup run as `sift_backup` contains rows of both mailboxes (D-66) | integration | same file | ✅ | ✅ green |
| FND-02 | Config schema strictness, slug rules, dup host+user+folder, password_env regex, literal secret rejected, line numbers | unit | `pnpm vitest run packages/core/test/config.test.ts` | ✅ | ✅ green |
| FND-02 | Shipped example config validates | unit | `pnpm vitest run packages/core/test/example-config.test.ts` | ✅ | ✅ green |
| FND-02 | Missing/whitespace env vars reported all at once, names not values | unit | `pnpm vitest run packages/core/test/env.test.ts` | ✅ | ✅ green |
| FND-02 | Secret sentinel never in DB, config or logs | integration | `pnpm vitest run apps/worker/test/no-secret-leak.test.ts` | ✅ | ✅ green |
| FND-02 | config apply guards, rename, drift refusal; no "purge" in user-facing text (D-69) | integration | `pnpm vitest run packages/db/test/registry.test.ts apps/worker/test/drift.test.ts` | ✅ | ✅ green |
| FND-03 | Workspace typechecks; packages resolve as source `.ts` | static | `pnpm -r exec tsc -p .` + `node apps/worker/src/cli.ts --help` | ✅ | ✅ green |
| ISO-01, ISO-02 | Catalog assertions (D-37/D-38; `sift_backup` the only non-superuser BYPASSRLS role, D-66) | integration | `pnpm vitest run packages/db/test/catalog.test.ts` | ✅ | ✅ green |
| ISO-03 | Every D-48 case via raw `pg` as `sift_app` | integration | `pnpm vitest run packages/db/test/isolation.test.ts` | ✅ | ✅ green |
| ISO-03 | Owner-scoped DELETE touches only mailbox A; unset scope deletes nothing (D-70) | integration | `pnpm vitest run packages/db/test/owner-rls.test.ts` | ✅ | ✅ green |
| ISO-04 | Scoped helpers filter by mailbox without RLS; insert type omits `mailboxId` | integration + type | `pnpm vitest run packages/db/test/scope.test.ts` + `tsc` | ✅ | ✅ green |
| ISO-04 | Apps cannot import `pg`/`drizzle-orm` directly | static | `pnpm biome ci .` | ✅ | ✅ green |
| D-49..D-55 | Supervisor no-overlap, backoff, status, heartbeat, SIGTERM drain | unit + integration | `pnpm vitest run apps/worker/test` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Root `package.json`, `pnpm-workspace.yaml` (`allowBuilds`, `minimumReleaseAge`), `tsconfig.base.json` (`types: ["node"]`, `strict`, `moduleResolution`)
- [x] `vitest.config.ts` + `packages/db/test/global-setup.ts`
- [x] `db/bootstrap.sql` (shared by initdb, CI and tests; creates `sift_owner`, `sift_backup`, `vector` in `template1` + `sift`)
- [x] `biome.json` with `useImportExtensions` + `noRestrictedImports` override on `apps/**`
- [x] `.github/workflows/ci.yml` (lint/typecheck/test job with PG 18 + pgvector service and postgresql-client-18; separate `compose-smoke` job)
- [x] `.env.example`, `.env.mailboxes.example`, `.env.development.example`, plus `.gitignore` negations

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stack runs on the actual home machine | FND-01 (SC 1) | Dev Mac has old Docker with the daemon stopped; the target hardware is not reachable from CI | `docker compose up -d`, then confirm setup exited 0, the worker is healthy, and `drizzle.__drizzle_migrations` has rows |
| No password in config or DB on the target | FND-02 (SC 2) | Confirms the automated sentinel test on real data | `grep -r "$SECRET" config/` and grep the `pg_dump` output: no matches |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-05 (CI run 37259340618 on 7e042ab: `check` 28 files / 353 tests green, `compose-smoke` green; manual-only items passed in 01-UAT.md tests 1-2)

---

## Validation Audit 2026-10-05

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 16 map rows COVERED: every referenced test file exists, `@ts-expect-error` insert/update type guards in `scope.test.ts` are enforced by `pnpm typecheck` (packages/db tsconfig includes `test`), and CI ran lint, typecheck, test and compose-smoke green. Manual-only rows (target-machine bring-up, real-password grep) passed in 01-UAT.md.
