---
phase: 03-tiered-classification-with-traces
plan: 24
subsystem: docs
tags: [readme, quick-start, discoverability, docs-tests, g-03-8, cls-01, cls-02, vitest]

# Dependency graph
requires:
  - phase: 03-23
    provides: "the README quick start with steps 10-12 (rules file, Ollama, start and config check) and its existing pins"
provides:
  - "README intro 'Get started' line linking [Quick start](#quick-start) with '12 numbered steps' and 'it does not put labels in Proton yet'"
  - "Quick start steps 1-12 each led by a bold imperative, command block right below, details after"
  - "'#### After the first start' holding the step-12 notes (Port 1143, Classification, First minutes, Bridge's first sync, docker compose ps)"
  - "describe 'README quick start is easy to find and scan (G-03-8)' with quickStartSteps(), anchor() and headings() helpers and 5 tests"
affects: [03-UAT, phase-03-verification, docs]

actuals:
  tokens: 4750
  tasks: 2
  commits: 3
plan_head_before: b4da902eed8f2c105fcd76534e4bc8ddacfc7c10
plan_head_after: d91aeccbd6328ecdd064f44bbf8b3bb73241987b

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Doc-shape tests parse the Markdown list itself (quickStartSteps) instead of pinning strings, so step count, bold leads and indentation are checked structurally"

key-files:
  created: []
  modified:
    - README.md
    - apps/worker/test/user-facing-text.test.ts

key-decisions:
  - "The intro's step count is compared with quickStartSteps().length behind a digit boundary, so adding a step without updating the intro fails"
  - "Step 9 now says 'from the step 8 output' instead of 'from that output', because the command block now sits between the step line and the details"
  - "Pushing local main to GitHub stays the owner's decision; this plan pushed nothing"

patterns-established:
  - "Quick-start steps are '<n>. **Short imperative.**' (<=60 chars, period), then the command block, then the details; notes after the last step go under '#### After the first start'"

requirements-completed: [CLS-01, CLS-02]

coverage:
  - id: D1
    description: "README intro has a Get started link to #quick-start stating 12 numbered steps; exactly one heading has that anchor"
    requirement: CLS-02
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#links the quick start from the intro with its step count (G-03-8)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#has exactly one heading with the quick-start anchor (G-03-8)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Quick start is one ordered list 1-12, each step led by a bold imperative of at most 60 characters with its body indented; steps 6, 8, 9 and 12 keep their meaning for cross references"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#numbers the steps 1 to 12, each led by a short bold imperative (G-03-8)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#indents every line of a step under its number (G-03-8)"
        status: pass
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts#keeps the step numbers other text refers to (G-03-8)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Quick-start commands unchanged and in the same order"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "apps/worker/test/user-facing-text.test.ts (describe 'README quick start (D-28, D-56, D-58)': contains pins and ordering tests)"
        status: pass
      - kind: other
        ref: "Task 2 code-block diff: code.before vs code.after (28 lines) and non-ASCII line count (68 vs 68), both identical"
        status: pass
    human_judgment: false
  - id: D4
    description: "The owner finds the quick start from the top of the README and scans the 12 steps easily, reading the current copy (UAT test 8 re-test)"
    verification: []
    human_judgment: true
    rationale: "Discoverability and readability are the owner's judgment, and the owner reported G-03-8; which copy they read (local or GitHub) depends on the push decision"

# Metrics
duration: 6min
completed: 2026-10-12
status: complete
---

# Phase 3 Plan 24: Findable, scannable README quick start Summary

**The README intro now has a `**Get started:**` line (README.md:15) that links [Quick start](#quick-start) and says it takes 12 numbered steps. Each of the 12 steps opens with a short bold instruction, such as `**Log in to Proton through Bridge.**`, with its command right below and the details after. The notes that used to trail step 12 now sit under `#### After the first start` (README.md:602). Every command is byte-identical and in the same order (G-03-8).**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-12T19:35:10Z
- **Completed:** 2026-10-12T19:41:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- README.md:15, the intro before `## Why`: added the Get started line from the plan, word for word. It names no command, so the whole-README first-indexOf ordering pin still reads the commands from the quick start. The Proton-only sentence is unchanged.
- README.md:473-612, the Quick start: the 12 steps keep their numbers and what they do. The leads, in order: Clone the repository. / Create your config file and add your mailboxes. / Create the database settings file. / Create the mailbox password file. / Set the Bridge keychain passphrase. / Create Bridge's volume, once. / Create the backup file for the mailbox passwords, once. / Log in to Proton through Bridge. / Pin Bridge's certificate. / Create a rules file for each mailbox. / Install Ollama and pull the model. / Start Sift and check your setup. Each command block comes right after its lead. The existing sentences follow it, trimmed only where the lead already says the same thing.
- The step-12 notes (four bullets and the `docker compose ps` paragraph) are now under `#### After the first start`, with 4 spaces of indentation removed and nothing else changed. They sit above `**Arriving in later milestones**`, so that slice still never mentions Bridge.
- apps/worker/test/user-facing-text.test.ts: new describe `README quick start is easy to find and scan (G-03-8)` with three helpers. `quickStartSteps()` parses the numbered list. `anchor()` builds GitHub-style heading slugs. `headings()` lists headings outside fenced code. Five tests use them: intro link plus step count (digit boundary) plus the no-labels-yet clause and no commands in the intro; exactly one quick-start anchor; steps numbered 1-12 with bold leads of at most 60 characters ending with a period; body lines indented 3 or 4 spaces; and the step 6/8/9/12 leads plus the README and CONTRIBUTING texts that refer to those step numbers.

## Task Commits

1. **Task 1 (tracer): Get started link and anchor tests** - `e9713c0` (docs)
2. **Task 2 RED: list-shape tests** - `e714a43` (test)
3. **Task 2 GREEN: bold leads, commands below, After the first start** - `d91aecc` (docs)

No REFACTOR commit was needed.

**Plan metadata:** the SUMMARY commit and the state/roadmap commit that follow.

## TDD Gate Compliance

- **RED:** `e714a43`. The target `README quick start is easy to find and scan (G-03-8) > numbers the steps 1 to 12, each led by a short bold imperative (G-03-8)` ran from a JUnit report and failed with exit 1: `step 1: Clone the repository:: expected null not to be null`. `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (target_test_failed). The record was moved out of `.vitest/` into the session scratchpad. Semantic assessment: the target ran and failed on the planned assertion (no bold lead), not on setup or parsing. `keeps the step numbers other text refers to (G-03-8)` also failed for the intended reason (`'Log in to Proton through Bridge, in a...' to match /^\*\*Log in/`).
- **GREEN:** `d91aecc`. All 113 tests in the file pass.
- **REFACTOR:** none needed.

## Files Created/Modified

- `README.md` - Get started line in the intro; bold step leads; commands moved above their details within each step; `#### After the first start`
- `apps/worker/test/user-facing-text.test.ts` - the G-03-8 describe and its helpers

## Decisions Made

- The intro test computes the step count from `quickStartSteps()` and matches `(?<!\d)12 numbered steps`, so the intro and the list cannot drift apart.
- The intro test also pins `it does not put labels in Proton yet` (T-03-78).
- Step 9 says "from the step 8 output". Step 10 adds "This copies the example rules file." before "Run it once per slug". Steps 2 and 3 start their details with "Then". Step 4 says "This makes the file readable by you only." Step 8's "in a terminal (the command is interactive)" became "Run it in a terminal: the command is interactive." All are wording changes needed because the command now comes before the explanation.
- Tracer gate: interactive mode, `human_verify_mode` end-of-phase, automated-only verify. It was re-run after Task 1 and passed (110/110 plus typecheck), so no checkpoint was needed.

## Deviations from Plan

**1. [Rule 1 - Test reality] The indentation test was green before the README edit**
- **Found during:** Task 2 RED
- **Issue:** the plan asked to see all three new tests fail before the README edit. The indentation test passed, because, as the plan's objective says, the local markup was already valid list content: every body line was indented 3 or 4 spaces.
- **Fix:** none needed. The test stays as a regression guard for the restructure. RED evidence comes from the two tests that failed for the intended reason (see TDD Gate Compliance).
- **Files modified:** none
- **Commit:** e714a43

## Issues Encountered

- `pnpm lint` reports one warning, in `apps/worker/test/node-version.test.ts` (noTemplateCurlyInString). It was there before this plan and is out of scope. Lint exits 0.

## Verification

- `pnpm vitest run apps/worker/test/user-facing-text.test.ts`: 113/113 pass, including the existing CONTRIBUTING pins (release.yml, SIFT_RELEASE_CI=1, git pull --rebase)
- `pnpm typecheck`: exit 0
- `pnpm lint`: exit 0 (the 1 pre-existing warning)
- Code-block diff (`code.before` vs `code.after`, 28 lines) and non-ASCII line count (68 vs 68): both identical
- Acceptance greps: 12 bold step lines in the quick-start slice. `#### After the first start` is at line 602, `**Start Sift and check your setup.**` at 580, `**Pin Bridge's certificate.**` at 550, and the Get started line at 15, before `## Why` at 19. `G-03-8` appears 6 times in the test file.

## Human action

Not done by this plan: deciding whether to push local main to GitHub. On 2026-10-12 origin/main was 168 commits behind, so the GitHub README has neither steps 10-12 nor this change. Every push to main cuts a release, so pushing is the owner's call. Until then, read README.md in /Users/samuel/dev/sift, not GitHub and not another checkout such as /Users/samuel/dev/public_gsd-2. At phase verification, open README.md in a Markdown preview (UAT test 8 re-test). The Get started link near the top (line 15) should jump to Quick start (line 473), and the 12 steps should read as one numbered list with a bold first line each.

## Next Phase Readiness

- G-03-8 is closed in this checkout. Only the owner's re-test (D4) and the push decision are left.

## Self-Check: PASSED

- FOUND: README.md, apps/worker/test/user-facing-text.test.ts
- FOUND commits: e9713c0, e714a43, d91aecc

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-12*
