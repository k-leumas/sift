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
