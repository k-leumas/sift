---
phase: 03-tiered-classification-with-traces
reviewed: 2026-10-12T19:57:44Z
depth: deep
diff_base: 3431a5868e73483ea904ce27ba8f74e3b4398f50
files_reviewed: 43
files_reviewed_list:
  - apps/worker/src/classify/llm-tier.ts
  - apps/worker/src/classify/refetch.ts
  - apps/worker/src/classify/run.ts
  - apps/worker/src/commands/classify.ts
  - apps/worker/src/commands/mailbox-list.ts
  - apps/worker/src/runtime/mailbox-batch.ts
  - apps/worker/test/classify-batch.test.ts
  - apps/worker/test/classify-cli.test.ts
  - apps/worker/test/classify-control-chars.test.ts
  - apps/worker/test/classify-leak.test.ts
  - apps/worker/test/classify-llm-tier.test.ts
  - apps/worker/test/classify-refetch.test.ts
  - apps/worker/test/classify-run.test.ts
  - apps/worker/test/config-check-rules.test.ts
  - apps/worker/test/llm-baseline.test.ts
  - apps/worker/test/registry-cli.test.ts
  - apps/worker/test/support/classify-harness.ts
  - apps/worker/test/support/llm-baseline.ts
  - apps/worker/test/user-facing-text.test.ts
  - CONTRIBUTING.md
  - packages/core/src/classify/decide.ts
  - packages/core/src/classify/index.ts
  - packages/core/src/classify/llm-output.ts
  - packages/core/src/classify/spans.ts
  - packages/core/src/rules/schema.ts
  - packages/core/test/decide.test.ts
  - packages/core/test/llm-output.test.ts
  - packages/core/test/rules.test.ts
  - packages/core/test/spans.test.ts
  - packages/db/migrations/0011_decision_llm_error_reason.sql
  - packages/db/migrations/meta/_journal.json
  - packages/db/migrations/meta/0011_snapshot.json
  - packages/db/src/classify.ts
  - packages/db/src/index.ts
  - packages/db/src/ingest.ts
  - packages/db/src/schema/scoped.ts
  - packages/db/src/status.ts
  - packages/db/test/classify-schema.test.ts
  - packages/db/test/classify.test.ts
  - packages/db/test/ingest.test.ts
  - packages/db/test/scope.test.ts
  - packages/db/test/status.test.ts
  - README.md
findings:
  critical: 0
  warning: 4
  info: 12
  total: 16
status: issues_found
---

# Phase 3: Code Review Report (incremental, 3431a58..HEAD)

**Reviewed:** 2026-10-12T19:57:44Z
**Depth:** deep
**Files Reviewed:** 43
**Status:** issues_found

## Summary

This is an incremental review of the gap-closure plans 03-14 to 03-24 (`git diff 3431a58..HEAD`). I read every changed production file in full: `classify/run.ts`, `llm-tier.ts`, `refetch.ts`, `commands/classify.ts`, `commands/mailbox-list.ts`, `runtime/mailbox-batch.ts`, `core/classify/{decide,llm-output,spans}.ts`, `core/rules/schema.ts`, `db/src/{classify,ingest,status}.ts`, `schema/scoped.ts` and migration 0011 with its snapshot. I also traced the calls the fixes depend on: `ollama-client.ts` (`statusCode`, `LlmCallResult`), `runtime/supervisor.ts` and `backoff.ts` (pass spacing), `ingest/db-store.ts` (the `storeMessages` caller), `stripNul`, `deleteOrphanBodies` and the scoped `decision` API. I read the tests for the fixed findings to check that they assert the fixed behaviour, not just that code ran. I checked two claims against the running stack and Node 26.10.0 (results under WR-04 and WR-05).

The migration is consistent: the 0011 CHECK matches `scoped.ts:351`, `prevId` chains to 0010, and `REVIEW_REASONS`, `ATTEMPT_FAILURE_CODES`, `LlmVerdict` and the CHECK all list `llm_error`. No test is skipped or focused.

### Status of the earlier findings

| Earlier finding | Status | Notes |
|---|---|---|
| CR-01 poison message blocks the mailbox | **Resolved**, two residual defects | A 5xx or timeout with a healthy re-probe now skips only that message, and after 3 passes and a successful mail-free canary it becomes review `llm_error`. Residuals: the per-pass budget turns a third such message into a mailbox-wide outage (WR-06), and transient contention can become a permanent `llm_error` decision (WR-07). |
| CR-02 refetched bodies never expire | **Resolved** | `restoreBody` and `storeMessages` give a decided message's new body `at + 7 d` at write time; `recordDecision` still only sets a null expiry, so nothing extends it. Clock nit: IN-09. |
| CR-03 valve approval survives a throwing pass | **Resolved** | `recordIngestSynced` clears held and approved counts and moves `last_sync_at` inside the ingest lock (`mailbox-batch.ts:418-422`). The needs_attention to ok move keeps `mailbox_status_held_check` satisfied. |
| WR-01 NUL in the model reason | **Resolved for control characters**, residual WR-04 | A lone UTF-16 surrogate from a JSON escape fails the same insert the same way. |
| WR-02 control characters in rules.yaml | **Resolved for control characters**, residual WR-05 | A lone surrogate from a YAML escape still passes `config check` and then fails every rule_set write. |
| WR-03 hidden repeat failures | **Resolved** | `ok; N messages could not be classified (ids: ...)` plus `llm_error` for Ollama failures. A message that *throws* (WR-04) is still retried with a fresh LLM call on every pass, but it is now visible. |
| IN-01 .. IN-07 | **Open, unchanged** | None of their files changed (`prompt.ts`, `ollama-client.ts:155`, `preflight.ts`, `config/schema.ts`, `rules/load.ts:60`); IN-06 is still in `run.ts:617-626`. Carried forward below. |

New findings are numbered from WR-04 and IN-08, so the earlier ids keep their own rows in 03-REVIEW-DISPOSITION.md (the resolved ones can be set to `fixed`).

## Warnings

### WR-04: A model reason that contains a lone UTF-16 surrogate cannot be stored, so that message fails on every pass (WR-01 residual)

**File:** `packages/core/src/classify/llm-output.ts:55`, `packages/core/src/classify/llm-output.ts:94`, `packages/db/src/classify.ts:137`, `apps/worker/src/classify/run.ts:617-625`
**Issue:** WR-01 is fixed for `\p{Cc}`, but jsonb has a second class of string it refuses. The llama.cpp JSON grammar allows any four-hex-digit unicode escape, so the model can write a reason that ends in the escape for U+D800. `JSON.parse` turns that into a lone high surrogate. `REASON_CONTROL_CHARACTERS` does not match it, because surrogates are category Cs, not Cc. Zod's `string().trim().min(1).max(200)` accepts it, `decide()` copies it into `spans[2].result.reason`, and `stripNul` does not touch it. The driver's `JSON.stringify` writes it back as the same escape, and PostgreSQL rejects it. I verified both steps:
- Node 26.10.0: `JSON.parse` of that reason gives `isWellFormed() === false`, and the control-character regex returns `false`.
- sift-db-1: casting `{"r":"a<U+D800 escape>b"}` to jsonb fails with `invalid input syntax for type json`, `DETAIL: Unicode low surrogate must follow a high surrogate`. A valid surrogate pair (an emoji) is accepted.

The effect matches the old WR-01. At temperature 0 with a fixed seed the answer repeats, so the message stays pending and costs one or two LLM calls on every pass forever. It is logged only as `classify: message failed`. Five such messages in a row reach `MAX_CONSECUTIVE_MESSAGE_FAILURES`, and the pass throws on every batch: generic `error` status and backoff. An email can ask for it on purpose ("end your reason with that escape"). WR-03's notice now shows the id, but nothing stops the repeated LLM spend. `classify-control-chars.test.ts` covers NUL, BEL and U+2028 only.
**Fix:** Reject ill-formed strings in the same code-only check, so the answer is `schema_mismatch`: one retry, then `review invalid_output`. Use property escapes so the source holds no raw escapes:
```ts
export const REASON_CONTROL_CHARACTERS = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;
// or, in validateLlmOutput:
if (!result.data.reason.isWellFormed() || REASON_CONTROL_CHARACTERS.test(result.data.reason)) { ... }
```
As a backstop in `recordDecision`, apply `toWellFormed()` next to `stripNul` for the Ollama-supplied strings (`raw`, `thinking`, `done_reason`, `response_model`). Add a test with a reason holding a lone surrogate.

### WR-05: A rules file with a lone surrogate passes `sift config check`, then every decision of that mailbox fails (WR-02 residual)

**File:** `packages/core/src/rules/schema.ts:59`, `packages/core/src/rules/schema.ts:76-78`, `packages/db/src/classify.ts:173-192`
**Issue:** `CONTROL_CHARACTERS` matches `\p{Cc}` plus U+2028 and U+2029 only. A YAML double-quoted string can hold a unicode escape for a lone surrogate. I verified that `yaml` 2.9.1 (the version `@sift/core` pins) parses `description: "Bills <U+D800 escape> here"` into a string with `isWellFormed() === false`. `oneLine` (descriptions, judgment lines, rule names) and the `noControl` entry checks (from, domain, phrase) all accept it; only `CategoryName` is safe, because `CATEGORY_NAME_PATTERN` is ASCII-only. `config check` prints `rules files valid`. In the worker, `ensureRuleSet` inserts `rules.version.snapshot` into `rule_set.snapshot` jsonb, and PostgreSQL rejects it as in WR-04. That insert runs inside every decision's `session.run` (`run.ts:598-609`), exact-rule decisions included. So the mailbox decides nothing: each LLM-bound message first spends its chat call, five failures in a row throw, and status shows `error: invalid input syntax for type json`. That names neither the file nor the line. The owner's "no misleading errors" rule and WR-02's goal (config check and the worker agree) are not met for this input.
**Fix:** Treat ill-formed text like a control character in the one shared predicate:
```ts
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]/u;
function noControl(value: string): boolean {
  return value.isWellFormed() && !CONTROL_CHARACTERS.test(value);
}
```
Use `noControl` in `oneLine`'s superRefine too, and add a `rules.test.ts` and a `config-check-rules.test.ts` case for a lone surrogate.

### WR-06: A third message Ollama fails on alone in one pass is declared an outage with no re-probe: error status, backoff and delayed IMAP polling (CR-01 residual)

**File:** `apps/worker/src/classify/run.ts:497-500`, `apps/worker/src/classify/run.ts:551-552`, `apps/worker/src/runtime/mailbox-batch.ts:502-504`, `README.md:93`
**Issue:** The budget check `state.ollamaFailed.length < OLLAMA_MESSAGE_FAILURES_PER_PASS` (2) runs *before* the re-probe. A third 5xx or timeout in the pass skips the re-probe and goes straight to `state.llmBlocked` with the chat's result. The pass then returns `infra`, `runBatch` throws `ClassifyInfraError`, and the supervisor backs off by `intervalMs * 2^failures` up to 15 min. Ingest shares the batch, so IMAP polling slows down too. The third message is never counted in `messageFailures`. Simulation with three or more messages that each fail alone (for example three long newsletters that time out on a CPU-only host, the README's target hardware):
- Passes 1 and 2: A and B are counted, C is an outage.
- Pass 3: A and B become `llm_error`, C is an outage.
- Passes 4 to 6: the same for C, D and E.

Every one of those passes shows `error: Ollama at ... failed (HTTP 500); see the Ollama log` (or `unreachable ... (timeout after 120 s)`), which blames a healthy Ollama. Older LLM-bound mail waits behind the backoff. With k such messages, the mailbox spends about 3k/2 passes in error and backoff. If such mail arrives faster than two per three passes, the state is permanent. This is the CR-01 symptom set (misleading status, degraded ingest cadence) that the fix was meant to remove. It also contradicts README.md:93 ("the other mail is still classified, the mailbox stays ok"). The budget's stated purpose, catching a runner that crashes on every prompt while `/api/tags` answers, is already met by the canary. The CLI hits the same branch: `sift classify` exits 1 with that outage text on the third such message.
**Fix:** When the budget is spent, check with the canary instead of assuming an outage. If the canary succeeds, stop LLM work for this pass without blocking, so the pass ends `done` with the notice:
```ts
if (MESSAGE_FAILURE_CODES.includes(result.code) && state.ollamaFailed.length >= OLLAMA_MESSAGE_FAILURES_PER_PASS) {
  const canary = await canaryChat(ctx);
  if (canary.kind === 'aborted') return { kind: 'aborted' };
  if (canary.kind === 'ok') {
    state.llmDeferred = true;           // new flag: draftFor skips LLM-bound mail, pass stays 'done'
    markUnclassified(state, candidate.id);
    return { kind: 'skip' };
  }
  state.llmBlocked = /* canary result */;
  return { kind: 'skip' };
}
```
Also count the message in `messageFailures` on that path, and say in README.md:93 what happens past two such messages in one pass.

### WR-07: `llm_error` can be written after a few minutes of transient Ollama contention, and that decision is permanent for the worker

**File:** `apps/worker/src/classify/run.ts:504-541`, `apps/worker/src/classify/run.ts:105-111`
**Issue:** The terminal condition is "`messageFailures` reached 3, the current re-probe is healthy, and a canary chat succeeds". It has no time span and needs no evidence that Ollama handles *real* prompts in between. The passes are only about one poll interval apart (60 s by default, `supervisor.ts:223-224`), so three failed attempts can happen within roughly 3 to 10 minutes. Contention can produce a failure that `/api/tags` and a tiny canary do not see. The owner's other Ollama clients may hold the runner, so Sift's 8192-context prompt waits in Ollama's queue past the 120 s timeout. A model swap (`OLLAMA_MAX_LOADED_MODELS=1`) can also force a reload on every call. In those cases a short canary often succeeds once the queue drains. The newest LLM-bound message then becomes `review llm_error` (`decided_by = worker`). That decision is append-only, `decision_one_worker_per_message` forbids a second worker decision, and nothing reclassifies automatically. Only an owner `sift classify` re-run undoes it. The counter is also never pruned or reset for a message that stops being a candidate and later returns (IN-10). Failures days apart therefore add up to the same three.
**Fix:** Require evidence that the failure belongs to the message and not to the moment:
- Keep `{ passes, firstFailedAt }` per id, and require `now - firstFailedAt >= MESSAGE_FAILURE_MIN_SPAN_MS` (for example 1 h) before the terminal step.
- Or require that some *other* message's real chat succeeded in this process after this message's first failure.

Either keeps the owner's option-review behaviour for a true poison message and stops a busy hour from filing mail as review. Document the span in README.md:93.

## Info

### IN-08: After a failed re-probe, the outage reports the chat's code, not the probe's fresher diagnosis

**File:** `apps/worker/src/classify/run.ts:501-503`, `apps/worker/src/classify/run.ts:551`
**Issue:** When the re-probe returns `infra` (for example `unreachable` with `ECONNREFUSED` because Ollama died during the call, or `model_missing`), the probe result is dropped. `llmBlocked` is set from the chat result, so status says `Ollama unreachable ... (timeout after 120 s)` or `failed (HTTP 500)` instead of `ECONNREFUSED` or the `ollama pull` hint.
**Fix:** `if (probe.kind === 'infra') { state.llmBlocked = { code: probe.code, status: probe.status, detail: probe.detail }; return { kind: 'skip' }; }`

### IN-09: The CR-02 expiry uses the wall clock while decisions and the sweep use the injected clock

**File:** `apps/worker/src/classify/refetch.ts:76-82`, `apps/worker/src/ingest/db-store.ts:144-146`, `packages/db/src/classify.ts:239`, `packages/db/src/ingest.ts:193`
**Issue:** `restoreBody(..., at = new Date())` and `storeMessages(..., { at })` default to `new Date()`, and neither caller passes its `now` (`ctx.now` in the CLI, `ingest.now` in the batch). Production is unaffected. Under a fake clock, though, a restored body's expiry is unrelated to the decision time and the sweep time, so CR-02 tests depend on how the wall clock relates to the injected clock.
**Fix:** Thread the caller's clock: `restoreBody(s, candidate.id, body, now())` and `storeMessages(scope, items, { promoteEligible, at: now() })`.

### IN-10: `done.ollamaFailed` is unused, and `messageFailures` entries are never removed for messages that stop being candidates

**File:** `apps/worker/src/classify/run.ts:305-309`, `apps/worker/src/classify/run.ts:745`, `apps/worker/src/classify/run.ts:152-156`
**Issue:** No production code reads `ClassifyOutcome.done.ollamaFailed` (only tests do). `messageFailures` entries are deleted only when a decision commits. A message that is moved out of the folder or loses its location keeps its count for the life of the process, and that feeds WR-07.
**Fix:** Drop the field, or log it from `mailbox-batch.ts`. Prune `messageFailures` to the ids the pass saw as candidates, or store a timestamp and expire old entries.

### IN-11: A busy or aborted pass clears the unclassified notice although nothing was rechecked

**File:** `apps/worker/src/runtime/mailbox-batch.ts:487-490`
**Issue:** `recordSyncSuccess(scope, syncedAt)` with no notice clears `last_error`. While `sift classify` holds the lock, or after a shutdown mid-pass, the list goes back to plain `ok` even though the failing ids are still pending.
**Fix:** For busy and aborted, write only `state: 'ok'` and leave `last_error` unchanged, or carry the previous notice forward.

### IN-12: README security bullet has a garbled tense

**File:** `README.md:391`
**Issue:** "Sift applies labels and (later will) write **drafts**". It is ungrammatical, and the README intro says labels are not applied in Proton yet.
**Fix:** "Sift will apply labels and, later, write **drafts**. It never sends, deletes or forwards mail."

### IN-01 (carried forward, unchanged): `body.original_chars` counts the cleaned body

**File:** `packages/core/src/classify/prompt.ts` (unchanged since 3431a58)
**Issue/Fix:** As in the previous report: rename it to `cleaned_chars` in the next trace format, or compute it from `email.body.length`.

### IN-02 (carried forward, unchanged): A path prefix in `models.url` is discarded

**File:** `apps/worker/src/classify/ollama-client.ts:155`, `apps/worker/src/classify/preflight.ts`
**Issue/Fix:** `new URL('/api/chat', baseUrl)` still resolves to the origin root. Resolve it relative to a base that ends in a slash, or reject a URL with a path.

### IN-03 (carried forward, unchanged): No minimum Ollama version check for `truncate:false`/`shift:false`

**File:** `apps/worker/src/classify/preflight.ts`
**Issue/Fix:** As before: compare `ollamaVersion` with the first version that honours both flags, and fail as `model_unsuitable` below it.

### IN-04 (carried forward, unchanged): `--since` and "after today" use UTC days

**File:** `apps/worker/src/commands/classify.ts` (date parsing unchanged)
**Issue/Fix:** State UTC in USAGE and the README, or interpret the date in `TZ`.

### IN-05 (carried forward, unchanged): Mail is sent over plain `http://` to any `models.url` host

**File:** `packages/core/src/config/schema.ts`
**Issue/Fix:** Allow `http://` only for loopback, `host.docker.internal` and Compose service names; otherwise require `https://` or an explicit opt-in.

### IN-06 (carried forward, unchanged): After the lock connection is lost, `classifyCandidates` keeps sending mail to Ollama

**File:** `apps/worker/src/classify/run.ts:617-626`
**Issue/Fix:** Every throw still counts as a failure confined to one message, so up to four more messages are sent to the LLM even though their decisions cannot be written. Rethrow at once for session or connection errors.

### IN-07 (carried forward, unchanged): `loadRules` reads the whole file before the size cap and blocks on a FIFO

**File:** `packages/core/src/rules/load.ts:60`
**Issue/Fix:** `stat` first, and refuse anything that is not a regular file or is larger than `RULES_FILE_MAX_BYTES`.

---

_Reviewed: 2026-10-12T19:57:44Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
