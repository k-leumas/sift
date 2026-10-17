# Phase 4: Labels and Real-Inbox Run - Context

**Gathered:** 2026-10-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Sift carries out the decisions Phase 3 already writes. A confident (`labelled`) decision gets its `Labels/<Category>` copy in Proton via Bridge, a `review` decision gets no label, and each one gets an action record saying what was done (or would be done) and when. Every mailbox change is recorded in `label_event`, and every label Sift applies is recorded in `label` as Sift-applied and not owner-confirmed. The owner can print any message's trace from the CLI or with a documented SQL query. The phase ends with a short, supervised end-to-end run on the owner's real Proton mailbox. Sift never sends, deletes, forwards or modifies mail, and nothing leaves the machine except calls to the configured model URL.

Requirements: ACT-01..05, TRC-05, SEC-02, E2E-01. Out of scope: relabel detection and learning, the review queue, and quick confirm (all M2), plus any UI.

</domain>

<decisions>
## Implementation Decisions

### Label mode and switching
- **D-01:** Each mailbox has a label mode: `dry_run`, `apply` or `paused`. It is stored in the database and changed **only by CLI commands** (e.g. `sift labels dry-run|apply|pause|resume <slug>`; the planner sets the exact verbs within the P1 D-24 `parseArgs` style). There are no `config.yaml` keys for the mode and no worker restart is needed. The worker reads the mode from the DB on its next tick (about 60 s, like the registry reread, P1 D-49). The owner asked how switching would look and wanted it to take effect without a manual restart. — **Reversibility:** costly — the mode becomes per-mailbox DB state that `mailbox list`, the worker and the M2 UI all read.
- **D-02:** New mailboxes start in `dry_run`, and so does the existing `personal` mailbox when Phase 4 ships. Nothing is written to any mailbox until the owner runs the apply command.
- **D-03:** Every mode writes an action record. `dry_run` records "would label `<Category>`" (or "held for review: `<reason>`") with a timestamp and never touches IMAP. `apply` records what was actually done. The trace shows the history, e.g. `would label X (dry run, <time>)` and later `labelled X (applied, <time>)`. Action records are new append-only rows. The decision row and its Phase 3 `action` span (status `pending`) are never updated (P3 D-30).
- **D-04:** In `paused`, classification goes on: decisions are written and their actions stay pending. On resume they are applied, newest first, with the same pacing as D-07. Pause means "stop touching my mailbox", not "stop deciding".
- **D-05:** Switching from `dry_run` to `apply` also applies the decisions made during dry run. The command first shows a count per label (e.g. `N messages will be labelled: M in Labels/Newsletters, ...`) and asks for confirmation, like the P2 D-75 count prompt.
- **D-06:** Decisions that exist before Phase 4 ships (Phase 3 `pending` actions, e.g. the owner's 3-day backfill) are applied too once the mailbox is in `apply`. They count as part of the D-05 confirmation.
- **D-07:** Catch-up is bounded per tick: a fixed cap of label actions per mailbox tick (a code constant, about 50; the planner picks the number), newest INTERNALDATE first, so new mail is labelled promptly and Bridge isn't flooded (in the spirit of P3 D-18).
- **D-08:** Switching from `apply` back to `dry_run` or `paused` leaves the labels Sift already applied. There is no undo command in this phase.
- **D-09:** `sift mailbox list` shows each mailbox's label mode and counts, e.g. `labels: paused (N actions waiting)` and `N label actions failed`.

### Label folders
- **D-10:** A missing `Labels/<Category>` folder is created with IMAP `CREATE` on first use (the spike proved this works), and the creation is recorded in `label_event`.
- **D-11:** A new config key, **`labels.case_sensitive`** (boolean, default `false`), goes in the mailbox's `labels` block next to `apply_as`. With `false`, an existing label whose name differs only in case (e.g. `newsletters` for category `Newsletters`) is reused. With `true`, the name must match exactly. The owner first suggested ignore-case, then chose the positive name `case_sensitive` over `ignore_case` and `strict_casing`. Extend the strict schema, `config/config.example.yaml`, its CI test and the README. — **Reversibility:** one-way — strict config makes the key name part of every owner's config (P3 D-25 precedent).
- **D-12:** With `case_sensitive: true`, an existing label that differs only in case holds that category's actions and reports the conflict: actions stay pending, and `mailbox list` names both, e.g. `label conflict: category Newsletters vs existing Labels/newsletters — rename one or set case_sensitive: false`. Other categories keep flowing. Research must check whether Proton/Bridge allows two labels that differ only in case (if it refuses the CREATE, this path applies).
- **D-13:** An existing label with a matching name, even one the owner made, is reused. Only messages Sift copied there (recorded copy UIDs) count as Sift's. The owner's own labelled mail in that folder is never touched, removed or recorded as Sift's.

### Re-runs and edge cases
- **D-14:** A `sift classify` re-run (P3 D-17) that gives a labelled message a different category **moves Sift's label**: remove Sift's old copy by its recorded copy UID, apply the new label, and record both in `label_event`. A message carries at most one Sift label. Labels the owner added are never removed.
- **D-15:** A re-run that sends an already-labelled message to review removes Sift's old label, because the latest decision is current and review means no Sift label.
- **D-16:** If the message is already in `Labels/<Category>` (the owner put it there) and the decision agrees, Sift does not COPY. The action record says `already present, not applied by Sift`, so Sift never owns the owner's label or removes it later. (How "already present" is detected is the planner's choice, e.g. by identity in the label folder.)
- **D-17:** A failed COPY (Bridge says `NO`, the connection drops, or no COPYUID comes back) stays pending and is retried on later ticks. After a few failed ticks (code constant, e.g. 3) the action is recorded as `failed` with the reason, and `mailbox list` shows the count. A COPY without COPYUID is unconfirmed: resync the label folder before any retry so no duplicate is made (spike).
- **D-18:** If the message has no live location in an ingested folder when its action comes up (the owner moved or deleted it), the action is recorded as `skipped: message no longer in INBOX` (wording is the planner's). Sift never follows a message into other folders or Trash.
- **D-19:** `sift labels retry <slug>` puts failed actions back to pending after a count confirmation.

### Trace lookup (TRC-05)
- **D-20:** `sift trace <slug>` supports both search and exact lookup. Search uses `--subject`, `--from` and `--date`: one match prints its trace, several print a short numbered list (date, from, subject, outcome) to narrow down. Exact lookup uses `--message-id '<...>'` (the header value from Proton's "View headers") or `--id <sift id>`. Subject, from address/domain and dates are already columns on `message`.
- **D-21:** The default output is the README "Decision traces" tree, one line per tier, ending with the Action line that shows what actually happened (dry run / applied / already present / held / skipped / failed, and when), plus the versions line. `--json` prints the raw decision, spans, action records and `label_event` rows.
- **D-22:** By default the latest (current) decision is shown, with one line such as `earlier decisions: 2 (use --all)`. `--all` prints every decision oldest to newest, with the label moves between them.
- **D-23:** The full trace is printed, including the LLM reason and raw output, with control characters escaped as in Phase 3. It is the owner's data on the owner's machine.
- **D-24:** The exact-rules span is shown with condition summaries from the rule_set snapshot (e.g. `domain acme.com ✓, phrase "invoice" ✗ → Billing`) and the rule-set version. Judgment rules are shown one line each, truncated.
- **D-25:** When the mailbox's current rule set differs from the one the decision used, the trace adds one hint line, e.g. `rules changed since this decision (r7 → r9); sift classify --message <id> to re-run`. Nothing is re-run automatically.
- **D-26:** There is no decision-listing command. The README gets copy-paste `psql` recipes, like the existing outcome count: held (review) messages with date, from, subject and reason, newest first, plus one query that fetches a single message's spans. The owner chose SQL over a `sift decisions` command; the review queue is M2.
- **D-27:** Nothing from a trace is ever written into the mailbox (TRC-05, ADR-0003).

### Safety guarantees (ACT-05, SEC-02)
- **D-28:** One module issues all IMAP writes. It allows only `CREATE` under `Labels/`, `UID COPY` into `Labels/` from a read-write SELECTed source, and `UID STORE +FLAGS (\Deleted)` + `UID EXPUNGE` of a copy UID Sift itself recorded, inside a label folder (never a plain EXPUNGE, never INBOX). Anything else throws a named error, which is logged and put in the action record. CI asserts that no other code path can issue IMAP write commands. The live run reports a count of IMAP write operations. — **Reversibility:** costly — every later mailbox-writing feature (M2 relabel handling) must go through this gate.
- **D-29:** Egress is shown in two ways. **Lockdown:** Compose limits the worker's network reach to db, bridge and the configured Ollama host (the worker currently reaches Ollama via `host.docker.internal:host-gateway`; research how to allow only that on Docker/OrbStack/Linux). A test proves an outside address is refused, and CI checks there are no telemetry or analytics dependencies. **Observation:** a capture of the worker's outbound connections during the live run, recorded as a summary in 04-LIVE-RUN.md.
- **D-30:** Problems are tracked locally only: worker logs (`docker compose logs worker`, secrets redacted, no email content), `mailbox list` status, traces, action records, `label_event` and the healthcheck. A blocked network call or IMAP command must fail loudly with a specific logged error, never silently. There is no remote error reporting. The owner asked "how will we ever track problems with this approach?", and this is the answer they accepted.

### Real-inbox acceptance (E2E-01)
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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bridge behaviour (locked by the spike)
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md` — "Labels as folders" and "Phase 4 label application": SELECT read-write before COPY, `UID COPY` into `Labels/<name>`, CREATE when missing, COPYUID as the echo record, removal by `\Deleted` + `UID EXPUNGE`, unconfirmed COPY → resync, pause during `folder_sync` resync (D-24)
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-LIVE-INGEST.md` — format precedent for 04-LIVE-RUN.md (aggregates-only data rule)

### Architecture decisions
- `docs/adr/0003-traces-and-mail-app-relabels.md` — action span, echo suppression, nothing written into the mailbox, the addendum on label apply/remove
- `docs/adr/0002-tiered-classification.md` — Sift-applied labels never train the classifier (ACT-04)
- `docs/adr/0001-multiple-mailboxes-single-owner.md` — mailbox_id + RLS on every new table

### Project planning
- `.planning/REQUIREMENTS.md` — ACT-01..05, TRC-05, SEC-02, E2E-01 wording
- `.planning/ROADMAP.md` — Phase 4 success criteria 1–5
- `.planning/phases/03-tiered-classification-with-traces/03-CONTEXT.md` — D-06 label-safe category names, D-15/D-17 re-runs, D-18 pacing, D-27/D-28 decision + span shape, D-30 action records as new append-only rows, D-31 review reason codes
- `.planning/phases/01-foundation-and-isolation/01-CONTEXT.md` — D-24 CLI style, D-37/D-38 catalog test, D-40 append-only grants, D-49 tick/registry reread, D-59 strict config
- `.planning/phases/02-bridge-spike-and-imap-ingest/02-CONTEXT.md` — D-03 per-mailbox lock, D-17 live location, D-24 resync pause, D-75 count confirmation

### Product documentation
- `README.md` §"Decision traces" (tree format for `sift trace`; the "What M1 stores today" paragraph must be updated), the config `labels.apply_as` block, and the security model

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/worker/src/spike/probe.ts`: the label-test path already does SELECT + `UID COPY` + COPYUID check + `\Deleted`/`UID EXPUNGE`. Base the IMAP write gate (D-28) on it.
- `apps/worker/src/imap/connect.ts`, `pin.ts`: pinned ImapFlow connection (imapflow 2.1.0).
- `apps/worker/src/classify/run.ts`, `runtime/mailbox-batch.ts`: the per-mailbox tick where the label step goes after classification (P3 D-14).
- `packages/db/src/schema/scoped.ts`: `label` and `label_event` are key-only stubs (id, mailbox_id, timestamps) waiting for Phase 4 columns. `message` has `subject`, `from_address`, `from_domain`, `message_id_header`, `internal_date` for D-20 search. `message_location` / `folder_sync` hold per-folder UIDs and resync state.
- `apps/worker/src/commands/*`: CLI command pattern (`classify.ts` for count-confirm flows, `mailbox-list.ts` for status output).

### Established Patterns
- Append-only tables with sift_app read/insert grants, plus a custom migration per table (FORCE RLS, grants, updated_at trigger), checked by the catalog test (P1 D-37/D-40).
- The worker reads `config.yaml` only at startup. The registry and other DB state are reread each tick. `rules.yaml` is reread each pass.
- Strict Zod config with an example-config CI test. Logs are redacted (no content, no secrets).

### Integration Points
- The worker tick (after classify) → label action step, gated by the DB label mode.
- `sift mailbox list` → mode and action counts.
- `compose.yaml` worker networks / `extra_hosts` → egress lockdown.
- README quick start and the Decision traces section → `sift labels ...` and `sift trace`.

</code_context>

<specifics>
## Specific Ideas

- The trace output should look like the README "Decision traces" example, with the Action line showing what really happened and when.
- Control is CLI only. The owner wants mode changes picked up without restarting the worker.
- The key is named `case_sensitive` (positive name, snake_case like the rest of `config.yaml`).

</specifics>

<deferred>
## Deferred Ideas

- `sift diagnose`: an owner-run command that bundles redacted logs, status and versions into one file to share when asking for help. Later milestone.
- `sift labels undo <slug> [--since]`: remove Sift's own labels in bulk (raised as an option, not chosen for this phase).
- A `sift decisions` listing command: the owner chose documented SQL for M1, and the review queue is M2.

</deferred>

---

*Phase: 04-labels-and-real-inbox-run*
*Context gathered: 2026-10-17*
