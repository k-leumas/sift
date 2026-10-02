# Requirements: Sift

**Defined:** 2026-10-02
**Core Value:** Every incoming email is auto-labelled correctly or explicitly held for the owner, entirely on local hardware, and the owner can always see why Sift decided what it did.

Derived from the README roadmap (M1 Classify) and the three locked ADRs. No PRDs or SPECs exist in the ingest set. Wording is "the owner" because Sift has exactly one user.

## v1 Requirements

Current milestone: M1 Classify ("M1 on real inbox"). Each maps to one roadmap phase.

### Foundation

- [ ] **FND-01**: Owner can bring up the stack (Postgres with pgvector, worker) on the home machine with Docker Compose, with migrations applied automatically or by one documented command
- [ ] **FND-02**: Owner can define a mailbox in `config.yaml` (slug, IMAP host/port/username/folder, label mode `proton_labels`) and the model settings (Ollama URL, embedding and LLM model names, Tier 2 confidence threshold); a mailbox's password is read from the environment variable named by `password_env` and is never stored in a config file or the database
- [ ] **FND-03**: The repository has the TypeScript workspace layout the milestone needs (`apps/worker`, `packages/core`, `packages/db`) with Drizzle schema and migrations in `packages/db`

### Isolation

- [ ] **ISO-01**: Every table holding mail-derived data (message, label, decision, folder_sync, label_event, rule_set, and any other added in M1) has a non-null `mailbox_id` foreign key to `mailbox`
- [ ] **ISO-02**: Every such table has an RLS policy keyed on the per-request `app.mailbox_id` setting, RLS is forced for the worker's application role (not the table owner, not a superuser), and a missing setting returns no rows
- [ ] **ISO-03**: An automated test seeds two mailboxes and proves that, under each mailbox's `app.mailbox_id`, reads and writes never touch the other mailbox's rows even with the application-level `WHERE mailbox_id` filter removed
- [ ] **ISO-04**: Application code also filters by `mailbox_id` explicitly (RLS is the backstop, not the only mechanism)

### Bridge Spike

- [ ] **SPK-01**: The way Proton Bridge exposes labels as IMAP folders is documented from a real mailbox: folder naming (`Labels/<name>`), how a label is applied to and removed from a message, and whether a message appears in several folders at once
- [ ] **SPK-02**: CONDSTORE and QRESYNC support (advertised capability and observed behaviour for flag/label changes and deletions) is determined and documented
- [ ] **SPK-03**: `Message-ID` consistency for one message across INBOX and label folders is determined, along with how often it is missing or duplicated, and whether a hash-of-stable-headers fallback is viable
- [ ] **SPK-04**: UIDVALIDITY behaviour across Bridge restarts and resyncs is determined; the spike result is written to a findings document stating which of CONDSTORE/QRESYNC/polling-only the later relabel sync must assume and what Phase 4 label application must do differently, if anything

### Ingest

- [ ] **ING-01**: Worker connects to the configured mailbox through Proton Bridge using the environment-supplied password and reads messages from the configured folder
- [ ] **ING-02**: Each message is stored once in `message` with its `mailbox_id`, IMAP UID, UIDVALIDITY, `Message-ID` (or the fallback hash), headers and body text needed for classification; re-running ingest never creates duplicates
- [ ] **ING-03**: New mail arriving after startup is picked up on a polling interval without restarting the worker
- [ ] **ING-04**: Per-folder sync state (`folder_sync`) records UIDVALIDITY and the last position seen; a UIDVALIDITY change triggers a safe full resync that does not duplicate or re-classify already-stored messages

### Classification

- [ ] **CLS-01**: Tier 0 evaluates a hardcoded, versioned set of exact rules (sender, domain, phrase) for the mailbox deterministically in code; a match yields a category with no LLM call
- [ ] **CLS-02**: When Tier 0 does not match, Tier 2 calls the local LLM through Ollama with a prompt in separated parts: the mailbox's categories and judgment rules (trusted), then the email, fenced off and marked untrusted
- [ ] **CLS-03**: Tier 2 output is constrained by JSON schema to a category from the mailbox's category list, a confidence, and a one-sentence reason; malformed or out-of-category output is retried once, then the message is sent to review
- [ ] **CLS-04**: A Tier 2 result below the confidence threshold (default 0.75) sends the message to review instead of labelling it
- [ ] **CLS-05**: No tier can return a label outside the mailbox's category list, and no tier output can trigger any action other than the single label decision (no tool calls, no invented labels)
- [ ] **CLS-06**: The pipeline processes each ingested message exactly once per rule-set/prompt/model version combination unless explicitly re-run, and a failure in one message (Ollama down, malformed mail) does not stop the others

### Decision Traces

- [ ] **TRC-01**: Every classification writes a `decision` row with one span per tier that ran and a final action span, scoped by `mailbox_id`
- [ ] **TRC-02**: The Tier 0 span records rules checked, matches, and the nearest miss
- [ ] **TRC-03**: The Tier 2 span records model, prompt version, rules included, examples retrieved (empty in M1), the raw model output, the validation result, and the confidence
- [ ] **TRC-04**: The decision records the rule set, prompt and model versions so the decision can be replayed later (rule set and prompt versions are stored as versioned rows, not inferred)
- [ ] **TRC-05**: The owner can retrieve the full trace for any message from the command line or a documented SQL query; nothing from the trace is written into the mailbox

### Actions

- [ ] **ACT-01**: When a decision is confident, Sift applies the category as a label in the mailbox in the way the spike found to work with Proton Bridge (label folder under `Labels/`), and the action span records what was done and when
- [ ] **ACT-02**: Messages sent to review get no label; the action span records that they went to review and why
- [ ] **ACT-03**: Every change Sift makes in the mailbox is recorded in `label_event` so a later sync can ignore Sift's own changes (echo suppression)
- [ ] **ACT-04**: The `label` row records that the label was applied by Sift and not confirmed by the owner, so automatically applied labels can never enter a Tier 1 training set
- [ ] **ACT-05**: Sift never sends, deletes, or forwards mail and never modifies message content; the IMAP operations it issues are limited to reading and applying/removing its own labels

### Security Basics

- [ ] **SEC-01**: Email content (subject, body, headers, attachment names) is treated as untrusted data everywhere: it is only ever placed in the fenced section of a Tier 2 prompt, never in the trusted part, and never interpreted as instructions by Tier 0 or code
- [ ] **SEC-02**: No email content, prompt, or trace is sent anywhere other than the configured model URL; there is no telemetry, analytics, or crash reporting in the worker

### End to End

- [ ] **E2E-01**: One real Proton mailbox, running through Proton Bridge on the target machine, is auto-labelled end to end (Tier 0 exact rules plus Tier 2 local LLM), and a sampled set of the resulting decisions can each be explained from its trace

## v2 Requirements

Later README milestones. Tracked, not in the current roadmap, not yet decomposed into IDs. Each will be refined when its milestone starts.

### M2 Learn

- **LRN-xx**: Review queue with "Why?" traces, one-key labeling
- **LRN-xx**: Tier 1 embedding classifier retrained on every owner label; cold-start thresholds (`min_examples_per_category`); spot checks
- **LRN-xx**: Quick confirm batches; learning from relabels in the mail app (interpretation table, trace-based correction routing)

### M3 Plain-English Rules

- **RUL-xx**: `rules.md`, interpretation step, `rules.lock.yaml`, rules editor, conflict handling for previously confirmed labels

### M4 Evals

- **EVL-xx**: Synthetic inbox, per-tier metrics, model comparison, rule-change preview, `learn-from-tier2` experiment

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
| Tier 1 classifier in M1 | Needs owner-confirmed labels that do not exist until the review queue and quick confirm (M2) |
| Learning from relabels in M1 | Needs the spike result first; implementation is M2 |
| `rules.md` / `rules.lock.yaml` in M1 | Hardcoded Tier 0 rules suffice for the proof; plain-English rules are M3 |
| Sending, deleting, forwarding mail | Security model: Sift only labels (and later drafts) |
| Hosted version | Contradicts local-only promise (ADR-0001 rejected hosted multi-tenant) |
| Multiple users / accounts | One owner by design; ADR-0001 keeps the door open |
| Shared learning across mailboxes | Deferred in ADR-0001; would need explicit off-by-default setting and isolation tests |
| Telemetry, cloud model by default | Privacy promise |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | Phase 1 | Pending |
| FND-02 | Phase 1 | Pending |
| FND-03 | Phase 1 | Pending |
| ISO-01 | Phase 1 | Pending |
| ISO-02 | Phase 1 | Pending |
| ISO-03 | Phase 1 | Pending |
| ISO-04 | Phase 1 | Pending |
| SPK-01 | Phase 2 | Pending |
| SPK-02 | Phase 2 | Pending |
| SPK-03 | Phase 2 | Pending |
| SPK-04 | Phase 2 | Pending |
| ING-01 | Phase 2 | Pending |
| ING-02 | Phase 2 | Pending |
| ING-03 | Phase 2 | Pending |
| ING-04 | Phase 2 | Pending |
| CLS-01 | Phase 3 | Pending |
| CLS-02 | Phase 3 | Pending |
| CLS-03 | Phase 3 | Pending |
| CLS-04 | Phase 3 | Pending |
| CLS-05 | Phase 3 | Pending |
| CLS-06 | Phase 3 | Pending |
| TRC-01 | Phase 3 | Pending |
| TRC-02 | Phase 3 | Pending |
| TRC-03 | Phase 3 | Pending |
| TRC-04 | Phase 3 | Pending |
| SEC-01 | Phase 3 | Pending |
| TRC-05 | Phase 4 | Pending |
| ACT-01 | Phase 4 | Pending |
| ACT-02 | Phase 4 | Pending |
| ACT-03 | Phase 4 | Pending |
| ACT-04 | Phase 4 | Pending |
| ACT-05 | Phase 4 | Pending |
| SEC-02 | Phase 4 | Pending |
| E2E-01 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 34 total
- Mapped to phases: 34
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-02*
*Last updated: 2026-10-02 after roadmap creation*
