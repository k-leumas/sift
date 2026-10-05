# Phase 2: Bridge Spike and IMAP Ingest - Pattern Map

**Mapped:** 2026-10-05
**Files analyzed:** 34 (new + modified)
**Analogs found:** 27 / 34

All analog paths below are git-tracked (verified with `git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/db/src/schema/scoped.ts` (MOD: message identity cols, `message_location`, `message_body`, `folder_sync` watermarks, `mailbox_status` states) | model | CRUD | itself (`label`, `mailboxStatus`) | exact |
| `packages/db/src/schema/index.ts` (MOD: exports, `SCOPED_TABLE_NAMES`) | config | - | itself | exact |
| `packages/db/migrations/0005_*.sql` (generated) | migration | - | `packages/db/migrations/0003_scoped_tables.sql` | exact |
| `packages/db/migrations/0006_*.sql` (custom: FORCE RLS, grants, triggers) | migration | - | `packages/db/migrations/0004_scoped_tables_force_grants.sql` | exact |
| `packages/db/src/scope.ts` (MOD: `upsert` on unique target, set-valued match, new tables in `Scope`) | service | CRUD | itself (`mailboxStatusApi.upsert`, `scopedTable`) | exact |
| `packages/db/src/ingest.ts` (NEW use-cases) | service | CRUD/batch | `packages/db/src/status.ts` | exact |
| `packages/db/src/status.ts` (MOD: `connecting`, `needs_attention`, resume) | service | CRUD | itself | exact |
| `packages/db/src/lock.ts` (NEW: session advisory lock on dedicated client) | service | request-response | `packages/db/src/owner/migrate.ts` (lines 101-155) | role-match |
| `packages/db/src/index.ts` (MOD: re-exports) | config | - | itself | exact |
| `packages/db/test/support/seed.ts` (MOD) | test | - | itself lines 50-80 | exact |
| `packages/db/test/{isolation,catalog,scope}.test.ts` (MOD) | test | - | themselves | exact |
| `packages/core/src/config/schema.ts` (MOD: `initial_backfill_days`, new-message cap) | config | transform | itself (`Imap`, `Worker.poll_interval_seconds`) | exact |
| `config/config.example.yaml` + `packages/core/test/example-config.test.ts` (MOD) | config/test | - | themselves | exact |
| `apps/worker/src/command.ts` (MOD: new `COMMANDS` entries) | config | - | itself lines 24-67 | exact |
| `apps/worker/src/commands/mailbox-resume.ts` | controller (CLI) | request-response | `apps/worker/src/commands/mailbox-rename.ts` | exact |
| `apps/worker/src/commands/mailbox-backfill.ts` | controller (CLI) | batch | `mailbox-rename.ts` + `worker.ts` | role-match |
| `apps/worker/src/commands/mailbox-sync.ts` (optional) | controller (CLI) | request-response | `mailbox-rename.ts` | exact |
| `apps/worker/src/commands/bridge-trust.ts` | controller (CLI) | file-I/O | `mailbox-rename.ts` | role-match |
| `apps/worker/src/commands/bridge-probe.ts` (spike) | controller (CLI) | request-response | `mailbox-rename.ts` (arg/IO shape only) | partial |
| `apps/worker/src/commands/mailbox-list.ts` (MOD: new states, counts) | controller (CLI) | CRUD read | itself | exact |
| `apps/worker/src/runtime/mailbox-batch.ts` (MOD: lock -> connect -> ingest -> status) | service | batch | itself | exact |
| `apps/worker/src/runtime/supervisor.ts` (MOD: `nudge()`, grace) | service | event-driven | itself lines 205-300 | exact |
| `apps/worker/src/imap/connect.ts`, `pin.ts`, `folder-source.ts` | service (adapter) | streaming/request-response | none in repo | no analog (RESEARCH Pattern 4/5) |
| `apps/worker/src/ingest/{plan,identity,message,run}.ts` | utility (pure) | transform/batch | `apps/worker/src/runtime/backoff.ts` (pure fn style) | partial |
| `apps/worker/test/ingest-*.test.ts` (fake FolderSource) | test | - | `apps/worker/test/supervisor.test.ts` (harness + fakes) | role-match |
| `apps/worker/test/imap-adapter.test.ts` (Dovecot) | test | - | `apps/worker/test/compose-smoke.test.ts` | partial |
| `apps/worker/test/bridge-version.test.ts` | test | - | `apps/worker/test/node-version.test.ts` | exact |
| `apps/worker/test/lint-guard.test.ts` / negative grep for `rejectUnauthorized` false literal | test | - | `apps/worker/test/lint-guard.test.ts`, `user-facing-text.test.ts` | exact |
| `compose.yaml` (MOD: `bridge` service, volumes, worker cert mount) | config | - | itself (`db` service, `sift-pgdata` volume) | exact |
| `apps/worker/test/compose.test.ts` (MOD) | test | - | itself | exact |
| `scripts/compose-smoke.sh` (MOD: create `sift-bridge` volume) | config | - | itself (`SIFT_PGDATA_VOLUME` handling) | exact |
| `bridge/Dockerfile` | config | - | `Dockerfile` (root) | role-match |
| `bridge/entrypoint.sh`, `bridge/helper/main.go` | utility | - | none | no analog |
| `renovate.json` | config | - | none (`.github/dependabot.yml` is nearest) | no analog |
| `.env.example`, `.env.mailboxes.example`, `README.md`, `docs/adr/0003-*.md` addendum, `02-SPIKE-FINDINGS.md` | docs/config | - | themselves | exact |

## Pattern Assignments

### `packages/db/src/schema/scoped.ts` (model, CRUD)

**Analog:** itself. Helpers lines 13-21 (`mailboxId()`, `timestamps()`) reuse for every new table.

**Child table with composite FK to message** (lines 56-73) — copy for `message_location` and `message_body`:
```ts
export const label = pgTable(
  'label',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    mailboxId: mailboxId(),
    messageId: uuid('message_id').notNull(),
    ...timestamps(),
  },
  (t) => [
    unique('label_mailbox_id_id_key').on(t.mailboxId, t.id),
    foreignKey({
      name: 'label_message_fk',
      columns: [t.mailboxId, t.messageId],
      foreignColumns: [message.mailboxId, message.id],
    }).onDelete('restrict'),
    mailboxIsolation(),
  ],
);
```
Add `unique('message_location_mailbox_id_folder_uidvalidity_uid_key').on(t.mailboxId, t.folder, t.uidvalidity, t.uid)`; on `message` add `unique(...).on(t.mailboxId, t.identityKey)`. Use `bigint(..., { mode: 'number' })` for uid/uidvalidity (RESEARCH Pitfall 8).

**State as text + check, not pgEnum** (lines 34-53) — extend line 50:
```ts
check('mailbox_status_state_check', sql`${t.state} in ('ok', 'error', 'disabled')`),
```
Same text+check approach for `folder_sync.state` (`ok|resyncing`). Do NOT write the word `pgEnum` even in comments (cerebrum Do-Not-Repeat 2026-10-04).

`folder_sync` (lines 95-103) is keys-only today; add columns (folder, uidvalidity, last_uid, internal_date_watermark, generation, pending_generation, state, resync counts) + `unique(mailboxId, folder)`.

### `packages/db/src/schema/index.ts`
Lines 4-23: add new tables to the export list and to `SCOPED_TABLE_NAMES`. If `message_body`/`message_location` need restricted grants, mirror `APPEND_ONLY_TABLE_NAMES` (line 26).

### `packages/db/migrations/0006_*.sql` (custom)

**Analog:** `packages/db/migrations/0004_scoped_tables_force_grants.sql` (all 14 lines):
```sql
ALTER TABLE "folder_sync" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mailbox_status", "label", "folder_sync", "rule_set" TO sift_app;--> statement-breakpoint
CREATE TRIGGER folder_sync_set_updated_at BEFORE UPDATE ON "folder_sync" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
Each statement ends with `--> statement-breakpoint`. Check-constraint change for `mailbox_status_state_check` comes from the generated migration (drizzle diff), not hand SQL. Journal `when` must be newest (`packages/db/src/owner/migrate.ts` lines 92-98 refuses out-of-order).

### `packages/db/src/scope.ts` (service, CRUD)

**Analog for `upsert`:** `mailboxStatusApi.upsert` (lines 211-225):
```ts
async upsert(values: Partial<Omit<InferInsertModel<typeof mailboxStatus>, 'mailboxId'>>) {
  ctx.assertOpen();
  const set = definedEntries(values);
  if ('mailboxId' in set) throw new TypeError('Cannot set "mailboxId"');
  const onConflictSet = Object.keys(set).length > 0 ? set : { updatedAt: sql`now()` };
  const rows = await tx
    .insert(mailboxStatus)
    .values({ ...set, mailboxId })
    .onConflictDoUpdate({ target: mailboxStatus.mailboxId, set: onConflictSet })
    .returning();
```
Generalise into `scopedTable` (lines 147-189): every row gets `mailboxId` filled (line 159), `target` prepends `table.mailboxId`, forbid `mailboxId`/`id` via `FORBIDDEN_SET_KEYS` (line 112). Return `{ id, inserted: sql\`(xmax = 0)\` }` (RESEARCH A1).

**Match helper** (lines 123-136) is equality-only; add `inArray` support there or do set updates in `ingest.ts`. Register new tables in the `Scope` interface (lines 61-70) and in `withMailbox`'s frozen object (lines 275-283). `withMailbox` (lines 255-293) sets `app.mailbox_id` transaction-locally — the lock-client variant must do the same per chunk transaction.

### `packages/db/src/ingest.ts` (service, CRUD/batch)

**Analog:** `packages/db/src/status.ts` (whole file, 48 lines). Use-cases take `scope: Scope` first, optional `at: Date = new Date()` last:
```ts
import { redactText } from '@sift/core/log';
import type { Scope } from './scope.ts';

export async function recordSyncSuccess(scope: Scope, at: Date = new Date()): Promise<void> {
  await scope.mailboxStatus.upsert({ state: 'ok', lastError: null, lastSyncAt: at, lastSeenAt: at });
}
```
Error text stored in DB is redacted + truncated (lines 37-41, `LAST_ERROR_MAX = 1000`). Add `recordConnecting`, `recordNeedsAttention(count)`, `resumeMailbox` in `status.ts` in the same style. Strip `\u0000` from all strings before persistence (Pitfall 7).

### `packages/db/src/lock.ts` (service)

**Analog:** `packages/db/src/owner/migrate.ts` lines 101-155 — dedicated client, session lock, unlock in `finally`:
```ts
const client = new pg.Client({ connectionString: options.ownerUrl });
await client.connect();
let locked = false;
try {
  await client.query('select pg_advisory_lock($1)', [MIGRATE_LOCK_KEY]);
  locked = true;
  ...
} finally { ... if (locked) await client.query('select pg_advisory_unlock($1)', [MIGRATE_LOCK_KEY]); ... }
```
Differences: use `pg_try_advisory_lock($1::int, hashtext($2))` with a new constant class (key space distinct from `MIGRATE_LOCK_KEY = 815309001`, `CONFIG_APPLY_LOCK_KEY = 815309002` in `owner/registry.ts` line 20); take the client from the app pool via `internalsOf(db)` (`app-db.ts`), not a new owner connection; run chunk transactions on that same client (Pattern 6). Busy -> return "skipped", not throw.

### `packages/core/src/config/schema.ts` (config)

**Analog:** `Imap` (lines 61-67) and `Worker.poll_interval_seconds` (lines 107-120):
```ts
export const Imap = z.strictObject({
  host: nonEmpty('host'),
  port: Port,
  username: nonEmpty('username'),
  password_env: PasswordEnv,
  folder: nonEmpty('folder').default('INBOX'),
});
```
```ts
poll_interval_seconds: z
  .int({ error: unlessMissing(`poll_interval_seconds must be a whole number from ${MIN} to ${MAX}`) })
  .min(MIN, `poll_interval_seconds must be from ${MIN} to ${MAX}`)
```
`initial_backfill_days` = `.int(...).min(1).max(N).optional()` with the same message style; `strictObject` keeps unknown keys rejected. Update `config/config.example.yaml` (commented example) so `example-config.test.ts` still passes.

### `apps/worker/src/command.ts` + new CLI commands

**Registry** (lines 24-67) — add entries like:
```ts
{
  path: ['mailbox', 'rename'],
  file: 'mailbox-rename.ts',
  usage: 'sift mailbox rename <old-slug> <new-slug>',
  summary: 'Rename a mailbox slug, keeping its data',
},
```
Longest-prefix matching in `cli.ts` lines 22-32 means `['bridge','trust']`, `['mailbox','resume']`, `['mailbox','backfill']` work with no dispatcher change.

**Command module analog:** `apps/worker/src/commands/mailbox-rename.ts` (whole file, 52 lines):
```ts
import { parseArgs } from 'node:util';
import { redactText } from '@sift/core/log';
import { requireDatabaseUrl } from '@sift/db';
import type { CommandIO } from '../command.ts';

const USAGE = 'Usage: sift mailbox rename <old-slug> <new-slug>';

export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  let positionals: string[];
  try {
    ({ positionals } = parseArgs({ args: [...args], options: {}, strict: true, allowPositionals: true }));
  } catch (error) {
    io.stderr(`sift mailbox rename: ${error instanceof Error ? error.message : String(error)}`);
    io.stderr(USAGE);
    return 2;
  }
  ...
  const secrets = [io.env.SIFT_OWNER_DATABASE_URL].filter((s): s is string => s !== undefined && s.trim() !== '');
  try {
    ...
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sift mailbox rename: ${redactText(message, secrets)}`);
    return 1;
  }
}
```
Conventions: exit 2 usage, 1 failure, 0 ok; prefix errors with the command name; redact secrets (incl. IMAP password env values for backfill/probe); success line tells the owner the next step. Backfill uses `SIFT_DATABASE_URL` (app role) and must take the D-03 lock; `--days` flag via `options: { days: { type: 'string', default: '3' } }`. Probe must log counts/hashes only (Pitfall 13). Never mention purge (`user-facing-text.test.ts`).

### `apps/worker/src/runtime/mailbox-batch.ts` (service, batch)

**Analog:** itself (lines 25-60). Ingest goes where the comment at line 32 says:
```ts
async runBatch(mailbox: MailboxEntry): Promise<void> {
  await withMailbox(db, mailbox.id, async (scope) => {
    await recordMailboxSeen(scope);
    await recordSyncSuccess(scope);
  }, { requireActive: true });
},
async onBatchError(mailbox, error) {
  if (error instanceof MailboxDisabledError) { await withMailbox(db, mailbox.id, recordDisabled); return; }
  await withMailbox(db, mailbox.id, (scope) => recordSyncError(scope, error, secrets));
},
```
New flow: tryIngestLock -> (busy: log + return) -> requireActive -> connect -> ingest chunks (check `signal.aborted` between chunks) -> recordSyncSuccess. `onBatchError` branches: startup grace -> `connecting`; pin mismatch / auth rejected -> classified `error` text (D-33, D-41). Throwing keeps supervisor backoff (`backoff.ts`).

### `apps/worker/src/runtime/supervisor.ts` (`nudge()`)

**Analog:** `schedule()` lines 266-298 — per-mailbox `state.nextRunAt` and the running-map guard:
```ts
if (now() < state.nextRunAt) continue;
if (running.has(entry.id)) {
  // D-50: skip, do not queue. nextRunAt stays, so the next tick retries.
  log.debug({ mailbox: entry.slug }, 'skipped: previous run still in progress');
  continue;
}
runMailbox(entry, state);
```
`nudge(id)` = `state.nextRunAt = now(); wakeAt(now())` (wakeAt at line 335); never bypasses `running`. Add to the `Supervisor` interface (line 75). Test in `supervisor.test.ts` harness (fake clock, `batch` map, `never()` hung batch, lines 1-60).

### `apps/worker/src/ingest/*` (pure)

**Analog:** `apps/worker/src/runtime/backoff.ts` — pure exported function, injected randomness/clock, doc comment cites decision IDs:
```ts
/** Delay before the next attempt after `failures` consecutive failures (D-51): ... */
export function computeBackoff(failures: number, intervalMs: number, random: () => number): number {
```
Inject `now()` into plan/run the same way (supervisor deps pattern). No ImapFlow or `@sift/db` imports in `ingest/`; depend on a `FolderSource` interface + a store interface (RESEARCH Pattern 5). Identity code: RESEARCH "Code Examples".

### `bridge/Dockerfile`

**Analog:** root `Dockerfile` — header comment naming the drift test (lines 1-5), `ARG` pin at top, single `apt-get ... && rm -rf /var/lib/apt/lists/*` (lines 10-14), non-root `USER` (line 41). Body from RESEARCH Pattern 1, with the `# renovate:` comment directly above `ARG BRIDGE_VERSION` / `ARG BRIDGE_COMMIT`.

### `apps/worker/test/bridge-version.test.ts`

**Analog:** `apps/worker/test/node-version.test.ts` lines 1-40:
```ts
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
function read(file: string): string { return readFileSync(path.join(REPO_ROOT, file), 'utf8'); }
...
const defaults = [...read('Dockerfile').matchAll(/^ARG NODE_VERSION=(\S+)\s*$/gm)].map((m) => m[1]);
expect(defaults).toEqual([NVMRC]);
```
Assert `ARG BRIDGE_COMMIT=` is 40 hex and `ARG BRIDGE_VERSION=` matches `^v3\.\d+\.\d+$`, exactly one each.

### `compose.yaml`

**Analog:** `db` service (lines 21-43) and `volumes` (lines 115-119):
```yaml
    ports:
      # Loopback only. Never publish Postgres on all interfaces.
      - "127.0.0.1:${SIFT_DB_PORT:-5432}:5432"
    restart: unless-stopped
...
volumes:
  sift-pgdata:
    name: ${SIFT_PGDATA_VOLUME:-sift-pgdata}
```
Bridge: `${SIFT_BRIDGE_PORT:-1143}`, `${SIFT_BRIDGE_VOLUME:-sift-bridge}` + `external: true`, secrets via `${VAR:?set in .env}` (line 24 style). No `start_interval`, no top-level `name:` (header lines 12-13). Worker gets the cert volume `:ro` (line 88 style) and NO `depends_on: bridge`. Never write the wildcard bind literal in comments (cerebrum 2026-10-04). Update the header comment list of smoke-only variables (lines 15-18) and `scripts/compose-smoke.sh` to create the external volume.

## Shared Patterns

### Mailbox scoping
**Source:** `packages/db/src/scope.ts` `withMailbox` (lines 255-293), `requireActive` (lines 234-245)
**Apply to:** all ingest DB writes, backfill/resume commands. Apps import only `@sift/db` (Biome ban on `pg`/`drizzle-orm` under `apps/**/src`, enforced by `lint-guard.test.ts`).

### Error messages and redaction
**Source:** `packages/db/src/status.ts` lines 31-43; `mailbox-rename.ts` lines 36-50
**Apply to:** every CLI command, `recordSyncError`, Bridge error classes. Name variables, never values; suggest the fix (e.g. "run `sift bridge trust`").

### New scoped table checklist
**Source:** `scoped.ts` lines 56-73 + `0004_*.sql` + `schema/index.ts` lines 15-23 + `packages/db/test/support/seed.ts` lines 50-80 + `packages/db/test/catalog.test.ts`
**Apply to:** `message_location`, `message_body`. Seed currently inserts bare `message (mailbox_id)` (seed.ts line 63) — must add `identity_key` once NOT NULL.

### Test harness with fakes and injected clock
**Source:** `apps/worker/test/supervisor.test.ts` lines 1-60 (`harness()`, `vi.fn` loggers, fixed UUIDs)
**Apply to:** sync-engine tests with in-memory `FolderSource`, nudge tests.

### Repo-file assertion tests
**Source:** `apps/worker/test/node-version.test.ts`, `compose.test.ts`
**Apply to:** Bridge pin test, compose bridge-service assertions, negative grep for the disabled-TLS-verification literal.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/worker/src/imap/connect.ts` / `pin.ts` | adapter | request-response | No network client code yet; use RESEARCH Pattern 4 |
| `apps/worker/src/imap/folder-source.ts` | adapter | streaming | No IMAP code; RESEARCH Pattern 5 (use `fetchAll`, `readOnly: true`) |
| `apps/worker/test/imap-adapter.test.ts` (Dovecot) | test | - | Closest is `compose-smoke.test.ts` for container lifecycle only |
| `bridge/entrypoint.sh` | utility | - | RESEARCH Pattern 2 |
| `bridge/helper/main.go` | utility | request-response | No Go in repo; RESEARCH Pattern 3 |
| `renovate.json` | config | - | RESEARCH Code Examples (custom regex manager) |
| `02-SPIKE-FINDINGS.md` | docs | - | Aggregates only, per RESEARCH Spike probe design step 7 |

## Metadata

**Analog search scope:** `apps/worker/src`, `apps/worker/test`, `packages/db/src`, `packages/db/migrations`, `packages/db/test`, `packages/core/src/config`, `compose.yaml`, `Dockerfile`, `scripts/`
**Files scanned:** ~40
**Pattern extraction date:** 2026-10-05
