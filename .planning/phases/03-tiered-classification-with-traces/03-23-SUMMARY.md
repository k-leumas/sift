---
phase: 03-tiered-classification-with-traces
plan: 23
subsystem: classification
tags: [ollama, live-baseline, stderr, progress, docs, g-03-2, cls-02, vitest]

# Dependency graph
requires:
  - phase: 03-15
    provides: "the manual live-baseline runner llm-baseline.ts (runBaseline, formatBaselineTable, main, BaselineIo)"
provides:
  - "readyLine(model, total) and progressLine(index, total, fixture, elapsedMs) in llm-baseline.ts"
  - "BaselineOptions.progress, called once after the preflight and once per fixture; main passes io.stderr"
  - "Progress tests in llm-baseline.test.ts (G-03-2): exact stderr shape, 13-line stdout, incremental output, none on refusal or usage"
  - "Run notes in 03-USER-SETUP.md and CONTRIBUTING.md: repository root, a few minutes, progress on stderr"
affects: [03-UAT, phase-03-verification, docs]

actuals:
  tokens: 3100
  tasks: 2
  commits: 2
plan_head_before: 607f6dca6dc41a3dfe74066ed19634be289661f2
plan_head_after: fbc68209496cdafb300d15a4045d7e15081d8614

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Progress for a long manual run goes to stderr through the injected BaselineIo, so stdout stays a pasteable artifact and tests record both streams"

key-files:
  created: []
  modified:
    - apps/worker/test/support/llm-baseline.ts
    - apps/worker/test/llm-baseline.test.ts
    - .planning/phases/03-tiered-classification-with-traces/03-USER-SETUP.md
    - CONTRIBUTING.md

key-decisions:
  - "The per-email timer starts before the fixture is read and stops after its row (and flip) is built, so the seconds include parsing; the ready line goes out after the preflight, before the first fixture"
  - "progress defaults to a no-op in runBaseline, so the direct runBaseline callers in the tests are unchanged; only main wires it to io.stderr"

patterns-established:
  - "Owner-facing progress strings are fixed templates of model name, synthetic fixture name, position and whole seconds (T-03-75)"

requirements-completed: [CLS-02]

coverage:
  - id: D1
    description: "The runner prints a ready line after the preflight and one 'fixture <n>/10 <file>: <s> s' line per email on stderr as each finishes; stdout is exactly the 13-line table"
    requirement: CLS-02
    verification:
      - kind: unit
        ref: "apps/worker/test/llm-baseline.test.ts#prints one progress line per email on stderr and only the table on stdout (G-03-2)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/llm-baseline.test.ts#writes each progress line as soon as that email is done, before the table (G-03-2)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Progress lines carry only model name, fixture name, position and whole seconds; refusals and usage errors print none; the runner stays hermetic (no default URL, no real port)"
    requirement: CLS-02
    verification:
      - kind: unit
        ref: "apps/worker/test/llm-baseline.test.ts (format test, refusal and usage cases, 'has no default URL and reads only the committed synthetic fixtures')"
        status: pass
      - kind: unit
        ref: "apps/worker/test/classify-hermetic.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "03-USER-SETUP.md and CONTRIBUTING.md say the run takes a few minutes, shows progress on stderr and starts from the repository root"
    verification:
      - kind: other
        ref: "grep -n \"few minutes\" 03-USER-SETUP.md; grep -n \"repository root\" CONTRIBUTING.md; user-facing-text.test.ts CONTRIBUTING pin"
        status: pass
    human_judgment: false
  - id: D4
    description: "Owner re-runs the live baseline from the repository root and sees progress while it runs, then the table (UAT test 2 re-test)"
    requirement: CLS-02
    verification: []
    human_judgment: true
    rationale: "Needs the owner's real Ollama and qwen3:1.7b; CI only runs the fake"

# Metrics
duration: 4min
completed: 2026-10-12
status: complete
---

# Phase 3 Plan 23: Live-baseline progress on stderr Summary

**The live baseline runner now prints `<model> is ready on Ollama; sending 10 synthetic emails one at a time, which takes a few minutes` once the preflight passes, then `fixture 3/10 pair-payment-failure.eml: 39 s` as each email finishes, all on stderr. stdout is still exactly the 13-line Markdown table, and the owner docs say to run it from the repository root and expect a few minutes (G-03-2).**

## Performance

- **Duration:** 4 min
- **Started:** 2026-10-12T19:29:16Z
- **Completed:** 2026-10-12T19:32:34Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `llm-baseline.ts`: exported `readyLine` and `progressLine` with the exact texts from the plan. Added the optional `BaselineOptions.progress`. `runBaseline` calls it once after a successful preflight and once per fixture, timing each with `performance.now()`. `main` passes `progress: (line) => io.stderr(line)`. The header comment now describes stderr progress and the stdout table. The refused and aborted paths throw before any progress call, as before.
- `llm-baseline.test.ts`: a new describe `the live-baseline progress lines (G-03-2)` covers both formats. The command-line describe is now titled `... (G-03-2)`. `prints the table and exits 0` was replaced: the new test asserts 11 stderr lines (the ready line, then indexes 1..10 with `EXPECTED_FIXTURES` in order) and 13 stdout lines with no `fixture ` line. A new incremental test records `fake.chatBodies().length` at each write. It checks that `fixture 1/10` arrives after at least 1 chat and before the final count, and that the single stdout write comes last. The refusal case and all five usage cases now assert that no progress line was printed.
- `03-USER-SETUP.md` Verification: says to run from the root of the sift checkout (where `README.md` and `apps/` are), with a `Cannot find module`/`MODULE_NOT_FOUND` hint. It says the run takes about 4 minutes, quotes the ready and progress lines, and explains that ` > baseline.md` keeps only the table. The command block and the expected-result bullets are unchanged.
- `CONTRIBUTING.md` live-baseline bullet: added that it runs from the repository root, takes a few minutes, and prints one progress line per email on stderr with the table on stdout. The pinned command sentence is unchanged, and the Releases section was not touched.

## Task Commits

1. **Task 1 (tracer): progress on stderr, table on stdout** - `7765ff9` (feat)
2. **Task 2: run instructions** - `fbc6820` (docs)

**Plan metadata:** the SUMMARY/state commit that follows.

## Files Created/Modified

- `apps/worker/test/support/llm-baseline.ts` - readyLine, progressLine, BaselineOptions.progress, main wiring
- `apps/worker/test/llm-baseline.test.ts` - format test, stderr/stdout shape test, incremental test, no-progress checks on refusal and usage
- `.planning/phases/03-tiered-classification-with-traces/03-USER-SETUP.md` - repository root, duration, progress lines, stdout redirect
- `CONTRIBUTING.md` - repository root, duration, progress on stderr

## Decisions Made

- The timer for each email covers parsing the fixture, the LLM tier call or calls, and building the row. The line is written once the row and its flip are set.
- `progress` defaults to a no-op inside `runBaseline`, so the existing direct `runBaseline` tests did not change.
- Tracer gate: interactive mode, `human_verify_mode` end-of-phase, and the `<verify>` is automated only. It was re-run and passed (22/22 plus typecheck), so no checkpoint was needed.
- `.wolf/anatomy.md`: the hook had filed the runner under the worktree-path section, so both entries now sit in the main-tree `apps/worker/test/` and `apps/worker/test/support/` sections. The worktree-section entries were left as they were (bug-188).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `pnpm lint` reports one warning, in `apps/worker/test/node-version.test.ts` (noTemplateCurlyInString). It was there before this plan and is out of scope. Lint exits 0.

## Verification

- `pnpm vitest run apps/worker/test/llm-baseline.test.ts apps/worker/test/classify-hermetic.test.ts apps/worker/test/user-facing-text.test.ts`: 3 files, 130/130 pass
- `pnpm typecheck`: exit 0
- `pnpm lint`: exit 0 (the 1 pre-existing warning)
- ASCII check on 03-USER-SETUP.md: 0. The added CONTRIBUTING lines are ASCII, and so are both source files.

## User Setup Required

None now. At phase verification the owner re-runs UAT test 2 from the sift repository root with `node apps/worker/test/support/llm-baseline.ts --url http://localhost:11434 --model qwen3:1.7b`. The ready line should appear within a few seconds, then one `fixture n/10 ...` line per email over about 4 minutes, then the table ending in `flips: <n>`.

## Next Phase Readiness

- G-03-2 is closed in code and docs. Only the owner's live re-test (D4) is left.

## Self-Check: PASSED

- FOUND: apps/worker/test/support/llm-baseline.ts, apps/worker/test/llm-baseline.test.ts, CONTRIBUTING.md, 03-USER-SETUP.md
- FOUND commits: 7765ff9, fbc6820

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-12*
