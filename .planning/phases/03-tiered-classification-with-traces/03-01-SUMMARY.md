---
phase: 03-tiered-classification-with-traces
plan: 01
subsystem: config
tags: [rules-yaml, zod, yaml, gitignore, data-paths]

requires:
  - phase: 01-foundation-and-isolation
    provides: config.yaml loader (ConfigIssue/formatIssue, positioned Zod issues), validateSlug
provides:
  - "@sift/core/rules: strict RulesFile schema, parseRulesText/loadRules, resolveDataPath/rulesPathFor"
  - "packages/core/src/yaml-issues.ts shared by the config.yaml and rules.yaml loaders"
  - "data/mailboxes/example/rules.example.yaml, committed and parsed in CI"
  - ".gitignore that re-includes only the example rules file"
  - "package.json exports ./rules and ./classify (target created by 03-05)"
affects: [03-02, 03-03, 03-04, 03-05, classify, worker, cli, phase-04-labels]

actuals:
  tokens: 14900
  tasks: 3
  commits: 3
plan_head_before: ffc6bbed06f0b3c0c62d11dbbe67ad951432f83c
plan_head_after: 3bfc2f7eeb46711097544ce7fa128e68ed6047f6

tech-stack:
  added: []
  patterns:
    - "Rules schema follows config/schema.ts: strictObject, unlessMissing, superRefine(fn, { when: () => true }) for cross-field checks"
    - "Match entries normalised in the schema (lowercase, trailing dot, whitespace collapse, in: any) so the stored object is canonical for D-03 hashing"
    - "Data paths: SIFT_DATA mirrors SIFT_CONFIG; slug validated before any path join"

key-files:
  created:
    - packages/core/src/yaml-issues.ts
    - packages/core/src/rules/schema.ts
    - packages/core/src/rules/load.ts
    - packages/core/src/rules/path.ts
    - packages/core/src/rules/index.ts
    - packages/core/test/rules.test.ts
    - packages/core/test/example-rules.test.ts
    - data/mailboxes/example/rules.example.yaml
  modified:
    - packages/core/src/config/load.ts
    - packages/core/src/config/schema.ts
    - packages/core/package.json
    - .gitignore

key-decisions:
  - "D-06 category-name character set: owner chose ascii (A-Z, a-z, 0-9, single spaces, - and &; 1-40 chars; no /). Widening to Unicode later is non-breaking and waits until Phase 4 verifies Bridge handles modified-UTF-7 folder names"
  - "Labels compare case-sensitively with category names and are not trimmed (D-13 exactly-one-of); category names are never trimmed (leading/trailing space is an error)"
  - "rules: with no value (null) is an error, not 'no rules'; rules: [] or no rules key is valid"
  - "A list-level issue (category count, judgment total, rule count) is located at the list node, i.e. its first item, matching config.yaml's mailboxes behaviour"

patterns-established:
  - "yaml-issues.ts: every YAML-backed owner file reports issues through position/locate/zodIssues/byPosition/yamlSyntaxIssues and the requiredErrorMap sentinel"

requirements-completed: [CLS-01]

coverage:
  - id: D1
    description: "rules.yaml loads through a strict schema; every problem reported once, in file order, with path and line:column"
    requirement: CLS-01
    verification:
      - kind: unit
        ref: "packages/core/test/rules.test.ts#every problem in one pass, in file order"
        status: pass
      - kind: unit
        ref: "packages/core/test/rules.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "config.yaml loading unchanged after the helper move to yaml-issues.ts"
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts, env.test.ts, example-config.test.ts"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveDataPath (SIFT_DATA) and rulesPathFor refusing invalid slugs"
    verification:
      - kind: unit
        ref: "packages/core/test/example-rules.test.ts#resolveDataPath, rulesPathFor"
        status: pass
    human_judgment: false
  - id: D4
    description: "Example rules file committed, parsed with the real schema, example.test addresses only; real rules/eval/shared-rules/data ignored"
    verification:
      - kind: unit
        ref: "packages/core/test/example-rules.test.ts#.gitignore keeps real rules out of git"
        status: pass
      - kind: other
        ref: "git ls-files --cached --others --exclude-standard data -> only data/mailboxes/example/rules.example.yaml"
        status: pass
    human_judgment: false
  - id: D5
    description: "Example file wording and README vocabulary read well to a non-technical owner"
    verification: []
    human_judgment: true
    rationale: "Owner-facing prose quality; no test asserts readability"

duration: 13min
completed: 2026-10-10
status: complete
---

# Phase 3 Plan 01: Rules File Schema, Loader and Example Summary

**`@sift/core/rules` reads `data/mailboxes/<slug>/rules.yaml` through a strict Zod schema (version 1, 2 to 20 ASCII category names, judgment lines, exact from/domain/phrase rules whose labels must be categories). It reports every problem in file order with config.yaml-style `file:line:col path: message`. A committed example file is checked in CI, and `.gitignore` re-includes only that file.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-10-10T18:31:54Z
- **Completed:** 2026-10-10T18:45:00Z
- **Tasks:** 3 (1 decision resolved by the owner, 1 tracer, 1 TDD)
- **Files modified:** 12

## Accomplishments

- Moved the YAML position and Zod-issue helpers out of `config/load.ts` into `packages/core/src/yaml-issues.ts` (moved, not copied). All 100 existing config, env and example-config tests pass unchanged.
- `RulesFile` schema with every D-01/D-02/D-06/D-08/D-09/D-10/D-13 rule. It normalises match entries (from/domain lowercased, one trailing dot dropped, phrase whitespace collapsed, `in: any` filled in only when there is a phrase), so the stored object is canonical for D-03 hashing.
- `parseRulesText` / `loadRules` reject files over 256 KiB and documents with more than 50 aliases before validation. A missing or unreadable file comes back as an issue, never a throw. The owner's file is only read.
- `resolveDataPath` (SIFT_DATA, default `./data`) and `rulesPathFor` (validateSlug runs before any join, TypeError on `../etc`) give the worker and CLI one way to find a mailbox's rules.
- The example rules file uses README vocabulary and only example.test addresses. The `.gitignore` negations keep `data/live`, `data/spike`, real `rules.yaml` files (including a mailbox slugged `example`), `eval/` and `shared-rules.md` out of git.

## Task Commits

1. **Task 1: Category-name character set (checkpoint:decision)**: resolved by the owner as `ascii` before execution. No commit.
2. **Task 2: Tracer (strict schema and positioned loader)**: `5057ac7` (feat)
3. **Task 3: Data paths, export, example file, .gitignore (TDD)**: RED `302af16` (test), GREEN `3bfc2f7` (feat). No refactor was needed.

## Decisions Made

- **D-06 character set:** the owner chose **ascii**. `CATEGORY_NAME_PATTERN = /^[A-Za-z0-9&-]+(?: [A-Za-z0-9&-]+)*$/`. Widening to Unicode later breaks nothing (no existing name becomes invalid). It is deferred until Phase 4 verifies that Bridge handles modified-UTF-7 folder names.
- Category names and labels are checked exactly as written. A leading or trailing space in a name gets its own message, and a label must match a category name case-sensitively, so `important` and `review` are both refused.
- `describe` and `unlessMissing` in `config/schema.ts` are now exported (module-level only, not part of `@sift/core/config`), so the rules schema reuses them instead of copying them.

## Deviations from Plan

### Auto-fixed Issues

None needed. Small choices made within the plan's discretion:
- `config/schema.ts` exports `describe` and `unlessMissing` (the plan said to follow its style; exporting avoids a copy). Behaviour is unchanged.
- `RULES_EXAMPLE_PATH` lives in `path.ts`, and `load.ts` imports it. Task 2 used a local constant until Task 3 created `path.ts`.
- Added `FROM_MAX_CHARS` (254), `DOMAIN_MAX_CHARS` (253), `PHRASE_PLACES` and `PhrasePlace` exports beside the planned constants.

### Execution notes

- **Commits on `main`:** the executor's protected-branch check reports `main` as protected. The orchestrator told this sequential executor to commit on `main` (`branching_strategy: none`; every earlier plan did the same). Hooks ran on every commit, with no `--no-verify`.
- **Docker was not running**, so the DB globalSetup failed and vitest printed "No test files found". The planned `pnpm vitest run ...` commands were run as `SIFT_TEST_ADMIN_URL= pnpm exec vitest run ...` (the documented no-DB mode). These test files need no database (logged as bug-206).

**Total deviations:** 0 auto-fixed. **Impact:** none on scope.

## TDD Gate Compliance (Task 3)

- **RED** `302af16`: `example-rules.test.ts` was run against working-tree-only scaffolding (a stub `path.ts` returning `''`, plus the `./rules` export), so the failures were assertions, not module-load errors. 13 of 14 tests failed. The one pass is the "real paths stay ignored" case, which the old `data/` rule already satisfied. `gsd check tdd-red-evidence` on the Vitest JUnit report gave `RED_EVIDENCE_OK` (target_test_failed). Semantic assessment: the target file ran, and every failure was a planned assertion (wrong path values, example file not found, example path ignored, `data/` listing empty). There were no syntax, import or fixture faults. The evidence record stayed in the session scratchpad and was not committed, because it contains the hostname.
- **GREEN** `3bfc2f7`: all 14 pass, and the full `packages/core` run is 187/187.
- **REFACTOR:** none.

## Verification

- `SIFT_TEST_ADMIN_URL= pnpm exec vitest run packages/core`: 6 files, 187 tests passed
- `pnpm typecheck`: exit 0
- `git ls-files --cached --others --exclude-standard data`: only `data/mailboxes/example/rules.example.yaml`
- `pnpm lint`: no errors (1 pre-existing warning in `apps/worker/test/node-version.test.ts`, out of scope)
- Related guards: `user-facing-text`, `dependencies` and `lint-guard` tests pass (98)

## Issues Encountered

None beyond the Docker-down test environment noted above.

## User Setup Required

None. To use real rules, copy `data/mailboxes/example/rules.example.yaml` to `data/mailboxes/<slug>/rules.yaml` once the worker reads rules (later Phase 3 plans).

## Next Phase Readiness

- 03-02 onward can import `@sift/core/rules` (`loadRules`, `rulesPathFor`, `resolveDataPath`, `RulesConfig`, `ExactRule`, `RuleMatch`).
- `./classify` is in the exports map, but `packages/core/src/classify/index.ts` does not exist until 03-05. Nothing resolves it in this wave.
- Open note for Phase 4: no category name is reserved. An owner could name a category `review` (or `Review`), which may clash with the review hold when labels become folders. Consider this when Phase 4 sets the folder names.

## Self-Check: PASSED

- All 8 created files found on disk; commits 5057ac7, 302af16 and 3bfc2f7 are ancestors of HEAD; evaluation-scope resolves the 3 plan commits.

---
*Phase: 03-tiered-classification-with-traces*
*Completed: 2026-10-10*
