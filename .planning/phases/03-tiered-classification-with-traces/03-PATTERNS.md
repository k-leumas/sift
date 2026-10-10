# Phase 3: Tiered Classification with Traces - Pattern Map

**Mapped:** 2026-10-10
**Files analyzed:** 34 (new + modified)
**Analogs found:** 31 / 34

All analog paths below are git-tracked (verified with `git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/rules/schema.ts` (new) | model/validation | transform | `packages/core/src/config/schema.ts` | exact |
| `packages/core/src/rules/load.ts` (new) | utility | file-I/O | `packages/core/src/config/load.ts` | exact |
| `packages/core/src/yaml/*` (optional shared helper, extracted) | utility | transform | `packages/core/src/config/load.ts` lines 21-58, 96-138 | exact (extraction) |
| `packages/core/src/rules/hash.ts` (new) | utility | transform | none (canonical JSON + sha256) | no analog |
| `packages/core/src/classify/exact-rules.ts` (new) | service (pure) | transform | `apps/worker/src/ingest/message.ts` (`splitAddress`, pure parsing) | partial |
| `packages/core/src/classify/llm-output.ts`, `spans.ts`, `review.ts` (new) | model (Zod) | transform | `packages/core/src/config/schema.ts` | role-match |
| `packages/core/src/classify/prompt.ts`, `prompt-version.ts` (new) | utility | transform | none (see AI-SPEC) | no analog |
| `packages/core/src/classify/index.ts` + `package.json` exports `./classify` | config | - | `packages/core/src/config/index.ts`, `packages/core/package.json` exports | exact |
| `packages/core/src/config/schema.ts` (modify: `tiers.llm.confidence_threshold`, `DEFAULT_INITIAL_BACKFILL_DAYS` 30->3) | config | - | itself, `Ingest` block lines 119-137 | exact |
| `config/config.example.yaml`, `README.md` (modify) | config/docs | - | itself | exact |
| `packages/db/src/schema/scoped.ts` (modify: decision, rule_set columns, indexes) | model | CRUD | `folderSync` in same file lines 269-305, `messageLocation` partial index line 171 | exact |
| `packages/db/src/schema/prompt-version.ts` (new, unscoped) | model | CRUD | `packages/db/src/schema/mailbox.ts` | role-match |
| `packages/db/src/classify.ts` (new: recordDecision, ensureRuleSet, setBodyExpiry) | service | CRUD | `packages/db/src/ingest.ts`, `packages/db/src/status.ts` | exact |
| `packages/db/src/prompt-version.ts` (new) | service | CRUD (unscoped) | `packages/db/src/registry-read.ts` | exact |
| `packages/db/src/scope.ts` (modify: pendingClassification) | service | CRUD | `liveLocations` in `packages/db/src/ingest.ts` 381-399; scope API 60-133 | role-match |
| `packages/db/src/index.ts` (modify: exports) | config | - | itself | exact |
| `packages/db/migrations/0008` preflight (custom), `0009` generated, `0010` grants/RLS/triggers (custom), `meta/_journal.json` | migration | - | `0005_ingest_preflight.sql`, `0006_ingest_tables.sql`, `0007_ingest_tables_force_grants.sql` | exact |
| `packages/db/test/support/catalog.ts` (modify) | test support | - | itself lines 9-12, 309-323 | exact |
| `packages/db/test/classify.test.ts`, `catalog.test.ts` (new/mod) | test | CRUD | `packages/db/test/ingest.test.ts`, `status.test.ts` | exact |
| `apps/worker/src/classify/ollama-client.ts` (new) | service | request-response | `apps/worker/src/imap/connect.ts` (bounded external call, error classes) | partial |
| `apps/worker/src/classify/single-flight.ts` (new) | utility | event-driven | none | no analog |
| `apps/worker/src/classify/llm-tier.ts`, `run.ts`, `preflight.ts`, `refetch.ts` (new) | service | batch | `apps/worker/src/ingest/run.ts` + `ingest/db-store.ts` | role-match |
| `apps/worker/src/runtime/mailbox-batch.ts` (modify: classify after ingest; Ollama error in onBatchError) | service | batch | itself lines 294-416 | exact |
| `apps/worker/src/commands/classify.ts` (new: `sift classify <slug>`) | controller (CLI) | request-response | `apps/worker/src/commands/mailbox-backfill.ts` | exact |
| `apps/worker/src/command.ts` / `cli.ts` (modify: register command) | route | - | itself | exact |
| `apps/worker/src/commands/mailbox-rename.ts` (modify, D-07) | controller | - | itself | exact |
| `apps/worker/src/commands/config-check.ts` (modify, D-05) | controller | - | itself | exact |
| `apps/worker/test/support/fake-ollama.ts` (new) | test support | request-response | `apps/worker/test/support/fake-imap-server.ts` | role-match |
| `apps/worker/test/support/classify-harness.ts` (new) | test support | - | `apps/worker/test/support/mailbox-harness.ts` | exact |
| `apps/worker/test/fixtures/mail/hostile-*.eml`, `pair-*.eml` | fixture | - | `apps/worker/test/fixtures/mail/plain.eml` | exact |
| `apps/worker/test/classify-*.test.ts` | test | - | `mailbox-batch.test.ts`, `mailbox-ops.test.ts`, `no-secret-leak.test.ts` | exact |
| `data/mailboxes/example/rules.example.yaml` + `.gitignore` negation | config | - | `config/config.example.yaml` | exact |
| `packages/core/test/rules.test.ts`, `exact-rules.test.ts`, `prompt.test.ts`, example-rules test | test | - | `packages/core/test/config.test.ts`, `example-config.test.ts` | exact |

## Pattern Assignments

### `packages/core/src/rules/schema.ts` (Zod, strict)
**Analog:** `packages/core/src/config/schema.ts`. Copy: `z.strictObject` everywhere; named constants + a single message string reused in `min`/`max`; `unlessMissing(...)` for type errors so missing keys fall through to the loader's `REQUIRED` sentinel (lines 40-58 helpers `describe`, `unlessMissing`, `nonEmpty`).
```ts
// schema.ts lines 119-137
const initialBackfillDaysMessage = `initial_backfill_days must be a whole number of days from ${MIN_INITIAL_BACKFILL_DAYS} to ${MAX_INITIAL_BACKFILL_DAYS}`;
export const Ingest = z.strictObject(
  {
    initial_backfill_days: z
      .int({ error: unlessMissing(initialBackfillDaysMessage) })
      .min(MIN_INITIAL_BACKFILL_DAYS, initialBackfillDaysMessage)
      .max(MAX_INITIAL_BACKFILL_DAYS, initialBackfillDaysMessage)
      .default(DEFAULT_INITIAL_BACKFILL_DAYS),
    ...
  },
  { error: unlessMissing('ingest must be a mapping') },
);
```
Cross-field checks (label in categories, unique names case-insensitively, `in` without `phrase`): `superRefine(fn, { when: () => true })` (cerebrum learning, RESEARCH Pattern 1). Avoid `z.union`. `Version = z.literal(...)` at line 65 is the model for `version: 1`.

The same file is the modification target for D-20 (line 27 `DEFAULT_INITIAL_BACKFILL_DAYS = 30` -> 3) and D-25 (`tiers.llm.confidence_threshold`, follow `Models`/`Worker` strictObject at lines 171-200 with `.default(...)`). Update `packages/core/test/example-config.test.ts` line ~27 which asserts `initial_backfill_days: 30`.

### `packages/core/src/rules/load.ts`
**Analog:** `packages/core/src/config/load.ts` `parseConfigText` (lines 140-192) and `loadConfig` (195+). Same flow: `parseDocument(text, { lineCounter, prettyErrors: false })` -> YAML errors (first line only, no source text) -> empty doc issue -> `doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT })` in try/catch -> `safeParse` with the REQUIRED error map -> `zodIssues(...)` -> `.sort(byPosition)`. Return `{ ok: true, ... } | { ok: false, issues, source }` (`LoadResult` line 7). Skip the `literalSecrets` pre-pass. Extract `position`, `locate`, `locateKey`, `toPath`, `zodIssues`, `byPosition` (lines 21-58, 96-138) into a shared helper rather than copying. Issues render via `formatIssue` from `packages/core/src/config/errors.ts` line 28. Missing file = issue, not throw (loadConfig docstring).

### `packages/db/src/schema/scoped.ts` (decision, rule_set)
**Analog:** `folderSync` in the same file (269-305) for typed columns + `check(...)`; `messageLocation` line 171 for partial indexes. Current decision (236-255) and ruleSet (317-325) skeletons keep `id uuidv7`, `mailboxId()`, `timestamps()`, `unique('<t>_mailbox_id_id_key')`, `mailboxIsolation()`.
```ts
check('folder_sync_state_check', sql`${t.state} in ('ok', 'resyncing')`),
index('message_location_live_idx').on(t.mailboxId, t.folder).where(sql`removed_at is null`),
foreignKey({ name: 'decision_message_fk', columns: [t.mailboxId, t.messageId],
  foreignColumns: [message.mailboxId, message.id] }).onDelete('restrict'),
```
Add `decision_rule_set_fk` composite FK the same way against `ruleSet.mailboxId, ruleSet.id`; `spans: jsonb('spans').$type<Spans>()` like `lastResyncSummary` (line ~288); `uniqueIndex(...).where(sql\`trigger = 'worker'\`)`.

### `packages/db/src/schema/prompt-version.ts` + `packages/db/src/prompt-version.ts`
**Analog:** `packages/db/src/schema/mailbox.ts` (unscoped table) and `packages/db/src/registry-read.ts` (whole file):
```ts
export async function readRegistry(db: AppDb): Promise<RegistryRow[]> {
  const { orm } = internalsOf(db);
  return orm.select().from(mailbox).orderBy(asc(mailbox.slug));
}
```
`ensurePromptVersion(db, ...)` uses `internalsOf(db).orm` in a transaction with `pg_advisory_xact_lock(<fixed key>)`; pick a key distinct from `INGEST_LOCK_SEED = 815309` (`packages/db/src/lock.ts` line 19).

### `packages/db/src/classify.ts`
**Analog:** `packages/db/src/status.ts` and `packages/db/src/ingest.ts` — scope-based use-case functions, doc comment ends with "Runs in the caller's transaction (the scope)."
```ts
// ingest.ts 391-399
export async function liveLocations(scope: Scope, folder: string): Promise<LiveLocation[]> {
  const rows = await scope.messageLocation.find({ folder, removedAt: null });
  return rows.map((row) => ({ id: row.id, ... }));
}
```
Decision is append-only: expose through `AppendOnlyTableApi` (`scope.ts` line 104), not update. Body expiry uses `scope.messageBody.update(...)`.

### `packages/db/src/scope.ts` (pendingClassification)
Generic `ScopedTableApi` (lines 60-96) cannot express NOT EXISTS/keyset; add a dedicated method on `Scope` (interface line 120) implemented with the scope's tx, following how `MessageBodyApi.deleteExpired` (line 98-101) extends the generic API. SQL is in RESEARCH Pattern 3.

### Migrations 0008/0009/0010
**Analog:** `0005_ingest_preflight.sql` (custom preflight), `0006_ingest_tables.sql` (drizzle-generated), `0007_ingest_tables_force_grants.sql`:
```sql
ALTER TABLE "message_body" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_location", "message_body" TO sift_app;--> statement-breakpoint
CREATE TRIGGER message_body_set_updated_at BEFORE UPDATE ON "message_body" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
For `prompt_version`: `GRANT SELECT, INSERT` only, no RLS, no updated_at trigger. Decision/rule_set grants unchanged (append-only per D-40; rule_set check what 0004 granted). Register custom migrations in `meta/_journal.json`.

### `packages/db/test/support/catalog.ts`
```ts
// lines 9-12
export const CATALOG_ALLOWLIST: Record<string, string> = {
  'public.mailbox': 'unscoped mailbox registry: configuration, not mail-derived (D-06)',
  'drizzle.__drizzle_migrations': 'migration bookkeeping owned by sift_owner (D-37)',
};
// lines 309-323 expectedAppDml: add before `if (!scoped) return null;`
if (qualified === 'public.mailbox') { return new Set(['SELECT']); }
```
Add `'public.prompt_version'` entry + branch returning `new Set(['SELECT', 'INSERT'])`.

### `apps/worker/src/runtime/mailbox-batch.ts` (modify)
Classification runs inside the existing `withIngestLock(db, mailbox.id, async (session) => { ... })` (line 294), after the `switch (outcome.kind)` success arm (`synced`/`resynced`, ~line 357), via `session.run((scope) => ...)`. Error routing pattern in `onBatchError` (lines 392-412):
```ts
if (error instanceof MailboxSyncError) {
  ...
  await withMailbox(db, mailbox.id, (scope) =>
    connecting ? recordConnecting(scope, nowDate())
               : recordSyncError(scope, new Error(error.message), secrets, nowDate()));
  return;
}
```
Add a `ClassifyInfraError` branch the same way ("Ollama unreachable at <origin> (<code>)"). Copy `MailboxSyncError` class shape (line 56) and `ownerMessageFor` (116) for owner-facing text. Rules.yaml failure: `recordSyncError` with the formatted issues, ingest continues. Lock-busy is not an error (lines 413-417).

### `apps/worker/src/commands/classify.ts`
**Analog:** `apps/worker/src/commands/mailbox-backfill.ts` (366 lines). Copy: imports block (lines 1-35), `const COMMAND`/`export const USAGE` (36-37), `LOCK_WAIT_MS`/`LOCK_RETRY_MS` constants (43-46), a `Deps` interface with injectable `confirm(count): Promise<boolean>` (line 62), `withIngestLock(deps.db, row.id, ...)` retry loop (line 196), confirmation over threshold (line 216), `parseArgs` with `values, positionals` (line 289), stdin confirm with `MAX_LINE_CHARS` (352). Register in `apps/worker/src/command.ts`.

### `apps/worker/test/support/fake-ollama.ts`
**Analog:** `apps/worker/test/support/fake-imap-server.ts` (lines 1-50): a recording fake with an options interface, `port`, recorded request list accessor, `close(): Promise<void>`. Use `node:http` instead of `node:net`; record every request body so leak tests can assert the fence.

### Tests and fixtures
- `packages/core/test/example-config.test.ts` lines 1-17: `fileURLToPath(new URL('../../../config/config.example.yaml', import.meta.url))`, `loadConfig` then `if (!result.ok) throw ...` — copy for `data/mailboxes/example/rules.example.yaml`.
- `apps/worker/test/support/mailbox-harness.ts` -> `classify-harness.ts`.
- `apps/worker/test/no-secret-leak.test.ts` + `support/privacy-scan.ts` -> `classify-leak.test.ts`.
- `.eml` fixtures: copy header style of `apps/worker/test/fixtures/mail/plain.eml`; use `.example.test` domains only.

## Shared Patterns

### DB access
Apps only use `@sift/db` (Biome bans `pg`/`drizzle-orm` in `apps/**`). New DB functions take `scope: Scope` (scoped) or `db: AppDb` + `internalsOf` (unscoped).

### Status/error recording
**Source:** `packages/db/src/status.ts` lines 36-49 `recordSyncError(scope, error, secrets, at)` — redacts with `redactText` and truncates to 1000. Apply to Ollama-unreachable and rules.yaml errors.

### Owner-facing errors
Report every problem at once, with YAML path and line (`formatIssue`, `byPosition`); never echo input values; reject, never fix.

### Per-mailbox lock
`withIngestLock` (`packages/db/src/lock.ts` line 107) returns `{ acquired: false }` when busy; worker logs and skips, CLI retries then gives up.

### Dependencies
Exact pins in `package.json` (see `packages/core/package.json`: `"zod": "4.6.5"`), checked by `apps/worker/test/dependencies.test.ts`. Prefer `fetch` over an Ollama SDK.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/core/src/rules/hash.ts` | utility | transform | no canonical-JSON hashing exists; follow RESEARCH Pattern 4 |
| `packages/core/src/classify/prompt.ts` / `prompt-version.ts` | utility | transform | no prompt code yet; follow AI-SPEC (fence + nonce) |
| `apps/worker/src/classify/single-flight.ts` | utility | event-driven | no process-wide semaphore exists; follow AI-SPEC line ~838 |

## Metadata

**Analog search scope:** `packages/core`, `packages/db` (src, migrations, test), `apps/worker` (src, test)
**Files scanned:** ~20
**Pattern extraction date:** 2026-10-10
