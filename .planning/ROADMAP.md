# Roadmap: Sift

## Milestones

- 🚧 **v0.1 Classify (README M1, "M1 on real inbox")** - Phases 1-4 (in progress)

## Overview

M1 takes Sift from an empty repository to one real Proton mailbox auto-labelled end to end on the home machine. The data boundary comes first (mailbox-scoped schema with row-level security from day one), then the Proton Bridge spike and IMAP ingest, which settle how mail is read and how labels can be applied. Next comes the classification pipeline (hardcoded exact rules, then the local LLM) with a decision trace for every classification. Finally Sift applies labels in the mailbox, holds uncertain messages for review, and runs against the real inbox. There is no UI, no classifier and no learning in this milestone; those are the next README milestones.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation and Isolation** - Compose stack, config, and a mailbox-scoped schema with RLS proven by a two-mailbox test (completed 2026-10-04)
- [ ] **Phase 2: Bridge Spike and IMAP Ingest** - Proton Bridge behaviour answered and recorded; one mailbox ingested idempotently
- [ ] **Phase 3: Tiered Classification with Traces** - Exact rules, then the local LLM, every classification traced
- [ ] **Phase 4: Labels and Real-Inbox Run** - Labels applied in Proton, uncertain mail held, changes recorded, end-to-end on a real inbox

## Phase Details

### Phase 1: Foundation and Isolation

**Goal**: The owner can start the stack on the home machine and the database enforces mailbox isolation before any mail-derived data exists.
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, ISO-01, ISO-02, ISO-03, ISO-04
**Success Criteria** (what must be TRUE):
  1. Owner runs Docker Compose on the target machine and gets a running Postgres (with pgvector) and worker, with migrations applied
  2. Owner declares a mailbox in `config.yaml` and its password is read only from the environment variable named by `password_env`; searching the config files and the database finds no password
  3. A schema check fails the build if any table holding mail-derived data lacks a non-null `mailbox_id`
  4. With two seeded mailboxes, queries run under mailbox A's `app.mailbox_id` return and modify none of mailbox B's rows, even with the application-level filter removed; with no `app.mailbox_id` set, they return nothing

**Plans**: 13/13 plans complete

Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Workspace, toolchain and `sift` CLI shell; gated install of all phase dependencies (wave 1)
- [x] 01-02-PLAN.md — Local Postgres 18 + pgvector bootstrap (sift_owner, sift_backup), Compose db service, env/gitignore layout (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 01-03-PLAN.md — Mailbox-scoped schema for all M1 tables, forced-RLS migrations, migrate(), Vitest DB harness (wave 2)
- [x] 01-04-PLAN.md — Strict config.yaml schema, `sift config check`, password_env presence check, redacting logger (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-05-PLAN.md — Catalog schema check (fails the build) and GitHub Actions CI (wave 3)
- [x] 01-06-PLAN.md — Two-mailbox isolation test (every D-48 case) and owner FORCE-RLS delete test (wave 3)
- [x] 01-07-PLAN.md — Scoped data-access API: withMailbox, per-table helpers, requireActive, status use-cases (wave 3)
- [x] 01-08-PLAN.md — `sift migrate` with pre-migration pg_dump as sift_backup and 5-file retention (wave 3)
- [x] 01-09-PLAN.md — Mailbox registry: `sift config apply` guards, `sift mailbox rename`, `sift mailbox list` (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-10-PLAN.md — Worker runtime: supervisor, no-op batch, backoff, heartbeat, graceful shutdown (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 01-11-PLAN.md — Worker startup guards (drift, DB retry, role check) and secret-sentinel test (wave 5)
- [x] 01-12-PLAN.md — Docker image, full Compose stack, `sift setup`, compose smoke and version-drift tests (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 01-13-PLAN.md — README quick start / mailbox lifecycle, CONTRIBUTING dev loop, user-facing text guard (wave 6)

### Phase 2: Bridge Spike and IMAP Ingest

**Goal**: Proton Bridge's behaviour is known rather than assumed, and one real mailbox's mail is reliably in the database.
**Depends on**: Phase 1
**Requirements**: SPK-01, SPK-02, SPK-03, SPK-04, ING-01, ING-02, ING-03, ING-04
**Success Criteria** (what must be TRUE):
  1. A findings document, based on a real Proton mailbox, states how labels appear as folders and how one is applied and removed, whether CONDSTORE and QRESYNC work, how consistent `Message-ID` is across label folders, and how UIDVALIDITY behaves across Bridge restarts
  2. The findings document says which sync capability later relabel learning must assume (CONDSTORE/QRESYNC or polling only) and what label application must do accordingly
  3. Owner starts the worker and the configured mailbox's messages appear in the database exactly once each, scoped to that mailbox; restarting the worker adds no duplicates
  4. A new email sent to the mailbox shows up in the database within one polling interval without restarting anything
  5. After a forced UIDVALIDITY change, Sift resyncs the folder without duplicating or re-classifying stored messages

**Plans**: 12/19 plans executed

Plans:
**Wave 1**
- [x] 02-01-PLAN.md — Proton Bridge image from the pinned release, fail-closed keychain, Compose bridge and one-shot bridge-init services, isolated smoke (wave 1)
- [x] 02-02-PLAN.md — Config keys imap.tls.mode/pin_sha256 and the per-mailbox ingest block, example config (wave 1)
- [x] 02-03-PLAN.md — Schema: message identity, message_location, message_body, folder_sync watermarks and backfill cursor, new mailbox states, preflight migration and fixture updates (wave 1)
- [x] 02-04-PLAN.md — IMAP test server (local and CI), SPKI pin function, D-77 dependency install with license/tree checks (wave 1)
- [x] 02-05-PLAN.md — Supervisor nudge() and shutdown AbortSignal (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-06-PLAN.md — Scoped insertOrIgnore/upsert and ingest use-cases in @sift/db, matched by identity key (wave 2)
- [x] 02-07-PLAN.md — Ingest contracts, identity keys and message parsing (wave 2)
- [x] 02-08-PLAN.md — `docker compose run --rm bridge-init`: Go gRPC helper, password upsert with host-side backup, fingerprint to pin, repair mode (wave 2)
- [x] 02-18-PLAN.md — Credential-free cert capture (wire-tested, D-80) and the pinned, twice-verified STARTTLS/implicit connection (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-09-PLAN.md — Read-only ImapFlow FolderSource adapter against Dovecot (wave 3)
- [x] 02-10-PLAN.md — Sync engine: throttled first backfill, polling, valve (before any resync write), removals, generation resync, CLI backfill entry points (wave 3)
- [x] 02-11-PLAN.md — `sift bridge probe` spike tool (aggregates only, confirmed label test) (wave 3)
- [ ] 02-12-PLAN.md — Cross-process ingest lock and status use-cases (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 02-13-PLAN.md — Worker integration: lock, pinned connect, engine, owner-visible states, end-to-end tests (wave 4)
- [ ] 02-14-PLAN.md — Live spike on the owner's Proton mailbox, findings document and ADR-0003 addendum (wave 4, owner checkpoint)
- [ ] 02-15-PLAN.md — `sift bridge trust <slug>`, Renovate for the Bridge pin, Bridge image CI (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [ ] 02-16-PLAN.md — `sift mailbox resume`, `sift mailbox list` states, count-and-confirm `sift mailbox backfill` (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [ ] 02-17-PLAN.md — README and CONTRIBUTING for Bridge setup, pinning, ingest, security and privacy (wave 6)
- [ ] 02-19-PLAN.md — Live ingest on the owner's Proton mailbox: stored once, restart, new mail within a poll, forced UIDVALIDITY resync, counts only (wave 6, owner checkpoint)

### Phase 3: Tiered Classification with Traces

**Goal**: Every ingested message gets a category from exact rules or the local LLM, or is marked for review, and the reason is recorded as a replayable trace.
**Depends on**: Phase 2
**Requirements**: CLS-01, CLS-02, CLS-03, CLS-04, CLS-05, CLS-06, TRC-01, TRC-02, TRC-03, TRC-04, TRC-06, SEC-01
**Success Criteria** (what must be TRUE):
  1. A message from a sender or domain, or containing a phrase, covered by a hardcoded exact rule is classified without any LLM call, and its trace shows the rules checked and the match
  2. A message no exact rule matches is classified by the local LLM into one of the mailbox's categories, with a confidence and a one-sentence reason; an out-of-category or malformed answer is retried once and then marked for review
  3. An LLM result below the confidence threshold is marked for review rather than given a category
  4. Every classification has a `decision` row with one span per tier that ran and the rule-set, prompt and model versions; the LLM span holds the rules included, the raw output, the validation result and the confidence
  5. A message whose text tries to give the model instructions (for example, text telling the model to pick a particular label) does not change which categories are allowed or what the pipeline does, and one failed message (for example Ollama unavailable) does not stop the others
  6. Every trace has a classifier span marked skipped ("not trained"), sitting between the exact-rules span and the LLM span, so M2 can fill it in without changing the trace layout

**Plans**: TBD

### Phase 4: Labels and Real-Inbox Run

**Goal**: Sift auto-labels a real Proton inbox, holds what it is unsure about, and the owner can explain any decision.
**Depends on**: Phase 3
**Requirements**: ACT-01, ACT-02, ACT-03, ACT-04, ACT-05, TRC-05, SEC-02, E2E-01
**Success Criteria** (what must be TRUE):
  1. A confidently classified message shows up under its label in the Proton mail client, applied the way the spike found works, and the decision's action span records what was done and when
  2. A message held for review receives no label, and its action span says it went to review and why
  3. Owner can print the full trace for any message from the command line or a documented SQL query, and no trace data appears in the mailbox
  4. Every change Sift made in the mailbox is recorded in `label_event`, and every label it applied is marked as applied by Sift and not owner-confirmed
  5. Sift runs against one real Proton mailbox on the target machine end to end (exact rules plus the LLM), and a sample of the resulting decisions can each be explained from its trace; Sift never sent, deleted or forwarded anything, and nothing left the machine except calls to the configured model URL

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation and Isolation | v0.1 | 13/13 | Complete    | 2026-10-04 |
| 2. Bridge Spike and IMAP Ingest | v0.1 | 12/19 | In Progress|  |
| 3. Tiered Classification with Traces | v0.1 | 0/0 | Not started | - |
| 4. Labels and Real-Inbox Run | v0.1 | 0/0 | Not started | - |

## Backlog (future README milestones, not planned phases)

Held here so the scope is visible; each becomes its own milestone with its own requirements when started. Phase numbering continues from Phase 5.

- **M2 Learn**: review queue with "Why?" traces, one-key labeling, the classifier retrained on every correction, cold-start thresholds, spot checks, quick confirm, learning from mail-app relabels (builds on the Phase 2 spike and the Phase 4 `label_event` record)
- **M3 Plain-English rules**: `rules.md`, interpretation step, `rules.lock.yaml`, rules editor, conflict handling for previously confirmed labels
- **M4 Evals**: synthetic inbox, per-tier metrics, model comparison, rule-change preview, `learn-from-llm` experiment (decide how synthetic eval runs fit under non-null `mailbox_id`, for example a dedicated synthetic mailbox)
- **M5 Multiple mailboxes**: manage in UI, per-mailbox rules and classifiers, `shared-rules.md` (merged at read time), unified review queue via a separate read-only role, isolation eval suite in `evals/isolation/`
- **M6 Guardrails**: injection eval suite in CI, audit view, public demo on synthetic data
- **M7 Extras**: draft replies to recruiters from `resume.yaml`, webhooks (for example n8n)

---
*Roadmap created: 2026-10-02*
