# Phase 4: Labels and Real-Inbox Run - Research

**Researched:** 2026-10-17
**Domain:** IMAP label application on Proton Bridge (gluon), an IMAP write gate, append-only action/label/event records, a trace CLI, Docker egress lockdown, and a supervised live run
**Confidence:** HIGH for the codebase and Bridge/gluon behaviour (read at the pinned commits); MEDIUM for Docker networking details on the owner's Docker Desktop; LOW for Proton's case handling of label names (not observable without a live probe, and the design avoids depending on it)

## Summary

Phase 3 already writes every decision with a `pending` action span, and the Phase 2 spike proved the label mechanics on Bridge v3.27.0: SELECT the source read-write, `UID COPY` into `Labels/<name>`, CREATE when missing, record COPYUID, and remove with `UID STORE +FLAGS (\Deleted)` plus `UID EXPUNGE` inside the label folder. Phase 4 needs no new npm packages. The work is: (1) a schema migration (label mode on the registry, a new append-only action-record table, real columns on the `label` and `label_event` stubs); (2) one IMAP write-gate module plus a connection-level command allowlist; (3) a per-tick label step after classification, under the ingest lock, that reconciles each message's current decision with Sift's own label state; (4) owner CLI (`sift labels ...`, `sift trace ...`) and `mailbox list` additions; (5) a Compose egress lockdown; and (6) the live run with its aggregates-only record.

Reading gluon at the commit Bridge v3.27.0 pins (`7e800978ab4a`) showed three behaviours the planner must design around. First, a `COPY` of a message that is **already** in the destination label does not fail and does not duplicate: gluon calls Proton's unlabel and then label, and gives the message a **new UID**. If Sift copied blindly, it would record that UID as its own and could later remove the owner's label. So the D-16 "already present" check must run before every COPY. Second, a `UID COPY` of a UID that no longer exists returns `OK` with **no COPYUID**, so "no COPYUID" can just mean the message moved away (D-17 and D-18 overlap). Third, Bridge treats `EXPUNGE` in Trash or Drafts as a permanent delete. ImapFlow also sends writes the gate does not list: `mailboxCreate()` sends `SUBSCRIBE` straight after `CREATE`, `mailboxClose()` sends `CLOSE` (an implicit expunge), and `messageDelete()` falls back to a plain `EXPUNGE` when UIDPLUS is missing. A static scan alone therefore cannot prove D-28. Wrap ImapFlow's single `exec()` funnel with a command allowlist, the same way `connect.ts` already wraps `run()` for the plaintext guard.

For egress (D-29), put the worker **only** on an `internal: true` Compose network, together with `db`, `bridge` and a small relay service built from the sift image (`sift egress-relay`). The relay is the worker's only route out and forwards TCP to the configured `models.url` host and port. Two traps: Bridge's socat binds only the **first** container IP (`hostname -i | cut -d' ' -f1`), so a Bridge on two networks needs one socat listener per IP. And Ollama returns 403 for a Host header that is not `localhost`, an IP or `*.internal`/`*.local`/`*.localhost` when Ollama listens on loopback, so the relay's name must end in `.internal`.

**Primary recommendation:** Build the label step as a decision-driven reconciler that runs under the ingest lock. Every mailbox write goes through one `label-writer.ts` gate, and a runtime `exec()` allowlist backs that gate up. Write an intent row before each COPY and an outcome row after it, in append-only tables. Check "already present" with `UID SEARCH HEADER X-Pm-Internal-Id` in the EXAMINEd label folder before any COPY. Keep label copies out of `message_location` in M1. Lock the worker down with an internal-only network plus a `.internal`-named relay.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
#### Label mode and switching
- **D-01:** Each mailbox has a label mode: `dry_run`, `apply` or `paused`. It is stored in the database and changed **only by CLI commands** (e.g. `sift labels dry-run|apply|pause|resume <slug>`; the planner sets the exact verbs within the P1 D-24 `parseArgs` style). There are no `config.yaml` keys for the mode and no worker restart is needed. The worker reads the mode from the DB on its next tick (about 60 s, like the registry reread, P1 D-49). The owner asked how switching would look and wanted it to take effect without a manual restart. — **Reversibility:** costly — the mode becomes per-mailbox DB state that `mailbox list`, the worker and the M2 UI all read.
- **D-02:** New mailboxes start in `dry_run`, and so does the existing `personal` mailbox when Phase 4 ships. Nothing is written to any mailbox until the owner runs the apply command.
- **D-03:** Every mode writes an action record. `dry_run` records "would label `<Category>`" (or "held for review: `<reason>`") with a timestamp and never touches IMAP. `apply` records what was actually done. The trace shows the history, e.g. `would label X (dry run, <time>)` and later `labelled X (applied, <time>)`. Action records are new append-only rows. The decision row and its Phase 3 `action` span (status `pending`) are never updated (P3 D-30).
- **D-04:** In `paused`, classification goes on: decisions are written and their actions stay pending. On resume they are applied, newest first, with the same pacing as D-07. Pause means "stop touching my mailbox", not "stop deciding".
- **D-05:** Switching from `dry_run` to `apply` also applies the decisions made during dry run. The command first shows a count per label (e.g. `N messages will be labelled: M in Labels/Newsletters, ...`) and asks for confirmation, like the P2 D-75 count prompt.
- **D-06:** Decisions that exist before Phase 4 ships (Phase 3 `pending` actions, e.g. the owner's 3-day backfill) are applied too once the mailbox is in `apply`. They count as part of the D-05 confirmation.
- **D-07:** Catch-up is bounded per tick: a fixed cap of label actions per mailbox tick (a code constant, about 50; the planner picks the number), newest INTERNALDATE first, so new mail is labelled promptly and Bridge isn't flooded (in the spirit of P3 D-18).
- **D-08:** Switching from `apply` back to `dry_run` or `paused` leaves the labels Sift already applied. There is no undo command in this phase.
- **D-09:** `sift mailbox list` shows each mailbox's label mode and counts, e.g. `labels: paused (N actions waiting)` and `N label actions failed`.

#### Label folders
- **D-10:** A missing `Labels/<Category>` folder is created with IMAP `CREATE` on first use (the spike proved this works), and the creation is recorded in `label_event`.
- **D-11:** A new config key, **`labels.case_sensitive`** (boolean, default `false`), goes in the mailbox's `labels` block next to `apply_as`. With `false`, an existing label whose name differs only in case (e.g. `newsletters` for category `Newsletters`) is reused. With `true`, the name must match exactly. The owner first suggested ignore-case, then chose the positive name `case_sensitive` over `ignore_case` and `strict_casing`. Extend the strict schema, `config/config.example.yaml`, its CI test and the README. — **Reversibility:** one-way — strict config makes the key name part of every owner's config (P3 D-25 precedent).
- **D-12:** With `case_sensitive: true`, an existing label that differs only in case holds that category's actions and reports the conflict: actions stay pending, and `mailbox list` names both, e.g. `label conflict: category Newsletters vs existing Labels/newsletters — rename one or set case_sensitive: false`. Other categories keep flowing. Research must check whether Proton/Bridge allows two labels that differ only in case (if it refuses the CREATE, this path applies).
- **D-13:** An existing label with a matching name, even one the owner made, is reused. Only messages Sift copied there (recorded copy UIDs) count as Sift's. The owner's own labelled mail in that folder is never touched, removed or recorded as Sift's.

#### Re-runs and edge cases
- **D-14:** A `sift classify` re-run (P3 D-17) that gives a labelled message a different category **moves Sift's label**: remove Sift's old copy by its recorded copy UID, apply the new label, and record both in `label_event`. A message carries at most one Sift label. Labels the owner added are never removed.
- **D-15:** A re-run that sends an already-labelled message to review removes Sift's old label, because the latest decision is current and review means no Sift label.
- **D-16:** If the message is already in `Labels/<Category>` (the owner put it there) and the decision agrees, Sift does not COPY. The action record says `already present, not applied by Sift`, so Sift never owns the owner's label or removes it later. (How "already present" is detected is the planner's choice, e.g. by identity in the label folder.)
- **D-17:** A failed COPY (Bridge says `NO`, the connection drops, or no COPYUID comes back) stays pending and is retried on later ticks. After a few failed ticks (code constant, e.g. 3) the action is recorded as `failed` with the reason, and `mailbox list` shows the count. A COPY without COPYUID is unconfirmed: resync the label folder before any retry so no duplicate is made (spike).
- **D-18:** If the message has no live location in an ingested folder when its action comes up (the owner moved or deleted it), the action is recorded as `skipped: message no longer in INBOX` (wording is the planner's). Sift never follows a message into other folders or Trash.
- **D-19:** `sift labels retry <slug>` puts failed actions back to pending after a count confirmation.

#### Trace lookup (TRC-05)
- **D-20:** `sift trace <slug>` supports both search and exact lookup. Search uses `--subject`, `--from` and `--date`: one match prints its trace, several print a short numbered list (date, from, subject, outcome) to narrow down. Exact lookup uses `--message-id '<...>'` (the header value from Proton's "View headers") or `--id <sift id>`. Subject, from address/domain and dates are already columns on `message`.
- **D-21:** The default output is the README "Decision traces" tree, one line per tier, ending with the Action line that shows what actually happened (dry run / applied / already present / held / skipped / failed, and when), plus the versions line. `--json` prints the raw decision, spans, action records and `label_event` rows.
- **D-22:** By default the latest (current) decision is shown, with one line such as `earlier decisions: 2 (use --all)`. `--all` prints every decision oldest to newest, with the label moves between them.
- **D-23:** The full trace is printed, including the LLM reason and raw output, with control characters escaped as in Phase 3. It is the owner's data on the owner's machine.
- **D-24:** The exact-rules span is shown with condition summaries from the rule_set snapshot (e.g. `domain acme.com ✓, phrase "invoice" ✗ → Billing`) and the rule-set version. Judgment rules are shown one line each, truncated.
- **D-25:** When the mailbox's current rule set differs from the one the decision used, the trace adds one hint line, e.g. `rules changed since this decision (r7 → r9); sift classify --message <id> to re-run`. Nothing is re-run automatically.
- **D-26:** There is no decision-listing command. The README gets copy-paste `psql` recipes, like the existing outcome count: held (review) messages with date, from, subject and reason, newest first, plus one query that fetches a single message's spans. The owner chose SQL over a `sift decisions` command; the review queue is M2.
- **D-27:** Nothing from a trace is ever written into the mailbox (TRC-05, ADR-0003).

#### Safety guarantees (ACT-05, SEC-02)
- **D-28:** One module issues all IMAP writes. It allows only `CREATE` under `Labels/`, `UID COPY` into `Labels/` from a read-write SELECTed source, and `UID STORE +FLAGS (\Deleted)` + `UID EXPUNGE` of a copy UID Sift itself recorded, inside a label folder (never a plain EXPUNGE, never INBOX). Anything else throws a named error, which is logged and put in the action record. CI asserts that no other code path can issue IMAP write commands. The live run reports a count of IMAP write operations. — **Reversibility:** costly — every later mailbox-writing feature (M2 relabel handling) must go through this gate.
- **D-29:** Egress is shown in two ways. **Lockdown:** Compose limits the worker's network reach to db, bridge and the configured Ollama host (the worker currently reaches Ollama via `host.docker.internal:host-gateway`; research how to allow only that on Docker/OrbStack/Linux). A test proves an outside address is refused, and CI checks there are no telemetry or analytics dependencies. **Observation:** a capture of the worker's outbound connections during the live run, recorded as a summary in 04-LIVE-RUN.md.
- **D-30:** Problems are tracked locally only: worker logs (`docker compose logs worker`, secrets redacted, no email content), `mailbox list` status, traces, action records, `label_event` and the healthcheck. A blocked network call or IMAP command must fail loudly with a specific logged error, never silently. There is no remote error reporting. The owner asked "how will we ever track problems with this approach?", and this is the answer they accepted.

#### Real-inbox acceptance (E2E-01)
- **D-31:** A short supervised session on `personal`: start in `dry_run`, sample and read traces, switch to `apply` (the D-05 confirmation), watch the backlog land in the Proton client, and see a handful of new emails labelled live. It takes a few hours, not days.
- **D-32:** About 20 decisions are sampled, stratified by a script across exact-rule labels, LLM labels and review holds (including low confidence). The owner confirms that each trace explains the outcome. **Every** sampled decision must be explainable from its trace, and any unexplained one is a Phase 4 gap to close. A wrong label that the trace explains still passes, because label quality is M2/M4.
- **D-33:** Results go in `.planning/phases/04-labels-and-real-inbox-run/04-LIVE-RUN.md` as aggregates only, like 02-SPIKE-FINDINGS / 02-LIVE-INGEST: counts per outcome and tier, sample verdicts (explained yes/no + tier), label actions applied/skipped/failed, IMAP write-op counts and the egress capture summary. No subjects, senders, addresses or label names other than the categories.

### Claude's Discretion
- Exact CLI verbs and flags for D-01/D-19/D-20, and the exact `mailbox list` wording.
- Table shapes for action records, `label` and `label_event` (both tables exist as Phase 1 key-only stubs). Append-only grants follow P1 D-40. Echo-suppression data (COPYUID) per the spike.
- Per-tick action cap, retry count, and how "already present" is detected.
- `sift trace` search matching (the owner said "you decide"): suggested case-insensitive substring for `--subject`, address-or-domain for `--from`, `--date` as the received day, newest first, a capped list.
- How the egress lockdown is built and tested, and the capture tool used in the live run.
- Plan split and wave ordering.

### Deferred Ideas (OUT OF SCOPE)

- `sift diagnose`: an owner-run command that bundles redacted logs, status and versions into one file to share when asking for help. Later milestone.
- `sift labels undo <slug> [--since]`: remove Sift's own labels in bulk (raised as an option, not chosen for this phase).
- A `sift decisions` listing command: the owner chose documented SQL for M1, and the review queue is M2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACT-01 | A confident decision applies the category as a label in the way the spike found to work (`Labels/` folder), and the action span records what was done and when | Write gate (Pattern 2); label step (Pattern 1); intent/outcome records (Pattern 3); gluon re-COPY behaviour (Pitfall 1); action-record table (Data model) |
| ACT-02 | Review decisions get no label; the action span records review and why | Label step: a `review` decision writes a `held` action record with `decision.review_reason` and makes no IMAP call unless Sift's own old label must be removed (D-15) |
| ACT-03 | Every mailbox change is recorded in `label_event` (echo suppression) | The gate writes a `label_event` row for every CREATE, COPY and removal, with the label-folder UIDVALIDITY and copy UID; intent rows close the crash window (Pattern 3) |
| ACT-04 | `label` row records Sift-applied, not owner-confirmed | `label` columns `applied_by` = 'sift' and `owner_confirmed` = false, plus a CHECK (Data model) |
| ACT-05 | Never send, delete, forward or modify content; IMAP limited to reading and applying/removing own labels | Static scan (extend `read-only-ingest.test.ts`) plus the runtime `exec()` allowlist (Pattern 2); never `CLOSE`; never EXPUNGE outside `Labels/` (Pitfalls 2-4) |
| TRC-05 | Full trace from CLI or documented SQL; nothing written into the mailbox | `sift trace` (Pattern 5); README psql recipes; the gate has no APPEND path and the allowlist refuses APPEND |
| SEC-02 | No content, prompt or trace sent anywhere but the model URL; no telemetry | Internal network plus relay (Pattern 6); telemetry denylist in `dependencies.test.ts`; network call-site allowlist test; live-run egress capture |
| E2E-01 | One real Proton mailbox labelled end to end; sampled decisions explainable from traces | Live-run protocol (Pattern 7); stratified sample SQL; `04-LIVE-RUN.md` with a privacy-scan test like `live-ingest-record.test.ts` |
</phase_requirements>

## Project Constraints (from CLAUDE.md / OpenWolf / cerebrum)

- OpenWolf: check `.wolf/anatomy.md` before reading files; check `.wolf/cerebrum.md` Do-Not-Repeat before generating code; after edits, update anatomy and append to `.wolf/memory.md`; log bugs to `.wolf/buglog.json`.
- Commit messages: lines ≤ 100, and the subject must not start upper-case (commitlint via lefthook); never `--no-verify`; commit with an explicit pathspec (`git commit -- <files>`), never `gsd query commit`.
- DB: every scoped table needs FORCE RLS, a `mailbox_id` FK, the one standard policy, grants and a `set_updated_at` trigger (catalog test), or a CATALOG_ALLOWLIST entry. App code goes through `withMailbox` scopes, never raw SQL. Use `codedCause` for logged or stored errors. Bind lists with `sql.param(array)`. Custom migrations need `--> statement-breakpoint`. `pnpm db:generate --name=x` handles schema changes.
- A schema-change task must update `seed.ts` and every scoped insert in the same task (Do-Not-Repeat 2026-10-10).
- Anything bound for jsonb needs `wellFormed(stripNul(...))` (03-25/03-26 learning).
- Strict Zod config: a new key needs the schema, `config/config.example.yaml`, its CI test (`example-config.test.ts`) and the README; a `.default()` key is required in `z.output`, so hand-built `MailboxConfig` literals must include it (`pnpm typecheck` finds them).
- Docs tests: `apps/worker/test/user-facing-text.test.ts` pins README/CONTRIBUTING commands and owner lines against the code that prints them. README Technical settings YAML must parse via `loadConfig`. Quick-start step shape rules (cerebrum 2026-10-12).
- Commands for the owner to paste must be single-line (e.g. `psql -Atc "..."`), never heredocs. UAT checkpoints give copy-paste commands plus the exact expected output.
- Logs carry no mail content and no secrets. Owner-facing messages are fixed templates and never carry server replies (mailbox-batch.ts `ownerMessageFor`, T-02-43).
- Tests: `pnpm test` needs Docker (sift-db-1) plus `scripts/test-imap.sh up` (Dovecot :31143). Pure tests: `SIFT_TEST_ADMIN_URL= pnpm exec vitest run <files>`. Never `vitest run test/` (matches apps too). Tests must never hit the real Ollama port (use 127.0.0.1:9). Negative acceptance greps scan comments too, so never write forbidden literals in comments.
- `@sift/worker` has no `pg` dependency, and apps cannot import drizzle-orm. New DB access goes in `@sift/db`.
- Owner preferences: fail closed, append-only, no automatic reclassification, local observability, rare events logged with counts, tuning values as named constants.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Label mode (dry_run/apply/paused) | Database (mailbox registry, owner-written) | CLI (`sift labels ...`, owner role) | Owner-controlled configuration that the worker only reads, like the rest of the registry (P1 D-06). sift_app cannot switch itself to `apply` |
| Deciding what to do per message (reconcile) | Worker label step (`apps/worker/src/labels/`) | `@sift/db` scoped query (pending work) | Pure planning over DB state; no IMAP needed in dry_run |
| Issuing mailbox writes | Worker IMAP gate (`apps/worker/src/imap/label-writer.ts`) | Connection allowlist (`imap/connect.ts`) | D-28: a single choke point; the allowlist catches ImapFlow's hidden writes |
| Recording actions/events/labels | Database (`@sift/db` use-cases, append-only tables) | — | ACT-03/04, P3 D-30; append-only grants enforce it |
| Trace lookup | CLI (`sift trace`, read-only scope) | README psql recipes | TRC-05; the owner's data on the owner's machine |
| Mailbox list counts | `@sift/db/registry` (owner role, per-mailbox `set_config`) | CLI rendering | Same pattern as `listMailboxes` |
| Egress restriction | Compose (internal network) | Relay service (`sift egress-relay`) | Enforced by the network, not by code discipline |
| Egress observation | Owner-run capture (in-container `/proc/net/tcp` sampler) | Relay connection log counts | D-29 observation half |

## Standard Stack

### Core (all already in the repo; no new packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | 2.1.0 (exact pin, `APPROVED_DEPENDENCIES`) | `mailboxOpen`, `messageCopy` (returns `uidMap`/`uidValidity` from COPYUID), `messageFlagsAdd`, `messageDelete`, `mailboxCreate`, `search({header})`, `list()` | Already the worker's IMAP client; the spike's label path uses these exact calls `[VERIFIED: node_modules/.pnpm/imapflow@2.1.0 dist/esm/commands/copy.js, expunge.js, create.js read this session]` |
| drizzle-orm | 0.45.3 | Schema plus `pnpm db:generate` migrations | Project standard `[VERIFIED: packages/db/package.json]` |
| pg | 8.23.0 | Owner-role registry operations (`@sift/db/registry`) | Project standard `[VERIFIED: packages/db/package.json]` |
| zod | 4.6.x | Config `labels.case_sensitive`; trace JSON shapes | Project standard (cerebrum: Zod 4.6) |
| node:net (built-in) | Node 26.10.0 | `sift egress-relay` TCP forwarder | No dependency; same image |
| vitest | 5.0.2 | Tests | `[VERIFIED: package.json:29]` |

### Supporting (test infrastructure already present)
| Tool | Purpose | When to Use |
|------|---------|-------------|
| Dovecot 2.4.5 (`scripts/test-imap.sh`, '/' separator) | Real COPY/COPYUID/UID EXPUNGE/CREATE for gate integration tests | Gate and label-step integration tests. Dovecot **accepts** COPY from EXAMINE and **duplicates** on re-COPY (unlike gluon), so tests must assert Sift's own behaviour, not rely on the server |
| `apps/worker/test/support/fake-imap-server.ts` | Records every byte a client sends | Proving the allowlist refuses a command **before** it reaches the wire |
| `apps/worker/test/support/privacy-scan.ts` | Aggregates-only document checks | `04-LIVE-RUN.md` record test |
| `scripts/compose-smoke.sh` | Full-stack smoke (CI job `compose-smoke`) | Dynamic egress test (outside address refused from the worker) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-message presence check with `UID SEARCH HEADER` | Fetch the whole label folder's `X-Pm-Internal-Id` set per tick | The fetch costs one call per tick but scales with folder size (owner labels can hold thousands); SEARCH is bounded by the per-tick cap. Keep the folder snapshot for M2 relabel detection |
| Relay with a `.internal` alias plus worker transport-URL rewrite | Give the relay the alias `host.docker.internal` on the internal network (no code change) | The alias trick works only when `models.url` uses `host.docker.internal` (true for the owner today) and depends on Docker DNS precedence. The rewrite works for any http `models.url` |
| Label mode on `mailbox` (registry) | A new scoped table or `mailbox_status` columns | Scoped tables are worker-writable, so a compromised worker could flip itself to `apply`. The registry is SELECT-only for sift_app. Cost: a deliberate `MAILBOX_COLUMNS` catalog change |
| Sift copy UIDs in `label`/`label_event` | Also insert a `message_location` row for the label copy (spike note) | The existing liveness queries use **any** folder, and label folders are never diffed in M1, so a moved/deleted message would look live forever and its body would never be orphan-deleted (Pitfall 6) |

**Installation:** none. Phase 4 adds no npm packages and no images (the relay is the sift image).

**Version verification:** imapflow 2.1.0 was read on disk this session (`node_modules/.pnpm/imapflow@2.1.0`). No registry lookups were needed because nothing new is installed.

## Package Legitimacy Audit

Not applicable: this phase installs no external packages. The relay and the capture use Node built-ins and the existing sift image. If the planner adds a capture image (e.g. a tcpdump container), that is a new third-party image and needs a `checkpoint:human-verify`.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                         (owner CLI, setup service, sift_owner)
 sift labels dry-run|apply|pause|resume|retry <slug> ──► mailbox.label_mode (registry)
 sift mailbox list ◄── counts from action records / notices
                                   │ read each tick (registry reread, ~60 s)
                                   ▼
 worker tick (per mailbox, supervisor) ─► ingest (ingest lock, EXAMINE only) ─► classify (chunks)
                                   │
                                   ▼
                     label step (takes the ingest lock again)
                                   │
          ┌──────── mode? ─────────┼───────────────────────────────┐
          │ paused: nothing        │ dry_run: write "would ..."     │ apply
          │                        │ records, no IMAP               │
          │                        ▼                                ▼
          │            folder_sync(ingest folder).state == 'ok'? ── no ──► skip tick (D-24)
          │                                                         │ yes
          │                                                         ▼
          │             pending work = current decision per live message, newest
          │             INTERNALDATE first, cap LABEL_ACTIONS_PER_TICK (D-07)
          │                                                         │
          │                     open pinned IMAP (writes allowed only via gate permit)
          │                                                         │
          │      LIST Labels/* ─► resolve path per category (case rule, D-11/D-12)
          │                    │conflict: hold category + notice
          │                    ▼
          │      per label folder: EXAMINE ─► UID SEARCH HEADER X-Pm-Internal-Id
          │                    │present & not ours ─► record already_present (D-16)
          │                    │present & intent pending ─► record copied (resync, D-17)
          │                    ▼
          │      gate.ensureLabelFolder (CREATE [+SUBSCRIBE]) ─► label_event created
          │      intent row ─► SELECT ingest folder (UIDVALIDITY check) ─► UID COPY
          │                    │COPYUID ─► label_event copied + label row + action applied
          │                    │no COPYUID/NO/drop ─► attempt_failed (retry; N ─► failed)
          │                    ▼
          │      removals (D-14/D-15): SELECT Labels/<old> (UIDVALIDITY + identity check)
          │                    ─► UID STORE +FLAGS (\Deleted) ─► UID EXPUNGE <copy uid>
          │                    ─► label_event removed + label.removed_at
          │      EXAMINE / LOGOUT (never CLOSE)
          ▼
 sift trace <slug> ... ─► decision + spans + action records + label_event + rule_set snapshot ─► tree / --json

 network: worker ──(sift-internal, internal: true)──► db, bridge, models relay ──(default)──► Ollama host only
```

### Recommended Project Structure
```
apps/worker/src/
├── imap/
│   ├── connect.ts          # + exec() command allowlist (alongside guardPlaintext)
│   └── label-writer.ts     # D-28 gate: the ONLY module that issues IMAP writes
├── labels/
│   ├── plan.ts             # pure reconcile: decision + label state + action history -> work items
│   ├── run.ts              # the per-tick label step (lock, mode, IMAP session, records)
│   └── trace-format.ts     # pure tree renderer for sift trace (README format)
├── commands/
│   ├── labels.ts           # sift labels dry-run|apply|pause|resume|retry <slug>
│   ├── trace.ts            # sift trace <slug> (--subject|--from|--date|--message-id|--id) [--all] [--json]
│   └── egress-relay.ts     # sift egress-relay (TCP forwarder to models.url host:port)
packages/db/src/
├── labels.ts               # scoped use-cases: pendingLabelWork, recordAction, recordLabelEvent, ...
├── trace.ts                # scoped trace reads (search + exact lookup)
└── owner/registry.ts       # + setLabelMode, label counts in listMailboxes
packages/db/migrations/
├── 0012_labels_preflight.sql        # refuse if label/label_event already hold rows (0008 precedent)
├── 0013_labels_tables.sql           # generated
└── 0014_labels_grants.sql           # FORCE RLS, grants (append-only), triggers
```

### Pattern 1: Decision-driven reconcile (label step)
**What:** On each tick, compute work from durable state only: the **current** decision per message (newest `created_at`, then `id`: `latestDecision` semantics), Sift's live labels (`label` rows with `removed_at is null`), and the newest action record for that decision. Nothing is held in memory between ticks (ADR-0003 "state, not time windows").

| Current decision | Sift label now | Newest action record for this decision | Mode apply -> work |
|---|---|---|---|
| labelled X | none | none / `would_apply` / `requeued` / `attempt_failed`(< N) | presence check, then COPY to X |
| labelled X | X | any | nothing (record `applied` once if missing) |
| labelled X | Y (≠X) | not terminal | remove Y (own copy UID), then COPY X (D-14) |
| review | none | none / `would_hold` | record `held` with `review_reason` (no IMAP) |
| review | Y | not terminal | remove Y, then record `held` (D-15) |
| any | any | `applied` / `already_present` / `skipped` / `held` / `failed` | nothing |

In dry_run: write `would_apply X` / `would_hold <reason>` (and `would_remove Y` when a move is implied) once per decision; never open IMAP (D-03). Paused: write nothing (D-04). Superseded decisions keep whatever records they have; the trace shows them as superseded.

**When to use:** after `classifyMailbox` in `createMailboxCallbacks().runBatch` (`apps/worker/src/runtime/mailbox-batch.ts`), as its own lock acquisition. Ingest closes its IMAP client before classification, so the label step opens its own connection, and only when apply-mode work exists.

### Pattern 2: The write gate plus a connection-level allowlist (D-28, ACT-05)
**What:** `label-writer.ts` exposes exactly three operations: `ensureLabelFolder`, `copyToLabel` and `removeSiftCopy`. Each validates its preconditions and throws a named error (e.g. `ImapWriteRefusedError`, code `SIFT_IMAP_WRITE_REFUSED`) before anything goes on the wire. Separately, `openImap()` wraps the ImapFlow instance's `exec()` (the single funnel every command passes through, including `run()`-dispatched ones and raw `exec` callers like the probe). Read commands always pass. Write commands pass only while the gate holds a matching one-shot permit.

Facts behind this pattern (read this session from imapflow 2.1.0 `dist/esm`):
- `exec(command, attributes, options)` is the internal funnel (`imap-flow.js:486`). `copy.js` calls `connection.exec(options.uid ? 'UID COPY' : 'COPY', attributes)`, and `store.js:80` calls `connection.exec(options.uid ? 'UID STORE' : 'STORE', attributes)`.
- `create.js`: after `CREATE` succeeds it runs `await connection.run('SUBSCRIBE', path);`. A `NO [ALREADYEXISTS]` returns `{ path, created: false }`, and other errors throw.
- `expunge.js`: `let byUid = options.uid && hasCapability(connection, 'UIDPLUS'); let command = byUid ? 'UID EXPUNGE' : 'EXPUNGE';`. Without UIDPLUS, `messageDelete()` sends a plain EXPUNGE, which removes **every** `\Deleted` message in the folder.
- `close.js`: `response = await connection.exec('CLOSE');`, documented there as "permanently removes all messages flagged \Deleted ... (implicit expunge)". `mailboxClose()` (`imap-flow.js:2504`) uses it, and so do `delete.js`/`rename.js`.
- `copy.js` returns `false` on NO (errors are only logged via `reportCommandError`), and returns `{ path, destination, uidValidity?, uidMap? }` on OK. `uidMap` exists only when the server sent COPYUID.

Allowlist sketch (the command names are the strings ImapFlow passes to `exec`):
```typescript
// apps/worker/src/imap/connect.ts (pattern mirrors the existing guardPlaintext, connect.ts:102-125)
const READ_COMMANDS = new Set([
  'CAPABILITY', 'ID', 'STARTTLS', 'LOGIN', 'AUTHENTICATE', 'ENABLE', 'NAMESPACE',
  'LIST', 'LSUB', 'STATUS', 'EXAMINE', 'FETCH', 'UID FETCH', 'SEARCH', 'UID SEARCH',
  'NOOP', 'IDLE', 'LOGOUT', 'UNSELECT',
]);
// Writes the gate may permit, one permit per command. Everything else (CLOSE, EXPUNGE,
// STORE, COPY, MOVE, UID MOVE, APPEND, DELETE, RENAME, UNSUBSCRIBE, ...) is refused.
const GATED_COMMANDS = new Set(['SELECT', 'CREATE', 'SUBSCRIBE', 'UID COPY', 'UID STORE', 'UID EXPUNGE']);
```
The planner must check this list against every command the existing read paths send (run the Dovecot ingest tests with the allowlist on), and must handle `COMPRESS` if it is ever enabled. The gate checks the arguments, not just the command name:
- `UID COPY`: destination starts with `Labels/`, and the selected mailbox is the ingest folder, opened read-write by the gate.
- `UID STORE`: exactly `+FLAGS` with `(\Deleted)`, inside a `Labels/` folder, on a copy UID Sift recorded.
- `UID EXPUNGE`: the same UID set.
- `CREATE`/`SUBSCRIBE`: a `Labels/<one segment>` path.
- `SELECT`: only the ingest folder (for COPY) or a `Labels/` folder (for removal).

The probe (`spike/probe.ts`) needs its own explicit permit mode, so the owner-run label test keeps working.

**SUBSCRIBE needs owner confirmation:** D-28 lists CREATE, UID COPY, UID STORE and UID EXPUNGE. ImapFlow's `mailboxCreate()` always sends SUBSCRIBE after CREATE, and the spike's successful CREATE went through that path. Recommended: permit SUBSCRIBE only for the path just created, in the same gate operation, and record it in the `created` label_event. The alternative is to send CREATE through `exec` directly and skip SUBSCRIBE, which leaves the path the spike proved. See Assumptions A3.

### Pattern 3: Intent-then-outcome records (crash-safe echo suppression)
**What:** Before `UID COPY`, insert and **commit** an append-only `label_event` row `kind = 'copy_requested'` (message, label path, source UIDVALIDITY/UID). After COPYUID, insert `kind = 'copied'` with `label_uidvalidity` and `copy_uid`, plus the `label` row and the `applied` action record, all in one transaction. On a later tick, a `copy_requested` without an outcome means "unconfirmed" (D-17). EXAMINE the label folder, SEARCH by identity, and if the message is there, record `copied` with the found UID (`source = 'resync'`). If it is not there, retry the COPY. This closes the crash window between the IMAP write and the DB write, which would otherwise turn Sift's own copy into an "already present, not Sift's" label that Sift could never remove (breaking D-14).

**Why it matters for gluon:** a re-COPY of a present message does unlabel+relabel and assigns a new UID (Pitfall 1). Never retry a COPY without the presence/resync check first.

### Pattern 4: Removal of Sift's own copy (D-14, D-15)
1. The `label` row gives `(label_path, label_uidvalidity, copy_uid)`.
2. EXAMINE the label folder. If UIDVALIDITY ≠ the recorded value, refuse and record `failed: label folder reset`, never touching it (the D-22 analogue).
3. `UID SEARCH UID <copy_uid>`, then fetch `X-Pm-Internal-Id` (BODY.PEEK) and compare with the message's `pm:` key. If absent, the owner already removed it: record `removed` with `source = 'already_gone'` and do no write.
4. Check UIDPLUS is advertised (Bridge v3.27.0 advertises it per the spike). If missing, refuse.
5. SELECT the label folder, `UID STORE <copy_uid> +FLAGS (\Deleted)`, `UID EXPUNGE <copy_uid>`, then EXAMINE back (or LOGOUT). Never `mailboxClose()`.
6. Record a `removed` label_event and set `label.removed_at`.

### Pattern 5: `sift trace` (TRC-05)
- Lookup: `--id <uuid>` (message id) or `--message-id '<...>'`, normalised with the same `normaliseMessageId` ingest uses (strip `<>`, lower-case the domain; `apps/worker/src/ingest/identity.ts:68-78`). Expect several matches (1.6% of Message-IDs are shared on Bridge, per the spike) and then print the numbered list. Search: `--subject` (case-insensitive substring, ILIKE with escaped `%`/`_`), `--from` (address or domain, matching `from_address`/`from_domain`), `--date YYYY-MM-DD` (the `internal_date` day, in UTC; say so in the help). Newest first, with a capped list.
- Rendering: one line per span in the README "Decision traces" tree. The exact-rules line shows condition summaries by joining `rule_set.snapshot` rules by `RuleRef.index` (the stored span has only `{field, pass}` per condition, so the values come from the snapshot, D-24). The classifier shows `skipped (not trained)`. The LLM line shows the model, prompt version, confidence vs threshold, the reason and raw output (control characters escaped as in Phase 3). The Action line shows the newest action record ("labelled X (applied, <time>)", "would label X (dry run, <time>)", "held for review: low_confidence", "already present, not applied by Sift", "skipped: ...", "failed: ..."). The versions line follows.
- `--all`: every decision oldest to newest, with the label_event moves between them. The default shows the latest decision plus `earlier decisions: N (use --all)`.
- D-25 hint: compare the decision's `rule_set.version` with the mailbox's newest `rule_set.version` (it lags rules.yaml edits until the next pass; say "since this decision" carefully).
- `--json`: raw decision row, spans, action records, label_event rows. jsonb values print as stored.
- Role: read-only through the scoped API. Run it in the worker service (`docker compose run --rm --no-deps worker sift trace ...`) like `sift classify`, or as the owner in the setup service. Either works; pick one and pin it in `user-facing-text.test.ts`.

### Pattern 6: Egress lockdown (D-29, SEC-02)
```yaml
# compose.yaml sketch (planner adapts; Compose v2.2.3 on the dev machine)
networks:
  sift-internal:
    internal: true          # no default gateway (docs.docker.com/compose/how-tos/networking)
services:
  db:      { networks: [default, sift-internal] }   # keeps 127.0.0.1:5432 publish via default
  bridge:  { networks: [default, sift-internal] }   # Proton API via default; socat on EVERY IP
  worker:  { networks: [sift-internal] }            # remove extra_hosts host-gateway
  models-egress:
    image: ${SIFT_IMAGE:-sift:local}
    command: ["sift", "egress-relay"]
    networks:
      default: {}
      sift-internal: { aliases: ["models.sift.internal"] }
    extra_hosts: ["host.docker.internal:host-gateway"]
    volumes: ["${SIFT_CONFIG_HOST_DIR:-./config}:/config:ro"]
    environment: { SIFT_CONFIG: /config/config.yaml }
```
- The relay reads `models.url` (after the `SIFT_MODELS_URL` override) and forwards each accepted TCP connection to that host:port only. It logs connection counts and byte totals, never payload. It refuses to start for an `https:` URL, because a raw TCP relay breaks TLS hostname verification. That is acceptable because Sift only speaks to Ollama and README Privacy says to keep the model on this machine.
- The worker gets `SIFT_MODELS_RELAY=models.sift.internal:11434` (or similar). When set, the Ollama client and preflight dial `http://<relay>` but every owner message still names `models.url`. The `.internal` suffix keeps Ollama's Host check happy when Ollama binds loopback (Pitfall 9).
- **Bridge on two networks:** `bridge/entrypoint.sh:211` takes `ip=$(hostname -i | cut -d' ' -f1)`, and `:238` runs `socat "TCP-LISTEN:$IMAP_PORT,bind=$ip,fork,reuseaddr"`, so it listens on one IP only. Start one socat per IP from `hostname -i` (and make the healthcheck probe each), or the worker's connection to Bridge's internal-network IP is refused. This needs a bridge image rebuild and `scripts/bridge-smoke.sh`.
- Tests:
  - Static: `compose.test.ts` asserts the worker's networks are exactly `[sift-internal]`, that network is `internal: true`, the worker has no `extra_hosts`, and the relay exists. The existing assertion at `compose.test.ts:246` (`worker.extra_hosts` contains `host.docker.internal:host-gateway`) moves to the relay.
  - Dynamic: in `compose-smoke.sh`, `docker compose exec -T worker node -e "<net.connect to 1.1.1.1:443>"` must fail (ENETUNREACH/EHOSTUNREACH/timeout within 5 s), while `db:5432` and `models.sift.internal:11434` accept.
  - CI: a telemetry denylist over the production dependency tree in `dependencies.test.ts`, plus a static "network call sites" allowlist (only `imap/capture.ts`, `imap/connect.ts`, `imap/pin.ts`, `spike/probe.ts`, `classify/ollama-client.ts`, `classify/preflight.ts` and the new `commands/egress-relay.ts` may import `node:net`/`node:tls`/`node:http(s)`/`node:dgram` or call `fetch`).

### Pattern 7: Live run (E2E-01, D-31..D-33)
1. Confirm the stack is on the Phase 4 build (`dry_run` default) and Bridge is past its initial sync.
2. Start the egress sampler. Run `docker compose exec -T worker node -e '<poll /proc/net/tcp and /proc/net/tcp6 every second, print distinct remote ip:port counts at exit>'`, and the same on `models-egress`. Node is in the image, so no new tools are needed.
3. Leave it in dry_run for a while. Run the stratified sample as a single-line `psql` (`row_number() over (partition by tier, outcome, review_reason order by random())`, about 20 ids, ids only). The owner runs `sift trace <slug> --id <id>` for each and answers explained yes/no.
4. Run `sift labels apply personal`, check the D-05 count and confirm, then watch the backlog land in the Proton client, and wait for a few new emails to be labelled live.
5. Aggregates for `04-LIVE-RUN.md`: outcome×tier counts, sample verdicts, action records by kind, `label_event` counts by kind (= IMAP write ops), the gate's per-op log counters, and the egress summary. Add a `live-run-record.test.ts` with `privacyProblems` like `live-ingest-record.test.ts`.

### Anti-Patterns to Avoid
- **COPY without a presence check:** on gluon it silently unlabels+relabels and gives a new UID (Pitfall 1).
- **`mailboxClose()` / CLOSE on a read-write SELECTed folder:** an implicit expunge of every `\Deleted` message, the owner's included. Use EXAMINE or LOGOUT; RFC 3501 §6.4.2 says SELECT, EXAMINE and LOGOUT close without expunging.
- **`messageDelete()` without checking UIDPLUS first:** it falls back to a plain EXPUNGE.
- **Fetching on a read-write SELECTed INBOX:** any non-PEEK fetch sets `\Seen`. Do every read on EXAMINE; SELECT only immediately around the COPY.
- **Updating `decision` or its spans:** P3 D-30 forbids it; action records are new rows.
- **Storing server reply text in action records or `last_error`:** use fixed reason codes (T-02-43 precedent).
- **Writing label copies into `message_location` in M1** (Pitfall 6).
- **Putting the label mode in `config.yaml`:** D-01 locks DB + CLI.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modified UTF-7 for label paths (`&` in category names) | A custom encoder in the gate | ImapFlow's `encodePath` (used by `messageCopy`/`mailboxCreate`/`mailboxOpen`) and `list()`-decoded paths | Category names may contain `&` (P3 D-06), whose wire form is `&-`; the probe's `encodeModifiedUtf7` exists only for raw STATUS |
| COPYUID parsing | Regex over the tagged response | `messageCopy()` result `uidMap.get(uid)` / `uidValidity` (`copyuid-parser.js`) | Already validated; bounded digit parsing |
| Pending-work selection | Ad-hoc SQL in the worker | A scoped `@sift/db` query (like `classification.candidates`) | Apps cannot import drizzle; RLS scope |
| Owner confirmation prompt | New prompt code | `classify.ts` `readLine` + count-confirm pattern (`CLASSIFY_CONFIRM_THRESHOLD`) | Same UX as P2 D-75 / P3 D-17 |
| Owner-role per-mailbox reads | A new connection helper | `withOwnerClient` + `set_config('app.mailbox_id', ...)` as in `listMailboxes` / `resumeMailbox` | The owner is subject to FORCE RLS (D-41) |
| Control-character escaping in trace output | New escaping | The Phase 3 escaping already used for traces (`classify-control-chars.test.ts` covers it) | D-23 says "as in Phase 3" |
| Error codes for logs | Error message text | `codedCause`, `classifyImapError` | Message text can hold server replies/SQL params |

**Key insight:** the dangerous parts of this phase are side effects hidden in a library and a server (ImapFlow's implicit SUBSCRIBE/CLOSE/EXPUNGE fallbacks, and gluon's remove-then-add on re-COPY). Use the library's encoding and parsing, but never trust it to keep writes in bounds. The gate plus the `exec()` allowlist is the boundary.

## Runtime State Inventory

Not a rename/refactor phase, but it changes live state, so here is the inventory:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `personal` decisions with Phase 3 `pending` actions (the owner's 3-day backfill); `label`/`label_event` are empty key-only stubs | The migration adds `mailbox.label_mode` default `'dry_run'` (D-02). The existing decisions become dry-run/apply work (D-06). A preflight refuses if `label`/`label_event` already hold rows |
| Live service config | Proton account labels (owner's existing `Labels/*`, 6 at spike time, plus the empty `Labels/Sift Spike` folder the spike left behind) | None automatic. D-13 reuses same-name labels. The empty spike label can be ignored or removed by the owner in Proton |
| OS-registered state | None: Compose services only (`restart: unless-stopped`) | Recreate the worker and bridge after compose/network changes (`docker compose up -d --force-recreate`) |
| Secrets/env vars | None renamed. New non-secret env: `SIFT_MODELS_RELAY` (worker), relay reads `SIFT_CONFIG` | Document in compose comments and README |
| Build artifacts | `sift:local` and `sift-bridge:local` images | Rebuild both: worker code, and Bridge socat-per-IP |

## Common Pitfalls

### Pitfall 1: gluon re-COPY of an already-labelled message
**What goes wrong:** Sift COPYs a message the owner already labelled X. gluon (at the commit Bridge v3.27.0 pins) checks `MailboxFilterContains`, calls `actionRemoveMessagesFromMailboxUnchecked` (a remote **unlabel**), then `AddMessagesToMailbox` (a remote **label**), and returns a **new** UID in COPYUID. Sift records it as its own copy and later removes the owner's label on a move.
**Why it happens:** gluon treats COPY into a mailbox as "ensure membership, fresh UID". `[VERIFIED: raw.githubusercontent.com/ProtonMail/gluon/7e800978ab4a/internal/state/actions.go lines 250-277; bridge go.mod pins github.com/ProtonMail/gluon v0.17.1-0.20260901104218-7e800978ab4a]`
**How to avoid:** a presence check in the EXAMINEd label folder before every COPY (Pattern 1), and the intent/resync protocol for retries (Pattern 3).
**Warning signs:** a COPY into a label folder whose `X-Pm-Internal-Id` SEARCH would have hit; the owner's other clients show the label briefly removed and re-added; a `label` row whose message the owner labelled before Sift's first action.

### Pitfall 2: CLOSE and plain EXPUNGE hidden in ImapFlow
**What goes wrong:** `mailboxClose()` sends CLOSE (implicit expunge). `messageDelete()` without UIDPLUS sends a plain EXPUNGE. Either can remove the owner's `\Deleted` messages; in INBOX that is deleting mail.
**How to avoid:** the allowlist refuses CLOSE and EXPUNGE outright, and the gate checks UIDPLUS before any removal. `[VERIFIED: imapflow@2.1.0 dist/esm/commands/close.js, expunge.js]`

### Pitfall 3: EXPUNGE in Trash/Drafts is a permanent delete on Bridge
**What goes wrong:** Bridge's connector permanently deletes messages expunged from Trash or Drafts (`removeMessagesFromMailboxWithoutUnlabelOnFolders`: "Messages can be perma deleted only from 'Trash' or 'Drafts'"). `[VERIFIED: proton-bridge v3.27.0 internal/services/imapservice/connector.go:405-440]`
**How to avoid:** STORE/EXPUNGE are permitted only when the selected path starts with `Labels/` (and is never a special-use folder). Test that the gate refuses INBOX, `Trash` and `Folders/*`.

### Pitfall 4: SUBSCRIBE after CREATE is a write outside D-28's list
**What goes wrong:** the gate "allows only CREATE", but `mailboxCreate()` also sends SUBSCRIBE, so either the allowlist breaks label creation or an unlisted write slips through.
**How to avoid:** decide explicitly (Pattern 2, A3).

### Pitfall 5: No COPYUID does not always mean "failed"
**What goes wrong:** gluon's Copy returns OK with no COPYUID when no message matched (the UID is gone: the owner moved or deleted it after the last removal diff). RFC 3501 §6.4.8 says a non-existent UID is "ignored without any error message generated".
**How to avoid:** after an unconfirmed COPY, on the next tick EXAMINE the ingest folder and `UID SEARCH UID <n>`. If it is gone, record `skipped` (D-18) rather than burning retries toward `failed`. If the UID is present, run the presence check in the label folder (Pattern 3).

### Pitfall 6: Label-folder rows in `message_location` break liveness
**What goes wrong:** the classification candidates query treats a message as live if **any** location is live (`packages/db/src/scope.ts`, the `live` EXISTS has no folder filter), and `deleteOrphanBodies` uses "any folder". M1 never diffs label folders, so a label-folder location would never get `removed_at`.
**How to avoid:** keep copy UIDs in `label`/`label_event` in M1. If the planner follows the spike note and writes `message_location` rows anyway, every liveness/orphan query must be restricted to the ingest folder in the same plan.

### Pitfall 7: Wrong INBOX UID after a UIDVALIDITY change
**What goes wrong:** copying by a stale UID copies a different message.
**How to avoid:** skip the tick while `folder_sync.state = 'resyncing'` (D-24). On SELECT, compare the reported UIDVALIDITY with the location's `uidvalidity` and with `folder_sync.uidvalidity`; on mismatch, abort all COPYs for the tick.

### Pitfall 8: Bridge socat listens on one IP only
**What goes wrong:** with Bridge on two networks, `hostname -i | cut -d' ' -f1` picks one IP, so the worker on the other network gets ECONNREFUSED, which shows as "IMAP server unreachable".
**How to avoid:** one socat per IP, plus a bridge-smoke test with two networks. `[VERIFIED: bridge/entrypoint.sh:211, :238]`

### Pitfall 9: Ollama Host-header check behind a relay
**What goes wrong:** when Ollama binds loopback (Docker Desktop reaches host loopback via `host.docker.internal`), it answers 403 unless the Host is `localhost`, the machine hostname, a loopback/private IP, or ends in `.localhost`/`.local`/`.internal`. A relay named `models-egress` would give 403s that the client classifies as `rejected`/`server_error`. `[VERIFIED: github.com/ollama/ollama main server/routes.go allowedHost / allowedHostsMiddleware]`. On this machine Ollama 0.40.3 listens on `*:11434`, so the check is skipped here, but Linux owners with a loopback bind would hit it.
**How to avoid:** a relay alias ending in `.internal` (e.g. `models.sift.internal`).

### Pitfall 10: Case-variant labels and Proton's own uniqueness rules
**What goes wrong:** Proton may refuse `CREATE Labels/Newsletters` when `Labels/newsletters` exists, or may allow both; this is unknown. Bridge's `createLabel` simply calls the Proton API. `[VERIFIED: connector.go:760-780]`
**How to avoid:** decide from LIST and never attempt CREATE when a case-variant exists. With `case_sensitive: false`, reuse it (D-11). With `true`, hold that category and report the conflict (D-12). A CREATE that still returns NO becomes `attempt_failed` with code `create_refused`. The behaviour is then correct whatever Proton does.

### Pitfall 11: Labels cannot nest; folder count limits
Bridge refuses `Labels/A/B` ("a label cannot have children"). Category names already exclude `/` (P3 D-06), but the gate should still assert one segment. A Proton plan label limit makes CREATE fail; record `create_refused` and surface it in `mailbox list`. Bridge colours new labels `#f66`.

### Pitfall 12: Owner role vs app role for the new CLIs
`mailbox list`/`resume` run in the `setup` service with `SIFT_OWNER_DATABASE_URL`. `classify` runs in the worker service with `SIFT_DATABASE_URL`. The mode switch must be owner-only (the registry is SELECT-only for sift_app), so `sift labels ...` runs in `setup`. In the agent shell, `docker compose run` needs `-T` (cerebrum).

### Pitfall 13: Interleaving with `sift classify`
A re-run appends a decision while the worker may be mid-tick. The label step reads the current decision under the ingest lock (the CLI also takes it per chunk), so it sees a consistent state. It must re-read the current decision just before acting, not reuse a list computed before taking the lock.

## Code Examples

### COPY with COPYUID via the existing ImapFlow call (spike path)
```typescript
// Source: apps/worker/src/spike/probe.ts labelTest (read this session), adapted for the gate
const source = await client.mailboxOpen(folder);              // SELECT (gate permit), Bridge refuses COPY from EXAMINE
if (source.path !== folder || BigInt(source.uidValidity) !== BigInt(expectedUidValidity)) throw refused('uidvalidity_changed');
const copy = await client.messageCopy(String(uid), labelPath, { uid: true }); // UID COPY
const copyUid = copy === false ? undefined : copy.uidMap?.get(uid);
const labelUidValidity = copy === false ? undefined : copy.uidValidity;     // from COPYUID
await client.mailboxOpen(folder, { readOnly: true });          // back to EXAMINE; never mailboxClose()
```

### Presence check before COPY (gluon supports SEARCH HEADER)
```typescript
// gluon internal/state/mailbox_search.go handles command.SearchKeyHeader (read this session, pinned commit)
await client.mailboxOpen(labelPath, { readOnly: true });
const hits = await client.search({ header: { 'x-pm-internal-id': pmId } }, { uid: true });
if (hits === false) throw new UnconfirmedError('search_failed');   // search() returns false on failure (cerebrum)
// SEARCH HEADER is a substring match: confirm each hit's header equals pmId exactly (BODY.PEEK fetch)
```

### Append-only table skeleton (follow 0009/0010 shape)
```sql
-- Custom grants migration, mirroring 0004_scoped_tables_force_grants.sql (read this session)
ALTER TABLE "label_action" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "label_action" TO sift_app;--> statement-breakpoint
CREATE TRIGGER label_action_set_updated_at BEFORE UPDATE ON "label_action" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```
`label_action` is a suggested name (the planner chooses). It must also be added to `SCOPED_TABLE_NAMES` and `APPEND_ONLY_TABLE_NAMES` in `packages/db/src/schema/index.ts`, with a composite FK `(mailbox_id, decision_id) -> decision(mailbox_id, id)` (decision has `unique('decision_mailbox_id_id_key')`).

## In-Repo Values (verbatim, read this session)

- `packages/db/src/schema/index.ts:38`: `export const APPEND_ONLY_TABLE_NAMES = ['decision', 'label_event', 'rule_set'] as const;` `[VERIFIED: packages/db/src/schema/index.ts:38]`
- `packages/db/src/schema/index.ts:21-31` SCOPED_TABLE_NAMES: `'mailbox_status', 'message', 'message_location', 'message_body', 'label', 'decision', 'folder_sync', 'label_event', 'rule_set',` `[VERIFIED: packages/db/src/schema/index.ts:21-31]`
- `packages/db/src/schema/index.ts:41-54` MAILBOX_COLUMNS: `'id', 'slug', 'display_name', 'imap_host', 'imap_port', 'imap_username', 'imap_folder', 'password_env', 'labels_apply_as', 'disabled_at', 'created_at', 'updated_at',`. A `label_mode` column changes this list and the catalog check (`packages/db/test/support/catalog.ts:375-387`). `[VERIFIED]`
- `packages/db/migrations/0004_scoped_tables_force_grants.sql`: `GRANT SELECT, INSERT, UPDATE, DELETE ON "mailbox_status", "label", "folder_sync", "rule_set" TO sift_app;` and `GRANT SELECT, INSERT ON "decision", "label_event" TO sift_app;`. So `label` is mutable today and `label_event` is append-only. `[VERIFIED]`
- `packages/db/src/schema/scoped.ts:223-237` `label` stub columns: `id`, `mailboxId`, `messageId`, timestamps, FK `label_message_fk`. `:424-431` `label_event` stub: `id`, `mailboxId`, timestamps, `unique('label_event_mailbox_id_id_key')`. `[VERIFIED]`
- `packages/db/src/schema/scoped.ts:343`: `check('decision_outcome_check', sql\`${t.outcome} in ('labelled', 'review')\`)`; `:351` review reasons `'low_confidence', 'invalid_output', 'out_of_category', 'input_too_long', 'llm_error'`; `:410` `check('folder_sync_state_check', sql\`${t.state} in ('ok', 'resyncing')\`)`. `[VERIFIED]`
- `packages/core/src/classify/spans.ts:190-197` ActionSpanSchema: `kind: z.literal('action'), status: z.literal('pending'), intent: ... z.literal('label'), label ... | z.literal('review'), reason: z.enum(REVIEW_REASONS)`; `:16` `export const TRACE_FORMAT_VERSION = 1;`. `[VERIFIED]`
- `packages/core/src/config/schema.ts:148-152`: `export const Labels = z.strictObject({ apply_as: z.enum(['proton_labels'], { error: unlessMissing('apply_as must be proton_labels'), }), });`. `case_sensitive` is added here as `z.boolean(...).default(false)`. `[VERIFIED]`
- `apps/worker/src/classify/run.ts:77-81`: `CLASSIFY_CHUNK_SIZE = 5`, `LLM_CALLS_PER_TICK = 25`, `MAX_EXAMINED_PER_TICK = 500` (naming precedent for `LABEL_ACTIONS_PER_TICK`, `LABEL_ACTION_MAX_ATTEMPTS`). `[VERIFIED]`
- `compose.yaml:111-112` worker: `extra_hosts: - "host.docker.internal:host-gateway"`. `[VERIFIED]`
- `apps/worker/test/read-only-ingest.test.ts:14` `const PROBE = 'spike/probe.ts';`; `:20` bans `messageMove|messageCopy|messageDelete` etc.; `:57` `expect(opens).toEqual(['imap/folder-source.ts: readOnly']);`. The new gate file becomes a second allowed writer, and this expectation changes. `[VERIFIED]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ADR-0003: match messages across folders by Message-ID | `pm:` (X-Pm-Internal-Id) first; 1.6% of Message-IDs are shared | Phase 2 spike, 2026-10-06 | Presence checks search `X-Pm-Internal-Id`, never Message-ID, on Bridge |
| README `label_event` = "label changes Sift detects in your mail app" | Also every change Sift makes (echo records) | Phase 4 | README Data model row needs updating |
| Worker reaches Ollama via `extra_hosts` host-gateway | Worker internal-only; relay reaches Ollama | Phase 4 | README "Linux mini PC" note and the Compose comments change |
| README "What M1 stores today ... Nothing is written into your mailbox yet" | Labels applied (in apply mode) | Phase 4 | That paragraph and its pinned text must change |

**Deprecated/outdated:** the spike note "record ... as a new `message_location`" is superseded for M1 by Pitfall 6 (planner decision; document it in the plan).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Docker Desktop 20.10 / Compose v2.2.3 on the owner's Mac supports `internal: true` networks and per-network aliases, and the internal network blocks TCP to external IPs | Pattern 6 | Lockdown would not hold, or the stack would fail to start; the compose-smoke and a local run catch it before the live run |
| A2 | Whether Docker's embedded DNS on an internal network forwards external name lookups (it did before Engine 26) | Pattern 6 | A DNS query for an external name might leave the host, but no TCP can follow; record it in the egress summary rather than claim "no DNS" |
| A3 | Owner accepts SUBSCRIBE (sent by ImapFlow right after CREATE) as part of the CREATE operation in the D-28 allowlist | Pattern 2, Pitfall 4 | If not, the gate must send CREATE through `exec` without SUBSCRIBE, off the spike-proven path. Needs owner confirmation |
| A4 | gluon's SEARCH HEADER on a large label folder is fast enough for ≤ 50 actions per tick | Pattern 1 | Ticks slow down; fall back to one per-folder header fetch per tick |
| A5 | Proton's handling of case-variant label names (refuse vs allow) | Pitfall 10 | None for correctness: the design decides from LIST first |
| A6 | Bridge v3.27.0's gluon EXPUNGE of a `\Deleted` copy in a label folder only unlabels (the spike observed one case) | Pattern 4 | Spike-observed once on a real account; the live run re-verifies with the D-14 move path if a re-run happens |
| A7 | `hostname -i` in the Bridge container lists every network IP | Pitfall 8 | The socat-per-IP fix must be checked in bridge-smoke |
| A8 | A raw TCP relay is acceptable and `https:` `models.url` can be refused while the relay is on | Pattern 6 | An owner with a TLS model endpoint would need a different design (out of M1 scope) |

## Open Questions

1. **Exact table shapes and names** (action records, `label`, `label_event` columns). This is Claude's discretion. Recommended minimum:
   - Action record: `decision_id`, `message_id`, `mode` (dry_run|apply), `kind` (would_apply|would_hold|would_remove|applied|already_present|held|skipped|attempt_failed|failed|requeued), `label`, `reason_code`, `attempt`.
   - `label`: `message_id`, `category`, `label_path`, `label_uidvalidity`, `copy_uid`, `applied_by` ('sift'), `owner_confirmed` (false), `decision_id`, `removed_at`, `removed_by_decision_id`.
   - `label_event`: `kind` (folder_created|copy_requested|copied|remove_requested|removed), `message_id` nullable, `label_path`, `label_uidvalidity`, `copy_uid`, `source_folder`/`source_uidvalidity`/`source_uid`, `source` (gate|resync|already_gone).
2. **Where conflict and failure notices surface in `mailbox list`.** Recommended: compute counts from action records in `listMailboxes`, and store the D-12 conflict text in a worker-written column (or notice) on `mailbox_status`, never server text.
3. **Should the label step run on ticks where ingest did not sync** (needs_attention hold, rules invalid)? Recommended: run whenever the mailbox is active and its ingest folder is `ok`, so mode switches take effect within one tick (D-01).
4. **Presence check for `mid:`/`hdr:` identities** (non-Bridge servers only). Recommended: `HEADER Message-ID` for `mid:`; for `hdr:`, record `skipped: no searchable identity` (fail closed).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Desktop (engine) | All integration tests, compose-smoke, live run | Installed, daemon **not running** at research time | CLI 20.10.12 | Owner starts Docker Desktop |
| Docker Compose | Compose networks/relay | ✓ | v2.2.3 | — |
| Node | Worker, tests | ✓ (nvm) | 26.10.0 | — |
| Ollama (host) | Live run, LLM tier | ✓ running, listens `*:11434` | 0.40.3 | — |
| Dovecot test IMAP | Gate integration tests | via `scripts/test-imap.sh up` (needs Docker) | 2.4.5 | — |
| Proton Bridge | Live run | `sift-bridge:local` image (needs rebuild for socat-per-IP) | v3.27.0 | — |
| tcpdump/lsof (host) | Optional capture | ✓ host, but cannot see traffic inside the Docker Desktop VM | — | In-container `/proc/net/tcp` sampler (no new tools) |

**Missing dependencies with no fallback:** none. Docker must be running for the DB/IMAP tests and the live run.
**Missing dependencies with fallback:** host-side packet capture, replaced by the in-container sampler plus the relay log.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.2 |
| Config file | `vitest.config.ts` (global setup `packages/db/test/global-setup.ts`) |
| Quick run command | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run <pure test files>` (no Docker) |
| Full suite command | `scripts/test-imap.sh up && pnpm test` (needs sift-db-1 and Dovecot), plus `pnpm lint` and `pnpm typecheck` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACT-01 | Gate COPYs into `Labels/<Cat>` from a SELECTed source, records COPYUID; CREATE when missing; case rule | integration (Dovecot) | `pnpm exec vitest run apps/worker/test/label-writer.test.ts` | ❌ Wave 0 |
| ACT-01 | Label step applies newest first, capped per tick, writes applied action + label + label_event | integration (DB + Dovecot) | `pnpm exec vitest run apps/worker/test/labels-run.test.ts` | ❌ Wave 0 |
| ACT-01/02 | Reconcile table (Pattern 1) incl. moves, review removal, dry_run, paused, retries → failed | unit (pure) | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/labels-plan.test.ts` | ❌ Wave 0 |
| ACT-02 | Review decision: no IMAP write, `held` record with reason | integration | `labels-run.test.ts` | ❌ Wave 0 |
| ACT-03 | Every wire write has exactly one label_event; intent/resync after simulated crash | integration | `labels-run.test.ts` / `label-writer.test.ts` | ❌ Wave 0 |
| ACT-04 | `label.applied_by='sift'`, `owner_confirmed=false`; CHECK rejects otherwise; append-only grants on new tables | DB | `pnpm exec vitest run packages/db/test/labels.test.ts packages/db/test/catalog.test.ts` | ❌ / ✅ (catalog extends) |
| ACT-05 | No file but the gate and probe calls ImapFlow write methods; every non-gate mailboxOpen is readOnly | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/read-only-ingest.test.ts` | ✅ (update) |
| ACT-05 | Allowlist refuses CLOSE/EXPUNGE/STORE \Seen/APPEND/MOVE/DELETE before the wire; gate refuses INBOX/Trash/Folders/unrecorded UID/no UIDPLUS | unit + fake server | `pnpm exec vitest run apps/worker/test/imap-write-allowlist.test.ts` | ❌ Wave 0 |
| TRC-05 | `sift trace` search/exact/--all/--json/rules-changed hint; output matches README tree; opens no IMAP | integration (DB) | `pnpm exec vitest run apps/worker/test/trace-cli.test.ts` | ❌ Wave 0 |
| TRC-05 | README psql recipes and commands pinned to code | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/user-facing-text.test.ts` | ✅ (update) |
| D-01/05/09/19 | `sift labels` mode switch, count confirmation, retry; `mailbox list` mode and counts | integration (owner role) | `pnpm exec vitest run apps/worker/test/labels-cli.test.ts packages/db/test/registry.test.ts` | ❌ / ✅ |
| D-11 | `labels.case_sensitive` strict schema, example config, README YAML | unit | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run packages/core/test/config.test.ts packages/core/test/example-config.test.ts` | ✅ (update) |
| SEC-02 | Worker internal-only, relay present, no `extra_hosts` on worker | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/compose.test.ts` | ✅ (update) |
| SEC-02 | Telemetry denylist; network call-site allowlist | static | `pnpm exec vitest run apps/worker/test/dependencies.test.ts apps/worker/test/network-call-sites.test.ts` | ✅ / ❌ |
| SEC-02 | Relay forwards only to the models.url host:port, logs no payload | unit | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/egress-relay.test.ts` | ❌ Wave 0 |
| SEC-02 | Outside address refused from the worker container | smoke (Docker) | `SMOKE_ALLOW_VOLUME_REMOVAL=yes COMPOSE_PROJECT_NAME=sift-smoke SIFT_DB_PORT=55433 scripts/compose-smoke.sh --down` | ✅ (extend) |
| E2E-01 | Live run on `personal`; ~20 sampled traces explained | manual (owner, checkpoint) | — (04-LIVE-RUN.md) | ❌ |
| E2E-01 | 04-LIVE-RUN.md is aggregates-only and complete | static | `SIFT_TEST_ADMIN_URL= pnpm exec vitest run apps/worker/test/live-run-record.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the pure tests touched (`SIFT_TEST_ADMIN_URL= pnpm exec vitest run <files>`), plus `pnpm lint` and `pnpm typecheck`.
- **Per wave merge:** `scripts/test-imap.sh up && pnpm test`.
- **Phase gate:** full suite green, plus compose-smoke and bridge-smoke locally, before the live-run checkpoint and `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `apps/worker/test/label-writer.test.ts`: gate against Dovecot (needs Dovecot helpers to create `Labels/*` and read flags; `test-imap.ts` already has `createFolder`, flag and UID helpers)
- [ ] `apps/worker/test/imap-write-allowlist.test.ts`: uses `fake-imap-server.ts` to prove refusal before the wire
- [ ] `apps/worker/test/labels-plan.test.ts`, `labels-run.test.ts`, `labels-cli.test.ts`, `trace-cli.test.ts`, `egress-relay.test.ts`, `network-call-sites.test.ts`, `live-run-record.test.ts`
- [ ] `packages/db/test/labels.test.ts` plus seed helpers in `packages/db/test/support/seed.ts` for labels, action records and events
- [ ] A Bridge-like fake for gluon semantics (re-COPY gives a new UID, a missing UID gives OK without COPYUID, COPY from EXAMINE gets NO), e.g. a thin ImapFlow-shaped stub, because Dovecot behaves differently on all three

## Security Domain

### Applicable ASVS Categories (Level 1)
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no new auth; IMAP login unchanged, pinned TLS) | existing `openImap` |
| V3 Session Management | no | — |
| V4 Access Control | yes | Owner-only mode switch (registry SELECT-only for sift_app); RLS + FORCE on new tables; append-only grants; the write gate as the authorization point for mailbox writes |
| V5 Input Validation | yes | Strict Zod for `labels.case_sensitive` and CLI args (`parseArgs strict`); `normaliseMessageId` for `--message-id`; escaped ILIKE for `--subject`; label path assertions (one segment under `Labels/`) |
| V6 Cryptography | no new crypto | — |
| V7 Error Handling/Logging | yes | Fixed reason codes, `codedCause`, redaction; no server replies or mail content in records or logs |
| V12/V14 Configuration | yes | Compose internal network, relay, no telemetry dependencies |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt-injected email tries to trigger a mailbox action beyond labelling | Elevation | Closed output (only categories); the gate allows only COPY into `Labels/<category>`; allowlist |
| Library side effect expunges the owner's mail (CLOSE/EXPUNGE fallback) | Tampering | Allowlist refuses CLOSE/EXPUNGE; UIDPLUS check; never `mailboxClose()` |
| Sift removes an owner-applied label | Tampering | Remove only recorded copy UIDs after a UIDVALIDITY+identity check; presence check before COPY (gluon re-COPY) |
| Compromised worker flips itself to apply | Elevation | Mode in the registry (sift_app SELECT only) |
| Email content leaves the host | Information disclosure | Internal network; relay to models.url only; telemetry denylist; live egress capture |
| Trace written into the mailbox | Information disclosure | No APPEND path; the allowlist refuses APPEND |
| Terminal escape injection via trace output | Tampering | Phase 3 control-character escaping |

## Sources

### Primary (HIGH confidence, read this session)
- Codebase: `packages/db/src/schema/{scoped,index,mailbox}.ts`, `packages/db/migrations/0004*,0008*,0010*`, `packages/db/src/{classify,status,scope}.ts`, `packages/db/src/owner/registry.ts`, `packages/core/src/classify/spans.ts`, `packages/core/src/config/schema.ts`, `apps/worker/src/{imap/connect.ts, spike/probe.ts, runtime/mailbox-batch.ts, classify/refetch.ts, command.ts, commands/mailbox-list.ts, commands/mailbox-resume.ts}`, `apps/worker/test/read-only-ingest.test.ts`, `compose.yaml`, `bridge/entrypoint.sh`, README sections
- imapflow 2.1.0 on disk: `dist/esm/commands/{copy,copyuid-parser,expunge,close,create,select}.js`, `imap-flow.js` (`exec`, `run`, `messageDelete`)
- gluon at Bridge-pinned commit 7e800978ab4a: `internal/state/actions.go` (actionAddMessagesToMailbox, actionRemoveMessagesFromMailboxUnchecked, actionCreateMailbox), `internal/state/state.go` (Create), `internal/state/mailbox_search.go` (SearchKeyHeader)
- proton-bridge v3.27.0: `go.mod` (gluon pin), `internal/services/imapservice/connector.go` (CreateMailbox/createLabel, Add/RemoveMessagesFromMailbox, Trash/Drafts perma-delete)
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md`, `docs/adr/0003-traces-and-mail-app-relabels.md`

### Secondary (MEDIUM confidence)
- Context7 `/websites/docker_compose` (docs.docker.com/compose/how-tos/networking): `internal: true` has no default gateway; dual-attached services keep external access
- ollama `server/routes.go` (main branch): `allowedHost`/`allowedHostsMiddleware`
- RFC 3501 §6.4.2 (SELECT/EXAMINE/LOGOUT close without expunge), §6.4.8 (non-existent UID ignored); RFC 4315 (UID EXPUNGE, COPYUID) `[CITED from memory of the RFC text; standard behaviour]`

### Tertiary (LOW confidence)
- Proton label-name case uniqueness: no authoritative source found (web search inconclusive); the design does not depend on it

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new packages; ImapFlow internals read on disk
- Architecture: HIGH for the gate, records and reconcile (grounded in code and gluon source); MEDIUM for Compose networking on Docker Desktop 20.10
- Pitfalls: HIGH for gluon/ImapFlow/Bridge (source read at pinned versions); MEDIUM for DNS on internal networks

**Research date:** 2026-10-17
**Valid until:** 2026-11-16 (Bridge, gluon and ImapFlow are pinned; re-check if any pin moves)
