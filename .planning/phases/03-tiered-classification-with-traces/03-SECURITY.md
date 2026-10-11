---
phase: "03"
slug: "tiered-classification-with-traces"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-10"
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| owner files -> loader | rules.yaml and config.yaml under SIFT_DATA / config, parsed strictly (size and alias caps, path-safe slugs) | owner config; category names, sender addresses (private) |
| stored email -> prompt | untrusted subject/body/headers rendered inside a per-call 96-bit nonce fence; system message from the rules snapshot only | email content (private, hostile) |
| worker -> local Ollama | HTTP to the configured local model only; preflight refuses cloud (remote_host/remote_model) and missing models; one request at a time | email content (private) |
| model output -> decision | strict JSON schema, exact category enum, no repair, no tools; spans validated before any SQL | model text (untrusted) |
| worker -> Postgres | scoped, RLS + explicit mailbox_id; decision INSERT/SELECT only, rule_set append-only, prompt_version SELECT/INSERT | decisions, traces (private) |
| errors -> logs / mailbox_status | only fixed owner messages, codes, ids and counts; Ollama/IMAP raw text never logged or stored | none by design |
| CLI re-run -> IMAP | read-only EXAMINE/BODY.PEEK refetch, identity-checked against UIDVALIDITY and stored identity key | email body (private) |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-SC (03-01) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages (RESEARCH Package Legitimacy Audit: none) | closed |
| T-03-01 (03-01) | Denial of Service | parseRulesText on a huge file or an alias bomb | medium | mitigate | RULES_FILE_MAX_BYTES (256 KiB) check before parsing; toJS maxAliasCount 50; MAX_RULES and MAX_LIST_ENTRIES caps; tested | closed |
| T-03-02 (03-01) | Information Disclosure | data/ in git | high | mitigate | .gitignore re-includes only data/mailboxes/example/rules.example.yaml; example-rules.test.ts asserts real rules, eval/ and shared-rules.md stay ignored; example addresses limited to example.test | closed |
| T-03-03 (03-01) | Tampering | rulesPathFor building a path from a slug | medium | mitigate | validateSlug before join (slug pattern has no / or .); TypeError on any invalid slug; tested with ../etc | closed |
| T-03-SC (03-02) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-04 (03-02) | Tampering | confidence_threshold outside [0, 1] or as text | medium | mitigate | z.number().min(0).max(1); text, booleans and out-of-range values rejected with the YAML path (E10 config half); tested | closed |
| T-03-05 (03-02) | Denial of Service | a large first backfill on a fresh mailbox | low | mitigate | default lowered to 3 days (D-20); range 0-365 unchanged; explicit values kept | closed |
| T-03-SC (03-03) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-06 (03-03) | Tampering | decision / rule_set rows edited after the fact (trace tampering, broken replay) | high | mitigate | sift_app SELECT, INSERT only on decision and rule_set (0010 revoke + catalog append-only check); 42501 tests | closed |
| T-03-07 (03-03) | Information Disclosure | prompt_version (unscoped) leaking mail across mailboxes | medium | mitigate | Holds only code-derived template text and schema shape (D-29, P2 D-09: rendered prompts are never stored); catalog allowlist entry with reason; 03-05 renders the stored template from placeholders only | closed |
| T-03-08 (03-03) | Tampering | inconsistent decision rows (label without category, review with a label, exact rule sending to review) | high | mitigate | Ten CHECK constraints with explicit NULL handling, tested one by one including NULL-sneak cases | closed |
| T-03-09 (03-03) | Repudiation | a second automatic decision silently replacing the first | medium | mitigate | Partial unique index decision_one_worker_per_message (23505); rerun rows append, never overwrite | closed |
| T-03-SC (03-04) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-10 (03-04) | Spoofing | display-name, Reply-To or look-alike domains triggering an owner rule | high | mitigate | From address and From domain only; label-boundary domain suffix match; E9 table cases for each spoof | closed |
| T-03-11 (03-04) | Denial of Service | ReDoS through rule or mail text | medium | mitigate | No RegExp built from data; only fixed linear patterns; `grep -c "new RegExp"` acceptance check | closed |
| T-03-12 (03-04) | Tampering | a decision whose outcome, category and spans disagree | high | mitigate | decide() is the single assembler, parses spans with the shared schema; database checks (03-03) back it up | closed |
| T-03-49 (03-04) | Spoofing | a sender quoting the owner's phrase to trigger a phrase rule | low | accept | Phrase rules match email text by design (AI-SPEC E9 "accepted"); the trace names the matching rule, so it stays visible | closed |
| T-03-SC (03-05) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-13 (03-05) | Tampering / Elevation of Privilege | fence escape, CR/LF field forgery, fake markers, role lines in email text | high | mitigate | Per-call 96-bit nonce markers; renderUser throws on a nonce collision; one-line capped headers with control characters stripped; system message built only from the snapshot; sentinel tests per field (E3) | closed |
| T-03-14 (03-05) | Tampering | model answer outside the list or out of range accepted | critical | mitigate | Strict Zod re-validation after the grammar; exact enum comparison, no repair; confidence range checked in code (the grammar does not enforce it); 20+ case matrix | closed |
| T-03-15 (03-05) | Information Disclosure | rendered prompt (email text) persisted in traces | medium | mitigate | spans schema has no field for the rendered prompt; the nonce and versions allow re-rendering; test asserts no body sentinel or marker line in a built span | closed |
| T-03-16 (03-05) | Tampering | a silent prompt change that keeps an old prompt_version | medium | mitigate | promptMaterial hashes template, retry notes, options, flags, limits and schema shape; pinned hash test fails on any change | closed |
| T-03-SC (03-06) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-17 (03-06) | Information Disclosure | candidates query reading another mailbox's mail | high | mitigate | mailbox_id filter on message, location, body and decision subqueries in SQL plus forced RLS; ISO-04 test on an RLS-bypassing handle | closed |
| T-03-18 (03-06) | Tampering | malformed or inconsistent decision rows | high | mitigate | recordDecision parses spans with the shared schema and checks typed-column consistency before SQL; database checks (03-03) as backstop | closed |
| T-03-19 (03-06) | Denial of Service | concurrent first use of prompt_version (unique violation or two versions) | medium | mitigate | pg_advisory_xact_lock(815309003) + select-then-insert in one transaction; five-way concurrency test | closed |
| T-03-20 (03-06) | Information Disclosure | bodies kept longer than policy through re-runs | medium | mitigate | expires_at set only where null (first decision); test that a re-run leaves it unchanged; restoreBody and storeMessages give a body written for an already-decided message expires_at = write time + 7 days (CR-02, 03-14); tests: classify-refetch.test.ts refetch-then-outage case, classify.test.ts and ingest.test.ts CR-02 cases | closed |
| T-03-SC (03-07) | Tampering | npm/pip/cargo installs | low | accept | No new dependency: Node fetch, no Ollama SDK (AI-SPEC §2); dependencies.test.ts unchanged | closed |
| T-03-21 (03-07) | Information Disclosure | email text sent to a cloud model through Ollama | critical | mitigate | Preflight refuses tags entries with remote_host/remote_model before any chat call; tested | closed |
| T-03-22 (03-07) | Elevation of Privilege | model output causing actions (tool calls, extra keys) | critical | mitigate | No tools key in any request; only validated message.content is read; tool_calls and extra-key cases tested | closed |
| T-03-23 (03-07) | Tampering | silent prompt truncation dropping the trusted part | high | mitigate | truncate: false and shift: false on every request; context-length 400 and the prompt_eval_count check both become review input_too_long | closed |
| T-03-24 (03-07) | Denial of Service | parallel requests timing out and pushing mailboxes into backoff | medium | mitigate | Process-wide FIFO single-flight gate (D-19); maxInFlight test | closed |
| T-03-25 (03-07) | Information Disclosure | Ollama error text (which can quote the prompt) logged | high | mitigate | errorText capped and kept in the result's detail only; the client never logs; 03-08/03-10 never log or store detail (leak test in 03-10) | closed |
| T-03-SC (03-08) | Tampering | npm/pip/cargo installs | low | accept | No new dependency (postal-mime is already approved) | closed |
| T-03-26 (03-08) | Information Disclosure | email text, model reason or Ollama error text in logs | high | mitigate | Pass logs only slug, ids, counts and codes (codedCause); infraOwnerMessage never includes `detail` beyond a bare code; log-scan case in Task 2 | closed |
| T-03-27 (03-08) | Denial of Service | backlog starving new mail; a stuck message looping every chunk | medium | mitigate | Newest-first keyset cursor, 25-call cap, 500-examined cap, 5-message chunks; tested | closed |
| T-03-28 (03-08) | Denial of Service | one failing message stopping its mailbox | high | mitigate | Per-message try/catch; input_too_long is a review, never infra; five consecutive failures stop only that pass; tested | closed |
| T-03-29 (03-08) | Tampering | worker and CLI writing decisions for one mailbox at once | medium | mitigate | withIngestLock per chunk (busy -> no writes); partial unique index backs worker uniqueness (03-03) | closed |
| T-03-30 (03-08) | Repudiation | a decision that cannot be explained or replayed | high | mitigate | expectReplayableDecision in every decision-writing test; spans validated on write (03-06) | closed |
| T-03-SC (03-09) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-31 (03-09) | Information Disclosure | email text or Ollama error text in last_error | high | mitigate | Only rulesProblemMessage / infraOwnerMessage templates reach recordSyncError (secrets still redacted, 1000-char cap); sentinel case in Task 2 | closed |
| T-03-32 (03-09) | Denial of Service | a bad rules.yaml slowing ingest through backoff | medium | mitigate | rules_invalid resolves runBatch (no backoff); ingest cadence unchanged; tested | closed |
| T-03-33 (03-09) | Denial of Service | one mailbox's Ollama failure or volume hold affecting another mailbox | medium | mitigate | Per-mailbox outcome and status; shared gate only serialises requests; cross-mailbox cases tested | closed |
| T-03-34 (03-09) | Spoofing (misleading state) | an outage shown as connecting, or needs_attention overwritten so resume fails | medium | mitigate | ClassifyInfraError handled before the grace logic; held mailboxes are not classified; tested | closed |
| T-03-35 (03-09) | Denial of Service | concurrent Ollama requests across mailboxes timing out | medium | mitigate | One createSingleFlight() gate per worker process shared by all batches (D-19); maxInFlight test | closed |
| T-03-SC (03-10) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages; dependencies.test.ts unchanged and run | closed |
| T-03-36 (03-10) | Tampering / Elevation of Privilege | prompt injection through any email field | high | mitigate | Wire-level fence checks for 13 hostile fixtures; system message and fixed text identical across emails | closed |
| T-03-37 (03-10) | Tampering | in-list steering by an injected instruction | high | accept | Residual risk accepted for Phase 3 (AI-SPEC §6): bounded to an allowed category, action stays pending (no visible effect); live flip count recorded in the 03-13 baseline; Phase 4 must decide before applying labels | closed |
| T-03-38 (03-10) | Elevation of Privilege | model output causing actions | critical | mitigate | E2 cases (tool_calls, action key, forward/delete reason): one decision only, no label/label_event rows, no tools key, read-only IMAP guard | closed |
| T-03-39 (03-10) | Information Disclosure | mail text in logs or last_error | high | mitigate | Sentinel scan across normal, invalid, outage and remote-model runs with a positive control | closed |
| T-03-40 (03-10) | Information Disclosure | requests to another origin or a cloud model | critical | mitigate | Recording fetch asserts one origin; remote model refused before chat; hermeticity guard keeps tests off the real Ollama | closed |
| T-03-SC (03-11) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-41 (03-11) | Tampering | containers modifying the owner's rules files | medium | mitigate | :ro mounts on worker and setup (asserted by compose.test.ts); no code path writes under SIFT_DATA | closed |
| T-03-42 (03-11) | Tampering | path traversal through a slug in rename or config check | medium | mitigate | rulesPathFor validates the slug first (03-01); invalid new slugs never reach the filesystem check | closed |
| T-03-43 (03-11) | Denial of Service | a bad rules.yaml stopping setup and therefore the whole stack | medium | mitigate | setup and --schema-only never read rules files (setup.ts untouched; schema-only test with no data directory) | closed |
| T-03-SC (03-12) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages | closed |
| T-03-44 (03-12) | Tampering | a refetched body attached to the wrong message (UID reuse after UIDVALIDITY change) | high | mitigate | Location must match the current UIDVALIDITY; identity key re-derived with parseMessage and compared; mismatch skipped; tested | closed |
| T-03-45 (03-12) | Tampering | CLI and worker classifying one mailbox at once | medium | mitigate | Every chunk under withIngestLock; bounded wait then refusal; tested | closed |
| T-03-46 (03-12) | Denial of Service | an accidental `--since` over years of mail flooding Ollama | low | mitigate | Count shown and confirmation above 20 (or --yes); Ctrl-C stops between messages | closed |
| T-03-47 (03-12) | Information Disclosure | mail text in CLI output or errors | medium | mitigate | Output is counts, ids and fixed templates; stderr redacted with the database URL; IMAP errors mapped to fixed lines; output scan in Task 2 | closed |
| T-03-SC (03-13) | Tampering | npm/pip/cargo installs | low | accept | This plan installs no packages; postal-mime is already approved | closed |
| T-03-50 (03-13) | Information Disclosure | real mail pasted into the committed verification | medium | mitigate | The runner reads only committed synthetic fixtures; instructions say synthetic data only; table holds categories, numbers and the model digest | closed |
| T-03-51 (03-13) | Information Disclosure | the runner sending fixtures to a cloud model | low | mitigate | createPreflight refuses remote_host/remote_model entries; no default URL | closed |
| T-03-52 (03-13) | Tampering | owner commands that break the shell (heredocs) or mislead | low | mitigate | Single-line commands with exact expected output (owner preference); doc test pins them | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Evidence (file:line and tests) for every row is in the gsd-security-auditor verdict of 2026-10-10; key files: apps/worker/src/classify/{run,ollama-client,preflight,llm-tier,refetch}.ts, packages/core/src/classify/*, packages/db/src/{classify,prompt-version,scope,status}.ts, migrations 0004/0009/0010, and apps/worker/test/classify-{leak,injection,run,batch,hermetic}.test.ts.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-SC (all 13 plans) | No new dependency in Phase 3 (Node fetch, no Ollama SDK; postal-mime already approved); pnpm-lock and package manifests unchanged except packages/core exports | plan-time threat model; verified by auditor | 2026-10-10 |
| AR-03-02 | T-03-49 | An exact rule an owner writes can mislabel mail; owner-authored, named in the trace (AI-SPEC: "Accepted, not a defect") | plan-time threat model (03-04) | 2026-10-10 |
| AR-03-03 | T-03-37 | A compromised or steered model can still pick a wrong but allowed category (e.g. bank notice -> Noise). Phase 3 applies no labels; flip count recorded by the live baseline. Phase 4 must decide before labels are applied (AI-SPEC §6) | plan-time threat model (03-10); owner decision deferred to Phase 4 | 2026-10-10 |

*Accepted risks do not resurface in future audit runs.*

### Open owner decisions (not register threats)

- A message that makes Ollama return HTTP 500 every time is treated as infra: the mailbox backs off every batch and older LLM-bound mail is blocked. Availability, not confidentiality; tracked for a possible gap-closure plan.

### Auditor notes (informational)

- T-03-27: the 500-messages-examined cap is in code but has no test.
- T-03-33: outage and volume-hold isolation are tested with one mailbox each; isolation rests on per-mailbox state.
- T-03-30: worker-classify.test.ts (spawned worker) does not call expectReplayableDecision; writes still pass recordDecision validation.
- The CLI `sift classify` has its own single-flight gate, so worker and CLI can each have one Ollama request in flight (matches T-03-24 / D-19 as written).

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-10 | 64 | 64 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-10

## Security Audit 2026-10-11

| Metric | Count |
|---|---|
| Threats found | 64 |
| Closed | 63 |
| Open | 1 |
