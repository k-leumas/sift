# Phase 1: Foundation and Isolation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-03
**Phase:** 01-foundation-and-isolation
**Areas discussed:** Schema scope now, Toolchain & runtime, Mailbox lifecycle, Isolation enforcement, Worker in Phase 1, Config file details

---

## Schema scope now

| Option | Description | Selected |
|--------|-------------|----------|
| All M1 tables, minimal cols | Create all M1 tables now with keys/timestamps; later phases add columns | ✓ |
| Full M1 schema now | Design all columns now | |
| Only a probe table | mailbox + one test table | |

| Question | Options | Choice |
|---|---|---|
| `mailbox` readable without `app.mailbox_id`? | Unscoped registry / RLS on mailbox / You decide | Unscoped registry |
| PK type | UUID(v7) / bigint identity / You decide | Free text: UUIDv7, plus unique `slug` and optional `display_name` on mailbox |
| pgvector in Phase 1 | Enable extension only / Image only | Enable extension only |
| Composite FKs incl. mailbox_id | Yes / Plain FKs / You decide | Yes |
| Mailbox delete | CASCADE / RESTRICT + soft disable / You decide | RESTRICT + soft disable |
| message columns before spike | Keys + timestamps / Obvious IMAP fields | Keys + timestamps |
| Timestamps | timestamptz UTC now() / You decide | timestamptz UTC now() |

---

## Toolchain & runtime

| Question | Options | Choice |
|---|---|---|
| Package manager | pnpm / Bun / npm | pnpm workspaces |
| Runtime | Node 24 / Node 22 / Bun | Free text: Node 26; Docker must use `.nvmrc` |
| Worker in container | Compiled JS / tsx / Native type stripping | Native type stripping |
| Test runner | Vitest / node:test / You decide | Vitest |
| Package consumption | Source .ts exports / Build to JS | Source .ts exports |
| Lint | Biome / ESLint+Prettier / You decide | Biome |
| Git hooks | commitlint + hook / Later | Free text: commitlint + lefthook |
| Postgres | 18 + pgvector / 17 + pgvector | 18 + pgvector |
| PG driver | pg / postgres.js / You decide | pg |
| tsconfig | Shared strict base / You decide | Shared strict base |
| Config validation | Zod / Valibot / You decide | Zod |
| CI | GitHub Actions / Local only | GitHub Actions |
| Migrations | drizzle-kit generate + committed SQL / Hand-written SQL | drizzle-kit generate |
| Base image | node slim non-root / alpine / distroless | Free text: `node:<nvmrc>-<debian codename>-slim` |
| Dev loop | Host + PG in Compose / All in Compose | Host + PG in Compose |
| Architecture | Build on target / Multi-arch CI | Build on target |
| pnpm pin | packageManager + corepack / You decide | packageManager + corepack |
| Logging | pino / console | pino |
| CLI | parseArgs / commander-citty / You decide | parseArgs |
| PG data | Named volume / Bind mount | Named volume |

---

## Mailbox lifecycle

| Question | Options | Choice |
|---|---|---|
| Registration | Reconcile on start / `sift mailbox add` / Both | Free text: startup reconcile handles safe changes, CLI handles risky ones |
| Removed from config | disabled_at, keep data / Refuse to start | disabled_at, keep data |
| When migrations run | Worker on start / One-shot migrate service / `sift migrate` by hand | Free text: one-shot `setup` service; `sift migrate` pg_dumps to ./backups/ only when migrations pending; keep advisory lock; rerun setup after editing config (documented next to config); dev runs migrate + config apply by hand with owner URL, worker with app URL |
| Missing password_env | Fail fast / Skip mailbox | Free text: fail fast, report every problem at once, name var never value, whitespace = empty, check before connecting |
| Safe vs risky changes | Auto add/update/disable + CLI rename/purge / Auto add/update / Auto add only | Option 1 plus guards: broken/empty config aborts with no change; slug disappears + another appears → stop and suggest rename unless `--confirm` |
| Config drift at worker start | Refuse + list differences / Warn | Refuse + list differences |
| Backup retention | Last 5 / All / You decide | Last 5 |
| pg_dump location | Setup container / Exec into db | Setup container |

---

## Isolation enforcement

| Question | Options | Choice |
|---|---|---|
| Roles | owner + app now, reader later / all three now | Option 1 plus catalog assertions: sift_app owns no table, no BYPASSRLS/superuser, RLS enabled+forced on scoped tables |
| Role setup | Setup creates app role / initdb script | Option 1, with: sift_owner can't be POSTGRES_USER |
| Bootstrap of sift_owner | initdb script / setup as superuser | initdb script, superuser unused after |
| Setting app.mailbox_id | withMailbox wrapper / session-level SET | withMailbox wrapper |
| Schema check | Catalog test / Static Drizzle check / Both | Catalog test |
| ISO-04 | Scoped helpers + review / + lint check / You decide | Free text: don't give app code a raw transaction at all; the API is the enforcement |
| Test DB | Throwaway DB per run / Testcontainers | Throwaway DB per run |
| Write tests | Include WITH CHECK / Reads+updates only | Free text: seven-case table (see CONTEXT D-48) |
| Scoped API shape | Per-table helpers / Hand-written repos / You decide | Per-table helpers as base + hand-written use-case functions in packages/db |
| Insert mailbox_id | Filled from scope / Caller passes | Filled from scope |
| mailbox privileges | SELECT only / SELECT + UPDATE status | Free text: SELECT only; add `mailbox_status` table for runtime state, scoped + RLS |
| Disabled mailbox in withMailbox | Throws / Allowed | Free text: withMailbox = isolation only; scheduler enforces disabled with registry recheck; `requireActive(scope)` on processing entry points |
| Test escape hatch | Test-only subpath / Tests connect as sift_app | Tests connect as sift_app directly |
| Unscoped allowlist | Explicit list in test / SQL COMMENT | Free text: explicit list, fail on stale entries, exempt tables get own assertions, `Record<string,string>` with non-empty reason |
| Grants | Explicit per migration / Default privileges | Explicit per migration |
| Policy shape | One FOR ALL TO sift_app / Per-command | Free text: one policy applied to both sift_app and sift_owner (FORCE RLS gotcha); append-only via grants |

---

## Worker in Phase 1

| Question | Options | Choice |
|---|---|---|
| Worker job | Scheduler skeleton + heartbeat / Idle / Exit 0 | Scheduler skeleton + heartbeat |
| Shutdown | Graceful SIGTERM/SIGINT / You decide | Graceful |
| Health | Heartbeat file / HTTP /healthz / None | Heartbeat file |
| Interval | 60 s configurable / You decide | 60 s configurable |
| Concurrency | Async loop per mailbox / Sequential | Free text: scheduler owns timing; each mailbox its own task when due; concurrent, fail independently; never overlaps itself (skip, don't stack) |
| Errors | Record + backoff / Crash | Record + backoff |
| DB down at start | depends_on + brief retry / Retry forever | Free text: retry only self-resolving errors (refused, host not found, 57P03) ~30 s then exit 1; fail immediately on 28P01, 3D000, 42501 |
| Heartbeat scope | Global supervisor tick / You decide | Global supervisor tick |

---

## Config file details

| Question | Options | Choice |
|---|---|---|
| Location | Repo root bind mount / ./data/config.yaml | Free text: separate from data/, mount a folder rather than a single file |
| Strictness | Strict / Warn | Strict |
| Sections | mailboxes + models + worker / Full README shape | Free text: plus `version`; use README names (`embeddings`, `provider`); drop confidence_threshold until `tiers`; extra_hosts + SIFT_MODELS_URL override; CI test parses the example |
| Slug rules | Proposed regex / You decide | Free text: no trailing/doubled hyphens with separate 1–40 length check; reserved all/new/settings/shared; reject don't fix; numeric slug hint; uniqueness |
| version key | Required = 1 / Optional | Required = 1 |
| IMAP fields | Shape only / You decide | Shape only |
| `sift config check` | Yes, no DB / No | Yes |
| Duplicates | Reject host+user+folder, allow shared env / Reject both | Option 1, plus Phase 2 spike note on Bridge address mode |

---

## Claude's Discretion

- Exact minimal column lists beyond keys/timestamps/mailbox_id
- DB-side `uuidv7()` default vs app-generated UUIDv7
- `updated_at` maintenance (trigger vs app)
- sift_owner privileges needed to manage sift_app
- Backoff caps, jitter, heartbeat path/staleness, shutdown timeout
- `.env` file layout and per-service variables
- Compose healthchecks, restart policies, dev port exposure

## Deferred Ideas

- Phase 2 spike: Bridge combined vs split address mode and how it maps to Sift mailboxes
- Cross-mailbox reader role — M2
- `tiers` config with thresholds — Phase 3
- Multi-arch image publishing — not in M1
