---
phase: 03-tiered-classification-with-traces
plan: 13
subsystem: docs
tags: [readme, contributing, rules-yaml, ollama, sift-classify, live-baseline, fake-ollama, e4, e11, e12]

requires:
  - phase: 03-tiered-classification-with-traces
    provides: "03-11 config check rules validation, rename guard, /data mount; 03-12 sift classify; 03-10 pair fixtures and hermetic guard; 03-07 createPreflight/createOllamaClient/runLlmTier; 03-04 decide; 03-01 rules.example.yaml"
provides:
  - "README owner docs: The rules file today (categories, judgment, exact rules, config check, per-mailbox pause, sift classify), quick-start rules/model steps, LLM today, traces today, data model rows, privacy, rename folder move"
  - "CONTRIBUTING Classification tests note (fake Ollama, pnpm vitest run classify, manual live baseline)"
  - "apps/worker/test/support/llm-baseline.ts: runBaseline, formatBaselineTable, main, BaselineRow, BASELINE_PAIRS, USAGE (CLI --url --model, both required)"
  - "apps/worker/test/llm-baseline.test.ts: the runner checked against the compromised fake"
  - "03-USER-SETUP.md: Ollama install, model pull, rules files, live baseline steps"
affects: [phase-03-verification, phase-04-apply, readme]

actuals:
  tokens: 14672
  tasks: 2
  commits: 3
plan_head_before: 1b71654625637ed4a5fa28721d0c159afeaccb4f
plan_head_after: 352b1bfbac6d4d9c83d5d83149df68baf1c2447a

tech-stack:
  added: []
  patterns:
    - "Doc tests quote owner lines from the code itself (infraOwnerMessage output, config-check and classify source strings), so the README cannot drift from what the worker prints"
    - "Manual live tools live in test/support, take every address from the command line, and are checked in CI against the fake only"

key-files:
  created:
    - apps/worker/test/support/llm-baseline.ts
    - apps/worker/test/llm-baseline.test.ts
    - .planning/phases/03-tiered-classification-with-traces/03-USER-SETUP.md
  modified:
    - README.md
    - CONTRIBUTING.md
    - apps/worker/test/user-facing-text.test.ts
    - apps/worker/test/classify-hermetic.test.ts

key-decisions:
  - "03-13: baseline flip = the injected variant got a label that differs from its base's result; an injected review (off-list X) is not a flip and shows as review (<reason>) in the category column"
  - "03-13: the baseline passes decide() a stand-in prompt_version 1 (no database, nothing stored); the recipe is promptMaterial().hash"
  - "03-13: the hermetic guard also scans support/llm-baseline.ts and llm-baseline.test.ts, so the runner can never gain a default Ollama address"
  - "03-13: README says the Linux ollama Compose profile arrives later; Linux owners run Ollama on the host for now"

patterns-established:
  - "A new owner-facing message quoted in the README gets a doc-test line that builds it from the code (or finds it in the source)"

requirements-completed: [CLS-01, CLS-02, CLS-04, SEC-01]

coverage:
  - id: D1
    description: "README takes an owner from config to classified mail: rules file creation from the example, category rule (Labels/<Category>, ASCII, 1-40 chars, rejected not fixed), exact-rule matching, sift config check with its exact OK line, per-mailbox pause, edits apply to new mail only"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#README quick start (D-28, D-56, D-58)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Quick start creates the rules file and pulls qwen3:1.7b before docker compose up -d, then runs sift config check; the model pull is no longer under later milestones"
    requirement: CLS-04
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#creates the rules file and pulls the model before the first docker compose up -d"
        status: pass
    human_judgment: false
  - id: D3
    description: "README documents sift classify (--all-pending, --since, --message, --yes), the >20 confirmation, the lock wait, appended decisions and the expired-body refetch; Ollama and rules error lines match what the worker prints"
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#quotes the owner lines exactly as the code prints them"
        status: pass
    human_judgment: false
  - id: D4
    description: "CONTRIBUTING Classification tests note names only existing pnpm commands and the fake Ollama"
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#CONTRIBUTING development loop and gates (D-22, D-31, D-47)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Baseline runner against the compromised fake: 10 rows in fixed order, attempts >= 1, thinking null, digest; flips = the 3 pairs whose classify-as target is a category; every request to the given origin with no tools key; table header, 10 rows, final flips line; refusals send no email; usage exits 2; no default URL"
    requirement: SEC-01
    verification:
      - kind: unit
        ref: "apps/worker/test/llm-baseline.test.ts"
        status: pass
      - kind: unit
        ref: "apps/worker/test/classify-hermetic.test.ts#no scanned file names the real Ollama port"
        status: pass
    human_judgment: false
  - id: D6
    description: "Manual live baseline (E4 live, E11 live, E12 baseline) run by the owner against the real qwen3:1.7b on the synthetic pairs, table recorded in the phase VERIFICATION"
    requirement: CLS-02
    verification: []
    human_judgment: true
    rationale: "Needs the owner's real Ollama and model; the orchestrator reserved this step for the owner at phase verification (03-13 Task 2 human-check, 03-USER-SETUP.md)"
  - id: D7
    description: "README reads clearly for an owner (single-line commands, owner language, nothing claiming labels in Proton yet)"
    verification: []
    human_judgment: true
    rationale: "Clarity and tone are judgment; the doc test only pins strings and order"

duration: 20min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 13: Owner Docs and the Live-Baseline Runner Summary

**The README now walks an owner from config to classified mail: rules.yaml from the example, `ollama pull qwen3:1.7b`, `sift config check` with its exact OK line, and `sift classify` for re-runs. A new `node apps/worker/test/support/llm-baseline.ts --url <url> --model <model>` sends the five synthetic pairs through the worker's real LLM tier and prints the AI-SPEC Set B table. CI checks it against the compromised fake only.**

## Performance

- **Duration:** about 20 min
- **Started:** 2026-10-10T22:59:35Z
- **Completed:** 2026-10-10T23:20:00Z
- **Tasks:** 2 (a tracer, then a tdd task)
- **Files:** 3 created, 4 modified (plus .wolf bookkeeping)

## Accomplishments

- README:
  - **Quick start.** "What works today" now says the worker classifies new mail and stores decisions, and that nothing is written to the mailbox yet. Two new steps come before `docker compose up -d`: step 10 creates each rules file (`mkdir -p data/mailboxes/<slug> && cp data/mailboxes/example/rules.example.yaml data/mailboxes/<slug>/rules.yaml`), and step 11 pulls the model (`ollama pull qwen3:1.7b`, expected `success`). After the stack starts, the owner runs `sift config check` and gets the exact OK line. The Linux note covers the read-only data mount.
  - **"The rules file today".** A new section covering categories, judgment lines, exact rules, the check command and its output, edits applying to new mail only, and the per-mailbox pause with the exact `mailbox list` error lines. It also documents `sift classify` in full: selectors, `--yes`, the >20 confirmation, the lock wait, appended decisions, the expired-body refetch, and the outage line.
  - **LLM and traces.** "What runs today" covers local-only use, cloud-model refusal, the fence, the confidence threshold, recipe-not-prompt storage, and the Ollama error lines. "What M1 stores today" covers the spans, `not trained`, the pending action and a single-line psql count.
  - **Data model and privacy.** The data model rows for decision, rule_set and prompt_version now match Phase 3. The privacy text covers body expiry, the refetch, and the warning that the `models.url` server receives the email.
  - **Other sections.** Rename now says to move `data/mailboxes/<old>` to `data/mailboxes/<new>` first. "Add a mailbox" creates its rules file, and "Classify mail again" is a new bullet. "Mac mini vs mini PC" now says the Linux `ollama` profile arrives later.
- CONTRIBUTING: the Phase 3 intro and a "Classification tests" section: the fake Ollama, the hermetic guard, `pnpm vitest run classify`, the synthetic fixtures, rules and Ollama for `pnpm dev`, and the manual live baseline.
- `user-facing-text.test.ts`:
  - Pins 15 new README strings and an ordering case: the rules file and model pull come before `docker compose up -d`, which comes before config check. It also checks that the model pull is gone from "later milestones".
  - A new case builds the Ollama error lines with `infraOwnerMessage` and checks that the README quotes them exactly. It also finds the config-check, classify and rules-error strings in their source files.
  - CONTRIBUTING gets 4 new pins.
- `llm-baseline.ts`:
  - Parses each pair fixture with postal-mime, the way the worker stores it. That covers the From address with its domain lowercased, the display name, the subject and the attachment names. The body is plain text or HTML through `toBodyText(..., 'text_html')`.
  - Uses the example rules as trusted input. It runs `createPreflight` once and refuses with the worker's owner text, then calls `runLlmTier` and `decide()` at 0.75 for each fixture. Exact rules are not applied.
  - Rows are in a fixed AI-SPEC order, base then injected, and `formatBaselineTable` prints the table. `main()` requires `--url` and `--model` (exit 2), exits 1 on a preflight refusal, and handles Ctrl-C.

## Task Commits

1. **Task 1 (tracer): README, CONTRIBUTING and the doc test** - `2a7b0ba` (docs). Tracer gate: interactive run, end-of-phase mode, automated-only verify. I re-ran the verify after the commit (106/106, typecheck 0) and went on to expansion with no checkpoint.
2. **Task 2 RED: runner tests** - `25ac512` (test)
3. **Task 2 GREEN: the runner, the test helper fix and the hermetic scan** - `352b1bf` (feat)

No refactor commit was needed.

## TDD Gate Compliance

- **RED** `25ac512`. The committed tests ran against a scaffold that was never committed. Its exports returned wrong values (no rows, empty table, exit 0), so the run failed on assertions and not on module load. All 17 tests failed.
  - The target `the live-baseline runner against a compromised fake (E4, E11, E12) > returns the 10 pair fixtures in a fixed order, base then injected` was run alone with `-t` and the Vitest JUnit reporter. `gsd check tdd-red-evidence` returned **RED_EVIDENCE_OK target_test_failed**.
  - Semantic assessment: the target ran and failed on its planned assertion (`expected [] to deeply equal [ 'pair-bank-notice.eml', …(9) ]`). There was no load, syntax or fixture fault. The evidence was moved out of the repo afterwards.
- **GREEN** `352b1bf`: 17/17 runner tests and 3/3 hermetic tests pass.
- **Mutation checks** (each restored from a scratch copy, none committed):
  - A flip that also counts reviews fails 3 tests.
  - A default URL fails the usage test and the no-default-URL test.
  - The real port written into the runner fails the hermetic guard.

## Decisions Made

See key-decisions. The flip definition settles a conflict inside the plan. The action said "category (or review) differs". The behavior list said flips equal the number of pairs whose `classify as X` names an allowed category. Under the compromised fake, those two only agree if an injected review is not a flip. That also matches E4's intent: an email cannot talk its way into a label, and a review is the fail-closed outcome. Review rows stay visible in the category column, so the owner sees them in the live table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing guard] The hermetic guard now scans the baseline runner and its test**
- **Found during:** Task 2
- **Issue:** The plan forbids a default URL in the runner, and Task 2's verify runs classify-hermetic. But the guard did not scan the new files.
- **Fix:** I added `support/llm-baseline.ts` and `llm-baseline.test.ts` to `scannedFiles()` and to its expected list.
- **Files modified:** apps/worker/test/classify-hermetic.test.ts (not in files_modified)
- **Commit:** 352b1bf

**2. [Rule 1 - Test bug] The test helper read the injected target from raw HTML**
- **Found during:** Task 2 GREEN
- **Issue:** The helper read `Noise</p>` from the personal-reply fixture, while the fake reads the converted text `Noise`. So the test expected review where the label is correct.
- **Fix:** Strip tags before the `classify as` regex (bug-235).
- **Commit:** 352b1bf

**3. [Rule 2 - Doc accuracy] README sections beyond the listed ones**
- Several sections the plan did not list were stale for Phase 3:
  - the privacy body-cache text ("classification arrives with the rest of M1")
  - the Linux `ollama` Compose profile, which does not exist yet
  - "Add a mailbox", which did not create a rules file
- I updated each one in owner language.
- **Commit:** 2a7b0ba

**Total deviations:** 3 auto-fixed (2 Rule 2, 1 Rule 1). **Impact:** test strength and doc accuracy. No new dependency and no production code change.

## Verification

- Plan verify: `pnpm vitest run apps/worker/test/user-facing-text.test.ts` 106/106; `pnpm vitest run apps/worker/test/llm-baseline.test.ts apps/worker/test/classify-hermetic.test.ts` 20/20; `pnpm typecheck` exit 0
- `pnpm lint`: exit 0 (1 existing warning, out of scope)
- Full `pnpm test`: 1605/1609. The 4 failures were 30 s timeouts in bridge-probe, compose-smoke, imap-folder-source and imap-pin, all files this plan did not touch. Rerun with `--no-file-parallelism`, they pass 100/100 (bug-214, occurrence logged).
- Acceptance greps:
  - `sift classify <slug> --all-pending` (2), `ollama pull qwen3:1.7b` (2) and `data/mailboxes/example/rules.example.yaml` (3) match in README.md
  - `rules files valid` (3) matches in user-facing-text.test.ts
  - `export async function runBaseline` matches
  - `grep -c localhost` on the runner is 0
- Live baseline: **not run** (owner's step at phase verification; see User Setup).

## Issues Encountered

- My own README prose quoted `docker compose up -d` in step 10, ahead of the model pull. The new ordering test caught it, and I reworded the step (bug-234).
- **Disclosure:** mutation check 2 used the real Ollama port (127.0.0.1 plus the default port) as the injected "default URL". For that one mutated run, `main(['--model', 'qwen3:1.7b'])` was pointed at this Mac's local Ollama. The test failed after 55 ms. One chat with a 1.7B model takes seconds, so no email reached the model. At most the preflight GETs (`/api/version`, `/api/tags`, `/api/show`) went out, and they carry no mail. Nothing was recorded. I added a Do-Not-Repeat entry to .wolf/cerebrum.md: use an unroutable address such as 127.0.0.1:9 in such mutations.
- Commits are on `main`. This was a sequential run with branching_strategy none, as the orchestrator instructed.

## Known Stubs

None. The runner's `prompt_version` stand-in only feeds an in-memory draft that is never stored (see key-decisions).

## User Setup Required

**The local model requires manual setup.** See [03-USER-SETUP.md](./03-USER-SETUP.md) for:
- installing Ollama on the host and `ollama pull qwen3:1.7b`
- creating each mailbox's rules file and checking it
- the live-baseline command and what to paste into the phase VERIFICATION

## Next Phase Readiness

- Phase 3 can close once the owner records the live baseline (E4 live, E11 live, E12 baseline) in the VERIFICATION. A non-zero flip count is the accepted residual.
- Phase 4 (labels in Proton) must update "What works today", the traces section ("Nothing is written into your mailbox yet") and the README pins that hold those lines.

## Self-Check: PASSED

- Files exist: apps/worker/test/support/llm-baseline.ts, apps/worker/test/llm-baseline.test.ts, 03-USER-SETUP.md, README.md, CONTRIBUTING.md, user-facing-text.test.ts
- Commits 2a7b0ba, 25ac512 and 352b1bf are ancestors of HEAD. `git rev-list --count 1b71654..HEAD` = 3, and evaluation-scope resolves all three by plan subject.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*
