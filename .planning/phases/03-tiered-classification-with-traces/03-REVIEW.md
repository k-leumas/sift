---
phase: 03-tiered-classification-with-traces
reviewed: 2026-10-10T23:52:06Z
depth: deep
files_reviewed: 101
files_reviewed_list:
  - .gitignore
  - apps/worker/src/classify/llm-tier.ts
  - apps/worker/src/classify/ollama-client.ts
  - apps/worker/src/classify/preflight.ts
  - apps/worker/src/classify/refetch.ts
  - apps/worker/src/classify/run.ts
  - apps/worker/src/classify/single-flight.ts
  - apps/worker/src/classify/untrusted-email.ts
  - apps/worker/src/command.ts
  - apps/worker/src/commands/classify.ts
  - apps/worker/src/commands/config-check.ts
  - apps/worker/src/commands/mailbox-rename.ts
  - apps/worker/src/commands/worker.ts
  - apps/worker/src/runtime/mailbox-batch.ts
  - apps/worker/test/classify-batch.test.ts
  - apps/worker/test/classify-cli.test.ts
  - apps/worker/test/classify-hermetic.test.ts
  - apps/worker/test/classify-injection.test.ts
  - apps/worker/test/classify-leak.test.ts
  - apps/worker/test/classify-llm-tier.test.ts
  - apps/worker/test/classify-ollama-client.test.ts
  - apps/worker/test/classify-preflight.test.ts
  - apps/worker/test/classify-refetch.test.ts
  - apps/worker/test/classify-run.test.ts
  - apps/worker/test/classify-trace.test.ts
  - apps/worker/test/cli.test.ts
  - apps/worker/test/compose-smoke.test.ts
  - apps/worker/test/compose.test.ts
  - apps/worker/test/config-check-rules.test.ts
  - apps/worker/test/llm-baseline.test.ts
  - apps/worker/test/mailbox-rename-guard.test.ts
  - apps/worker/test/support/classify-harness.ts
  - apps/worker/test/support/fake-ollama.ts
  - apps/worker/test/support/llm-baseline.ts
  - apps/worker/test/support/mailbox-harness.ts
  - apps/worker/test/user-facing-text.test.ts
  - apps/worker/test/worker-classify.test.ts
  - compose.yaml
  - config/config.example.yaml
  - CONTRIBUTING.md
  - data/mailboxes/example/rules.example.yaml
  - packages/core/package.json
  - packages/core/src/classify/canonical.ts
  - packages/core/src/classify/decide.ts
  - packages/core/src/classify/exact-rules.ts
  - packages/core/src/classify/index.ts
  - packages/core/src/classify/llm-output.ts
  - packages/core/src/classify/prompt-version.ts
  - packages/core/src/classify/prompt.ts
  - packages/core/src/classify/spans.ts
  - packages/core/src/config/index.ts
  - packages/core/src/config/load.ts
  - packages/core/src/config/schema.ts
  - packages/core/src/rules/hash.ts
  - packages/core/src/rules/index.ts
  - packages/core/src/rules/load.ts
  - packages/core/src/rules/path.ts
  - packages/core/src/rules/schema.ts
  - packages/core/src/yaml-issues.ts
  - packages/core/test/config.test.ts
  - packages/core/test/decide.test.ts
  - packages/core/test/env.test.ts
  - packages/core/test/exact-rules.test.ts
  - packages/core/test/example-config.test.ts
  - packages/core/test/example-rules.test.ts
  - packages/core/test/llm-output.test.ts
  - packages/core/test/prompt-version.test.ts
  - packages/core/test/prompt.test.ts
  - packages/core/test/rules-hash.test.ts
  - packages/core/test/rules.test.ts
  - packages/core/test/spans.test.ts
  - packages/db/migrations/0008_classification_preflight.sql
  - packages/db/migrations/0009_classification_tables.sql
  - packages/db/migrations/0010_classification_grants.sql
  - packages/db/migrations/meta/_journal.json
  - packages/db/migrations/meta/0008_snapshot.json
  - packages/db/migrations/meta/0009_snapshot.json
  - packages/db/migrations/meta/0010_snapshot.json
  - packages/db/src/classify.ts
  - packages/db/src/index.ts
  - packages/db/src/ingest.ts
  - packages/db/src/prompt-version.ts
  - packages/db/src/schema/index.ts
  - packages/db/src/schema/prompt-version.ts
  - packages/db/src/schema/scoped.ts
  - packages/db/src/scope.ts
  - packages/db/src/status.ts
  - packages/db/test/catalog.test.ts
  - packages/db/test/classify-schema.test.ts
  - packages/db/test/classify.test.ts
  - packages/db/test/ingest.test.ts
  - packages/db/test/isolation.test.ts
  - packages/db/test/migrate.test.ts
  - packages/db/test/registry-plan.test.ts
  - packages/db/test/registry.test.ts
  - packages/db/test/scope.test.ts
  - packages/db/test/status.test.ts
  - packages/db/test/support/catalog.ts
  - packages/db/test/support/seed.ts
  - README.md
  - scripts/compose-smoke.sh
findings:
  critical: 3
  warning: 3
  info: 7
  total: 13
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-10-10T23:52:06Z
**Depth:** deep
**Files Reviewed:** 101
**Status:** issues_found

## Summary

I read all the production source in scope line by line: `apps/worker/src/classify/*`, `commands/classify.ts`, `runtime/mailbox-batch.ts`, `commands/worker.ts`, `packages/core/src/{classify,rules,config}`, `packages/db/src/{classify,prompt-version,scope,status,schema}`, migrations 0008 to 0010, `compose.yaml` and `scripts/compose-smoke.sh`. I also followed the calls that matter across modules: the supervisor's backoff (`runtime/supervisor.ts`, `runtime/backoff.ts`), `withIngestLock` (`packages/db/src/lock.ts`) and how ingest writes bodies (`apps/worker/src/ingest/run.ts`, `packages/db/src/ingest.ts`). I checked tests and docs for vacuous assertions, skipped cases and drift from the code. That pass was by grep and spot-reads, not a full read. `pnpm typecheck` passes.

The core contract is sound. `decide()` is the only assembler, `recordDecision` is the only write path, the fence and nonce handling is correct, the exact-rule matcher is deterministic, and the database checks back up the code checks. The defects are in the failure paths, where the classification pass now runs after ingest:

1. One message that fails every time stalls its whole mailbox for good (the open owner decision; assessed below as a BLOCKER).
2. Bodies that `sift classify` refetches can stay cached forever, which breaks the 7-day retention promise.
3. When the pass throws, the volume valve's one-time approval is never cleared, so the valve stays open wider than the owner approved.

Model output that contains NUL, and rules files with control characters, give deterministic failures that `sift config check` does not predict and status does not show.

No finding repeats a closed SECURITY.md threat or an accepted risk (AR-03-01..03).

## Critical Issues

### CR-01: One message that always fails puts its mailbox in permanent backoff and blocks all older LLM-bound mail (open owner decision, severity assessment)

**File:** `apps/worker/src/classify/run.ts:340-343`, `apps/worker/src/classify/run.ts:520-534`, `apps/worker/src/runtime/mailbox-batch.ts:485-487`, `apps/worker/src/classify/ollama-client.ts:183`, `apps/worker/src/classify/ollama-client.ts:170`, `apps/worker/src/runtime/supervisor.ts:228-233`, `apps/worker/src/runtime/backoff.ts:2`
**Issue:** Any `infra` result from a chat call sets `state.llmBlocked` (run.ts:342). The pass then returns `infra` (run.ts:523), `runBatch` throws `ClassifyInfraError` (mailbox-batch.ts:487) and the supervisor backs off exponentially, up to `BACKOFF_CAP_MS` = 15 min. Pending mail is scanned newest first, so a message that deterministically gets `server_error` (HTTP 500 from a runner crash on that input) or `timeout` comes back as the first LLM-bound message after any newer mail in every pass. Concretely:
- **Permanent head-of-line block:** every LLM-bound message older than it is never classified.
- **Ingest latency degraded permanently:** ingest shares the batch with classification, so the backoff also delays IMAP polling. New mail arrives about every 15 min instead of every `poll_interval_seconds` (60 s by default), with no end.
- **Misleading permanent status:** status shows `error: Ollama at … failed (HTTP 500); see the Ollama log`, which tells the owner Ollama is broken when it serves every other message.
- **No way out:** the warn log at run.ts:522 has `code` and `status` but no message id, so the owner cannot find the message. `sift classify --message` hits the same 500, and no command skips or quarantines a message.
- **Timeout variant:** `timeout` is just as deterministic on the README's target hardware ("CPU-only inference is fine", Linux mini PC). A near-maximum prompt (judgment lines up to 4,000 characters, plus 20 categories, a 4,000-character body and 20 × 300-character attachment names, which can approach `num_ctx` 8192 tokens) can take more than `LLM_CALL_TIMEOUT_MS` (120 s) of CPU prompt evaluation every time. So the poison case is not only an exotic runner crash.

Severity: BLOCKER. One email makes the damage permanent, the system cannot recover by itself, and the owner has no tool to recover it. D-16 ("an outage is never a decision") does not require treating a failure confined to one message as an outage of the whole mailbox.
**Fix:** Tell a failure confined to one message apart from an outage before blocking the pass. For example, after a chat `server_error` or `timeout`, rerun the preflight (it sends no mail). If the preflight succeeds, skip only that message for this pass, log its id, and continue, up to a small per-pass budget of distinct failing messages:
```ts
if (result.kind === 'infra') {
  if (result.code === 'server_error' || result.code === 'timeout') {
    const probe = await ctx.runtime.preflight(ctx.model, ctx.signal);
    if (probe.kind === 'ok' && state.messageFailures < MAX_MESSAGE_INFRA_PER_PASS) {
      state.messageFailures += 1;
      ctx.log.warn({ mailbox: ctx.slug, message: candidate.id, code: result.code, status: result.status },
        'classify: Ollama failed on this message only; skipped');
      return { kind: 'skip' };
    }
  }
  state.llmBlocked = { code: result.code, status: result.status, detail: result.detail };
  return { kind: 'skip' };
}
```
Also keep an in-memory per-message failure count on `ClassifyRuntime`. After N passes, either record a review decision with a new reason (for example `llm_error`, which needs `REVIEW_REASONS`, the `decision_review_reason_check` CHECK and a D-16 amendment), or show the message id in `last_error` so the owner can act on it.

### CR-02: Bodies refetched by `sift classify` never expire when the re-run does not decide them

**File:** `apps/worker/src/classify/refetch.ts:74-81`, `packages/db/src/classify.ts:222-240`, `packages/db/src/classify.ts:155-158`, `apps/worker/src/commands/classify.ts:306-344`, `packages/db/src/scope.ts:434-441`, `packages/db/src/ingest.ts:429-447`
**Issue:** `restoreBody` writes the refetched body with `expiresAt: null` and relies on the re-run's own `recordDecision` to start the 7-day clock. The sweep deletes only rows with `expires_at <= at` (scope.ts:438), and `deleteOrphanBodies` keeps any message that has a decision (ingest.ts:442-444). A restored body of an already-decided message is therefore kept forever unless this same run records a new decision for it. `refetchBodies` restores every expired body in the 5-message chunk before `classifyCandidates` runs (commands/classify.ts:307), so any of these leaves the restored bodies with `expires_at` null and a prior decision:
- an Ollama outage on the first message (`llmBlocked`, and later LLM-bound messages are skipped; the command exits at line 331)
- Ctrl-C (`classifyCandidates` returns `aborted` before the next message)
- a failure inside one message

Those bodies are permanent, which contradicts the README ("A body is deleted 7 days after the message's decision", README.md:409) and D-07/D-32. Re-running later does fix them. Until then, private mail text the owner was told is short-lived stays at rest indefinitely.

A second path may exist. Ingest's `insertOrIgnore` of bodies (packages/db/src/ingest.ts:237-252) also inserts `expires_at` null for a known eligible message whose old body was already swept. That happens if a decided message shows up again as an eligible record, for example a move back into the folder on a server that assigns a new INTERNALDATE. Before Phase 3 this was harmless because no message had a decision. Now no later write sets its expiry.
**Fix:** When the message already has a decision, give a restored or re-inserted body an expiry at the moment it is written. Then the sweep removes it even if no new decision follows:
```ts
// refetch.ts
await session.run((s) =>
  restoreBody(s, candidate.id, { bodyText: body.text, source: body.source, truncated: body.truncated },
    candidate.decided ? new Date(now().getTime() + DECISION_BODY_RETENTION_MS) : null),
);
```
`restoreBody` takes the `expiresAt` argument. `recordDecision`'s `expiresAt: null` filter still means a re-run never extends it. Apply the same rule in `storeBatch` for messages that have a decision row, and add a test: refetch, then a forced outage before the decision, then assert `expires_at` is not null.

### CR-03: When the classification pass throws after a synced ingest, the volume valve's approval and last_sync_at are never cleared, so the cap stays raised by the old approval

**File:** `apps/worker/src/runtime/mailbox-batch.ts:409-413`, `apps/worker/src/runtime/mailbox-batch.ts:455-492`, `apps/worker/src/runtime/mailbox-batch.ts:520-522`, `apps/worker/src/runtime/mailbox-batch.ts:377`, `packages/db/src/status.ts:21-30`
**Issue:** With `classify` set, the in-lock `recordSyncSuccess` is skipped (line 411). The valve's `approvedNewCount` and `heldNewCount` are cleared only after the pass, for done, busy, aborted, rules_invalid and infra. If `classifyMailbox` throws anything else, `onBatchError` goes to the generic branch (line 520), and `recordSyncError` runs without `syncedAt`, so the approval stays set. Examples of such throws: a pg error from `withIngestLock` or the candidates query, the `MAX_CONSECUTIVE_MESSAGE_FAILURES` rethrow (see WR-01), or a failed status write. The same happens if the process dies during the pass, which can take many minutes (OOM kill, heartbeat-stall exit 75). The state is now `error`, not `needs_attention`, so the next batch passes the hold check (line 347) and ingests with `newMailCap = hold.approved + cap` (line 377). Every later batch admits up to `approved` extra new messages that the owner never approved, until a batch finally succeeds. The owner chose a valve that fails closed. In Phase 2 the approval was cleared inside the lock with the ingest commit, and the Phase 3 restructuring lost that. Also, `last_sync_at` stays at the previous sync although the mail was fetched.
**Fix:** Clear the valve counts and record `lastSyncAt` inside the ingest lock, right after a synced or resynced outcome, whatever classification does. Leave only `state` and `last_error` to the post-pass write:
```ts
case 'synced':
case 'resynced': {
  const syncedAt = nowDate();
  await session.run((scope) =>
    classify === undefined
      ? recordSyncSuccess(scope, syncedAt)
      : recordIngestSynced(scope, syncedAt), // lastSyncAt + heldNewCount/approvedNewCount = null
  );
  ...
```
Add a test: resume, then run a batch whose pass throws, then assert `approved_new_count` is null and the next batch uses `cap`.

## Warnings

### WR-01: A model reason that contains `\u0000` cannot be stored, so that message fails on every pass and five in a row make the batch throw

**File:** `packages/core/src/classify/llm-output.ts:25`, `packages/db/src/classify.ts:137-153`, `apps/worker/src/classify/run.ts:417-425`
**Issue:** The llama.cpp JSON grammar allows `\uXXXX` escapes, so the model can emit `"reason":"…\u0000…"`. `JSON.parse` turns that into a real NUL. `z.string().trim().min(1).max(200)` accepts it, and `decide()` copies it into `spans[2].result.reason`. PostgreSQL `jsonb` rejects `\u0000` (SQLSTATE 22P05), so the `decision` insert fails. At temperature 0 with a fixed seed, the same email gives the same answer, so the message stays pending, costs another LLM call on every pass, and is logged only as code 22P05. An email that injects "end your reason with \u0000" can trigger it on purpose. Five such messages as the newest pending mail reach `MAX_CONSECUTIVE_MESSAGE_FAILURES`, so the pass throws on every batch: backoff, a generic `error` status, and the CR-03 valve leak. `restoreBody` strips NUL (classify.ts:227), but nothing strips it from spans. `raw`, `thinking`, `done_reason` and `response_model` are other strings from Ollama that reach jsonb the same way.
**Fix:** Reject control characters in the output contract, so the result is `schema_mismatch`: the existing retry, then `review invalid_output`. Never repair it:
```ts
reason: z.string().trim().min(1).max(REASON_MAX_CHARS).regex(/^[^\p{Cc}]*$/u),
```
In `recordDecision`, also run `stripNul` (or reject NUL) over the parsed spans before the insert, as a backstop for the fields Ollama supplies. The prompt hash changes, which needs a new prompt_version (D-29).

### WR-02: `sift config check` accepts a rules file with NUL or other control characters, but the worker then fails on every pass

**File:** `packages/core/src/rules/schema.ts:47`, `packages/core/src/rules/schema.ts:65-72`, `packages/core/src/rules/schema.ts:75-86`, `packages/core/src/rules/schema.ts:177-182`, `packages/db/src/classify.ts:173-192`
**Issue:** `oneLine` rejects only `\r` and `\n`. A YAML double-quoted `"\0"` (or `\x01`, `\u0085`, `\u2028`) in a description, judgment line, rule name or phrase passes validation, and `sift config check` prints `rules files valid`. In the worker, `ensureRuleSet` inserts the snapshot into `rule_set.snapshot` jsonb, and a NUL fails with 22P05 inside every decision's `session.run`. The mailbox decides nothing, and after five messages the pass throws, giving a generic `error: unsupported Unicode escape sequence` status that names neither the file nor the line. The owner explicitly wants no misleading errors. Other control characters reach the trusted system prompt unfiltered: `clean()` is applied only to the untrusted fields. U+2028 and U+0085 also break the "one line" promise for judgment lines.
**Fix:** In `oneLine`, `CategoryName` and `PhraseEntry`, reject `/[\p{Cc}\u2028\u2029]/u` (with `\t` either allowed or rejected explicitly) with a positioned message such as `description must not contain control characters`. Then `config check` and the worker agree.

### WR-03: Messages that fail on every pass are hidden: status shows `ok` and they stay pending with no owner-visible sign

**File:** `apps/worker/src/classify/run.ts:417-425`, `apps/worker/src/runtime/mailbox-batch.ts:469-473`
**Issue:** `classifyCandidates` counts failures inside one message (`state.failures`). `classifyMailbox` returns `done` with `failures > 0`, and `runBatch` writes `recordSyncSuccess`: state `ok`, `last_error` cleared. A message that fails deterministically (WR-01, or a pending message with no body, logged `body_missing` at run.ts:392) stays pending forever. Newest-first ordering brings it back first on every pass, it spends LLM budget again each time, and the only trace is a warn log line. The owner's mailbox list says everything is fine.
**Fix:** When `outcome.failures > 0`, record a non-error notice the owner can see, for example `ok; 3 messages could not be classified (see docker compose logs worker)`. Better, keep failing ids in memory per runtime and skip a message after K consecutive failed passes, so it stops consuming budget.

## Info

### IN-01: `body.original_chars` and the prompt's "first N of M characters" count the cleaned body, not the original

**File:** `packages/core/src/classify/prompt.ts:164-175`, `packages/core/src/classify/prompt.ts:183-194`
**Issue:** `truncateBody(clean(email.body))` reports `originalLength` after control characters are removed, CRLF is collapsed and runs of 3 or more newlines are collapsed. The span field is named `original_chars`, but a CRLF-heavy body reports far fewer characters than it has.
**Fix:** Rename it to `cleaned_chars` in the next trace format, or compute `original_chars` from `email.body.length`.

### IN-02: A path prefix in `models.url` is silently discarded

**File:** `apps/worker/src/classify/ollama-client.ts:155`, `apps/worker/src/classify/preflight.ts:56`
**Issue:** `new URL('/api/chat', baseUrl)` resolves to the root of the origin, so `http://host/ollama/` sends to `http://host/api/chat`. That is a different endpoint from the one the owner configured, and SEC-02 promises mail goes only to the configured model URL.
**Fix:** Use `new URL('api/chat', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)`, or reject a URL with a path in the config schema.

### IN-03: The preflight does not enforce a minimum Ollama version, although T-03-23 depends on the server honouring `truncate:false` and `shift:false`

**File:** `apps/worker/src/classify/preflight.ts:88-93`
**Issue:** An older Ollama ignores unknown request fields and truncates silently. Only the `prompt_eval_count >= num_ctx - num_predict` check (llm-tier.ts:116) remains as a heuristic backstop.
**Fix:** Compare `ollamaVersion` against the lowest version known to honour `truncate`, and fail as `model_unsuitable` with an upgrade hint.

### IN-04: `--since` and "after today" use UTC days, not the owner's

**File:** `apps/worker/src/commands/classify.ts:385-396`, `apps/worker/src/commands/classify.ts:439-440`
**Issue:** East of UTC, the owner's own date is rejected as "after today" for several hours after local midnight. Everywhere, the selected window is shifted by the UTC offset. The README says "received on or after that day".
**Fix:** State "UTC" in USAGE and the README, or interpret the date in `TZ`.

### IN-05: Mail content is sent over plain `http://` to any `models.url` host

**File:** `packages/core/src/config/schema.ts:183`, `apps/worker/src/classify/run.ts:100-106`
**Issue:** Phase 3 is the first phase that sends email text to `models.url`, and `HttpUrl` accepts `http://` for any host. The owner's stated rule is "never send credentials or data over an unverified connection". The default `host.docker.internal` is local, but a LAN host would receive mail in plaintext with no warning.
**Fix:** Allow `http://` only for loopback, `host.docker.internal` and container service names. Otherwise require `https://` or an explicit opt-in key.

### IN-06: After the lock connection is lost, `classifyCandidates` keeps sending mail to Ollama

**File:** `apps/worker/src/classify/run.ts:389-425`
**Issue:** Every throw counts as a failure inside one message, including a broken lock session (`IngestSession` connection error). Up to four more messages are sent to the LLM even though their decisions cannot be written, and the advisory lock is already gone on the server.
**Fix:** Rethrow at once for session or connection errors (for example `IngestSessionBusyError`, or a lost-lock flag), and count only errors confined to one message.

### IN-07: `loadRules` reads the whole file before checking the 256 KiB cap and blocks on a FIFO

**File:** `packages/core/src/rules/load.ts:57-70`, `packages/core/src/rules/load.ts:26-29`
**Issue:** `readFile` loads the entire file first. A huge file, or a named pipe at that path, makes the pass use a lot of memory or hang (the file belongs to the owner, so impact is low).
**Fix:** `stat` it first, and refuse anything that is not a regular file or is larger than `RULES_FILE_MAX_BYTES`.

---

_Reviewed: 2026-10-10T23:52:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
