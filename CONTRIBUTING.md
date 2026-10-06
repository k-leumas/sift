<!-- generated-by: gsd-doc-writer -->
# Contributing to Sift

Issues and PRs are welcome. Sift is **pre-alpha**. Phase 1 ships the foundation: a pnpm workspace with the worker app (`apps/worker`), shared config and logging code (`packages/core`) and the database package (`packages/db`), the database isolation layer (Postgres row-level security for every mailbox-scoped table, behind a scoped API), and the worker skeleton that runs one loop per enabled mailbox. Phase 2 adds Proton Bridge in its own container (`bridge/`) and IMAP ingest: the worker reads each mailbox over pinned TLS and stores metadata, headers and a short-lived body cache. Classifying mail arrives next; see the [Roadmap](README.md#roadmap). Design feedback and questions about the ADRs are as welcome as code.

Before changing anything substantial, read the [README](README.md) for the target design and the architecture decision records in [`docs/adr/`](docs/adr/):

- [ADR 0001: Multiple mailboxes, single owner](docs/adr/0001-multiple-mailboxes-single-owner.md)
- [ADR 0002: Tiered classification](docs/adr/0002-tiered-classification.md)
- [ADR 0003: Traces and mail app relabels](docs/adr/0003-traces-and-mail-app-relabels.md)

## Development setup

The development loop runs Postgres in Docker Compose and the worker on your machine.

1. Clone the repository and use the Node.js version pinned in `.nvmrc` (`v26.10.0`):

   ```bash
   git clone git@github.com:k-leumas/sift.git
   cd sift
   nvm use
   ```

2. Install pnpm 12. The exact version is pinned by `packageManager` in `package.json`. Node 26 ships without corepack, so either install pnpm globally (`npm install -g pnpm`; it switches to the pinned version by itself) or install corepack:

   ```bash
   npm install -g corepack && corepack enable pnpm
   ```

3. Install dependencies. This also installs the lefthook git hooks:

   ```bash
   pnpm install
   ```

4. Create the local settings files from the committed examples:

   ```bash
   cp .env.example .env
   cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes
   cp .env.development.example .env.development
   cp config/config.example.yaml config/config.yaml
   ```

   - Fill in every password in `.env` with `openssl rand -hex 24`, then put **the same values** in `.env.development` (it replaces each `change-me-hex`; `SIFT_TEST_ADMIN_URL` takes `POSTGRES_PASSWORD`).
   - `.env.mailboxes` is needed even though the host worker does not read it: the Compose file passes it to the worker container, and Docker Compose v2.2.3 refuses every command, including `docker compose up -d db`, while the file is missing. Empty values are fine for development; `.env.development` already holds placeholder mailbox passwords.
   - Set `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE` in `.env` too (`openssl rand -hex 24`). Compose interpolates the whole file, so even `docker compose up -d db` fails while it is empty.

5. Create the Bridge volume once, then start the database. Compose refuses every command while the external `sift-bridge` volume is missing, for the same reason:

   ```bash
   docker volume create sift-bridge
   docker compose up -d db
   ```

6. Run the development equivalent of the `setup` service, which applies migrations and registers the mailboxes from `config/config.yaml`:

   ```bash
   pnpm sift migrate && pnpm sift config apply
   ```

   `sift migrate` writes a `pg_dump` backup to `backups/` (`SIFT_BACKUP_DIR`) before it applies pending migrations, and that needs pg_dump 18. On a Mac, either `brew install libpq` and put its `bin` directory on your `PATH`, or uncomment `SIFT_PG_DUMP=scripts/pg-dump-via-compose.sh` in `.env.development` to run pg_dump inside the db container.

7. Run the worker with `node --watch`, restarting on every source change:

   ```bash
   pnpm dev
   ```

`pnpm sift <command>` runs any CLI command on the host with `.env.development` loaded; `pnpm sift --help` lists them. To run the whole stack the way an owner does, follow the [README quick start](README.md#quick-start).

### Developing against Bridge

To run the host worker against a real Proton account:

1. Log in once, as in the [README quick start](README.md#quick-start) (steps 6 to 9): `touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak`, then `docker compose run --rm bridge-init`.
2. Start Bridge: `docker compose up -d bridge`. It publishes IMAP on host loopback only, at port 1143, or at `SIFT_BRIDGE_PORT` when that is set. Quit the desktop Proton Mail Bridge app first, or set `SIFT_BRIDGE_PORT` in `.env`: the app holds 127.0.0.1:1143.
3. Use a development config with `host: localhost` and that port, and the same `imap.tls.pin_sha256` that `docker compose run --rm bridge-init` printed. The pin checks Bridge's public key, not the host name, so one value works for `bridge` inside Compose and `localhost` on the host. `config/config.yaml` stays the Compose config, so keep the development copy outside the repository, for example `~/sift-dev/config.yaml`, and point the CLI at it per command:

   ```bash
   SIFT_CONFIG=~/sift-dev/config.yaml pnpm sift bridge trust <slug>
   SIFT_CONFIG=~/sift-dev/config.yaml pnpm dev
   ```

   `sift bridge trust <slug>` run on the host reaches Bridge through the same published port and shows whether the fingerprint matches the pin. The host worker reads the mailbox password from the variable named by `password_env`. `.env.development` only holds placeholders, so while you work against Bridge, replace the placeholder there with the value `bridge-init` wrote into `.env.mailboxes` (both files are git-ignored).

## Checks

Run these before opening a PR:

```bash
pnpm lint        # Biome: lint and format check
pnpm typecheck   # tsc for the root and every workspace package
pnpm test        # Vitest: every package and app
```

- `pnpm test` also needs the IMAP test server: `scripts/test-imap.sh up` starts Dovecot (`dovecot/dovecot:2.4.5`) on 127.0.0.1:31143 with a fresh self-signed certificate, and reuses it when it already runs (`scripts/test-imap.sh down` removes it). The IMAP tests fail, never skip, when it is down.
- `pnpm test` needs a running db (`docker compose up -d db`) and `SIFT_TEST_ADMIN_URL` from `.env.development`, the superuser URL used only by the test harness. Each run creates a throwaway `sift_test_*` database, runs the real migrations against it, and drops it afterwards. Tests that need the database fail, never skip, when it is unreachable.
- `SIFT_TEST_ADMIN_URL= pnpm vitest run packages/core` runs the config and logging tests without a database. A variable set in the shell wins over `.env.development`, so the empty value turns the database setup off.
- `scripts/compose-smoke.sh` builds the image and runs the full stack (db, setup, worker), then checks that setup succeeded and the worker is healthy. It runs on its own volume, `<project>-pgdata-smoke`, and never on `sift-pgdata`. It shares none of your files: it uses its own `.env`, `.env.mailboxes` and `config/config.yaml` under `.smoke/<project>/` (git-ignored, made from the examples, with every IMAP host replaced by an unroutable name), writes its pre-migration dumps to `.smoke/<project>/backups` instead of your `backups/` (so your own backups are never pruned), and builds its own image, `sift-smoke:local`. Outside CI it refuses the default Compose project: run it as `COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh`. It also asks Docker which containers the project already has and refuses (in CI too) unless they are an earlier smoke stack on the same volume, so it cannot replace your running containers. Its `--down` flag runs `docker compose down -v`, which deletes the smoke volume, so outside CI it also needs `SMOKE_ALLOW_VOLUME_REMOVAL=yes`.
- `scripts/bridge-smoke.sh` builds the Bridge image from `bridge/Dockerfile` (about 4 minutes; the `sift-helper` Go tests run inside the build) and checks it end to end on throwaway volumes: keychain, STARTTLS through the published port, the printed fingerprint, and the one-shot `bridge-init` modes. It never touches the `sift-bridge` volume or your `.env`.
- CI runs the same commands: `scripts/test-imap.sh up`, then `pnpm lint`, `pnpm typecheck` and `pnpm test` against a Postgres service container, plus `scripts/compose-smoke.sh --down`. A separate workflow runs `scripts/bridge-smoke.sh` whenever `bridge/`, the smoke script or that workflow changes.

## Coding standards

- **TypeScript only.** The stack is TypeScript end to end, including the planned classifier. Please don't propose Python components.
- **Strict module syntax.** The root `tsconfig.json` sets `erasableSyntaxOnly` (no enums, namespaces or other non-erasable syntax), `verbatimModuleSyntax` (use `import type` for type-only imports) and `allowImportingTsExtensions` (import local files with their `.ts` extension, e.g. `./x.ts`). Code runs under Node's native type stripping without a build step.
- **Biome** lints and formats JavaScript, TypeScript and JSON. `pnpm format` applies fixes; `pnpm lint` is the check CI runs. The pre-commit hook runs `biome check` on staged files.
- **Database access goes through `@sift/db`.** Application code under `apps/*/src` reaches the database only through the scoped API (`withMailbox`), which sets the mailbox for row-level security. Biome rejects direct `pg` and `drizzle-orm` imports there (ISO-04). Tests may import `pg`.
- **Schema changes** start in `packages/db/src/schema`. Run `pnpm db:generate` to produce the SQL migration, then add a custom migration (`pnpm db:generate --custom --name=<name>`) for what the generator does not emit: `FORCE ROW LEVEL SECURITY`, grants and `updated_at` triggers. Review and commit the generated SQL. Migrations are only ever applied with `pnpm sift migrate`; never push the schema to a database directly with drizzle-kit.
- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary`, for example `chore: add tsconfig and .nvmrc` or `docs(adr): clarify relabel handling`. commitlint checks every commit through a lefthook `commit-msg` hook; the header and each body line are at most 100 characters.

## PR guidelines

- **Open an issue first** for anything beyond a small fix, so the approach can be agreed before you write code.
- **Architecture changes need an ADR.** Add a new numbered file to `docs/adr/` following the existing format (title, Status, Date, then Context, Decision, Consequences, and Alternatives considered).
- **Never commit real email.** Not in fixtures, tests, issues, screenshots or PR descriptions. Add test cases to the synthetic inbox (`fixtures/synthetic-inbox/`, planned) instead.
- **Changes to prompts, models or classification must include an eval run** (`pnpm eval`, planned) in the PR description.
- **Every new table holding mail-derived data gets a `mailbox_id` and the standard Postgres row-level security policy**, and must pass the two isolation gates in `pnpm test`:
  - `packages/db/test/catalog.test.ts` checks every table in the migrated schema: `mailbox_id`, enabled and forced row-level security with the standard policy, grants and the `updated_at` trigger. A table that is deliberately not mailbox-scoped needs an allowlist entry with a reason.
  - `packages/db/test/isolation.test.ts` seeds two mailboxes and fails if either can read or write the other's rows.

  The cross-mailbox eval suite that checks prompts and training sets (`evals/isolation/`) arrives with multiple-mailbox support in M5. See the [Data model](README.md#data-model) section of the README.
- **Treat email as untrusted input.** Changes that touch how email content reaches the LLM prompt or any tier must keep it fenced off from instructions, and the injection suite (`evals/injection/`, planned) must still pass. See the [Security model](README.md#security-model).

Branch names aren't fixed by any convention. A short descriptive name such as `docs/adr-0004-drafts` or `fix/relabel-echo` is fine. PRs target `main`.

## Issue reporting

Report bugs and request features through [GitHub Issues](https://github.com/k-leumas/sift/issues). There are no issue templates yet, so please include:

- **For bugs:** what you did, what you expected, what happened instead, and your environment (OS, Node.js version, mail provider or IMAP server, Ollama model if relevant).
- **For design feedback:** which section of the README or which ADR it concerns, and the case it doesn't handle.
- **For feature requests:** the problem you're trying to solve, not only the proposed solution. Check the [Roadmap](README.md#roadmap) and the "Not planned" list first. Sending email and a hosted version are out of scope.

**Don't paste real email content into issues.** If a bug depends on a specific message, reduce it to a fictional example with the same structure (headers, encoding, label folder layout) before posting.

Security issues, especially prompt-injection bypasses or cross-mailbox leakage, should not be filed as public issues. <!-- VERIFY: private security reporting channel (e.g. GitHub private vulnerability reporting enabled on k-leumas/sift) --> Use GitHub's private vulnerability reporting on the repository instead.
