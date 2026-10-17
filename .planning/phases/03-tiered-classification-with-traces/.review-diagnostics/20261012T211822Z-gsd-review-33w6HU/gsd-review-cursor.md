# Cross-AI Plan Review: Phase 03 Gap Closure (03-25, 03-26)

Scope: only plans **03-25** and **03-26**, verified against `/Users/samuel/dev/sift` source and `.planning/phases/03-tiered-classification-with-traces/03-VERIFICATION.md` (gap `gaps[0]`, WR-04 / WR-05).

---

## 03-25

### Summary

Plan 03-25 correctly closes the worker-side SC5 / CLS-06 gap (WR-04): reject unpaired-surrogate reasons in `validateLlmOutput` as `schema_mismatch` / `reason: lone_surrogate` (retry then `invalid_output`), add a `wellFormed` backstop beside `stripNul` in `recordDecision`, and prove the five-in-a-row throw with an end-to-end test. Claims about current code match the repo (`llm-output.ts:55-100`, `classify.ts:137`, `run.ts:617-625`, `MAX_CONSECUTIVE_MESSAGE_FAILURES = 5` at `run.ts:83`). Leaving `run.ts` unchanged is sound for this defect: after the check, the bad reason never reaches `spans[].result` (`decide.ts:127-133` sets `result: null` on review), and Ollama-supplied strings are covered by the backstop.

### Strengths

- Mirrors the proven WR-01 shape (03-16): boundary reject, never repair the reason; same retry path in `llm-tier.ts:174-189` for any `validateLlmOutput` failure.
- Chooses `isWellFormed()` with a distinct detail instead of stuffing Cs into `REASON_CONTROL_CHARACTERS` — keeps WR-01 semantics accurate and shares the predicate with 03-26.
- Correctly refuses to change `llmOutputSchema` / prompt material (`prompt-version.ts:76` builds `schemaShape` from `ollamaFormat(llmOutputSchema(...))`).
- End-to-end case (five bad + one older, `failures: 0`, `llmCalls: 11`, no `classify: message failed`) is the VERIFICATION reproduction turned into a regression; `11 = 5×2 + 1` matches `run.ts:523/554` decrementing by `attempts.length`.
- Backstop placement matches mail ingest precedent (`message.ts:62-63` `stripNul` then `toWellFormed`); `assertConsistent` compares `input.model` to `llm.model`, not `response_model` (`classify.ts:91-93`), so repairing `response_model` does not break consistency checks.
- Threat T-03-79/80 and the deliberate “no new review reason / no migration” scope are well reasoned against the verifier’s missing list.

### Concerns

- **LOW — Full “no insert can fail from text” story depends on 03-26.** The run.ts decision text assumes loadRules rejects bad rules (`03-25-PLAN.md` objective). Until 03-26 lands, `ensureRuleSet` at `run.ts:598-599` / `classify.ts:187-193` can still throw on `rule_set.snapshot` jsonb. Scoped correctly as parallel WR-05, but SC5 is not fully closed by 03-25 alone.
- **LOW — Deep `wellFormed` walks every span string**, not only the four Ollama fields named in the must-haves. Harmless (and stronger), but slightly broader than the WR-04 write-up.
- **LOW — `estimate.confidence: low`** is honest; mutation-proof and RED SQLSTATE steps are necessary for a gap this subtle.

### Suggestions

- In the SUMMARY, record whether Task 1 case (c) failed with a thrown `Failed query` vs `failures > 0` when the check was disabled — both are acceptable `fails_when`, but the VERIFICATION repro threw.
- Keep the ASCII / `String.fromCharCode` discipline; cerebrum already documents Write/Edit and biome `\u` pitfalls.

### Risk Assessment

**LOW.** Small, well-bounded change on the existing WR-01 path; no schema/migration/prompt-hash risk; e2e test targets the exact failure mode. Residual risk is only that 03-26 must also land for the rules half of SC5.

---

## 03-26

### Summary

Plan 03-26 correctly closes the owner-side residual (WR-05): same `isWellFormed()` predicate in the rules schema for `oneLine` and from/domain/phrase entries, reject-never-repair, config-check + worker via shared `loadRules` (`config-check.ts:24`, `run.ts:232`). Current gap is real: `CONTROL_CHARACTERS` at `schema.ts:59` is Cc + separators only; `oneLine` at `schema.ts:92-98` has no well-formedness branch; category names are already ASCII-safe (`CATEGORY_NAME_PATTERN` at `schema.ts:39`). Separate message text (vs folding into `noControl` as the review sketch suggested) is the better owner-facing choice and preserves WR-02 tests.

### Strengths

- Correct fields: description / judgment / name via `oneLine`; from / domain / phrase via refine after `noControl` (`schema.ts:187-213`); category names and labels correctly skipped.
- Explicit one-issue precedence in `oneLine` (line break → control → unpaired) matches existing WR-02 tests (`rules.test.ts:496-503`).
- No `ensureRuleSet` repair — fail closed as `rules_invalid` before any insert (D-05), matching `loadMailboxRules` at `run.ts:230-239`.
- Parallel-safe: no file overlap with 03-25.
- Config-check tracer mirrors the WR-02 case at `config-check-rules.test.ts:153-165` with runtime-built `\uD800` escapes.

### Concerns

- **MEDIUM — Acceptance criterion overcounts existing `it(` tests.** Task 1 AC: `grep -c "it(" apps/worker/test/config-check-rules.test.ts` “at least 9 (8 existing + 1)”. The file currently has **7** `it(` calls (lines 113, 123, 136, 153, 168, 177, 187). After one new case the count is 8, so a correct implementation fails this AC. Fix the expected count to 8 (7 + 1) before or during execute.
- **LOW — Entry fields lack dual-defect precedence.** Two `.refine()` calls can yield two issues if a value has both a control character and an unpaired surrogate (Zod non-aborting). Must-haves only pin one-issue precedence for `oneLine`; entry combination is untested. Unlikely in real files; optional harden with a combined refine or abort.
- **LOW — No worker e2e that a bad rules file returns `rules_invalid` rather than a jsonb throw.** Relies on the existing `loadRules` share. Adequate given D-05 wiring, but a thin classify/run or mailbox-batch assertion would lock the status text.

### Suggestions

- Correct the Task 1 `it(` count AC (7 existing → ≥8 after).
- Optionally add one schema case: from-entry with both `\0` and `\uD800` → exactly one issue (control characters), for symmetry with `oneLine`.
- Keep `LC_ALL=C grep` ASCII checks; `rules.test.ts` already has exactly 2 non-ASCII lines (WR-02 accents/CJK case).

### Risk Assessment

**LOW** (plan quality: one MEDIUM AC bug). Implementation risk is low and mirrors 03-21/WR-02. The AC miscount is the main execute hazard — it can fail the plan’s own greps after a correct change.

---

## Cross-plan / overall

| Topic | Assessment |
|-------|------------|
| Gap coverage | Together they match VERIFICATION `missing[]`: validateLlmOutput + recordDecision backstop + rules schema + tests. |
| `run.ts` throw path unchanged | **Holds for WR-04.** After 03-25, lone-surrogate reasons become stored `invalid_output` (no throw). Path remains appropriate for true DB/connection failures. Rules-driven jsonb throws are 03-26’s job via `rules_invalid` before `ensureRuleSet`. |
| Ordering | Both `wave: 1`, `depends_on: []`, disjoint files — safe to run in parallel. SC5 / CLS-06 closes only when **both** are done. |
| Over-engineering | Neither plan overbuilds; no migration, no new review reason, no run.ts terminal-state redesign (correctly deferred). |
| Overall risk | **LOW**, with one execute-facing AC fix on 03-26. |
