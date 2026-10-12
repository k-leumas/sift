---
phase: 03-tiered-classification-with-traces
reviewed: 2026-10-12T22:20:35Z
depth: deep
diff_base: 499cdd901bca4ef76748b5bba9d323eae47e54c0
files_reviewed: 9
files_reviewed_list:
  - apps/worker/test/classify-control-chars.test.ts
  - apps/worker/test/config-check-rules.test.ts
  - packages/core/src/classify/llm-output.ts
  - packages/core/src/rules/schema.ts
  - packages/core/test/llm-output.test.ts
  - packages/core/test/rules.test.ts
  - packages/db/src/classify.ts
  - packages/db/src/ingest.ts
  - packages/db/test/classify.test.ts
findings:
  critical: 0
  warning: 2
  info: 16
  total: 18
status: issues_found
---

# Phase 3: Code Review Report (incremental, 499cdd9..HEAD)

**Reviewed:** 2026-10-12T22:20:35Z
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This is an incremental review of the gap-closure plans 03-25 (WR-04) and 03-26 (WR-05), `git diff 499cdd9..HEAD`. Only the nine files listed above changed under `apps/` and `packages/`. `run.ts`, `llm-tier.ts`, `prompt.ts`, `preflight.ts`, `refetch.ts`, `mailbox-batch.ts` and `README.md` are unchanged, so every earlier open finding in those files is carried forward unchanged.

I read the four changed production files in full. I also traced the paths the fixes depend on:
- `llm-tier.ts:174-191`: the validator call site and the retry note.
- `prompt.ts:55-61`: `RETRY_NOTE`.
- `spans.ts`: the attempt and llm span schemas.
- `rules/load.ts` and `rules/hash.ts`: how the snapshot is built.
- `preflight.ts:31-111`: the model-name match.
- `config/schema.ts:180-187`: `models.llm`.
- `ingest/message.ts:61-63, 283`: where mail text is already made well-formed.
- The jsonb columns in `schema/scoped.ts` and `prompt-version.ts`.

I ran the five test files in scope against the running stack: 180 passed. `pnpm typecheck` passed, and `biome ci` passed on the nine files. With a scratch script on Node 26.10.0 I also probed:
- `\U0000D800`
- a lone surrogate in an unknown key and in a `label`
- a surrogate pair split by `\0`
- a tab plus a lone surrogate in a phrase
- an over-long value that also holds a lone surrogate
- the `wellFormed` walk over a Date, `undefined` and a `Uint8Array`

The results are cited below.

Both target findings are resolved. No BLOCKER is introduced. The new findings are all Info: a retry note that gives the model the wrong reason (IN-13), a silent repair of `raw` that the trace cannot show (IN-14), a docstring that claims one issue per value but can report two (IN-15), and an ASCII-only guarantee that the rule set relies on without saying so (IN-16).

### Status of the earlier findings

| Earlier finding | Status | Notes |
|---|---|---|
| WR-04 lone surrogate in the model reason | **Resolved** | `llm-output.ts:110-112` rejects a reason that is not well-formed after JSON.parse and trim. The failure is `schema_mismatch` with the fixed detail `reason: lone_surrogate`: one retry, then `review invalid_output` (`llm-tier.ts:182-189`). The backstop `wellFormed(stripNul(parseDecisionSpans(...)))` (`classify.ts:145`) covers every string in the spans, including `model_digest` and `ollama_version`, which the docstring does not name. The end-to-end test asserts `llmCalls: 11`, `failures: 0` and nothing pending for five bad messages plus one good one, which is the old `MAX_CONSECUTIVE_MESSAGE_FAILURES` trigger. The test would also catch a validator regression the backstop could hide: without the validator the reason would be repaired to U+FFFD and stored as `labelled Noise`, and the test asserts `review invalid_output`. Other jsonb writers of untrusted text are safe: mail headers, subject and body are already passed through `toWellFormed()` at ingest (`message.ts:63, 283`). Text columns are encoded by node-postgres as UTF-8 with replacement, so they cannot fail. |
| WR-05 lone surrogate in rules.yaml | **Resolved** | `oneLine` (`schema.ts:120-122`) and the from, domain and phrase entries (`schema.ts:217, 228, 239`) all reject it. The remaining strings are safe without the check: `CategoryName` uses the ASCII pattern, `label` must equal a category name (probe: `label "I\ud800" is not one of the categories`), and `version` and `in` are literals or enums. An unknown key is rejected by `strictObject`. The 8-digit form `\U0000D800` is caught too (probe). `config check` and the worker share `parseRulesText`, and `config-check-rules.test.ts` pins exit 1 with the file, line and YAML path. The rule-set hash of a valid file is unchanged. |
| WR-06, WR-07 | **Open, unchanged** | `run.ts` is unchanged since 499cdd9. Carried forward below. |
| IN-01 .. IN-12 | **Open, unchanged** | None of their files changed. Carried forward below. |

New findings are numbered from IN-13, so no earlier id is reused (03-REVIEW-DISPOSITION.md drops a row whose id is reused). WR-04 and WR-05 can be set to `fixed` (03-25, 03-26).

## Warnings

### WR-06 (carried forward, unchanged): A third message Ollama fails on alone in one pass is declared an outage with no re-probe

**File:** `apps/worker/src/classify/run.ts:497-500`, `apps/worker/src/classify/run.ts:551-552`, `apps/worker/src/runtime/mailbox-batch.ts:502-504`, `README.md:93`
**Issue:** The budget check `state.ollamaFailed.length < OLLAMA_MESSAGE_FAILURES_PER_PASS` (2) runs before the re-probe. A third 5xx or timeout in the same pass goes straight to `state.llmBlocked`. The pass returns `infra`, so the mailbox shows error status and backs off, and IMAP polling slows down with it. The status text blames a healthy Ollama. This contradicts README.md:93. The full analysis is in the previous report (diff base 3431a58).
**Fix:** When the budget is spent, run the canary instead of assuming an outage. If the canary succeeds, stop LLM work for the pass without blocking it, and count the message in `messageFailures`:
```ts
if (MESSAGE_FAILURE_CODES.includes(result.code) && state.ollamaFailed.length >= OLLAMA_MESSAGE_FAILURES_PER_PASS) {
  const canary = await canaryChat(ctx);
  if (canary.kind === 'aborted') return { kind: 'aborted' };
  if (canary.kind === 'ok') { state.llmDeferred = true; markUnclassified(state, candidate.id); return { kind: 'skip' }; }
  state.llmBlocked = /* canary result */;
  return { kind: 'skip' };
}
```

### WR-07 (carried forward, unchanged): `llm_error` can be written after a few minutes of transient Ollama contention, and that decision is permanent for the worker

**File:** `apps/worker/src/classify/run.ts:504-541`, `apps/worker/src/classify/run.ts:105-111`
**Issue:** The terminal condition has no minimum time span. It is three failed passes, then a healthy re-probe, then a successful tiny canary. Passes run about one poll interval apart, so queue contention or a model swap can turn the newest LLM-bound message into a `review llm_error` decision within minutes. `decision_one_worker_per_message` then forbids a second worker decision.
**Fix:** Keep `{ passes, firstFailedAt }` per id and require `now - firstFailedAt >= MESSAGE_FAILURE_MIN_SPAN_MS` (for example 1 h). Alternatively, require that another message's real chat succeeded after this message's first failure. Document the rule in README.md:93.

## Info

### IN-13: The retry after a `control_character` or `lone_surrogate` rejection tells the model the wrong reason, so the one retry is likely wasted

**File:** `packages/core/src/classify/prompt.ts:59-60`, `apps/worker/src/classify/llm-tier.ts:182-191`, `packages/core/src/classify/llm-output.ts:104-112`
**Issue:** Both new rejections reuse the code `schema_mismatch`, so the retry prompt carries `RETRY_NOTE.schema_mismatch`: "Your previous answer had a missing or out-of-range value. Confidence must be between 0 and 1." For a reason holding a JSON escape for U+D800 (or NUL, BEL, U+2028), that note names a problem the answer does not have. The cause, often an email that asks for the escape, is still in the prompt, so at temperature 0 the second attempt is likely to repeat it. The message then goes to `review invalid_output` instead of being labelled. Behaviour is safe (WR-04 is closed), but the retry does not help here. 03-25-SUMMARY records keeping the prompt hash unchanged as a deliberate choice; this finding records the cost of that choice.
**Fix:** In the next prompt version, give these failures their own retry note. For example, add a retry code `reason_text` that maps to "Your previous reason contained an escape sequence or control character. Write the reason as plain text on one line." Alternatively, widen the `schema_mismatch` note to cover the reason. Either way the prompt_version changes.

### IN-14: The `wellFormed` backstop silently changes `raw`, and nothing in the trace records it, so such an attempt cannot be replayed faithfully

**File:** `packages/db/src/classify.ts:131-145`, `packages/core/src/classify/spans.ts` (`LlmAttemptSpanSchema.raw`: "`message.content` verbatim")
**Issue:** When the server's HTTP JSON carries a real unpaired surrogate in `message.content` (a non-Go server or a proxy; Go's encoder never emits one), `validateLlmOutput` stores `validation: { ok: false, detail: 'reason: lone_surrogate' }`. The backstop then stores `raw` with U+FFFD in its place. A replay of that stored `raw` gives `ok: true`, which contradicts the recorded validation. The span has no flag that says it was repaired, so a Phase 4 trace viewer or replay check cannot tell a repaired attempt from a real mismatch. The docstring accepts that the stored text differs from what the server sent. It does not cover the missing signal. Unreachable with real Ollama.
**Fix:** Before the insert, compare the repaired spans with the parsed ones. When they differ, log a count-only warning (`recordDecision: repaired N ill-formed strings in the spans`). In the next trace format, add an attempt field such as `raw_repaired: boolean` so a replay can skip the equality check for that attempt.

### IN-15: `oneLine` claims "one issue per value, first match wins", but an over-long value with a lone surrogate gets two issues; the "cannot drift" claim is not enforced

**File:** `packages/core/src/rules/schema.ts:103-108`, `packages/core/src/rules/schema.ts:94`, `packages/core/src/classify/llm-output.ts:88-89`
**Issue:**
- Zod 4 runs `.max()` and the `superRefine` on the same value. A 205-character description holding the escape for U+D800 is reported twice, as `description must be at most 200 characters` and `description must not contain an unpaired surrogate ...` (probe). The same was already true for control characters. The updated docstring now states "One issue per value, first match wins", and that claim is wrong.
- `llm-output.ts:88-89` says the two checks use the same predicate, "so the worker and config check cannot drift". In fact they are two separate calls to the built-in method, and nothing ties them together. The worker and `config check` agree because both use `RulesFile`, not because of the LLM validator.

**Fix:** Change the docstring to "one character-class issue per value: a line break, then a control character, then an unpaired surrogate". If one issue per value is required, check the length inside the `superRefine` as the last branch. Drop the "cannot drift" sentence, or export one `isStorableText(value)` helper from `@sift/core` and use it in both places.

### IN-16: The rule-set snapshot is protected only by the schema, and `CategoryName` and `label` are safe only because the category-name pattern is ASCII

**File:** `packages/core/src/rules/schema.ts:39`, `packages/core/src/rules/schema.ts:127-138`, `packages/core/src/rules/schema.ts:287-289`, `packages/db/src/classify.ts:186-205`
**Issue:** `ensureRuleSet` writes `version.snapshot` to jsonb with no check, unlike `recordDecision`. `CategoryName` and `label` have no surrogate check. They are safe today only because `CATEGORY_NAME_PATTERN` is ASCII and `label` must equal a name. The schema's own docstring plans to widen names to Unicode letters in Phase 4. A widened pattern written without the `u` flag (for example a `[^/ ]` class) would accept a lone surrogate and reopen WR-05 with no failing test. A repair is not an option at that point, because the snapshot must hash back to the validated object.
**Fix:** Add `noUnpairedSurrogate` to `CategoryName` now; it costs nothing. Also add a `rules.test.ts` case for a category name holding the escape for U+D800 (it is rejected today by the pattern). Optionally, have `ensureRuleSet` throw a clear error (`rule set snapshot is not well-formed text`) when `!JSON.stringify(snapshot).isWellFormed()` would fail. That error is easier to act on than jsonb's `invalid input syntax for type json`.

### IN-08 (carried forward, unchanged): After a failed re-probe, the outage reports the chat's code, not the probe's fresher diagnosis

**File:** `apps/worker/src/classify/run.ts:501-503`, `apps/worker/src/classify/run.ts:551`
**Issue/Fix:** `if (probe.kind === 'infra') { state.llmBlocked = { code: probe.code, status: probe.status, detail: probe.detail }; return { kind: 'skip' }; }`

### IN-09 (carried forward, unchanged): The CR-02 expiry uses the wall clock while decisions and the sweep use the injected clock

**File:** `apps/worker/src/classify/refetch.ts:76-82`, `apps/worker/src/ingest/db-store.ts:144-146`, `packages/db/src/classify.ts:247`, `packages/db/src/ingest.ts:215`
**Issue/Fix:** Pass the caller's clock: `restoreBody(s, candidate.id, body, now())` and `storeMessages(scope, items, { promoteEligible, at: now() })`. The `classify.ts` and `ingest.ts` line numbers moved in this diff, but the defaults to `new Date()` are unchanged.

### IN-10 (carried forward, unchanged): `done.ollamaFailed` is unused, and `messageFailures` entries are never removed for messages that stop being candidates

**File:** `apps/worker/src/classify/run.ts:305-309`, `apps/worker/src/classify/run.ts:745`, `apps/worker/src/classify/run.ts:152-156`
**Issue/Fix:** Drop the field or log it. Prune `messageFailures` to the ids the pass saw as candidates, or expire entries by timestamp.

### IN-11 (carried forward, unchanged): A busy or aborted pass clears the unclassified notice although nothing was rechecked

**File:** `apps/worker/src/runtime/mailbox-batch.ts:487-490`
**Issue/Fix:** For busy and aborted, write only `state: 'ok'` and leave `last_error` unchanged.

### IN-12 (carried forward, unchanged): README security bullet has a garbled tense

**File:** `README.md:391`
**Issue/Fix:** "Sift will apply labels and, later, write **drafts**. It never sends, deletes or forwards mail."

### IN-01 (carried forward, unchanged): `body.original_chars` counts the cleaned body

**File:** `packages/core/src/classify/prompt.ts`
**Issue/Fix:** Rename it to `cleaned_chars` in the next trace format, or compute it from `email.body.length`.

### IN-02 (carried forward, unchanged): A path prefix in `models.url` is discarded

**File:** `apps/worker/src/classify/ollama-client.ts:155`, `apps/worker/src/classify/preflight.ts`
**Issue/Fix:** `new URL('/api/chat', baseUrl)` resolves to the origin root, so any path prefix is lost. Resolve relative to a base that ends in a slash, or reject a URL that has a path.

### IN-03 (carried forward, unchanged): No minimum Ollama version check for `truncate:false`/`shift:false`

**File:** `apps/worker/src/classify/preflight.ts`
**Issue/Fix:** Compare `ollamaVersion` with the first version that honours both flags, and fail as `model_unsuitable` below it.

### IN-04 (carried forward, unchanged): `--since` and "after today" use UTC days

**File:** `apps/worker/src/commands/classify.ts`
**Issue/Fix:** State UTC in USAGE and the README, or interpret the date in `TZ`.

### IN-05 (carried forward, unchanged): Mail is sent over plain `http://` to any `models.url` host

**File:** `packages/core/src/config/schema.ts`
**Issue/Fix:** Allow `http://` only for loopback, `host.docker.internal` and Compose service names. Otherwise require `https://` or an explicit opt-in.

### IN-06 (carried forward, unchanged): After the lock connection is lost, `classifyCandidates` keeps sending mail to Ollama

**File:** `apps/worker/src/classify/run.ts:617-626`
**Issue/Fix:** Every throw still counts as a failure of one message. Rethrow at once on session or connection errors. 03-25-SUMMARY records this throw path as a known residual.

### IN-07 (carried forward, unchanged): `loadRules` reads the whole file before the size cap and blocks on a FIFO

**File:** `packages/core/src/rules/load.ts:60`
**Issue/Fix:** Call `stat` first, and refuse anything that is not a regular file or is larger than `RULES_FILE_MAX_BYTES`.

---

_Reviewed: 2026-10-12T22:20:35Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
