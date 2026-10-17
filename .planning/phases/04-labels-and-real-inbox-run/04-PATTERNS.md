# Phase 4: Labels and Real-Inbox Run - Pattern Map

**Mapped:** 2026-10-17
**Files analyzed:** 30 (new + modified)
**Analogs found:** 28 / 30

All analog paths below are git-tracked source (checked with `git ls-files`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `apps/worker/src/imap/label-writer.ts` (new, D-28 gate) | service | IMAP write (request-response) | `apps/worker/src/spike/probe.ts` `labelTest` (559-640) | exact |
| `apps/worker/src/imap/connect.ts` (mod: `exec()` allowlist) | middleware | request-response | same file `guardPlaintext` (102-125) | exact |
| `apps/worker/src/labels/plan.ts` (new, pure reconcile) | utility | transform | `packages/db/src/classify.ts` `latestDecision` (213-226) + Research Pattern 1 table | partial |
| `apps/worker/src/labels/run.ts` (new, per-tick label step) | service | batch | `apps/worker/src/classify/run.ts` (constants 77-81, `classifyMailbox`) | role-match |
| `apps/worker/src/runtime/mailbox-batch.ts` (mod: call label step) | service | batch | same file `runBatch` (309-490) | exact |
| `apps/worker/src/labels/trace-format.ts` (new) | utility | transform | `apps/worker/src/commands/mailbox-list.ts` `table`/`status` renderers (40-70) | partial |
| `apps/worker/src/commands/labels.ts` (new) | controller (CLI) | request-response, owner role | `commands/mailbox-resume.ts` (whole) + `commands/classify.ts` confirm (225, 389-400, 520-530) | exact |
| `apps/worker/src/commands/trace.ts` (new) | controller (CLI) | read-only query | `commands/classify.ts` `parseClassifyArgs` (414-466), `parseDay` (402-412), `run` (473-537) | role-match |
| `apps/worker/src/commands/egress-relay.ts` (new) | service | streaming (TCP) | none (node:net forwarder) | no analog |
| `apps/worker/src/commands/mailbox-list.ts` (mod) | controller | request-response | same file `run` (78-107) | exact |
| `apps/worker/src/command.ts` (mod: register commands) | config | — | same file entries 52-78 | exact |
| `packages/db/src/labels.ts` (new scoped use-cases) | service | CRUD (append-only) | `packages/db/src/classify.ts` `recordDecision` (141-175), `ensureRuleSet` (186-205) | exact |
| `packages/db/src/trace.ts` (new scoped reads) | service | read | `packages/db/src/classify.ts` `latestDecision` | role-match |
| `packages/db/src/owner/registry.ts` (mod: `setLabelMode`, retry, counts) | service | CRUD, owner role | same file `resumeMailbox` (245-270), `listMailboxes` (290-327) | exact |
| `packages/db/src/schema/scoped.ts` (mod: `label`, `label_event`, new `label_action`) | model | — | same file `label` (223-237), `label_event` (424-431), `decision` checks (~343-351) | exact |
| `packages/db/src/schema/mailbox.ts` + `schema/index.ts` (mod: `label_mode`, table lists) | model/config | — | `schema/index.ts` 21-54 | exact |
| `packages/db/migrations/0012_labels_preflight.sql` | migration | — | `0008_classification_preflight.sql` | exact |
| `packages/db/migrations/0013_*.sql` (generated) | migration | — | `pnpm db:generate --name=...` | exact |
| `packages/db/migrations/0014_labels_grants.sql` | migration | — | `0004_scoped_tables_force_grants.sql`, `0010_classification_grants.sql` | exact |
| `packages/db/test/support/seed.ts`, `catalog.ts` (mod) | test support | — | existing files (catalog 375-387) | exact |
| `packages/core/src/config/schema.ts` (mod: `case_sensitive`) | config | — | same file `Labels` (148-152) | exact |
| `config/config.example.yaml`, README (mod) | config/docs | — | existing `labels.apply_as` block | exact |
| `compose.yaml` (mod: internal network, relay) | config | — | worker `extra_hosts` (111-112) | role-match |
| `bridge/entrypoint.sh` (mod: socat per IP) | config | — | same file 211, 238 | exact |
| `apps/worker/test/read-only-ingest.test.ts` (mod) | test | static | same file | exact |
| `apps/worker/test/imap-write-allowlist.test.ts` (new) | test | fake server | `apps/worker/test/imap-connect.test.ts` + `test/support/fake-imap-server.ts` | exact |
| `apps/worker/test/label-writer.test.ts`, `labels-run.test.ts` (new) | test | Dovecot integration | `apps/worker/test/imap-folder-source.test.ts`, `classify-run.test.ts` | role-match |
| `apps/worker/test/labels-cli.test.ts`, `trace-cli.test.ts` (new) | test | CLI | `apps/worker/test/classify-cli.test.ts`, `registry-cli.test.ts` | exact |
| `apps/worker/test/compose.test.ts`, `dependencies.test.ts`, new `network-call-sites.test.ts` | test | static | `compose.test.ts:246`, `read-only-ingest.test.ts` scanner | exact |
| `apps/worker/test/live-run-record.test.ts` + `04-LIVE-RUN.md` | test/doc | static | `apps/worker/test/live-ingest-record.test.ts` | exact |
| `apps/worker/test/egress-relay.test.ts` | test | unit | none close | no analog |

## Pattern Assignments

### `apps/worker/src/imap/label-writer.ts` (gate)

**Analog:** `apps/worker/src/spike/probe.ts` lines 559-640 (`labelTest`).

CREATE-if-missing, SELECT-only-for-COPY, COPYUID read (lines 592-605):
```typescript
const exists = (await client.list()).some((entry) => entry.path === labelPath);
let labelFolderCreated = false;
if (!exists) labelFolderCreated = (await client.mailboxCreate(labelPath)).created === true;

await examine(client, folder);
const original = await identityHeaderBytes(client, uid);
// Bridge (gluon) refuses COPY from an EXAMINEd mailbox ... SELECT the source for the COPY only
const source = await client.mailboxOpen(folder);
if (source?.path !== folder) return notConfirmed({ performed: false, labelFolderCreated });
const copy = await client.messageCopy(String(uid), labelPath, { uid: true });
const labelUid = copy === false ? undefined : copy.uidMap?.get(uid);
```
Removal guarded by UIDPLUS + read-write check (lines 625-632):
```typescript
if (labelUid === undefined || !inboxCopyAfterCopy || !client.capabilities.has('UIDPLUS')) {
  return notConfirmed(result);
}
const opened = await client.mailboxOpen(labelPath);
if (opened?.path !== labelPath || opened.readOnly === true) return notConfirmed(result);
const removedFromLabel = (await client.messageDelete(String(labelUid), { uid: true })) === true;
```
Adapt: replace `case_sensitive` list match; add Labels/ one-segment checks, recorded-copy-UID check, UIDVALIDITY compare, named `ImapWriteRefusedError` (code `SIFT_IMAP_WRITE_REFUSED`); never `mailboxClose()`; EXAMINE back after writes. Also reuse `identityHeaderBytes`/`examine`/`uidPresent` helpers from probe.ts (or move them to a shared imap module) for the presence check.

### `apps/worker/src/imap/connect.ts` (exec allowlist)

**Analog:** same file, `guardPlaintext` lines 102-125 — wrap `exec` the same way and install next to `guardPlaintext(client)` at line 152:
```typescript
function guardPlaintext(client: ImapFlow): void {
  const target = client as unknown as { run: RunFn };
  const run = target.run;
  target.run = (command: string, ...args: unknown[]) => {
    const name = command.toUpperCase();
    if (!client.secureConnection && !PLAINTEXT_COMMANDS.has(name)) {
      if (PLAINTEXT_SKIPPED.has(name)) return Promise.resolve(undefined);
      return Promise.reject(
        Object.assign(new Error(`refusing to send ${name} before TLS`), {
          code: 'SIFT_TLS_REQUIRED',
        }),
      );
    }
    return run.call(client, command, ...args);
  };
}
```
Set constants as module-level `Set`s like `PLAINTEXT_COMMANDS` (line 102). Error code style: `Object.assign(new Error(...), { code: 'SIFT_...' })`. Add a matching branch in `classifyImapError` (265) so the refusal maps to a fixed reason code.

### `apps/worker/src/labels/run.ts` + `runtime/mailbox-batch.ts`

**Analog:** `mailbox-batch.ts` `runBatch` 309-490 and `classify/run.ts`.
- Named tuning constants like `classify/run.ts:77-81` (`CLASSIFY_CHUNK_SIZE = 5`, `LLM_CALLS_PER_TICK = 25`) -> `LABEL_ACTIONS_PER_TICK`, `LABEL_ACTION_MAX_ATTEMPTS`.
- Lock: `withIngestLock(db, mailbox.id, async (session) => ... session.run(async (scope) => ...))` (339-345); a busy lock logs `info` and returns, no backoff (~460).
- Hook point: after the `classifyMailbox({...})` switch (467-490). Input bag style:
```typescript
const outcome = await classifyMailbox({
  db, mailbox: { id: mailbox.id, slug }, model: ..., runtime: classify, signal, log, now: nowDate,
});
switch (outcome.kind) { case 'done': ... case 'busy': case 'aborted': ... }
```
- Errors to owner: fixed templates via `ownerMessageFor` (119), never server text; `withMailbox(db, id, scope => recordSyncSuccess(scope, syncedAt, { notice }))` for notices (e.g. label conflict, D-12).
- IMAP open/close: `openImap`/`closeImap` from `imap/connect.ts` (129, 167).

### `apps/worker/src/labels/plan.ts`
Pure function over rows; current decision selection must match `packages/db/src/classify.ts:213-226` (`createdAt` desc then `id`). Implement Research Pattern 1 table verbatim; unit-test without DB (`SIFT_TEST_ADMIN_URL=`).

### `apps/worker/src/commands/labels.ts`

**Analog:** `commands/mailbox-resume.ts` (owner role, whole file) — parseArgs positional slug, `requireDatabaseUrl(io.env, 'SIFT_OWNER_DATABASE_URL')`, `redactText(message, secrets)`, exit codes 2 (usage) / 1 (error) / 0:
```typescript
({ positionals } = parseArgs({ args: [...args], options: {}, strict: true, allowPositionals: true }));
...
const ownerUrl = requireDatabaseUrl(io.env, 'SIFT_OWNER_DATABASE_URL');
const result = await resumeMailbox(ownerUrl, slug);
...
io.stderr(`${COMMAND}: ${redactText(message, secrets)}`);
```
Confirmation (D-05, D-19) copies `commands/classify.ts` 520-530 + `readLine` 389-400:
```typescript
confirm: async () => {
  if (parsed.yes) return true;
  io.stdout('Classify them? Type yes to continue:');
  const line = await readLine(io.stdin);
  return line !== null && line.trim().toLowerCase() === 'yes';
},
```
Inject `confirm`/`stdout` deps like `classifyCommand(deps)` (147) for testability. Register in `apps/worker/src/command.ts` like entries at 52-78 (`path`, `file`, `usage`).

### `apps/worker/src/commands/trace.ts`
**Analog:** `commands/classify.ts` — `parseClassifyArgs` (414-466) for flag parsing/mutual exclusion with discriminated `Parsed` union; `parseDay` (402-412) reuse for `--date`; UUID check `UUID.test(values.message)`; config/env loading + `createAppDb(url, { maxConnections: 2 })` + `finally db.close()` in `run` (473-537). Message-id normalisation: `normaliseMessageId` in `apps/worker/src/ingest/identity.ts:68-78`. Control-char escaping: reuse the Phase 3 helper exercised by `classify-control-chars.test.ts`.

### `apps/worker/src/commands/mailbox-list.ts`
Add a column or status suffix in `status(m)` / the `rows` array (90-99); `table()` helper (52-66) already aligns. The exhaustive `never` switch pattern (~42-45) should be used for label mode rendering.

### `packages/db/src/owner/registry.ts`
`setLabelMode` / `retryFailedLabels` copy `resumeMailbox` (245-270):
```typescript
return withOwnerClient(ownerUrl, (client) =>
  inTransaction(client, async () => {
    const { rows } = await client.query<{ id: string }>('select id from mailbox where slug = $1', [slug]);
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no mailbox with slug "${slug}"`);
    await client.query("select set_config('app.mailbox_id', $1, true)", [id]);
    ...
```
Counts in `listMailboxes` (290-327): add per-mailbox count queries inside the existing loop after `set_config` (pattern of the `messages` count query) and extend `MailboxListing`. Note MAILBOX_COLUMNS / `MAILBOX_SELECT` change for `label_mode`.

### `packages/db/src/labels.ts`
**Analog:** `packages/db/src/classify.ts` `recordDecision` (141-175): `scope.<table>.insert([...])`, destructure `[row]`, throw if undefined, jsonb through `wellFormed(stripNul(...))`, "Runs in the caller's transaction (the scope)" doc line. Export via `packages/db/src/index.ts`.

### Schema + migrations
- `label` stub (`scoped.ts:223-237`) — keep composite FK style `foreignKey({ name, columns: [t.mailboxId, t.messageId], foreignColumns: [...] }).onDelete('restrict')` and `mailboxIsolation()`; add `applied_by`, `owner_confirmed` with `check(...)` like `decision_outcome_check`.
- `label_event` stub (424-431) and new action table: add `unique('<t>_mailbox_id_id_key')`, composite FK to `decision(mailbox_id, id)`.
- Add new table to `SCOPED_TABLE_NAMES` and `APPEND_ONLY_TABLE_NAMES` (`schema/index.ts:21-38`).
- Preflight: copy `0008_classification_preflight.sql` loop:
```sql
DO $$ DECLARE box record; BEGIN
  FOR box IN SELECT id, slug FROM mailbox ORDER BY slug LOOP
    PERFORM set_config('app.mailbox_id', box.id::text, true);
    IF EXISTS (SELECT 1 FROM label) OR EXISTS (SELECT 1 FROM label_event) THEN
      RAISE EXCEPTION '...', box.slug;
    END IF;
  END LOOP;
  PERFORM set_config('app.mailbox_id', '', true);
END $$;
```
- Grants: copy `0004` lines (`ALTER TABLE ... FORCE ROW LEVEL SECURITY;--> statement-breakpoint`, `GRANT SELECT, INSERT ON ... TO sift_app;`, `CREATE TRIGGER <t>_set_updated_at BEFORE UPDATE ... EXECUTE FUNCTION set_updated_at();`) and `0010` (`REVOKE UPDATE, DELETE ON ...`). Decide whether `label` stays mutable (needs `removed_at` update) or becomes append-only.
- Update `seed.ts` and every scoped insert in the same task (Do-Not-Repeat 2026-10-10).

### `packages/core/src/config/schema.ts`
```typescript
export const Labels = z.strictObject({
  apply_as: z.enum(['proton_labels'], { error: unlessMissing('apply_as must be proton_labels') }),
});
```
Add `case_sensitive: z.boolean(...).default(false)`; fix hand-built `MailboxConfig` literals (`pnpm typecheck`), example config, `example-config.test.ts`, README YAML.

### Tests
- `read-only-ingest.test.ts`: `PROBE` exemption (line 14) becomes a set {probe, `imap/label-writer.ts`}; `expect(opens).toEqual(['imap/folder-source.ts: readOnly'])` (57) gains the gate. Reuse the `sources()` scanner (28-37) for `network-call-sites.test.ts`.
- `compose.test.ts:246` assertion moves from worker to relay service.
- `live-run-record.test.ts`: copy `live-ingest-record.test.ts` 1-30 (`privacyProblems`, `configDenylist`, `SECTIONS`, `section()`), pointing at `04-LIVE-RUN.md`.

## Shared Patterns

- **Error codes:** `Object.assign(new Error(msg), { code: 'SIFT_...' })` (connect.ts 118-122); store/log via `codedCause`; never server reply text (mailbox-batch `ownerMessageFor`).
- **Owner CLI:** `requireDatabaseUrl` + `redactText(message, secrets)` + exit 2/1/0 (mailbox-resume.ts).
- **Owner-role RLS reads:** `withOwnerClient` + `inTransaction` + `set_config('app.mailbox_id', id, true)` (registry.ts 79-100, 245-327).
- **Scoped app writes:** `withMailbox(db, id, scope => ...)`, `scope.<table>.insert/find/update` (classify.ts).
- **Count-confirm prompt:** `readLine` + `yes` + `--yes` flag (classify.ts 389-400, 520-530).
- **Named tuning constants:** classify/run.ts 77-81.
- **IMAP reads on EXAMINE only; SELECT only around the write** (probe.ts 596-603 comment).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `apps/worker/src/commands/egress-relay.ts` | service | streaming TCP | No socket server exists; use Research Pattern 6 (node:net, refuse https, counts-only logging); command file shape still follows `mailbox-resume.ts` |
| `apps/worker/test/egress-relay.test.ts` | test | unit | Use local `net.createServer` echo target |
| `compose.yaml` internal network + `models-egress` service | config | — | No internal networks yet; Research Pattern 6 sketch |

## Metadata

**Analog search scope:** apps/worker/src/{imap,spike,commands,classify,runtime}, apps/worker/test, packages/db/{src,migrations}, packages/core/src/config, compose.yaml
**Files scanned:** ~25
**Pattern extraction date:** 2026-10-17
