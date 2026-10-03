# Phase 1: Foundation and Isolation - Research

**Researched:** 2026-10-03
**Domain:** TypeScript/pnpm monorepo on Node 26 (native type stripping), Postgres 18 + pgvector row-level security, Drizzle migrations, Docker Compose
**Confidence:** HIGH for the RLS, role and migration mechanics (runtime-tested on PostgreSQL 18.3 this session); MEDIUM for Compose/CI details (docs and assumptions, not run here because the Docker daemon is not running)

## Summary

Most of the locked decisions in CONTEXT.md work as written. I ran PostgreSQL 18.3 (PGlite) together with the real drizzle-kit 0.31.11 output and the real drizzle-orm 0.45.3 migrator. Under that setup the D-41 policy expression, FORCE RLS, composite FKs (D-04) and transaction-local `set_config` (D-42) behave the way D-48 expects, case by case. The catalog queries for D-37 also return the expected values. The planner can treat the policy, the catalog test and the isolation test as known quantities. Code skeletons for each are below.

Four findings change how the decisions must be implemented, and one breaks a decision outright:

1. **BLOCKER-class conflict: D-29 (pg_dump as setup's owner credentials) cannot coexist with D-41 (FORCE RLS on owner).** With FORCE RLS on a table, a non-superuser table owner gets `ERROR 42501 query would be affected by row-level security policy` from `pg_dump`'s default `row_security = off`. With `--enable-row-security` it silently dumps zero mail rows. Phase 1 will not hit this, because the first `migrate` dumps an empty database. Phase 2's first migration will. A decision is needed (see Open Questions Q1). The recommended fix is a third, dump-only `sift_backup` role (`BYPASSRLS` + `pg_read_all_data`) created by the initdb bootstrap.
2. **Node 26 does not ship corepack.** D-10's `corepack enable` needs `npm install -g corepack` first in Docker. CI should use `pnpm/action-setup@v6`, which reads `packageManager`.
3. **`CREATE EXTENSION vector` needs a superuser.** pgvector's control file has no `trusted = true`, so the `sift_owner` migration cannot create it. Create the extension in the superuser bootstrap (in `template1` and `sift`) and keep `CREATE EXTENSION IF NOT EXISTS vector` in migration 0000 as a no-op assertion.
4. **drizzle-kit 0.31 has no FORCE RLS and no GRANT support.** FORCE, grants and the `updated_at` trigger must go in a custom migration (`drizzle-kit generate --custom`) committed next to each generated migration.

The `postgres:18` image also moved its volume to `/var/lib/postgresql`. Mounting `sift-pgdata` at the old `/data` path silently loses data.

**Primary recommendation:**
- Use drizzle-orm 0.45.x / drizzle-kit 0.31.x (stable, not the 1.0 RC), node-postgres, Vitest 5 with a single migrated throwaway DB per run, Zod 4 + `yaml` for config, and pino.
- Put the superuser-only work (roles `sift_owner` [+ `sift_backup`], database `sift`, extension `vector`) in one idempotent `.sql` bootstrap. Compose initdb, CI and the test harness all run that same file.
- Resolve Q1 (pg_dump role) before planning the `sift migrate` task.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mailbox isolation (RLS, FORCE, policy, composite FKs) | Database / Storage | API/Backend (`packages/db` scoped API) | ADR-0001: RLS is the backstop and enforcement lives in Postgres. App-level filtering (ISO-04) is the second layer |
| Role bootstrap (`sift_owner`, `sift_backup`, `sift` DB, `vector` ext) | Database (superuser initdb script) | CI / test harness runs the same SQL | Needs superuser, which setup/worker never get (D-39) |
| `sift_app` create/rotate, migrations, advisory lock, pre-migration backup | Backend CLI (`sift migrate`, setup container) | Database | Owner credentials only. Runs before the worker starts (D-27) |
| Config parsing/validation (`config.yaml`, env presence) | Backend library (`packages/core`) | CLI (`sift config check/apply`), worker startup | One shared code path (D-65) |
| Mailbox registry reconciliation | Backend CLI (`sift config apply`, owner role) | Database (`mailbox` unscoped table) | Worker may only read `mailbox` (D-06, D-34) |
| Scoped data access (`withMailbox`, scoped helpers, `requireActive`) | Backend library (`packages/db`) | Database (RLS backstop) | The only surface app code gets (D-42..D-45) |
| Scheduler/supervisor, heartbeat, graceful shutdown | Backend process (`apps/worker`) | Compose (healthcheck, `stop_grace_period`, restart) | D-49..D-55 |
| Stack orchestration | Docker Compose | Dockerfile (Node image from `.nvmrc`) | FND-01 |
| Schema check / isolation proof | CI (GitHub Actions + Vitest + PG service) | Database catalog (`pg_catalog`) | "Fails the build" is literal (D-26, D-37) |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Schema scope
- **D-01:** Phase 1 creates every M1 table now with minimal columns: `mailbox`, `mailbox_status`, `message`, `label`, `decision`, `folder_sync`, `label_event`, `rule_set`. Later phases add columns via migrations. The RLS test covers every table from day one.
- **D-02:** `message` has keys + timestamps only (`id`, `mailbox_id`, `created_at`, `updated_at`). Message-ID, UID, header hash etc. are added in Phase 2 after the Bridge spike decides message identity.
- **D-03:** Primary keys are UUIDv7 on all tables. `mailbox` additionally has a unique `slug` and an optional `display_name`. — **Reversibility:** one-way — changing PK type later requires rewriting every table and every composite FK.
- **D-04:** Child tables use composite foreign keys including `mailbox_id` (each parent has `UNIQUE (mailbox_id, id)`; children reference `(mailbox_id, <parent>_id)`), so the database rejects a row in mailbox A pointing at mailbox B's parent. — **Reversibility:** costly — every FK and the scoped helpers depend on the composite shape.
- **D-05:** Mailbox rows are never hard-deleted by the app: FKs to `mailbox` are `ON DELETE RESTRICT`; `mailbox.disabled_at` soft-disables. Hard delete only via explicit `sift mailbox purge`.
- **D-06:** `mailbox` is an unscoped registry (configuration, not mail-derived): no RLS on it; `sift_app` has SELECT only. Its column set is fixed and asserted by the catalog test (see D-37), so adding a column is a deliberate test change.
- **D-07:** New `mailbox_status` table holds worker runtime state, one row per mailbox: `mailbox_id` is PK and FK; columns `state` (ok / error / disabled), `last_error`, `last_sync_at`, `last_seen_at`. It is mailbox-scoped like any other table (RLS, `sift_app` may write, covered by the catalog test). The worker never updates `mailbox`.
- **D-08:** Timestamps are `timestamptz`, UTC, `DEFAULT now()`; `created_at`/`updated_at` on every table.
- **D-09:** The first migration runs `CREATE EXTENSION vector` (pgvector enabled, no vector columns until M2).

#### Toolchain & runtime
- **D-10:** pnpm workspaces; pnpm version pinned via `packageManager` in root `package.json` and corepack (Docker build and CI run `corepack enable`).
- **D-11:** Node 26. `.nvmrc` is the single source of the Node version; the Docker build reads it (e.g. as a build arg feeding the base image tag) and CI reads it too.
- **D-12:** The worker runs `.ts` directly with Node's native type stripping, no build step. Consequences: erasable syntax only (no enums, namespaces, parameter properties), explicit `.ts` import extensions.
- **D-13:** Workspace packages (`packages/core`, `packages/db`) export source `.ts` via `package.json` `exports`; `tsc` is used only for typechecking (`noEmit`).
- **D-14:** Shared strict `tsconfig.base.json`: `strict`, `module`/`moduleResolution` `nodenext`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`, `noEmit`; packages extend it.
- **D-15:** Biome for lint and format. Vitest for tests.
- **D-16:** commitlint (conventional commits, matching the existing `docs:`/`chore:` history) + lefthook for git hooks.
- **D-17:** Postgres 18 with pgvector (`pgvector/pgvector:pg18`).
- **D-18:** Drizzle with node-postgres (`pg`).
- **D-19:** Migrations: Drizzle schema in TS (including RLS policies), `drizzle-kit generate` produces SQL that is reviewed and committed; custom SQL migrations for roles and grants. Never `drizzle-kit push`.
- **D-20:** Worker image base `node:<version from .nvmrc>-<debian codename>-slim` (e.g. `node:26-trixie-slim`), runs as the non-root `node` user. The image used by `setup` includes `postgresql-client-18` for `pg_dump`.
- **D-21:** Images are built locally on the target machine (`docker compose build`); no registry or multi-arch publishing in M1.
- **D-22:** Development loop: Postgres in Compose, worker on the host (`pnpm dev` with `node --watch`). Full stack via `docker compose up` for the owner.
- **D-23:** Logging with pino, JSON to stdout, with redaction paths for anything password-like. No external log shipping.
- **D-24:** The `sift` CLI uses `node:util` `parseArgs` for subcommand dispatch (no CLI framework).
- **D-25:** Postgres data lives in a named Docker volume `sift-pgdata`.
- **D-26:** GitHub Actions CI with a Postgres 18 + pgvector service container runs Biome, `tsc`, and Vitest (including the schema check and isolation test), so "fails the build" is literal.

#### Mailbox lifecycle and migrations
- **D-27:** A one-shot `setup` Compose service runs `sift migrate` then `sift config apply`. The worker `depends_on` setup with `condition: service_completed_successfully` (and db healthy). Restarting only the worker does **not** reconcile config.
- **D-28:** After editing `config.yaml`, the owner reruns `docker compose run --rm setup`. This is documented next to the config file (in `config/config.example.yaml` comments and the README).
- **D-29:** `sift migrate` takes a `pg_dump` (custom format) into `./backups/` before applying, but only when there are pending migrations. Files are named with timestamp and target migration (e.g. `sift-<ts>-pre-<migration>.dump`); keep the last 5, prune older ones after a successful dump. `pg_dump` runs inside the setup container (bind mount `./backups`). On a Mac, host development needs `pg_dump` 18 locally.
- **D-30:** `sift migrate` holds a Postgres advisory lock for the whole run, even though only setup migrates normally (protects against a concurrent manual run).
- **D-31:** Development equivalent of setup: `pnpm sift migrate && pnpm sift config apply` with the owner database URL from `.env.development`, then start the worker with the app-role URL.
- **D-32:** `sift config apply` handles safe changes automatically: add a new slug, update IMAP/display fields, set `disabled_at` for a slug removed from config, re-enable a returning slug. Risky changes need explicit CLI commands: `sift mailbox rename <old> <new>`, `sift mailbox purge <slug>`.
- **D-33:** Guards on `config apply`: a broken or empty config aborts the apply and changes nothing (never disables every mailbox). If one slug disappears while another appears in the same apply, stop and suggest `sift mailbox rename`, unless `--confirm` is passed.
- **D-34:** At worker start, if `config.yaml` differs from the DB registry, the worker refuses to start, lists each difference, and tells the owner to run `docker compose run --rm setup`.
- **D-35:** Missing or empty `password_env` variables fail fast, before connecting to anything (so the error is the first and only thing in the log). Report every problem at once, e.g. `Missing env vars: SIFT_JOBS_IMAP_PASSWORD (mailbox "job-search"), SIFT_SIDE_IMAP_PASSWORD (mailbox "side")`. Name the variable, never its value. Whitespace-only values count as empty.

#### Isolation enforcement
- **D-36:** Roles after Phase 1: `sift_owner` (owns schema; runs migrate, config apply, rename, purge) and `sift_app` (worker; DML only, `NOBYPASSRLS`, not superuser, owns nothing). Cross-mailbox reader role is deferred to M2.
- **D-37:** Catalog test (Vitest, against a migrated DB, via `pg_catalog`) is the schema check for success criterion 3. It asserts:
  - every table not on the allowlist has a `NOT NULL` `mailbox_id` FK to `mailbox`, RLS enabled **and** forced, and the standard policy (D-41);
  - `sift_app` owns no table and has neither `BYPASSRLS` nor superuser;
  - per-table privilege expectations for `sift_app` (four DML operations on normal scoped tables, SELECT+INSERT on append-only tables, SELECT only on `mailbox`);
  - allowlisted tables get their own assertions: `mailbox` — `sift_app` read-only and column list equals a fixed expected set (no mail-derived columns); `__drizzle_migrations` — `sift_app` has no access at all.
- **D-38:** The allowlist is a `Record<string, string>` of table name to non-empty reason (the test asserts no reason is blank). Stale entries fail: the test asserts every allowlisted table exists. "Exempt" means checked differently, not unchecked.
- **D-39:** Role bootstrap: a `docker-entrypoint-initdb.d` script creates `sift_owner` (password from `SIFT_DB_OWNER_PASSWORD`) and the `sift` database owned by it, on first volume init. `sift_owner` is **not** the image's `POSTGRES_USER`. The superuser is unused after init; setup and worker never get superuser credentials. `sift migrate` idempotently creates/ALTERs `sift_app` with the password from `SIFT_DB_APP_PASSWORD` (re-runs rotate it).
- **D-40:** Grants are explicit per migration (no `ALTER DEFAULT PRIVILEGES`). Append-only tables (`label_event`, `decision`) grant `sift_app` only SELECT and INSERT, so UPDATE/DELETE fail at the privilege check before any policy is evaluated.
- **D-41:** One identical RLS policy per scoped table, `FOR ALL TO sift_app, sift_owner`, with both `USING` and `WITH CHECK` = `mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid`. It applies to `sift_owner` too because FORCE RLS subjects the owner to RLS; without it, purge and data migrations would silently see zero rows. Owner operations on mail data therefore also run under `app.mailbox_id`. — **Reversibility:** costly — the catalog test checks this exact expression on every table.
- **D-42:** `withMailbox(mailboxId, fn)` in `packages/db` opens a transaction and calls `set_config('app.mailbox_id', id, true)` (transaction-local), so pooled connections never carry a mailbox between uses. App code never receives a raw transaction or the raw pool; the scoped API is the enforcement for ISO-04.
- **D-43:** The scoped API has two layers inside `packages/db`: per-table scoped helpers as the base (e.g. `scope.message.insert/find/update/delete`, generated from a generic helper over each registered scoped Drizzle table, always adding `eq(table.mailboxId, scope.mailboxId)`), with hand-written use-case functions built on top. No escape hatch to a raw transaction.
- **D-44:** On inserts, `mailbox_id` is filled from the scope and omitted from the input type (`Omit<…, 'mailboxId'>`), so callers cannot express a cross-mailbox write; RLS still backstops.
- **D-45:** `withMailbox` does isolation only: it scopes any existing mailbox, disabled or not. "Disabled" is enforced elsewhere: the worker scheduler starts loops only for enabled mailboxes and rechecks the registry each tick; processing entry points (ingest, classify, apply labels) call `requireActive(scope)` (or pass `{ requireActive: true }`), which throws if `disabled_at` is set. Reading status and history does not.
- **D-46:** Tests that need "application-level filter removed" connect as `sift_app` directly with their own `pg` client and run `set_config` + raw SQL. `packages/db` has no test escape hatch.
- **D-47:** Tests use a throwaway database per run on the Compose Postgres locally / the service container in CI: create `sift_test_<random>`, run the real migrations, connect as the real `sift_app`, drop afterwards.
- **D-48:** The two-mailbox isolation test (ISO-03) covers these cases, scoped to mailbox A unless stated:

  | Attempt | Expected |
  |---|---|
  | Read, update or delete B's rows | 0 rows affected |
  | Insert a row with `mailbox_id` = B | Fails: row-level security violation |
  | Update an A row to set `mailbox_id` = B (moving it) | Fails: row-level security violation |
  | Insert an A row that references B's message | Fails: foreign key violation (composite FK) |
  | No mailbox ever set, on a fresh connection | Reads return nothing, inserts fail |
  | Reused connection after a previous `withMailbox` | Reads return nothing, no error (the `nullif` case) |
  | `app.mailbox_id` set to a non-UUID string | Errors; never returns rows |

#### Worker in Phase 1
- **D-49:** The worker runs the real scheduler skeleton with a no-op per-mailbox batch: after startup checks (env, config, drift), a supervisor ticks, rereads the registry, starts/stops mailbox tasks, touches the heartbeat file, and coordinates shutdown. Each due mailbox runs as its own async task; the Phase 1 batch updates `mailbox_status.last_seen_at` (and `last_sync_at` / state on success). Phase 2 drops ingest into this loop.
- **D-50:** Mailboxes run concurrently and fail independently. A mailbox never overlaps itself: an in-progress flag per mailbox; if a run exceeds the interval, the next run is skipped, not stacked.
- **D-51:** A failing mailbox run sets `mailbox_status.state = error` with a redacted `last_error` (no secrets) and backs off exponentially (capped, e.g. 15 min); the next success sets `ok`. Mailbox failures are visible in `mailbox_status`, not in container health.
- **D-52:** Interval defaults to 60 s, configurable via `worker.poll_interval_seconds`.
- **D-53:** Graceful shutdown on SIGTERM/SIGINT: stop scheduling, let in-flight batches finish within a bounded timeout, close the pool, exit 0. Compose `stop_grace_period` matches.
- **D-54:** Health: the supervisor touches a heartbeat file each tick; the Compose healthcheck fails if it is stale. No HTTP port.
- **D-55:** DB connection at startup retries only self-resolving errors: connection refused, host not found, `57P03` (database starting up) → backoff with jitter for about 30 s, then exit 1. `28P01` (wrong password), `3D000` (database does not exist), `42501` (permission denied) → fail immediately with a clear message. Compose `depends_on` (db healthy, setup completed) plus a restart policy handle the rest.

#### Config file
- **D-56:** Config lives in a `./config/` folder (separate from `data/`), mounted read-only into setup and worker. It contains `config/config.example.yaml` (committed) and `config/config.yaml` (gitignored). `SIFT_CONFIG` may override the path. README quick start (`cp config.example.yaml config.yaml`, `sift mailbox add`) must be updated to match.
- **D-57:** Validation is Zod in `packages/core`, strict everywhere (unknown keys are errors with YAML path and message). Any key named like password/secret with a literal value is rejected explicitly.
- **D-58:** `version` is required and must equal `1`; a missing or other value fails with a message naming the supported version. No auto-upgrade in M1.
- **D-59:** Phase 1 schema accepts exactly these sections, using the README's names and structure — **Reversibility:** one-way — strict validation makes any later rename a breaking config change for every owner:
  ```yaml
  version: 1
  mailboxes:
    - slug: personal
      display_name: Personal          # optional
      imap: { host, port, username, password_env, folder }   # folder defaults to INBOX
      labels: { apply_as: proton_labels }
  models:
    provider: ollama
    url: http://host.docker.internal:11434
    embeddings: nomic-embed-text      # README name: "embeddings", not "embedding"
    llm: qwen3:1.7b
  worker:
    poll_interval_seconds: 60
  ```
  No `confidence_threshold` in Phase 1: the README puts thresholds under `tiers` (0.85 Tier 1, 0.75 Tier 2); it is added with the `tiers` section in the phase that uses it.
- **D-60:** Model URL: keep the `host.docker.internal` default; add `extra_hosts: ["host.docker.internal:host-gateway"]` to the worker's Compose entry so it works on Linux; allow `SIFT_MODELS_URL` to override for host development (e.g. `http://localhost:11434`). Linux with Ollama in Compose uses `http://ollama:11434`.
- **D-61:** A CI test parses `config/config.example.yaml` with the real schema so the shipped example always validates.
- **D-62:** Mailbox field validation is shape only, no network: `host` non-empty, `port` 1–65535, `username` non-empty, `folder` default `INBOX`, `password_env` matches `^[A-Z_][A-Z0-9_]*$`, `labels.apply_as` enum `[proton_labels]` for now. Connectivity is tested in Phase 2.
- **D-63:** Slug rules — **Reversibility:** one-way — slugs appear in paths, CLI commands and future URLs; renaming an existing mailbox is a migration for the owner:
  - pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$` plus a separate length check of 1–40 (clearer "slug too long" error); allows `personal`, `job-search`, `side2`; rejects `jobs-`, `-jobs`, `job--search`;
  - reserved: `all`, `new`, `settings`, `shared` → clear "reserved" error;
  - reject, never fix: `Personal` fails with "slugs must be lowercase";
  - an unquoted numeric slug (e.g. `2024`) arrives as a number; the error suggests quoting it;
  - uniqueness checked across the file.
- **D-64:** Duplicate detection: reject two mailboxes with the same `host` + `username` + `folder` (would double-process mail); allow a shared `password_env` (one Bridge password for several addresses).
- **D-65:** `sift config check` is a standalone command needing no DB: parses and validates config plus env-var presence, prints all errors with YAML paths/line numbers, exits 1 on any. The same code is used by `config apply` and the worker.

### Claude's Discretion
- Exact column lists for the minimal tables beyond keys/timestamps/`mailbox_id` (e.g. whether `rule_set` gets a `version` column now), as long as D-01/D-02 hold.
- Whether UUIDv7 is generated by Postgres 18's native `uuidv7()` as a column default or in application code.
- How `updated_at` is maintained (trigger vs app).
- Privileges `sift_owner` needs to create/alter `sift_app` (e.g. `CREATEROLE`) and how the initdb script grants them.
- Exact backoff caps and jitter values; heartbeat file path and staleness threshold; graceful shutdown timeout.
- `.env` / `.env.example` / `.env.development` layout and which variables each Compose service receives (principle: setup gets owner credentials, worker gets only app credentials).
- Compose service details (healthcheck commands, restart policies, whether the db port is exposed on the host for development).
- Plan split and wave ordering.

### Deferred Ideas (OUT OF SCOPE)
- **Phase 2 spike addition:** determine how Proton Bridge's address mode maps to Sift mailboxes. In combined mode several addresses share one IMAP mailbox, so separate Sift mailboxes for `me@` and `jobs@` on one account would be the same INBOX and trip the duplicate check (D-64); split mode may be what makes "personal + job-search on one Proton account" work.
- Cross-mailbox reader role (`sift_reader`) — M2, with the unified review queue.
- `tiers` config section with confidence thresholds — Phase 3.
- Multi-arch image publishing — not in M1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | Owner can bring up the stack (Postgres with pgvector, worker) with Docker Compose, migrations applied automatically or by one documented command | Compose layout (db + setup + worker), PG18 volume path, initdb bootstrap, TCP healthcheck, corepack/pnpm in Docker, `.nvmrc`-driven base image, compose smoke job in CI |
| FND-02 | Mailbox in `config.yaml`; password only from `password_env`; never in config/DB | Zod 4 strict schema + `yaml` LineCounter for line numbers (verified), literal-secret key rejection pre-pass, split env files so the worker gets only mailbox + app creds, secret-sentinel test. **Note:** the requirement text includes "LLM confidence threshold", which D-59 (locked) defers to Phase 3 (see Open Questions Q4) |
| FND-03 | TS workspace layout `apps/worker`, `packages/core`, `packages/db` with Drizzle schema + migrations in `packages/db` | pnpm 12 workspace with `allowBuilds`, source-`.ts` exports work through pnpm symlinks under Node 26 type stripping (verified), TS 7 needs `types: ["node"]` (verified) |
| ISO-01 | Every mail-derived table has non-null `mailbox_id` FK to `mailbox` | Drizzle schema pattern + catalog query (verified on PG 18.3) |
| ISO-02 | RLS policy on `app.mailbox_id`, forced for the app role, missing setting returns nothing | D-41 policy via `pgPolicy` (verified kit output) + custom FORCE migration. `nullif` semantics verified (fresh session → NULL, reused session → `''`) |
| ISO-03 | Two-mailbox test proves reads/writes never cross, even without app filter | Every D-48 case verified with the expected SQLSTATE: 0 rows / `42501` / `42501` / `23503` / 0 rows + `42501` / 0 rows / `22P02` |
| ISO-04 | Application code also filters by `mailbox_id` | Scoped helper pattern adding `eq(table.mailboxId, scope.mailboxId)`; package `exports` surface + Biome `noRestrictedImports` (verified) as static enforcement; app-filter test on an RLS-bypassing connection |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

No project-level `./CLAUDE.md` or `./.claude/CLAUDE.md` exists (`config.json` points `claude_md_path` at `./.claude/CLAUDE.md`, which is absent). No `.claude/skills/` or `.agents/skills/` directory exists. The constraints that apply come from the user's global instructions and the repo's CONTRIBUTING.md:

- **Commit message length:** commit messages must not exceed the length set by the project's commitlint config (user global CLAUDE.md). With `@commitlint/config-conventional` the default `header-max-length` is 100 [ASSUMED: default value of config-conventional]. The executor must keep commit headers within it once D-16 lands.
- **Near usage limits:** at about 90% usage, run `gsd-pause-work` (user global).
- **UI offsets in CSS:** not applicable (no UI in this phase).
- **CONTRIBUTING.md:** TypeScript only (no Python). Strict module syntax (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`). Conventional Commits. Never commit real email. **Every new table holding mail-derived data gets a `mailbox_id` and a Postgres RLS policy.** CONTRIBUTING.md currently says "No linter or formatter is configured yet" and "nothing to build or run yet". Both statements become stale in this phase, so the planner should include a CONTRIBUTING.md update task.
- **Context7 rule (user global):** use Context7 for library docs. That was done for Drizzle, Postgres, Vitest and Biome.

## Standard Stack

### Core
| Library | Version (latest / latest ≥7 days old) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 26.10.0 (`.nvmrc`) | Runtime, native type stripping | Locked D-11. `process.features.typescript === 'strip'` on 26.10.0 [VERIFIED: local run] |
| pnpm | 12.8.1 / 12.7.0 | Workspace package manager | Locked D-10. pnpm auto-switches to the `packageManager` version (global 12.6.0 ran as 12.8.1) [VERIFIED: local run] |
| drizzle-orm | 0.45.3 (stable `latest`; `1.0.0-rc.4` is `rc`) | Schema, query builder, migrator | Locked D-18 [VERIFIED: npm registry] |
| drizzle-kit | 0.31.11 | `generate` / `generate --custom` | Locked D-19 [VERIFIED: npm registry; local generate run] |
| pg | 8.23.1 / 8.23.0 | node-postgres driver (Pool for worker, Client for migrate) | Locked D-18 [VERIFIED: npm registry] |
| PostgreSQL + pgvector image | `pgvector/pgvector:0.8.7-pg18-trixie` (or `pg18`) | Database | Locked D-17. Tags confirmed on Docker Hub, updated 2026-10-01 [VERIFIED: Docker Hub API] |
| zod | 4.6.5 | Config schema (`z.strictObject`) | Locked D-57 [VERIFIED: npm registry; local run] |
| yaml | 2.9.1 | YAML parse with source positions (`LineCounter`) | Required for D-65 line numbers. `js-yaml` loses positions [VERIFIED: local run] |
| pino | 10.4.0 / 10.3.1 | JSON logging with `redact` | Locked D-23 [VERIFIED: local run of redact] |
| typescript | 7.0.2 | `tsc --noEmit` typecheck only | D-13/D-14. TS 7 typechecks the planned config [VERIFIED: local run] |
| vitest | 5.0.3 / 5.0.2 | Tests, `globalSetup` + `provide/inject` | Locked D-15 [VERIFIED: local run on Node 26] |
| @biomejs/biome | 2.5.15 / 2.5.14 | Lint + format | Locked D-15. `noRestrictedImports` + `useImportExtensions` verified [VERIFIED: local run] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/pg | 8.23.1 | pg typings | Always (dev) |
| @types/node | 26.x | Node typings | Always (dev). **Must be listed in `compilerOptions.types`** under TS 7 |
| @commitlint/cli + @commitlint/config-conventional | 21.2.3 | Commit message lint | D-16 |
| lefthook | 2.1.16 / 2.1.14 | Git hooks (has a `postinstall`; must be in pnpm `allowBuilds`) | D-16 |
| corepack | 0.36.0 (engines `>=26.0.0` ok) | Only inside the Docker build, to honor D-10 | Docker build step `npm i -g corepack@0.36.0` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| drizzle 0.45.x | drizzle 1.0.0-rc.4 | v1 changes the migration folder format (`<ts>_name/migration.sql` + `snapshot.json`) and renames `.enableRLS()` to `pgTable.withRLS()`. Still RC. Context7's docs mix v1 and v0 examples, so executors must use the 0.45 API |
| `yaml` | `js-yaml` | No line/column for Zod issue paths, so D-65 can't be met |
| UUIDv7 in app (`uuid` v14) | PG18 `uuidv7()` column default | DB default works for raw-SQL tests and seeds too, with no extra dependency. Recommend the DB default |
| dotenv | `node --env-file=.env.development` | Built into Node, so no dependency is needed [ASSUMED: flag name stable since Node 20.6] |

**Installation (root devDeps + package deps):**
```bash
pnpm add -w -D typescript@7 @types/node@26 @biomejs/biome@2 vitest@5 drizzle-kit@0.31 lefthook@2 @commitlint/cli@21 @commitlint/config-conventional@21
pnpm --filter @sift/db add drizzle-orm@0.45 pg@8 && pnpm --filter @sift/db add -D @types/pg@8
pnpm --filter @sift/core add zod@4 yaml@2
pnpm --filter @sift/worker add pino@10 @sift/db@workspace:* @sift/core@workspace:*
```

`pnpm-workspace.yaml` (pnpm 12, verified):
```yaml
packages:
  - apps/*
  - packages/*
allowBuilds:          # pnpm 12 FAILS install (ERR_PNPM_IGNORED_BUILDS, exit 1) on unapproved build scripts
  esbuild: true       # via drizzle-kit
  lefthook: true
minimumReleaseAge: 10080   # 7 days; supply-chain guard, verified to work in pnpm 12
```

## Package Legitimacy Audit

Ran `gsd-tools query package-legitimacy check --ecosystem npm`. Every `SUS` verdict below has the reason `too-new`: the latest *version* was published in the last few days. The packages themselves are long established, with 6M–370M weekly downloads, and each repo URL matches the canonical project.

| Package | Registry | Age (latest version) | Downloads/wk | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| drizzle-orm | npm | 0.45.3, 2026-09-21 | 30.4M | github.com/drizzle-team/drizzle-orm | SUS (too-new) | Flagged — pin, checkpoint |
| drizzle-kit | npm | 0.31.11, 2026-09-21 | 25.0M | github.com/drizzle-team/drizzle-orm | SUS (too-new) | Flagged — pin, checkpoint |
| pg | npm | 8.23.1, 2026-09-30 | 70.8M | github.com/brianc/node-postgres | SUS (too-new) | Flagged — use 8.23.0 or `minimumReleaseAge` |
| @types/pg | npm | 2026-08-17 | 75.1M | DefinitelyTyped | OK | Approved |
| zod | npm | 4.6.5, 2026-09-13 | 374M | github.com/colinhacks/zod | SUS (too-new) | Flagged — checkpoint |
| yaml | npm | 2.9.1, 2026-09-11 | 258M | github.com/eemeli/yaml | SUS (too-new) | Flagged — checkpoint |
| vitest | npm | 5.0.3, 2026-09-30 | 135M | github.com/vitest-dev/vitest | SUS (too-new) | Flagged — use 5.0.2 or age gate |
| @biomejs/biome | npm | 2.5.15, 2026-09-30 | 20.7M | github.com/biomejs/biome | SUS (too-new) | Flagged — 2.5.14 or age gate |
| pino | npm | 10.4.0, 2026-10-02 | 62.1M | github.com/pinojs/pino | SUS (too-new) | Flagged — 10.3.1 or age gate |
| lefthook | npm | 2.1.16, 2026-10-01 (postinstall `node postinstall.js`) | 6.1M | github.com/evilmartians/lefthook | SUS (too-new) | Flagged — 2.1.14 or age gate; postinstall installs git hooks (expected) |
| @commitlint/cli | npm | 21.2.3, 2026-09-19 | 12.8M | github.com/conventional-changelog/commitlint | SUS (too-new) | Flagged — checkpoint |
| @commitlint/config-conventional | npm | 21.2.3, 2026-09-19 | 12.7M | same | SUS (too-new) | Flagged — checkpoint |
| typescript | npm | 7.0.2, 2026-07-08 | 355M | github.com/microsoft/TypeScript | OK | Approved |
| @types/node | npm | 2026-10-01 | 535M | DefinitelyTyped | SUS (too-new) | Flagged — age gate picks an older 26.x |
| pnpm | npm | 12.8.1, 2026-09-28 (postinstall `node install.js`) | 236M | github.com/pnpm/pnpm | SUS (too-new) | Flagged — `packageManager: pnpm@12.7.0` or 12.8.1 after 7 days |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** all of the above except `typescript` and `@types/pg`. The planner inserts one `checkpoint:human-verify` before the first `pnpm install`. Recommended mitigation: set `minimumReleaseAge: 10080` in `pnpm-workspace.yaml`. pnpm 12 then refuses versions younger than 7 days and resolves to the "latest ≥7 days old" column above. That is verified: `pnpm add pino@10.4.0` was blocked with a `minimumReleaseAge cutoff` message.

*Package identities were confirmed against official docs/Context7 (Drizzle, Vitest, Biome, Postgres) or are locked user decisions. `@electric-sql/pglite` was used only as a research probe and is not recommended for the project.*

## Architecture Patterns

### System Architecture Diagram

```
                    owner edits config/config.yaml + .env / .env.mailboxes
                                         │
   docker compose up ────────────────────┼──────────────────────────────────────────────┐
         │                               │                                              │
         ▼                               ▼                                              ▼
 ┌──────────────┐  first volume init  ┌────────────────────────────┐  healthy (TCP     ┌──────────────────────────────┐
 │ db (pg18 +   │ ──────────────────▶ │ initdb bootstrap (superuser)│  pg_isready)     │ setup (one-shot, owner creds) │
 │ pgvector)    │                     │ roles sift_owner[,backup],  │ ───────────────▶ │ 1 config check (no DB)        │
 │ vol sift-    │                     │ DB sift, ext vector         │                  │ 2 sift migrate:               │
 │ pgdata →     │                     └────────────────────────────┘                  │   advisory lock → ensure      │
 │ /var/lib/    │◀──────────────────────────────────────────────────────────────────── │   sift_app → pending? →       │
 │ postgresql   │                                                                      │   pg_dump (backup role) →     │
 └──────┬───────┘                                                                      │   drizzle migrate (1 txn) →   │
        │                                                                              │   unlock                      │
        │                                                                              │ 3 sift config apply           │
        │                                                                              │   (guards D-33) → mailbox     │
        │                                                                              └──────────────┬───────────────┘
        │                                                     service_completed_successfully          │ exit 0
        │                                                                                             ▼
        │      ┌───────────────────────────────────────────────────────────────────────────────────────────────┐
        │      │ worker (sift_app creds + mailbox password env only)                                            │
        │      │ startup: env presence (D-35) → config validate → DB connect w/ retry (D-55) → drift check (D-34)│
        │      │ supervisor tick (60 s): reread mailbox registry → start/stop per-mailbox tasks → heartbeat file  │
        │      │ per-mailbox task: withMailbox(id) ─▶ BEGIN; set_config('app.mailbox_id',id,true); scoped helpers │
        │      │                    (WHERE mailbox_id = $scope)  ─▶ upsert mailbox_status; COMMIT                 │
        └─────▶│ RLS FORCE'd policy re-checks every row: mailbox_id = nullif(current_setting(...),'')::uuid      │
               └───────────────────────────────────────────────────────────────────────────────────────────────┘
 CI: biome → tsc → [bootstrap SQL as superuser on PG service] → vitest (globalSetup: create sift_test_x, migrate as
     sift_owner) → catalog test + isolation test + config tests → drop DB ; separate job: compose smoke
```

### Recommended Project Structure
```
sift/
├── package.json               # private, "type":"module", packageManager pnpm@12.x, scripts: sift, dev, test, typecheck, lint
├── pnpm-workspace.yaml        # packages, allowBuilds, minimumReleaseAge
├── tsconfig.base.json         # strict shared base (root tsconfig.json extends it, or is renamed)
├── biome.json  lefthook.yml  commitlint.config.ts  vitest.config.ts
├── compose.yaml  Dockerfile  .dockerignore
├── .env.example  .env.mailboxes.example  .env.development.example   # need .gitignore negations
├── config/config.example.yaml            # committed; config.yaml gitignored
├── backups/.gitkeep                      # backups/* gitignored
├── db/bootstrap.sql                      # superuser-only: roles, DB, extension (initdb + CI + tests)
├── apps/worker/
│   ├── package.json  tsconfig.json
│   ├── src/cli.ts                        # parseArgs dispatch: migrate | config check|apply | mailbox rename|purge | worker
│   ├── src/supervisor.ts  src/health.ts  src/shutdown.ts  src/log.ts
│   └── test/
├── packages/core/
│   ├── src/config/{schema.ts,load.ts,env.ts,errors.ts}
│   └── test/
├── packages/db/
│   ├── src/schema/{mailbox.ts,scoped.ts,…}   # Drizzle tables, pgRole(...).existing(), pgPolicy
│   ├── src/rls.ts                            # the ONE policy predicate
│   ├── src/scope.ts                          # withMailbox, scoped helpers, requireActive
│   ├── src/migrate.ts  src/registry.ts       # owner-side ops (migrate, config apply, rename, purge)
│   ├── migrations/                           # drizzle-kit out: NNNN_*.sql + meta/_journal.json
│   ├── drizzle.config.ts
│   └── test/{catalog.test.ts, isolation.test.ts, scope.test.ts, global-setup.ts}
└── .github/workflows/ci.yml
```

### Pattern 1: One policy predicate, declared once, emitted by drizzle-kit
**What:** One `sql` fragment used for both USING and WITH CHECK on every scoped table. Roles are declared `.existing()` so kit does not try to create them.
**Example (generated SQL verified with drizzle-kit 0.31.11):**
```ts
// packages/db/src/rls.ts
import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';
export const siftApp = pgRole('sift_app').existing();
export const siftOwner = pgRole('sift_owner').existing();
export const mailboxPredicate = sql`mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid`;
export const mailboxIsolation = () =>
  pgPolicy('mailbox_isolation', { as: 'permissive', for: 'all', to: [siftApp, siftOwner], using: mailboxPredicate, withCheck: mailboxPredicate });

// packages/db/src/schema/scoped.ts
export const message = pgTable('message', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  mailboxId: uuid('mailbox_id').notNull().references(() => mailbox.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique('message_mailbox_id_id_key').on(t.mailboxId, t.id), mailboxIsolation()]);

export const label = pgTable('label', {
  id: uuid('id').primaryKey().default(sql`uuidv7()`),
  mailboxId: uuid('mailbox_id').notNull().references(() => mailbox.id, { onDelete: 'restrict' }),
  messageId: uuid('message_id').notNull(),
  /* timestamps */
}, (t) => [
  unique('label_mailbox_id_id_key').on(t.mailboxId, t.id),
  foreignKey({ name: 'label_message_fk', columns: [t.mailboxId, t.messageId], foreignColumns: [message.mailboxId, message.id] }).onDelete('restrict'),
  mailboxIsolation(),
]);
```
Kit output (verbatim excerpt): `ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;` … `CREATE POLICY "mailbox_isolation" ON "message" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (...)` and `ALTER TABLE "label" ADD CONSTRAINT "label_message_fk" FOREIGN KEY ("mailbox_id","message_id") REFERENCES "public"."message"("mailbox_id","id") ON DELETE restrict` [VERIFIED: local drizzle-kit generate].

### Pattern 2: Custom migration for what drizzle-kit cannot express
FORCE RLS, GRANTs, and the `updated_at` trigger. `drizzle-kit generate --custom --name=<name>` creates an empty SQL file plus a journal entry [VERIFIED: local run]. Put it right after each generated migration that adds tables. Both are pending together on a fresh DB, and the 0.45 migrator applies **all pending migrations in one transaction**, so there is no window where a table exists without FORCE [VERIFIED: drizzle-orm/pg-core/dialect.js `migrate()` source].
```sql
-- 0001_force_grants_triggers.sql (custom)
ALTER TABLE "message" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "mailbox" TO sift_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message", "label", "folder_sync", "rule_set", "mailbox_status" TO sift_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "decision", "label_event" TO sift_app;--> statement-breakpoint
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;--> statement-breakpoint
CREATE TRIGGER message_set_updated_at BEFORE UPDATE ON "message" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
(Statements must be separated by `--> statement-breakpoint`, because the migrator splits on that marker [VERIFIED: drizzle-orm/migrator.js].)

### Pattern 3: Superuser bootstrap as one idempotent `.sql` (initdb + CI + tests)
The official entrypoint runs `*.sql` files in `/docker-entrypoint-initdb.d` through `psql` against a temporary server with `listen_addresses=''` [VERIFIED: docker-library/postgres 18/trixie docker-entrypoint.sh lines 191, 297]. Use `\getenv` so one file serves Compose (env from the container) and CI (`docker exec -i -e … <svc> psql -U postgres -f - < db/bootstrap.sql`).
```sql
-- db/bootstrap.sql  (runs as superuser; idempotent)
\getenv owner_pw SIFT_DB_OWNER_PASSWORD
\getenv backup_pw SIFT_DB_BACKUP_PASSWORD
SELECT format('CREATE ROLE sift_owner LOGIN CREATEROLE PASSWORD %L', :'owner_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sift_owner') \gexec
-- only if Q1 resolves to a backup role:
SELECT format('CREATE ROLE sift_backup LOGIN BYPASSRLS PASSWORD %L', :'backup_pw')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sift_backup') \gexec
GRANT pg_read_all_data TO sift_backup;
\connect template1
CREATE EXTENSION IF NOT EXISTS vector;      -- every later CREATE DATABASE (incl. sift_test_*) inherits it
\connect postgres
SELECT 'CREATE DATABASE sift OWNER sift_owner' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sift') \gexec
\connect sift
CREATE EXTENSION IF NOT EXISTS vector;
```
`\getenv` requires psql ≥ 15 [ASSUMED]. The image's psql is 18. Do **not** create `sift_app` here: a CREATEROLE user can only ALTER roles it created (it gets ADMIN OPTION automatically). The owner got `42501 permission denied to alter role` on a role made by the superuser [VERIFIED: PG 18.3 probe], so D-39's "migrate creates/ALTERs `sift_app`" only works if `sift_owner` created it.

### Pattern 4: `sift migrate` on a single dedicated `pg.Client`
```ts
// packages/db/src/migrate.ts (outline)
const client = new pg.Client({ connectionString: ownerUrl }); await client.connect();
await waitForAdvisoryLock(client, MIGRATE_LOCK_KEY);           // session lock => same client for everything
try {
  await ensureAppRole(client, appPassword);                   // DO-less: check pg_roles, then CREATE/ALTER with client.escapeLiteral(pw)
  const pending = await pendingMigrations(client, folder);    // journal entries with `when` > max(created_at) of drizzle.__drizzle_migrations (table may not exist yet: to_regclass)
  if (pending.length) { await pgDumpCustomFormat(backupUrl, `sift-${ts}-pre-${pending.at(-1).tag}.dump`); pruneKeepLast(5); }
  await migrate(drizzle({ client }), { migrationsFolder: folder });
} finally { await client.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]); await client.end(); }
```
- The drizzle 0.45 tracking table is **`drizzle.__drizzle_migrations`** (schema `drizzle`, columns `id serial, hash text, created_at bigint`). Pending = journal `when` > last `created_at` [VERIFIED: dialect.js source]. The catalog allowlist key must be schema-qualified.
- `ALTER ROLE … PASSWORD` cannot take bind parameters. Build it with `client.escapeLiteral()` (exported by pg 8.23) [VERIFIED: pg/lib/index.js:31-32] and never log the statement.
- Ordering matters: `sift_app` must exist **before** the first migration, because `CREATE POLICY … TO "sift_app"` fails on an unknown role.

### Pattern 5: Scoped API (`withMailbox` + generic helper)
```ts
// packages/db/src/scope.ts (shape)
export async function withMailbox<T>(mailboxId: string, fn: (scope: Scope) => Promise<T>): Promise<T> {
  assertUuid(mailboxId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.mailbox_id', ${mailboxId}, true)`);
    return fn(makeScope(tx, mailboxId));          // tx never escapes; Scope exposes only helpers
  });
}
function scoped<T extends ScopedTable>(tx: Tx, table: T, mailboxId: string) {
  const own = eq(table.mailboxId, mailboxId);
  return {
    insert: (rows: Omit<InferInsertModel<T>, 'mailboxId'>[]) => tx.insert(table).values(rows.map((r) => ({ ...r, mailboxId }))).returning(),
    find:   (where?: SQL) => tx.select().from(table).where(where ? and(own, where) : own),
    update: (set: Partial<Omit<InferInsertModel<T>, 'mailboxId' | 'id'>>, where?: SQL) => tx.update(table).set(set).where(where ? and(own, where) : own).returning(),
    delete: (where?: SQL) => tx.delete(table).where(where ? and(own, where) : own).returning(),
  };
}
```
Append-only tables (`decision`, `label_event`) should expose only `insert`/`find` at the type level. The generic `ScopedTable` constraint (`PgTable & { mailboxId: PgColumn }`) is the hard typing part. Budget time for it [ASSUMED: Drizzle generic typing friction].

### Pattern 6: Config load with YAML positions (verified)
```ts
const lc = new LineCounter();
const doc = parseDocument(text, { lineCounter: lc });
if (doc.errors.length) /* report YAML syntax/duplicate-key errors with doc.errors[i].linePos */;
rejectLiteralSecrets(doc);                       // walk pairs: key /pass(word)?|secret|token/i and key !== 'password_env' → explicit error
const r = Config.safeParse(doc.toJS());
for (const i of r.error?.issues ?? []) {
  const node = doc.getIn(i.path, true); const pos = isNode(node) && node.range ? lc.linePos(node.range[0]) : undefined;
  // numeric slug: i.code === 'invalid_type' && path ends with 'slug' && typeof value === 'number' → "quote it: slug: \"2024\""
}
```
Verified output: `invalid_type ["mailboxes",0,"slug"] line 3:11` and `unrecognized_keys ["mailboxes",0,"imap"] line 4:11 Unrecognized key: "password"` [VERIFIED: local run, zod 4.6.5 + yaml 2.9.1].

### Anti-Patterns to Avoid
- **`set_config(..., false)` or `SET app.mailbox_id`** in `withMailbox`: the value leaks to the next pool user. Always use `is_local = true`.
- **A second permissive policy on any scoped table:** permissive policies OR together and widen access. The catalog test must assert exactly one policy per table.
- **Granting TRUNCATE (or `GRANT ALL`) to `sift_app`:** TRUNCATE is not subject to RLS [CITED: postgresql.org/docs/18/ddl-rowsecurity.html].
- **`pnpm deploy` / injected workspace deps / `--preserve-symlinks` in Docker:** source `.ts` then lives under `node_modules`, and Node throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` [VERIFIED: local run]. Copy the workspace and `pnpm install --frozen-lockfile --prod` so packages stay symlinked.
- **`drizzle-kit push` / `drizzle-kit migrate` in production:** D-19 forbids push. Run migrations through `sift migrate` (lock + backup), not kit.
- **pgEnum for `mailbox_status.state`:** `ALTER TYPE … ADD VALUE` interacts badly with the single-transaction migrator. Use `text` + `check()`.
- **`env_file: .env` on the worker:** it hands the worker owner/superuser passwords. Use explicit `environment:` entries plus a separate mailbox env file.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Migration tracking/applying | Own SQL runner | `migrate()` from `drizzle-orm/node-postgres/migrator` (+ `readMigrationFiles` for pending detection) | Same journal/hash semantics kit generates |
| SQL literal escaping for role passwords | String concat | `client.escapeLiteral()` / psql `%L` via `format()` | Injection via env-supplied password |
| YAML parsing with positions | Regex/line scanning | `yaml` `parseDocument` + `LineCounter` | Flow maps (`imap: { … }`), duplicates, anchors |
| Arg parsing | Hand parser | `node:util` `parseArgs({ allowPositionals: true, strict: true })` | Verified on Node 26 |
| Log redaction | Manual scrubbing | pino `redact.paths` (`*.password`, `*.*.password`, `connectionString`, `*.connectionString`) | Verified wildcard redaction |
| UUIDv7 | JS generator | PG18 `uuidv7()` default | Verified, `uuid_extract_version = 7` |
| Image init ordering | Sleep loops | TCP `pg_isready -h 127.0.0.1` healthcheck + `depends_on` conditions | The temp init server has no TCP listener |
| Env files for dev | dotenv | `node --env-file=.env.development` | Built in |

**Key insight:** in this phase the dangerous bugs are silent. Zero-row backups, a widened policy, and a pooled connection carrying a mailbox all fail quietly. Every control above has a matching catalog or isolation assertion, so CI catches it instead of the owner.

## Common Pitfalls

### Pitfall 1: pg_dump vs FORCE RLS (breaks D-29 from Phase 2 onward)
**What goes wrong:** `sift migrate`'s backup fails with `42501 query would be affected by row-level security policy for table "message"` (hint: `ALTER TABLE NO FORCE…`). With `--enable-row-security` it dumps 0 mail rows instead.
**Why:** `check_enable_rls()`: a table owner without BYPASSRLS on a FORCE'd table gets RLS, and `row_security=off` (pg_dump's default) turns that into an error [VERIFIED: postgres REL_18_STABLE src/backend/utils/misc/rls.c; runtime on PG 18.3]. A BYPASSRLS role with `pg_read_all_data` read all 4 seeded rows under `row_security=off` [VERIFIED: PG 18.3 probe].
**How to avoid:** Resolve Open Question Q1. Add a test that runs `sift migrate` with a second pending migration on a DB containing rows from both mailboxes, then `pg_restore --list`/row-counts the dump.
**Warning signs:** Phase 1 never exercises this path, because the first dump is of an empty DB.

### Pitfall 2: `CREATE EXTENSION vector` as `sift_owner`
**What goes wrong:** `42501 permission denied to create extension`.
**Why:** pgvector's `vector.control` has no `trusted` line (contents: `comment`, `default_version = '0.8.7'`, `module_pathname`, `relocatable = true`) [VERIFIED: raw.githubusercontent.com/pgvector/pgvector/master/vector.control]. `trusted` defaults to false [CITED: postgresql.org/docs/18/extend-extensions.html]. Mechanism checked with the untrusted `amcheck` on PG 18.3: non-superuser `CREATE EXTENSION` → `42501`; non-superuser `CREATE EXTENSION IF NOT EXISTS` when it already exists → OK [VERIFIED: probe]. Not run against the actual pgvector image (no Docker daemon) [ASSUMED for vector specifically].
**How to avoid:** Bootstrap creates it as superuser in `template1` and `sift`. Migration 0000 keeps `CREATE EXTENSION IF NOT EXISTS vector;` (custom-prepended) as a fail-loud assertion.

### Pitfall 3: PG18 image volume path
**What goes wrong:** Mounting `sift-pgdata:/var/lib/postgresql/data` means data lands in an anonymous volume and is lost on `down`.
**Why:** `ENV PGDATA /var/lib/postgresql/18/docker`, `VOLUME /var/lib/postgresql` [VERIFIED: docker-library/postgres 18/trixie Dockerfile lines 189-192]. pgvector's image is `FROM postgres:$PG_MAJOR-$DEBIAN_CODENAME` [VERIFIED: pgvector Dockerfile].
**How to avoid:** `volumes: [sift-pgdata:/var/lib/postgresql]`.

### Pitfall 4: No corepack in Node 26
**What goes wrong:** `corepack enable` → `command not found` in `node:26-*` images and setup-node.
**Why:** Corepack is not distributed from Node 25 [CITED: nodejs.org corepack docs via search]. Local `~/.nvm/versions/node/v26.10.0/bin` contains only `node npm npx` [VERIFIED: local ls].
**How to avoid:** Dockerfile: `RUN npm install -g corepack@0.36.0 && corepack enable pnpm` with `ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0` [ASSUMED env name]. CI: `pnpm/action-setup@v6` (reads `packageManager`) [CITED: github.com/pnpm/action-setup README] before `actions/setup-node@v7` with `node-version-file: .nvmrc` and `cache: pnpm`.

### Pitfall 5: TypeScript 7 no longer auto-includes `@types/node`
**What goes wrong:** `TS2591 Cannot find name 'process'` / `'node:buffer'`.
**How to avoid:** `"types": ["node"]` in `tsconfig.base.json` [VERIFIED: tsc 7.0.2 local run]. The existing root `tsconfig.json` also lacks `strict` and `moduleResolution` [VERIFIED: tsconfig.json:2-8 quotes `"module": "nodenext"`, `"noEmit": true`, `"erasableSyntaxOnly": true`, `"verbatimModuleSyntax": true`, `"allowImportingTsExtensions": true`].

### Pitfall 6: pnpm 12 rejects unapproved build scripts
**What goes wrong:** `ERR_PNPM_IGNORED_BUILDS … esbuild, lefthook`. `pnpm install` exits 1, so CI and Docker builds fail.
**How to avoid:** `allowBuilds` map in `pnpm-workspace.yaml` [VERIFIED: local run]. In Docker the `--prod` install skips devDeps (esbuild, lefthook).

### Pitfall 7: Healthcheck goes green during initdb
**What goes wrong:** A unix-socket `pg_isready` reports ready against the temporary init server. Setup then connects while bootstrap is still running, or just before the restart.
**How to avoid:** `pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d sift`. The temp server runs with `listen_addresses=''` [VERIFIED: entrypoint line 297].

### Pitfall 8: `.gitignore` swallows the new example files
**What goes wrong:** `.env.*` with only `!.env.example` [VERIFIED: .gitignore:70-71 quotes `.env.*` and `!.env.example`] hides `.env.mailboxes.example` and `.env.development.example`.
**How to avoid:** Add `!.env.*.example`. Also add `config/config.yaml`, `backups/*` + `!backups/.gitkeep`, `data/`.

### Pitfall 9: Cluster-wide roles in per-run test DBs
**What goes wrong:** (a) The test `migrate` rotates `sift_app`'s password for the whole Compose cluster, which breaks a running dev worker if the test env uses a different `SIFT_DB_APP_PASSWORD`. (b) Parallel migrate runs race on `CREATE ROLE`. Advisory locks are per database, so they do not serialize across test DBs [ASSUMED: advisory lock keys are database-scoped].
**How to avoid:** Migrate once in Vitest `globalSetup` (one DB per run). Take `SIFT_DB_APP_PASSWORD` from the same `.env.development`. Treat `42710 duplicate_object` on `CREATE ROLE` as "exists".

### Pitfall 10: `pg_dump` version and availability
**What goes wrong:** No `pg_dump` on the dev Mac at all [VERIFIED: `command not found`]. Debian trixie ships `postgresql-client-17` only [VERIFIED: packages.debian.org/trixie/postgresql-client]. pg_dump refuses newer servers [ASSUMED].
**How to avoid:** Setup image installs `postgresql-client-18` from the PGDG apt repo (`postgresql-common` → `/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y`) [ASSUMED script path]. CI installs client 18 the same way. Backup tests `skipIf(!pgDump18)` locally but **fail** when `CI=true`.

### Pitfall 11: Docker restarts the worker without Compose ordering
**What goes wrong:** After a host reboot the daemon restarts `worker` (restart policy) without re-evaluating `depends_on`. Setup is not rerun.
**How to avoid:** That is exactly why D-55's retry exists. Include `EAI_AGAIN` (transient DNS in Compose networks) alongside `ENOTFOUND`/`ECONNREFUSED`/`57P03` [ASSUMED: EAI_AGAIN occurs during container start]. Add a `pool.on('error')` handler so an idle-client error doesn't crash the process.

### Pitfall 12: Backups bind mount permissions on Linux
**What goes wrong:** If Docker creates `./backups` it is root-owned, and the non-root `node` user (uid 1000) gets `EACCES`.
**How to avoid:** Commit `backups/.gitkeep`. Setup preflights writability and prints a fix (`chown 1000 backups`).

### Pitfall 13: Context7 Drizzle docs are mostly v1
**What goes wrong:** The executor copies `pgTable.withRLS`, v1 folder layout, or `drizzle-kit migrate` patterns.
**How to avoid:** Pin 0.45.x and use the verified 0.45 snippets in this file.

## Code Examples

### Catalog test core query (verified on PG 18.3 with real kit output)
```sql
select n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) as owner,
  c.relrowsecurity as rls, c.relforcerowsecurity as force,
  (select a.attnotnull from pg_attribute a where a.attrelid=c.oid and a.attname='mailbox_id' and not a.attisdropped) as mailbox_id_notnull,
  exists (select 1 from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum = any(k.conkey)
          where k.conrelid=c.oid and k.contype='f' and k.confrelid='public.mailbox'::regclass
            and a.attname='mailbox_id' and array_length(k.conkey,1)=1) as fk_to_mailbox,
  (select count(*) from pg_policy p where p.polrelid=c.oid) as policies,
  has_table_privilege('sift_app', c.oid, 'SELECT') as sel, has_table_privilege('sift_app', c.oid, 'INSERT') as ins,
  has_any_column_privilege('sift_app', c.oid, 'UPDATE') as upd,   -- catches column-level UPDATE grants too
  has_table_privilege('sift_app', c.oid, 'DELETE') as del, has_table_privilege('sift_app', c.oid, 'TRUNCATE') as trunc,
  has_table_privilege('sift_app', c.oid, 'REFERENCES') as refs, has_table_privilege('sift_app', c.oid, 'TRIGGER') as trig
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%';
```
Observed rows: `drizzle.__drizzle_migrations` (owner sift_owner, all sift_app privileges false), `public.mailbox` (rls false, sel true, everything else false), `public.message` (rls/force true, notnull true, fk true, policies 1, sel/ins/upd/del true, trunc/refs/trig false), `public.label` with SELECT+INSERT only (append-only shape) [VERIFIED: probe].

Policy assertion. Compare against the **normalized** text Postgres stores, which differs from the source text:
```sql
select c.relname, p.polcmd, p.polpermissive,
  array(select rolname from pg_roles where oid = any(p.polroles) order by 1) as roles,
  pg_get_expr(p.polqual, p.polrelid) as qual, pg_get_expr(p.polwithcheck, p.polrelid) as chk
from pg_policy p join pg_class c on c.oid=p.polrelid;
-- expected per scoped table: polcmd '*', polpermissive true, roles {sift_app,sift_owner},
-- qual = chk = (mailbox_id = (NULLIF(current_setting('app.mailbox_id'::text, true), ''::text))::uuid)
```
[VERIFIED: PG 18.3 probe output, verbatim]

Role/schema assertions (all observed `false` as expected): `rolsuper`, `rolbypassrls` for `sift_app`; `has_schema_privilege('sift_app','drizzle','USAGE')`; `has_schema_privilege('sift_app','public','CREATE')`; `pg_has_role('sift_app','sift_owner','MEMBER')`. Also assert `sift_app` owns nothing: `not exists (select from pg_class where relowner='sift_app'::regrole)`.

Recommended additions beyond D-37 (cheap, same query family):
- Every scoped table except `mailbox_status` has `UNIQUE (mailbox_id, id)`.
- Every FK between two scoped tables includes `mailbox_id`, which enforces D-04 mechanically.
- Every table with `updated_at` has the trigger.

### Isolation test observed outcomes (PG 18.3; drives D-48 assertions)
| Case | Observed |
|---|---|
| A reads with no WHERE | only A's rows |
| A `UPDATE … WHERE mailbox_id = B` / `DELETE` | `affectedRows 0` |
| A `UPDATE` with no WHERE | only A's 2 rows updated; B unchanged |
| A inserts `mailbox_id = B` | `42501 new row violates row-level security policy for table "message"` |
| A moves own row to B | `42501 new row violates row-level security policy` |
| A inserts label → B's message | `23503 … violates foreign key constraint "label_mailbox_id_message_id_fkey"` |
| fresh session, no setting: read / insert | 0 rows / `42501` |
| after a committed `set_config(...,true)`: `current_setting` | `''` (empty string), so read 0 rows, insert `42501` |
| `set_config('app.mailbox_id','not-a-uuid',true)` then read | `22P02 invalid input syntax for type uuid` |
| `sift_app` TRUNCATE / UPDATE mailbox | `42501 permission denied` |
| `sift_owner` unscoped `count(*)` with FORCE | `0` (superuser sees 4) |
[VERIFIED: PG 18.3 probes this session]

Assert on SQLSTATE (`err.code`), not message text.

### Compose skeleton (shape; versions per Standard Stack)
```yaml
services:
  db:
    image: pgvector/pgvector:0.8.7-pg18-trixie
    environment: { POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?}", SIFT_DB_OWNER_PASSWORD: "${SIFT_DB_OWNER_PASSWORD:?}", SIFT_DB_BACKUP_PASSWORD: "${SIFT_DB_BACKUP_PASSWORD:?}" }
    volumes: [ "sift-pgdata:/var/lib/postgresql", "./db/bootstrap.sql:/docker-entrypoint-initdb.d/10-sift-bootstrap.sql:ro" ]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U postgres -d sift"], interval: 5s, timeout: 3s, retries: 20, start_period: 10s }
    ports: [ "127.0.0.1:${SIFT_DB_PORT:-5432}:5432" ]   # dev-only; bind to loopback, never 0.0.0.0
    restart: unless-stopped
  setup:
    build: { context: ., args: { NODE_VERSION: "${NODE_VERSION:-26.10.0}" } }
    command: ["sift", "setup"]                 # = config check → migrate → config apply
    init: true
    environment: { SIFT_DATABASE_URL: "postgres://sift_owner:${SIFT_DB_OWNER_PASSWORD}@db:5432/sift", SIFT_DB_APP_PASSWORD: "${SIFT_DB_APP_PASSWORD:?}", SIFT_BACKUP_DATABASE_URL: "postgres://sift_backup:${SIFT_DB_BACKUP_PASSWORD}@db:5432/sift", SIFT_CONFIG: /config/config.yaml }
    volumes: [ "./config:/config:ro", "./backups:/backups" ]
    depends_on: { db: { condition: service_healthy } }
    restart: "no"
  worker:
    build: { context: ., args: { NODE_VERSION: "${NODE_VERSION:-26.10.0}" } }
    command: ["sift", "worker"]
    init: true
    env_file: [ .env.mailboxes ]               # ONLY the password_env variables
    environment: { SIFT_DATABASE_URL: "postgres://sift_app:${SIFT_DB_APP_PASSWORD}@db:5432/sift", SIFT_CONFIG: /config/config.yaml }
    volumes: [ "./config:/config:ro" ]
    extra_hosts: [ "host.docker.internal:host-gateway" ]
    depends_on: { db: { condition: service_healthy }, setup: { condition: service_completed_successfully } }
    healthcheck: { test: ["CMD", "node", "-e", "const s=require('fs').statSync('/tmp/sift/heartbeat');process.exit(Date.now()-s.mtimeMs<180000?0:1)"], interval: 30s, timeout: 5s, retries: 3, start_period: 30s }
    stop_grace_period: 30s
    restart: unless-stopped
volumes: { sift-pgdata: { name: sift-pgdata } }
```
`.nvmrc` → image tag: Compose cannot read a file into a build arg. Recommend `ARG NODE_VERSION` in the Dockerfile with a default **plus a Vitest drift test** asserting `Dockerfile`/`compose.yaml` defaults equal `.nvmrc` minus the leading `v` (`.nvmrc:1` is `v26.10.0`). Both `node:26.10.0-trixie-slim` and `node:26-trixie-slim` exist [VERIFIED: Docker Hub API 200]. Avoid healthcheck `start_interval` (needs a newer Engine than the dev Mac's) [ASSUMED].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| corepack bundled with Node | install corepack/pnpm explicitly | Node 25 | D-10 needs an extra step |
| PG image volume `/var/lib/postgresql/data` | `/var/lib/postgresql` (PGDATA `/18/docker`) | postgres:18 image | Compose volume path |
| `gen_random_uuid()` + app UUIDv7 libs | built-in `uuidv7()` | PostgreSQL 18 | DB default for D-03 |
| `tsx`/ts-node | native type stripping (stable, no warning) | Node 23.6→25 | D-12 works; `node_modules` restriction applies |
| TS auto-includes all `@types/*` | `types` must be explicit | TypeScript 6/7 | tsconfig change |
| pnpm `onlyBuiltDependencies` | `allowBuilds` map; unapproved builds fail install | pnpm 11/12 | workspace file |
| drizzle `.enableRLS()` / flat migrations | v1: `pgTable.withRLS`, folder-per-migration | drizzle 1.0 (RC) | Stay on 0.45 for M1, plan the upgrade later |

**Deprecated/outdated:** `corepack enable` alone in Node ≥25. Mounting `/var/lib/postgresql/data` on PG18 images.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | pgvector specifically (not just the mechanism) requires superuser for CREATE EXTENSION | Pitfall 2 | Low: the bootstrap approach works either way |
| A2 | psql `\getenv` available (psql ≥15) | Pattern 3 | Bootstrap file fails; fall back to a `.sh` with `psql -v` |
| A3 | Advisory lock keys are per-database | Pitfall 9 | Parallel test DB migrations might serialize (harmless) |
| A4 | PGDG setup script path `/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh` | Pitfall 10 | Dockerfile/CI step needs adjusting |
| A5 | `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` env name | Pitfall 4 | Build may block on a prompt |
| A6 | `@commitlint/config-conventional` header-max-length is 100 | Project Constraints | Commit length rule |
| A7 | `node --env-file` flag semantics | Alternatives | Dev script tweak |
| A8 | Healthcheck `start_interval` needs a newer Docker Engine; Compose `--wait` handling of exited one-shot services | Compose skeleton / Validation | Smoke job flakiness; use a polling script |
| A9 | EAI_AGAIN appears during container DNS warm-up | Pitfall 11 | Worker exits instead of retrying |
| A10 | pg_dump refuses to dump a newer server major | Pitfall 10 | CI needs client 18 anyway |
| A11 | Drizzle generic typing over `PgTable & { mailboxId }` is fiddly | Pattern 5 | Estimate only |

## Open Questions

1. **Q1 (BLOCKING for the `sift migrate` task): which role runs `pg_dump`?** D-29 + D-39 (setup has only owner credentials) + D-41 (FORCE RLS on the owner) are mutually incompatible once mail data exists (verified).
   - Options: (a) **[Recommended]** add `sift_backup` (LOGIN, BYPASSRLS, `pg_read_all_data`, created by the superuser bootstrap, credentials only in setup). The catalog test asserts it owns nothing and has no write privileges. This amends D-36 ("two roles"). (b) Give `sift_owner` BYPASSRLS. That defeats D-41's purpose, since BYPASSRLS is checked before FORCE, and only a superuser can grant it. (c) Run pg_dump as the superuser in setup, which violates D-39. (d) Toggle NO FORCE around the dump, which opens a race and is hacky.
   - Recommendation: confirm (a) with the user before planning, and record it in CONTEXT/STATE.
2. **Q2: does `config apply` (setup) receive mailbox password env vars?** Least privilege says no. D-65 shares code with `config check`, which checks env presence. Recommend that `config apply` validates the schema only (env-presence check behind a flag), so mailbox secrets reach only the worker.
3. **Q3: `.nvmrc` as "single source" for the Docker base tag.** Compose can't read files into args. Recommend a Dockerfile default + drift test (above), or a wrapper script exporting `NODE_VERSION`. Confirm the drift test is acceptable under D-11.
4. **Q4: FND-02 text vs D-59.** FND-02 lists "LLM confidence threshold" as a config field. D-59 (locked) defers it to Phase 3's `tiers`. The planner should mark that clause as covered in Phase 3 and update REQUIREMENTS.md traceability. The verifier should not fail Phase 1 on it.
5. **Q5: are `sift mailbox rename/purge` in Phase 1 scope?** D-32/D-05 define them. Rename (update `slug`) is trivial. Purge must delete per scoped table under `app.mailbox_id` as the owner (FORCE), children first (RESTRICT FKs), then the mailbox row. Recommend including both, with purge covered by a test.
6. **Q6: target-machine Docker version.** The dev Mac has Docker Desktop 4.5.0 / Compose v2.2.3 with the daemon not running. Owner-side success criterion 1 needs a human checkpoint on the actual target machine.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node (nvm) | everything | ✓ | 26.10.0 installed (shell default 26.3.0; `nvm use` needed) | — |
| pnpm | workspace | ✓ | 12.6.0 global, auto-switches to `packageManager` | — |
| corepack | D-10 | ✗ | — (not shipped with Node 26) | `npm i -g corepack@0.36.0` / pnpm/action-setup |
| Docker CLI / Compose | FND-01, local tests DB | ⚠ installed, **daemon not running** | Docker 20.10.12, Compose v2.2.3, Desktop 4.5.0 (Feb 2022) | Start/upgrade Docker Desktop; CI service container covers DB tests |
| psql / pg_dump 18 (host) | D-29/D-31 host dev | ✗ | — | `brew install libpq` (18) or run migrate via `docker compose run --rm setup` |
| gh | CI setup | ✓ | 2.99.0 | — |
| git | hooks/commitlint | ✓ | 2.54.0 | — |
| Ollama | not needed in Phase 1 | not probed | — | — |

**Missing dependencies with no fallback:** none for planning. For *executing* DB-backed tests locally, Docker must be running (start or upgrade Docker Desktop).
**Missing with fallback:** corepack, host pg_dump.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.x (root `vitest.config.ts`, `globalSetup` + `provide/inject`, verified on Node 26) |
| Config file | none yet (Wave 0) |
| Quick run command | `pnpm vitest run packages/core` (no DB, <5 s) |
| Full suite command | `pnpm biome ci . && pnpm -r exec tsc -p . && pnpm vitest run` (needs `SIFT_TEST_ADMIN_URL` + bootstrap applied) |

DB test harness: `globalSetup` connects with `SIFT_TEST_ADMIN_URL` (superuser, local Compose/CI service only), applies `db/bootstrap.sql` idempotently (CI), `CREATE DATABASE sift_test_<hex> OWNER sift_owner` (inherits `vector` from template1), runs the **real** `sift migrate` code as `sift_owner`, `provide`s URLs, and drops the DB in teardown (`DROP DATABASE … WITH (FORCE)`).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FND-01 | Stack builds and starts; setup exits 0; worker healthy; migrations applied | smoke (CI job) | `docker compose up -d` + poll script: setup exit code 0, worker `Health.Status=healthy`, `select count(*) from drizzle.__drizzle_migrations` > 0 | ❌ Wave 0 (`.github/workflows/ci.yml` job `compose-smoke`, `scripts/compose-smoke.sh`) |
| FND-01 | `.nvmrc` ↔ Dockerfile/compose NODE_VERSION in sync | unit | `pnpm vitest run apps/worker/test/node-version.test.ts` | ❌ Wave 0 |
| FND-01 | migrate: advisory lock, pending detection, backup only when pending, keep 5 | integration | `pnpm vitest run packages/db/test/migrate.test.ts` | ❌ Wave 0 |
| FND-01 | backup contains rows of both mailboxes (Q1 role) | integration (CI-required) | same file, `skipIf(!pgDump18 && !CI)` | ❌ Wave 0 |
| FND-02 | Schema: strict keys, version=1, slug rules, reserved, numeric slug hint, dup host+user+folder, password_env regex, literal secret rejected, line numbers | unit | `pnpm vitest run packages/core/test/config.test.ts` | ❌ Wave 0 |
| FND-02 | Shipped example validates (D-61) | unit | `pnpm vitest run packages/core/test/example-config.test.ts` | ❌ Wave 0 |
| FND-02 | Missing/whitespace env reported all at once, names not values (D-35) | unit | `pnpm vitest run packages/core/test/env.test.ts` | ❌ Wave 0 |
| FND-02 | Secret sentinel: random password in env → after `config apply` + one worker tick, no DB text column, config file or captured log line contains it | integration | `pnpm vitest run apps/worker/test/no-secret-leak.test.ts` | ❌ Wave 0 |
| FND-02 | config apply guards (D-32/D-33) and drift refusal (D-34) | integration | `pnpm vitest run packages/db/test/registry.test.ts apps/worker/test/drift.test.ts` | ❌ Wave 0 |
| FND-03 | Workspace typechecks; packages resolve as source `.ts` | static | `pnpm -r exec tsc -p .` + `node apps/worker/src/cli.ts --help` | ❌ Wave 0 |
| ISO-01, ISO-02 | Catalog assertions (D-37/D-38 + recommended additions) | integration | `pnpm vitest run packages/db/test/catalog.test.ts` | ❌ Wave 0 |
| ISO-03 | Every D-48 case, raw `pg` as `sift_app` (D-46) | integration | `pnpm vitest run packages/db/test/isolation.test.ts` | ❌ Wave 0 |
| ISO-04 | Scoped helpers filter by mailbox **without RLS**: build the scoped API over an RLS-bypassing (admin) pool, seed both mailboxes, assert only scope rows come back and are touched. Insert type omits `mailboxId` (`// @ts-expect-error` test) | integration + type | `pnpm vitest run packages/db/test/scope.test.ts` + `tsc` | ❌ Wave 0 |
| ISO-04 | Apps cannot import `pg`/`drizzle-orm` directly | static | `pnpm biome ci .` (`noRestrictedImports` override on `apps/**`) | ❌ Wave 0 |
| D-49..D-55 | Supervisor no-overlap, backoff, status writes, heartbeat, SIGTERM drain, retry classification | unit (fake timers) + integration | `pnpm vitest run apps/worker/test` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <touched package>` + `pnpm biome check`
- **Per wave merge:** full suite command
- **Phase gate:** full suite + `compose-smoke` CI job green. Then a human checkpoint on the target machine for success criterion 1 (and a grep of `config/` + `pg_dump` output for the sentinel, criterion 2).

### Wave 0 Gaps
- [ ] Root `package.json`, `pnpm-workspace.yaml` (allowBuilds, minimumReleaseAge), `tsconfig.base.json` (+ `types: ["node"]`, `strict`, `moduleResolution`)
- [ ] `vitest.config.ts` + `packages/db/test/global-setup.ts` (admin URL, bootstrap, create/migrate/drop)
- [ ] `db/bootstrap.sql` (shared by initdb, CI, tests)
- [ ] `biome.json` with `useImportExtensions` + `noRestrictedImports` override
- [ ] `.github/workflows/ci.yml`: pnpm/action-setup@v6 → setup-node@v7 (`node-version-file: .nvmrc`, `cache: pnpm`) → install → PG service `pgvector/pgvector:0.8.7-pg18-trixie` → bootstrap via `docker exec` → postgresql-client-18 → biome/tsc/vitest; separate `compose-smoke` job
- [ ] `.env.example`, `.env.mailboxes.example`, `.env.development.example`, `.gitignore` negations

## Security Domain

`security_enforcement: true`, ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (DB roles) | Per-role passwords from env. SCRAM storage is the PG default [ASSUMED: `password_encryption=scram-sha-256` default]. `sift_app` password rotated on each migrate |
| V3 Session Management | no | No web sessions in M1 |
| V4 Access Control | yes (core) | FORCE RLS + one policy + per-table grants + composite FKs. Catalog test as a regression gate. Superuser unused after init |
| V5 Input Validation | yes | Zod 4 strict config; UUID check before `set_config`; slug rules |
| V6 Cryptography | minimal | Never hand-roll. Rely on Postgres SCRAM. No custom crypto |
| V7 Error/Logging | yes | pino `redact`; errors name env vars, never values; `last_error` redacted before storing |
| V8 Data Protection | yes | Mailbox passwords only in env (worker only); sentinel test; DB port bound to 127.0.0.1 |
| V14 Configuration | yes | Non-root `node` user; read-only config mount; `init: true`; minimal images; no HTTP port |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-mailbox read via missing app filter | Information disclosure | RLS FORCE'd policy + scoped helpers + isolation test |
| Policy widened by an extra permissive policy | Elevation/Disclosure | Catalog asserts exactly 1 policy with the exact normalized expression |
| TRUNCATE / REFERENCES bypassing RLS | Tampering | Catalog asserts `sift_app` lacks TRUNCATE/REFERENCES/TRIGGER |
| Mailbox id leaking across pooled connections | Disclosure | `set_config(…, true)` + "reused connection" test |
| App role gaining ownership or BYPASSRLS | Elevation | Catalog asserts `rolsuper`/`rolbypassrls` false and owns nothing. Owner cannot grant BYPASSRLS (verified `42501`) |
| SQL injection via env password in role DDL | Tampering | `escapeLiteral` / `format('%L')` |
| Secrets in logs/DB/config | Disclosure | Literal-secret key rejection, pino redaction, sentinel test |
| DB exposed on LAN (Docker bypasses host firewalls on Linux [ASSUMED]) | Disclosure | `127.0.0.1:` port binding, dev-only |
| Backup readable by others | Disclosure | `./backups` gitignored. Document file permissions. Backup role is read-only |

## Sources

### Primary (HIGH confidence, tool-verified this session)
- Runtime probes on PostgreSQL 18.3 (PGlite 0.5.8): policy semantics, FORCE, `row_security=off` error, CREATEROLE admin rules, untrusted-extension rule, `uuidv7()`, catalog queries, drizzle 0.45.3 migrator against kit 0.31.11 output
- drizzle-orm 0.45.3 installed source: `pg-core/dialect.js` `migrate()`, `migrator.js` `readMigrationFiles`; kit 0.31.11 `generate` / `generate --custom` output
- Node 26.10.0 local runs: type stripping across pnpm symlinks, `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, enum rejection, `parseArgs`
- TypeScript 7.0.2, Vitest 5.0.3, Biome 2.5.15, pnpm 12.8.1, zod 4.6.5 + yaml 2.9.1, pino 10.4.0 local runs
- postgres REL_18_STABLE `src/backend/utils/misc/rls.c` (`check_enable_rls`)
- docker-library/postgres `18/trixie/Dockerfile` and `docker-entrypoint.sh`; pgvector `Dockerfile`, `vector.control`
- npm registry (`npm view`), Docker Hub tag API, packages.debian.org (trixie postgresql-client)

### Secondary (MEDIUM, official docs via Context7/WebFetch)
- Context7 `/websites/postgresql_18`: ddl-rowsecurity, sql-altertable FORCE, sql-createrole BYPASSRLS + pg_dump note, extend-extensions `trusted`, contrib trusted list, functions-uuid `uuidv7`, functions-admin `current_setting`/`set_config`
- Context7 `/drizzle-team/drizzle-orm-docs`: rls.mdx (`pgPolicy`, `pgRole().existing()`), custom migrations, drizzle-config migrations table/schema
- Context7 `/websites/main_vitest_dev`: globalSetup `provide/inject`
- Context7 `/biomejs/website`: `noRestrictedImports`, overrides
- github.com/pnpm/action-setup README (version from `packageManager`)
- Node.js corepack docs ("will no longer be distributed starting with Node.js v25"), via search results incl. [r2.nodejs.org corepack.json](https://r2.nodejs.org/dist/v25.9.0/docs/api/corepack.json)

### Tertiary (LOW, web search only)
- [Postgres 18 Docker mount path change](https://industrialmonitordirect.com/blogs/knowledgebase/docker-postgres-18-mount-path-change-upgrading-from-17) and [nite07 migration note](https://nite07.com/en/posts/postgres-docker-18-migration/). Superseded by the verified Dockerfile lines
- [OpenReplay corepack article](https://blog.openreplay.com/manage-package-managers-node-corepack/). Superseded by the local verification

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Versions from the registry. Each tool run locally on Node 26.10.0.
- Architecture / RLS / migrations: HIGH. Runtime-verified on PG 18.3 with real Drizzle output and the real migrator.
- Compose/Docker/CI: MEDIUM. Image internals verified from source. Compose behaviour not executed (daemon down).
- Pitfalls: HIGH for 1, 3, 5, 6, 7, 8 (verified). MEDIUM for the rest.

**Research date:** 2026-10-03
**Valid until:** 2026-11-02 for RLS/Postgres facts (stable); about 7 days for package versions (several published this week)
