# Phase 1: Foundation and Isolation - Context

**Gathered:** 2026-10-03
**Status:** Ready for planning

<domain>
## Phase Boundary

The owner can start the stack on the home machine with Docker Compose (Postgres 18 + pgvector, a one-shot `setup` service, and the worker), declare mailboxes in `config/config.yaml` with passwords read only from environment variables, and the database enforces mailbox isolation (non-null `mailbox_id`, forced RLS keyed on `app.mailbox_id`, composite FKs) before any mail-derived data exists. Proven by a catalog-level schema check and a two-mailbox isolation test, both running in CI.

Not in this phase: IMAP connection or ingest (Phase 2), Proton Bridge spike (Phase 2), classification and traces (Phase 3), label application (Phase 4), any UI, the cross-mailbox reader role (M2), confidence thresholds / `tiers` config (Phase 3).

</domain>

<decisions>
## Implementation Decisions

### Schema scope
- **D-01:** Phase 1 creates every M1 table now with minimal columns: `mailbox`, `mailbox_status`, `message`, `label`, `decision`, `folder_sync`, `label_event`, `rule_set`. Later phases add columns via migrations. The RLS test covers every table from day one.
- **D-02:** `message` has keys + timestamps only (`id`, `mailbox_id`, `created_at`, `updated_at`). Message-ID, UID, header hash etc. are added in Phase 2 after the Bridge spike decides message identity.
- **D-03:** Primary keys are UUIDv7 on all tables. `mailbox` additionally has a unique `slug` and an optional `display_name`. — **Reversibility:** one-way — changing PK type later requires rewriting every table and every composite FK.
- **D-04:** Child tables use composite foreign keys including `mailbox_id` (each parent has `UNIQUE (mailbox_id, id)`; children reference `(mailbox_id, <parent>_id)`), so the database rejects a row in mailbox A pointing at mailbox B's parent. — **Reversibility:** costly — every FK and the scoped helpers depend on the composite shape.
- **D-05:** Mailbox rows are never hard-deleted by the app: FKs to `mailbox` are `ON DELETE RESTRICT`; `mailbox.disabled_at` soft-disables. Hard delete only via explicit `sift mailbox purge`.
- **D-06:** `mailbox` is an unscoped registry (configuration, not mail-derived): no RLS on it; `sift_app` has SELECT only. Its column set is fixed and asserted by the catalog test (see D-37), so adding a column is a deliberate test change.
- **D-07:** New `mailbox_status` table holds worker runtime state, one row per mailbox: `mailbox_id` is PK and FK; columns `state` (ok / error / disabled), `last_error`, `last_sync_at`, `last_seen_at`. It is mailbox-scoped like any other table (RLS, `sift_app` may write, covered by the catalog test). The worker never updates `mailbox`.
- **D-08:** Timestamps are `timestamptz`, UTC, `DEFAULT now()`; `created_at`/`updated_at` on every table.
- **D-09:** The first migration runs `CREATE EXTENSION vector` (pgvector enabled, no vector columns until M2).

### Toolchain & runtime
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

### Mailbox lifecycle and migrations
- **D-27:** A one-shot `setup` Compose service runs `sift migrate` then `sift config apply`. The worker `depends_on` setup with `condition: service_completed_successfully` (and db healthy). Restarting only the worker does **not** reconcile config.
- **D-28:** After editing `config.yaml`, the owner reruns `docker compose run --rm setup`. This is documented next to the config file (in `config/config.example.yaml` comments and the README).
- **D-29:** `sift migrate` takes a `pg_dump` (custom format) into `./backups/` before applying, but only when there are pending migrations. Files are named with timestamp and target migration (e.g. `sift-<ts>-pre-<migration>.dump`); keep the last 5, prune older ones after a successful dump. `pg_dump` runs inside the setup container (bind mount `./backups`). On a Mac, host development needs `pg_dump` 18 locally.
- **D-30:** `sift migrate` holds a Postgres advisory lock for the whole run, even though only setup migrates normally (protects against a concurrent manual run).
- **D-31:** Development equivalent of setup: `pnpm sift migrate && pnpm sift config apply` with the owner database URL from `.env.development`, then start the worker with the app-role URL.
- **D-32:** `sift config apply` handles safe changes automatically: add a new slug, update IMAP/display fields, set `disabled_at` for a slug removed from config, re-enable a returning slug. Risky changes need explicit CLI commands: `sift mailbox rename <old> <new>`, `sift mailbox purge <slug>`.
- **D-33:** Guards on `config apply`: a broken or empty config aborts the apply and changes nothing (never disables every mailbox). If one slug disappears while another appears in the same apply, stop and suggest `sift mailbox rename`, unless `--confirm` is passed.
- **D-34:** At worker start, if `config.yaml` differs from the DB registry, the worker refuses to start, lists each difference, and tells the owner to run `docker compose run --rm setup`.
- **D-35:** Missing or empty `password_env` variables fail fast, before connecting to anything (so the error is the first and only thing in the log). Report every problem at once, e.g. `Missing env vars: SIFT_JOBS_IMAP_PASSWORD (mailbox "job-search"), SIFT_SIDE_IMAP_PASSWORD (mailbox "side")`. Name the variable, never its value. Whitespace-only values count as empty.

### Isolation enforcement
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

### Worker in Phase 1
- **D-49:** The worker runs the real scheduler skeleton with a no-op per-mailbox batch: after startup checks (env, config, drift), a supervisor ticks, rereads the registry, starts/stops mailbox tasks, touches the heartbeat file, and coordinates shutdown. Each due mailbox runs as its own async task; the Phase 1 batch updates `mailbox_status.last_seen_at` (and `last_sync_at` / state on success). Phase 2 drops ingest into this loop.
- **D-50:** Mailboxes run concurrently and fail independently. A mailbox never overlaps itself: an in-progress flag per mailbox; if a run exceeds the interval, the next run is skipped, not stacked.
- **D-51:** A failing mailbox run sets `mailbox_status.state = error` with a redacted `last_error` (no secrets) and backs off exponentially (capped, e.g. 15 min); the next success sets `ok`. Mailbox failures are visible in `mailbox_status`, not in container health.
- **D-52:** Interval defaults to 60 s, configurable via `worker.poll_interval_seconds`.
- **D-53:** Graceful shutdown on SIGTERM/SIGINT: stop scheduling, let in-flight batches finish within a bounded timeout, close the pool, exit 0. Compose `stop_grace_period` matches.
- **D-54:** Health: the supervisor touches a heartbeat file each tick; the Compose healthcheck fails if it is stale. No HTTP port.
- **D-55:** DB connection at startup retries only self-resolving errors: connection refused, host not found, `57P03` (database starting up) → backoff with jitter for about 30 s, then exit 1. `28P01` (wrong password), `3D000` (database does not exist), `42501` (permission denied) → fail immediately with a clear message. Compose `depends_on` (db healthy, setup completed) plus a restart policy handle the rest.

### Config file
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

### Post-research decisions (2026-10-03, answers to RESEARCH.md open questions)
- **D-66 (amends D-36, D-39):** Three roles, not two. Add `sift_backup`: dump-only, `BYPASSRLS` + `pg_read_all_data`, `LOGIN`, owns nothing. It is created by the superuser `docker-entrypoint-initdb.d` bootstrap (password from `SIFT_DB_BACKUP_PASSWORD`), and only the setup service gets its credentials. `sift migrate`'s D-29 `pg_dump` runs as `sift_backup`, because `sift_owner` under FORCE RLS fails with `42501` or, with `--enable-row-security`, dumps zero mail rows. The worker never gets `sift_backup` credentials. The catalog test (D-37) asserts that `sift_backup` is the only role with `BYPASSRLS` besides superusers. — **Reversibility:** costly.
- **D-67:** Mailbox password env vars go to the worker service only. `sift config apply` (setup) checks that each `password_env` is a syntactically valid env var name, but it does not receive or check the secret values. The D-35 presence check runs at worker startup and in `sift config check` when the env is present.
- **D-68 (refines D-11):** The Dockerfile declares `ARG NODE_VERSION=<value matching .nvmrc>`. A test fails the build if the Dockerfile default differs from `.nvmrc`. CI reads `.nvmrc` directly (`node-version-file`).
- **D-69 (amends D-05, D-32):** Phase 1 builds `sift mailbox rename` only. `sift mailbox purge` is deferred. Until purge exists, **no user-facing message, help text, README or doc may mention purge**. For example, `sift mailbox list` shows a disabled mailbox without suggesting how to delete it, and errors must not point at a purge command.
- **D-70:** Owner-RLS delete test (brought forward from the purge design): an integration test seeds two mailboxes, connects as `sift_owner`, sets `app.mailbox_id` to mailbox A, and runs `DELETE` on every scoped table. It asserts that A's rows are gone and B's rows are untouched, and that the same `DELETE` with no `app.mailbox_id` set removes nothing. This proves the owner's FORCE-RLS policy works, which data migrations rely on.
- **D-71:** FND-02's "LLM confidence threshold" is satisfied in Phase 3 (per D-59). Phase 1 verification must not fail on it; the traceability note goes in the plan.

### Claude's Discretion
- Exact column lists for the minimal tables beyond keys/timestamps/`mailbox_id` (e.g. whether `rule_set` gets a `version` column now), as long as D-01/D-02 hold.
- Whether UUIDv7 is generated by Postgres 18's native `uuidv7()` as a column default or in application code.
- How `updated_at` is maintained (trigger vs app).
- Privileges `sift_owner` needs to create/alter `sift_app` (e.g. `CREATEROLE`) and how the initdb script grants them.
- Exact backoff caps and jitter values; heartbeat file path and staleness threshold; graceful shutdown timeout.
- `.env` / `.env.example` / `.env.development` layout and which variables each Compose service receives (principle: setup gets owner credentials, worker gets only app credentials).
- Compose service details (healthcheck commands, restart policies, whether the db port is exposed on the host for development).
- Plan split and wave ordering.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked architecture decisions
- `docs/adr/0001-multiple-mailboxes-single-owner.md` — mailbox as isolation unit, RLS keyed on `app.mailbox_id`, non-null `mailbox_id`, credentials via `password_env`, cross-mailbox reader role constraints
- `docs/adr/0002-tiered-classification.md` — context for later tables (`rule_set`, `decision`); not implemented in this phase
- `docs/adr/0003-traces-and-mail-app-relabels.md` — context for `decision`, `folder_sync`, `label_event` tables that Phase 1 creates minimally

### Project scope and requirements
- `.planning/REQUIREMENTS.md` — FND-01..03, ISO-01..04 (this phase)
- `.planning/ROADMAP.md` — Phase 1 goal and success criteria
- `.planning/PROJECT.md` — constraints, `<decisions>` block summarising the ADRs, contributing rules (every new mail-derived table gets `mailbox_id` + RLS policy)
- `.planning/INGEST-CONFLICTS.md` — ADR-0001 wins over README wording on shared/synthetic data

### Product documentation
- `README.md` — `config.yaml` structure and key names (D-59 must match), quick start (to be updated per D-56), planned stack and repo layout, security model

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `.nvmrc` — already committed, pins `v26.10.0` (source for D-11; the Docker base image tag and CI read it).
- `tsconfig.json` (root) — already committed with `module: nodenext`, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions`. Extend it (or rename/split it into the shared base of D-14, adding `strict` and `moduleResolution`) rather than replacing it.
- Otherwise only docs (`README.md`, `docs/adr/`, `.planning/`), `LICENSE` and `.gitignore`; the workspace is otherwise created from scratch.

### Established Patterns
- Commit history uses conventional-commit prefixes (`docs:`, `chore:`, `chore(planning):`); commitlint (D-16) codifies this.
- Planned layout from README: `apps/worker`, `apps/web`, `packages/core`, `packages/classifier`, `packages/db`, `packages/evals`, `fixtures/`, `evals/`, `data/`. Phase 1 creates `apps/worker`, `packages/core`, `packages/db` only (FND-03), plus `config/` (D-56) and `backups/` (gitignored, D-29).

### Integration Points
- Phase 2 plugs IMAP ingest into the worker's per-mailbox batch (D-49) and extends `message` / `folder_sync` via migrations through the scoped API (D-43).
- Every later table must pass the catalog test (D-37) — it is the guard for the contributing rule.

</code_context>

<specifics>
## Specific Ideas

- Error messages are part of the design: report all problems at once, name variables never values, suggest the fix (quote a numeric slug, run setup after editing config, use `sift mailbox rename`).
- "Exempt doesn't mean unchecked": allowlisted tables get their own assertions; the fixed `mailbox` column list enforces "configuration only".
- Append-only is a privilege concern, not a policy concern: one uniform policy expression, per-table grants.
- `withMailbox` has one job (isolation); "disabled" is the scheduler's and `requireActive`'s job.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 2 spike addition:** determine how Proton Bridge's address mode maps to Sift mailboxes. In combined mode several addresses share one IMAP mailbox, so separate Sift mailboxes for `me@` and `jobs@` on one account would be the same INBOX and trip the duplicate check (D-64); split mode may be what makes "personal + job-search on one Proton account" work.
- Cross-mailbox reader role (`sift_reader`) — M2, with the unified review queue.
- `sift mailbox purge <slug>` — deferred out of Phase 1 (D-69). When it lands, it runs as `sift_owner` under `app.mailbox_id`, the path that D-70's test already proves.
- `tiers` config section with confidence thresholds — Phase 3.
- Multi-arch image publishing — not in M1.

</deferred>

---

*Phase: 01-foundation-and-isolation*
*Context gathered: 2026-10-03*
