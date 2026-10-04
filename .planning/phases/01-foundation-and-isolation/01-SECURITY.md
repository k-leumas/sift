---
phase: "01"
slug: "foundation-and-isolation"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-10-04"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| npm registry -> developer machine / CI / image | Third-party code and install scripts cross here | see 01-01 |
| app source (apps/**/src) -> database driver | App code must reach Postgres only through the scoped API | see 01-01 |
| host network -> db container | Postgres port reachable from the host | see 01-02 |
| env files -> git | Secrets on disk next to tracked files | see 01-02 |
| env -> bootstrap SQL | Passwords from env are embedded in role DDL | see 01-02 |
| sift_app session -> scoped tables | The worker's role reads and writes mail-derived rows; RLS is the backstop | see 01-03 |
| env (SIFT_DB_APP_PASSWORD) -> role DDL | Password embedded in CREATE/ALTER ROLE | see 01-03 |
| test harness (superuser URL) -> cluster | Admin credentials used only by tests | see 01-03 |
| config.yaml (owner-edited file) -> parser | Trusted author, but the file may be malformed or hold misplaced secrets | see 01-04 |
| process env -> config check / worker | Mailbox secrets live only here | see 01-04 |
| log lines -> stdout / docker logs | Anything logged is persisted by Docker | see 01-04 |
| future migrations -> production schema | Contributors add tables; the catalog test is the gate | see 01-05 |
| CI runner -> service container | Ephemeral test credentials | see 01-05 |
| sift_app session -> rows of other mailboxes | The leak ISO-03 exists to rule out | see 01-06 |
| sift_owner maintenance -> mail data | Owner work must stay mailbox-scoped | see 01-06 |
| app code (apps/**/src) -> @sift/db | The only path from application code to mail data | see 01-07 |
| pooled connection reuse | A connection used for mailbox A is reused for B | see 01-07 |
| setup container -> pg_dump child process | Backup credentials passed to a subprocess | see 01-08 |
| backup files on the host | Full copies of mail data on disk | see 01-08 |
| config.yaml edits -> mailbox registry | Owner edits become database state through setup | see 01-09 |
| setup container env -> config apply | Setup holds owner DB credentials but no mailbox secrets (D-67) | see 01-09 |
| worker env (mailbox secrets, sift_app URL) -> logs and DB | Secrets must stay in memory only | see 01-10 |
| one mailbox's failure -> other mailboxes | Faults must not cross mailboxes | see 01-10 |
| Docker restart -> worker | Worker restarts without setup re-running (Pitfall 11) | see 01-11 |
| SIFT_DATABASE_URL (owner-supplied) -> worker session | A wrong URL could point at a privileged role | see 01-11 |
| worker memory (secrets) -> persistence (DB, logs) | Secrets must not cross | see 01-11 |
| host .env files -> containers | Each container receives a subset of secrets | see 01-12 |
| image build -> internet (apt, npm, Docker Hub) | Build-time downloads | see 01-12 |
| container -> host network | Only the db port is published, on loopback | see 01-12 |
| documentation -> owner actions | Owners follow the README literally, including where secrets go | see 01-13 |

---

## Threat Register

55 unique threats from the `<threat_model>` blocks of the 13 plans (67 register rows; T-01-SC repeats in every plan). Evidence for each closure is in the audit trail below.

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-SC | Tampering | npm installs (pnpm add in Task 3) | high | mitigate | Blocking-human legitimacy checkpoint (Task 2), exact pins, `minimumReleaseAge: 10080`, frozen lockfile in CI and Docker | closed |
| T-01-01 | Elevation of Privilege | install scripts (esbuild, lefthook, transitive deps) | medium | mitigate | `allowBuilds` allowlist lists only esbuild and lefthook. pnpm 12 fails install on any other build script (Pitfall 6) | closed |
| T-01-02 | Information Disclosure | app code importing pg/drizzle-orm directly and skipping the mailbox filter (ISO-04) | high | mitigate | Biome `noRestrictedImports` error override on `apps/**/src/**`, proven by the probe command in Task 3 verify | closed |
| T-01-03 | Information Disclosure | `requireDatabaseUrl` error text | low | mitigate | Error names the variable only, never the value | closed |
| T-01-04 | Information Disclosure | db port mapping in compose.yaml | high | mitigate | Port bound to `127.0.0.1` only; a negative grep in Task 1 acceptance criteria | closed |
| T-01-05 | Elevation of Privilege | role bootstrap | high | mitigate | sift_owner NOSUPERUSER NOBYPASSRLS; the superuser password exists only in the db service env; sift_backup is read-only via pg_read_all_data | closed |
| T-01-06 | Tampering | password interpolation in db/bootstrap.sql | medium | mitigate | `format('%L')` + `\gexec`; no string concatenation | closed |
| T-01-07 | Information Disclosure | `.env*` files and config.yaml in git | high | mitigate | `.gitignore` rules verified with `git check-ignore` in Task 2 | closed |
| T-01-08 | Elevation of Privilege | table exists without FORCE RLS between migrations | high | mitigate | FORCE lives in a custom migration applied in the same migrator transaction as the generated CREATE TABLE | closed |
| T-01-09 | Tampering | ALTER/CREATE ROLE with env password | high | mitigate | `client.escapeLiteral()` for the password literal; statement never logged | closed |
| T-01-10 | Elevation of Privilege | over-broad sift_app grants (ALL, TRUNCATE, default privileges) | high | mitigate | Explicit per-table GRANT lists; acceptance greps forbid TRUNCATE / GRANT ALL / DEFAULT PRIVILEGES | closed |
| T-01-11 | Information Disclosure | cross-mailbox reference through a child row | high | mitigate | Composite FKs (mailbox_id, message_id) -> message(mailbox_id, id) (D-04) | closed |
| T-01-12 | Elevation of Privilege | admin URL reaching app code | medium | mitigate | Admin URL only in packages/db/test/**, read from SIFT_TEST_ADMIN_URL; never exported from @sift/db | closed |
| T-01-13 | Information Disclosure | literal secret in config.yaml echoed in errors | high | mitigate | Pre-pass rejects secret-looking keys without printing values; tested by asserting issue text lacks the value | closed |
| T-01-14 | Denial of Service | YAML alias expansion (billion laughs) | low | mitigate | `maxAliasCount: 50` on parseDocument | closed |
| T-01-15 | Information Disclosure | env presence messages | high | mitigate | Messages name variables and slugs only; sentinel-value assertion in env.test.ts | closed |
| T-01-16 | Information Disclosure | logs containing passwords or connection strings | high | mitigate | pino redact paths at three depths plus redactText for free-form messages (log.test.ts) | closed |
| T-01-17 | Elevation of Privilege | extra permissive policy widening access | high | mitigate | Catalog asserts exactly one policy with the exact normalized expression; negative test adds a second policy | closed |
| T-01-18 | Information Disclosure | new mail-derived table without mailbox_id/RLS | high | mitigate | Catalog scans every relation outside the allowlist; rogue-table negative test | closed |
| T-01-19 | Elevation of Privilege | sift_app gaining ownership, BYPASSRLS, TRUNCATE or column UPDATE | high | mitigate | Role and privilege assertions with negative tests | closed |
| T-01-20 | Information Disclosure | CI test passwords in workflow file | low | accept | Values only unlock a throwaway service container that exists for one job; no production credential is involved | closed |
| T-01-21 | Information Disclosure | cross-mailbox reads with the app filter missing | critical | mitigate | Every D-48 case asserted on raw sift_app connections across all scoped tables | closed |
| T-01-22 | Tampering | cross-mailbox writes (insert/move/child reference) | high | mitigate | 42501 / 23503 assertions per table | closed |
| T-01-23 | Information Disclosure | stale mailbox id on a pooled connection | high | mitigate | Reused-connection test pins the `''` -> nullif -> no rows behaviour | closed |
| T-01-24 | Tampering | owner maintenance deleting another mailbox's data | high | mitigate | D-70 test: unscoped owner DELETE is a no-op; scoped DELETE touches only A | closed |
| T-01-25 | Information Disclosure | mailbox id leaking across pooled connections | high | mitigate | set_config is_local=true inside one transaction; concurrency + rollback tests | closed |
| T-01-26 | Tampering | cross-mailbox write via helper input | high | mitigate | Insert type omits mailboxId; scope fills it; RLS WITH CHECK backstops | closed |
| T-01-27 | Elevation of Privilege | raw transaction/pool escaping to app code | high | mitigate | Opaque AppDb (WeakMap internals), ScopeClosedError, export-surface test, Biome restricted imports | closed |
| T-01-28 | Tampering | injection through mailboxId into set_config | medium | mitigate | UUID validation before use + bound parameter in the sql template | closed |
| T-01-29 | Information Disclosure | secrets stored in mailbox_status.last_error | high | mitigate | recordSyncError always runs redactText with the configured secret values; tested | closed |
| T-01-30 | Information Disclosure | backup files readable by other local users | high | mitigate | Files created with mode 0600 and `wx`; `backups/*` git-ignored (01-02) | closed |
| T-01-31 | Information Disclosure | backup password in process listing or error text | high | mitigate | PGPASSWORD env only; `--dbname` URL stripped of the password; stderr redacted | closed |
| T-01-32 | Tampering | migration applied without a restorable backup | high | mitigate | Backup is a hard prerequisite when pending; failure paths tested to apply nothing | closed |
| T-01-33 | Tampering | concurrent migrate runs interleaving | medium | mitigate | Session advisory lock MIGRATE_LOCK_KEY for the whole run; lock test | closed |
| T-01-34 | Elevation of Privilege | sift_backup misuse | medium | mitigate | Credentials only in setup (01-12); role is read-only (pg_read_all_data) and asserted by the catalog test (01-05) | closed |
| T-01-35 | Tampering | accidental mass-disable or identity loss from a bad config edit | high | mitigate | Broken/empty config never reaches applyConfig; rename-suspect refusal without --confirm; single transaction; tests | closed |
| T-01-36 | Tampering | rename onto an existing slug or an invalid slug | medium | mitigate | validateSlug + unique constraint + DB check constraint; tested | closed |
| T-01-37 | Information Disclosure | mailbox secrets reaching the setup container | high | mitigate | config apply never calls checkMailboxEnv; CLI test runs with no password vars set | closed |
| T-01-38 | Tampering | SQL injection through slugs or IMAP fields | medium | mitigate | Parameterized queries only; values validated by the config schema first | closed |
| T-01-39 | Denial of Service | one failing or hanging mailbox stalling others | medium | mitigate | Independent tasks, per-mailbox in-progress flag, backoff, errors swallowed per mailbox; supervisor tests | closed |
| T-01-40 | Information Disclosure | secrets in last_error or logs | high | mitigate | recordSyncError redacts with secretValues(config, env); logger redact paths; URLs never logged | closed |
| T-01-41 | Denial of Service | unclean shutdown leaving transactions open | low | mitigate | Bounded drain then pool close on SIGTERM/SIGINT; integration test asserts exit 0 | closed |
| T-01-42 | Tampering | worker processing a disabled mailbox | medium | mitigate | Registry recheck each tick + requireActive inside the batch transaction (D-45) | closed |
| T-01-43 | Elevation of Privilege | worker connected as superuser/BYPASSRLS | high | mitigate | assertUnprivilegedRole at startup; process-level test with the admin URL | closed |
| T-01-44 | Tampering | worker running against a stale registry | medium | mitigate | checkDrift refusal before scheduling (D-34); drift test | closed |
| T-01-45 | Information Disclosure | connection string or password in startup errors | high | mitigate | DatabaseStartupError messages mapped per code, never include the URL; tested with a sentinel password | closed |
| T-01-46 | Information Disclosure | mailbox password persisted in config/DB/logs | critical | mitigate | Sentinel test scanning config files, every table via pg_tables, and all process output; last_error redaction asserted | closed |
| T-01-47 | Denial of Service | crash loop on transient DB unavailability | low | mitigate | Classified retry for about 30 s; Compose restart policy handles the rest (D-55) | closed |
| T-01-48 | Elevation of Privilege | worker container holding owner/backup/superuser credentials | high | mitigate | Explicit per-service environment; compose.test.ts asserts the worker key subset and no privileged password references | closed |
| T-01-49 | Information Disclosure | mailbox secrets in the setup container | medium | mitigate | Only the worker has env_file .env.mailboxes; compose.test.ts asserts setup has no `_IMAP_PASSWORD` keys (D-67) | closed |
| T-01-50 | Elevation of Privilege | container running as root | medium | mitigate | `USER node` in Dockerfile; acceptance grep | closed |
| T-01-51 | Information Disclosure | secrets or local config baked into the image | high | mitigate | .dockerignore excludes .env*, config/config.yaml, backups, .git, tests | closed |
| T-01-52 | Information Disclosure | Postgres reachable from the LAN | high | mitigate | Loopback-only port mapping asserted by compose.test.ts | closed |
| T-01-53 | Information Disclosure | docs steering owners to put passwords in the wrong file | medium | mitigate | Quick start names `.env.mailboxes` for mailbox passwords and `.env` for DB passwords; the config example comment repeats it; contract test asserts the README copy steps | closed |
| T-01-54 | Repudiation | docs pointing at a nonexistent destructive command | low | mitigate | D-69 scan test over docs and shipped source | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-20 | The CI test passwords in `.github/workflows/ci.yml` only unlock a throwaway Postgres service container that exists for one job; no production credential is involved (rationale in 01-05-PLAN.md and `ci.yml:33-34`). | Plan 01-05 threat model (owner-approved plan) | 2026-10-04 |

*Accepted risks do not resurface in future audit runs.*

### Owner decisions noted alongside the register (not threats)

- **IN-03 residual:** `db/bootstrap.sql` still sends the sift_owner and sift_backup passwords as plaintext in DDL (only sift_app uses a SCRAM verifier). Mitigated operationally: keep Postgres `log_statement` at `none` (README and bootstrap.sql warn).
- **IN-12:** pool clients tracked from creation instead of `connectionTimeoutMillis`. A per-attempt connect timeout inside the startup retry loop would still let D-55 retries continue, so it remains an option.
- **Unregistered (informational):** the review fixes added owner-controlled Compose overrides with no register row: `SIFT_IMAGE`, `SIFT_CONFIG_HOST_DIR`, `SIFT_MAILBOXES_ENV_FILE`, `SIFT_BACKUP_HOST_DIR`, `SIFT_PGDATA_VOLUME`. Only the owner controls that env and `compose.yaml` says to leave them unset; low risk, candidate for a future register row.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-04 | 55 unique (67 rows) | 55 (54 mitigated, 1 accepted) | 0 | gsd-security-auditor (ASVS L1, block_on high), verified against HEAD `71feccd` |

### Audit notes

- Mitigation evidence (file:line and test names) for every threat was recorded by the auditor; highlights: forced RLS + catalog gate (`packages/db/test/support/catalog.ts`, `catalog.test.ts`), raw-`sift_app` isolation proofs (`isolation.test.ts`, `owner-rls.test.ts`), scoped API (`scope.ts`, `scope.test.ts`), redaction (`core/src/log.ts`, `status.ts`), backup/migrate ordering (`owner/migrate.ts`, `migrate.test.ts`), worker role guard (`connect.ts`, `connect.test.ts`), secret sentinel (`no-secret-leak.test.ts`), Compose credential split (`compose.yaml`, `compose.test.ts`), supply chain (exact pins, `minimumReleaseAge`, frozen lockfile, SHA-pinned actions + Dependabot).
- `no-secret-leak.test.ts` (T-01-46) timed out in 2 of 3 runs at load average ~290–600; no leak assertion failed and the positive control passed. It passed in the 342/342 review-fix run. Re-confirm under normal load or in CI.
- Test gaps (not threat gaps): no alias-bomb regression test for T-01-14; no catalog-level negative test for object ownership (runtime guard covers it); `lint-guard.test.ts` does not probe `pg`/`drizzle-orm` imports (manual probe confirmed both blocked).
- Not observed: a GitHub Actions run (human verification item).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-04
