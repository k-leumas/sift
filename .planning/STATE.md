---
gsd_state_version: "1.0"
milestone: v0.1
milestone_name: "Classify (README M1, \"M1 on real inbox\")"
current_phase: 01
current_phase_name: Foundation and Isolation
status: executing
stopped_at: Completed 01-10-PLAN.md
last_updated: "2026-10-04T06:55:14.565Z"
last_activity: 2026-10-03
last_activity_desc: Phase 01 execution started
state_head: e61431ebe5480d2719a0a80dab5e730b5fff4bda
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 13
  completed_plans: 10
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-02)

**Core value:** Every incoming email is auto-labelled correctly or explicitly held for the owner, entirely on local hardware, with a decision trace explaining why.
**Current focus:** Phase 01 — Foundation and Isolation

## Current Position

Phase: 01 (Foundation and Isolation) — EXECUTING
Plan: 11 of 13
Status: Ready to execute
Last activity: 2026-10-03 — Phase 01 execution started

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 01 P01 | 57min | 3 tasks | 19 files |
| Phase 01 P02 | 8min | 2 tasks | 5 files |
| Phase 01 P03 | 9min | 2 tasks | 22 files |
| Phase 01 P04 | 13min | 3 tasks | 13 files |
| Phase 01 P05 | 6min | 3 tasks | 4 files |
| Phase 01 P06 | 3min | 3 tasks | 2 files |
| Phase 01 P07 | 6min | 2 tasks | 6 files |
| Phase 01 P08 | 7 min | 2 tasks | 8 files |
| Phase 01 P09 | 7 min | 2 tasks | 8 files |
| Phase 01 P10 | 7 min | 2 tasks | 8 files |

## Accumulated Context

### Decisions

Locked decisions (ADR-0001/0002/0003) are in PROJECT.md `<decisions>`; full log in PROJECT.md Key Decisions.
Recent decisions affecting current work:

- [Init]: Every mail-derived table has non-null `mailbox_id` + RLS from Phase 1 (ADR-0001 wins over README "shared"/"synthetic" wording)
- [Init]: Bridge spike sits in Phase 2, ahead of ingest and label application, because its findings shape both
- [Init]: M1 has no classifier and no UI; traces are read via CLI or SQL
- [Init]: M1 traces reserve a classifier span marked skipped ("not trained") so M2 does not change the trace layout (TRC-06)
- [Phase 01]: 01-01: @types/node pinned at 26.6.3, the newest 26.x past the 7-day minimumReleaseAge gate
- [Phase 01]: 01-01: Biome 2.5 uses rules.preset recommended (boolean recommended is deprecated) and !dir folder negations
- [Phase 01]: 01-01: Root tsconfig sets allowJs+checkJs so root .js config files are type-checked
- [Phase 01]: 01-01: Commits run lefthook (biome pre-commit, commitlint commit-msg); header/body lines <=100 chars, never --no-verify
- [Phase 01]: 01-02: bootstrap ALTER ROLE re-asserts full role attributes on every run (repairs drift) and RAISEs on missing/empty password env
- [Phase 01]: 01-02: vector is created by the superuser in template1 so sift_test_* databases inherit it; sift_app is created by sift migrate, not the bootstrap
- [Phase 01]: 01-03: migrate() rebuilds role DDL errors from SQLSTATE + server message only; the statement (password literal) never reaches logs or errors
- [Phase 01]: 01-03: each table-adding generated migration is followed by a custom migration (FORCE RLS, explicit grants, set_updated_at trigger) applied in the same migrator transaction
- [Phase 01]: 01-03: test clones are sift_test_<run>_<n>_<hex> (workers share runId); globalSetup drops the run's DBs if template migration fails
- [Phase 01]: 01-04: config missing-key fallback is a per-parse Zod error map sentinel, so schema-specific messages (version, mailboxes) win; duplicate checks use superRefine when:()=>true to report beside type errors
- [Phase 01]: 01-04: literal-secret keys are rejected by a YAML pre-pass before Zod (values never echoed); YAML parsed with prettyErrors:false so syntax errors never quote source; maxAliasCount 50 on doc.toJS
- [Phase 01]: 01-04: config check --schema-only skips the D-35 presence check (D-67); SIFT_MODELS_URL override is validated with the same HttpUrl as models.url
- [Phase 01]: 01-05: catalog check (collectCatalogViolations) asserts D-37/D-38/D-40/D-66 from pg_catalog; composite key = UNIQUE or PK on exactly (mailbox_id, id); FK mailbox_id pairing is positional
- [Phase 01]: 01-05: CI workflow ci/check pins actions/checkout@v7, pnpm/action-setup@v6, setup-node@v7 (.nvmrc); bootstrap via docker exec of db/bootstrap.sql; GitHub run is a pending end-of-phase human check
- [Phase 01]: 01-06: isolation tests iterate SCOPED_TABLE_NAMES on raw sift_app clients and compare sorted id sets to superuser ground truth; mailbox_status uses mailbox_id as its id
- [Phase 01]: 01-06: append-only 42501 is asserted on unfiltered UPDATE/DELETE so it can only be the privilege check (RLS alone gives 0 rows)
- [Phase 01]: 01-07: Scoped API is opaque: AppDb/Scope internals in module-private WeakMaps; Scope frozen and closed once the callback settles
- [Phase 01]: 01-07: Helpers re-check D-44/D-40 at runtime (mailboxId/id in update sets, unknown Match keys throw TypeError); empty update/upsert is a touch
- [Phase 01]: 01-07: ISO-04 application filter proven on a superuser (RLS-bypassing) connection; @sift/db root exports pinned by test
- [Phase 01]: 01-08: pg-dump-via-compose.sh targets db:5432; loopback is trust in the postgres image, so 127.0.0.1 skipped password auth
- [Phase 01]: 01-08: MigrateOptions.backup is a required key (target | false | undefined); BackupTarget/BackupFailedError live in backup.ts, re-exported by migrate.ts
- [Phase 01]: 01-08: backup tests read pg_restore 18 from the Compose db container when SIFT_PG_DUMP is the compose wrapper
- [Phase 01]: 01-09: config apply validates the schema only (no checkMailboxEnv, no env overrides) and reconciles in one transaction under pg_advisory_xact_lock(815309002); rename suspects are refused without --confirm
- [Phase 01]: 01-09: sift mailbox rename keeps the mailbox id and shares the config-apply advisory lock; mailbox list reads mailbox_status under app.mailbox_id
- [Phase 01]: 01-10: supervisor schedules the next successful run from the run's start time, so 15 s ticks do not stretch the 60 s poll interval
- [Phase 01]: 01-10: in-progress tracking is keyed by mailbox id apart from schedule state; disable/re-enable during a run cannot overlap it
- [Phase 01]: 01-10: supervisor logs error name/code only unless an injected redact() is given; worker passes redactText with mailbox secrets and the DB URL

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 2]: Proton Bridge CONDSTORE/QRESYNC support and Message-ID consistency across label folders are unverified; polling fallback must work without either
- [Phase 3]: Raw LLM prompt retention limit (ADR-0003 open item) to decide when the `decision` table shape is set
- [Later]: How shared rules and synthetic eval runs fit under non-null `mailbox_id` (INGEST-CONFLICTS INFO) is deferred to M4/M5 planning
- [Init]: No `.planning/config.json` exists; roadmap assumed `standard` granularity and `sequential` phase IDs

## Deferred Items

Items acknowledged and deferred at milestone close, most recent first:

| Category | Item | Status | Deferred At | Milestone |
|----------|------|--------|-------------|-----------|
| Scope | README milestones M2-M7 (Learn, Plain-English rules, Evals, Multiple mailboxes, Guardrails, Extras) | Backlog | 2026-10-02 | v0.1 |

## Session Continuity

Last session: 2026-10-04T06:55:14.520Z
Stopped at: Completed 01-10-PLAN.md
Resume file: None
