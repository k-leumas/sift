---
gsd_state_version: "1.0"
milestone: v0.1
milestone_name: "Classify (README M1, \"M1 on real inbox\")"
current_phase: 01
current_phase_name: Foundation and Isolation
status: executing
stopped_at: Completed 01-04-PLAN.md
last_updated: "2026-10-04T06:02:24.573Z"
last_activity: 2026-10-03
last_activity_desc: Phase 01 execution started
state_head: 243620ada30bc39538cb8cbb50d79a413d088ffd
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 13
  completed_plans: 4
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-02)

**Core value:** Every incoming email is auto-labelled correctly or explicitly held for the owner, entirely on local hardware, with a decision trace explaining why.
**Current focus:** Phase 01 — Foundation and Isolation

## Current Position

Phase: 01 (Foundation and Isolation) — EXECUTING
Plan: 5 of 13
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

Last session: 2026-10-04T06:02:24.529Z
Stopped at: Completed 01-04-PLAN.md
Resume file: None
