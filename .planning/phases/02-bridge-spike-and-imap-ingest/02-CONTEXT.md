# Phase 2: Bridge Spike and IMAP Ingest - Context

**Gathered:** 2026-10-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Proton Bridge runs inside the Compose stack, and its behaviour is measured against a real Proton mailbox and written down in a findings document (SPK-01..04). The worker then ingests the one configured folder of each configured mailbox into the database through the scoped `@sift/db` API, idempotently and resumably: new mail on every poll, an opt-in bounded backfill, removals tracked, and a safe generational resync when UIDVALIDITY changes (ING-01..04).

Not in this phase: classification, traces and the `decision` rows (Phase 3); applying labels, `label_event` writes and the review hold (Phase 4); polling label folders or relabel learning (M2); IMAP IDLE; any UI.

Numbering: decisions below are this phase's D-01..; Phase 1 decisions are cited as "P1 D-nn".

</domain>

<decisions>
## Implementation Decisions

### Backfill and first sync
- **D-01 [informational]:** By default a mailbox's first sync ingests **only new mail**: the folder's starting point is recorded (current UIDNEXT, and start time as the date watermark) and only mail arriving after it is ingested. — **Superseded by D-74 (2026-10-05): first sync now backfills `ingest.initial_backfill_days` (default 30).**
- **D-02:** Opt-in bounded backfill, for trying out configurations, in two forms:
  - per-mailbox config key `initial_backfill_days` (optional; absent = new mail only). It applies **only on the first sync of a folder** (no `folder_sync` row yet); changing it later does nothing.
  - a CLI one-shot that backfills N days (flag default 3) without touching config.
  — **Reversibility:** one-way — config validation is strict (P1 D-57/D-59), so the key name and placement become part of every owner's config. Planner decides placement (under `imap` or on the mailbox entry) and extends the strict schema, the example config and its CI test (P1 D-61).
- **D-03:** The CLI one-shot and the worker must never ingest the same mailbox at the same time (they are separate processes; P1 D-50's in-process flag is not enough). Mechanism is the planner's choice (e.g. a per-mailbox Postgres advisory lock).
- **D-04:** Ingest is chunked: fetch and store in chunks (e.g. ~50 messages per transaction) and advance `folder_sync` after each committed chunk. A crash or shutdown mid-run resumes from the last committed chunk; P1 D-53 graceful shutdown stops between chunks.

### Stored content and body retention
- **D-05:** IMAP is the source of truth for bodies. Sift does **not** store bodies permanently. — **Reversibility:** costly — Phase 3 replay, M2 Tier-2 examples and M4 evals are designed around refetching from IMAP.
- **D-06:** Body text lives in a separate, mailbox-scoped **body cache table** (never on `message`): text/plain if present, otherwise HTML converted to text, truncated to a cap (~32 KB) with a truncated flag. Attachments are not stored; their names, MIME types and sizes are recorded as metadata.
- **D-07:** Body cache lifetime: no expiry until the message is classified; Phase 3 sets `expires_at = decided_at + 7 days` (window for review / M2 quick confirm); a worker sweep deletes expired rows. A message removed from the folder before it was ever classified (no live location, no decision) has its body-cache row deleted immediately.
- **D-08:** Kept long-term: message metadata, headers, labels and (M2) embeddings. Replay, Tier-2 examples and evals refetch bodies from IMAP by identity; mail the owner deleted drops out of them.
- **D-09:** Traces store the **prompt recipe** (prompt and rule-set versions + example Message-IDs), not raw prompts. This resolves ADR-0003's open prompt-retention item; Phase 3 must follow it. The LLM span's raw *output* (TRC requirements) is unaffected.
- **D-10:** Full-disk encryption (FileVault / LUKS) is documented as a deployment requirement in the README. No column-level encryption for now.
- **D-11:** Ingest never changes the owner's read state or any flag: fetch with `BODY.PEEK` only, never set/clear `\Seen` or other flags. A test asserts a message's flags are identical before and after ingest.

### Message identity
- **D-12:** `message` gets a stable identity key with `UNIQUE (mailbox_id, identity_key)`. The key is prefixed by its source, so kinds never collide and a row shows which one it used:
  - `pm:<id>` — a Proton internal-ID header added by Bridge, **if** the spike finds one present and stable across folders (preferred);
  - `mid:<normalised Message-ID>`;
  - `hdr:<sha256 of stable headers>` — fallback when Message-ID is missing; the spike confirms the hash inputs.
  — **Reversibility:** one-way — the key is the dedup constraint and the refetch handle (D-08); changing it means rekeying every stored message.
- **D-13:** Normalisation is conservative: strip angle brackets and surrounding whitespace; lowercase only the domain part after `@` (the local part is case-sensitive). The spike confirms Bridge preserves the header exactly.
- **D-14:** An identity-key conflict means "same message": upsert that adds a location record, never a failed insert or a second row. The spike counts how often genuinely different emails share a Message-ID in the real mailbox; if meaningful, a tiebreaker (e.g. the Date header) is added to `mid:` keys.
- **D-15:** Location is separate from identity: a mailbox-scoped `message_location` table (`mailbox_id`, `message_id`, `folder`, `uidvalidity`, `uid`, plus `removed_at` and a resync generation), composite FK to `message` (P1 D-04), `UNIQUE (mailbox_id, folder, uidvalidity, uid)`. One message may have several locations (INBOX, `Labels/...`), which later makes relabel detection "gained or lost a location in a label folder". It must pass the P1 D-37 catalog test (non-null `mailbox_id`, forced RLS, standard policy, grants). — **Reversibility:** costly — Phase 4 label application and M2 relabel learning build on it.

### Folders, removals, watermark
- **D-16:** Phase 2 ingest scans the configured `imap.folder` only (default INBOX). Locations in label folders are recorded from Phase 4 (labels Sift applies) and M2 (relabel polling).
- **D-17:** A stored message that disappears from the folder (archived, deleted, moved) gets `removed_at` on its location row; the `message` row stays. Detect via QRESYNC `VANISHED` if the spike finds it works, otherwise a periodic UID-set diff. Phase 3 skips classifying messages with no live location.
- **D-18:** `folder_sync` keeps two watermarks: the last UID (fast path for normal polling under the current UIDVALIDITY) and the latest INTERNALDATE processed (decides "new vs old" after a UIDVALIDITY reset). INTERNALDATE is chosen over the Date header because the sender can't forge it.
- **D-19:** Watermark boundary uses overlap plus dedup: anything with INTERNALDATE after (watermark − 5 minutes) counts as candidate-new; the identity key drops already-ingested ones. Nothing at the boundary is missed or double-processed.
- **D-20:** Intended behaviour (not a bug): an old message moved back into the folder keeps its original INTERNALDATE, so Sift treats it as old and does not classify it.
- **D-21:** Mail older than the watermark / backfill window that Sift sees (e.g. during resync) gets a `message` row and a location but is marked **not eligible for classification** and has no body cache row. Column naming is the planner's.

### UIDVALIDITY resync
- **D-22:** On a UIDVALIDITY change, run a headers-only rescan of the folder (ENVELOPE + identity headers, no bodies) in FETCH batches of ~500 UIDs. Per message:
  - unknown key, INTERNALDATE newer than the watermark (D-19) → new mail, handled normally;
  - unknown key, older → location only, not eligible for classification (D-21);
  - known key → upsert its location;
  - known message not found in the rescan → its location gets `removed_at`.
  Nothing is reclassified: decisions hang off `message`, not location.
- **D-23:** Resync is all-or-nothing via a generation number: new location rows are written tagged with generation N; only when the whole folder is done does one final transaction mark the previous generation superseded. On failure, retry from the start — the previous generation stays authoritative until the new one completes.
- **D-24:** While resyncing, the folder is marked `resyncing` and actions on it (Phase 4 label application) are paused; the old UIDs are stale and must not be used.
- **D-25:** Each resync is logged and persisted with counts, e.g. "INBOX resynced: 1,240 matched, 3 new, 12 gone, 830 older than backfill window". Where it is persisted (`folder_sync` columns or a sync-event record) is the planner's choice.

### Volume safety valve
- **D-26:** If a resync or any single cycle would treat more than a configurable number of messages as new (default 200), Sift does not process them: the mailbox goes to `needs_attention` in `mailbox_status`, the count is logged, and processing waits until the owner runs `sift mailbox resume <slug>`. Fail closed on volume, like the config guards. This adds `needs_attention` to the `mailbox_status.state` check (currently `ok | error | disabled`). An explicit CLI backfill (D-02) is the owner's own request; whether it bypasses the cap is the planner's call, but it must be stated.

### Scheduling
- **D-27:** Polling only (P1 D-49/D-52 supervisor tick, default 60 s); no IMAP IDLE in M1. The spike notes whether Bridge's IDLE works, for later.
- **D-28:** The scheduler gains `nudge(mailboxId)`, which makes a mailbox due immediately while keeping the "never overlaps itself" rule (P1 D-50). Nothing has to call it in Phase 2; a future IDLE listener or a manual `sift mailbox sync <slug>` uses it.

### Bridge deployment
- **D-29:** Proton Bridge runs **in Compose** as a `bridge` service; the worker connects to `bridge:1143`. The port is published to host loopback only: `ports: ["127.0.0.1:1143:1143"]` (reachable from the Mac for host development and spike scripts, not from the network). Host development connects to `localhost:1143`.
- **D-30:** Bridge image is our own Dockerfile that **builds Bridge from source** (`ProtonMail/proton-bridge` on GitHub), pinned to a release tag **and** its commit SHA, built locally (P1 D-21). Self-update is disabled inside the container; updates come only through a new pinned version. — **Reversibility:** costly — the vault/keychain layout and init flow are tied to this image.
- **D-31:** Renovate watches `ProtonMail/proton-bridge` GitHub releases and opens a PR bumping the pinned tag and SHA together (same pattern as the Node version pin, P1 D-68), so the pin doesn't go stale and stop connecting. Renovate is new to this repo (no config yet).
- **D-32:** Bridge gets a healthcheck for visibility only (TCP check on 1143, shows in `docker compose ps`) and `restart: unless-stopped`. The worker does **not** `depends_on` Bridge health.
- **D-33:** Bridge problems are per-mailbox, not worker-wide: an affected mailbox shows a specific error in `mailbox_status` (e.g. "Bridge unreachable", "Bridge rejected login: run `sift bridge init`") with P1 D-51 backoff; other mailboxes and worker health are unaffected.
- **D-34:** Startup grace: for roughly the first minute (or first few attempts) after worker start, connection failures mark the mailbox `connecting`, not `error`, so a normal `docker compose up` where the worker beats Bridge never shows a misleading error. Adds `connecting` to the `mailbox_status.state` check.
- **D-35:** M1 documents **combined address mode**, one Sift mailbox per Proton account. Split mode is deferred (M5).

### Bridge login, vault and secrets
- **D-36 [informational]:** One-time interactive setup: `sift bridge init` (running the Bridge container interactively) — the owner types the Proton password and 2FA without echo; Sift never stores the Proton password. — **Command form superseded by D-72 (2026-10-05).**
- **D-37:** Bridge's session vault and keychain (e.g. `pass` with a GPG key generated at init) live in a named volume `sift-bridge`, declared `external: true` (survives `docker compose down -v`) and excluded from backups. The vault's session tokens are as sensitive as the password; docs say so precisely ("Sift never stores your Proton password; Bridge stores session tokens in the `sift-bridge` volume").
- **D-38:** The GPG key protecting the vault has a passphrase from `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE`, given **only** to the Bridge container and unlocked at startup, so a copied volume alone is useless.
- **D-39:** The Bridge-generated IMAP password never appears in the terminal: init captures it inside the container and **upserts** `NAME=value` into `.env.mailboxes` for each configured mailbox whose IMAP host is Bridge, using that mailbox's `password_env` name. It replaces an existing line rather than appending, keeps a backup of the previous file, creates/keeps the file at mode 0600, and prints only e.g. `wrote SIFT_PERSONAL_IMAP_PASSWORD to .env.mailboxes (mailbox "personal")`. `.env.mailboxes` is bind-mounted read-write into the init run only. Research must find the cleanest extraction route (Bridge's gRPC frontend API preferred over scraping CLI `info` output).

### Bridge TLS
- **D-40:** The worker verifies Bridge by **SPKI public-key pin**, not hostname: a custom `checkServerIdentity` compares the certificate's public-key fingerprint with the pinned one and ignores the hostname (Bridge's cert is for 127.0.0.1/localhost, the worker connects to `bridge` or `localhost`). Only that exact key is accepted. The same pin works for host development.
- **D-41 [informational]:** Bridge init exports its certificate to a small shared volume, writable by Bridge, read-only for the worker. When Bridge's certificate changes (expiry, reinstall), the worker fails closed: "Bridge's certificate changed. Run `sift bridge trust` to review the new fingerprint and accept it." No blind trust-on-first-use. (Importing an owner-generated cert into Bridge is a possible alternative; exporting Bridge's is the chosen path.) — **Superseded by D-73 (2026-10-05): pin lives in config, no shared cert volume.**
- **D-42:** STARTTLS is required, with no plaintext fallback: the IMAP client refuses to log in unless the STARTTLS upgrade succeeded (check ImapFlow's exact option name in its docs). A test with a fake server that doesn't offer STARTTLS asserts the connection fails before any credentials are sent.

### Spike additions (beyond SPK-01..04 as written)
- **D-43:** The spike must also answer:
  - whether Bridge adds a Proton internal-ID header and whether it is present and stable across folders (D-12);
  - how often distinct emails share a Message-ID in the real mailbox (D-14);
  - whether Bridge preserves the Message-ID header byte-for-byte (D-13);
  - **whether INTERNALDATE survives a UIDVALIDITY reset / Bridge cache rebuild** — record several INTERNALDATEs, force a cache reset or resync, compare. If it does not survive, the D-18/D-22 design must change, and the findings say how;
  - whether QRESYNC `VANISHED` works for removals (D-17) and whether IDLE works (D-27, for later);
  - confirmation that combined mode behaves as D-35 assumes.

### Owner answers to research open questions (2026-10-05, after research)
- **D-72:** Bridge init runs **in the Bridge container**: `docker compose run --rm bridge init` (an `init` mode of the Bridge image's entrypoint). Only that container mounts the vault. The `sift bridge …` namespace is kept for worker-side commands such as `sift bridge trust`.
- **D-73:** The trusted Bridge certificate is a **SPKI SHA-256 fingerprint in `config.yaml`** at `imap.tls.pin_sha256` — not a shared certificate file or volume, not a DB table. `bridge init` prints the fingerprint; `sift bridge trust` connects and shows the fingerprint the worker actually sees; the owner compares and pastes it into config. A regenerated Bridge certificate therefore fails closed (D-40 pin check) instead of being trusted automatically. — **Reversibility:** one-way (config key name, strict schema).
- **D-74:** New config keys, all **optional with defaults, so no config version bump**:
  - `imap.tls.mode`: `starttls` | `implicit` (default `starttls`; D-42 still forbids any plaintext fallback);
  - `imap.tls.pin_sha256`: optional (needed for Bridge; may be omitted for servers with a public-CA certificate, which then use normal chain + hostname verification);
  - `ingest.initial_backfill_days`: default **30** (replaces D-01's "new mail only" default and fixes D-02's placement);
  - `ingest.new_mail_cap`: default **200** (the D-26 cap);
  - `worker.poll_interval_seconds`: default **60** (D-27).
  — **Reversibility:** one-way — strict config validation makes these names part of every owner's config. Extend the strict schema, the example config and its CI test (P1 D-61).
- **D-75:** Backfill vs the cap: the **first** backfill of a folder (from `ingest.initial_backfill_days`) is **not** stopped by `ingest.new_mail_cap`, but runs **throttled at low priority** and reports progress in `mailbox_status`. Any later backfill is an **explicit CLI command that shows the message count and asks for confirmation first**. Everything else — normal polling and UIDVALIDITY resyncs — stays under the cap (D-26). This answers D-26's "state whether the CLI backfill bypasses the cap".
- **D-76 [deferred]:** `sift mailbox sync <slug>` is **deferred**. The internal `nudge(mailboxId)` hook (D-28) is still built.
- **D-77:** Dependencies: imapflow and libmime are **approved**, with conditions: pin **exact** versions (no ranges); verify licenses (expected MIT) of them and their transitive tree; block install scripts by keeping pnpm's `onlyBuiltDependencies` allow-list excluding them; review the resolved dependency tree before committing the lockfile. A **MIME body parser is chosen now** for Phase 3: **`postal-mime`** (zero runtime dependencies, MIT-0) over `mailparser` (whose current release pulls a second libmime/mailsplit version plus nodemailer, linkify-it, tlds, he). Same conditions apply (exact pin, version older than the repo's 7-day release gate, license check).

- **D-78:** The `ingest` block is **per mailbox**: `mailboxes[].ingest.initial_backfill_days` and `mailboxes[].ingest.new_mail_cap` (placement for D-74's keys).
- **D-79:** Bridge init is a **separate one-shot Compose service** `bridge-init` (same `sift-bridge` image, `profiles: ["tools"]` so `docker compose up` never starts it, `command: init`), mounting `sift-bridge:/data`, `./.env.mailboxes:/run/sift/.env.mailboxes` and `./config:/run/sift/config`. The owner runs `docker compose run --rm bridge-init` (refines D-72's command form; no `-v` flags, since relative `run -v` paths behave inconsistently across Compose versions). The long-running `bridge` service mounts **only** `sift-bridge` and never sees the IMAP password file or config, which keeps D-39's "init run only". The backup of the previous file is written **on the host** as `.env.mailboxes.bak` next to the original, mode 0600 (not into the Bridge volume).
- **D-80:** TLS pin flow for D-73 — the governing rule is **"Never send credentials or data over an unverified connection."**
  - **Capture connection:** certificate verification is off, but the socket does nothing beyond the TLS handshake (and STARTTLS): no LOGIN/AUTHENTICATE and no other IMAP command is ever written to it. A test asserts this on the wire, not only by grep.
  - **Login connection:** fully verified — `ca: [capturedPem]` **plus** a `checkServerIdentity` that re-checks the SPKI pin (Node calls it only after the chain verifies), so the connection carrying credentials is verified twice; a server that changes its certificate between the two connections fails here.
  - The captured certificate is kept **in memory only** and recaptured on every reconnect or certificate error; nothing is written to disk (consistent with D-73).
  - This supersedes RESEARCH's "never write the verification-disabling literal anywhere" for the capture step only, which satisfies the rule above rather than breaking it.

- **D-81:** Host-side backup mechanism for D-79 (single-file bind mounts cannot create sibling files on the host): `bridge-init` gets a **fourth bind mount, on bridge-init only**, in long syntax (`type: bind`, `source: ./.env.mailboxes.bak`, `target: /run/sift/.env.mailboxes.bak`) so a missing file is never auto-created as a directory. The owner pre-creates it once (`touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak`, a quick-start step). The container writes the backup **in place** (truncate + write into the existing file), **never via an atomic rename** — a rename over a bind-mounted file fails or detaches it. The same in-place rule applies to `.env.mailboxes` itself. The `bridge` service still mounts only `sift-bridge`.

### Owner answers after cross-AI review round 1 (2026-10-05)
- **D-82:** Fallback identity keys are versioned: `hdr:v1:<sha256>` (refines D-12's `hdr:<sha256>`); a change to the hash inputs adds `hdr:v2:` beside stored keys. No D-12 unversioned key can already be stored (no `identity_key` column exists before 02-03, and its 0005 preflight refuses a database with `message` rows), so no migration or dual-read is needed; the `message_identity_key_check` constraint requires `hdr:v<n>:<64 hex>` so one can never appear.
- **D-83:** The first-sync watermark floor stays 10 minutes below now, as the named constant `FIRST_SYNC_CLOCK_ALLOWANCE_MS`, and the `first sync watermark` log line includes the computed watermark (ISO 8601 UTC) as well as its age.
- **D-84:** Before setting `ingest.initial_backfill_days: 0` for the spike, the owner gives the value to use afterwards; it is recorded in 02-SPIKE-FINDINGS.md as `**Post-spike initial_backfill_days:** <N>`, and 02-19 checks config matches it before starting the worker.
- **D-85:** For the live run (02-19) the owner intends `ready: repair` and sends the test email from an external (non-Proton) account.
- **D-86:** If the live run falls back to the simulated UIDVALIDITY mismatch, 02-LIVE-INGEST.md says "Bridge's own UIDVALIDITY change was not observed" and the result is `partial`, not `pass`.

### Claude's Discretion
- **Header set** stored per message (user said "you decide"): must cover Phase 3 exact rules (sender, domain, phrase in subject/body) and the `hdr:` identity fallback; typed columns vs JSONB is the planner's.
- **Spike method** (not discussed): default is a scripted, repeatable probe (kept in-repo so it can be rerun after Bridge upgrades) plus a findings document under the phase directory. It may modify the real mailbox only in a bounded way the owner approves at run time: apply/remove a dedicated test label on a test message, and force a Bridge resync. It never deletes, sends or moves mail outside that test.
- **CLI surface** (not discussed): names/grouping for the backfill one-shot, `sift mailbox resume`, optional `sift mailbox sync`, `sift bridge init`, `sift bridge trust`; follows the existing `node:util` `parseArgs` dispatch (P1 D-24) and P1 error-message style. Never mention purge (P1 D-69).
- **Ingest observability** (not discussed): what `sift mailbox list` shows (state incl. `connecting`/`needs_attention`, last sync, counts) and the per-run log lines.
- IMAP library (ImapFlow expected), chunk sizes, body cap exact value, sweep cadence, grace-period length, column names.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked architecture decisions
- `docs/adr/0003-traces-and-mail-app-relabels.md` — polling-based relabel model, CONDSTORE/QRESYNC where supported, UIDVALIDITY stored with full resync, identity by Message-ID with stable-header-hash fallback, echo suppression; the M1 spike requirement. D-09 resolves its open prompt-retention item.
- `docs/adr/0001-multiple-mailboxes-single-owner.md` — mailbox isolation, RLS on `app.mailbox_id`, `password_env` credentials; every new table (`message_location`, body cache) follows it.
- `docs/adr/0002-tiered-classification.md` — context for what Phase 3 needs from stored content and headers.

### Project scope and requirements
- `.planning/REQUIREMENTS.md` — SPK-01..04, ING-01..04
- `.planning/ROADMAP.md` — Phase 2 goal and success criteria 1-5
- `.planning/PROJECT.md` — constraints and Key Decisions
- `.planning/phases/01-foundation-and-isolation/01-CONTEXT.md` — P1 D-01..D-71 (schema shape, scoped API, worker supervisor, config strictness, roles, catalog test); its deferred note on Bridge address mode is resolved by D-35

### Product documentation
- `README.md` — config structure, quick start, security model (gets the full-disk-encryption requirement, Bridge setup and combined-mode note)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/worker/src/runtime/mailbox-batch.ts` — the no-op per-mailbox batch from P1 D-49; ingest plugs in here.
- `apps/worker/src/runtime/supervisor.ts` — scheduler; gains `nudge()` (D-28) and the new states.
- `apps/worker/src/runtime/backoff.ts` — P1 D-51 exponential backoff, reused for Bridge failures.
- `packages/db/src/schema/scoped.ts` — `message`, `folder_sync`, `mailbox_status` (state check `ok|error|disabled`, line ~50) to extend; new tables follow the same composite-key pattern.
- `apps/worker/src/cli.ts` + `apps/worker/src/commands/` — `parseArgs` CLI dispatch for the new commands.
- `packages/core/src/config/` — strict Zod config schema to extend for `initial_backfill_days` and the new-message cap.
- `compose.yaml`, `.env.mailboxes.example` — gain the `bridge` service, volumes and `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE`.

### Established Patterns
- Every table-adding generated migration is paired with a custom SQL migration (FORCE RLS + explicit GRANTs + `set_updated_at` trigger); the catalog test fails the build on drift.
- Apps reach the DB only via the scoped `@sift/db` API (Biome bans `pg`/`drizzle-orm` imports in `apps/**`); processing entry points call `requireActive`.
- Error messages report all problems at once, name variables never values, and suggest the fix.

### Integration Points
- Phase 3 reads the body cache, honours "eligible for classification" and live location, and sets body `expires_at` (D-07).
- Phase 4 applies labels via `message_location` and must respect `resyncing` (D-24).

</code_context>

<specifics>
## Specific Ideas

- Fail closed everywhere it's cheap: volume cap → `needs_attention`, cert change → `sift bridge trust`, no STARTTLS → no login, partial resync → previous generation stays authoritative.
- Secrets never pass through the owner's terminal or scrollback (D-39).
- A routine `docker compose up` should never show a misleading error (D-34).
- Make rare events visible with counts (resync summary, D-25).

</specifics>

<deferred>
## Deferred Ideas

- IMAP IDLE wake-up via `nudge()` — later; polling is enough for M1.
- Polling `Labels/*` folders / relabel learning — M2.
- Split address mode, one Sift mailbox per Proton address — M5.
- Column-level encryption of stored data — not now; full-disk encryption is the requirement.
- Owner-generated certificate imported into Bridge — alternative to exporting Bridge's own, not needed.

</deferred>

---

*Phase: 02-bridge-spike-and-imap-ingest*
*Context gathered: 2026-10-05*
