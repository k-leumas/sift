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
