# Sift

## What This Is

Sift is self-hosted email triage for one owner on a small always-on home machine (mini PC or Mac mini). It reads mailboxes over IMAP (Proton Mail via Proton Bridge first), sorts each message into owner-defined categories, and applies them as labels in the mail client. A cheap exact-rule tier handles the obvious mail, a small local LLM handles the rest, and (in later milestones) a tiny classifier trained on the owner's own corrections takes over. When nothing is confident, Sift asks the owner instead of guessing.

Email never leaves the network: no cloud model, no telemetry, no accounts. Status is pre-alpha; the README describes the target, and this planning set scopes the first milestone (M1 Classify).

## Core Value

Every incoming email is auto-labelled correctly or explicitly held for the owner, entirely on local hardware, and the owner can always see why Sift decided what it did (a decision trace for every classification).

## Current Milestone: M1 Classify ("M1 on real inbox")

**Developer-facing success metric:** one Proton mailbox auto-labelled end-to-end (Tier 0 exact rules + Tier 2 local LLM) via IMAP/Proton Bridge, with a decision trace for every classification, a mailbox-scoped schema with row-level security from day one, and the Proton Bridge spike (labels as folders, CONDSTORE/QRESYNC, Message-ID reliability) answered.

M1 has no UI, no Tier 1 classifier, no learning, and hardcoded Tier 0 rules. It exists to prove the pipeline against a real inbox and to lock the data boundary and trace shape before anything is built on top of them.

**Target runtime:** self-hosted on a small home machine (mini PC / Mac mini); local-only, no cloud model, no telemetry. Docker Compose for the services; on Apple Silicon Ollama runs natively and containers reach it at `host.docker.internal:11434`.

## Requirements

### Validated

(None yet — ship to validate)

### Active

M1 scope. Full IDs and wording in `.planning/REQUIREMENTS.md`.

- [ ] Foundation: Compose stack (Postgres + pgvector, worker), Drizzle schema and migrations, per-mailbox config with credentials from environment variables
- [ ] Isolation: non-null `mailbox_id` on every mail-derived table, Postgres RLS keyed on `app.mailbox_id`, automated two-mailbox RLS test
- [ ] Proton Bridge spike answered and recorded (label folders, CONDSTORE/QRESYNC, Message-ID consistency, UIDVALIDITY behaviour)
- [ ] IMAP ingest of one mailbox into the database, idempotent, resumable
- [ ] Tier 0 hardcoded exact rules and Tier 2 local LLM (Ollama, JSON-schema constrained output, fenced untrusted email)
- [ ] Decision trace (`decision` table) for every classification, replayable by version
- [ ] Labels applied in the Proton mailbox as label folders; uncertain messages held for review; every Sift change recorded for later echo suppression
- [ ] End-to-end run on a real inbox

### Out of Scope (for M1)

- Web UI of any kind (review queue, "Why?" links, rules editor) — M1 is CLI/worker only; traces are inspected via CLI or SQL
- Tier 1 embedding classifier, retraining, cold-start thresholds, spot checks — M2
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
- Planned stack (README): TypeScript end to end (Tier 1 included, no Python), React Router v7, Hono, Postgres + pgvector, Drizzle, Ollama, Docker Compose. Planned layout: `apps/worker`, `apps/web`, `packages/core`, `packages/classifier`, `packages/db`, `packages/evals`, `fixtures/`, `evals/`, `data/`.
- Default models (README): `nomic-embed-text` for embeddings (Tier 1, later), a 1B-class instruct model (README example `qwen3:1.7b`) for Tier 2. Tier 2 confidence threshold default 0.75.
- Proton Mail needs Proton Bridge on a paid plan; Bridge exposes labels as folders (`Labels/Noise`). Bridge behaviour (CONDSTORE/QRESYNC, Message-ID across label folders) is unverified and is the first open risk.
- Open ADR-0003 item: raw Tier 2 prompts may need a retention limit (example: 90 days for full prompts, summary forever). Decide when the `decision` table shape is finalised; not a blocker.
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
- Learning never crosses mailboxes: Tier 1 trains on, and Tier 2 retrieves from, a single mailbox's confirmed labels only.
- Rules are per mailbox (`data/mailboxes/<slug>/rules.md`) with an optional `data/shared-rules.md` merged in; categories are per mailbox.
- Isolation is tested (`evals/isolation/` with look-alike emails across two mailboxes).
- Credentials are per mailbox, supplied via environment variables (`password_env`), never stored in config files or the database in plaintext.
- Deferred: multiple users/household support; shared learning across mailboxes (if ever added: explicit per-mailbox setting, off by default, covered by isolation tests).

**ADR-0002 — Tiered classification, trained only on the owner's labels (locked)**
- Three tiers, cheapest first. Tier 0: exact rules decided deterministically in code. Tier 1: local embeddings plus a per-mailbox classifier (nearest neighbours + logistic regression), retrained after every label. Tier 2: a 1B-class instruct model given the owner's categories and judgment rules, the most similar confirmed examples, and the fenced-off email; output limited to the owner's categories by a JSON schema.
- Escalation: Tier 0 no match, Tier 1 not confident or not trained for that category, or selected for a spot check, moves to the next tier. Tier 2 not confident goes to the owner's review queue.
- Tier 1's training set contains only labels the owner confirmed or corrected. Labels applied automatically by any tier, including Tier 2, are excluded.
- Quick confirm: small batches of recent Tier 2 decisions offered for one-key approval; approved or corrected decisions become owner labels.
- Learning directly from Tier 2 ("distillation") exists only behind an experimental flag evaluated with the eval harness; enabling by default requires a superseding ADR.
- Rejected: LLM only; fine-tuning a small LLM; classifier only; Tier 1 learning from Tier 2 by default.

**ADR-0003 — Decision traces and learning from mail-app relabels (locked)**
- Every classification produces a decision trace in the `decision` table: one span per tier that ran, plus the final action, plus rule set, classifier, prompt and model versions so the decision can be replayed. Shown in the UI behind "Why?"; nothing is written into the mailbox.
- Tier 0 span: rules checked, matches, nearest miss. Tier 1 span: classifier version, top scores, neighbours, threshold, escalation. Tier 2 span: model, prompt version, rules included, examples retrieved, raw output, validation result, confidence. Action span: what was done in the mailbox and when, or that it went to review.
- Relabel detection by IMAP polling per label folder (default 60 s), CONDSTORE/QRESYNC where supported, UIDVALIDITY stored with full resync on change; identity by `Message-ID`, falling back to a hash of stable headers; state in each message's database row; echo suppression by recording every change Sift makes.
- Interpretation: label swapped = correction (owner label); removed with nothing added = rejection (asked in quick confirm, no training); other label added with Sift's kept = ambiguous (asked, no training); deleted = ignored; Sift's own change = echo (ignored); no change however long = never a confirmation.
- Corrections routed by trace: Tier 0 caused it = suggest rule edit, no retrain; Tier 1 caused it = retrain; Tier 2 caused it = add as retrieval example and to the mailbox's private eval set.
- M1 spike (prerequisite for relabel learning): verify Proton Bridge CONDSTORE/QRESYNC support and `Message-ID` consistency across label folders; the polling fallback must work without either.
- Rejected: learning only from UI corrections; treating unchanged labels as confirmed after N days; pairing removals/additions by time window; writing the trace into the mailbox; flat log lines.
</decisions>

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Mailbox is the isolation unit; RLS keyed on `app.mailbox_id` from M1 (ADR-0001, locked) | Retrofitting isolation later is a rewrite; ADR wins over README "shared"/"synthetic" wording | — Pending |
| Three-tier classification; Tier 1 trains only on owner-confirmed labels (ADR-0002, locked) | Keeps spot checks meaningful: Tier 1 and Tier 2 learn from different sources | — Pending |
| Decision trace for every classification, stored in DB, never in the mailbox (ADR-0003, locked) | Debuggability and replay; trace shape must exist from the first classification | — Pending |
| Relabel learning via IMAP polling, Message-ID identity (ADR-0003, locked) | Works without Bridge-specific features; spike in M1 confirms assumptions | — Pending |
| Scope the current milestone to README M1; M2-M7 are backlog | README roadmap is the only statement of scope; M1 is a self-contained real-inbox proof | — Pending |
| Bridge spike runs early in M1 (Phase 2), before ingest and label application are finalised | Spike findings decide how labels are applied and how message identity is tracked | — Pending |
| M1 Tier 0 rules are hardcoded per mailbox (versioned `rule_set` row with non-null `mailbox_id`) | `rules.md` and the interpretation step are M3; versioning needed for trace replay | — Pending |
| No Tier 1 span in M1 traces; pipeline goes Tier 0 then Tier 2 | Tier 1 is not trained yet; ADR-0002 escalates when Tier 1 is not trained | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? Move to Out of Scope with reason
2. Requirements validated? Move to Validated with phase reference
3. New requirements emerged? Add to Active
4. Decisions to log? Add to Key Decisions
5. "What This Is" still accurate? Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check: still the right priority?
3. Audit Out of Scope: reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-02 after initialization from ingested ADRs and README*
