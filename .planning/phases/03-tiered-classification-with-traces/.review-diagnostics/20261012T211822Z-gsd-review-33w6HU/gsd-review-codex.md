codex review failed or returned empty output. stderr:
OpenAI Codex v0.145.0
--------
workdir: /Users/samuel/dev/sift
model: gpt-5.5
provider: openai
approval: never
sandbox: read-only
reasoning effort: high
reasoning summaries: none
session id: 01a131f6-f091-75d2-96c3-aa6d232a062a
--------
user
# Cross-AI Plan Review Request

You are reviewing implementation plans for a software project phase.
Provide structured feedback on plan quality, completeness, and risks.

## Project Context
# Sift

## What This Is

Sift is self-hosted email triage for one owner on a small always-on home machine (mini PC or Mac mini). It reads mailboxes over IMAP (Proton Mail via Proton Bridge first), sorts each message into owner-defined categories, and applies them as labels in the mail client. A cheap exact-rule tier handles the obvious mail, a small local LLM handles the rest, and (in later milestones) a tiny classifier trained on the owner's own corrections takes over. When nothing is confident, Sift asks the owner instead of guessing.

Email never leaves the network: no cloud model, no telemetry, no accounts. Status is pre-alpha; the README describes the target, and this planning set scopes the first milestone (M1 Classify).

## Core Value

Every incoming email is auto-labelled correctly or explicitly held for the owner, entirely on local hardware, and the owner can always see why Sift decided what it did (a decision trace for every classification).

## Current Milestone: M1 Classify ("M1 on real inbox")

**Developer-facing success metric:** one Proton mailbox auto-labelled end-to-end (exact rules + the local LLM) via IMAP/Proton Bridge, with a decision trace for every classification, a mailbox-scoped schema with row-level security from day one, and the Proton Bridge spike (labels as folders, CONDSTORE/QRESYNC, Message-ID reliability) answered.

M1 has no UI, no classifier, no learning, and hardcoded exact rules. It exists to prove the pipeline against a real inbox and to lock the data boundary and trace shape before anything is built on top of them.

**Target runtime:** self-hosted on a small home machine (mini PC / Mac mini); local-only, no cloud model, no telemetry. Docker Compose for the services; on Apple Silicon Ollama runs natively and containers reach it at `host.docker.internal:11434`.

## Requirements

### Validated

- ✓ Foundation: Compose stack (Postgres + pgvector, worker), Drizzle schema and migrations, per-mailbox config with credentials from environment variables — Phase 1
- ✓ Isolation: non-null `mailbox_id` on every mail-derived table, Postgres RLS keyed on `app.mailbox_id`, automated two-mailbox RLS test — Phase 1

### Active

M1 scope. Full IDs and wording in `.planning/REQUIREMENTS.md`.

- [ ] Proton Bridge spike answered and recorded (label folders, CONDSTORE/QRESYNC, Message-ID consistency, UIDVALIDITY behaviour)
- [ ] IMAP ingest of one mailbox into the database, idempotent, resumable
- [ ] Hardcoded exact rules and the local LLM (Ollama, JSON-schema constrained output, fenced untrusted email)
- [ ] Decision trace (`decision` table) for every classification, replayable by version
- [ ] Labels applied in the Proton mailbox as label folders; uncertain messages held for review; every Sift change recorded for later echo suppression
- [ ] End-to-end run on a real inbox

### Out of Scope (for M1)

- Web UI of any kind (review queue, "Why?" links, rules editor) — M1 is CLI/worker only; traces are inspected via CLI or SQL
- The embedding classifier, retraining, cold-start thresholds, spot checks — M2
- Quick confirm and learning from mail-app relabels — M2 (the spike that unblocks it is in M1)
- Plain-English `rules.md`, interpretation step, `rules.lock.yaml` — M3 (M1 rules are hardcoded)
- Synthetic inbox, eval harness, model comparison, rule-change preview — M4
- Managing multiple mailboxes in the UI, `shared-rules.md`, unified review queue, isolation eval suite — M5 (the schema is multi-mailbox-ready from M1)
- Injection eval suite, audit view, public demo — M6 (basic fencing and label-only actions are in M1)
- Draft replies, webhooks — M7
- Sending, deleting or forwarding email — never planned; Sift only applies labels (and later drafts)
- Hosted version, multiple users/accounts — not planned (ADR-0001 keeps the door open without a rewrite)

## Context

- Source material: three accepted ADRs (docs/adr/0001-0003) and the README, ingested into `.planning/intel/`. No PRDs or SPECs exist, so requirements here are derived from the README roadmap (M1-M7) and the ADRs.
- Planned stack (README): TypeScript end to end (the classifier included, no Python), React Router v7, Hono, Postgres + pgvector, Drizzle, Ollama, Docker Compose. Planned layout: `apps/worker`, `apps/web`, `packages/core`, `packages/classifier`, `packages/db`, `packages/evals`, `fixtures/`, `evals/`, `data/`.
- Default models (README): `nomic-embed-text` for embeddings (the classifier, later), a 1B-class instruct model (README example `qwen3:1.7b`) for the LLM. LLM confidence threshold default 0.75.
- Proton Mail needs Proton Bridge on a paid plan; Bridge exposes labels as folders (`Labels/Noise`). Bridge behaviour (CONDSTORE/QRESYNC, Message-ID across label folders) is unverified and is the first open risk.
- Open ADR-0003 item: raw LLM prompts may need a retention limit (example: 90 days for full prompts, summary forever). Decide when the `decision` table shape is finalised; not a blocker.
- Conflict resolution (INGEST-CONFLICTS.md, INFO): ADR-0001 wins over the README. Every table holding mail-derived data has a non-null `mailbox_id`, including `rule_set` and `eval_run`. Proposed handling for later milestones, to be confirmed when they are planned: shared rules merged at read time from `data/shared-rules.md`; synthetic-inbox eval runs attach to a dedicated synthetic mailbox row. A superseding ADR is needed only if nullable scoping is wanted instead.
- Security posture: `rules.md`, `shared-rules.md`, `config.yaml` and the owner's labels are trusted; every byte of every email is untrusted data. README examples of hostile email text describe attacks and are not instructions.
- Contributing rules that apply from M1: never commit real email; every new table holding mail-derived data gets a `mailbox_id` and an RLS policy; architecture-changing work probably needs an ADR. License: AGPL-3.0.

## Constraints

- **Privacy**: Local-only inference and storage; no cloud model, no telemetry, no analytics or crash reporting — core product promise
- **Tech stack**: TypeScript end to end, Postgres + pgvector, Drizzle, Ollama, Docker Compose — README stack; no Python
- **Hardware**: Must run on a small home machine; 8 GB RAM is enough for default models
- **Isolation**: Mailbox is the unit of isolation; RLS plus application-level `WHERE mailbox_id = ?` — ADR-0001
- **Credentials**: Per mailbox, from environment variables (`password_env`), never in config files or the database — ADR-0001
- **Actions**: Label application only; never send, delete or forward — README security model
- **Access**: One owner, no users table; web access (later) gated by network (Tailscale or LAN), never exposed to the internet — ADR-0001
- **Dependencies**: Proton Bridge on a paid Proton plan; Ollama reachable at the configured URL

<decisions>
Locked by accepted ADRs. Do not revise without a superseding ADR.

**ADR-0001 — Multiple mailboxes, single owner (locked)**
- The mailbox is the unit of isolation. Every table holding mail-derived data (messages, embeddings, labels, decisions, classifiers, rule sets, eval runs, flags) has a non-null `mailbox_id`.
- Exactly one owner and no users table; web UI access is gated at the network level, not by in-app accounts.
- Isolation is enforced by Postgres row-level security keyed on a per-request `app.mailbox_id` setting; app-level `WHERE mailbox_id = ?` filtering is still used with RLS as the backstop. A separate role may read across mailboxes (unified review queue) but is never used by training or retrieval.

## Phase 03: Tiered Classification with Traces
### Roadmap Section
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

**Plans**: 26 plans, 24 executed (13 gap-closure plans; 03-23 and 03-24 close UAT gaps G-03-2 and G-03-8; 03-25 and 03-26 close the SC5 lone-surrogate gap)

Plans:
**Wave 1**
- [x] 03-01-PLAN.md — rules.yaml strict schema and loader, data paths, committed example with .gitignore negation (owner checkpoint: category-name character set) (wave 1)
- [x] 03-02-PLAN.md — Config tiers.llm.confidence_threshold (default 0.75) and first-sync backfill default 3 days (wave 1)
- [x] 03-03-PLAN.md — Schema: decision typed columns and spans, rule_set versions (append-only), unscoped prompt_version, migrations 0008-0010, test-support rows (wave 1)
- [x] 03-05-PLAN.md — Core contracts: fenced prompt, output schema and re-validation, spans schema, prompt-version hash (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-04-PLAN.md — Exact-rule matcher with nearest miss, decide() with threshold and review reasons, rule-set content hash (wave 2)
- [x] 03-06-PLAN.md — @sift/db: pending and re-run queries, recordDecision single write path, ensureRuleSet, ensurePromptVersion, restoreBody (wave 2)
- [x] 03-07-PLAN.md — Ollama client, LLM tier (retry once), preflight, single-flight gate, fake Ollama (wave 2)
- [x] 03-11-PLAN.md — sift config check validates rules files, rename guard (D-07), read-only data mount in Compose (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03-08-PLAN.md — Classification pass: locked chunks, newest first, 25-call cap, outage handling, per-message isolation, replayable traces (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 03-09-PLAN.md — Worker batch runs classification after ingest, per-mailbox status for rules and Ollama errors, sift worker wiring (wave 4)
- [x] 03-12-PLAN.md — `sift classify <slug>` re-runs with count/confirm and lock, identity-checked body refetch (wave 4)

**Wave 5** *(blocked on Wave 4 completion)*
- [x] 03-10-PLAN.md — Synthetic hostile fixtures and injection pairs through ingest and classification; leak and hermeticity guards (wave 5)

**Wave 6** *(blocked on Wave 5 completion)*
- [x] 03-13-PLAN.md — README/CONTRIBUTING for rules.yaml, Ollama and sift classify; live-baseline runner and owner baseline (wave 6)

**Gap closure** *(03-VERIFICATION gaps CR-01..03 with WR-01..03; gap waves 1-5)*
- [x] 03-14-PLAN.md — CR-02: a body restored or re-inserted for an already-decided message expires 7 days after the write; T-03-20 closed (gap wave 1)
- [x] 03-15-PLAN.md — CR-03: spend the volume-valve approval and record last_sync_at with the ingest, inside the lock (gap wave 1)
- [x] 03-16-PLAN.md — WR-01: control characters in the model reason are invalid output (retry, then review); NUL backstop in recordDecision (gap wave 2)
- [x] 03-17-PLAN.md — CR-01: a 500 or timeout confined to one message skips only that message (re-probe, per-pass budget); no backoff (gap wave 2)
- [x] 03-18-PLAN.md — WR-03/CR-01: owner-visible notice naming unclassified messages, 3-pass hold-back with a canary check (gap wave 3)
- [x] 03-19-PLAN.md — Owner checkpoint (one-way door): review llm_error terminal state, core and DB contract, migration 0011 (gap wave 4)
- [x] 03-20-PLAN.md — Worker writes review llm_error after 3 passes; runs only if 03-19 chose option-review (gap wave 5)
- [x] 03-21-PLAN.md — WR-02: rules.yaml rejects control characters, so sift config check and the worker agree (gap wave 1; split from 03-16)
- [x] 03-22-PLAN.md — CR-01/WR-03: sift classify names a message Ollama failed on alone; README explains the notice (gap wave 4; split from 03-18)

**UAT gap closure** *(03-UAT gaps G-03-2 and G-03-8; one wave, run in parallel)*
- [x] 03-23-PLAN.md — G-03-2: live baseline runner prints progress per email on stderr; run docs say a few minutes, repo root (gap wave 1)
- [x] 03-24-PLAN.md — G-03-8: README intro links the quick start; 12 steps led by bold imperatives, list shape pinned (gap wave 1)

**Gap closure** *(03-VERIFICATION 2026-10-12 gap: SC5 / CLS-06 lone-surrogate path, WR-04 and WR-05; one wave, run in parallel)*
- [ ] 03-25-PLAN.md — WR-04: a lone-surrogate model reason is invalid output (retry, then review); toWellFormed backstop in recordDecision; five in a row no longer stop the pass (gap wave 1)
- [ ] 03-26-PLAN.md — WR-05: rules.yaml rejects unpaired surrogates (same isWellFormed predicate), so sift config check and the worker agree (gap wave 1)

### Requirements Addressed
# Requirements: Sift

**Defined:** 2026-10-02
**Core Value:** Every incoming email is auto-labelled correctly or explicitly held for the owner, entirely on local hardware, and the owner can always see why Sift decided what it did.

Derived from the README roadmap (M1 Classify) and the three locked ADRs. No PRDs or SPECs exist in the ingest set. Wording is "the owner" because Sift has exactly one user.

## v1 Requirements

Current milestone: M1 Classify ("M1 on real inbox"). Each maps to one roadmap phase.

### Foundation

- [x] **FND-01**: Owner can bring up the stack (Postgres with pgvector, worker) on the home machine with Docker Compose, with migrations applied automatically or by one documented command
- [x] **FND-02**: Owner can define a mailbox in `config.yaml` (slug, IMAP host/port/username/folder, label mode `proton_labels`) and the model settings (Ollama URL, embedding and LLM model names, LLM confidence threshold); a mailbox's password is read from the environment variable named by `password_env` and is never stored in a config file or the database
- [x] **FND-03**: The repository has the TypeScript workspace layout the milestone needs (`apps/worker`, `packages/core`, `packages/db`) with Drizzle schema and migrations in `packages/db`

### Isolation

- [x] **ISO-01**: Every table holding mail-derived data (message, label, decision, folder_sync, label_event, rule_set, and any other added in M1) has a non-null `mailbox_id` foreign key to `mailbox`
- [x] **ISO-02**: Every such table has an RLS policy keyed on the per-request `app.mailbox_id` setting, RLS is forced for the worker's application role (not the table owner, not a superuser), and a missing setting returns no rows
- [x] **ISO-03**: An automated test seeds two mailboxes and proves that, under each mailbox's `app.mailbox_id`, reads and writes never touch the other mailbox's rows even with the application-level `WHERE mailbox_id` filter removed
- [x] **ISO-04**: Application code also filters by `mailbox_id` explicitly (RLS is the backstop, not the only mechanism)

### Bridge Spike

- [x] **SPK-01**: The way Proton Bridge exposes labels as IMAP folders is documented from a real mailbox: folder naming (`Labels/<name>`), how a label is applied to and removed from a message, and whether a message appears in several folders at once
- [x] **SPK-02**: CONDSTORE and QRESYNC support (advertised capability and observed behaviour for flag/label changes and deletions) is determined and documented
- [x] **SPK-03**: `Message-ID` consistency for one message across INBOX and label folders is determined, along with how often it is missing or duplicated, and whether a hash-of-stable-headers fallback is viable
- [x] **SPK-04**: UIDVALIDITY behaviour across Bridge restarts and resyncs is determined; the spike result is written to a findings document stating which of CONDSTORE/QRESYNC/polling-only the later relabel sync must assume and what Phase 4 label application must do differently, if anything

### Ingest

- [x] **ING-01**: Worker connects to the configured mailbox through Proton Bridge using the environment-supplied password and reads messages from the configured folder
- [x] **ING-02**: Each message is stored once in `message` with its `mailbox_id`, IMAP UID, UIDVALIDITY, `Message-ID` (or the fallback hash), headers and body text needed for classification; re-running ingest never creates duplicates
- [x] **ING-03**: New mail arriving after startup is picked up on a polling interval without restarting the worker
- [x] **ING-04**: Per-folder sync state (`folder_sync`) records UIDVALIDITY and the last position seen; a UIDVALIDITY change triggers a safe full resync that does not duplicate or re-classify already-stored messages

### Classification

- [x] **CLS-01**: Sift evaluates a hardcoded, versioned set of exact rules (sender, domain, phrase) for the mailbox deterministically in code; a match yields a category with no LLM call
- [x] **CLS-02**: When no exact rule matches, Sift calls the local LLM through Ollama with a prompt in separated parts: the mailbox's categories and judgment rules (trusted), then the email, fenced off and marked untrusted
- [x] **CLS-03**: The LLM's output is constrained by JSON schema to a category from the mailbox's category list, a confidence, and a one-sentence reason; malformed or out-of-category output is retried once, then the message is sent to review
- [ ] **CLS-04**: An LLM result below the confidence threshold (default 0.75) sends the message to review instead of labelling it
- [ ] **CLS-05**: No tier can return a label outside the mailbox's category list, and no tier output can trigger any action other than the single label decision (no tool calls, no invented labels)
- [x] **CLS-06**: The pipeline processes each ingested message exactly once per rule-set/prompt/model version combination unless explicitly re-run, and a failure in one message (Ollama down, malformed mail) does not stop the others

### Decision Traces

- [x] **TRC-01**: Every classification writes a `decision` row with one span per tier that ran and a final action span, scoped by `mailbox_id`
- [ ] **TRC-02**: The exact-rules span records rules checked, matches, and the nearest miss
- [ ] **TRC-03**: The LLM span records model, prompt version, rules included, examples retrieved (empty in M1), the raw model output, the validation result, and the confidence
- [ ] **TRC-04**: The decision records the rule set, prompt and model versions so the decision can be replayed later (rule set and prompt versions are stored as versioned rows, not inferred)
- [ ] **TRC-05**: The owner can retrieve the full trace for any message from the command line or a documented SQL query; nothing from the trace is written into the mailbox
- [ ] **TRC-06**: Every trace includes a classifier span even before the classifier exists; in M1 it is recorded as skipped with the reason "not trained", so the trace layout does not change when the classifier arrives in M2

### Actions

- [ ] **ACT-01**: When a decision is confident, Sift applies the category as a label in the mailbox in the way the spike found to work with Proton Bridge (label folder under `Labels/`), and the action span records what was done and when
- [ ] **ACT-02**: Messages sent to review get no label; the action span records that they went to review and why
- [ ] **ACT-03**: Every change Sift makes in the mailbox is recorded in `label_event` so a later sync can ignore Sift's own changes (echo suppression)
- [ ] **ACT-04**: The `label` row records that the label was applied by Sift and not confirmed by the owner, so automatically applied labels can never enter the classifier's training set
- [ ] **ACT-05**: Sift never sends, deletes, or forwards mail and never modifies message content; the IMAP operations it issues are limited to reading and applying/removing its own labels

### Security Basics

- [x] **SEC-01**: Email content (subject, body, headers, attachment names) is treated as untrusted data everywhere: it is only ever placed in the fenced section of an LLM prompt, never in the trusted part, and never interpreted as instructions by exact rules or code
- [ ] **SEC-02**: No email content, prompt, or trace is sent anywhere other than the configured model URL; there is no telemetry, analytics, or crash reporting in the worker

### End to End

- [ ] **E2E-01**: One real Proton mailbox, running through Proton Bridge on the target machine, is auto-labelled end to end (exact rules plus the local LLM), and a sampled set of the resulting decisions can each be explained from its trace

## v2 Requirements

Later README milestones. Tracked, not in the current roadmap, not yet decomposed into IDs. Each will be refined when its milestone starts.

### M2 Learn

- **LRN-xx**: Review queue with "Why?" traces, one-key labeling
- **LRN-xx**: The embedding classifier retrained on every owner label; cold-start thresholds (`min_examples_per_category`); spot checks
- **LRN-xx**: Quick confirm batches; learning from relabels in the mail app (interpretation table, trace-based correction routing)

### M3 Plain-English Rules

- **RUL-xx**: `rules.md`, interpretation step, `rules.lock.yaml`, rules editor, conflict handling for previously confirmed labels

### M4 Evals

- **EVL-xx**: Synthetic inbox, per-tier metrics, model comparison, rule-change preview, `learn-from-llm` experiment

### M5 Multiple Mailboxes

- **MBX-xx**: Mailbox management in UI, per-mailbox rules and classifiers, `shared-rules.md`, unified review queue (separate read role), isolation eval suite

### M6 Guardrails

- **GRD-xx**: Injection eval suite in CI, audit view, public demo on synthetic data

### M7 Extras

- **EXT-xx**: Draft replies to recruiters from `resume.yaml`, webhooks (for example n8n)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web UI in M1 | M1 proves the pipeline and trace shape; UI starts in M2 |
| Classifier in M1 | Needs owner-confirmed labels that do not exist until the review queue and quick confirm (M2) |
| Learning from relabels in M1 | Needs the spike result first; implementation is M2 |
| `rules.md` / `rules.lock.yaml` in M1 | Hardcoded exact rules suffice for the proof; plain-English rules are M3 |
| Sending, deleting, forwarding mail | Security model: Sift only labels (and later drafts) |
| Hosted version | Contradicts local-only promise (ADR-0001 rejected hosted multi-tenant) |
| Multiple users / accounts | One owner by design; ADR-0001 keeps the door open |
| Shared learning across mailboxes | Deferred in ADR-0001; would need explicit off-by-default setting and isolation tests |
| Telemetry, cloud model by default | Privacy promise |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Complete |
| FND-02 | Phase 1 | Complete |
| FND-03 | Phase 1 | Complete |
| ISO-01 | Phase 1 | Complete |
| ISO-02 | Phase 1 | Complete |
| ISO-03 | Phase 1 | Complete |
| ISO-04 | Phase 1 | Complete |
| SPK-01 | Phase 2 | Complete |
| SPK-02 | Phase 2 | Complete |
| SPK-03 | Phase 2 | Complete |
| SPK-04 | Phase 2 | Complete |
| ING-01 | Phase 2 | Complete |
| ING-02 | Phase 2 | Complete |
| ING-03 | Phase 2 | Complete |
| ING-04 | Phase 2 | Complete |
| CLS-01 | Phase 3 | Complete |
| CLS-02 | Phase 3 | Complete |
| CLS-03 | Phase 3 | Complete |
| CLS-04 | Phase 3 | Gaps Found |
| CLS-05 | Phase 3 | Gaps Found |
| CLS-06 | Phase 3 | Complete |
| TRC-01 | Phase 3 | Complete |
| TRC-02 | Phase 3 | Gaps Found |
| TRC-03 | Phase 3 | Gaps Found |
| TRC-04 | Phase 3 | Gaps Found |
| TRC-06 | Phase 3 | Gaps Found |
| SEC-01 | Phase 3 | Complete |
| TRC-05 | Phase 4 | Pending |
| ACT-01 | Phase 4 | Pending |
| ACT-02 | Phase 4 | Pending |
| ACT-03 | Phase 4 | Pending |
| ACT-04 | Phase 4 | Pending |
| ACT-05 | Phase 4 | Pending |
| SEC-02 | Phase 4 | Pending |
| E2E-01 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-02*
*Last updated: 2026-10-02 after roadmap creation*

### User Decisions (CONTEXT.md)
# Phase 3: Tiered Classification with Traces - Context

**Gathered:** 2026-10-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Every ingested, eligible message with a live location gets a decision: a category from the mailbox's exact rules, a category from the local LLM (Ollama), or "review". The decision is written as an append-only `decision` row whose trace has one span per tier (exact rules, classifier marked skipped "not trained", LLM when it ran) plus an action span, and references versioned rule-set and prompt rows so it can be replayed.

Requirements: CLS-01..06, TRC-01..04, TRC-06, SEC-01.

Not in this phase: applying labels in the mailbox, `label_event` echo records, `label` rows, the trace-viewing CLI (TRC-05) — all Phase 4. No UI, no classifier, no `rules.md` interpretation (M2/M3).

</domain>

<decisions>
## Implementation Decisions

### Rules and categories source
- **D-01:** Each mailbox's exact rules, category list and LLM judgment rules live in `data/mailboxes/<slug>/rules.yaml`, validated by a strict Zod schema in `packages/core` (unknown keys are errors with YAML path, same style as config, P1 D-57). The shape mirrors README's `rules.lock.yaml` (`rules: [{ kind: exact, match: {...}, label: <Category> }]`) so M3 changes how the file is produced, not how it is read. "Hardcoded" in the roadmap means "not interpreted from plain English", not "in TypeScript". — **Reversibility:** costly — the file shape becomes the owner's editing surface and the rule_set snapshot format; M3 must read or migrate it.
- **D-02:** The file holds: `categories` (each a name plus a one-line description, like README's rules.md `# Categories`), optional `judgment` rules (plain-English sentences given to the LLM as trusted instructions, like README's `# Rules`), and exact `rules`.
- **D-03:** Versioning by content hash: when classifying, the worker hashes the normalised parsed file; a new hash inserts a `rule_set` row (per-mailbox increasing version number, hash, full snapshot of the validated content). Decisions reference `rule_set.id`. No setup step needed after editing rules.yaml. — **Reversibility:** costly — decisions FK to rule_set rows; replay depends on the snapshot.
- **D-04:** `data/mailboxes/example/rules.example.yaml` (or equivalent path, planner's choice) is committed and parsed by a CI test with the real schema (same idea as P1 D-61). Real `data/mailboxes/*/rules.yaml` files are gitignored (real senders must never be committed).
- **D-05:** Missing or invalid rules.yaml fails closed per mailbox: ingest keeps running, classification for that mailbox does not run, and `mailbox_status` shows a specific error naming the file and every problem with its YAML path. Other mailboxes are unaffected. `sift config check` also validates each configured mailbox's rules.yaml.
- **D-06:** Category names are strict and label-safe because they become Proton label folders (`Labels/<Category>`) in Phase 4: letters, digits, spaces, `-` and `&`; 1–40 characters; no `/`; unique case-insensitively; 2–20 categories per mailbox. Invalid names are rejected, never fixed (P1 D-63 style). — **Reversibility:** one-way — once labels exist as folders, renaming a category means relabelling mail.
- **D-07:** `sift mailbox rename <old> <new>` refuses until `data/mailboxes/<new>/rules.yaml` exists, telling the owner to move the folder. Sift never moves the owner's files.

### Exact-rule semantics
- **D-08:** Sender and domain conditions match the parsed **From address only**, case-insensitive. Domain conditions also match subdomains (`acme.com` matches `mail.acme.com`). Display name, Reply-To and Sender headers are ignored (trivially spoofed).
- **D-09:** Phrase conditions take `in: subject | body | any` (default `any`). Matching is a case-insensitive, whitespace-normalised plain substring — no regex (ReDoS on untrusted text, harder to explain). Body means the cached body text (P2 D-06).
- **D-10:** A rule's `match` may combine from/domain/phrase; all present fields must hold (AND). A list within one field is OR.
- **D-11:** Rules are evaluated in file order and the **first match wins** (firewall-style). All rules are still evaluated so the exact-rules span lists every match with the winner marked.
- **D-12:** Nearest miss (TRC-02), recorded only when no rule matched: the rule with the highest fraction of its conditions met (ties by file order), with per-condition pass/fail (e.g. `domain ✓, phrase ✗`).
- **D-13:** An exact rule's target must be one of the mailbox's categories (validated at load). Rules cannot send to review.

### Pipeline timing and re-runs
- **D-14:** Classification runs in the same per-mailbox batch as ingest (P1 D-49), after ingest, in chunks, inside the existing no-overlap task. Graceful shutdown stops between chunks.
- **D-15:** A message is pending when it is eligible for classification (P2 D-21), has a live location (P2 D-17) and has no decision row. Rule-set, prompt or model changes never trigger automatic reclassification. The worker never writes a second decision for a message on its own; the uniqueness mechanism is the planner's, but it must still allow explicit re-runs (D-17).
- **D-16:** Ollama unreachable or timing out is an infrastructure failure, not a classification: no decision is written, the message stays pending, the rest of that tick's LLM work stops, and `mailbox_status` gets a specific "Ollama unreachable" error with P1 D-51 backoff. Exact-rule decisions in the same tick are still written. Malformed or out-of-category output is different (D-24): retry once, then review. One bad message never stops the others (CLS-06).
  - Clarified by gap closure 03-17 (03-VERIFICATION gap 1, review CR-01): a chat HTTP 5xx or timeout after which a fresh mail-free preflight succeeds is a failure of that message, not an outage: no decision is written, the message stays pending and is skipped for that tick, and the tick's other LLM work goes on (at most 2 such messages per tick; one more is an outage). Outages behave exactly as D-16 says.
  - Amended by owner decision in gap closure 03-19 (2026-10-11): when Ollama fails on one message alone (re-probe healthy) in MESSAGE_FAILURE_PASSES (3) passes of one worker process and a mail-free canary chat then succeeds, that message gets a review decision with reason llm_error (tier llm, confidence null, the failed attempt recorded). An outage is still never a decision. (The owner, Samuel Kimama, chose option-review at the 03-19 checkpoint and accepted the 03-17 clarification above.)
- **D-17:** Explicit re-run: `sift classify <slug>` with `--message <id>`, `--since <date>` or `--all-pending` (exact flags are the planner's within the P1 D-24 `parseArgs` style). Re-running a decided message appends a new decision row; the latest decision is current. Over a count threshold it shows the count and asks for confirmation (like P2 D-75). It must not run concurrently with the worker on the same mailbox (P2 D-03 lock).
- **D-18:** LLM pacing: newest INTERNALDATE first, at most about 25 LLM calls per mailbox tick (code constant, not config), so new mail is never stuck behind backlog and ticks stay bounded.
- **D-19:** One Ollama request at a time, worker-wide (process-wide semaphore). Mailboxes still fail independently.
- **D-20 (amends P2 D-74):** The default `ingest.initial_backfill_days` changes from **30 to 3**. Folded into this phase as a small task: `DEFAULT_INITIAL_BACKFILL_DAYS` in `packages/core/src/config/schema.ts`, `config/config.example.yaml` (value and comment), README, and the tests that assert 30. The key name, range (0–365) and first-sync-only behaviour are unchanged. Mailboxes that already synced are unaffected; an owner config that sets 30 explicitly keeps 30.

### LLM call
- **D-21:** The trusted part of the prompt contains the mailbox's categories (name + description) and judgment rules. The untrusted part contains, each field labelled inside a fence delimited by a per-call random nonce that the email cannot close: From address and display name, Subject, attachment names, and the cached body truncated to about 4,000 characters. Nothing from the email ever appears in the trusted part (SEC-01).
- **D-22:** Output via Ollama `format` = a JSON schema whose `category` is an enum of the mailbox's categories, plus `confidence` (0–1) and `reason` (one sentence). Confidence is the model's self-reported value; M4 evals calibrate the threshold.
- **D-23:** Model options: temperature 0, a fixed seed, qwen3 thinking disabled. The options used are recorded in the LLM span.
- **D-24:** Output is validated again in code after the schema (category in list, confidence in range, reason present). Invalid or out-of-category output is retried once; a second failure sends the message to review. Both raw outputs are recorded in the LLM span. No tier output can cause any action other than the single label decision (CLS-05).
- **D-25:** Config: add only `tiers.llm.confidence_threshold` (optional, default 0.75), matching the README's commented `tiers` block. Timeout and per-tick cap stay code constants. — **Reversibility:** one-way — strict config makes the key name part of every owner's config. Extend the strict schema, example config and its CI test.
- **D-26:** A result below the threshold is review, not a label (CLS-04).

### Trace shape and versions
- **D-27:** `decision` gets typed columns for what is queried — outcome (`labelled` / `review`), category (null for review), confidence, deciding tier, review reason code, `rule_set_id` (composite FK), `prompt_version_id`, model name — plus a `spans` JSONB array validated by a shared Zod schema carrying a trace format version. Append-only (P1 D-40 grants unchanged). — **Reversibility:** costly — every later reader (Phase 4 apply, TRC-05 CLI, M2 "Why?") depends on this shape.
- **D-28:** Spans, in this fixed order: `exact_rules` (rules checked, matches with winner, nearest miss), `classifier` (always present, `skipped`, reason "not trained", TRC-06), `llm` (when it ran: model, prompt version, judgment rules included, examples retrieved = empty, raw output(s), validation result, confidence, model options), `action`.
- **D-29:** The prompt template lives in code. Its hash keys an unscoped `prompt_version` table (version number, hash, template text, JSON schema shape), inserted on first use. Prompt templates are not mail-derived, so the table is added to the catalog allowlist with a reason and its own assertions (P1 D-37/D-38). Decisions store the prompt recipe (versions), never the rendered prompt (P2 D-09). — **Reversibility:** costly — decisions FK to it; the catalog test allowlist changes.
- **D-30:** The Phase 3 action span records the intended action (label `<Category>`, or hold for review with its reason) with status `pending`. Phase 4 records what was actually done as new append-only records (e.g. `label_event` plus its own action record), never by updating the decision. The trace layout does not change between phases.
- **D-31:** "Marked for review" in Phase 3 is `decision.outcome = review` with a reason code (`low_confidence`, `invalid_output`, `out_of_category`; the planner may add codes). No `label` row is written; that is Phase 4.
  - llm_error added by gap closure 03-19 (owner decision, 2026-10-11).
- **D-32:** Body cache: the first decision of either outcome sets the body row's `expires_at = decided_at + 7 days` (P2 D-07). A pending message keeps its body. A re-run whose body has expired refetches it from IMAP by identity (P2 D-08).

### Testing
- **D-33:** Injection and failure isolation are proven in CI with committed **synthetic** hostile `.eml` fixtures and a fake Ollama: email text stays inside the fence; a fake Ollama returning an injected or out-of-list label is rejected; nothing besides the single decision happens; Ollama-down leaves messages pending and other messages unaffected. An optional live-model smoke test is run manually and is not part of CI.

### Claude's Discretion
- Exact rules.yaml key names and nesting beyond D-01/D-02/D-09/D-10 (the planner proposes; it is owner-facing, so keep README vocabulary).
- How the `data/` directory is mounted into the worker and setup containers (read-only), and any `SIFT_DATA` override.
- Hash normalisation for rule_set and prompt_version.
- Ollama timeout value, retry backoff timings, the exact per-tick cap.
- Fence format and nonce length; exact body truncation point (about 4,000 characters).
- Reason-code names beyond those in D-31; the uniqueness mechanism in D-15.
- Plan split and wave ordering.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture decisions (locked)
- `docs/adr/0002-tiered-classification.md` — tiers, escalation, LLM prompt structure, what the classifier may train on
- `docs/adr/0003-traces-and-mail-app-relabels.md` — decision trace spans and their contents, replay by version
- `docs/adr/0001-multiple-mailboxes-single-owner.md` — mailbox_id on every mail-derived table, RLS, no cross-mailbox learning

### Project planning
- `.planning/PROJECT.md` — constraints, security posture (all email is untrusted), M1 out-of-scope list
- `.planning/REQUIREMENTS.md` — CLS-01..06, TRC-01..04, TRC-06, SEC-01 wording; TRC-05 and ACT-* are Phase 4
- `.planning/ROADMAP.md` — Phase 3 success criteria 1–6
- `.planning/phases/01-foundation-and-isolation/01-CONTEXT.md` — D-37/D-38 catalog test and allowlist, D-40 append-only grants, D-41 RLS policy, D-43/D-44 scoped API, D-49–D-51 scheduler/backoff, D-57/D-59 strict config, D-71 threshold arrives in Phase 3
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-CONTEXT.md` — D-06/D-07 body cache and expiry, D-08/D-09 refetch and prompt-recipe retention, D-17/D-21 live location and eligibility, D-03 per-mailbox lock, D-74 backfill default (amended here by D-20), D-77 postal-mime
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md` — Bridge behaviour that constrains Phase 4 labelling (category names → label folders)

### Product documentation
- `README.md` — rules.md categories/rules example, rules.lock.yaml shape, decision-trace example, commented `tiers` config block, security model ("closed output"), data model table

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/db/src/schema/scoped.ts` — `decision` and `rule_set` exist with keys and timestamps only (D-01 of P1); extend via migration. `message.eligibleForClassification`, `message_body.expires_at` and `message_location` (live/removed) already exist.
- `packages/core/src/config/schema.ts` — strict Zod config with YAML-path errors; add `tiers.llm.confidence_threshold` and change `DEFAULT_INITIAL_BACKFILL_DAYS`. Its error style is the model for rules.yaml validation.
- `packages/db/test/support/catalog.ts` — `CATALOG_ALLOWLIST` (`Record<string, string>`) for the unscoped `prompt_version` table.
- `apps/worker/src/runtime/mailbox-batch.ts` — per-mailbox batch where classification is added after ingest; `recordSyncError` and friends for the Ollama-unreachable status.
- `withIngestLock` in `@sift/db` — the per-mailbox lock pattern for `sift classify` vs the worker.
- `apps/worker/test/support/` — fake IMAP server/stores; add a fake Ollama in the same style. `apps/worker/test/fixtures/mail/*.eml` — fixture convention for synthetic hostile mail.

### Established Patterns
- Apps reach the DB only through the scoped `@sift/db` API (Biome bans `pg`/`drizzle-orm` in `apps/**`).
- Every new mail-derived table: non-null `mailbox_id`, composite FK, forced RLS, standard policy, explicit grants, catalog test.
- Append-only tables grant `sift_app` SELECT + INSERT only.
- Error messages report every problem at once with YAML paths and suggest the fix.
- Exact dependency pins, license check, no install scripts (P2 D-77) for any new package (e.g. an Ollama client, if one is used at all).

### Integration Points
- Phase 4 reads decisions with outcome `labelled` and action span status `pending` to apply labels, and records results append-only (D-30).
- The TRC-05 trace CLI (Phase 4) reads `decision.spans` through the D-27 schema.

</code_context>

<specifics>
## Specific Ideas

- Fail closed per mailbox when rules are broken; never guess with a broken rule set.
- An infrastructure failure (Ollama down) is never recorded as a classification.
- The trace layout is fixed from the first decision: classifier span always present, action span always present.
- Sift never moves or writes the owner's files (rules.yaml).
- The owner wants a short default backfill: 3 days, not 30.

</specifics>

<deferred>
## Deferred Ideas

- Token-logprob confidence instead of self-reported — revisit with M4 evals.
- `tiers.llm.timeout_seconds` config key — only if slow hardware needs it.
- Live-model injection tests in CI — M6 injection eval suite.
- A `review` target for exact rules (force human review for e.g. the bank) — reconsider in M3 with rules.md.

</deferred>

---

*Phase: 03-tiered-classification-with-traces*
*Context gathered: 2026-10-08*

### Research Findings
# Phase 3: Tiered Classification with Traces - Research

**Researched:** 2026-10-10
**Domain:** Deterministic rule matching + local-LLM classification inside an existing Node 26 / Postgres 18 (forced RLS) worker; append-only decision traces
**Confidence:** HIGH (codebase integration verified by reading source this session; the LLM tier is already locked and verified in 03-AI-SPEC.md)

## Summary

Phase 3 adds no new dependencies. Everything it needs is already in the repo: Zod 4.6.5 and yaml 2.9.1 (`@sift/core`), Drizzle 0.45.3 and pg 8.23 (`@sift/db`), Node 26.10 built-in `fetch`, and postal-mime 4.0.0, which already exports `addressParser`. 03-AI-SPEC.md fixes the LLM tier: direct `POST /api/chat`, the `LlmClient` result union, the prompt fence, retry and validation, single-flight, and the E1–E11 eval gates. Treat it as the specification for that part and do not redesign it. This research covers what the AI-SPEC does not: how the tier plugs into the existing worker, scoped database API, migrations, catalog test, config schema, CLI table and test harness, and the places where those existing pieces will break or mislead the planner.

Three findings matter most for the plan. (1) The scoped API cannot express the pending query: no joins, no `NOT EXISTS`, no `ORDER BY`/`LIMIT`, no raw SQL. A dedicated helper has to be added inside `packages/db/src/scope.ts`, which is the only module with access to the transaction (precedent: `messageBodyApi.deleteExpired`). The unscoped `prompt_version` table also needs its own `@sift/db` function, modelled on `readRegistry(db)`. (2) Several existing pieces conflict with the AI-SPEC or the decisions as written. The shared worker test harness points `models.url` at `http://localhost:11434`, and a real Ollama 0.18.2 is running on this machine, so wiring classification into `runBatch` would make existing e2e tests call a real model. The AI-SPEC's "no `*.test.ts` names 11434" guard would fail on six existing test files. `.gitignore`'s `data/` rule makes `data/mailboxes/example/rules.example.yaml` (D-04) impossible to commit. (3) Every existing write to `decision` and `rule_set` inserts only keys: `seedScopedRows`, `isolation.test.ts`'s `insertStatement`, `scope.test.ts` and `ingest.test.ts`. Adding NOT NULL columns breaks all of them, so the migration plan must include those test-support edits.

**Primary recommendation:** Build bottom-up in waves: (W1) pure `@sift/core` modules (rules schema, matcher, spans schema, the prompt and output code from AI-SPEC, the config `tiers` key, D-20) plus the migration and catalog changes; (W2) `@sift/db` use-cases (pending query, `recordDecision`, `ensureRuleSet`, `ensurePromptVersion`) plus the worker's Ollama client, fake Ollama and LLM tier; (W3) the classification pass wired into `runBatch` behind an injectable dependency, Compose/`SIFT_DATA` mounts and status errors; (W4) `sift classify`, refetch, docs and the live baseline.

## User Constraints

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Rules and categories source
- **D-01:** Each mailbox's exact rules, category list and LLM judgment rules live in `data/mailboxes/<slug>/rules.yaml`, validated by a strict Zod schema in `packages/core` (unknown keys are errors with YAML path, same style as config, P1 D-57). The shape mirrors README's `rules.lock.yaml` (`rules: [{ kind: exact, match: {...}, label: <Category> }]`) so M3 changes how the file is produced, not how it is read. "Hardcoded" in the roadmap means "not interpreted from plain English", not "in TypeScript". — **Reversibility:** costly — the file shape becomes the owner's editing surface and the rule_set snapshot format; M3 must read or migrate it.
- **D-02:** The file holds: `categories` (each a name plus a one-line description, like README's rules.md `# Categories`), optional `judgment` rules (plain-English sentences given to the LLM as trusted instructions, like README's `# Rules`), and exact `rules`.
- **D-03:** Versioning by content hash: when classifying, the worker hashes the normalised parsed file; a new hash inserts a `rule_set` row (per-mailbox increasing version number, hash, full snapshot of the validated content). Decisions reference `rule_set.id`. No setup step needed after editing rules.yaml. — **Reversibility:** costly — decisions FK to rule_set rows; replay depends on the snapshot.
- **D-04:** `data/mailboxes/example/rules.example.yaml` (or equivalent path, planner's choice) is committed and parsed by a CI test with the real schema (same idea as P1 D-61). Real `data/mailboxes/*/rules.yaml` files are gitignored (real senders must never be committed).
- **D-05:** Missing or invalid rules.yaml fails closed per mailbox: ingest keeps running, classification for that mailbox does not run, and `mailbox_status` shows a specific error naming the file and every problem with its YAML path. Other mailboxes are unaffected. `sift config check` also validates each configured mailbox's rules.yaml.
- **D-06:** Category names are strict and label-safe because they become Proton label folders (`Labels/<Category>`) in Phase 4: letters, digits, spaces, `-` and `&`; 1–40 characters; no `/`; unique case-insensitively; 2–20 categories per mailbox. Invalid names are rejected, never fixed (P1 D-63 style). — **Reversibility:** one-way — once labels exist as folders, renaming a category means relabelling mail.
- **D-07:** `sift mailbox rename <old> <new>` refuses until `data/mailboxes/<new>/rules.yaml` exists, telling the owner to move the folder. Sift never moves the owner's files.

#### Exact-rule semantics
- **D-08:** Sender and domain conditions match the parsed **From address only**, case-insensitive. Domain conditions also match subdomains (`acme.com` matches `mail.acme.com`). Display name, Reply-To and Sender headers are ignored (trivially spoofed).
- **D-09:** Phrase conditions take `in: subject | body | any` (default `any`). Matching is a case-insensitive, whitespace-normalised plain substring — no regex (ReDoS on untrusted text, harder to explain). Body means the cached body text (P2 D-06).
- **D-10:** A rule's `match` may combine from/domain/phrase; all present fields must hold (AND). A list within one field is OR.
- **D-11:** Rules are evaluated in file order and the **first match wins** (firewall-style). All rules are still evaluated so the exact-rules span lists every match with the winner marked.
- **D-12:** Nearest miss (TRC-02), recorded only when no rule matched: the rule with the highest fraction of its conditions met (ties by file order), with per-condition pass/fail (e.g. `domain ✓, phrase ✗`).
- **D-13:** An exact rule's target must be one of the mailbox's categories (validated at load). Rules cannot send to review.

#### Pipeline timing and re-runs
- **D-14:** Classification runs in the same per-mailbox batch as ingest (P1 D-49), after ingest, in chunks, inside the existing no-overlap task. Graceful shutdown stops between chunks.
- **D-15:** A message is pending when it is eligible for classification (P2 D-21), has a live location (P2 D-17) and has no decision row. Rule-set, prompt or model changes never trigger automatic reclassification. The worker never writes a second decision for a message on its own; the uniqueness mechanism is the planner's, but it must still allow explicit re-runs (D-17).
- **D-16:** Ollama unreachable or timing out is an infrastructure failure, not a classification: no decision is written, the message stays pending, the rest of that tick's LLM work stops, and `mailbox_status` gets a specific "Ollama unreachable" error with P1 D-51 backoff. Exact-rule decisions in the same tick are still written. Malformed or out-of-category output is different (D-24): retry once, then review. One bad message never stops the others (CLS-06).
- **D-17:** Explicit re-run: `sift classify <slug>` with `--message <id>`, `--since <date>` or `--all-pending` (exact flags are the planner's within the P1 D-24 `parseArgs` style). Re-running a decided message appends a new decision row; the latest decision is current. Over a count threshold it shows the count and asks for confirmation (like P2 D-75). It must not run concurrently with the worker on the same mailbox (P2 D-03 lock).
- **D-18:** LLM pacing: newest INTERNALDATE first, at most about 25 LLM calls per mailbox tick (code constant, not config), so new mail is never stuck behind backlog and ticks stay bounded.
- **D-19:** One Ollama request at a time, worker-wide (process-wide semaphore). Mailboxes still fail independently.
- **D-20 (amends P2 D-74):** The default `ingest.initial_backfill_days` changes from **30 to 3**. Folded into this phase as a small task: `DEFAULT_INITIAL_BACKFILL_DAYS` in `packages/core/src/config/schema.ts`, `config/config.example.yaml` (value and comment), README, and the tests that assert 30. The key name, range (0–365) and first-sync-only behaviour are unchanged. Mailboxes that already synced are unaffected; an owner config that sets 30 explicitly keeps 30.

#### LLM call
- **D-21:** The trusted part of the prompt contains the mailbox's categories (name + description) and judgment rules. The untrusted part contains, each field labelled inside a fence delimited by a per-call random nonce that the email cannot close: From address and display name, Subject, attachment names, and the cached body truncated to about 4,000 characters. Nothing from the email ever appears in the trusted part (SEC-01).
- **D-22:** Output via Ollama `format` = a JSON schema whose `category` is an enum of the mailbox's categories, plus `confidence` (0–1) and `reason` (one sentence). Confidence is the model's self-reported value; M4 evals calibrate the threshold.
- **D-23:** Model options: temperature 0, a fixed seed, qwen3 thinking disabled. The options used are recorded in the LLM span.
- **D-24:** Output is validated again in code after the schema (category in list, confidence in range, reason present). Invalid or out-of-category output is retried once; a second failure sends the message to review. Both raw outputs are recorded in the LLM span. No tier output can cause any action other than the single label decision (CLS-05).
- **D-25:** Config: add only `tiers.llm.confidence_threshold` (optional, default 0.75), matching the README's commented `tiers` block. Timeout and per-tick cap stay code constants. — **Reversibility:** one-way — strict config makes the key name part of every owner's config. Extend the strict schema, example config and its CI test.
- **D-26:** A result below the threshold is review, not a label (CLS-04).

#### Trace shape and versions
- **D-27:** `decision` gets typed columns for what is queried — outcome (`labelled` / `review`), category (null for review), confidence, deciding tier, review reason code, `rule_set_id` (composite FK), `prompt_version_id`, model name — plus a `spans` JSONB array validated by a shared Zod schema carrying a trace format version. Append-only (P1 D-40 grants unchanged). — **Reversibility:** costly — every later reader (Phase 4 apply, TRC-05 CLI, M2 "Why?") depends on this shape.
- **D-28:** Spans, in this fixed order: `exact_rules` (rules checked, matches with winner, nearest miss), `classifier` (always present, `skipped`, reason "not trained", TRC-06), `llm` (when it ran: model, prompt version, judgment rules included, examples retrieved = empty, raw output(s), validation result, confidence, model options), `action`.
- **D-29:** The prompt template lives in code. Its hash keys an unscoped `prompt_version` table (version number, hash, template text, JSON schema shape), inserted on first use. Prompt templates are not mail-derived, so the table is added to the catalog allowlist with a reason and its own assertions (P1 D-37/D-38). Decisions store the prompt recipe (versions), never the rendered prompt (P2 D-09). — **Reversibility:** costly — decisions FK to it; the catalog test allowlist changes.
- **D-30:** The Phase 3 action span records the intended action (label `<Category>`, or hold for review with its reason) with status `pending`. Phase 4 records what was actually done as new append-only records (e.g. `label_event` plus its own action record), never by updating the decision. The trace layout does not change between phases.
- **D-31:** "Marked for review" in Phase 3 is `decision.outcome = review` with a reason code (`low_confidence`, `invalid_output`, `out_of_category`; the planner may add codes). No `label` row is written; that is Phase 4.
- **D-32:** Body cache: the first decision of either outcome sets the body row's `expires_at = decided_at + 7 days` (P2 D-07). A pending message keeps its body. A re-run whose body has expired refetches it from IMAP by identity (P2 D-08).

#### Testing
- **D-33:** Injection and failure isolation are proven in CI with committed **synthetic** hostile `.eml` fixtures and a fake Ollama: email text stays inside the fence; a fake Ollama returning an injected or out-of-list label is rejected; nothing besides the single decision happens; Ollama-down leaves messages pending and other messages unaffected. An optional live-model smoke test is run manually and is not part of CI.

### Claude's Discretion
- Exact rules.yaml key names and nesting beyond D-01/D-02/D-09/D-10 (the planner proposes; it is owner-facing, so keep README vocabulary).
- How the `data/` directory is mounted into the worker and setup containers (read-only), and any `SIFT_DATA` override.
- Hash normalisation for rule_set and prompt_version.
- Ollama timeout value, retry backoff timings, the exact per-tick cap.
- Fence format and nonce length; exact body truncation point (about 4,000 characters).
- Reason-code names beyond those in D-31; the uniqueness mechanism in D-15.
- Plan split and wave ordering.

### Deferred Ideas (OUT OF SCOPE)
- Token-logprob confidence instead of self-reported — revisit with M4 evals.
- `tiers.llm.timeout_seconds` config key — only if slow hardware needs it.
- Live-model injection tests in CI — M6 injection eval suite.
- A `review` target for exact rules (force human review for e.g. the bank) — reconsider in M3 with rules.md.

### Locked by 03-AI-SPEC.md (treat as locked)
- No LLM framework or SDK: direct `fetch` to Ollama `/api/chat` with `stream:false, think:false, truncate:false, shift:false`, options `{temperature:0, seed:42, num_predict:256, num_ctx:8192}`, `keep_alive:'30m'`, a 120 s per-call timeout combined with the shutdown signal via `AbortSignal.any`.
- The `LlmClient` result union `ok | infra | input_too_long | aborted`; a context-length 400 becomes `review/input_too_long`, never an infra failure.
- Per-tick preflight (`/api/version`, `/api/tags`, optional `/api/show`): fail closed on a missing model or a `remote_host`/`remote_model` (cloud) entry; record `model_digest` and `ollama_version`.
- The prompt/fence code in AI-SPEC §4b (`renderSystem`, `renderUser`, `makeNonce`, `truncateBody`, `BODY_MAX_CHARS=4000`), the output schema (`llmOutputSchema`, `ollamaFormat`, `validateLlmOutput`) and `RETRY_NOTE` (closed-set note, never prior output).
- Process-wide FIFO single-flight created once at worker startup (never at module scope).
- Evals E1–E11 are the Phase 3 CI gates (Vitest + `node:http` fake Ollama + synthetic fixtures); E4-live, E11-live and E12 are a manual baseline recorded in the phase verification. No Arize Phoenix, Promptfoo or Langfuse (SEC-02).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLS-01 | Exact rules (sender, domain, phrase), versioned, deterministic, no LLM call | Rules schema and matcher (Patterns 1–2); `rule_set` versioning (Pattern 4); E9 table tests |
| CLS-02 | No rule matched → local LLM with trusted/untrusted prompt separation | AI-SPEC §4b prompt code; UntrustedEmail sourcing from stored columns (Pattern 6) |
| CLS-03 | JSON-schema constrained output, retry once, then review | AI-SPEC `runLlmTier`; review reason codes (Pattern 5) |
| CLS-04 | Below threshold → review | `tiers.llm.confidence_threshold` config (Pattern 8); threshold recorded in the span |
| CLS-05 | Closed output, no other actions | Single write path `recordDecision` plus DB checks (Pattern 5); E1/E2 |
| CLS-06 | Once per message unless re-run; per-message failure isolation | Partial unique index on automatic decisions; keyset scan; per-message try/catch (Patterns 3, 7) |
| TRC-01 | One decision row, one span per tier, final action span, mailbox-scoped | Migration plan (Pattern 5); spans Zod schema |
| TRC-02 | Exact-rules span: rules checked, matches, nearest miss | Matcher output shape (Pattern 2) |
| TRC-03 | LLM span: model, prompt version, rules included, examples (empty), raw output, validation, confidence | AI-SPEC LLM span list; spans schema |
| TRC-04 | Rule-set, prompt and model versions stored as rows | `rule_set` + `prompt_version` tables, `ensurePromptVersion` (Pattern 4) |
| TRC-06 | Classifier span always present, `skipped`/"not trained" | Spans schema fixed tuple order (Pattern 5) |
| SEC-01 | Email only in the fenced section; never interpreted as instructions | AI-SPEC fence; exact rules use no regex on mail; nothing from the email reaches `last_error` or logs |
</phase_requirements>

## Project Constraints (from CLAUDE.md and OpenWolf)

- **OpenWolf protocol** (`CLAUDE.md` → `.wolf/OPENWOLF.md`): check `.wolf/anatomy.md` before reading files, `.wolf/cerebrum.md` before generating code; after edits update `anatomy.md` and append to `.wolf/memory.md`; log every bug, failed test or failed build to `.wolf/buglog.json`; record corrections in `cerebrum.md`.
- **Commit rules** (cerebrum): lefthook runs `biome check` and commitlint (config-conventional, header and body lines ≤ 100 chars); never `--no-verify`; subject must not start with an upper-case token (`fix(03): make … (CR-01)`); always commit with an explicit pathspec (`git commit -- <files>`) because the owner pre-stages `.wolf`/`.claude` files.
- **Tooling dirs are code**: `.claude/`, `.wolf/`, `.gsd/`, `.planning/` are committed like source.
- **Owner-facing commands** in docs and UAT must be single-line (no heredocs) and come with exact expected output.
- **Dependencies**: exact pins, licence allowlist, no install scripts (`apps/worker/test/dependencies.test.ts`). Phase 3 adds none.
- **Architecture rules** (cerebrum, verified): apps reach the DB only through `@sift/db` (Biome `noRestrictedImports` bans `pg`/`drizzle-orm` in `apps/**/src/**`); `@sift/worker` has no `pg` dependency, so worker tests must not import `pg`; a new export from `@sift/db` means updating the export-surface list in `packages/db/test/scope.test.ts`; every new mail-derived table needs `mailbox_id` NOT NULL, a composite FK, ENABLE+FORCE RLS, the one standard policy, UNIQUE (mailbox_id, id), explicit grants and a `set_updated_at` trigger, or a `CATALOG_ALLOWLIST` entry.
- **Do-Not-Repeat** items that bear on this phase: negative greps in acceptance criteria also scan comments, so never write a forbidden literal in a comment of the checked file; `cp`/`rm` are aliased interactive in agent zsh (`command cp -f`); a describe that seeds the same slug twice in one file clashes; Postgres CHECK constraints pass on NULL, so add `col is not null` explicitly.
- **Global user rule**: commit messages must respect the project's commitlint limits.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| rules.yaml parse/validate/normalise/hash | `@sift/core` (pure) | worker (file read), `sift config check` | Same pattern as config: pure Zod plus YAML-path errors, reused by worker and CLI |
| Exact-rule matching + nearest miss | `@sift/core/classify` (pure) | — | Deterministic, no I/O, table-tested (E9) |
| Prompt render, output schema, spans schema | `@sift/core/classify` (pure) | — | AI-SPEC structure; shared by worker, db write path and tests |
| Ollama HTTP client, preflight, single-flight, LLM tier | worker (`apps/worker/src/classify/`) | — | I/O; the fetch seam is injectable for the fake (D-33) |
| Pending query, decision write, rule_set/prompt_version ensure, body expiry | `@sift/db` (scoped API / use-cases) | — | Apps cannot run SQL (ISO-04); joins need the scope's transaction |
| Classification pass (chunks, cap, keyset, isolation) | worker runtime (`mailbox-batch.ts` → `classify/run.ts`) | `@sift/db` lock | Runs inside the per-mailbox no-overlap task (D-14) |
| Re-run CLI + body refetch | worker command (`commands/classify.ts`) | IMAP adapter (`folder-source.ts`) | Same shape as `sift mailbox backfill` |
| Owner-visible failures | `mailbox_status` via `@sift/db` status use-cases | supervisor backoff | P1 D-51 surface; fixed-template messages only |

## Standard Stack

### Core (all already installed; versions read from package.json this session)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.6.5 | rules.yaml schema, LLM output schema + `z.toJSONSchema`, spans schema | Already the config validator; AI-SPEC §4b verified `toJSONSchema` output [VERIFIED: packages/core/package.json] |
| yaml | 2.9.1 | rules.yaml parsing with positions (`parseDocument` + `LineCounter`) | Same loader as config.yaml [VERIFIED: packages/core/package.json] |
| drizzle-orm | 0.45.3 | new columns, partial unique index, `doublePrecision` | `uniqueIndex(name).on(...).where(sql)` exists [VERIFIED: node_modules/.pnpm/drizzle-orm@0.45.3_pg@8.23.0/.../pg-core/indexes.d.ts:67,78]; `double-precision` column type present [VERIFIED: same package, columns/] |
| drizzle-kit | 0.31.11 | `pnpm db:generate` (+ `--custom` for grants/RLS/preflight) | P1/P2 migration pattern [VERIFIED: package.json] |
| Node built-ins | 26.10.0 | `fetch`, `AbortSignal.timeout/any`, `node:crypto` (sha256, `randomBytes`), `node:util parseArgs`, `node:http` (fake Ollama) | No dependency added (AI-SPEC §2) [VERIFIED: `node --version`] |
| postal-mime | 4.0.0 | `addressParser` for the From display name (prompt field only) | Already approved worker dependency; `export { addressParser, decodeWords }` [VERIFIED: node_modules/.pnpm/postal-mime@4.0.0/.../dist/esm/postal-mime.d.ts:4] |
| vitest | 5.0.2 | unit, DB and fake-Ollama tests | Repo runner [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct fetch client | `ollama` (ollama-js) 0.6.4 | Rejected by AI-SPEC §2 (0.x API, wrapped errors blur D-16/D-24) |
| Code-side `prompt_version` versioning | Postgres sequence | A sequence needs USAGE grants for sift_app and new catalog rules; a transaction-scoped advisory lock plus `max+1` needs none |
| `postal-mime addressParser` | Raw decoded `From` header as the `from_name` field | Simpler, but it repeats the address and gives the model a longer untrusted field. Either is acceptable because the field is fenced |

**Installation:** none. Do not run `pnpm add`.

## Package Legitimacy Audit

No external packages are installed in this phase. The only packages used are already pinned and approved in the repo (zod 4.6.5, yaml 2.9.1, drizzle-orm 0.45.3, pg 8.23.0, postal-mime 4.0.0, vitest 5.0.2). `apps/worker/test/dependencies.test.ts` must stay unchanged (E7).

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none new) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 supervisor tick ──► runBatch(mailbox, shutdownSignal)
                         │
                         ├─► [ingest lock] ingest (P2, unchanged) ──► recordSyncSuccess
                         │
                         ▼
               load rules.yaml (SIFT_DATA/mailboxes/<slug>/rules.yaml)
                 │ invalid/missing ──► mailbox_status error (file + YAML paths, capped) ─► stop (no classification)
                 ▼ valid
               ensureRuleSet(hash) ─► rule_set row (per-mailbox version)
                         │
               ┌─────────▼──────────────────────────────────────────────┐
               │ classification pass (chunked, keyset newest-first)     │
               │  for each pending message (eligible ∧ live ∧ no dec.):  │
               │   exact rules (pure) ── match ─► decision(labelled)    │
               │        │ no match                                       │
               │        ▼ (LLM budget left ∧ LLM healthy this tick?)     │
               │   preflight once/tick ─► /api/version,/api/tags[,/show] │
               │        │ fail ─► stop LLM work for tick (infra)          │
               │        ▼                                                 │
               │   single-flight ─► POST /api/chat (≤2 attempts)          │
               │        ├ ok + valid ≥ threshold ─► decision(labelled)   │
               │        ├ ok + valid < threshold ─► decision(review/low_confidence)
               │        ├ invalid×2 / input_too_long ─► decision(review/<code>)
               │        ├ infra ─► no decision; stop LLM for tick; remember error
               │        └ aborted ─► stop pass, write nothing             │
               │   each decision: one short tx = insert decision          │
               │     + set body expires_at (first decision) (D-32)        │
               │   per-message throw ─► log codes/ids, skip, continue     │
               └──────────────────────────────────────────────────────────┘
                         │
                         ▼
     infra seen? ─► throw ClassifyInfraError ─► onBatchError ─► mailbox_status "Ollama unreachable at <origin> (<code>)" + D-51 backoff
```

### Recommended Project Structure
```
packages/core/src/
├── rules/                 # rules.yaml: schema.ts, load.ts (parseRulesText/loadRules), hash.ts
├── yaml/ (optional)       # shared parse-with-positions helper extracted from config/load.ts
└── classify/              # index.ts (export "./classify"), exact-rules.ts, llm-output.ts,
                           # prompt.ts, spans.ts, prompt-version.ts (hash material), review.ts
packages/db/src/
├── schema/scoped.ts       # decision + rule_set columns; partial unique index; indexes
├── schema/prompt-version.ts  # unscoped table
├── classify.ts            # recordDecision, ensureRuleSet, setBodyExpiry (scope-based use-cases)
├── prompt-version.ts      # ensurePromptVersion(db, …) (unscoped, like registry-read.ts)
└── scope.ts               # + pendingClassification(...) helper (needs tx)
packages/db/migrations/    # 0008 preflight (custom), 0009 generated, 0010 grants/RLS/triggers (custom)
apps/worker/src/classify/  # ollama-client.ts, preflight.ts, single-flight.ts, llm-tier.ts, run.ts, refetch.ts
apps/worker/src/commands/classify.ts
apps/worker/test/support/fake-ollama.ts
apps/worker/test/fixtures/mail/hostile-*.eml, pair-*.eml
data/mailboxes/example/rules.example.yaml   # committed via a single-file gitignore negation
```

### Pattern 1: rules.yaml schema (owner-facing, README vocabulary)
**What:** A strict Zod schema parsed with the config loader's position-mapping machinery. Use one shape per key and avoid `z.union`, because union errors arrive as nested `invalid_union` issues with poor YAML paths. Run cross-field checks with `superRefine(fn, { when: () => true })` so every problem is reported in one pass (cerebrum: refinements are skipped after child `invalid_type` otherwise).
**Recommended shape** (key names are Claude's discretion; this follows README `rules.lock.yaml` vocabulary):
```yaml
version: 1
categories:
  - name: Important
    description: things I need to act on or reply to personally
  - name: Receipts
    description: orders, invoices, shipping updates
judgment:
  - Never mark anything from my bank as Noise.
rules:
  - kind: exact
    name: bank alerts            # optional; shown in traces, else "rules[0]"
    match:
      domain: [bank.example.test]
    label: Important
  - kind: exact
    match:
      from: [receipts@shop.example.test]
      phrase: [order confirmation]
      in: subject                # where `phrase` looks: subject | body | any (default any); only with phrase
    label: Receipts
```
**Validation rules to encode:** `version: 1` (lets M3 migrate the format); `kind` is `exact` only; `label` must be in `categories` (D-13, reported at `rules[i].label`); `in` without `phrase` is an error; `match` needs at least one of from/domain/phrase; non-empty lists; `from` entries must hold exactly one `@` and no whitespace; `domain` entries must hold no `@`, no leading `.`, no whitespace, and are compared lowercase with any trailing `.` removed. Category names follow D-06. Caps recommended by AI-SPEC §4: description ≤ 200 chars, no newline; total judgment text ≤ 4,000 chars; each judgment line one line. Also recommended: a file-size cap (e.g. 256 KiB) before parsing, `maxAliasCount` 50 (as config, T-01-14), and a rule-count cap (e.g. 500). Everything is rejected, never fixed (P1 D-63).
**Parse path:** reuse `parseDocument(text, { lineCounter, prettyErrors: false })`, `doc.toJS({ maxAliasCount })`, and `locate`/`locateKey`/`zodIssues`/`byPosition` from `packages/core/src/config/load.ts` [VERIFIED: read this session]. Extract them into a shared helper rather than copying. Skip the config loader's literal-secret pre-pass for rules.yaml; its keys are fixed and none look like secrets.

### Pattern 2: Exact-rule matcher (pure, deterministic)
```ts
// packages/core/src/classify/exact-rules.ts  (sketch; names are the planner's)
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function domainMatches(fromDomain: string, rule: string): boolean {
  const d = fromDomain.toLowerCase().replace(/\.$/, '');
  return d === rule || d.endsWith(`.${rule}`);         // label boundary: notbank.x never matches bank.x
}
// condition results: { field: 'from'|'domain'|'phrase', pass: boolean }
// rule result: { index, name, conditions[], matched = conditions.every(pass) }
// winner = first matched in file order; nearestMiss only if none matched:
//   max(passCount / conditions.length), ties → lowest index (D-12)
```
- From and domain read `message.from_address` / `message.from_domain` only (D-08). Ingest stores `from_address` from the IMAP envelope with only the domain lowercased, so compare the full address case-insensitively [VERIFIED: apps/worker/src/ingest/message.ts:113-125 `splitAddress` "Address with only the domain (after the last `@`) lowercased"]. A null From address fails both conditions; it is never an error.
- Phrase `in: body` reads the cached `message_body.body_text` (up to `BODY_TEXT_MAX_CHARS = 32_768`) [VERIFIED: apps/worker/src/ingest/message.ts:44]. `subject` reads `message.subject`. `any` checks both.
- Never build a `RegExp` from rule or mail text (D-09). Two runs over the same input must give byte-identical span output (E9), so keep the order of keys and conditions fixed.

### Pattern 3: Pending query, uniqueness and the keyset scan
**Pending query** (new helper in `scope.ts`; the generic API cannot express it):
```sql
select m.id, m.internal_date, m.from_address, m.from_domain, m.subject, m.headers, m.attachments,
       b.body_text, b.expires_at
  from message m
  join message_body b on b.mailbox_id = m.mailbox_id and b.message_id = m.id
 where m.mailbox_id = $scope and m.eligible_for_classification
   and exists (select 1 from message_location l
                where l.mailbox_id = m.mailbox_id and l.message_id = m.id and l.removed_at is null)
   and not exists (select 1 from decision d
                    where d.mailbox_id = m.mailbox_id and d.message_id = m.id)
   and (m.internal_date, m.id) < ($cursorDate, $cursorId)      -- keyset: omit on the first page
 order by m.internal_date desc, m.id desc
 limit $chunk
```
- **Uniqueness mechanism (D-15, discretion):** add a `decision.trigger` column (text with a check, values for example `'worker'` and `'rerun'`) and a partial unique index `UNIQUE (mailbox_id, message_id) WHERE trigger = 'worker'`. The database then refuses a second automatic decision even if a bug slips past the lock, while re-runs append freely. Drizzle supports it: `uniqueIndex('decision_one_auto_per_message').on(t.mailboxId, t.messageId).where(sql\`trigger = 'worker'\`)`. A partial index is already used in this schema (`message_location_live_idx ... where removed_at is null`) [VERIFIED: packages/db/src/schema/scoped.ts:171].
- **Indexes:** the composite FK `decision_message_fk` creates no index. Add `decision (mailbox_id, message_id)` for the `NOT EXISTS` probe and for "latest decision". Add a partial index `message (mailbox_id, internal_date desc, id desc) WHERE eligible_for_classification`: the owner's live DB holds 103,657 message rows, of which 281 are eligible [VERIFIED: superuser row counts on sift-db-1 this session].
- **Keyset, not re-query from the top:** an LLM-bound message left pending after an infra failure or after the 25-call cap would come back first on every re-query and loop forever. Page with the `(internal_date, id)` cursor within the tick.
- **Bound the scan as well as the LLM calls:** after the LLM budget is spent (cap or infra), D-16 still wants exact-rule decisions written. Continue exact-rules-only over the keyset, but cap the number of messages examined per tick (code constant, for example 500) so a large backlog does not read every cached body on every tick.
- **"Latest decision is current":** order by `created_at desc, id desc`. `uuidv7()` is monotonic within a session (probe: 5,000 consecutive values strictly increasing [VERIFIED: psql on sift-db-1]), and re-runs are serialised by the ingest lock.

### Pattern 4: Versioned rows (rule_set, prompt_version)
- **rule_set** (scoped; columns added): `version int NOT NULL`, `hash text NOT NULL` (sha256 hex), `format_version int NOT NULL`, `snapshot jsonb NOT NULL`; `UNIQUE (mailbox_id, hash)`, `UNIQUE (mailbox_id, version)`. Compute the hash in code over canonical JSON of the validated, normalised object (fixed key order). Never hash `jsonb` text: Postgres `jsonb` reorders keys. Writers of one mailbox are serialised by the ingest lock, so `max(version)+1` read through `scope.ruleSet.find()` is race-free.
- **prompt_version** (unscoped, global): `id uuid pk default uuidv7()`, `version int UNIQUE NOT NULL`, `hash text UNIQUE NOT NULL`, `template text NOT NULL`, `schema_shape jsonb NOT NULL`, `created_at` only. With no `updated_at` column the catalog's trigger requirement does not apply (catalog.ts only checks a trigger when `has_updated_at`) [VERIFIED: packages/db/test/support/catalog.ts:214-218]. Mailbox batches run concurrently in the worker, so two can insert the first version at the same moment. In `ensurePromptVersion(db, …)`, take `pg_advisory_xact_lock(<new fixed key>)`, then select by hash, then insert `max(version)+1`. Implement it beside `readRegistry` using `internalsOf(db).orm` [VERIFIED: packages/db/src/registry-read.ts].
- **Hash material must be category-independent:** the table is global, but `format` contains the mailbox's enum. Hash the schema shape built with a placeholder category list (for example `llmOutputSchema(['<category>'])`), plus the rendered template for a fixed placeholder input, `RETRY_NOTE`, `MODEL_OPTIONS`, `think:false`/`truncate:false`, and the limits (`BODY_MAX_CHARS`, header caps). Store the placeholder render as `template` so a human can read it.
- **Catalog changes** (`packages/db/test/support/catalog.ts`): add `'public.prompt_version': '<reason: prompt templates are code-derived, not mail-derived (D-29)>'` to `CATALOG_ALLOWLIST`, and extend `expectedAppDml` so `public.prompt_version` expects exactly `SELECT, INSERT` (today, unscoped non-registry relations return `null` = "not prescribed") [VERIFIED: catalog.ts:309-323]. The allowlist currently holds exactly:
  > `'public.mailbox': 'unscoped mailbox registry: configuration, not mail-derived (D-06)',`
  > `'drizzle.__drizzle_migrations': 'migration bookkeeping owned by sift_owner (D-37)',`
  [VERIFIED: catalog.ts:9-12]

### Pattern 5: decision columns, checks and the single write path
Current table: `id`, `mailbox_id`, `message_id`, `created_at`, `updated_at`, `unique('decision_mailbox_id_id_key')`, composite FK `decision_message_fk` [VERIFIED: packages/db/src/schema/scoped.ts:235-253]. Grants today: `GRANT SELECT, INSERT ON "decision", "label_event" TO sift_app;` and `GRANT SELECT, INSERT, UPDATE, DELETE ON "mailbox_status", "label", "folder_sync", "rule_set" TO sift_app;` [VERIFIED: packages/db/migrations/0004_scoped_tables_force_grants.sql]. `APPEND_ONLY_TABLE_NAMES = ['decision', 'label_event'] as const;` [VERIFIED: packages/db/src/schema/index.ts].

Recommended new columns (D-27), each with text + CHECK rather than a pg enum (the existing convention: "state is text + check, not a Postgres enum type, because enum changes fight the single-transaction migrator" [VERIFIED: scoped.ts:91-95]):
| Column | Type | Constraint |
|---|---|---|
| outcome | text NOT NULL | in ('labelled','review') |
| category | text | `(outcome = 'labelled') = (category is not null)` |
| confidence | double precision | null for exact rules; `confidence is null or (confidence >= 0 and confidence <= 1)` |
| tier | text NOT NULL | in ('exact_rules','llm') (M2 adds 'classifier') |
| review_reason | text | `(outcome = 'review') = (review_reason is not null)` and `review_reason is null or review_reason in ('low_confidence','invalid_output','out_of_category','input_too_long')` |
| rule_set_id | uuid NOT NULL | FK (mailbox_id, rule_set_id) → rule_set (mailbox_id, id) |
| prompt_version_id | uuid | FK → prompt_version(id); `(tier = 'llm') = (prompt_version_id is not null)` |
| model | text | `(tier = 'llm') = (model is not null)` |
| trigger | text NOT NULL | in ('worker','rerun') (uniqueness, Pattern 3) |
| trace_format_version | int NOT NULL | |
| spans | jsonb NOT NULL | validated in code by the shared Zod schema |

- Use `double precision`, not `real`: float4 stores 0.7499 as 0.74989998, which blurs the E10 boundary.
- Exact-rule decisions also need `review_reason` null and `outcome = 'labelled'`, because rules cannot send to review (D-13).
- **Single write path:** a `recordDecision(scope, input)` use-case in `@sift/db` parses `spans` with the shared schema from `@sift/core/classify` (`@sift/db` already depends on `@sift/core`), inserts the row, and sets `message_body.expires_at = now + 7 days` only where `expires_at is null` (D-32, first decision only). Do all of it in one short `session.run`. **Never hold a transaction open across an LLM call**: run the call outside `session.run`, then write.
- **Spans schema** (`@sift/core/classify/spans.ts`): a fixed-order tuple `[exact_rules, classifier, llm?, action]` with `TRACE_FORMAT_VERSION = 1`. The classifier span is `{kind:'classifier', status:'skipped', reason:'not trained'}`; the action span is `{kind:'action', status:'pending', intent: {label: <Category>} | {review: <reason>}}`. Also record the applied `confidence_threshold` in the llm (or action) span, as E8 recommends, so a `low_confidence` review stays explainable after the owner changes the config.

### Pattern 6: Untrusted email fields from stored data
`UntrustedEmail` (AI-SPEC §4b) is built from stored rows, without IMAP: `fromAddress` ← `message.from_address`, `subject` ← `message.subject`, `attachmentNames` ← `message.attachments[].name` (non-null), `body` ← `message_body.body_text`. The display name is not a column. Derive it in the worker from `message.headers.from[0]` (RFC 2047-decoded at ingest) with postal-mime's `addressParser`, or pass the raw decoded header. The field sits inside the fence either way. Ingest's `HEADER_FIELDS` includes `from`, `sender`, `reply-to` [VERIFIED: apps/worker/src/ingest/message.ts:23-41]; only From goes into the prompt (D-21).

### Pattern 7: Wiring into runBatch and failure isolation
- `createMailboxCallbacks` takes `MailboxIngestOptions` [VERIFIED: apps/worker/src/runtime/mailbox-batch.ts:137-154]. Add an injectable `classify` dependency: the data dir, an `LlmClient`, the single-flight gate and `now`. Existing tests can then pass a fake or an "off" classifier. The shared harness sets `url: 'http://localhost:11434'` [VERIFIED: apps/worker/test/support/mailbox-harness.ts:56], and a real Ollama runs on this machine, so without injection the e2e tests would call a real model.
- Run classification only after outcome `synced`/`resynced`; skip it on `aborted`. Check `signal.aborted` between messages and chunks. `SHUTDOWN_TIMEOUT_MS = 20_000` [VERIFIED: supervisor.ts], so an in-flight LLM call must abort on the shutdown signal (AI-SPEC `AbortSignal.any`).
- When ingest returns early for `needs_attention` (held new mail), classification of already-ingested pending mail can still run; this is the planner's call, see Open Questions.
- **Lock granularity:** the worker holds the ingest lock for the whole `runBatch`. On CPU, 25 LLM calls can take 6–20 min (AI-SPEC §4b), while `sift mailbox backfill` gives up after `BACKFILL_LOCK_WAIT_MS = 60_000` [VERIFIED: apps/worker/src/commands/mailbox-backfill.ts]. Recommendation: ingest under one `withIngestLock`, then classify with one lock acquisition **per chunk** (re-reading pending under each lock). The CLI then waits at most one chunk, and the partial unique index guards against duplicates.
- **Infra errors:** a new error class (for example `ClassifyInfraError` with codes from the AI-SPEC `InfraCode`) handled in `onBatchError` with a fixed owner template such as `Ollama unreachable at ${new URL(url).origin} (${code})`. `origin` drops any userinfo. `model_missing` → `… run: ollama pull <model>`. Never store Ollama's error text in `last_error`: it can quote the prompt (AI-SPEC). `last_error` is capped at `LAST_ERROR_MAX = 1000` [VERIFIED: packages/db/src/status.ts]. Do not route Ollama errors through the existing `MailboxSyncError` 'unreachable'/'timeout' kinds: `onBatchError` turns those into `connecting` during the IMAP startup grace [VERIFIED: mailbox-batch.ts:412-421].
- **Rules errors (D-05):** record a `mailbox_status` error naming the file and the problems, capped to fit 1,000 chars (for example the first 5, then "and N more; run sift config check"). Recommendation: do not reject `runBatch` for a rules error, so ingest keeps its normal cadence without backoff. Write the final status once at the end of the batch so the state does not flip `ok`→`error` within a tick.
- Per message: wrap each message in try/catch, log only ids and codes (`codedCause`), and continue (CLS-06, E6).

### Pattern 8: Config `tiers.llm.confidence_threshold` (D-25) and D-20
- Add `tiers: z.strictObject({ llm: z.strictObject({ confidence_threshold: z.number().min(0).max(1).default(0.75) }).default(...) }).default(...)` to `Config` at top level, following the `Worker.default(...)` pattern [VERIFIED: packages/core/src/config/schema.ts:278-296]. Out-of-range values are rejected with their YAML path (E10).
- `DEFAULT_INITIAL_BACKFILL_DAYS` is currently `export const DEFAULT_INITIAL_BACKFILL_DAYS = 30;` [VERIFIED: schema.ts:27]. Files that assert the default 30 and must change: `packages/core/test/example-config.test.ts:27`, `packages/core/test/config.test.ts:171,184,202` (the `{ initial_backfill_days: 30, new_mail_cap: 50 }` default-filled entry), `config/config.example.yaml:38,65`, `README.md:237,406,490` [VERIFIED: grep this session]. Tests that pass an explicit `initialBackfillDays: 30` (ingest-engine, ingest-resync, ingest-e2e, registry fixtures) need no change.
- The README "Technical settings" test asserts `tiers` stays commented: `expect(active).not.toMatch(/^(tiers|quick_confirm|relabel_sync):/m);` and `expect(technicalSettingsYaml()).toMatch(/^# tiers:/m);` [VERIFIED: apps/worker/test/user-facing-text.test.ts:164-165]. D-25 must update this test: an active `tiers: llm: confidence_threshold: 0.75`, with `classifier` and `examples_per_prompt` still commented, and the strict schema check still passing.

### Anti-Patterns to Avoid
- **`Promise.all` / `forEach(async)` over messages:** floods Ollama and escapes per-message isolation (AI-SPEC §4b). Use `for … of` with `await`.
- **Re-querying pending from the top each chunk:** infinite loop on stuck LLM-bound messages. Page with a keyset.
- **Holding `session.run` (an open transaction) during the LLM call:** an "idle in transaction" connection for up to 120 s × 2.
- **Repairing model output** (case-folding, trimming, nearest category): forbidden by E1.
- **Putting Ollama/HTTP error text or raw output into pino or `last_error`:** both can echo email text (SEC-01/E7).
- **Hashing `jsonb::text`** for rule_set: key order is not preserved.
- **`z.union` in owner-facing schemas:** poor error paths.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML → positioned, every-problem errors | a new error mapper | the `config/load.ts` machinery (`locate`, `locateKey`, `zodIssues`, `byPosition`, `formatIssue`) | Same owner-facing format as config (D-01, P1 D-57) |
| Per-mailbox mutual exclusion (worker vs `sift classify`) | a new lock | `withIngestLock(db, id, fn)` (D-03 seed `INGEST_LOCK_SEED = 815309`) | Already handles dead connections and non-re-entrancy [VERIFIED: packages/db/src/lock.ts] |
| Status writes, backoff | custom retry | `recordSyncError` / supervisor `computeBackoff` (`BACKOFF_CAP_MS = 900_000`) | D-51 behaviour already tested [VERIFIED: runtime/backoff.ts] |
| Safe error text | `String(err)` | `codedCause` from `@sift/core/log` + `redactText` | Drizzle wrappers carry query params (WR-01) |
| Address parsing | a regex | postal-mime `addressParser` (approved dependency) | RFC 5322 edge cases |
| JSON-schema for `format` | a hand-written schema | `z.toJSONSchema(schema, { target: 'draft-7' })` minus `$schema` (AI-SPEC) | Verified output; one source for grammar and re-validation |
| CLI parsing and confirmation prompt | ad-hoc argv / readline | `node:util parseArgs` (strict) + the `mailbox-backfill.ts` confirm pattern (stdin line, `--yes`, `MAX_LINE_CHARS`) | P1 D-24 / P2 D-75 consistency |
| IMAP body refetch | new IMAP code | `openImap` + `createFolderSource` → `examine`, `fetchHeaders([uid])`, `parseMessage` (verify the identity key), `selectTextPart`, `downloadText`, `toBodyText` | All exported and pinned (read-only, BODY.PEEK) [VERIFIED: exports listed this session] |

**Key insight:** almost every piece the phase needs exists. The risk is in the seams (lock scope, transaction scope, harness defaults, gitignore, test-support inserts), not in the algorithms.

## Runtime State Inventory

Not a rename phase. One migration changes existing tables, so this is recorded for safety:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Live DB: `decision` 0 rows, `rule_set` 0 rows; 281 eligible messages, 276 live+eligible, all with a body row (initial pending ≈ 276) [VERIFIED: superuser counts on sift-db-1] | NOT NULL columns can be added. Still add a preflight custom migration (pattern of `0005_ingest_preflight.sql`, T-02-63) that refuses when decision/rule_set hold rows, with a per-mailbox `set_config` loop because FORCE RLS binds the owner |
| Live service config | Ollama on the host: 0.18.2, models pulled do **not** include `qwen3:1.7b` (the configured `models.llm`) [VERIFIED: /api/tags] | Owner runs `ollama pull qwen3:1.7b` before the live baseline; preflight must report `model_missing` clearly |
| OS-registered state | None: verified compose services only (db, setup, worker, bridge, bridge-init) | None |
| Secrets/env vars | No new secret. `SIFT_MODELS_URL` override already exists [VERIFIED: config/env.ts]. A new `SIFT_DATA` path variable (recommended) is not a secret | Add to compose worker and setup env |
| Build artifacts | `.dockerignore` excludes `data` (good: rules are mounted, never baked) [VERIFIED] | Compose mount needed (see Pitfall 3) |

## Common Pitfalls

### Pitfall 1: Real Ollama reached from existing tests
**What goes wrong:** once classification runs inside `runBatch`, `ingest-e2e`, `mailbox-batch` and `mailbox-ops` tests built on `mailbox-harness.ts` call `http://localhost:11434`, where this machine runs a real Ollama.
**How to avoid:** make classification an injected dependency of `createMailboxCallbacks`, and change the harness default `models.url` to the fake or to an unroutable `http://ollama.invalid`. Existing tests that assert `ok` status after ingest also need a valid rules.yaml fixture or classification disabled; otherwise D-05 fail-closed turns them into `error`.
**Warning signs:** test durations jump; `mailbox_status` reads error in ingest tests.

### Pitfall 2: The AI-SPEC hermeticity guard as written fails today
**What goes wrong:** "fail if any `*.test.ts` names port 11434" matches `packages/core/test/example-config.test.ts:16`, `env.test.ts:97-107`, `config.test.ts:37`, `packages/db/test/registry-plan.test.ts:35`, `registry.test.ts:44` [VERIFIED: grep]. All of these use 11434 as a config value, not as a connection target.
**How to avoid:** guard the real risk instead. Assert that every request in the classify tests goes to the fake's ephemeral port (record the origins in the fake and in an injected `fetch`), and/or scan only `apps/worker/test/**classify**` plus the harness for `11434`.

### Pitfall 3: `data/` is wholly gitignored and not mounted
**What goes wrong:** `.gitignore` line 158 is `data/` [VERIFIED: `git check-ignore -v` → `.gitignore:158:data/`]. Git cannot re-include a file under an excluded directory, so `data/mailboxes/example/rules.example.yaml` cannot be committed. Compose mounts only `/config` into worker and setup [VERIFIED: compose.yaml], so the worker cannot see rules.yaml.
**How to avoid:** replace `data/` with `/data/*`, `!/data/mailboxes/`, `/data/mailboxes/*`, `!/data/mailboxes/example/`, `/data/mailboxes/example/*`, `!/data/mailboxes/example/rules.example.yaml`. This negates the single file only, so a real mailbox slugged `example` (not in `RESERVED_SLUGS = ['all', 'new', 'settings', 'shared']` [VERIFIED: config/slug.ts]) still has its `rules.yaml` and `eval/` ignored. Verify with `git ls-files --error-unmatch` and `git status --ignored`, not `check-ignore -q` (cerebrum: `check-ignore -q` exits 0 on negated matches). Mount `${SIFT_DATA_HOST_DIR:-./data}:/data:ro` in worker **and** setup (D-07's rename check runs in setup), and set `SIFT_DATA: /data`, mirroring `SIFT_CONFIG`. A missing host `./data` is created by Docker as root on Linux; the README should say `mkdir -p data/mailboxes/<slug>` first.

### Pitfall 4: Adding NOT NULL columns breaks existing test support
**What goes wrong:** `seedScopedRows` runs `insert into decision (mailbox_id, message_id)` and `insert into rule_set (mailbox_id)`; `isolation.test.ts` `insertStatement` inserts the same key-only rows; `scope.test.ts:201,210` calls `s.decision.insert([{ messageId }])` and `s.ruleSet.insert([{}])`; `ingest.test.ts:589` calls `s.decision.insert([{ messageId }])` [VERIFIED: grep + reads].
**How to avoid:** the migration plan updates these in the same plan, with a valid rule_set row first (decision FKs it) and a minimal valid spans value. `owner-rls.test.ts`/`isolation.test.ts` `CHILD_FIRST` already deletes `decision` before `rule_set`. Add `rule_set` to the child-first order before `message` only if it gains a message FK (it does not). The migration count derives from the journal; no edit needed [VERIFIED cerebrum + migrate.test.ts:32-35].

### Pitfall 5: Infra vs message failure, and backoff that resets
**What goes wrong:** (a) treating a context-length 400 as infra blocks the mailbox's LLM tier forever (AI-SPEC Pitfall 3); (b) `recordSyncSuccess` after ingest clears the Ollama error each tick before classification sets it again. The status then flaps, and `sift mailbox list` read mid-tick shows `ok`.
**How to avoid:** follow the AI-SPEC error table exactly. Compute the final batch status once at the end of the batch, or accept the flap and document it. A rejected `runBatch` keeps the D-51 backoff growing while Ollama stays down; D-16 locks that behaviour, and it slows ingest too.

### Pitfall 6: Owner-facing error length
**What goes wrong:** D-05 asks for "every problem with its YAML path" in `mailbox_status`, but `last_error` is truncated at 1,000 chars, so a long list is cut mid-path.
**How to avoid:** cap the list in the status message and point to `sift config check`, which prints them all.

### Pitfall 7: `sift config check` vs `sift setup`
**What goes wrong:** if rules validation is added to the load path setup uses, one bad rules.yaml stops setup. The worker `depends_on: setup: condition: service_completed_successfully` [VERIFIED: compose.yaml], so the whole stack would stay down, contradicting D-05's per-mailbox fail-closed.
**How to avoid:** validate rules only in `config check` (non-schema-only mode, or always; planner's call) and in the worker. `setup.ts` uses `loadConfig` directly [VERIFIED: setup.ts imports]; leave it unchanged.

### Pitfall 8: Concurrent first-use of prompt_version
**What goes wrong:** two mailbox batches insert version 1 at once → a unique violation, or two rows.
**How to avoid:** a transaction-scoped advisory lock with a new fixed key (distinct from `MIGRATE_LOCK_KEY` and `CONFIG_APPLY_LOCK_KEY 815309002` [cerebrum]), or `ON CONFLICT (hash) DO NOTHING` followed by a re-select, with a retry on a version conflict.

### Pitfall 9: Category name character set
**What goes wrong:** "letters" in D-06 could mean ASCII or Unicode. Non-ASCII label folder names go through IMAP modified UTF-7, and the Bridge spike did not test them.
**How to avoid:** because D-06 is one-way, start with the strict ASCII set (`[A-Za-z0-9 &-]`, no leading or trailing space, no double space) and loosen it after a Phase 4 check. Get owner confirmation (Assumptions A1).

## Code Examples

### Pending helper inside scope.ts (shape)
```ts
// packages/db/src/scope.ts — beside messageBodyApi; ctx.tx is only reachable here
// Source: existing pattern messageBodyApi.deleteExpired (scope.ts:366-379)
async pendingClassification(opts: { limit: number; before?: { internalDate: Date; id: string } }) {
  ctx.assertOpen();
  // drizzle select … innerJoin(messageBody) … where(and(eq(message.mailboxId, mailboxId),
  //   eq(message.eligibleForClassification, true), exists(liveLocation), notExists(anyDecision),
  //   before ? sql`(${message.internalDate}, ${message.id}) < (${before.internalDate}, ${before.id})` : undefined))
  //   .orderBy(desc(message.internalDate), desc(message.id)).limit(opts.limit)
}
```
Adding a key to the frozen Scope changes `Object.keys(s)`; update the list at `packages/db/test/scope.test.ts:160-171` [VERIFIED].

### Command registration
```ts
// apps/worker/src/command.ts — COMMANDS entry (shape verified; flags are the planner's)
{ path: ['classify'], file: 'classify.ts',
  usage: 'sift classify <slug> (--message <id> | --since <date> | --all-pending) [--yes]',
  summary: 'Classify pending or re-run decided messages of a mailbox' },
```
`loadCommand` imports `./commands/<file>` lazily [VERIFIED: command.ts]. `apps/worker/test/user-facing-text.test.ts` pins README commands, so update it when documenting `sift classify`.

### Migration trio (pattern from P1/P2)
```bash
pnpm db:generate --custom --name=classification_preflight   # RAISE if decision/rule_set rows exist (per-mailbox set_config loop)
pnpm db:generate --name=classification_tables              # generated from schema diff
pnpm db:generate --custom --name=classification_grants     # GRANT SELECT, INSERT ON prompt_version TO sift_app; indexes if not generated
```
Custom migrations need `--> statement-breakpoint` between statements (cerebrum). `prompt_version` gets no RLS (allowlisted). `decision` keeps `SELECT, INSERT` only.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `initial_backfill_days` default 30 | default 3 | D-20 (this phase) | Fresh mailboxes backfill 3 days; explicit 30 is kept |
| `tiers` block commented in README | `tiers.llm.confidence_threshold` active | D-25 (this phase) | README test and example config change |
| `decision`/`rule_set` key-only | typed columns + spans + versions | this phase | Test support inserts change |

**Deprecated/outdated:** README's "Raw LLM prompts … may need a retention limit" (ADR-0003 negative consequence) is resolved: traces store the recipe, not the prompt (P2 D-09, ADR-0003 addendum) [VERIFIED: docs/adr/0003].

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Category names should start ASCII-only (`[A-Za-z0-9 &-]`) because Bridge's handling of non-ASCII label folders is untested | Pitfall 9 | Too strict: an owner with non-English category names is blocked until loosened (cheap). Too loose: Phase 4 label creation fails on a one-way name (expensive) |
| A2 | Ingest outcome `needs_attention` should still classify already-ingested pending mail | Pattern 7 | If wrong, held mailboxes stop classifying until resume (low impact) |
| A3 | Rules errors should not reject `runBatch` (no backoff) | Pattern 7 | If wrong, ingest of a mailbox with a bad rules.yaml slows to the 15 min backoff cap |
| A4 | `rule_set` should become append-only (SELECT, INSERT), like `decision` | Open Questions | If left mutable, a bug could edit a snapshot that decisions reference and replay would be wrong |
| A5 | Per-chunk lock acquisition for classification is acceptable under D-17 | Pattern 7 | If the owner wants one lock for the whole batch, `sift classify` may refuse after 60 s while the worker classifies |
| A6 | Exact-rule decisions leave `prompt_version_id` and `model` null | Pattern 5 | If TRC-04 is read as "every decision references a prompt", a nullable FK fails that reading |

## Open Questions

1. **Make `rule_set` append-only?**
   - What we know: P1 granted it full DML; snapshots are meant to be immutable for replay (TRC-04).
   - Recommendation: yes. Revoke UPDATE/DELETE, add it to `APPEND_ONLY_TABLE_NAMES`, make `scope.ruleSet` an `AppendOnlyTableApi`, and update `scope.test.ts`/`isolation.test.ts` (which filters `APPEND_ONLY` for update/delete tests). Confirm with the owner because it changes P1 grants (A4).
2. **Per-message poison 500 from Ollama** (AI-SPEC open item).
   - What we know: a 500 is classed as infra and stops the tick's LLM work; if one message crashes the runner every time, newest-first order puts it at the front of every tick.
   - Recommendation: in Phase 3, record the attempt count in memory per tick only; a durable "poison" marker is optional and needs a new review code (for example `model_error`) after N consecutive 500s on the same message. Leave it out unless the planner has room; the Section 7 monitoring already flags a stuck backlog.
3. **Does `sift classify` on a pending message count as `trigger='worker'` or `'rerun'`?**
   - Recommendation: `'rerun'` (it is explicit). The pending query excludes any decision, so the worker will not decide that message again.
4. **Confidence threshold range:** inclusive [0, 1] (0 labels everything) or (0, 1]? Recommendation: inclusive [0, 1] with a clear message; E10 only needs out-of-range values rejected.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | everything | ✓ (via nvm path) | 26.10.0 (shell default is 26.3.0; prefix PATH per cerebrum) | — |
| pnpm | scripts | ✓ | 12.7.0 | — |
| Docker / Compose | DB tests, stack | ✓ | Engine 20.10.12; containers sift-db-1, sift-worker-1, sift-bridge-1 running | — |
| Postgres (pgvector 0.8.7, PG 18) | DB tests, migrations | ✓ | sift-db-1 | CI service container |
| Dovecot test IMAP | `pnpm test` worker IMAP files; refetch tests | ✗ (not running) | — | `scripts/test-imap.sh up` before the full suite |
| Ollama (host) | live baseline only (never CI) | ✓ | 0.18.2; reachable from the worker container at host.docker.internal:11434 [VERIFIED] | — |
| `qwen3:1.7b` model | live baseline | ✗ (not pulled; qwen3:8b present) | — | `ollama pull qwen3:1.7b` (owner step) |

**Missing dependencies with no fallback:** none for CI.
**Missing dependencies with fallback:** the Dovecot test server (start with the script); `qwen3:1.7b` (pull before the manual baseline).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.2 (root `vitest.config.ts`: include `packages/*/test/**`, `apps/*/test/**`, `test/**`; globalSetup `packages/db/test/global-setup.ts`; testTimeout 30 s) |
| Config file | `vitest.config.ts` (loads `.env.development` if present) |
| Quick run command | `pnpm vitest run <path>` (e.g. `pnpm vitest run packages/core/test/rules.test.ts`) |
| Full suite command | `pnpm lint && pnpm typecheck && pnpm test` (needs Postgres via `SIFT_TEST_ADMIN_URL` and `scripts/test-imap.sh up`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CLS-01 | From/domain/phrase matching, AND/OR, first-wins, nearest miss, determinism (E9) | unit (table) | `pnpm vitest run packages/core/test/exact-rules.test.ts` | ❌ Wave 0 |
| CLS-01 | rules.yaml strict schema, YAML-path errors, example file parses (D-04) | unit | `pnpm vitest run packages/core/test/rules.test.ts` | ❌ Wave 0 |
| CLS-02/SEC-01 | Fence holds; system message email-free and byte-stable (E3) | unit (pure render) | `pnpm vitest run packages/core/test/prompt.test.ts` | ❌ Wave 0 |
| CLS-03/CLS-05 | Response matrix: retry once, review codes, no repair (E1, E2, E11) | integration (fake Ollama) | `pnpm vitest run apps/worker/test/classify-llm-tier.test.ts` | ❌ Wave 0 |
| CLS-04 | Threshold boundary 0.7499/0.75/0/1, config 0.9, out-of-range rejected (E10) | unit + integration | `pnpm vitest run packages/core/test/config.test.ts apps/worker/test/classify-llm-tier.test.ts` | partial (config.test.ts exists) |
| CLS-06 | Ollama down → pending, exact still written, recovery; cap 25 newest-first; single flight; no duplicate auto decision (E5, E6) | integration (DB + fake) | `pnpm vitest run apps/worker/test/classify-run.test.ts` | ❌ Wave 0 |
| CLS-06 | Partial unique index refuses a 2nd worker decision; re-run appends | DB | `pnpm vitest run packages/db/test/classify.test.ts` | ❌ Wave 0 |
| TRC-01..04, TRC-06 | Every written decision parses spans schema, fixed order, FKs resolve, replay re-render byte-equal (E8, `expectReplayableDecision`) | integration | `pnpm vitest run apps/worker/test/classify-trace.test.ts` | ❌ Wave 0 |
| TRC-04 / D-29 | prompt_version catalog allowlist + SELECT/INSERT grants; rule_set versioning by hash | DB | `pnpm vitest run packages/db/test/catalog.test.ts packages/db/test/classify.test.ts` | partial (catalog.test.ts exists) |
| SEC-01/E7 | Sentinels never in pino or `last_error`; requests only to the models.url origin; remote model refused | integration | `pnpm vitest run apps/worker/test/classify-leak.test.ts` | ❌ Wave 0 |
| D-05 | Bad rules.yaml in A → A error with paths; B classified | integration | `pnpm vitest run apps/worker/test/classify-run.test.ts` | ❌ Wave 0 |
| D-17 | `sift classify` flags, confirmation, lock refusal, append | integration | `pnpm vitest run apps/worker/test/classify-cli.test.ts` | ❌ Wave 0 |
| D-20 | default backfill 3 | unit | `pnpm vitest run packages/core/test/config.test.ts packages/core/test/example-config.test.ts` | ✅ (edit) |
| D-25 docs | README active `tiers` validates | unit | `pnpm vitest run apps/worker/test/user-facing-text.test.ts` | ✅ (edit) |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <touched test files>` + `pnpm typecheck`
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm test` (Dovecot up, DB reachable)
- **Phase gate:** full suite green in CI plus the manual live baseline table (AI-SPEC §5: E4-live, E11-live, E12) recorded in VERIFICATION, using synthetic data only

### Wave 0 Gaps
- [ ] `apps/worker/test/support/fake-ollama.ts`: `node:http`, scripted per call, records requests, origins and max in-flight, compromised mode, char budget → context-length 400; serves `/api/version`, `/api/tags`, `/api/show`, `/api/chat`
- [ ] `apps/worker/test/support/classify-harness.ts` (or extend `mailbox-harness.ts`): rules.yaml temp dir, `expectReplayableDecision`, harness `models.url` no longer `localhost:11434`
- [ ] `apps/worker/test/fixtures/mail/hostile-*.eml` (≥ 12) and `pair-*.eml` / `pair-*.injected.eml` (5 pairs), `example.test` addresses only
- [ ] `packages/db/test/support/seed.ts` and `isolation.test.ts` `insertStatement` updated for the new NOT NULL columns
- [ ] `data/mailboxes/example/rules.example.yaml` + `.gitignore` negation + CI parse test

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface (Ollama is unauthenticated on loopback/host) |
| V3 Session Management | no | — |
| V4 Access Control | yes | Forced RLS + scoped API for decision/rule_set; `prompt_version` sift_app SELECT/INSERT only; decision append-only (catalog test) |
| V5 Input Validation | yes | Zod strict schemas for rules.yaml, config `tiers`, LLM output (re-validation after the grammar), spans; no regex over mail |
| V6 Cryptography | yes (non-secret) | `node:crypto` sha256 for content hashes, `randomBytes(12)` nonce; never hand-rolled |
| V7 Error Handling & Logging | yes | Fixed-template `last_error`; logs carry ids/codes only; `codedCause` + `redactText` |
| V8 Data Protection | yes | Body cache expiry at first decision + 7 d (D-32); rendered prompt never stored; raw output only in the RLS-scoped row |
| V12 Files & Resources | yes | rules.yaml path built from a DB-validated slug (`^[a-z0-9]+(-[a-z0-9]+)*$` CHECK [VERIFIED: schema/mailbox.ts]) → no traversal; file size and alias caps; read-only mount |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection via email text (fence escape, CR/LF field forgery, role lines, `/think`) | Tampering / EoP | Nonce fence, one-line capped headers, control-char strip, closed enum + code re-check, single action (AI-SPEC §4b, §6) |
| In-list category steering | Tampering | Accepted residual for Phase 3 (no visible effect: action `pending`); Phase 4 must decide (AI-SPEC §6) |
| Silent prompt truncation dropping the trusted part | Tampering | `truncate:false, shift:false`; `prompt_eval_count` sanity check → `input_too_long` |
| Mail leaving the machine via a `*-cloud` model | Information disclosure | Preflight refuses `remote_host`/`remote_model`; requests only to the `models.url` origin (E7) |
| Email/prompt text in logs or `last_error` | Information disclosure | Never log raw output, reason or Ollama error text; sentinel tests |
| ReDoS | DoS | No regex built from rule or mail text; only linear fixed regexes in `clean()` |
| YAML alias bomb / huge rules.yaml | DoS | `maxAliasCount`, file-size cap |
| Emoji/CJK flood exhausting context | DoS | Body cap 4,000 chars + `input_too_long` → review (no retry, mailbox continues) |
| Backlog starving new mail | DoS | Newest-first keyset, 25-call cap, examined-per-tick cap |
| Display-name / Reply-To spoof triggering exact rules | Spoofing | From address only; label-boundary domain suffix match (E9) |

## Sources

### Primary (HIGH confidence)
- Codebase, read this session: `packages/db/src/{schema/scoped.ts, schema/index.ts, schema/mailbox.ts, scope.ts, ingest.ts, lock.ts, status.ts, registry-read.ts, rls.ts, app-db.ts}`, `packages/db/migrations/{0003,0004,0005,0006,0007}*.sql`, `meta/_journal.json`, `packages/db/test/support/{catalog.ts, seed.ts}`, `packages/core/src/config/{schema.ts, load.ts, errors.ts, env.ts, slug.ts}`, `apps/worker/src/{runtime/mailbox-batch.ts, runtime/supervisor.ts, runtime/backoff.ts, commands/worker.ts, commands/mailbox-backfill.ts, commands/mailbox-rename.ts, commands/config-check.ts, command.ts, ingest/message.ts, ingest/types.ts}`, `compose.yaml`, `Dockerfile`, `.gitignore`, `.dockerignore`, `README.md` (trace, rules, tiers, data model, security), ADR 0002/0003
- `node_modules` type declarations: drizzle-orm 0.45.3 `uniqueIndex().where()`, `double-precision`; postal-mime 4.0.0 `addressParser` export
- Live probes: uuidv7 monotonic (psql), live row counts (decision/rule_set 0, eligible 281), Ollama 0.18.2 tags, worker-container reachability
- 03-AI-SPEC.md (Ollama API, Zod `toJSONSchema`, error classification, already verified against official docs and a live server)

### Secondary (MEDIUM confidence)
- PostgreSQL 18 docs, functions-uuid: uuidv7 is "time-ordered"; the docs state no explicit monotonicity guarantee (the probe above covers the single-session case) [CITED: postgresql.org/docs/18/functions-uuid.html]

### Tertiary (LOW confidence)
- None relied on.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new dependencies; versions read from package.json and node_modules)
- Architecture and integration: HIGH (every seam read in source; pitfalls 1–4 verified by grep/probe)
- Pitfalls: HIGH for the verified ones; MEDIUM for lock-granularity and status-flap trade-offs (design judgment)

**Research date:** 2026-10-10
**Valid until:** 2026-11-09 (stable codebase; re-check if Phase 2 code changes)

### Plans to Review
#### .planning/phases/03-tiered-classification-with-traces/03-25-PLAN.md
---
phase: 03-tiered-classification-with-traces
plan: 25
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/src/classify/llm-output.ts
  - apps/worker/test/classify-control-chars.test.ts
  - packages/core/test/llm-output.test.ts
  - packages/db/src/ingest.ts
  - packages/db/src/classify.ts
  - packages/db/test/classify.test.ts
autonomous: true
gap_closure: true
requirements: [CLS-06, CLS-03, TRC-01, SEC-01]

estimate:
  tokens: 60000
  raw_tokens: 60000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "A model answer whose reason holds an unpaired UTF-16 surrogate after JSON.parse (the JSON escape for a code unit in U+D800..U+DFFF without its partner, which llama.cpp's JSON grammar allows) fails validateLlmOutput as schema_mismatch with the fixed detail 'reason: lone_surrogate'; it is retried once, and a second such answer stores a review invalid_output decision (WR-04, CLS-03)"
    - "Five newest LLM-bound messages whose answers always hold such a reason, plus one older message with a valid answer: the FIRST pass returns outcome done with failures 0 and unclassified [], stores six decisions (five review invalid_output, one labelled), leaves nothing pending, logs no 'classify: message failed' line, and every decision passes expectReplayableDecision (ROADMAP SC5, CLS-06; the verifier's reproduction of 3 throwing passes and 0 decisions no longer holds)"
    - "A reason with a valid surrogate pair (an astral emoji) still validates; only an unpaired high or low surrogate, or a reversed pair, is rejected (edge: encoding)"
    - "recordDecision replaces every unpaired surrogate in every string of the parsed spans with U+FFFD, after the NUL strip and before assertConsistent and the insert (backstop for the Ollama-supplied raw, thinking, done_reason and response_model); an attempt holding unpaired surrogates in those four fields is stored without a jsonb error, and a valid pair in them is kept as it was"
    - "The Ollama format schema and the prompt material are unchanged: EXPECTED_PROMPT_HASH in prompt-version.test.ts still matches and that file is not modified, so no new prompt_version row is created"
    - "The model's reason is rejected, never repaired: validateLlmOutput returns ok false for it, and the backstop only ever sees reasons that already passed validation"
  prohibitions:
    - "Must NOT change llmOutputSchema, ollamaFormat, packages/core/src/classify/prompt.ts, packages/core/src/classify/prompt-version.ts or packages/core/test/prompt-version.test.ts (EXPECTED_PROMPT_HASH stays as committed at 1aae7bc)"
    - "Must NOT modify apps/worker/src/classify/run.ts (see the run.ts decision below); the throw path is proven unreached for this cause by the failures: 0 assertions"
    - "Must NOT add a review reason, a validation failure code or a migration: the new rejection is a schema_mismatch detail only"
    - "Must NOT write a raw lone surrogate, a raw U+2028/U+2029 or a backslash-u escape sequence into any source or test file: build such strings at runtime with String.fromCharCode (and String.fromCharCode(92) for a backslash)"
  artifacts:
    - path: "packages/core/src/classify/llm-output.ts"
      provides: "validateLlmOutput rejects an ill-formed (unpaired surrogate) reason as schema_mismatch 'reason: lone_surrogate'"
      contains: "reason: lone_surrogate"
    - path: "apps/worker/test/classify-control-chars.test.ts"
      provides: "End to end: lone-surrogate reasons (one message; five in a row plus an older valid one) are all decided in the first pass"
      contains: "WR-04"
    - path: "packages/db/src/ingest.ts"
      provides: "wellFormed(value): every string, keys included, through String.prototype.toWellFormed (internal, beside stripNul)"
      contains: "export function wellFormed"
    - path: "packages/db/src/classify.ts"
      provides: "recordDecision backstop: wellFormed over the NUL-stripped parsed spans"
      contains: "wellFormed(stripNul(parseDecisionSpans"
  key_links:
    - from: "apps/worker/src/classify/llm-tier.ts"
      to: "packages/core/src/classify/llm-output.ts"
      via: "a validateLlmOutput failure (any code) drives the existing one-retry, then review invalid_output path"
      pattern: "validateLlmOutput"
    - from: "packages/db/src/classify.ts"
      to: "packages/db/src/ingest.ts"
      via: "wellFormed and stripNul imported for the spans backstop"
      pattern: "wellFormed"
---

<objective>
Close the one remaining 03-VERIFICATION gap on the worker side (ROADMAP SC5 / CLS-06, review WR-04): a model answer whose reason holds a lone UTF-16 surrogate passes validateLlmOutput, cannot be stored in jsonb ("Unicode low surrogate must follow a high surrogate"), stays pending forever, and five in a row make every pass throw.

The fix mirrors WR-01 (03-16): reject at the boundary, never repair. validateLlmOutput treats an ill-formed reason as schema_mismatch (one retry, then review invalid_output, per D-24 / CLS-03), and recordDecision gets a well-formedness backstop next to its NUL backstop for the strings Ollama supplies. The rules-file side of the same predicate (WR-05) is plan 03-26, run in parallel (no shared files).

Purpose: one hostile email (or five) can no longer stop a mailbox's classification or keep a message from getting a category or review (CLS-06, SEC-01); the trace stays storable and replayable (TRC-01).
Output: one code-level reason check, one backstop helper and its use, end-to-end and unit tests.

## Decisions taken in this plan (planner discretion, gap scope)

- **Predicate and detail.** The check is String.prototype.isWellFormed() on the parsed, trimmed reason, with its own fixed detail 'reason: lone_surrogate'. The verifier allowed either a Cs property escape in REASON_CONTROL_CHARACTERS or isWellFormed(); isWellFormed() was chosen because (a) it is the same built-in predicate plan 03-26 uses in the rules schema, so config check and the worker cannot drift, (b) a surrogate is not a control character, so the trace detail stays accurate for the owner who reads it in Phase 4 (TRC-05, "no misleading errors"), and (c) REASON_CONTROL_CHARACTERS and its tests stay untouched. Rated reversible: the detail is free text inside schema_mismatch (spans.ts validation detail is z.string()); no reader parses it.
- **Backstop.** A deep wellFormed helper sits beside stripNul in packages/db/src/ingest.ts (same walker shape, same internal status, not re-exported from index.ts), the same treatment ingest already gives mail text in apps/worker/src/ingest/message.ts clean(). recordDecision keeps the literal stripNul(parseDecisionSpans call that 03-16's artifact check greps for, wrapped by wellFormed.
- **run.ts throw path (lines ~617-626) is left unchanged, deliberately.** After this plan no string from the model or from Ollama can make the decision insert fail: the reason is rejected before decide(), and every other span string passes stripNul and wellFormed. The rule_set snapshot is validated by the same loadRules the worker calls, and 03-26 makes that schema reject unpaired surrogates, so a bad rules file fails closed as rules_invalid before any insert (D-05). What is left on the throw path is database or connection failure, where the 03-08 design (five in a row rethrow: error status and backoff) is the right response and a review decision could not be written anyway. A terminal state for arbitrary write failures would need a new review reason, a CHECK change and a migration (a one-way door like 03-19's llm_error, needing an owner checkpoint), and the verifier's missing list does not ask for it. The new end-to-end test asserts failures: 0 and no 'classify: message failed' log line, which proves the path is unreached for this cause.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/03-tiered-classification-with-traces/03-VERIFICATION.md
@.planning/phases/03-tiered-classification-with-traces/03-REVIEW.md
@.planning/phases/03-tiered-classification-with-traces/03-16-SUMMARY.md
@packages/core/src/classify/llm-output.ts
@packages/db/src/classify.ts

<interfaces>
Existing (packages/core/src/classify/llm-output.ts, ASCII-only file):
  REASON_MAX_CHARS = 200; llmOutputSchema(categories) = z.strictObject({ reason: z.string().trim().min(1).max(REASON_MAX_CHARS), category: z.enum(categories), confidence: z.number().min(0).max(1) })
  REASON_CONTROL_CHARACTERS (Cc plus the two Unicode line separators, u flag), unchanged by this plan
  validateLlmOutput(schema, raw) -> { ok: true; value } | { ok: false; failure: { code: 'not_json' | 'out_of_category' | 'schema_mismatch'; detail } }
    on safeParse success: REASON_CONTROL_CHARACTERS match -> schema_mismatch 'reason: control_character' (line ~94), else ok
Existing (apps/worker/src/classify/llm-tier.ts): any validation failure gets one retry with RETRY_NOTE for its code; a second failure -> review invalid_output (out_of_category keeps its own reason)
Existing (packages/db/src/ingest.ts line ~126): export function stripNul<V>(value: V): V  (deep walk: strings, arrays, plain objects incl. keys; Dates untouched; @internal, shared with classify.ts)
Existing (packages/db/src/classify.ts recordDecision line ~137): const spans = stripNul(parseDecisionSpans(input.spans)); assertConsistent(input, spans); insert ... spans
Existing (apps/worker/src/ingest/message.ts clean()): stripNul(value).toWellFormed() for mail text, the precedent for this backstop
Test support (apps/worker/test/classify-control-chars.test.ts): BACKSLASH = String.fromCharCode(92); controlReasonAnswer(hex) puts BACKSLASH + 'u' + hex mid-reason ('Looks fine<escape> to me.'); expectHeldForReview(hex) asserts the two-message outcome; llmAttempts(decision); asksAbout(request, subject); pass(box, fake) builds its own recordingLog(); CONTROL_CHARACTER_FAILURE
Test support: classify-harness.ts seedPendingMessages, decisionsOf, pendingIdsOf, expectReplayableDecision (checks attempt.raw equals the fake's answered content); fake-ollama.ts contentAnswer, okAnswer; mailbox-harness.ts recordingLog() with messages()
Test support (packages/db/test/classify.test.ts): the 'WR-01 backstop' case (line ~708) builds a dirty attempt via attempt(...), decide(...) with llmContext(...), recordDecision via decisionInput(newer, ruleSetId, draft, { decidedBy: 'rerun', promptVersionId }), then reads spans back with adminQuery

New, this plan:
  validateLlmOutput: a parsed reason that is not well-formed -> { ok: false, failure: { code: 'schema_mismatch', detail: 'reason: lone_surrogate' } }
  export function wellFormed<V>(value: V): V   // packages/db/src/ingest.ts, @internal
  recordDecision: const spans = wellFormed(stripNul(parseDecisionSpans(input.spans)))
</interfaces>
</context>

## Artifacts this phase produces (plan 03-25)

| Kind | Name | Where |
|------|------|-------|
| validation detail | `'reason: lone_surrogate'` (schema_mismatch, from `isWellFormed()` on the parsed reason) | packages/core/src/classify/llm-output.ts validateLlmOutput |
| function (internal) | `wellFormed<V>(value: V): V` | packages/db/src/ingest.ts |
| backstop | `wellFormed(stripNul(parseDecisionSpans(input.spans)))` in recordDecision | packages/db/src/classify.ts |
| test constant | `LONE_SURROGATE_FAILURE` (`{ ok: false, code: 'schema_mismatch', detail: 'reason: lone_surrogate' }`) | apps/worker/test/classify-control-chars.test.ts |
| test describe | `a model reason with a lone surrogate (WR-04, CLS-06)`: U+D800 and U+DC00 single-message cases, five-in-a-row case | apps/worker/test/classify-control-chars.test.ts |
| test describe | `lone surrogates in the reason (WR-04)` | packages/core/test/llm-output.test.ts |
| test case | `... lone surrogates in thinking, raw, done_reason and response_model ... (WR-04 backstop)` | packages/db/test/classify.test.ts |

No new exported constant from @sift/core/classify, no prompt-version change, no migration, no package install, no change to run.ts.

<tasks>

<task type="tracer">
  <name>Task 1: Tracer - lone-surrogate model reasons (one message, and five in a row before an older valid one) are all decided in the first pass</name>
  <precondition>Postgres is reachable through SIFT_TEST_ADMIN_URL (sift-db-1 on 127.0.0.1:5432)</precondition>
  <files>packages/core/src/classify/llm-output.ts, apps/worker/test/classify-control-chars.test.ts</files>
  <read_first>
    - packages/core/src/classify/llm-output.ts (whole file; the file being modified)
    - apps/worker/test/classify-control-chars.test.ts (whole file; the file being extended)
    - packages/core/src/classify/prompt-version.ts (PROMPT_MATERIAL_PARTS: schemaShape comes from ollamaFormat(llmOutputSchema), so the schema must not change)
    - packages/core/test/prompt-version.test.ts (EXPECTED_PROMPT_HASH)
    - apps/worker/src/classify/run.ts lines 570-630 (classifyCandidates: the catch block that counts, logs 'classify: message failed' and rethrows after MAX_CONSECUTIVE_MESSAGE_FAILURES; read only, not modified)
    - apps/worker/test/support/mailbox-harness.ts recordingLog (messages())
    - apps/worker/test/classify-hermetic.test.ts (it scans every classify-*.test.ts; never write the real Ollama port)
    - .wolf/cerebrum.md (Write/Edit tools decode backslash-u escapes; biome rewrites such escapes in string literals; apostrophes in single-quoted it() titles break the vitest transform, bug-247)
  </read_first>
  <action>
Implements the WR-04 fix as a code-level output check (D-24: validate again in code, never repair; CLS-03, CLS-06).

1. packages/core/src/classify/llm-output.ts, validateLlmOutput: after the existing REASON_CONTROL_CHARACTERS check and before returning ok, return { ok: false, failure: { code: 'schema_mismatch', detail: 'reason: lone_surrogate' } } when result.data.reason.isWellFormed() is false. Leave llmOutputSchema, ollamaFormat and REASON_CONTROL_CHARACTERS exactly as they are (the schema is prompt material, D-29; llama.cpp's grammar cannot express this rule). Extend the validateLlmOutput doc comment in prose (WR-04): the grammar lets the model write a JSON escape for a code unit in U+D800..U+DFFF without its partner; JSON.parse turns it into an unpaired surrogate; PostgreSQL jsonb refuses it ("Unicode low surrogate must follow a high surrogate"), so the decision insert would fail on every pass; the answer is rejected and retried like any other invalid answer, never repaired; the detail is fixed text and never quotes the model; isWellFormed() is the same predicate the rules schema uses (03-26). The file must stay pure ASCII: describe code points as U+D800 in prose, never as an escape.
2. apps/worker/test/classify-control-chars.test.ts (extend; DB + fake Ollama, no IMAP):
   - Update the file's top doc comment to mention WR-04 alongside WR-01.
   - Add LONE_SURROGATE_FAILURE = { ok: false, code: 'schema_mismatch', detail: 'reason: lone_surrogate' } as const.
   - Give expectHeldForReview a second parameter, the expected attempt validation, defaulting to CONTROL_CHARACTER_FAILURE, so the four existing cases are unchanged.
   - New describe 'a model reason with a lone surrogate (WR-04, CLS-06)':
     a. 'a lone high surrogate (U+D800) twice: stored as review invalid_output, the other message labelled' via expectHeldForReview('D800', LONE_SURROGATE_FAILURE). controlReasonAnswer already writes the escape as BACKSLASH + 'u' + hex inside valid JSON text, so the fake's HTTP body is valid JSON and JSON.parse of the content yields the unpaired surrogate.
     b. 'a lone low surrogate (U+DC00) twice: ...' via expectHeldForReview('DC00', LONE_SURROGATE_FAILURE).
     c. 'five lone-surrogate answers in a row and an older valid message: all six decided in the first pass (SC5)': a fresh mailbox; five LLM-bound messages at minute(60) down to minute(56) and one older at minute(10) (llmMessage); the fake answers any of the five subjects (asksAbout) with controlReasonAnswer('D800') on every call and the older one with okAnswer('Receipts', 0.9). Run ONE pass with its own recordingLog() passed to classifyMailbox (same arguments as pass()). Assert the outcome toEqual { kind: 'done', labelled: 1, review: 5, llmCalls: 11, examined: 6, failures: 0, ollamaFailed: [], unclassified: [] }; six decisions; each of the five is review invalid_output, tier llm, category null, with attempts' validations [LONE_SURROGATE_FAILURE, LONE_SURROGATE_FAILURE]; the older one is labelled Receipts; every decision passes expectReplayableDecision; pendingIdsOf is []; and the log's messages() contain no 'classify: message failed'. This is the verifier's reproduction (03-VERIFICATION Behavioral Spot-Checks) turned into a regression test.
   Build every special string at runtime (String.fromCharCode; BACKSLASH for the escape); the test file must stay pure ASCII. Use double-quoted or apostrophe-free it() titles.
3. Proof the test bites: with the new isWellFormed check temporarily disabled in a scratch-backed copy of llm-output.ts (restore with `command cp -f`, confirm with `diff -q`), case c must fail (the pass throws a Failed query on the decision insert or reports failures above 0, and messages stay pending). Record the observed failure in the SUMMARY.
  </action>
  <verify>
    <automated>pnpm vitest run apps/worker/test/classify-control-chars.test.ts packages/core/test/prompt-version.test.ts packages/core/test/llm-output.test.ts apps/worker/test/classify-hermetic.test.ts && pnpm typecheck</automated>
    <fails_when>non-zero exit, a "failed" count above 0 in the vitest summary, a lone-surrogate message left pending or a pass that throws, EXPECTED_PROMPT_HASH no longer matching, the hermeticity guard failing on the extended file, or a typecheck error</fails_when>
  </verify>
  <acceptance_criteria>
    - `grep -n "reason: lone_surrogate" packages/core/src/classify/llm-output.ts` matches and `grep -c "isWellFormed()" packages/core/src/classify/llm-output.ts` prints at least 1
    - `grep -c "reason: z.string().trim().min(1).max(REASON_MAX_CHARS)," packages/core/src/classify/llm-output.ts` prints 1 (schema line untouched)
    - `git diff --quiet 1aae7bc -- packages/core/test/prompt-version.test.ts packages/core/src/classify/prompt.ts packages/core/src/classify/prompt-version.ts apps/worker/src/classify/run.ts` exits 0
    - `grep -n "WR-04" apps/worker/test/classify-control-chars.test.ts` matches and `grep -c "it(" apps/worker/test/classify-control-chars.test.ts` prints at least 7 (4 existing + 3 new)
    - `LC_ALL=C grep -c -P '[^\x09\x0A\x20-\x7E]' packages/core/src/classify/llm-output.ts apps/worker/test/classify-control-chars.test.ts` prints 0 for both files (pure ASCII, so no raw surrogate or decoded escape slipped in)
    - The verify command exits 0
  </acceptance_criteria>
  <done>A model answer whose reason cannot be stored is invalid output: retried once, then held for review, and five of them in a row no longer stop the pass; every message, the older valid one included, is decided in the first pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Output-contract cases for lone surrogates and the recordDecision well-formedness backstop</name>
  <precondition>Postgres is reachable through SIFT_TEST_ADMIN_URL (sift-db-1 on 127.0.0.1:5432)</precondition>
  <files>packages/core/test/llm-output.test.ts, packages/db/src/ingest.ts, packages/db/src/classify.ts, packages/db/test/classify.test.ts</files>
  <read_first>
    - packages/core/test/llm-output.test.ts lines 1-30 and 155-215 (answer() helper, the 'control characters in the reason (WR-01)' describe to mirror)
    - packages/db/src/ingest.ts lines 115-136 (stripNul and its @internal note; the file being modified)
    - packages/db/src/classify.ts lines 120-170 (recordDecision and its doc comment; the file being modified)
    - packages/db/test/classify.test.ts lines 430-490 (llmContext, attempt, noMatch, newer) and 700-750 (the 'WR-01 backstop' case to mirror)
    - apps/worker/src/ingest/message.ts lines 60-64 (clean(): stripNul then toWellFormed, the precedent)
  </read_first>
  <behavior>
    - validateLlmOutput rejects as schema_mismatch with detail 'reason: lone_surrogate': a lone high surrogate (U+D800, U+DBFF) inside the reason, a lone low surrogate (U+DC00, U+DFFF) inside the reason, a reversed pair (U+DE00 then U+D83D), and a lone high surrogate at the very end of the reason
    - validateLlmOutput accepts a reason holding a valid pair built from two code units (U+D83D U+DE00, an emoji) and returns it unchanged
    - the failure detail never contains the reason text (sentinel check)
    - recordDecision stores an llm decision whose attempt holds an unpaired surrogate in raw, thinking and done_reason, and whose context has one in response_model: the row is inserted (no jsonb error), each unpaired surrogate is stored as U+FFFD, and a valid pair placed in thinking is stored unchanged
  </behavior>
  <action>
Unit cover for WR-04 plus the database backstop the verifier asked for ("toWellFormed() next to stripNul for every string in the parsed spans").
1. packages/core/test/llm-output.test.ts: a describe 'lone surrogates in the reason (WR-04)' with the first three behaviours as it.each tables, in the style of the WR-01 describe. Build every string from code units with String.fromCharCode (for example String.fromCharCode(0xd800)) so the file's non-ASCII line count stays at its current 6. answer() JSON.stringifies the fields, which writes an unpaired surrogate as a JSON escape, so these cases exercise the same escape path as the model.
2. packages/db/src/ingest.ts: add `export function wellFormed<V>(value: V): V` directly after stripNul, with the same walk (strings, arrays, plain objects including keys, Dates untouched) but mapping each string through String.prototype.toWellFormed (an unpaired surrogate becomes U+FFFD). Doc comment: PostgreSQL jsonb rejects an unpaired surrogate escape (WR-04), node-postgres sends jsonb as JSON text, and JSON.stringify writes an unpaired surrogate as such an escape; same internal status as stripNul (shared with classify.ts, not re-exported from index.ts).
3. packages/db/src/classify.ts recordDecision: change the first line to `const spans = wellFormed(stripNul(parseDecisionSpans(input.spans)));` (import wellFormed from './ingest.ts' with stripNul), so the 03-16 literal stays and assertConsistent and the insert run on the cleaned spans. Extend the doc comment: unpaired surrogates in Ollama-supplied strings (raw, thinking, done_reason, response_model) become U+FFFD (WR-04 backstop); the model's reason is rejected earlier by validateLlmOutput ('reason: lone_surrogate'), never repaired; a stored attempt whose raw was repaired no longer equals what the server sent, accepted because real Ollama never emits an unpaired surrogate (its encoder replaces invalid text) and the alternative is a decision that can never be stored.
4. packages/db/test/classify.test.ts: the fourth behaviour, titled with "(WR-04 backstop)", mirroring the WR-01 backstop case (decidedBy 'rerun' on `newer`, decide with noMatch and llmContext). Put a lone high surrogate in raw and done_reason, a lone low surrogate in response_model, and in thinking both a lone surrogate and a valid pair. Read the row back with adminQuery and assert the strings with String.fromCharCode(0xfffd) in place of each unpaired surrogate, the pair unchanged, and that JSON.stringify of the stored spans contains no backslash-u-d800 or backslash-u-dc00 escape (build the needle with String.fromCharCode(92)). RED: before step 3 this case must fail on the insert with a jsonb error (record the SQLSTATE in the SUMMARY). The llm-output cases already pass after Task 1; pin them in the RED commit as regression tests, as 03-16 did.
  </action>
  <verify>
    <automated>pnpm vitest run packages/core/test/llm-output.test.ts packages/db/test/classify.test.ts packages/db/test/ingest.test.ts apps/worker/test/classify-llm-tier.test.ts && pnpm typecheck</automated>
    <fails_when>non-zero exit, a "failed" count above 0 in the vitest summary, a jsonb error from the WR-04 backstop case, an accepted lone-surrogate reason, a rejected valid pair, or a typecheck error</fails_when>
  </verify>
  <acceptance_criteria>
    - `grep -n "WR-04" packages/core/test/llm-output.test.ts packages/db/test/classify.test.ts` matches in both files
    - `grep -n "export function wellFormed" packages/db/src/ingest.ts` matches
    - `grep -n "wellFormed(stripNul(parseDecisionSpans" packages/db/src/classify.ts` matches
    - `grep -n "wellFormed" packages/db/src/index.ts` prints nothing (internal helper, not re-exported)
    - `LC_ALL=C grep -c -P '[^\x09\x0A\x20-\x7E]' packages/db/src/ingest.ts packages/db/src/classify.ts packages/db/test/classify.test.ts` prints 0 for each file, and the same count for packages/core/test/llm-output.test.ts prints 6 (unchanged)
    - The verify command exits 0
  </acceptance_criteria>
  <done>The output contract rejects unpaired surrogates per code unit and accepts valid pairs, and no string Ollama supplies can make a decision insert fail.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| model output -> decision | the model's reason (steerable by injected email text, model assumed fully compromised per 03-10) is validated before it reaches decide() and jsonb |
| Ollama response -> trace | raw, thinking, done_reason and response_model strings from the Ollama server are stored in decision.spans |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-03-79 | Denial of Service | validateLlmOutput / classifyCandidates (an email asks the model to end its reason with an unpaired surrogate escape; the insert fails on every pass; five in a row stop the mailbox's classification) | high | mitigate | isWellFormed() check gives schema_mismatch 'reason: lone_surrogate': one retry, then review invalid_output (Task 1); five-in-a-row end-to-end test asserts all six decided in one pass with failures 0 |
| T-03-80 | Denial of Service | recordDecision (an Ollama-compatible server returns unpaired surrogates in raw, thinking, done_reason or response_model) | medium | mitigate | wellFormed backstop over the NUL-stripped parsed spans before assertConsistent and the insert (Task 2), unit case with all four fields |
| T-03-81 | Repudiation | recordDecision backstop (a repaired raw string no longer equals what the server sent, so that attempt does not replay byte for byte) | low | accept | Only reachable for a non-Ollama or compromised server (Ollama's encoder never emits unpaired surrogates); the reason itself is never repaired; same accepted trade-off as the 03-16 NUL backstop |
| T-03-SC | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages |
</threat_model>

<verification>
- `pnpm vitest run apps/worker/test/classify-control-chars.test.ts apps/worker/test/classify-run.test.ts apps/worker/test/classify-llm-tier.test.ts apps/worker/test/classify-hermetic.test.ts packages/core/test/llm-output.test.ts packages/core/test/prompt-version.test.ts packages/db/test/classify.test.ts packages/db/test/ingest.test.ts` exits 0
- `pnpm typecheck` and `pnpm lint` exit 0 (the existing noTemplateCurlyInString warning in apps/worker/test/node-version.test.ts is unrelated)
- `git diff --quiet 1aae7bc -- apps/worker/src/classify/run.ts packages/core/test/prompt-version.test.ts` exits 0
- Shell setup per .wolf/cerebrum.md Key Learnings (Node 26.10.0 on PATH, `unfunction pnpm`); commits follow commitlint (header at most 100 characters, lower-case subject start, finding ids last, never --no-verify) with an explicit pathspec
</verification>

<success_criteria>
- WR-04 closed: a lone-surrogate reason can no longer make a message fail on every pass, and five of them can no longer stop the pass (ROADMAP SC5 / CLS-06 worker side)
- No prompt_version change, no migration, run.ts untouched (decision recorded above)
- WR-05 (rules side) is closed by 03-26, not here
</success_criteria>

<output>
Create `.planning/phases/03-tiered-classification-with-traces/03-25-SUMMARY.md` when done. Include the mutation proof (Task 1 step 3) and the RED SQLSTATE (Task 2). Per OpenWolf: log WR-04 in `.wolf/buglog.json` (error_message, root_cause, fix, tags), append to `.wolf/memory.md`, and add a cerebrum Key Learning that jsonb also rejects unpaired surrogates (not only NUL), so decision-bound text needs isWellFormed checks or the wellFormed backstop.
</output>

#### .planning/phases/03-tiered-classification-with-traces/03-26-PLAN.md
---
phase: 03-tiered-classification-with-traces
plan: 26
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/core/src/rules/schema.ts
  - apps/worker/test/config-check-rules.test.ts
  - packages/core/test/rules.test.ts
autonomous: true
gap_closure: true
requirements: [CLS-06, CLS-01]

estimate:
  tokens: 45000
  raw_tokens: 45000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "A rules file whose description, judgment line or rule name holds a YAML escape for an unpaired surrogate (a code unit in U+D800..U+DFFF without its partner) is rejected by parseRulesText / loadRules with exactly one issue at that YAML path and line, message '<name> must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape' (WR-05, D-05)"
    - "A from, domain or phrase entry holding one is rejected with exactly one issue at rules[i].match.<key>[j], message '<key> entries must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape'"
    - "sift config check on such a file exits 1, prints nothing on stdout and one stderr line naming file:line:col, the YAML path and that message; it no longer reports the file as valid, so config check and the worker's rule_set write agree (WR-05)"
    - "One issue per one-line value is kept: a value with a line break and an unpaired surrogate reports only 'must be one line'; a value with a control character and an unpaired surrogate reports only 'must not contain control characters'"
    - "A description written with a surrogate-pair escape (an emoji) or with the emoji itself still loads, and every rules file that loads today validates to the same content and D-03 hash (rules-hash, example-rules and the WR-02 control-character tests pass unchanged)"
    - "The worker and config check read rules through the same loadRules, so the worker fails closed with rules_invalid naming the file (D-05) before any rule_set insert, instead of a jsonb error naming neither file nor line"
  prohibitions:
    - "Must NOT strip, replace or otherwise repair rules text: reject only (P1 D-63, D-05)"
    - "Must NOT change the existing control-character or line-break messages, CONTROL_CHARACTERS, LINE_BREAK or CATEGORY_NAME_PATTERN"
    - "Must NOT echo the offending value in any message (owner-facing errors never quote input)"
    - "Must NOT write a raw lone surrogate or a backslash-u escape sequence into any source or test file: build YAML escapes at runtime with String.fromCharCode(92)"
  artifacts:
    - path: "packages/core/src/rules/schema.ts"
      provides: "UNPAIRED_SURROGATE message, noUnpairedSurrogate predicate (isWellFormed) in oneLine and on from/domain/phrase entries"
      contains: "noUnpairedSurrogate"
    - path: "apps/worker/test/config-check-rules.test.ts"
      provides: "End to end: sift config check exits 1 for an unpaired surrogate in a description, naming file, position and YAML path"
      contains: "WR-05"
    - path: "packages/core/test/rules.test.ts"
      provides: "Schema cases for unpaired surrogates in every free-text field, precedence, and accepted pairs"
      contains: "WR-05"
  key_links:
    - from: "apps/worker/src/commands/config-check.ts"
      to: "packages/core/src/rules/schema.ts"
      via: "loadRules -> parseRulesText -> RulesFileSchema issues printed with formatIssue"
      pattern: "loadRules"
    - from: "apps/worker/src/classify/run.ts"
      to: "packages/core/src/rules/schema.ts"
      via: "the same loadRules: an invalid file is rules_invalid before any ensureRuleSet insert (D-05)"
      pattern: "loadRules"
---

<objective>
Close the owner-side half of the 03-VERIFICATION SC5 / CLS-06 gap (review WR-05, the WR-02 residual): a rules file holding a YAML escape for an unpaired surrogate passes `sift config check`, and then every rule_set insert (inside every decision, exact-rule ones included) fails with a jsonb error that names neither file nor line.

The fix uses the same predicate as plan 03-25's validateLlmOutput check, String.prototype.isWellFormed(), in the rules schema's one-line fields (oneLine) and in the from/domain/phrase entries (next to noControl), so config check rejects what the worker could not store. Reject, never repair (P1 D-63, D-05).

Purpose: the owner hears about a bad rules file from `sift config check` and from the worker's rules_invalid status, with file, line and YAML path, never as an anonymous database error on every pass (CLS-06; the owner's "no misleading errors" rule).
Output: one predicate and one message constant in the rules schema, an end-to-end config-check case and schema cases.

## Decisions taken in this plan (planner discretion, gap scope)

- **Own message, same predicate.** The verifier's missing item says "same predicate in oneLine and noControl". The predicate is isWellFormed(), identical to 03-25's; the message is its own, because an unpaired surrogate is not a control character and the owner's error should say what to fix: `must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape`. noControl, CONTROL_CHARACTERS and the WR-02 messages stay unchanged, so every existing test keeps passing. Rated reversible: owner-facing text only, no stored format.
- **Fields covered.** description, judgment lines and rule name go through oneLine; from, domain and phrase entries get a refine. Category names are already safe (CATEGORY_NAME_PATTERN is ASCII only), and a label must equal an ASCII category name, so neither needs the check.
- **No rule_set backstop.** ensureRuleSet is not given a repair step: the worker loads rules with the same loadRules (run.ts line ~232), so after this plan an unpaired surrogate can never reach rule_set.snapshot; a repair there would hide the owner's mistake instead of reporting it.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/03-tiered-classification-with-traces/03-VERIFICATION.md
@.planning/phases/03-tiered-classification-with-traces/03-REVIEW.md
@packages/core/src/rules/schema.ts

<interfaces>
Existing (packages/core/src/rules/schema.ts, ASCII-only file):
  LINE_BREAK (CR, LF and the two Unicode line separators), CONTROL_CHARACTERS (Cc plus the two separators, u flag)  // line ~48, ~59, unchanged
  function noControl(value: string): boolean  // line ~77, unchanged
  function oneLine(name, max): z.string(...).trim().min(1).max(max).superRefine: LINE_BREAK -> `${name} must be one line`; else CONTROL_CHARACTERS -> `${name} must not contain control characters`  // line ~86
    used by: CategorySchema.description ('description'), Judgment items ('judgment lines'), ExactRuleSchema.name ('name')
  FromEntry: string.trim.toLowerCase.refine(noControl, 'from entries must not contain control characters').max.regex   // line ~186
  DomainEntry: string.trim.toLowerCase.overwrite(trailing dot).refine(noControl, 'domain entries ...').max.regex      // line ~195
  PhraseEntry: string.trim.overwrite(collapse whitespace).refine(noControl, 'phrase entries ...').min.max              // line ~205
  Zod 4.6.5 runs later checks after a failed refine (non-aborting); a lone surrogate passes FROM_PATTERN, DOMAIN_PATTERN and the length checks, so it yields exactly one issue
Existing (packages/core/test/rules.test.ts): rulesYaml({ categories?, judgment?, rules? }), ruleWith(matchLines), issuesOf(text), parsed(text), expectIssue(text, path, message, needle) (exactly one issue at path, message contains, line of needle); describe 'control characters in rules text (WR-02, D-05)' with withDescription(value) and oneLineFields [path, name, file(value)] (line ~454)
Existing (apps/worker/test/config-check-rules.test.ts): TWO_PROBLEMS fixture; NUL_DESCRIPTION = TWO_PROBLEMS with the two problems fixed and the description replaced by a double-quoted YAML value holding a backslash-0 escape (line ~60); dataDir({ alpha: text, beta: 'example' }); check(env) -> { status, stdout, stderr }; lineOf(text, needle); the WR-02 case (line ~153) matches stderr[0] against `^<file>:<line>:\d+ categories\[0\]\.description: <message>$`
Existing: yaml 2.9.1 parses a double-quoted backslash-u escape for U+D800 into an unpaired surrogate (isWellFormed() false) and two escapes forming a valid pair into one astral code point (verified during planning)

New, this plan:
  const UNPAIRED_SURROGATE = 'must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape'
  function noUnpairedSurrogate(value: string): boolean   // value.isWellFormed()
  oneLine superRefine third branch: `${name} ${UNPAIRED_SURROGATE}`
  FromEntry / DomainEntry / PhraseEntry: .refine(noUnpairedSurrogate, `<key> entries ${UNPAIRED_SURROGATE}`) directly after their noControl refine
</interfaces>
</context>

## Artifacts this phase produces (plan 03-26)

| Kind | Name | Where |
|------|------|-------|
| constant (module-private) | `UNPAIRED_SURROGATE` (message tail) | packages/core/src/rules/schema.ts |
| function (module-private) | `noUnpairedSurrogate(value: string): boolean` | packages/core/src/rules/schema.ts |
| schema check | oneLine third branch; `.refine(noUnpairedSurrogate, ...)` on FromEntry, DomainEntry, PhraseEntry | packages/core/src/rules/schema.ts |
| test fixture | `LONE_SURROGATE_DESCRIPTION` | apps/worker/test/config-check-rules.test.ts |
| test case | `exits 1 for an unpaired surrogate in a description, naming file, position and YAML path (WR-05)` | apps/worker/test/config-check-rules.test.ts |
| test describe | `unpaired surrogates in rules text (WR-05, D-05)` | packages/core/test/rules.test.ts |

No change to loadRules, the rule-set hash, config check's code, the worker, README or any migration.

<tasks>

<task type="tracer">
  <name>Task 1: Tracer - sift config check rejects a description holding an unpaired surrogate escape, naming file, position and YAML path</name>
  <files>packages/core/src/rules/schema.ts, apps/worker/test/config-check-rules.test.ts</files>
  <read_first>
    - packages/core/src/rules/schema.ts (whole file; the file being modified)
    - apps/worker/test/config-check-rules.test.ts (whole file; the file being extended)
    - apps/worker/src/commands/config-check.ts (how loadRules issues are printed)
    - packages/core/src/rules/load.ts (parseRulesText: YAML parse, then the schema)
    - .wolf/cerebrum.md (Write/Edit tools decode backslash-u escapes; biome rewrites such escapes in string literals; check new text with an ASCII grep)
  </read_first>
  <action>
Implements the WR-05 fix for the one-line fields, end to end through the CLI (D-05: reject with file, line and YAML path; never fix).
1. packages/core/src/rules/schema.ts: below CONTROL_CHARACTERS and noControl, add the module-private constant UNPAIRED_SURROGATE with exactly the text 'must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape' and the module-private predicate noUnpairedSurrogate(value) returning value.isWellFormed(). Doc comment in prose (WR-05): a YAML double-quoted escape for a code unit in U+D800..U+DFFF without its partner parses into an unpaired surrogate; the validated file is stored as rule_set.snapshot jsonb, which PostgreSQL refuses ("Unicode low surrogate must follow a high surrogate"), so such a file would pass config check and then fail every decision of the mailbox; same predicate as validateLlmOutput (plan 03-25); rejected, never repaired. In oneLine's superRefine add a third branch after the control-character one: when noUnpairedSurrogate(value) is false, add one custom issue `${name} ${UNPAIRED_SURROGATE}`, keeping one issue per value (line break first, then control character, then unpaired surrogate). Update the oneLine doc comment to say so. The file must stay pure ASCII: describe code points as U+D800 in prose, never as an escape.
2. apps/worker/test/config-check-rules.test.ts: add LONE_SURROGATE_DESCRIPTION, built like NUL_DESCRIPTION but with the description replaced by a double-quoted YAML value 'things I need<escape> to act on', where <escape> is String.fromCharCode(92) + 'uD800' (declare a BACKSLASH constant as in classify-control-chars.test.ts). Add the case 'exits 1 for an unpaired surrogate in a description, naming file, position and YAML path (WR-05)', mirroring the WR-02 case: status 1, stdout [], exactly one stderr line, which starts with `<relative file>:<lineOf(LONE_SURROGATE_DESCRIPTION, 'things I need')>:<col> categories[0].description: ` and ends with 'description ' + the exact UNPAIRED_SURROGATE text (compare with startsWith/endsWith or a regex with the parentheses and plus signs escaped). The test file must stay pure ASCII.
3. Proof the test bites: with the new oneLine branch temporarily removed (scratch-backed copy, restore with `command cp -f`, confirm with `diff -q`), the new case must fail because config check exits 0 and prints the valid line; record it in the SUMMARY.
  </action>
  <verify>
    <automated>pnpm vitest run apps/worker/test/config-check-rules.test.ts packages/core/test/rules.test.ts && pnpm typecheck</automated>
    <fails_when>non-zero exit, a "failed" count above 0 in the vitest summary, config check exiting 0 or printing 'rules files valid' for the unpaired-surrogate fixture, an existing WR-02 case failing, or a typecheck error</fails_when>
  </verify>
  <acceptance_criteria>
    - `grep -c "noUnpairedSurrogate" packages/core/src/rules/schema.ts` prints at least 2 (definition and the oneLine use) and `grep -n "must not contain an unpaired surrogate (U+D800 to U+DFFF); write the character itself, not its escape" packages/core/src/rules/schema.ts` matches once
    - `grep -n "WR-05" apps/worker/test/config-check-rules.test.ts` matches and `grep -c "it(" apps/worker/test/config-check-rules.test.ts` prints at least 9 (8 existing + 1)
    - `LC_ALL=C grep -c -P '[^\x09\x0A\x20-\x7E]' packages/core/src/rules/schema.ts apps/worker/test/config-check-rules.test.ts` prints 0 for both files
    - The verify command exits 0
  </acceptance_criteria>
  <done>sift config check now refuses a rules file whose description holds an unpaired surrogate, with the file, line, column and YAML path, instead of reporting it valid.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Unpaired surrogates in every free-text rules field: entries, precedence and accepted pairs</name>
  <files>packages/core/src/rules/schema.ts, packages/core/test/rules.test.ts</files>
  <read_first>
    - packages/core/src/rules/schema.ts lines 175-215 (FromEntry, DomainEntry, PhraseEntry; the file being modified)
    - packages/core/test/rules.test.ts lines 1-120 (helpers) and 450-535 (the WR-02 describe to mirror; the file being extended)
    - packages/core/test/rules-hash.test.ts and packages/core/test/example-rules.test.ts (must pass unchanged)
  </read_first>
  <behavior>
    - In each one-line field (categories[0].description, judgment[0], rules[0].name), a value holding the YAML escape for a lone high surrogate (U+D800) or a lone low surrogate (U+DC00) gives exactly one issue at that path and line whose message contains `<name> must not contain an unpaired surrogate`
    - A value holding a line-feed escape and a lone-surrogate escape gives exactly one issue, `<name> must be one line`; a value holding a NUL escape and a lone-surrogate escape gives exactly one issue, `<name> must not contain control characters`
    - from, domain and phrase entries holding a lone-surrogate escape each give exactly one issue at rules[0].match.<key>[0] whose message contains `<key> entries must not contain an unpaired surrogate`
    - A description written with the two escapes of a valid pair (U+D83D, U+DE00) loads as the emoji, and a description holding the emoji itself (inserted at runtime with String.fromCodePoint) loads unchanged
  </behavior>
  <action>
Completes WR-05 for the exact-rule entries and pins the schema behaviour (D-05, D-08, D-09: entries are rejected, never fixed).
1. packages/core/src/rules/schema.ts: on FromEntry, DomainEntry and PhraseEntry add `.refine(noUnpairedSurrogate, '<key> entries ' + UNPAIRED_SURROGATE)` (written as a template literal, key = from, domain, phrase) directly after each existing noControl refine, so the order of checks and the messages of every other check stay as they are. Update the doc comment above CONTROL_CHARACTERS or noUnpairedSurrogate to list the entry checks.
2. packages/core/test/rules.test.ts: a describe 'unpaired surrogates in rules text (WR-05, D-05)' after the WR-02 describe, reusing withDescription and the oneLineFields table shape (copy the table or hoist it to file scope if that keeps both describes readable) and the four behaviours as cases. Build the YAML escapes at runtime from a BACKSLASH = String.fromCharCode(92) constant (for example a helper that returns `"to` + BACKSLASH + 'uD800' + `do"`), so the file holds no backslash-u sequence and its non-ASCII line count stays at its current 2. Add a top comment explaining that. RED: before step 1 the entry cases fail (the file loads); the one-line cases already pass after Task 1 and are pinned in the RED commit as regression tests.
  </action>
  <verify>
    <automated>pnpm vitest run packages/core/test/rules.test.ts packages/core/test/rules-hash.test.ts packages/core/test/example-rules.test.ts packages/core/test/exact-rules.test.ts apps/worker/test/config-check-rules.test.ts && pnpm typecheck</automated>
    <fails_when>non-zero exit, a "failed" count above 0 in the vitest summary, an unpaired-surrogate entry that loads, a value reported with two issues, a valid pair rejected, a changed rule-set hash in rules-hash.test.ts, or a typecheck error</fails_when>
  </verify>
  <acceptance_criteria>
    - `grep -c "refine(noUnpairedSurrogate" packages/core/src/rules/schema.ts` prints 3
    - `grep -n "WR-05" packages/core/test/rules.test.ts` matches
    - `git diff --quiet 1aae7bc -- packages/core/test/rules-hash.test.ts packages/core/test/example-rules.test.ts packages/core/src/rules/load.ts packages/core/src/rules/hash.ts apps/worker/src/commands/config-check.ts apps/worker/src/classify/run.ts` exits 0
    - `LC_ALL=C grep -c -P '[^\x09\x0A\x20-\x7E]' packages/core/test/rules.test.ts` prints 2 (unchanged) and the same count for packages/core/src/rules/schema.ts prints 0
    - The verify command exits 0
  </acceptance_criteria>
  <done>Every free-text value in rules.yaml that the database could not store is reported by config check and the worker with its YAML path, and every file that loads today still loads to the same rule set.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| owner's rules.yaml -> rule_set.snapshot and the trusted prompt part | owner-authored text, validated by the rules schema, is stored as jsonb and placed in every LLM prompt |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-03-82 | Denial of Service | rules schema -> ensureRuleSet (an unpaired surrogate escape in rules.yaml passes config check, then every decision insert of the mailbox fails with an anonymous jsonb error) | medium | mitigate | noUnpairedSurrogate (isWellFormed) in oneLine and on from/domain/phrase entries; config check exits 1 naming file:line:col and YAML path (Task 1); the worker fails closed as rules_invalid through the same loadRules (D-05) |
| T-03-83 | Information Disclosure | rules-file error messages (stderr and mailbox_status.last_error) | low | mitigate | Fixed message text that never quotes the value (existing convention); the config-check case matches the whole stderr line, so an echoed value would fail it |
| T-03-SC | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages |
</threat_model>

<verification>
- `pnpm vitest run packages/core/test/rules.test.ts packages/core/test/rules-hash.test.ts packages/core/test/example-rules.test.ts packages/core/test/exact-rules.test.ts apps/worker/test/config-check-rules.test.ts` exits 0
- `pnpm typecheck` and `pnpm lint` exit 0 (the existing noTemplateCurlyInString warning in apps/worker/test/node-version.test.ts is unrelated)
- `grep -n "loadRules" apps/worker/src/classify/run.ts apps/worker/src/commands/config-check.ts` matches in both files (config check and the worker share the validation)
- Shell setup per .wolf/cerebrum.md Key Learnings (Node 26.10.0 on PATH, `unfunction pnpm`); commits follow commitlint (header at most 100 characters, lower-case subject start, finding ids last, never --no-verify) with an explicit pathspec
</verification>

<success_criteria>
- WR-05 closed: config check and the worker reject the same unstorable rules text, with file, line and YAML path
- Existing rules files, messages and rule-set hashes unchanged
- WR-04 (model side) is closed by 03-25, not here
</success_criteria>

<output>
Create `.planning/phases/03-tiered-classification-with-traces/03-26-SUMMARY.md` when done. Include the mutation proof (Task 1 step 3) and the RED evidence (Task 2). Per OpenWolf: log WR-05 in `.wolf/buglog.json`, append to `.wolf/memory.md`, and note in the cerebrum that rules text checks are line break, control character, unpaired surrogate (one issue per value).
</output>

## Review Instructions

Scope note: phase 03 has 26 plans; 03-01..03-24 are already executed and verified. This review covers ONLY the two new gap-closure plans 03-25 and 03-26, which close the single remaining gap in .planning/phases/03-tiered-classification-with-traces/03-VERIFICATION.md (frontmatter `gaps:`, ROADMAP SC5 / CLS-06: a lone UTF-16 surrogate in a model reason or a rules.yaml value passes validation and then fails the PostgreSQL jsonb insert; review findings WR-04, WR-05 in 03-REVIEW.md). Read that VERIFICATION.md gap entry first.

**Verify against source — do not review the plan text in isolation.** The plans reference real files, migrations, routes, and tests in this repo.
1. Open the referenced files and check each claim against the actual code.
2. For every strength or concern, cite concrete `path/to/file:line` evidence plus the mechanism.
3. When a plan asserts a mechanism works (a guard, a query filter, a test that exercises a path), trace whether it actually does what is claimed — do not take the plan's word for it.
4. If you cannot read the repo (no file access), say so and downgrade that finding to an open question rather than asserting it.

Findings citing `file:line` evidence are weighted far more heavily than impressionistic ones; a review that only restates the plan's own claims has low value.

**Plan coverage is mandatory (#3301).** The exact list of plan ids and the total plan count for this review are given in the "## Plan Coverage Manifest" section below. Give **every** listed id its own `##`-level section headed with that id **verbatim** (e.g. `## 03-25`) before writing any cross-plan comparison, an overall risk assessment, or a consensus-style summary. A review that stops before every id has its own section is an incomplete review, not a summary — if you must stop early, say so explicitly and name which ids you did not reach.

Analyze each plan and provide:

1. **Summary** — One-paragraph assessment
2. **Strengths** — What's well-designed (bullet points)
3. **Concerns** — Potential issues, gaps, risks (bullet points with severity: HIGH/MEDIUM/LOW)
4. **Suggestions** — Specific improvements (bullet points)
5. **Risk Assessment** — Overall risk level (LOW/MEDIUM/HIGH) with justification

Focus on:
- Missing edge cases or error handling
- Dependency ordering issues
- Scope creep or over-engineering
- Security considerations
- Performance implications
- Whether the plans actually achieve the phase goals (in particular: does leaving apps/worker/src/classify/run.ts's throw path unchanged hold up?)

Output your review in markdown format.

## Plan Coverage Manifest

Total plans in this review: 2

Plan ids (give each one its own `##`-level section, headed verbatim):
- 03-25
- 03-26

warning: failed to parse hooks config /Users/samuel/.codex/hooks.json: unknown field `SessionStart`, expected `description` or `hooks` at line 2 column 16
2026-10-12T21:13:50.295106Z ERROR rmcp::transport::worker: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: "Bearer error=\"invalid_token\", error_description=\"No authorization provided\", resource_metadata=\"https://mcp.vercel.com/.well-known/oauth-protected-resource\"" })
warning: Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.
hook: SessionStart
hook: SessionStart
hook: SessionStart
hook: SessionStart Failed
hook: SessionStart Failed
hook: SessionStart Failed
ERROR: You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Nov 4th, 2026 3:06 AM.
ERROR: You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Nov 4th, 2026 3:06 AM.

Diagnosis: codex ran at effort=high and exited with status 1.
