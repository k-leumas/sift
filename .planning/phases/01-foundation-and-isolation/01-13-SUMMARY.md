---
phase: 01-foundation-and-isolation
plan: 13
subsystem: docs
tags: [readme, contributing, docker-compose, vitest, d-69]

requires:
  - phase: 01-foundation-and-isolation
    provides: "compose stack and sift setup (01-12), registry CLI with rename/list (01-09), config schema and example (01-04), test harness with SIFT_TEST_ADMIN_URL (01-02/01-03)"
provides:
  - "README quick start that mirrors scripts/compose-smoke.sh (config, .env, .env.mailboxes copies, docker compose up -d)"
  - "README Managing mailboxes section: disable on removal, re-enable on return, rename via setup service, list"
  - "CONTRIBUTING development loop, Checks section, Biome/@sift/db/migration standards and isolation gates"
  - "apps/worker/test/user-facing-text.test.ts: D-69 scan of docs, example files and shipped source, plus README/CONTRIBUTING contract assertions"
affects: [phase-02, owner-docs, contributor-onboarding]

actuals:
  tokens: 5800
  tasks: 2
  commits: 2
plan_head_before: 44070e4bb5fadfc173a734153d7c967b4999ce00
plan_head_after: fa38c82756e0b74354db6eb12f15876f44c6267a

tech-stack:
  added: []
  patterns:
    - "Doc contract tests: assert README/CONTRIBUTING contain the exact working commands and that every `pnpm <script>` they name exists in package.json"
    - "Forbidden-word scans build their pattern from parts so the test file never matches its own scan"

key-files:
  created:
    - apps/worker/test/user-facing-text.test.ts
  modified:
    - README.md
    - CONTRIBUTING.md

key-decisions:
  - "README tells owners to recreate the worker (`docker compose up -d --force-recreate worker`) after adding a mailbox password, because env_file is read only at container creation; the supervisor already picks up registry changes per tick"
  - "D-69 scan matches the bare word case-insensitively (same as the plan's grep), not just the full command, over docs, example env/config files, compose.yaml, Dockerfile and apps/worker/src + packages/{core,db}/src"
  - "CONTRIBUTING documents `SIFT_TEST_ADMIN_URL= pnpm vitest run packages/core` for no-DB runs, since .env.development would otherwise turn on the DB global setup"

patterns-established:
  - "Owner commands for mailbox management go through the setup service: docker compose run --rm setup sift <command>"

requirements-completed: [FND-01, FND-02, FND-03]

coverage:
  - id: D1
    description: "README quick start lists the working Phase 1 steps in order (config copy, .env, .env.mailboxes, docker compose up -d, setup rerun) and labels Ollama/Bridge/web UI as later milestones"
    requirement: FND-01
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#README quick start (D-28, D-56, D-58)"
        status: pass
    human_judgment: false
  - id: D2
    description: "README technical-settings example starts with version: 1 and explains strict keys and the setup rerun"
    requirement: FND-02
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#starts the technical-settings example with version: 1"
        status: pass
    human_judgment: false
  - id: D3
    description: "D-69: no doc, example file, compose.yaml, Dockerfile or shipped source names the deferred hard-delete command"
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#D-69: the deferred mailbox hard-delete command is never named"
        status: pass
      - kind: other
        ref: "grep -rniI <word> README.md CONTRIBUTING.md config/config.example.yaml compose.yaml Dockerfile apps/worker/src packages/core/src packages/db/src (exit 1)"
        status: pass
    human_judgment: false
  - id: D4
    description: "CONTRIBUTING development loop, checks and isolation gates name real commands and test files"
    requirement: FND-03
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#CONTRIBUTING development loop and gates (D-22, D-31, D-47)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A new owner/contributor can actually follow the README and CONTRIBUTING end to end"
    verification: []
    human_judgment: true
    rationale: "Readability and completeness of prose for a first-time reader is not asserted by any test; the stack itself is proven by compose-smoke, the wording is not"

duration: 8min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 13: Owner and Contributor Docs Summary

**README quick start and mailbox lifecycle rewritten to match the shipped Compose stack (config/, .env, .env.mailboxes, `docker compose run --rm setup`), CONTRIBUTING rewritten around the real pnpm/Compose dev loop and isolation test gates, and a contract test that enforces both plus the D-69 wording rule.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-10-04T07:54:00Z
- **Completed:** 2026-10-04T08:02:12Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- README "Quick start" is now numbered, accurate Phase 1 steps in the same order `scripts/compose-smoke.sh` automates; the old add-mailbox command and root `config.example.yaml` are gone; Ollama, Proton Bridge login and the web UI are listed under "Arriving in later milestones".
- README "Technical settings" example starts with `version: 1`, followed by a note that `config/config.example.yaml` is authoritative, unknown keys are rejected, `tiers`/`quick_confirm`/`relabel_sync` arrive later, and the setup rerun command.
- New README "Managing mailboxes": removal disables and keeps data, re-adding re-enables, rename via `docker compose run --rm setup sift mailbox rename <old> <new>` (and the `--confirm` alternative setup offers), status via `sift mailbox list`. No deletion step.
- Project structure tree shows `config/config.example.yaml`, `db/bootstrap.sql`, `backups/`, `.env.example` and `.env.mailboxes.example`.
- CONTRIBUTING: Phase 1 intro, 7-step development setup (nvm, pnpm 12 without corepack, `pnpm install`, env/config copies including `.env.mailboxes`, `docker compose up -d db`, `pnpm sift migrate && pnpm sift config apply` with the pg_dump 18 / `SIFT_PG_DUMP` note, `pnpm dev`), a new Checks section, Biome / `@sift/db` (`withMailbox`) / migration workflow standards, commitlint rules, and the isolation rule pointing at `packages/db/test/catalog.test.ts` and `isolation.test.ts`.
- `apps/worker/test/user-facing-text.test.ts` (30 tests): D-69 scan, README and CONTRIBUTING contract assertions, ordering of the quick-start copy steps, and a check that every `` `pnpm <script>` `` CONTRIBUTING names exists in package.json.

## Task Commits

1. **Task 1: Tracer - README quick start matches the working stack, guarded by a test** - `e818ebd` (docs)
2. **Task 2: CONTRIBUTING reflects the real workspace, tooling and isolation gates** - `fa38c82` (docs)

Tracer feedback gate: Task 1's automated verify (vitest + both greps) re-ran green before Task 2 started.

## Files Created/Modified

- `README.md` - Quick start, Technical settings note, Managing mailboxes, Project structure
- `CONTRIBUTING.md` - intro, Development setup, Checks, Coding standards, PR isolation rule
- `apps/worker/test/user-facing-text.test.ts` - D-69 scan and doc contract tests

## Decisions Made

- Documented worker recreation (`docker compose up -d --force-recreate worker`) after adding a mailbox password. Verified in source: the supervisor re-reads the registry every tick, but the worker's env (from `env_file: .env.mailboxes`) is fixed at container creation. `docker compose restart` would not pick up the new variable.
- The D-69 scan uses the bare word (case-insensitive), matching the plan's verification grep, so any mention fails, not only the full command form.
- No-DB test runs are documented as `SIFT_TEST_ADMIN_URL= pnpm vitest run packages/core`, because vitest.config.ts loads `.env.development`, which would otherwise make the global setup require a database.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Worker recreation step after adding a mailbox password**
- **Found during:** Task 1
- **Issue:** The plan's step 6 (edit config, add password, run setup) leaves a running worker without the new mailbox's password, since Compose reads `env_file` only when the container is created.
- **Fix:** Added one sentence to quick start step 6 with `docker compose up -d --force-recreate worker`.
- **Files modified:** README.md
- **Committed in:** e818ebd

**2. [Rule 2 - Missing critical] CONTRIBUTING setup copies `.env.mailboxes` and `config/config.yaml`**
- **Found during:** Task 2 (folded in from 01-12 deferred-items.md)
- **Issue:** The plan's setup list copied only `.env` and `.env.development`; Compose v2.2.3 refuses every command (including `docker compose up -d db`) without `.env.mailboxes`, and `pnpm sift config apply` / `pnpm dev` read `config/config.yaml`.
- **Fix:** Step 4 copies all four files and explains the `.env.mailboxes` requirement. Marked the 01-12 deferred item `status: resolved`.
- **Files modified:** CONTRIBUTING.md, .planning/phases/01-foundation-and-isolation/deferred-items.md
- **Committed in:** fa38c82 (CONTRIBUTING); deferred-items.md in the plan metadata commit

**3. [Rule 2 - Missing critical] Additional contract assertions**
- **Found during:** Task 2
- **Issue:** Plan-listed substrings alone would not catch a doc naming a nonexistent pnpm script.
- **Fix:** Test also checks quick-start copy order, `isolation.test.ts`, `withMailbox`, `SIFT_PG_DUMP=...`, and that every `` `pnpm <name>` `` in CONTRIBUTING is a package.json script (pnpm built-ins and the planned `pnpm eval` excepted).
- **Files modified:** apps/worker/test/user-facing-text.test.ts
- **Committed in:** fa38c82

---

**Total deviations:** 3 auto-fixed (3 missing critical)
**Impact on plan:** All stay within the plan's files (plus the deferred-items status). No scope creep.

## Issues Encountered

- Full `pnpm test` under load average ~80 (spiking to 232): 268/269 passed; `apps/worker/test/worker.test.ts > sift worker (tracer) > starts, records status, stops cleanly` timed out at 15 s. Rerun in isolation: 2/2 passed. It is a process-spawning test unrelated to this plan's doc changes; the failure was load-induced.
- `pnpm lint` reports one pre-existing warning (`noTemplateCurlyInString` in apps/worker/test/node-version.test.ts); no errors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 13 Phase 1 plans have SUMMARYs; the phase is ready for verification.
- The README describes only what runs today; Phase 2 adds IMAP ingest and should extend the quick start (Proton Bridge login) and move it out of "Arriving in later milestones" when it works.
- The D-69 scan will fail the build if any later doc or source mentions the deferred command before it exists. When that command ships, update the scan.

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED

- Files: apps/worker/test/user-facing-text.test.ts, README.md, CONTRIBUTING.md exist
- Commits: e818ebd, fa38c82 present in git log
- Acceptance: README/CONTRIBUTING substrings asserted by the test (30/30 pass); both negative greps exit 1; pnpm lint and pnpm typecheck pass
