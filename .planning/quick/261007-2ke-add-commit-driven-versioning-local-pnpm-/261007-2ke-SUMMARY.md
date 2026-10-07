---
phase: quick-261007-2ke
plan: 01
subsystem: release
status: complete
tags: [release, versioning, conventional-commits, ci, changelog, cli]
requires: []
provides:
  - "`pnpm release [--dry-run]`: local, commit-driven semver release (package.json versions, CHANGELOG.md, chore(release) commit, annotated tag, never pushes)"
  - "CI tag check `.github/workflows/release-tag.yml` -> `node scripts/release-check.ts \"$GITHUB_REF_NAME\"`"
  - "`sift --version`"
affects: [package.json, apps/worker/package.json, packages/core/package.json, packages/db/package.json, CONTRIBUTING.md, vitest.config.ts, tsconfig.json]
tech-stack:
  added: []
  patterns:
    - "Root `test/` folder for tests of root scripts (vitest include + root tsconfig include)"
    - "Template git repos built once per test file and copied per test (test/support/release-repo.ts)"
    - "Git only through execFileSync argv arrays; no shell"
key-files:
  created:
    - scripts/release-plan.ts
    - scripts/release.ts
    - scripts/release-check.ts
    - .github/workflows/release-tag.yml
    - test/release-plan.test.ts
    - test/release.test.ts
    - test/release-check.test.ts
    - test/support/release-repo.ts
  modified:
    - package.json
    - apps/worker/package.json
    - packages/core/package.json
    - packages/db/package.json
    - tsconfig.json
    - vitest.config.ts
    - apps/worker/src/cli.ts
    - apps/worker/test/cli.test.ts
    - apps/worker/test/user-facing-text.test.ts
    - CONTRIBUTING.md
decisions:
  - "Release tests live in a root test/ folder (owner change relayed by the coordinator mid-run); moved with a follow-up git mv commit, no history rewrite"
  - "Root tests load `yaml` via createRequire from apps/worker/package.json instead of adding a root dependency (LD-5)"
  - "release-check reports only the format problem for a malformed tag (strict regex before any use, T-2ke-02)"
  - "Release e2e describes and their template beforeAll use a 120 s timeout (a dozen git/node spawns per case)"
metrics:
  duration: "40 min"
  completed: 2026-10-07
estimate:
  tokens: 110000
  tasks: 3
actuals:
  tokens: 15600
  tasks: 3
  commits: 5
plan_head_before: 927ae710422e7ba3d817a5e8dd4c7e89d22cdf67
plan_head_after: 1e275d996a825e96c16c69039ee549a54b2d48e1
---

# Phase quick-261007-2ke Plan 01: Commit-driven versioning Summary

`pnpm release` computes the next semver from the Conventional Commits since the last `v*` tag (first release v0.1.0; feat gives minor, anything else patch, breaking gives minor while major is 0). It writes all four package.json files and CHANGELOG.md, makes one explicit-pathspec `chore(release): vX.Y.Z` commit and an annotated tag, and never pushes. A `contents: read` workflow rejects a pushed tag that disagrees with the files. `sift --version` prints the worker version.

## Tasks

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 | End-to-end `pnpm release` for v0.1.0 with --dry-run (tracer) | 09e943d | scripts/release-plan.ts, scripts/release.ts, 4x package.json, tsconfig.json, release.test.ts |
| - | Move release tests to root `test/` (owner change) | 3015bde | test/release.test.ts, vitest.config.ts, tsconfig.json |
| 2 | Bump rules, refusals, guards and rollback (TDD) | 0bb2eb4 | scripts/release-plan.ts, scripts/release.ts, test/release-plan.test.ts, test/release.test.ts, test/support/release-repo.ts |
| 3 | CI tag check workflow, `sift --version`, CONTRIBUTING Releases (TDD) | 5552e76 | scripts/release-check.ts, .github/workflows/release-tag.yml, test/release-check.test.ts, apps/worker/src/cli.ts, CONTRIBUTING.md |
| - | 120 s timeout for release e2e tests | 1e275d9 | test/release.test.ts, test/release-check.test.ts |

## Verification

- Targeted: `SIFT_TEST_ADMIN_URL= pnpm vitest run test/release-plan.test.ts test/release.test.ts test/release-check.test.ts apps/worker/test/cli.test.ts apps/worker/test/user-facing-text.test.ts apps/worker/test/ci-workflow.test.ts apps/worker/test/bridge-image.test.ts apps/worker/test/dependencies.test.ts`: 8 files, 217/217 passed.
- Full `pnpm test` (db and IMAP test server up, live bridge/worker stack running): 1004 passed, 6 failed, all `Test timed out in 30000ms` under host load. One was `test/release.test.ts` (fixed in 1e275d9); the other 5 are pre-existing files (bridge-probe, compose-smoke, imap-folder-source, imap-pin), cerebrum bug-189. A rerun of all 7 affected files with `--maxWorkers=3` passed 150/150.
- `pnpm lint` exits 0. Its one warning is pre-existing, in apps/worker/test/node-version.test.ts. `pnpm typecheck` exits 0. `actionlint .github/workflows/release-tag.yml` is clean.
- The no-shell grep (`execSync` / `shell: true`) over scripts/release*.ts finds nothing. pnpm-lock.yaml is untouched and no commit in this plan changes it.
- `node apps/worker/src/cli.ts --version` prints `0.0.0`.
- Real-repo `pnpm release --dry-run` exits 0 and prints `Next release: v0.1.0 (first release, no v* tag)` and the section. It also prints `a real run would refuse: the working tree must be clean` for the owner's modified .wolf/.gsd files. HEAD, the `v*` tags and `git status --porcelain` are unchanged afterwards.
- `git tag -l 'v*'` is empty, and the count of `chore(release):` commits is 0: no release was cut (LD-8).

## TDD Gate Compliance

- Task 2 RED: `test/release-plan.test.ts` and `test/release.test.ts` ran against the Task 1 implementation: 15 failed on assertions, 17 passed. `gsd-tools check tdd-red-evidence` gave RED_EVIDENCE_OK for both files (also captured before the move at the old paths). GREEN: 32/32.
- Task 3 RED: I put a throwaway `scripts/release-check.ts` stub that returns wrong values in the working tree and never committed it. 26 failed on assertions (release-check, cli --version, CONTRIBUTING pins, workflow pins). RED_EVIDENCE_OK for test/release-check.test.ts, apps/worker/test/cli.test.ts and apps/worker/test/user-facing-text.test.ts. GREEN: 176/176 with ci-workflow and bridge-image included.
- RED and GREEN went into one commit per task, not separate `test(...)` commits. The plan asks for per-task atomic commits and RED evidence capture, not RED commits.

## Deviations from Plan

### Coordinator-relayed owner change

**1. Release tests moved to a root `test/` folder**
- **Found during:** Task 2, from a coordinator message during the run.
- **Change:** `apps/worker/test/release.test.ts` became `test/release.test.ts`; Task 1 had already committed it, so the move is a follow-up `git mv` commit (3015bde). `release-plan.test.ts` was created in `test/`. The release-check tests went into `test/release-check.test.ts` instead of being appended to release.test.ts. vitest.config.ts includes `test/**/*.test.ts`, and the root tsconfig includes `test/**/*.ts`. The `sift --version` cases stay in apps/worker/test/cli.test.ts.
- **Consequence:** the root has no `yaml` dependency, and LD-5 forbids adding one. Root tests therefore load the worker's `yaml` through `createRequire(apps/worker/package.json)` (`parseYaml` in test/support/release-repo.ts).
- The plan's verify commands name the old paths; use the `test/` paths instead.

### Auto-fixed Issues

**2. [Rule 3 - Blocking] Slow e2e tests: shared template repos**
- **Found during:** Task 2 RED. Each e2e case took 5-16 s, because each git or node spawn on this host costs about 0.3-1.5 s of wall time at near-zero CPU.
- **Fix:** test/support/release-repo.ts `releaseRepos()` builds the fresh and released template repos once per file and `cpSync`s a copy per test. The remote URL is relative, so copies stay valid.
- **Commit:** 0bb2eb4

**3. [Rule 1 - Bug] Release e2e tests timed out under full-suite load**
- **Found during:** final `pnpm test`, where the first-release case hit 30 s.
- **Fix:** the describes and the template `beforeAll` in test/release.test.ts and test/release-check.test.ts get a 120 s timeout.
- **Commit:** 1e275d9

**4. [Rule 2 - Correctness] release-check stops at a malformed tag**
- **Issue:** a tag like `v0.2` would also have produced version-mismatch and changelog problems, but the plan expects one problem naming the culprit.
- **Fix:** `releaseProblems` returns only the format problem when the tag fails `^v\d+\.\d+\.\d+$`. This is also the T-2ke-02 rule: validate the tag before using it.
- **Commit:** 5552e76

**5. [Rule 2] Tag failure after a successful commit**
- **Change:** this case is reported as a ReleaseRefusedError carrying git's message and the exact `git tag -a vX.Y.Z -m "Release vX.Y.Z"` command to finish by hand. The commit is kept, as the plan says.
- **Commit:** 0bb2eb4

## Known Stubs

None.

## Threat Flags

None. Every new surface is covered by the threat register (T-2ke-01..07, SC).

## Self-Check: PASSED

- All 8 created files exist. Commits 09e943d, 3015bde, 0bb2eb4, 5552e76 and 1e275d9 are in `git log`.
