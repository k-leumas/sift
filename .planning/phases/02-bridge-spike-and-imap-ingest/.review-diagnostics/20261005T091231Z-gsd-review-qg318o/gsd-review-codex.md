## 02-01

**Summary** — Strong foundational plan for introducing the Proton Bridge image and Compose services, but it has high blast radius because the current stack has no `bridge/` directory and Compose only knows `db`, `setup`, and `worker`.

**Strengths**
- Fits the current Compose shape: `worker` already has no Bridge dependency, which supports the plan’s “Bridge health is visibility only” approach ([compose.yaml](/Users/samuel/dev/sift/compose.yaml:72)).
- Correctly treats Compose tests as part of the contract; current tests assert the exact service set and will catch drift ([compose.test.ts](/Users/samuel/dev/sift/apps/worker/test/compose.test.ts:78)).

**Concerns**
- **HIGH:** adding an external `sift-bridge` volume can break existing smoke commands unless the plan updates `scripts/compose-smoke.sh`; it currently builds and starts the stack broadly ([compose-smoke.sh](/Users/samuel/dev/sift/scripts/compose-smoke.sh:173)).
- **MEDIUM:** current compose test typing only models service volumes as `string[]`; the later D-81 long-syntax bind mounts will need test type updates ([compose.test.ts](/Users/samuel/dev/sift/apps/worker/test/compose.test.ts:12)).

**Suggestions**
- Add a smoke-specific bridge volume setup before any `docker compose` invocation.
- Keep `bridge-init` out of default `up` with `profiles`, and add explicit compose tests for that.

**Risk Assessment** — **HIGH**, mainly because Compose changes can block all local development if the external volume path is wrong.

## 02-02

**Summary** — Good, scoped config expansion. The current schema has room for this but currently lacks every proposed TLS and ingest key.

**Strengths**
- Existing config schema is strict and centralized, so adding `imap.tls` and per-mailbox `ingest` is straightforward ([schema.ts](/Users/samuel/dev/sift/packages/core/src/config/schema.ts:61), [schema.ts](/Users/samuel/dev/sift/packages/core/src/config/schema.ts:88)).
- Registry drift should stay stable because registry identity currently uses only host, port, username, and folder ([schema.ts](/Users/samuel/dev/sift/packages/core/src/config/schema.ts:140)).

**Concerns**
- **MEDIUM:** `worker.poll_interval_seconds` already exists; the plan should avoid reintroducing it as if new ([schema.ts](/Users/samuel/dev/sift/packages/core/src/config/schema.ts:107)).
- **LOW:** README config examples are currently out of sync with the real schema and include future keys, so doc edits must be careful ([README.md](/Users/samuel/dev/sift/README.md:218)).

**Suggestions**
- Add schema tests for defaults: TLS mode `starttls`, missing pin allowed, ingest defaults 30/200.
- Add a config example assertion so `pin_sha256` appears in the right nested location.

**Risk Assessment** — **MEDIUM**, because the names become durable once accepted.

## 02-03

**Summary** — Necessary and mostly well-scoped schema work, but this is one of the riskiest plans because current tests insert minimal `message` and `folder_sync` rows that will break once NOT NULL columns are added.

**Strengths**
- Aligns with the existing RLS catalog discipline: scoped tables must have `mailbox_id`, forced RLS, grants, and composite mailbox keys ([catalog.ts](/Users/samuel/dev/sift/packages/db/test/support/catalog.ts:248)).
- Correctly follows the repo pattern of generated migrations plus custom RLS/grant migration ([0004_scoped_tables_force_grants.sql](/Users/samuel/dev/sift/packages/db/migrations/0004_scoped_tables_force_grants.sql:1)).

**Concerns**
- **HIGH:** existing tests insert bare `message(mailbox_id)` rows ([seed.ts](/Users/samuel/dev/sift/packages/db/test/support/seed.ts:63), [isolation.test.ts](/Users/samuel/dev/sift/packages/db/test/isolation.test.ts:176)); all must be updated in the same plan.
- **HIGH:** `folder_sync` is currently only id/mailbox/timestamps ([scoped.ts](/Users/samuel/dev/sift/packages/db/src/schema/scoped.ts:95)); adding required sync columns needs fixture updates.
- **MEDIUM:** custom migration snapshot/journal handling needs explicit verification against the existing Drizzle migration style ([drizzle.config.ts](/Users/samuel/dev/sift/packages/db/drizzle.config.ts:5)).

**Suggestions**
- Add a “minimal fixture update” checklist covering `seedScopedRows`, isolation tests, scope tests, and raw SQL inserts.
- Run catalog/isolation/scope tests immediately after the migration, not at the end of the wave.

**Risk Assessment** — **HIGH**, because schema changes touch core isolation guarantees and many tests.

## 02-04

**Summary** — Solid test infrastructure plan: Dovecot, SPKI pinning, and dependency install gates are the right foundation for later IMAP work.

**Strengths**
- Dependency install belongs here; current worker has no IMAP dependencies ([package.json](/Users/samuel/dev/sift/apps/worker/package.json:5)).
- The repo already enforces supply-chain constraints via `minimumReleaseAge` and build allow-list ([pnpm-workspace.yaml](/Users/samuel/dev/sift/pnpm-workspace.yaml:5), [pnpm-workspace.yaml](/Users/samuel/dev/sift/pnpm-workspace.yaml:10)).

**Concerns**
- **MEDIUM:** CI currently has no IMAP test-server setup step, so tests depending on Dovecot will fail unless CI workflow updates land with this or later ([ci.yml](/Users/samuel/dev/sift/.github/workflows/ci.yml:74)).
- **LOW:** apps tests may import test support, but app source cannot import `pg` or Drizzle; keep helpers in packages/db or test-only modules ([biome.json](/Users/samuel/dev/sift/biome.json:34)).

**Suggestions**
- Add a clear skip/fail policy: if `scripts/test-imap.sh up` was not run, tests should fail with an actionable message.
- Add license/tree checks as committed artifacts or tests, not just manual notes.

**Risk Assessment** — **MEDIUM**, mostly CI coordination risk.

## 02-05

**Summary** — `nudge()` and AbortSignal support fit the existing supervisor well, but shutdown behavior touches a carefully timed loop.

**Strengths**
- Current supervisor already has central scheduling and stop logic, so this is the right place for `nudge()` ([supervisor.ts](/Users/samuel/dev/sift/apps/worker/src/runtime/supervisor.ts:75)).
- Existing `runBatch` has no signal today, making the API change explicit and testable ([supervisor.ts](/Users/samuel/dev/sift/apps/worker/src/runtime/supervisor.ts:55)).

**Concerns**
- **MEDIUM:** `runMailbox` currently calls `deps.runBatch(entry)` with no cancellation channel ([supervisor.ts](/Users/samuel/dev/sift/apps/worker/src/runtime/supervisor.ts:211)); all callback tests need update.
- **MEDIUM:** stop currently clears timers and waits for active work, but does not abort in-flight work ([supervisor.ts](/Users/samuel/dev/sift/apps/worker/src/runtime/supervisor.ts:384)).

**Suggestions**
- Add tests for “nudge while running” and “abort stops between chunks, not mid-transaction.”
- Keep `nudge()` in-memory only, matching D-76.

**Risk Assessment** — **MEDIUM**, because subtle scheduling bugs can create overlapping ingest.

## 02-06

**Summary** — The scoped DB ingest API is the right layer for persistence. The main risk is adding generic upsert semantics without weakening the current explicit scoped helper model.

**Strengths**
- Apps are already forced through scoped DB APIs; app source imports from `pg`/Drizzle are banned ([biome.json](/Users/samuel/dev/sift/biome.json:34)).
- Current scoped API always adds explicit `mailbox_id` filters, matching ISO-04 ([scope.ts](/Users/samuel/dev/sift/packages/db/src/scope.ts:155)).

**Concerns**
- **MEDIUM:** current match logic only supports equality and null checks; removal and batch operations need a careful extension rather than ad hoc SQL ([scope.ts](/Users/samuel/dev/sift/packages/db/src/scope.ts:123)).
- **MEDIUM:** exposing a generic `upsert` on every scoped table may be too broad; append-only tables should stay append-only.

**Suggestions**
- Prefer narrow ingest use-cases over a fully generic public upsert where possible.
- Add tests proving superuser/no-RLS paths still filter by mailbox, like existing scope tests do ([scope.test.ts](/Users/samuel/dev/sift/packages/db/test/scope.test.ts:186)).

**Risk Assessment** — **MEDIUM**, because this becomes the write path for all ingest correctness.

## 02-07

**Summary** — Good separation of parsing, identity, and contracts. It is well aligned with the current absence of ingest code.

**Strengths**
- The plan’s pure functions fit the repo’s package split: app code can call core/db APIs without protocol logic leaking into DB.
- Identity work is necessary before schema and sync engine can be trusted; current `message` has no durable identity fields at all ([scoped.ts](/Users/samuel/dev/sift/packages/db/src/schema/scoped.ts:23)).

**Concerns**
- **HIGH:** identity fallback mistakes are one-way because `(mailbox_id, identity_key)` becomes the dedupe boundary.
- **MEDIUM:** header normalization must strip NULs before any Postgres write; otherwise one bad message can wedge a chunk.

**Suggestions**
- Add fixtures for duplicate Message-ID, missing Message-ID, Proton internal ID, malformed headers, and NUL bytes.
- Make `trustPmHeader` explicit in every identity call so non-Bridge mailboxes cannot trust forged Proton headers.

**Risk Assessment** — **MEDIUM-HIGH**, because identity bugs become persistent data bugs.

## 02-08

**Summary** — The Bridge init plan is thorough and security-conscious, especially around not printing passwords and failing closed on vault problems.

**Strengths**
- Correctly keeps credentials out of the normal worker service; current worker only receives `.env.mailboxes` via `env_file` ([compose.yaml](/Users/samuel/dev/sift/compose.yaml:88)).
- `.env.*` and `config/config.yaml` are already ignored, supporting the planned local-only secret flow ([.gitignore](/Users/samuel/dev/sift/.gitignore:68), [.gitignore](/Users/samuel/dev/sift/.gitignore:149)).

**Concerns**
- **HIGH:** this is operationally complex: GPG, pass, Bridge CLI, gRPC helper, bind-mounted env files, and backup files all have to work before ingest can start.
- **MEDIUM:** current compose smoke generation only creates `*_PASSWORD` variables, so passphrase setup must be added deliberately ([compose-smoke.sh](/Users/samuel/dev/sift/scripts/compose-smoke.sh:111)).

**Suggestions**
- Put as many file precondition checks as possible inside tests, especially mode 0600 and “backup file exists.”
- Keep helper output fixed-template only and test that no password-shaped value is printed.

**Risk Assessment** — **HIGH**, mostly due to fragile local setup and secret handling.

## 02-09

**Summary** — The read-only ImapFlow adapter is a good narrow layer, provided it keeps protocol guarantees like EXAMINE and BODY.PEEK testable.

**Strengths**
- Fits the planned architecture: protocol adapter separate from pure sync logic and DB store.
- The current repo has no IMAP source abstraction, so this plan creates a clean boundary rather than embedding ImapFlow in the worker loop.

**Concerns**
- **MEDIUM:** adapter tests must prove flags are unchanged, not merely rely on read-only intent.
- **MEDIUM:** UID/UIDVALIDITY are unsigned 32-bit-ish values; schema and TS conversions should avoid `integer` overflow.

**Suggestions**
- Add adapter tests for no `\Seen` changes, STARTTLS-required connection, UID range edge case, and body truncation.
- Keep ImapFlow logging disabled at construction.

**Risk Assessment** — **MEDIUM**, because protocol mistakes can silently alter mailbox state.

## 02-10

**Summary** — The sync-engine plan is strong: pure state machine, chunked transactions, generation resync, and a volume valve all match the phase goals.

**Strengths**
- Pairs well with existing supervisor batch model and planned AbortSignal.
- Correctly treats `folder_sync` as central state; the existing table is empty enough to extend cleanly ([scoped.ts](/Users/samuel/dev/sift/packages/db/src/schema/scoped.ts:95)).

**Concerns**
- **HIGH:** UIDVALIDITY resync and first-backfill interactions are complicated; tests need to cover crash/retry boundaries.
- **MEDIUM:** “new vs historical” must use INTERNALDATE even on normal UID polling, or Bridge cache rebuilds can ingest old mail.

**Suggestions**
- Add table-driven tests for first sync, first backfill slices, normal poll, removal diff, UIDVALIDITY change, and over-cap hold.
- Persist resync summary in a structured column or event table, not just logs.

**Risk Assessment** — **HIGH**, because this is where duplicate/missed mail bugs originate.

## 02-11

**Summary** — The probe plan is appropriately constrained: aggregate-only output, optional mutating label test, and reuse of the same connection path.

**Strengths**
- Raw reports under `data/` are protected by existing ignore rules ([.gitignore](/Users/samuel/dev/sift/.gitignore:157)).
- The CLI command framework already supports nested commands like `bridge probe` ([cli.ts](/Users/samuel/dev/sift/apps/worker/src/cli.ts:21)).

**Concerns**
- **MEDIUM:** a probe that touches real mail needs very strict confirmation behavior and fixed output.
- **LOW:** command registration must update CLI help tests, which currently only know Phase 1 commands ([cli.test.ts](/Users/samuel/dev/sift/apps/worker/test/cli.test.ts:16)).

**Suggestions**
- Keep label names generic in findings; hash or count anything that could identify mail.
- Add tests that probe reports do not include Subject/From/To-like fields.

**Risk Assessment** — **MEDIUM**, mostly privacy and real-mailbox side effects.

## 02-12

**Summary** — Ingest lock and status use-cases are well placed in `@sift/db`. The session-lock design matches the existing small connection pool risk.

**Strengths**
- Current default app DB pool is only 4 connections, so the plan’s “same client for lock and work” is important ([app-db.ts](/Users/samuel/dev/sift/packages/db/src/app-db.ts:46)).
- Status updates already centralize redaction and truncation ([status.ts](/Users/samuel/dev/sift/packages/db/src/status.ts:31)).

**Concerns**
- **MEDIUM:** `internalsOf` exists but is not a public package surface; lock/session APIs should hide it cleanly ([app-db.ts](/Users/samuel/dev/sift/packages/db/src/app-db.ts:133)).
- **MEDIUM:** `mailbox_status.state` currently rejects `connecting` and `needs_attention`; schema and code must land in order ([scoped.ts](/Users/samuel/dev/sift/packages/db/src/schema/scoped.ts:39)).

**Suggestions**
- Test “lock held by another process” with two AppDb instances.
- Add a status transition matrix test for ok/error/connecting/needs_attention/disabled.

**Risk Assessment** — **MEDIUM**, because concurrency bugs can duplicate ingest or wedge holds.

## 02-13

**Summary** — This is the main integration plan and it is correctly end-to-end. It also has the largest coordination risk because it ties config, locks, IMAP, ingest engine, status, and worker startup together.

**Strengths**
- Builds from the current no-op mailbox batch in the right place ([mailbox-batch.ts](/Users/samuel/dev/sift/apps/worker/src/runtime/mailbox-batch.ts:25)).
- Updates worker construction where callbacks are currently wired with only `(db, secrets)` ([worker.ts](/Users/samuel/dev/sift/apps/worker/src/commands/worker.ts:144)).
- Recognizes pool sizing; worker currently uses default max connections ([worker.ts](/Users/samuel/dev/sift/apps/worker/src/commands/worker.ts:114)).

**Concerns**
- **HIGH:** many failure modes map to owner-visible state; missing one can cause misleading mailbox status or supervisor backoff.
- **MEDIUM:** apps source must not import DB internals directly; the new `db-store.ts` must only use exported `@sift/db` APIs.

**Suggestions**
- Keep `ownerMessageFor` exhaustively typed by `ImapErrorClass`.
- Add one test where mailbox A fails and mailbox B succeeds, proving per-mailbox isolation.

**Risk Assessment** — **HIGH**, because this is the first real “mail to Postgres” path.

## 02-14

**Summary** — Good human-gated live spike plan. It respects privacy by keeping raw reports ignored and committing only aggregates.

**Strengths**
- ADR-0003 explicitly anticipated a Bridge spike addendum, so this is the right artifact to update ([0003-traces-and-mail-app-relabels.md](/Users/samuel/dev/sift/docs/adr/0003-traces-and-mail-app-relabels.md:81)).
- Raw prompt retention is still open in ADR-0003 and D-09 resolves it here ([0003-traces-and-mail-app-relabels.md](/Users/samuel/dev/sift/docs/adr/0003-traces-and-mail-app-relabels.md:64)).
- `data/` is ignored, which supports raw probe reports staying out of git ([.gitignore](/Users/samuel/dev/sift/.gitignore:157)).

**Concerns**
- **MEDIUM:** the plan depends on owner edits to ignored config and env files; failures may be hard for agents to reproduce.
- **MEDIUM:** findings privacy tests scan obvious patterns, but real identifiers can appear in less obvious strings.

**Suggestions**
- Add a manual checklist before committing: `git status --porcelain data/` empty and no personal labels in findings.
- Record owner approval level verbatim in the summary, as planned.

**Risk Assessment** — **MEDIUM**, because it touches a real mailbox but has good guardrails.

## 02-15

**Summary** — `sift bridge trust` is a strong owner-controlled trust workflow, and Renovate/CI coverage is a useful maintenance layer.

**Strengths**
- CLI registration fits the existing command table pattern ([command.ts](/Users/samuel/dev/sift/apps/worker/src/command.ts:24)).
- Workflow pinning expectations are already tested in CI workflow tests ([ci-workflow.test.ts](/Users/samuel/dev/sift/apps/worker/test/ci-workflow.test.ts:100)).
- Checkout pin style can mirror existing CI ([ci.yml](/Users/samuel/dev/sift/.github/workflows/ci.yml:42)).

**Concerns**
- **MEDIUM:** Renovate digest behavior for GitHub tags is an assumption; the build’s commit check is a good fail-safe but should be stated in the summary.
- **LOW:** command must not open an authenticated IMAP client; static grep for `openImap` is useful but not sufficient if imports are renamed.

**Suggestions**
- Add a test that `capturePeerCertificate` is called and no password env is read.
- Keep Renovate enabled managers limited to the custom regex manager.

**Risk Assessment** — **MEDIUM**, mostly due to Renovate behavior and trust UX.

## 02-16

**Summary** — The owner commands complete the ingest operations story. The design is good, but backfill has real concurrency and expectation risks.

**Strengths**
- Extends the existing owner registry/list path rather than inventing a separate UI ([registry.ts](/Users/samuel/dev/sift/packages/db/src/owner/registry.ts:224)).
- Current mailbox list renderer is simple and ready for the extra states/columns ([mailbox-list.ts](/Users/samuel/dev/sift/apps/worker/src/commands/mailbox-list.ts:9), [mailbox-list.ts](/Users/samuel/dev/sift/apps/worker/src/commands/mailbox-list.ts:62)).

**Concerns**
- **HIGH:** confirmed backfill intentionally bypasses the new-mail cap; count/confirmation and lock coverage must be airtight.
- **MEDIUM:** `listMailboxes` currently only returns status fields; adding message counts under RLS needs careful per-mailbox `set_config` handling ([registry.ts](/Users/samuel/dev/sift/packages/db/src/owner/registry.ts:240)).

**Suggestions**
- Hold the ingest lock from count through run, exactly as planned.
- Add tests that declined confirmation stores nothing and that rerun reports already-stored messages.

**Risk Assessment** — **MEDIUM-HIGH**, because owner-triggered uncapped ingest can be surprising if UX is wrong.

## 02-17

**Summary** — Essential documentation plan. The README is currently behind the Phase 2 design, so this closes a real usability and security gap.

**Strengths**
- Current README still describes Bridge as later work with the old command form, so the plan targets a concrete stale section ([README.md](/Users/samuel/dev/sift/README.md:424)).
- Existing user-facing text tests already scan for forbidden/deferred wording and command strings ([user-facing-text.test.ts](/Users/samuel/dev/sift/apps/worker/test/user-facing-text.test.ts)).
- Security/privacy docs need the Bridge token and body-cache story; current privacy text is much thinner ([README.md](/Users/samuel/dev/sift/README.md:311)).

**Concerns**
- **MEDIUM:** docs depend on 02-14 findings; if the live spike is read-only or incomplete, docs must not overstate Bridge behavior.
- **LOW:** adding bridge files to doc scans requires those files to exist before the test runs.

**Suggestions**
- Phrase spike-dependent docs as “for Proton Bridge v3.27.0, measured in M1” and link findings.
- Pin the exact D-37 sentence in tests, as planned.

**Risk Assessment** — **MEDIUM**, mainly stale-doc risk if implementation details shift.

## 02-18

**Summary** — This is the strongest security plan in the set. It directly tests the unusual certificate-capture exception at the wire level and makes the login connection fail closed.

**Strengths**
- Correctly accounts for Node TLS behavior: capture first, then use captured PEM as `ca` and re-check SPKI.
- Keeps the dangerous verification-off path isolated to one module with static tests.
- Supplies `openImap` and error classification needed by 02-13 and 02-15.

**Concerns**
- **HIGH:** the one verification-off exception is security-sensitive; the static test allowing it only in `capture.ts` is mandatory.
- **MEDIUM:** capture behavior around greetings without capability codes must stay conservative and tested; IMAP servers vary.
- **LOW:** `apps/worker/src/imap` does not exist yet, so command and test imports must be sequenced after 02-04 dependency install.

**Suggestions**
- Add regression tests for both STARTTLS and implicit TLS certificate swaps, as planned.
- Keep no filesystem imports in capture/connect to prove no trust state is persisted.

**Risk Assessment** — **MEDIUM-HIGH**, not because the design is weak, but because the boundary is security-critical.

## Cross-Plan Notes

The plans are broadly coherent and do achieve Phase 2’s goals: Bridge setup, known Proton behavior, idempotent ingest, status visibility, and docs. The biggest risks are sequencing and blast radius: 02-03 schema changes can break many existing tests, 02-08/02-01 can break Compose for everyone, and 02-13 is a dense integration step. I would treat 02-03, 02-08, 02-10, 02-13, and 02-18 as the high-attention plans.

One cross-cutting recommendation: after 02-03 lands, run the full DB isolation/scope/catalog suite before moving on. Current code has many minimal scoped-table inserts that depend on today’s tiny schema, and the repo’s strongest guarantee is mailbox isolation.
