---
phase: 01-foundation-and-isolation
plan: 01
subsystem: infra
tags: [pnpm, workspace, typescript, node-type-stripping, biome, vitest, commitlint, lefthook, cli]

# Dependency graph
requires: []
provides:
  - "pnpm 12.7.0 workspace: @sift/core, @sift/db, @sift/worker resolving as source .ts under Node 26.10.0 type stripping (no build step)"
  - "Final exports maps for @sift/core and @sift/db (later plans fill in the referenced files)"
  - "sift CLI shell (parseArgs + lazy COMMANDS table) naming all seven Phase 1 commands"
  - "@sift/core: SUPPORTED_CONFIG_VERSION, DEFAULT_CONFIG_PATH, resolveConfigPath"
  - "@sift/db: requireDatabaseUrl, DatabaseUrlVar"
  - "The whole phase dependency set, installed once at exact approved pins, in pnpm-lock.yaml"
  - "Biome lint/format with the ISO-04 static guard (no pg/drizzle-orm imports under apps/**/src)"
  - "lefthook git hooks: biome on pre-commit, commitlint (config-conventional) on commit-msg"
  - "Root scripts: sift, dev, lint, format, typecheck, test, db:generate"
affects: [01-02, 01-03, 01-04, 01-07, 01-08, 01-09, 01-10, 01-11, 01-12, docker-image, ci]

# Actuals (#2632)
actuals:
  tokens: 28880    # chars/4 over the realized diff b3ad989..6dd188b (115518 chars; pnpm-lock.yaml is ~85% of it, ~4250 without it)
  tasks: 3         # 2 auto/tracer tasks + 1 blocking-human checkpoint
  commits: 2
plan_head_before: b3ad989b1311727a09567ccaf16d652c843e533a
plan_head_after: 6dd188b6f3db486745dc8706568e876be9c6b13c

# Tech tracking
tech-stack:
  added:
    - "pnpm@12.7.0 (packageManager)"
    - "typescript@7.0.2"
    - "@types/node@26.6.3"
    - "@biomejs/biome@2.5.14"
    - "vitest@5.0.2"
    - "drizzle-kit@0.31.11"
    - "lefthook@2.1.14"
    - "@commitlint/cli@21.2.3"
    - "@commitlint/config-conventional@21.2.3"
    - "drizzle-orm@0.45.3 (@sift/db)"
    - "pg@8.23.0 (@sift/db)"
    - "@types/pg@8.23.1 (@sift/db dev)"
    - "zod@4.6.5 (@sift/core)"
    - "yaml@2.9.1 (@sift/core; @sift/worker dev)"
    - "pino@10.3.1 (@sift/core)"
  patterns:
    - "Workspace packages export ./src/*.ts directly; Node 26 strips types at runtime, tsc only typechecks (noEmit)"
    - "CLI commands live in apps/worker/src/commands/<file>.ts and load lazily through a computed import URL, so --help and config check never load pg"
    - "Commands receive a CommandIO (env, cwd, stdout, stderr) and resolve to an exit code; cli.ts sets process.exitCode instead of calling process.exit"
    - "Supply-chain gate: exact pins, minimumReleaseAge 10080, allowBuilds limited to esbuild and lefthook"
    - "App source reaches Postgres only through @sift/db; Biome noRestrictedImports enforces it statically on apps/**/src (tests are exempt)"

key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - tsconfig.base.json
    - biome.json
    - lefthook.yml
    - commitlint.config.js
    - apps/worker/package.json
    - apps/worker/tsconfig.json
    - apps/worker/src/cli.ts
    - apps/worker/src/command.ts
    - apps/worker/test/cli.test.ts
    - packages/core/package.json
    - packages/core/tsconfig.json
    - packages/core/src/index.ts
    - packages/db/package.json
    - packages/db/tsconfig.json
    - packages/db/src/index.ts
  modified:
    - tsconfig.json

key-decisions:
  - "@types/node pinned at 26.6.3: the newest 26.x that passes the 7-day minimumReleaseAge gate at install time"
  - "Biome 2.5 config uses linter.rules.preset 'recommended' (the boolean 'recommended' field is deprecated in 2.5) and Biome 2 folder negations (!.planning, not !.planning/**)"
  - "Root tsconfig.json sets allowJs + checkJs so root config files (commitlint.config.js) are actually type-checked, not just included"
  - "Biome also ignores .gsd/ (untracked GSD runtime state), so `biome ci .` only sees project files"

patterns-established:
  - "Executor commits on this repo run lefthook hooks (biome check on staged files, commitlint on the message); never bypass with --no-verify"
  - "Every commit header and body line stays within 100 characters (config-conventional)"

requirements-completed: [FND-03]

coverage:
  - id: D1
    description: "pnpm workspace with @sift/core, @sift/db, @sift/worker resolving as source .ts through workspace symlinks under Node 26.10.0 (no dist, no tsx)"
    requirement: FND-03
    verification:
      - kind: other
        ref: "pnpm --filter @sift/worker exec node --input-type=module -e \"const m = await import('@sift/db'); if (typeof m.requireDatabaseUrl !== 'function') process.exit(1)\""
        status: pass
      - kind: other
        ref: "ls packages/*/dist apps/*/dist (no build output exists)"
        status: pass
    human_judgment: false
  - id: D2
    description: "sift CLI shell: --help/-h/help list all seven Phase 1 commands and the config footer and exit 0; no args and unknown commands exit 2; the deferred D-69 command is never named"
    requirement: FND-03
    verification:
      - kind: unit
        ref: "apps/worker/test/cli.test.ts#sift CLI shell"
        status: pass
      - kind: other
        ref: "node apps/worker/src/cli.ts --help | grep -ci purge -> 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Phase dependency set installed once at the exact approved pins, behind minimumReleaseAge 10080 and the allowBuilds allowlist; lockfile is frozen-install clean"
    requirement: FND-03
    verification:
      - kind: other
        ref: "pnpm install --frozen-lockfile (no ERR_PNPM_IGNORED_BUILDS, no minimumReleaseAge cutoff)"
        status: pass
      - kind: other
        ref: "grep exact pins in packages/db/package.json, packages/core/package.json, package.json"
        status: pass
    human_judgment: false
  - id: D4
    description: "Root toolchain: pnpm lint, pnpm typecheck and pnpm test exit 0 from the repo root"
    requirement: FND-03
    verification:
      - kind: other
        ref: "pnpm lint && pnpm typecheck && pnpm vitest run apps/worker/test/cli.test.ts"
        status: pass
    human_judgment: false
  - id: D5
    description: "ISO-04 static guard: Biome rejects imports of pg, drizzle-orm and drizzle-orm/* under apps/**/src, and leaves apps/*/test unrestricted"
    verification:
      - kind: other
        ref: "Task 3 restricted-import probe (apps/worker/src/zz-restricted-probe.ts importing pg -> biome lint exits 1; probe removed)"
        status: pass
      - kind: other
        ref: "drizzle-orm/sql probe under apps/worker/src -> biome exits 1; pg probe under apps/worker/test -> biome exits 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "Commit messages are linted: commit-msg hook rejects non-conventional messages, pre-commit runs biome on staged files"
    verification:
      - kind: other
        ref: "echo 'not a conventional message' | pnpm commitlint -> exit 1; echo 'feat(01-01): add workspace' | pnpm commitlint -> exit 0"
        status: pass
      - kind: other
        ref: "commit 6dd188b ran both lefthook hooks (pre-commit biome, commit-msg commitlint) successfully"
        status: pass
    human_judgment: false

# Metrics
duration: 57min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 01: Workspace Foundation and sift CLI Shell Summary

**pnpm 12.7.0 workspace (@sift/core, @sift/db, @sift/worker) running as source .ts under Node 26 type stripping, a lazy `sift` CLI shell naming all seven Phase 1 commands, and the whole phase dependency set exact-pinned behind a 7-day age gate. Biome blocks raw pg/drizzle imports in app source, and lefthook runs commitlint and Biome on every commit.**

## Performance

- **Duration:** ~57 min, including the blocking-human package checkpoint wait
- **Started:** 2026-10-04T04:21:43Z (phase execution start)
- **Completed:** 2026-10-04T05:19:00Z
- **Tasks:** 3/3 (Task 1 tracer, Task 2 checkpoint approved, Task 3 auto)
- **Files modified:** 19

## Accomplishments
- The workspace resolves end to end from source. `node apps/worker/src/cli.ts --help` runs with no build step, and `@sift/worker` imports `@sift/db` as `.ts` through pnpm symlinks.
- The `sift` CLI shell dispatches over the `COMMANDS` table (setup, migrate, config check, config apply, mailbox list, mailbox rename, worker). Command modules load lazily, so later plans only add files under `apps/worker/src/commands/`.
- All phase dependencies are installed once at the user-approved exact versions. `pnpm install --frozen-lockfile` is clean under `minimumReleaseAge: 10080` and the `allowBuilds` allowlist. No later plan in Phase 1 touches `pnpm-lock.yaml`.
- `pnpm lint`, `pnpm typecheck` (root plus all three packages) and `pnpm test` are all green.
- The ISO-04 static guard is proven: Biome errors on `pg`, `drizzle-orm` and `drizzle-orm/*` imports under `apps/**/src`, and test files stay unrestricted.
- Conventional commits are enforced by lefthook's commit-msg hook, and the hooks ran on this plan's own Task 3 commit.

## Task Commits

1. **Task 1: Tracer - workspace skeleton where `sift --help` runs from source** - `73dedce` (feat)
2. **Task 2: Package legitimacy check (checkpoint:human-verify, blocking-human)** - no commit; the user approved the exact version list
3. **Task 3: Install the phase dependency set and wire Biome, Vitest, commitlint and lefthook** - `6dd188b` (feat)

**Plan metadata:** recorded in the `docs(01-01)` commit that adds this SUMMARY

## Files Created/Modified
- `package.json` - Root manifest: packageManager pnpm@12.7.0, engines node >=26.10.0, scripts, exact-pinned root devDependencies
- `pnpm-workspace.yaml` - Workspace globs, allowBuilds (esbuild, lefthook), minimumReleaseAge 10080
- `pnpm-lock.yaml` - Lockfile for the full phase dependency set
- `tsconfig.base.json` - Shared strict options (D-14), including `types: ["node"]` for TS 7
- `tsconfig.json` - Extends the base; allowJs + checkJs so root config files are type-checked
- `biome.json` - Formatter/linter config, useImportExtensions + useImportType, ISO-04 noRestrictedImports override
- `lefthook.yml` - pre-commit biome check on staged files; commit-msg commitlint
- `commitlint.config.js` - extends @commitlint/config-conventional
- `apps/worker/src/cli.ts` - parseArgs entry, longest-path command match, help/usage/exit-code handling
- `apps/worker/src/command.ts` - CommandIO/CommandModule/CommandSpec, COMMANDS table, loadCommand
- `apps/worker/test/cli.test.ts` - spawnSync CLI tests (help, -h/help parity, no args, unknown command, D-69)
- `packages/core/src/index.ts` - SUPPORTED_CONFIG_VERSION, DEFAULT_CONFIG_PATH, resolveConfigPath
- `packages/db/src/index.ts` - requireDatabaseUrl (names the variable, never the value)
- `apps/worker/package.json`, `packages/core/package.json`, `packages/db/package.json` - package manifests, final exports maps, exact-pinned deps
- `apps/worker/tsconfig.json`, `packages/core/tsconfig.json`, `packages/db/tsconfig.json` - extend the base, include src and test

## Decisions Made
- `@types/node` resolved to 26.6.3, the newest 26.x past the age gate at install time, and is pinned exactly.
- Biome 2.5 config uses `preset: "recommended"` instead of the deprecated `recommended: true`, and Biome 2 folder negations (`!.planning`).
- The root tsconfig type-checks root `.js` config files (allowJs + checkJs) instead of only including them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] @types/node saved as a caret range despite --save-exact**
- **Found during:** Task 3 (install)
- **Issue:** `pnpm add --save-exact @types/node@26` wrote `"^26.6.3"`, because the request was a range spec. The plan requires exact pins.
- **Fix:** Set `"@types/node": "26.6.3"` in package.json and re-ran `pnpm install`, so the lockfile specifier is `26.6.3`.
- **Files modified:** package.json, pnpm-lock.yaml
- **Verification:** `pnpm install --frozen-lockfile` passes; the lockfile shows `specifier: 26.6.3`
- **Committed in:** 6dd188b

**2. [Rule 3 - Blocking] `tsc -p tsconfig.json` failed with TS18003 (no inputs)**
- **Found during:** Task 3 (`pnpm typecheck`)
- **Issue:** The root include is `["*.ts", "*.js"]`, and the only root source file is `commitlint.config.js`. Without allowJs, tsc found no inputs and exited 2.
- **Fix:** Added `compilerOptions.allowJs: true` and `checkJs: true` to the root tsconfig.json.
- **Files modified:** tsconfig.json
- **Verification:** `pnpm typecheck` exits 0
- **Committed in:** 6dd188b

**3. [Rule 3 - Blocking] Biome would lint untracked GSD runtime state**
- **Found during:** Task 3 (biome.json)
- **Issue:** `.gsd/dispatch-isolation-sentinel.json` is untracked tool state that is not in .gitignore, so `biome ci .` would format-check it.
- **Fix:** Added `!.gsd` to `files.includes` next to the planned negations. `pnpm format` normalized all folder negations to Biome 2's `!dir` form.
- **Files modified:** biome.json
- **Verification:** `pnpm lint` checks only project files and exits 0
- **Committed in:** 6dd188b

**4. [Rule 1 - Bug] Deprecated `linter.rules.recommended` in Biome 2.5.14**
- **Found during:** Task 3 (`pnpm lint`)
- **Issue:** Biome reported a DEPRECATED diagnostic for `recommended: true` (to be removed in the next major).
- **Fix:** Replaced it with `"preset": "recommended"` (schema enum: recommended | all | none).
- **Files modified:** biome.json
- **Verification:** `pnpm lint` reports no diagnostics
- **Committed in:** 6dd188b

---

**Total deviations:** 4 auto-fixed (2 Rule 1, 2 Rule 3)
**Impact on plan:** All were small config corrections needed for exact pins and a green toolchain. No scope change, and no version differs from the approved list.

## Issues Encountered
- lefthook's postinstall auto-created a sample `lefthook.yml` on first install. It was replaced with the planned config, `pnpm lefthook validate` reports "All good", and `pnpm lefthook install` synced the pre-commit and commit-msg hooks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Every later Phase 1 plan can import `@sift/core` / `@sift/db` as source and add command modules under `apps/worker/src/commands/` without touching dependencies.
- From now on, commits run lefthook. Messages must be conventional, with the header and each body line at or under 100 characters.
- Plan 01-03 adds `vitest.config.ts`. Until then, Vitest runs with its defaults.

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED

All 19 key files exist on disk. Commits 73dedce and 6dd188b are present in git log. Task 1 and Task 3 verify blocks re-ran green at SUMMARY time.
