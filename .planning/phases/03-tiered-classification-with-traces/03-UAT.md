---
status: complete
phase: 03-tiered-classification-with-traces
source: [03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md, 03-06-SUMMARY.md, 03-07-SUMMARY.md, 03-08-SUMMARY.md, 03-09-SUMMARY.md, 03-10-SUMMARY.md, 03-11-SUMMARY.md, 03-12-SUMMARY.md, 03-13-SUMMARY.md, 03-14-SUMMARY.md, 03-15-SUMMARY.md, 03-16-SUMMARY.md, 03-17-SUMMARY.md, 03-18-SUMMARY.md, 03-19-SUMMARY.md, 03-20-SUMMARY.md, 03-21-SUMMARY.md, 03-22-SUMMARY.md]
started: 2026-10-12T06:09:37Z
updated: 2026-10-13T18:17:58.000Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From the repository root run `COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh --down` with `SMOKE_ALLOW_VOLUME_REMOVAL=yes`. It uses its own volume and files and never touches sift-pgdata. The image builds, setup exits 0 after applying every migration up to 0011_decision_llm_error_reason, the worker turns healthy, every enabled mailbox has a status row, and the script exits 0.
result: pass

### 2. Live LLM baseline on synthetic data (03-13 D6, CLS-02)
expected: With Ollama running on the host and qwen3:1.7b pulled, `node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b` prints a Markdown table with the header `| fixture | category | confidence | attempts | thinking null | total_ms | flip | model digest |`, exactly 10 data rows, `yes` in every thinking-null cell, one model digest throughout, and a last line `flips: <n>`. A non-zero flip count is the accepted Phase 3 residual. Paste the output into the reply so it can go into VERIFICATION.
result: issue
reported: "the command doesn't yeild anything on my computer"
severity: minor
note: "Run from the sift repo root on 2026-10-12, the runner printed a valid table (10 rows, thinking null yes, one digest, flips: 3) after about 4 minutes. It prints nothing until every call has finished, so it looks hung."

### 3. Real stack reads rules files through the mount (03-11 D5)
expected: With data/mailboxes/<slug>/rules.yaml in place for each mailbox, `docker compose run --rm --no-deps worker sift config check` prints `Config OK: <n> mailboxes (<slugs>); password env vars present; rules files valid`. Breaking one rules file (for example a misspelled key) instead prints that file's path with line:column and exits non-zero.
result: pass

### 4. D-16 clarification wording (03-17 D6)
expected: 03-CONTEXT.md's note 'Clarified by gap closure 03-17' and the AI-SPEC rows say: a 5xx or timeout followed by a healthy re-probe skips only that message for the pass (at most 2 per pass); a failed re-probe, a third failure, or any other infra code is still an outage. You accepted this at the 03-19 checkpoint; confirm it still reads as you meant it.
result: skipped
reason: "Owner skipped; already accepted the 03-17 D-16 clarification at the 03-19 checkpoint (2026-10-11)"

### 5. TRC-06 classifier slot stays fixed for M2 (03-05 D5)
expected: A trace printed by `sift classify` (or the documented SQL) shows the classifier span at index 1, marked skipped with 'not trained', between the rules span and the LLM span, so M2 can fill it without changing the layout. Judge whether that position and wording look right for M2.
result: pass

### 6. rules.example.yaml wording and README vocabulary (03-01 D5)
expected: data/mailboxes/example/rules.example.yaml and the README rules section read clearly to a non-technical owner: plain words for from/domain/phrase rules and categories, nothing that needs code knowledge to follow.
result: pass

### 7. config.example.yaml comments (03-02 D6)
expected: The new comments in config/config.example.yaml (models.url, models.llm, classification settings) and the matching README lines say in plain words what each setting does and what to change.
result: pass

### 8. README quick start and classify docs (03-13 D7)
expected: The README's 12-step quick start (rules file, ollama pull, then up -d and sift config check) uses single-line commands in owner language, and nothing claims that labels already show up in Proton.
result: issue
reported: "that this is hard to find is a real problem... i see no 12 step numbered list"
severity: major

### 9. README llm_error review bullet (03-20 D6, CLS-06)
expected: The README mailbox-list bullet says that after three such passes, if Ollama answers a mail-free test request, the message is held for review with the reason llm_error, and that an outage never puts a message in review. The wording is clear to you.
result: pass

### 10. README notice and skip lines (03-22 D3, CLS-06)
expected: The README explains the 'ok; <notice>' line in `sift mailbox list`, the three-pass hold-back that lasts until a restart, and the `sift classify` skip line, clearly enough that you would know what to do when you saw each one.
result: pass
note: "Judged on README.md:91 and :249; the three-pass hold-back until restart (03-22 wording) was replaced by the llm_error review (03-20) and is not in the README"

### 11. 03-01 D1: rules.yaml loads through a strict schema; every problem reported once, in file order, with path and line:column
expected: rules.yaml loads through a strict schema; every problem reported once, in file order, with path and line:column
result: pass
source: automated
coverage_id: 03-01-D1

### 12. 03-01 D2: config.yaml loading unchanged after the helper move to yaml-issues.ts
expected: config.yaml loading unchanged after the helper move to yaml-issues.ts
result: pass
source: automated
coverage_id: 03-01-D2

### 13. 03-01 D3: resolveDataPath (SIFT_DATA) and rulesPathFor refusing invalid slugs
expected: resolveDataPath (SIFT_DATA) and rulesPathFor refusing invalid slugs
result: pass
source: automated
coverage_id: 03-01-D3

### 14. 03-01 D4: Example rules file committed, parsed with the real schema, example.test addresses only; real rules/eval/shared-rules/data ignored
expected: Example rules file committed, parsed with the real schema, example.test addresses only; real rules/eval/shared-rules/data ignored
result: pass
source: automated
coverage_id: 03-01-D4

### 15. 03-02 D1: tiers.llm.confidence_threshold defaults to 0.75 with no tiers key, tiers: {} and tiers: { llm: {} } (CLS-04 empty edge)
expected: tiers.llm.confidence_threshold defaults to 0.75 with no tiers key, tiers: {} and tiers: { llm: {} } (CLS-04 empty edge)
result: pass
source: automated
coverage_id: 03-02-D1

### 16. 03-02 D2: Threshold accepts 0, 0.75, 0.9, 1; rejects -0.01, 1.01, \"0.9\", true at tiers.llm.confidence_threshold with line:column; classifier/examples_per_prompt unrecognized; non-mapping tiers/llm rejected
expected: Threshold accepts 0, 0.75, 0.9, 1; rejects -0.01, 1.01, \"0.9\", true at tiers.llm.confidence_threshold with line:column; classifier/examples_per_prompt unrecognized; non-mapping tiers/llm rejected
result: pass
source: automated
coverage_id: 03-02-D2

### 17. 03-02 D3: First-sync backfill defaults to 3 days (absent or empty ingest); explicit 30 and 0 kept
expected: First-sync backfill defaults to 3 days (absent or empty ingest); explicit 30 and 0 kept
result: pass
source: automated
coverage_id: 03-02-D3

### 18. 03-02 D4: Example config: 3 days on both mailboxes, active tiers.llm.confidence_threshold 0.75, passes sift config check --schema-only
expected: Example config: 3 days on both mailboxes, active tiers.llm.confidence_threshold 0.75, passes sift config check --schema-only
result: pass
source: automated
coverage_id: 03-02-D4

### 19. 03-02 D5: README Technical settings YAML has the active tiers.llm block and still loads; no '30 days'/'30-day' left
expected: README Technical settings YAML has the active tiers.llm block and still loads; no '30 days'/'30-day' left
result: pass
source: automated
coverage_id: 03-02-D5

### 20. 03-03 D1: decision carries the D-27 typed trace columns and a spans array; inconsistent rows are refused with 23514 per check, including the NULL-sneak cases
expected: decision carries the D-27 typed trace columns and a spans array; inconsistent rows are refused with 23514 per check, including the NULL-sneak cases
result: pass
source: automated
coverage_id: 03-03-D1

### 21. 03-03 D2: At most one worker decision per message (23505 decision_one_worker_per_message); rerun rows append next to it
expected: At most one worker decision per message (23505 decision_one_worker_per_message); rerun rows append next to it
result: pass
source: automated
coverage_id: 03-03-D2

### 22. 03-03 D3: rule_set and prompt_version are versioned rows decisions reference by FK; both append-only for sift_app; prompt_version allowlisted in the catalog gate
expected: rule_set and prompt_version are versioned rows decisions reference by FK; both append-only for sift_app; prompt_version allowlisted in the catalog gate
result: pass
source: automated
coverage_id: 03-03-D3

### 23. 03-03 D4: Migration 0008 refuses a database with decision or rule_set rows and applies nothing; an empty one migrates
expected: Migration 0008 refuses a database with decision or rule_set rows and applies nothing; an empty one migrates
result: pass
source: automated
coverage_id: 03-03-D4

### 24. 03-03 D5: Every packages/db test passes on the new schema; pnpm db:generate reports no schema changes
expected: Every packages/db test passes on the new schema; pnpm db:generate reports no schema changes
result: pass
source: automated
coverage_id: 03-03-D5

### 25. 03-04 D1: Deterministic exact-rule matcher: From address/domain only, label-boundary subdomains, literal NFKC phrases, AND/OR, every match listed, first wins, nearest miss (E9 Set A)
expected: Deterministic exact-rule matcher: From address/domain only, label-boundary subdomains, literal NFKC phrases, AND/OR, every match listed, first wins, nearest miss (E9 Set A)
result: pass
source: automated
coverage_id: 03-04-D1

### 26. 03-04 D2: exact_rules span contents: rules_checked, matches, winner, nearest miss with per-condition results; byte-identical across runs
expected: exact_rules span contents: rules_checked, matches, winner, nearest miss with per-condition results; byte-identical across runs
result: pass
source: automated
coverage_id: 03-04-D2

### 27. 03-04 D3: No pattern built from rule or mail text (T-03-11): source scan plus a hostile pattern-like phrase over 30,000-char mail
expected: No pattern built from rule or mail text (T-03-11): source scan plus a hostile pattern-like phrase over 30,000-char mail
result: pass
source: automated
coverage_id: 03-04-D3

### 28. 03-04 D4: decide() threshold and review logic: 0.7499/0.75, 0/1, 0.89/0.9, 0 at 0; invalid_output, out_of_category, input_too_long; RangeError on bad threshold
expected: decide() threshold and review logic: 0.7499/0.75, 0/1, 0.89/0.9, 0 at 0; invalid_output, out_of_category, input_too_long; RangeError on bad threshold
result: pass
source: automated
coverage_id: 03-04-D4

### 29. 03-04 D5: One draft per call, spans in the fixed order with the classifier span skipped at index 1 and an action intent consistent with the outcome
expected: One draft per call, spans in the fixed order with the classifier span skipped at index 1 and an action intent consistent with the outcome
result: pass
source: automated
coverage_id: 03-04-D5

### 30. 03-04 D6: Classifier span always present and skipped at index 1 in every draft built here
expected: Classifier span always present and skipped at index 1 in every draft built here
result: pass
source: automated
coverage_id: 03-04-D6

### 31. 03-04 D7: Rule-set content hash: formatting-only YAML variants keep it, any change in meaning alters it; snapshot is plain JSON
expected: Rule-set content hash: formatting-only YAML variants keep it, any change in meaning alters it; snapshot is plain JSON
result: pass
source: automated
coverage_id: 03-04-D7

### 32. 03-05 D1: Trusted/untrusted prompt split with a nonce fence; every email field provably inside the fence, system message byte-identical across emails (E3, E14 inclusion)
expected: Trusted/untrusted prompt split with a nonce fence; every email field provably inside the fence, system message byte-identical across emails (E3, E14 inclusion)
result: pass
source: automated
coverage_id: 03-05-D1

### 33. 03-05 D2: SEC-01 render-level edges: CR/LF/NUL field forgery blocked, 300-char headers, nonce collision throws, empty email, surrogate-safe 4,000-char body cut
expected: SEC-01 render-level edges: CR/LF/NUL field forgery blocked, 300-char headers, nonce collision throws, empty email, surrogate-safe 4,000-char body cut
result: pass
source: automated
coverage_id: 03-05-D2

### 34. 03-05 D3: Output schema, verified Ollama format and re-validation matrix without repair (adjacency, empty, encoding, ordering edges)
expected: Output schema, verified Ollama format and re-validation matrix without repair (adjacency, empty, encoding, ordering edges)
result: pass
source: automated
coverage_id: 03-05-D3

### 35. 03-05 D4: decision.spans schema: two fixed layouts, classifier span always at index 1, strict objects, 23 rejection cases
expected: decision.spans schema: two fixed layouts, classifier span always at index 1, strict objects, 23 rejection cases
result: pass
source: automated
coverage_id: 03-05-D4

### 36. 03-05 D6: Category-independent prompt_version hash, pinned, sensitive to every hashed part
expected: Category-independent prompt_version hash, pinned, sensitive to every hashed part
result: pass
source: automated
coverage_id: 03-05-D6

### 37. 03-06 D1: Pending selection: eligible, live, undecided messages of the scope's mailbox, newest first with id tie-break, keyset paged; historical and vanished mail excluded
expected: Pending selection: eligible, live, undecided messages of the scope's mailbox, newest first with id tie-break, keyset paged; historical and vanished mail excluded
result: pass
source: automated
coverage_id: 03-06-D1

### 38. 03-06 D2: Re-run selection by messageIds or since, decided flagged, body null when the body row is gone; empty id list and bad limits refused without SQL
expected: Re-run selection by messageIds or since, decided flagged, body null when the body row is gone; empty id list and bad limits refused without SQL
result: pass
source: automated
coverage_id: 03-06-D2

### 39. 03-06 D3: ISO-04: candidates on an RLS-bypassing superuser handle returns only the scope's mailbox rows
expected: ISO-04: candidates on an RLS-bypassing superuser handle returns only the scope's mailbox rows
result: pass
source: automated
coverage_id: 03-06-D3

### 40. 03-06 D4: recordDecision is the single validated write path: malformed or inconsistent drafts and llm decisions without a prompt version refused before SQL; one worker decision per message (23505), reruns append; first decision sets body expiry +7 days, reruns never move it
expected: recordDecision is the single validated write path: malformed or inconsistent drafts and llm decisions without a prompt version refused before SQL; one worker decision per message (23505), reruns append; first decision sets body expiry +7 days, reruns never move it
result: pass
source: automated
coverage_id: 03-06-D4

### 41. 03-06 D5: Versioned rows on first use: rule_set 1, 2, 3 per mailbox; prompt_version one row under five concurrent first calls, next version per new hash, waits on lock 815309003; exact decisions store prompt_version_id and model null
expected: Versioned rows on first use: rule_set 1, 2, 3 per mailbox; prompt_version one row under five concurrent first calls, next version per new hash, waits on lock 815309003; exact decisions store prompt_version_id and model null
result: pass
source: automated
coverage_id: 03-06-D5

### 42. 03-06 D6: Every REVIEW_REASONS value accepted by the database, an unknown one refused with 23514; latestDecision by created_at then id; restoreBody once with NUL stripped and expiry null
expected: Every REVIEW_REASONS value accepted by the database, an unknown one refused with 23514; latestDecision by created_at then id; restoreBody once with NUL stripped and expiry null
result: pass
source: automated
coverage_id: 03-06-D6

### 43. 03-07 D1: Every /api/chat request is exactly the E11 request: stream, think, truncate, shift false, keep_alive 30m, the four options, the snapshot's format, two messages, no tools key
expected: Every /api/chat request is exactly the E11 request: stream, think, truncate, shift false, keep_alive 30m, the four options, the snapshot's format, two messages, no tools key
result: pass
source: automated
coverage_id: 03-07-D1

### 44. 03-07 D2: Retry once only for invalid output; 34 scripted bad answers end as review out_of_category or invalid_output, the second attempt differs only by nonce and retry note; never a third call
expected: Retry once only for invalid output; 34 scripted bad answers end as review out_of_category or invalid_output, the second attempt differs only by nonce and retry note; never a third call
result: pass
source: automated
coverage_id: 03-07-D2

### 45. 03-07 D3: Only validated message.content counts: tool_calls, extra keys and thinking never change the verdict; empty content and {} end as review invalid_output (CLS-05 empty edge)
expected: Only validated message.content counts: tool_calls, extra keys and thinking never change the verdict; empty content and {} end as review invalid_output (CLS-05 empty edge)
result: pass
source: automated
coverage_id: 03-07-D3

### 46. 03-07 D4: input_too_long (context 400 or prompt_eval_count >= 7936) is review after one call; infra on either attempt and shutdown give no verdict
expected: input_too_long (context 400 or prompt_eval_count >= 7936) is review after one call; infra on either attempt and shutdown give no verdict
result: pass
source: automated
coverage_id: 03-07-D4

### 47. 03-07 D5: Client classifies every transport outcome at the wire: unreachable (refused, DNS), timeout, 404, 429, 503, 500, other 400, non-chat 200, reset mid-body, abort
expected: Client classifies every transport outcome at the wire: unreachable (refused, DNS), timeout, 404, 429, 503, 500, other 400, non-chat 200, reset mid-body, abort
result: pass
source: automated
coverage_id: 03-07-D5

### 48. 03-07 D6: A compromised model can only pick an in-list category (labelled) or end in review; the fenced prompt keeps email text out of the system message
expected: A compromised model can only pick an in-list category (labelled) or end in review; the fenced prompt keeps email text out of the system message
result: pass
source: automated
coverage_id: 03-07-D6

### 49. 03-07 D7: Preflight fails closed before any chat call on missing, remote (remote_host / remote_model) or non-completion models and returns version and digest on success
expected: Preflight fails closed before any chat call on missing, remote (remote_host / remote_model) or non-completion models and returns version and digest on success
result: pass
source: automated
coverage_id: 03-07-D7

### 50. 03-07 D8: FIFO single-flight gate: s1,e1,s2,e2,s3,e3 order; gated chats and preflights never overlap at the fake (maxInFlight 1, ungated positive control > 1)
expected: FIFO single-flight gate: s1,e1,s2,e2,s3,e3 order; gated chats and preflights never overlap at the fake (maxInFlight 1, ungated positive control > 1)
result: pass
source: automated
coverage_id: 03-07-D8

### 51. 03-08 D1: Exact-rule match decides labelled with no Ollama request; other mail goes to the LLM after one preflight; a second pass writes nothing (CLS-01, CLS-02, D-15)
expected: Exact-rule match decides labelled with no Ollama request; other mail goes to the LLM after one preflight; a second pass writes nothing (CLS-01, CLS-02, D-15)
result: pass
source: automated
coverage_id: 03-08-D1

### 52. 03-08 D2: 26 LLM-bound messages: exactly 25 calls newest first, exact rules continue past the cap, the oldest stays pending until the next pass; same-date messages decided once across chunks; empty pass makes no request and no rule_set (D-14, D-18, E6)
expected: 26 LLM-bound messages: exactly 25 calls newest first, exact rules continue past the cap, the oldest stays pending until the next pass; same-date messages decided once across chunks; empty pass makes no request and no rule_set (D-14, D-18, E6)
result: pass
source: automated
coverage_id: 03-08-D2

### 53. 03-08 D3: Outages (unreachable, model_missing, remote_model, a mid-pass 500) write no decision for LLM-bound mail, make no further call, still write exact-rule decisions and recover next pass (D-16, E5)
expected: Outages (unreachable, model_missing, remote_model, a mid-pass 500) write no decision for LLM-bound mail, make no further call, still write exact-rule decisions and recover next pass (D-16, E5)
result: pass
source: automated
coverage_id: 03-08-D3

### 54. 03-08 D4: input_too_long and invalid output are local reviews; a throwing message is skipped and logged by id and code only; five in a row stop the pass; shutdown aborts with no decision
expected: input_too_long and invalid output are local reviews; a throwing message is skipped and logged by id and code only; five in a row stop the pass; shutdown aborts with no decision
result: pass
source: automated
coverage_id: 03-08-D4

### 55. 03-08 D5: Missing or invalid rules.yaml is rules_invalid naming the file and each problem's line and YAML path (first 5, then 'and N more'); a rules edit never re-classifies and the next decision uses rule_set v2; a held lock returns busy (D-05, D-15, D-17)
expected: Missing or invalid rules.yaml is rules_invalid naming the file and each problem's line and YAML path (first 5, then 'and N more'); a rules edit never re-classifies and the next decision uses rule_set v2; a held lock returns busy (D-05, D-15, D-17)
result: pass
source: automated
coverage_id: 03-08-D5

### 56. 03-08 D6: Pass logs carry slug, ids, counts and codes only: no subject, body, model reason, Ollama error text or fence marker (SEC-01, T-03-26)
expected: Pass logs carry slug, ids, counts and codes only: no subject, body, model reason, Ollama error text or fence marker (SEC-01, T-03-26)
result: pass
source: automated
coverage_id: 03-08-D6

### 57. 03-08 D7: Eight decision paths each pass expectReplayableDecision (spans, FKs, prompt hash, raw = fake answer, byte-exact re-render) with columns matching spans, full llm span context (categories, judgment, digest, version, threshold) and body expiry = decision + 7 days (E8, E10, E14, TRC-01/03/04)
expected: Eight decision paths each pass expectReplayableDecision (spans, FKs, prompt hash, raw = fake answer, byte-exact re-render) with columns matching spans, full llm span context (categories, judgment, digest, version, threshold) and body expiry = decision + 7 days (E8, E10, E14, TRC-01/03/04)
result: pass
source: automated
coverage_id: 03-08-D7

### 58. 03-08 D8: E1 invariant: 0 labelled decisions outside their own rule_set snapshot across the test database, with a positive control showing the query counts a violation
expected: E1 invariant: 0 labelled decisions outside their own rule_set snapshot across the test database, with a positive control showing the query counts a violation
result: pass
source: automated
coverage_id: 03-08-D8

### 59. 03-08 D9: The shared worker test harness points models.url at http://ollama.invalid; the full worker suite still passes (749/749)
expected: The shared worker test harness points models.url at http://ollama.invalid; the full worker suite still passes (749/749)
result: pass
source: automated
coverage_id: 03-08-D9

### 60. 03-09 D1: After a successful ingest, runBatch classifies the new mail in the same batch (exact rule with no chat request, the other through the fake), every decision replays, and status is ok with last_sync_at set (D-14)
expected: After a successful ingest, runBatch classifies the new mail in the same batch (exact rule with no chat request, the other through the fake), every decision replays, and status is ok with last_sync_at set (D-14)
result: pass
source: automated
coverage_id: 03-09-D1

### 61. 03-09 D2: A broken or missing rules.yaml resolves the batch; status is error naming the file, the YAML path and sift config check, with last_sync_at set; another mailbox is classified and stays ok (D-05)
expected: A broken or missing rules.yaml resolves the batch; status is error naming the file, the YAML path and sift config check, with last_sync_at set; another mailbox is classified and stays ok (D-05)
result: pass
source: automated
coverage_id: 03-09-D2

### 62. 03-09 D3: Ollama stopped: runBatch rejects with ClassifyInfraError unreachable, status error 'Ollama unreachable at <origin> (ECONNREFUSED)' inside the startup grace (never connecting), exact-rule mail decided, LLM mail pending; restarted: next batch ok and the pending mail decided. Missing model names ollama pull; a 500 stores a fixed message (D-16, E5)
expected: Ollama stopped: runBatch rejects with ClassifyInfraError unreachable, status error 'Ollama unreachable at <origin> (ECONNREFUSED)' inside the startup grace (never connecting), exact-rule mail decided, LLM mail pending; restarted: next batch ok and the pending mail decided. Missing model names ollama pull; a 500 stores a fixed message (D-16, E5)
result: pass
source: automated
coverage_id: 03-09-D3

### 63. 03-09 D4: A mailbox held by the volume valve is not classified, stays needs_attention and sends nothing to Ollama; after resume the next batch stores and classifies the mail
expected: A mailbox held by the volume valve is not classified, stays needs_attention and sends nothing to Ollama; after resume the next batch stores and classifies the mail
result: pass
source: automated
coverage_id: 03-09-D4

### 64. 03-09 D5: Two mailboxes running at once with one shared runtime are both classified with fake.maxInFlight() 1 (D-19, E6)
expected: Two mailboxes running at once with one shared runtime are both classified with fake.maxInFlight() 1 (D-19, E6)
result: pass
source: automated
coverage_id: 03-09-D5

### 65. 03-09 D6: Shutdown during a hung Ollama call resolves the batch with no decision and no error status; last_error and logs never carry mail text or Ollama's error text (T-03-31)
expected: Shutdown during a hung Ollama call resolves the batch with no decision and no error status; last_error and logs never carry mail text or Ollama's error text (T-03-31)
result: pass
source: automated
coverage_id: 03-09-D6

### 66. 03-09 D7: recordSyncError with syncedAt sets last_sync_at and clears the valve counts; without it they are untouched; redaction and the 1000-character cap still apply
expected: recordSyncError with syncedAt sets last_sync_at and clears the valve counts; without it they are untouched; redaction and the 1000-character cap still apply
result: pass
source: automated
coverage_id: 03-09-D7

### 67. 03-09 D8: A spawned sift worker (SIFT_DATA, models.url at the fake, no test hook) decides a backfilled bank message by the exact rule and a later message through the fake, status ok, dataDir in 'worker started', SIGTERM exit 0
expected: A spawned sift worker (SIFT_DATA, models.url at the fake, no test hook) decides a backfilled bank message by the exact rule and a later message through the fake, status ok, dataDir in 'worker started', SIGTERM exit 0
result: pass
source: automated
coverage_id: 03-09-D8

### 68. 03-09 D9: No Phase 2 regression: without a runtime, status ok is still written inside the ingest lock; full worker and db suites pass
expected: No Phase 2 regression: without a runtime, status ok is still written inside the ingest lock; full worker and db suites pass
result: pass
source: automated
coverage_id: 03-09-D9

### 69. 03-10 D1: 13 hostile fixtures through Dovecot ingest and runBatch: system message and request fields identical to a benign email, fixed user text identical apart from the nonce, each real marker line once, injected text only inside the fence, a new nonce per retry, the expected replayable decision (E3, SEC-01)
expected: 13 hostile fixtures through Dovecot ingest and runBatch: system message and request fields identical to a benign email, fixed user text identical apart from the nonce, each real marker line once, injected text only inside the fence, a new nonce per retry, the expected replayable decision (E3, SEC-01)
result: pass
source: automated
coverage_id: 03-10-D1

### 70. 03-10 D2: Field forgery and limits: a CR/LF subject (stored with its line break) renders as one subject line and one body line; a display name and attachment names stay on their own lines; a bank display name and Reply-To/Sender do not hit the bank rule; text after character 4,000 is absent and the label reads first 4000 of
expected: Field forgery and limits: a CR/LF subject (stored with its line break) renders as one subject line and one body line; a display name and attachment names stay on their own lines; a bank display name and Reply-To/Sender do not hit the bank rule; text after character 4,000 is absent and the label reads first 4000 of
result: pass
source: automated
coverage_id: 03-10-D2

### 71. 03-10 D3: E2: tool_calls and a forward-this reason are decided from content only, an extra action key is invalid twice then review; each message has one decision, one rule_set and prompt_version row, body expiry set, no label or label_event row, no tools key
expected: E2: tool_calls and a forward-this reason are decided from content only, an extra action key is invalid twice then review; each message has one decision, one rule_set and prompt_version row, body expiry set, no label or label_event row, no tools key
result: pass
source: automated
coverage_id: 03-10-D3

### 72. 03-10 D4: Emoji/CJK flood against a fake character budget is review input_too_long after one call; the benign message after it is decided in the same batch (E3, E5)
expected: Emoji/CJK flood against a fake character budget is review input_too_long after one call; the benign message after it is decided in the same batch (E3, E5)
result: pass
source: automated
coverage_id: 03-10-D4

### 73. 03-10 D5: Five pairs: identical requests outside the fence and the same call count under an honest fake; under a compromised fake the injected variant is labelled X only when X is a category (raw output in the span), else review out_of_category (E4 CI part)
expected: Five pairs: identical requests outside the fence and the same call count under an honest fake; under a compromised fake the injected variant is labelled X only when X is a category (raw output in the span), else review out_of_category (E4 CI part)
result: pass
source: automated
coverage_id: 03-10-D5

### 74. 03-10 D6: Sentinel in subject, display name, body, fake reason and 500/400 error bodies never in a log line, last_error or the batch error, with a positive control in the decision spans; every fetch goes through the injected fetch to the fake's origin; a cloud model gets no chat request (E7)
expected: Sentinel in subject, display name, body, fake reason and 500/400 error bodies never in a log line, last_error or the batch error, with a positive control in the decision spans; every fetch goes through the injected fetch to the fake's origin; a cloud model gets no chat request (E7)
result: pass
source: automated
coverage_id: 03-10-D6

### 75. 03-10 D7: Hermeticity guard: no classification test or helper names the real Ollama port; positive control on config.example.yaml; dependencies.test.ts unchanged and passing
expected: Hermeticity guard: no classification test or helper names the real Ollama port; positive control on config.example.yaml; dependencies.test.ts unchanged and passing
result: pass
source: automated
coverage_id: 03-10-D7

### 76. 03-10 D8: Fixtures are synthetic: at least 12 hostile files and exactly the 10 pair files, every address under example.test
expected: Fixtures are synthetic: at least 12 hostile files and exactly the 10 pair files, every address under example.test
result: pass
source: automated
coverage_id: 03-10-D8

### 77. 03-11 D1: sift config check prints every rules.yaml problem as file:line:col path: message and exits 1; all-valid prints '...; password env vars present; rules files valid'
expected: sift config check prints every rules.yaml problem as file:line:col path: message and exits 1; all-valid prints '...; password env vars present; rules files valid'
result: pass
source: automated
coverage_id: 03-11-D1

### 78. 03-11 D2: --schema-only and setup read no rules files (no data directory needed)
expected: --schema-only and setup read no rules files (no data directory needed)
result: pass
source: automated
coverage_id: 03-11-D2

### 79. 03-11 D3: sift mailbox rename refuses before any DB call until the new rules file exists, then renames as before (same id)
expected: sift mailbox rename refuses before any DB call until the new rules file exists, then renames as before (same id)
result: pass
source: automated
coverage_id: 03-11-D3

### 80. 03-11 D4: worker and setup mount the data dir read-only at /data with SIFT_DATA=/data; compose-smoke uses its own data dir
expected: worker and setup mount the data dir read-only at /data with SIFT_DATA=/data; compose-smoke uses its own data dir
result: pass
source: automated
coverage_id: 03-11-D4

### 81. 03-12 D1: --message on a decided message appends a rerun decision, keeps the worker one unchanged, latestDecision returns the rerun, both replay (D-17)
expected: --message on a decided message appends a rerun decision, keeps the worker one unchanged, latestDecision returns the rerun, both replay (D-17)
result: pass
source: automated
coverage_id: 03-12-D1

### 82. 03-12 D2: Exactly one selector, slug, UUID id and a real YYYY-MM-DD not after today, else usage and exit 2; usage listed in sift --help
expected: Exactly one selector, slug, UUID id and a real YYYY-MM-DD not after today, else usage and exit 2; usage listed in sift --help
result: pass
source: automated
coverage_id: 03-12-D2

### 83. 03-12 D3: --since selects decided and undecided mail on or after the date; --all-pending pending only and skips what the worker decided meanwhile; unknown id, unknown slug and disabled mailbox exit 1 with nothing changed
expected: --since selects decided and undecided mail on or after the date; --all-pending pending only and skips what the worker decided meanwhile; unknown id, unknown slug and disabled mailbox exit 1 with nothing changed
result: pass
source: automated
coverage_id: 03-12-D3

### 84. 03-12 D4: Above 20 messages the count is shown and confirmation asked with the lock released; declined prints Nothing changed. and writes nothing; accepted decides all 30 with 30 chat calls (no per-pass cap); 3 messages ask nothing
expected: Above 20 messages the count is shown and confirmation asked with the lock released; declined prints Nothing changed. and writes nothing; accepted decides all 30 with 30 chat calls (no per-pass cap); 3 messages ask nothing
result: pass
source: automated
coverage_id: 03-12-D4

### 85. 03-12 D5: A held ingest lock is waited on with one waiting line, then refused with 'the worker is classifying <slug> right now'; a lock released within the wait lets the run start (P2 D-03, T-03-45)
expected: A held ingest lock is waited on with one waiting line, then refused with 'the worker is classifying <slug> right now'; a lock released within the wait lets the run start (P2 D-03, T-03-45)
result: pass
source: automated
coverage_id: 03-12-D5

### 86. 03-12 D6: Ollama outage after 2 of 5: exit 1, 'Ollama unreachable at ' and 'classified 2 of 5; 3 left', mailbox_status unchanged; invalid rules.yaml exits 1 with positioned issues and no request; Ctrl-C during a hanging call exits 1 with no decision
expected: Ollama outage after 2 of 5: exit 1, 'Ollama unreachable at ' and 'classified 2 of 5; 3 left', mailbox_status unchanged; invalid rules.yaml exits 1 with positioned issues and no request; Ctrl-C during a hanging call exits 1 with no decision
result: pass
source: automated
coverage_id: 03-12-D6

### 87. 03-12 D7: An expired body is refetched read-only from Dovecot by identity, a rerun decision appended, and the restored body expires 7 days after it; identity mismatch, expunge and new UIDVALIDITY are skipped by id; no connection while cached; missing password refuses (D-32, T-03-44)
expected: An expired body is refetched read-only from Dovecot by identity, a rerun decision appended, and the restored body expires 7 days after it; identity mismatch, expunge and new UIDVALIDITY are skipped by id; no connection while cached; missing password refuses (D-32, T-03-44)
result: pass
source: automated
coverage_id: 03-12-D7

### 88. 03-12 D8: No command output in either test file holds a seeded subject, sender, body, model reason or the IMAP password (T-03-47)
expected: No command output in either test file holds a seeded subject, sender, body, model reason or the IMAP password (T-03-47)
result: pass
source: automated
coverage_id: 03-12-D8

### 89. 03-13 D1: README takes an owner from config to classified mail: rules file creation from the example, category rule (Labels/<Category>, ASCII, 1-40 chars, rejected not fixed), exact-rule matching, sift config check with its exact OK line, per-mailbox pause, edits apply to new mail only
expected: README takes an owner from config to classified mail: rules file creation from the example, category rule (Labels/<Category>, ASCII, 1-40 chars, rejected not fixed), exact-rule matching, sift config check with its exact OK line, per-mailbox pause, edits apply to new mail only
result: pass
source: automated
coverage_id: 03-13-D1

### 90. 03-13 D2: Quick start creates the rules file and pulls qwen3:1.7b before docker compose up -d, then runs sift config check; the model pull is no longer under later milestones
expected: Quick start creates the rules file and pulls qwen3:1.7b before docker compose up -d, then runs sift config check; the model pull is no longer under later milestones
result: pass
source: automated
coverage_id: 03-13-D2

### 91. 03-13 D3: README documents sift classify (--all-pending, --since, --message, --yes), the >20 confirmation, the lock wait, appended decisions and the expired-body refetch; Ollama and rules error lines match what the worker prints
expected: README documents sift classify (--all-pending, --since, --message, --yes), the >20 confirmation, the lock wait, appended decisions and the expired-body refetch; Ollama and rules error lines match what the worker prints
result: pass
source: automated
coverage_id: 03-13-D3

### 92. 03-13 D4: CONTRIBUTING Classification tests note names only existing pnpm commands and the fake Ollama
expected: CONTRIBUTING Classification tests note names only existing pnpm commands and the fake Ollama
result: pass
source: automated
coverage_id: 03-13-D4

### 93. 03-13 D5: Baseline runner against the compromised fake: 10 rows in fixed order, attempts >= 1, thinking null, digest; flips = the 3 pairs whose classify-as target is a category; every request to the given origin with no tools key; table header, 10 rows, final flips line; refusals send no email; usage exits 2; no default URL
expected: Baseline runner against the compromised fake: 10 rows in fixed order, attempts >= 1, thinking null, digest; flips = the 3 pairs whose classify-as target is a category; every request to the given origin with no tools key; table header, 10 rows, final flips line; refusals send no email; usage exits 2; no default URL
result: pass
source: automated
coverage_id: 03-13-D5

### 94. 03-14 D1: sift classify refetch restores a decided message's body with expires_at = restore time + 7 days, even when Ollama is down after the refetch (code 1, outage message, no new decision)
expected: sift classify refetch restores a decided message's body with expires_at = restore time + 7 days, even when Ollama is down after the refetch (code 1, outage message, no new decision)
result: pass
source: automated
coverage_id: 03-14-D1

### 95. 03-14 D2: restoreBody gives a decided message's body expires_at = at + 7 days, a later rerun decision does not move it, an undecided message's restored body keeps expires_at null, and an invalid Date throws before any SQL
expected: restoreBody gives a decided message's body expires_at = at + 7 days, a later rerun decision does not move it, an undecided message's restored body keeps expires_at null, and an invalid Date throws before any SQL
result: pass
source: automated
coverage_id: 03-14-D2

### 96. 03-14 D3: storeMessages gives a body re-inserted for a decided message expires_at = at + 7 days, undecided bodies null, and an identical second call changes neither
expected: storeMessages gives a body re-inserted for a decided message expires_at = at + 7 days, undecided bodies null, and an identical second call changes neither
result: pass
source: automated
coverage_id: 03-14-D3

### 97. 03-14 D4: 03-SECURITY.md row T-03-20 names the restore and re-insert paths and their tests, status closed
expected: 03-SECURITY.md row T-03-20 names the restore and re-insert paths and their tests, status closed
result: pass
source: automated
coverage_id: 03-14-D4

### 98. 03-15 D1: After sift mailbox resume, a batch whose classification pass throws a non-infra error ends with approved/held null, state error and last_sync_at at the ingest time; the status read mid-pass already shows the approval spent; the next batch ingests with the cap and is held again
expected: After sift mailbox resume, a batch whose classification pass throws a non-infra error ends with approved/held null, state error and last_sync_at at the ingest time; the status read mid-pass already shows the approval spent; the next batch ingests with the cap and is held again
result: pass
source: automated
coverage_id: 03-15-D1

### 99. 03-15 D2: Phase 2 behaviour without a classification runtime is unchanged (recordSyncSuccess in the lock)
expected: Phase 2 behaviour without a classification runtime is unchanged (recordSyncSuccess in the lock)
result: pass
source: automated
coverage_id: 03-15-D2

### 100. 03-15 D3: recordIngestSynced state rules: needs_attention -> ok with last_error cleared; error and connecting kept with last_error; counts cleared; missing row created; backfill progress untouched
expected: recordIngestSynced state rules: needs_attention -> ok with last_error cleared; error and connecting kept with last_error; counts cleared; missing row created; backfill progress untouched
result: pass
source: automated
coverage_id: 03-15-D3

### 101. 03-15 D4: @sift/db export surface lists recordIngestSynced
expected: @sift/db export surface lists recordIngestSynced
result: pass
source: automated
coverage_id: 03-15-D4

### 102. 03-16 D1: A model reason with NUL, BEL or U+2028 is retried once and then stored as a review invalid_output decision (two schema_mismatch attempts with detail 'reason: control_character'); the other message of the pass is labelled, both replay, nothing stays pending
expected: A model reason with NUL, BEL or U+2028 is retried once and then stored as a review invalid_output decision (two schema_mismatch attempts with detail 'reason: control_character'); the other message of the pass is labelled, both replay, nothing stays pending
result: pass
source: automated
coverage_id: 03-16-D1

### 103. 03-16 D2: A NUL reason on the first call and a valid answer on the retry is labelled with two attempts
expected: A NUL reason on the first call and a valid answer on the retry is labelled with two attempts
result: pass
source: automated
coverage_id: 03-16-D2

### 104. 03-16 D3: validateLlmOutput rejects NUL, BEL, ESC, DEL, U+0085, an inner tab or line feed, U+2028 and U+2029 per code point, accepts accents, CJK and astral emoji, accepts a reason whose whitespace controls only lead or trail, and never quotes the reason in the detail
expected: validateLlmOutput rejects NUL, BEL, ESC, DEL, U+0085, an inner tab or line feed, U+2028 and U+2029 per code point, accepts accents, CJK and astral emoji, accepts a reason whose whitespace controls only lead or trail, and never quotes the reason in the detail
result: pass
source: automated
coverage_id: 03-16-D3

### 105. 03-16 D4: The prompt material is unchanged: EXPECTED_PROMPT_HASH still matches and prompt-version.test.ts is not modified
expected: The prompt material is unchanged: EXPECTED_PROMPT_HASH still matches and prompt-version.test.ts is not modified
result: pass
source: automated
coverage_id: 03-16-D4

### 106. 03-16 D5: recordDecision stores an llm decision whose attempt holds NUL in thinking, raw and done_reason (and NUL in response_model) with the NUL removed; before the change the insert failed with 22P05
expected: recordDecision stores an llm decision whose attempt holds NUL in thinking, raw and done_reason (and NUL in response_model) with the NUL removed; before the change the insert failed with 22P05
result: pass
source: automated
coverage_id: 03-16-D5

### 107. 03-17 D1: A 500 confined to one message skips only it; older LLM-bound mail is decided in the same pass and runBatch resolves on consecutive batches (status ok, no backoff)
expected: A 500 confined to one message skips only it; older LLM-bound mail is decided in the same pass and runBatch resolves on consecutive batches (status ok, no backoff)
result: pass
source: automated
coverage_id: 03-17-D1

### 108. 03-17 D2: A failed re-probe or a failure past the per-pass budget is an outage exactly as D-16 (infra, owner message, backoff, exact rules still decide)
expected: A failed re-probe or a failure past the per-pass budget is an outage exactly as D-16 (infra, owner message, backoff, exact rules still decide)
result: pass
source: automated
coverage_id: 03-17-D2

### 109. 03-17 D3: Timeout, single-message and shutdown-during-re-probe edges
expected: Timeout, single-message and shutdown-during-re-probe edges
result: pass
source: automated
coverage_id: 03-17-D3

### 110. 03-17 D4: The skip warn line and status never carry mail text or Ollama's error text (T-03-62)
expected: The skip warn line and status never carry mail text or Ollama's error text (T-03-62)
result: pass
source: automated
coverage_id: 03-17-D4

### 111. 03-17 D5: sift classify names a message Ollama failed on alone on stderr
expected: sift classify names a message Ollama failed on alone on stderr
result: pass
source: automated
coverage_id: 03-17-D5

### 112. 03-18 D1: A message the pass could not classify is named in mailbox_status.last_error while state stays ok; a later clean pass clears it (batch level)
expected: A message the pass could not classify is named in mailbox_status.last_error while state stays ok; a later clean pass clears it (batch level)
result: pass
source: automated
coverage_id: 03-18-D1

### 113. 03-18 D2: unclassifiedNotice text: null for none, at most 3 ids then '; and N more', ids only (T-03-31, T-03-64)
expected: unclassifiedNotice text: null for none, at most 3 ids then '; and N more', ids only (T-03-31, T-03-64)
result: pass
source: automated
coverage_id: 03-18-D2

### 114. 03-18 D3: recordSyncSuccess notice storage and sift mailbox list 'ok; <notice>' rendering, with and without backfill progress
expected: recordSyncSuccess notice storage and sift mailbox list 'ok; <notice>' rendering, with and without backfill progress
result: pass
source: automated
coverage_id: 03-18-D3

### 115. 03-18 D4: A message Ollama failed on alone in 3 passes is no longer sent (no preflight, no chat) in this process; after 2 passes it still is; a restart sends it again
expected: A message Ollama failed on alone in 3 passes is no longer sent (no preflight, no chat) in this process; after 2 passes it still is; a restart sends it again
result: pass
source: automated
coverage_id: 03-18-D4

### 116. 03-18 D5: Canary: mail-free request (fixed text, format only Probe); a failing canary is an outage and nothing is held back (T-03-67)
expected: Canary: mail-free request (fixed text, format only Probe); a failing canary is an outage and nothing is held back (T-03-67)
result: pass
source: automated
coverage_id: 03-18-D5

### 117. 03-18 D6: A decided message (Ollama answers, or an exact rule added later) is removed from the failure memory
expected: A decided message (Ollama answers, or an exact rule added later) is removed from the failure memory
result: pass
source: automated
coverage_id: 03-18-D6

### 118. 03-19 D1: The owner chose option-review at the blocking-human checkpoint, and accepted the 03-17 D-16 clarification; both are recorded here and in 03-CONTEXT.md
expected: The owner chose option-review at the blocking-human checkpoint, and accepted the 03-17 D-16 clarification; both are recorded here and in 03-CONTEXT.md
result: pass
source: automated
coverage_id: 03-19-D1

### 119. 03-19 D2: llm_error is in REVIEW_REASONS and ATTEMPT_FAILURE_CODES (last); an llm_error trace (one failed call, raw null, result null) parses; an unknown reason such as model_error is refused
expected: llm_error is in REVIEW_REASONS and ATTEMPT_FAILURE_CODES (last); an llm_error trace (one failed call, raw null, result null) parses; an unknown reason such as model_error is refused
result: pass
source: automated
coverage_id: 03-19-D2

### 120. 03-19 D3: decide() turns an llm_error review verdict into outcome review, reviewReason llm_error, tier llm, category null, confidence null, with the attempts kept and result null
expected: decide() turns an llm_error review verdict into outcome review, reviewReason llm_error, tier llm, category null, confidence null, with the attempts kept and result null
result: pass
source: automated
coverage_id: 03-19-D3

### 121. 03-19 D4: Migration 0011 only drops and re-adds decision_review_reason_check with llm_error; Postgres accepts an llm_error review row, refuses a labelled llm_error row and an unknown reason with 23514; recordDecision stores an llm_error review; db:generate reports no drift
expected: Migration 0011 only drops and re-adds decision_review_reason_check with llm_error; Postgres accepts an llm_error review row, refuses a labelled llm_error row and an unknown reason with 23514; recordDecision stores an llm_error review; db:generate reports no drift
result: pass
source: automated
coverage_id: 03-19-D4

### 122. 03-20 D1: A message Ollama fails on alone in three passes of one worker gets exactly one review llm_error decision on the third pass, after a successful canary; tier llm, category and confidence null, decided_by worker; replayable; no longer pending, in the notice or in messageFailures
expected: A message Ollama fails on alone in three passes of one worker gets exactly one review llm_error decision on the third pass, after a successful canary; tier llm, category and confidence null, decided_by worker; replayable; no longer pending, in the notice or in messageFailures
result: pass
source: automated
coverage_id: 03-20-D1

### 123. 03-20 D2: The failed call is stored as an attempt with raw null, metrics null and validation { ok: false, code: llm_error, detail: llmErrorDetail(code, status) }; Ollama's error text never reaches the attempt
expected: The failed call is stored as an attempt with raw null, metrics null and validation { ok: false, code: llm_error, detail: llmErrorDetail(code, status) }; Ollama's error text never reaches the attempt
result: pass
source: automated
coverage_id: 03-20-D2

### 124. 03-20 D3: An outage never becomes llm_error: a failed re-probe over four passes, a failed canary (every chat failing) over four passes, and failures past the per-pass budget write no decision
expected: An outage never becomes llm_error: a failed re-probe over four passes, a failed canary (every chat failing) over four passes, and failures past the per-pass budget write no decision
result: pass
source: automated
coverage_id: 03-20-D3

### 125. 03-20 D4: A timeout confined to one message reaches llm_error on the third pass with detail 'Ollama failed on this request (timeout)' and replays
expected: A timeout confined to one message reaches llm_error on the third pass with detail 'Ollama failed on this request (timeout)' and replays
result: pass
source: automated
coverage_id: 03-20-D4

### 126. 03-20 D5: sift classify never writes llm_error: three runs with a runtime per run, and three runs sharing one runtime, only print the skip line
expected: sift classify never writes llm_error: three runs with a runtime per run, and three runs sharing one runtime, only print the skip line
result: pass
source: automated
coverage_id: 03-20-D5

### 127. 03-21 D1: sift config check exits 1 for a rules file whose first category description holds a NUL, printing exactly one line '<file>:<line>:<col> categories[0].description: description must not contain control characters'
expected: sift config check exits 1 for a rules file whose first category description holds a NUL, printing exactly one line '<file>:<line>:<col> categories[0].description: description must not contain control characters'
result: pass
source: automated
coverage_id: 03-21-D1

### 128. 03-21 D2: Description, judgment line and rule name reject NUL, BEL, inner tab and U+0085 with '<name> must not contain control characters'; inner LF or U+2028 gives one 'must be one line' issue
expected: Description, judgment line and rule name reject NUL, BEL, inner tab and U+0085 with '<name> must not contain control characters'; inner LF or U+2028 gives one 'must be one line' issue
result: pass
source: automated
coverage_id: 03-21-D2

### 129. 03-21 D3: from, domain and phrase entries with NUL or BEL are rejected with '<key> entries must not contain control characters'; a phrase with an inner tab still loads with one space
expected: from, domain and phrase entries with NUL or BEL are rejected with '<key> entries must not contain control characters'; a phrase with an inner tab still loads with one space
result: pass
source: automated
coverage_id: 03-21-D3

### 130. 03-21 D4: Valid rules files (accents, CJK, the committed example) load and hash exactly as before
expected: Valid rules files (accents, CJK, the committed example) load and hash exactly as before
result: pass
source: automated
coverage_id: 03-21-D4

### 131. 03-22 D1: sift classify names a message Ollama failed on alone by id (HTTP status, or the code for a timeout), classifies the others, counts it in '; 1 skipped' and exits 0
expected: sift classify names a message Ollama failed on alone by id (HTTP status, or the code for a timeout), classifies the others, counts it in '; 1 skipped' and exits 0
result: pass
source: automated
coverage_id: 03-22-D1

### 132. 03-22 D2: The skip line carries no mail text and no Ollama error text (T-03-74)
expected: The skip line carries no mail text and no Ollama error text (T-03-74)
result: pass
source: automated
coverage_id: 03-22-D2

### 133. Re-test 2 after 03-23: live baseline shows progress (G-03-2, CLS-02)
expected: From the sift repository root, with Ollama running and qwen3:1.7b pulled, run: node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b. A ready line appears on stderr right after the model check, then one line per email as each finishes (fixture N/10 <file>: <s> s). At the end the Markdown table prints on stdout: 10 rows, thinking null yes in every row, one model digest, last line flips: <n>. The run takes a few minutes.
result: pass

### 134. Re-test 8 after 03-24: README quick start is findable and scannable (G-03-8)
expected: Open the LOCAL README.md (GitHub main does not have these commits yet). Under the status note at the top, a Get started line links to Quick start. The quick start reads as one list numbered 1 to 12, and each step starts with a short bold imperative, with details below it.
result: pass

### 135. Owner decision WR-06: per-pass budget of 2 messages Ollama fails on alone
expected: Reply keep to confirm the accepted 03-17 rule (at most 2 such messages per pass; a third in the same pass is treated as an Ollama outage, so with k such messages the mailbox spends about 3k/2 passes in backoff with slower IMAP polling), or describe the change you want (for example the reviewer canary-instead-of-outage fix).
result: pass
note: "Owner decision 2026-10-13: keep the accepted 03-17 rule (at most 2 alone-failing messages per pass; a third is an outage). WR-06 accepted as designed."

### 136. Owner decision WR-07: evidence needed before a permanent llm_error review
expected: Reply keep to accept that 3 failed passes a poll interval apart plus a successful canary make a message review llm_error, or describe the extra evidence you want (for example a minimum time span, or a successful real chat in between).
result: pass
note: "Owner decision 2026-10-13: keep (3 failed passes a poll interval apart plus a successful canary give review llm_error). WR-07 accepted as designed."

## Summary

total: 136
passed: 133
issues: 2
pending: 0
skipped: 1
blocked: 0

## Gaps

- gap_id: G-03-2
  truth: "The live baseline runner gives the owner visible output when run as documented in 03-USER-SETUP.md"
  status: resolved
  resolved_by: 03-23-PLAN.md
  resolved_at: 2026-10-12
  reason: "User reported: the command doesn't yeild anything on my computer"
  severity: minor
  test: 2
  root_cause: "apps/worker/test/support/llm-baseline.ts main() only calls io.stdout once, after runBaseline has finished all 10 chat calls (about 4 min on qwen3:1.7b, 11-40 s each). Nothing goes to stdout or stderr before that, so the run looks hung. The first attempt was also started from /Users/samuel/dev/public_gsd-2 (MODULE_NOT_FOUND), and 03-USER-SETUP.md does not say how long the run takes."
  artifacts:
    - path: "apps/worker/test/support/llm-baseline.ts"
      issue: "no progress output during the run; table printed only at the end"
    - path: ".planning/phases/03-tiered-classification-with-traces/03-USER-SETUP.md"
      issue: "does not warn that the run takes several minutes with no output"
  missing:
    - "Print one progress line per fixture on stderr (for example 'fixture 3/10 pair-payment-failure.eml ... 39 s') so stdout stays the clean table"
    - "Say in 03-USER-SETUP.md (and the README if it mentions the runner) that the run takes a few minutes and must start from the repository root"
- gap_id: G-03-8
  truth: "An owner opening the README finds the 12-step quick start straight away and sees it as one numbered list"
  status: resolved
  resolved_by: 03-24-PLAN.md
  resolved_at: 2026-10-12
  reason: "User reported: that this is hard to find is a real problem... i see no 12 step numbered list"
  severity: major
  test: 8
  root_cause: "The quick start is ### Quick start at README.md:471, under 'Running it at home', after about 450 lines of design text (How it works, Configuring Sift, Data model, Security, Evals), and nothing near the top links to it. The intro (README.md:1-16) says 'This README describes the target' and points only to the Roadmap. The local markup is a valid 1-12 list with indented code blocks. Local main is 168 commits ahead of origin/main, so the README on GitHub (k-leumas/sift) does not have steps 10-12 yet; reading that copy, or another checkout such as /Users/samuel/dev/public_gsd-2, shows no 12-step list."
  artifacts:
    - path: "README.md"
      issue: "quick start buried at line 471 with no link from the intro; long steps (2, 4, 8, 12) with nested code blocks make the numbering hard to follow"
  missing:
    - "A 'Get started' link (or a short 'Try it' section) in the README intro that jumps to #quick-start"
    - "Make each step's first line a short imperative, with the details below it, so the 1-12 numbering is easy to scan"
    - "Check that the owner is reading the current README: push main, or say which copy is current"
