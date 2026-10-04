---
phase: 01-foundation-and-isolation
plan: 04
subsystem: config
tags: [zod, yaml, pino, config, redaction, cli]

# Dependency graph
requires:
  - phase: 01-foundation-and-isolation (plan 01-01)
    provides: "SUPPORTED_CONFIG_VERSION, resolveConfigPath, CommandIO/CommandModule, the lazy `config check` command entry, zod 4.6.5 / yaml 2.9.1 / pino 10.3.1 pins and the @sift/core ./config and ./log exports"
provides:
  - "@sift/core/config: strict Zod schema for config version 1, parseConfigText/loadConfig with file:line:col issues, formatIssue/formatPath"
  - "validateSlug, SLUG_PATTERN, SLUG_MAX_LENGTH, RESERVED_SLUGS (D-63)"
  - "checkMailboxEnv (D-35), applyEnvOverrides (SIFT_MODELS_URL, D-60), secretValues"
  - "@sift/core/log: createLogger (pino JSON, redact paths), REDACT_PATHS, REDACTED, redactText"
  - "config/config.example.yaml (two mailboxes, rerun-setup instruction)"
  - "sift config check [--schema-only]"
affects: [01-07, 01-09, 01-10, 01-12, 02, 03]

# Actuals (#2632)
actuals:
  tokens: 12624    # chars/4 over the realized diff ae0ef07..243620a (50496 chars)
  tasks: 3
  commits: 5
plan_head_before: ae0ef07c909a96dd69284563afc47eb7912a8065
plan_head_after: 243620ada30bc39538cb8cbb50d79a413d088ffd

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Every config object level is z.strictObject; field errors use `unlessMissing(msg)` so a missing key falls through to a per-parse map that load.ts turns into `<key> is required`"
    - "Cross-mailbox checks (duplicate slug, same IMAP mailbox) use superRefine with `when: () => true`, so they report alongside type errors in other fields"
    - "Literal-secret pre-pass walks YAML pairs before Zod; Zod's unrecognized_keys for the same key paths is suppressed so each problem is reported once"
    - "YAML parsed with prettyErrors: false and only the first message line kept, so syntax errors never quote source text"
    - "Issues are sorted into file order (line, column) before printing"
    - "Commands print issues with formatIssue(issue, displayPath) where displayPath is relative to cwd when possible"

key-files:
  created:
    - packages/core/src/config/schema.ts
    - packages/core/src/config/load.ts
    - packages/core/src/config/errors.ts
    - packages/core/src/config/slug.ts
    - packages/core/src/config/env.ts
    - packages/core/src/config/index.ts
    - packages/core/src/log.ts
    - config/config.example.yaml
    - apps/worker/src/commands/config-check.ts
    - packages/core/test/example-config.test.ts
    - packages/core/test/config.test.ts
    - packages/core/test/env.test.ts
    - packages/core/test/log.test.ts
  modified: []

key-decisions:
  - "maxAliasCount: 50 is passed to doc.toJS(), the yaml 2.9 option it belongs to (parseDocument does not accept it); an alias overflow becomes a config issue"
  - "The literal-secret message names the key (`key \"password\" looks like a secret; ...`), not the full path, because formatIssue already prefixes the path"
  - "Slug uses z.unknown().transform(validateSlug) instead of superRefine so the output type stays string; same effect (numeric slugs reach the quoting hint)"
  - "validateSlug(undefined) returns `slug is required`, ahead of the plan's `slug must be a string`"
  - "applyEnvOverrides issues use the source label `environment`, path [env, SIFT_MODELS_URL], and never echo the value"
  - "createLogger level: options.level, then non-blank SIFT_LOG_LEVEL, then info"

patterns-established:
  - "Config issue messages never contain YAML scalar values except slug, version and the duplicate-mailbox host/username/folder; secret tests assert JSON.stringify(issues) lacks the sentinel"
  - "TDD RED for a new module: commit signature-only stubs with the tests so the RED run fails on assertions, not module-not-found"
  - "RED evidence for Vitest: run with --reporter=junit --outputFile.junit=<scratch>.xml and use the test file path as the target class (the checker matches class-level)"

requirements-completed: [FND-02]

coverage:
  - id: D1
    description: "`sift config check` validates config/config.yaml (or SIFT_CONFIG) without a database, prints every problem as `<file>:<line>:<col> <yaml.path>: <message>` and exits 1 on any, 0 otherwise"
    requirement: FND-02
    verification:
      - kind: integration
        ref: "packages/core/test/example-config.test.ts#passes `sift config check --schema-only`"
        status: pass
      - kind: integration
        ref: "packages/core/test/example-config.test.ts#reports a missing config file and exits 1"
        status: pass
      - kind: unit
        ref: "packages/core/test/config.test.ts#returns every issue of a multi-error file together"
        status: pass
    human_judgment: false
  - id: D2
    description: "The shipped config/config.example.yaml validates with the real schema (D-61)"
    requirement: FND-02
    verification:
      - kind: unit
        ref: "packages/core/test/example-config.test.ts#validates with the real schema"
        status: pass
    human_judgment: false
  - id: D3
    description: "Strict schema: unknown keys, version required and equal to 1, only version/mailboxes/models/worker sections; literal secret-looking keys rejected without echoing values"
    requirement: FND-02
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#structure + literal secrets (D-57) describe blocks"
        status: pass
      - kind: other
        ref: "grep -ci 'confidence_threshold|tiers' packages/core/src/config/schema.ts -> 0; grep -c strictObject -> 6"
        status: pass
    human_judgment: false
  - id: D4
    description: "Slug rules (pattern, 40-char limit, reserved words, lowercase, numeric hint, ASCII only, uniqueness) and duplicate IMAP mailbox detection with shared password_env allowed"
    requirement: FND-02
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#slug rules (D-63) + password_env and duplicate mailboxes (D-62, D-64)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Numeric boundaries: port 1/65535 accepted, 0/65536/1143.5/\"1143\" rejected; poll_interval_seconds 10/3600 accepted, 9/3601/60.5 rejected"
    requirement: FND-02
    verification:
      - kind: unit
        ref: "packages/core/test/config.test.ts#numeric boundaries"
        status: pass
    human_judgment: false
  - id: D6
    description: "password_env presence check in one D-35 line naming variables, never values; --schema-only skips it; SIFT_MODELS_URL override validated"
    requirement: FND-02
    verification:
      - kind: unit
        ref: "packages/core/test/env.test.ts#checkMailboxEnv (D-35) + applyEnvOverrides (D-60) + secretValues"
        status: pass
      - kind: integration
        ref: "packages/core/test/env.test.ts#sift config check env step"
        status: pass
      - kind: other
        ref: "env -i PATH=$PATH SIFT_CONFIG=config/config.example.yaml node apps/worker/src/cli.ts config check -> exit 1, stderr starts with the D-35 line"
        status: pass
    human_judgment: false
  - id: D7
    description: "pino logger censors password/secret/token/connectionString at the listed depths; redactText masks secret values literally and postgres URL passwords"
    verification:
      - kind: unit
        ref: "packages/core/test/log.test.ts"
        status: pass
    human_judgment: false

# Metrics
duration: 13min
completed: 2026-10-04
status: complete
---

# Phase 1 Plan 04: Owner Config Schema, `sift config check` and Redacting Logger Summary

**Strict Zod 4 schema for `config.yaml` version 1 with a YAML loader that reports every problem as `file:line:col path: message`, slug/duplicate/literal-secret rules, the D-35 `password_env` presence check, the shipped two-mailbox example, `sift config check [--schema-only]`, and a pino logger with redaction plus a literal `redactText`.**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-10-04T05:48:16Z
- **Completed:** 2026-10-04T06:00:50Z
- **Tasks:** 3/3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Files modified:** 13 created

## Accomplishments
- `@sift/core/config` accepts exactly `version`, `mailboxes` (slug, display_name, imap{host,port,username,password_env,folder}, labels{apply_as}), `models` (provider, url, embeddings, llm) and `worker` (poll_interval_seconds). Every level is a `z.strictObject`. Defaults: folder `INBOX`, models.url `http://host.docker.internal:11434`, poll interval 60.
- The loader keeps YAML positions through `LineCounter`. Zod issues map to the node at their path, or to the nearest existing parent. Unrecognized keys point at the key itself. Issues come back in file order, all at once. An empty file, a file with only `version: 1`, and `mailboxes: []` each produce a message naming what is missing.
- Validation rules: D-63 slugs (an unquoted `2024` gets `quote it: slug: "2024"`), duplicate slugs, the same host+username+folder (case rules per D-64), integer-only port and poll interval with no coercion, and the `password_env` name pattern. Duplicate checks still run when other fields fail.
- Secret-looking keys with literal values (`password`, `token`, `api_key`, ...) are rejected before Zod, located at the key, and never echo the value. The tests assert this with sentinel values.
- `sift config check` prints `Config OK: N mailboxes (slugs); password env vars present`, or the D-35 line `Missing env vars: NAME (mailbox "slug"), ...` with exit 1. `--schema-only` skips the presence check (D-67). An invalid `SIFT_MODELS_URL` fails without echoing the value.
- `createLogger` writes pino JSON to stdout with `base: { service: 'sift' }` and redaction at three depths. `redactText` masks secret values with split/join, longest first, then masks `postgres(ql)://user:<pw>@` passwords.

## Task Commits

1. **Task 1: Tracer - `sift config check` validates the shipped example end to end** - `e2c52cd` (feat)
2. **Task 2: Slugs, duplicates, literal secrets, boundaries** - `f996178` (test, RED) + `929323f` (feat, GREEN)
3. **Task 3: password_env presence check, env overrides, redacting logger** - `66860ef` (test, RED) + `243620a` (feat, GREEN)

**Plan metadata:** recorded in the `docs(01-04)` commit that adds this SUMMARY

## TDD Gate Compliance

- Task 2: RED `f996178` (18/41 tests failed on assertions; `check tdd-red-evidence` -> RED_EVIDENCE_OK), then GREEN `929323f` (44/44 with the example test).
- Task 3: RED `66860ef` (env.test.ts 12/14 and log.test.ts 6/8 failed on assertions against signature-only stubs; both RED_EVIDENCE_OK), then GREEN `243620a` (66/66 core tests).
- Some Task 2 boundary tests passed at RED because the Task 1 tracer schema already enforced them (port and poll ranges, password_env pattern). The new behaviours (slug rules, duplicates, secrets, required messages) were the failing targets.
- No REFACTOR commits were needed.

## Files Created/Modified
- `packages/core/src/config/schema.ts` - Zod schema, defaults, `HttpUrl`, duplicate checks, inferred config types
- `packages/core/src/config/load.ts` - `parseConfigText`/`loadConfig`, YAML positions, literal-secret pre-pass, required-key fallback
- `packages/core/src/config/errors.ts` - `ConfigIssue`, `formatPath`, `formatIssue`
- `packages/core/src/config/slug.ts` - `validateSlug` and the slug constants
- `packages/core/src/config/env.ts` - `checkMailboxEnv`, `applyEnvOverrides`, `secretValues`, `EnvCheck`
- `packages/core/src/config/index.ts` - `@sift/core/config` barrel
- `packages/core/src/log.ts` - `createLogger`, `REDACT_PATHS`, `REDACTED`, `redactText`
- `config/config.example.yaml` - Two-mailbox example with copy, setup-rerun and password_env instructions
- `apps/worker/src/commands/config-check.ts` - `sift config check [--schema-only]`
- `packages/core/test/{example-config,config,env,log}.test.ts` - 66 tests (example via CLI, rules, env, logger)

## Decisions Made
- `maxAliasCount: 50` goes to `doc.toJS()`, which is where yaml 2.9 defines it. An alias overflow becomes an issue instead of a throw.
- The secret message names only the key, because `formatIssue` already prints the full path.
- The slug is `z.unknown().transform(...)` rather than `superRefine`, so the output type stays `string`. A missing slug reports `slug is required`.
- Per-parse error map: a missing key gets a sentinel message that load.ts rewrites to `<key> is required`. Schema-specific messages (version, mailboxes) take precedence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Generic "is required" overwrote schema-specific messages**
- **Found during:** Task 2 RED run
- **Issue:** The Task 1 loader replaced every missing-value message with `<key> is required`. That hid `mailboxes is required: add at least one mailbox` and would have hidden the version message.
- **Fix:** The missing-value fallback is now a per-parse Zod error map (lowest precedence) that returns a sentinel. load.ts rewrites only the sentinel.
- **Files modified:** packages/core/src/config/load.ts
- **Verification:** `rejects a file with only version: 1, naming what is missing` passes.
- **Committed in:** 929323f

**2. [Rule 3 - Blocking] `maxAliasCount` is not a parseDocument option**
- **Found during:** Task 1
- **Issue:** The plan passed `maxAliasCount: 50` to `parseDocument`. In yaml 2.9 the option is part of `ToJSOptions`.
- **Fix:** Pass it to `doc.toJS({ maxAliasCount: 50 })`, and catch the overflow as an issue.
- **Files modified:** packages/core/src/config/load.ts
- **Verification:** typecheck passes. The T-01-14 cap is still enforced at alias expansion.
- **Committed in:** e2c52cd

**3. [Rule 2 - Missing Critical] YAML syntax errors could quote source text**
- **Found during:** Task 1
- **Issue:** yaml's default `prettyErrors` appends the offending source line to the message. A syntax error on a line holding a literal password would print it.
- **Fix:** Parse with `prettyErrors: false`, keep only the first message line, and compute the position from `error.pos` through the LineCounter.
- **Files modified:** packages/core/src/config/load.ts
- **Verification:** A manual syntax-error run printed `file:2:1 (root): YAML syntax error: ...` with no source excerpt.
- **Committed in:** e2c52cd

---

**Total deviations:** 3 auto-fixed (1 Rule 1, 1 Rule 2, 1 Rule 3)
**Impact on plan:** All three are small loader corrections. No scope change.

## Issues Encountered
- Vitest 5's junit reporter writes to `.vitest/junit/output.xml` by default, which created an untracked directory. It was removed, and RED evidence was written to the scratchpad through `--outputFile.junit`.
- The RED-evidence checker's name regex picks up `classname=`, so Vitest junit failures match only at class level, where the class is the test file path. The test file was used as the target.

## User Setup Required

None. No external service configuration is required.

## Next Phase Readiness
- 01-07 (app DB) and 01-10 (worker) can use `createLogger` and `redactText`. 01-10 can also use `secretValues` for redaction and `checkMailboxEnv` for the D-35 startup check.
- 01-09 (`config apply`) can call `loadConfig` + `applyEnvOverrides` without the env presence check (D-67), the same path as `config check --schema-only`.
- The README quick start still says `cp config.example.yaml config.yaml` (D-56 asks for an update). That is not in this plan's files and is left to the docs plan.

---
*Phase: 01-foundation-and-isolation*
*Completed: 2026-10-04*

## Self-Check: PASSED

All 13 key files exist on disk. Commits e2c52cd, f996178, 929323f, 66860ef and 243620a are in git log. The plan-level verification re-ran green: `pnpm vitest run packages/core` 66/66, `pnpm test` 76/76, typecheck and `biome ci` exit 0, `config check --schema-only` on the example exits 0, and without the password env vars `config check` exits 1 with the D-35 line.
