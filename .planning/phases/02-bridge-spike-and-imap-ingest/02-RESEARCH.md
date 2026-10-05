# Phase 2: Bridge Spike and IMAP Ingest - Research

**Researched:** 2026-10-05
**Domain:** Proton Bridge (Go, gluon IMAP server) in Docker; IMAP polling ingest in Node 26 / TypeScript with ImapFlow; Postgres 18 schema under forced RLS
**Confidence:** HIGH for Bridge internals, ImapFlow and TLS behaviour (read from source and probed at runtime this session); MEDIUM for the sync-engine shape (design reasoning grounded in verified facts); the live-mailbox answers stay open until the spike runs.

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

#### Backfill and first sync
- **D-01:** By default a mailbox's first sync ingests **only new mail**: the folder's starting point is recorded (current UIDNEXT, and start time as the date watermark) and only mail arriving after it is ingested.
- **D-02:** Opt-in bounded backfill, for trying out configurations, in two forms:
  - per-mailbox config key `initial_backfill_days` (optional; absent = new mail only). It applies **only on the first sync of a folder** (no `folder_sync` row yet); changing it later does nothing.
  - a CLI one-shot that backfills N days (flag default 3) without touching config.
  — **Reversibility:** one-way — config validation is strict (P1 D-57/D-59), so the key name and placement become part of every owner's config. Planner decides placement (under `imap` or on the mailbox entry) and extends the strict schema, the example config and its CI test (P1 D-61).
- **D-03:** The CLI one-shot and the worker must never ingest the same mailbox at the same time (they are separate processes; P1 D-50's in-process flag is not enough). Mechanism is the planner's choice (e.g. a per-mailbox Postgres advisory lock).
- **D-04:** Ingest is chunked: fetch and store in chunks (e.g. ~50 messages per transaction) and advance `folder_sync` after each committed chunk. A crash or shutdown mid-run resumes from the last committed chunk; P1 D-53 graceful shutdown stops between chunks.

#### Stored content and body retention
- **D-05:** IMAP is the source of truth for bodies. Sift does **not** store bodies permanently. — **Reversibility:** costly — Phase 3 replay, M2 Tier-2 examples and M4 evals are designed around refetching from IMAP.
- **D-06:** Body text lives in a separate, mailbox-scoped **body cache table** (never on `message`): text/plain if present, otherwise HTML converted to text, truncated to a cap (~32 KB) with a truncated flag. Attachments are not stored; their names, MIME types and sizes are recorded as metadata.
- **D-07:** Body cache lifetime: no expiry until the message is classified; Phase 3 sets `expires_at = decided_at + 7 days` (window for review / M2 quick confirm); a worker sweep deletes expired rows. A message removed from the folder before it was ever classified (no live location, no decision) has its body-cache row deleted immediately.
- **D-08:** Kept long-term: message metadata, headers, labels and (M2) embeddings. Replay, Tier-2 examples and evals refetch bodies from IMAP by identity; mail the owner deleted drops out of them.
- **D-09:** Traces store the **prompt recipe** (prompt and rule-set versions + example Message-IDs), not raw prompts. This resolves ADR-0003's open prompt-retention item; Phase 3 must follow it. The LLM span's raw *output* (TRC requirements) is unaffected.
- **D-10:** Full-disk encryption (FileVault / LUKS) is documented as a deployment requirement in the README. No column-level encryption for now.
- **D-11:** Ingest never changes the owner's read state or any flag: fetch with `BODY.PEEK` only, never set/clear `\Seen` or other flags. A test asserts a message's flags are identical before and after ingest.

#### Message identity
- **D-12:** `message` gets a stable identity key with `UNIQUE (mailbox_id, identity_key)`. The key is prefixed by its source, so kinds never collide and a row shows which one it used:
  - `pm:<id>` — a Proton internal-ID header added by Bridge, **if** the spike finds one present and stable across folders (preferred);
  - `mid:<normalised Message-ID>`;
  - `hdr:<sha256 of stable headers>` — fallback when Message-ID is missing; the spike confirms the hash inputs.
  — **Reversibility:** one-way — the key is the dedup constraint and the refetch handle (D-08); changing it means rekeying every stored message.
- **D-13:** Normalisation is conservative: strip angle brackets and surrounding whitespace; lowercase only the domain part after `@` (the local part is case-sensitive). The spike confirms Bridge preserves the header exactly.
- **D-14:** An identity-key conflict means "same message": upsert that adds a location record, never a failed insert or a second row. The spike counts how often genuinely different emails share a Message-ID in the real mailbox; if meaningful, a tiebreaker (e.g. the Date header) is added to `mid:` keys.
- **D-15:** Location is separate from identity: a mailbox-scoped `message_location` table (`mailbox_id`, `message_id`, `folder`, `uidvalidity`, `uid`, plus `removed_at` and a resync generation), composite FK to `message` (P1 D-04), `UNIQUE (mailbox_id, folder, uidvalidity, uid)`. One message may have several locations (INBOX, `Labels/...`), which later makes relabel detection "gained or lost a location in a label folder". It must pass the P1 D-37 catalog test (non-null `mailbox_id`, forced RLS, standard policy, grants). — **Reversibility:** costly — Phase 4 label application and M2 relabel learning build on it.

#### Folders, removals, watermark
- **D-16:** Phase 2 ingest scans the configured `imap.folder` only (default INBOX). Locations in label folders are recorded from Phase 4 (labels Sift applies) and M2 (relabel polling).
- **D-17:** A stored message that disappears from the folder (archived, deleted, moved) gets `removed_at` on its location row; the `message` row stays. Detect via QRESYNC `VANISHED` if the spike finds it works, otherwise a periodic UID-set diff. Phase 3 skips classifying messages with no live location.
- **D-18:** `folder_sync` keeps two watermarks: the last UID (fast path for normal polling under the current UIDVALIDITY) and the latest INTERNALDATE processed (decides "new vs old" after a UIDVALIDITY reset). INTERNALDATE is chosen over the Date header because the sender can't forge it.
- **D-19:** Watermark boundary uses overlap plus dedup: anything with INTERNALDATE after (watermark − 5 minutes) counts as candidate-new; the identity key drops already-ingested ones. Nothing at the boundary is missed or double-processed.
- **D-20:** Intended behaviour (not a bug): an old message moved back into the folder keeps its original INTERNALDATE, so Sift treats it as old and does not classify it.
- **D-21:** Mail older than the watermark / backfill window that Sift sees (e.g. during resync) gets a `message` row and a location but is marked **not eligible for classification** and has no body cache row. Column naming is the planner's.

#### UIDVALIDITY resync
- **D-22:** On a UIDVALIDITY change, run a headers-only rescan of the folder (ENVELOPE + identity headers, no bodies) in FETCH batches of ~500 UIDs. Per message:
  - unknown key, INTERNALDATE newer than the watermark (D-19) → new mail, handled normally;
  - unknown key, older → location only, not eligible for classification (D-21);
  - known key → upsert its location;
  - known message not found in the rescan → its location gets `removed_at`.
  Nothing is reclassified: decisions hang off `message`, not location.
- **D-23:** Resync is all-or-nothing via a generation number: new location rows are written tagged with generation N; only when the whole folder is done does one final transaction mark the previous generation superseded. On failure, retry from the start — the previous generation stays authoritative until the new one completes.
- **D-24:** While resyncing, the folder is marked `resyncing` and actions on it (Phase 4 label application) are paused; the old UIDs are stale and must not be used.
- **D-25:** Each resync is logged and persisted with counts, e.g. "INBOX resynced: 1,240 matched, 3 new, 12 gone, 830 older than backfill window". Where it is persisted (`folder_sync` columns or a sync-event record) is the planner's choice.

#### Volume safety valve
- **D-26:** If a resync or any single cycle would treat more than a configurable number of messages as new (default 200), Sift does not process them: the mailbox goes to `needs_attention` in `mailbox_status`, the count is logged, and processing waits until the owner runs `sift mailbox resume <slug>`. Fail closed on volume, like the config guards. This adds `needs_attention` to the `mailbox_status.state` check (currently `ok | error | disabled`). An explicit CLI backfill (D-02) is the owner's own request; whether it bypasses the cap is the planner's call, but it must be stated.

#### Scheduling
- **D-27:** Polling only (P1 D-49/D-52 supervisor tick, default 60 s); no IMAP IDLE in M1. The spike notes whether Bridge's IDLE works, for later.
- **D-28:** The scheduler gains `nudge(mailboxId)`, which makes a mailbox due immediately while keeping the "never overlaps itself" rule (P1 D-50). Nothing has to call it in Phase 2; a future IDLE listener or a manual `sift mailbox sync <slug>` uses it.

#### Bridge deployment
- **D-29:** Proton Bridge runs **in Compose** as a `bridge` service; the worker connects to `bridge:1143`. The port is published to host loopback only: `ports: ["127.0.0.1:1143:1143"]` (reachable from the Mac for host development and spike scripts, not from the network). Host development connects to `localhost:1143`.
- **D-30:** Bridge image is our own Dockerfile that **builds Bridge from source** (`ProtonMail/proton-bridge` on GitHub), pinned to a release tag **and** its commit SHA, built locally (P1 D-21). Self-update is disabled inside the container; updates come only through a new pinned version. — **Reversibility:** costly — the vault/keychain layout and init flow are tied to this image.
- **D-31:** Renovate watches `ProtonMail/proton-bridge` GitHub releases and opens a PR bumping the pinned tag and SHA together (same pattern as the Node version pin, P1 D-68), so the pin doesn't go stale and stop connecting. Renovate is new to this repo (no config yet).
- **D-32:** Bridge gets a healthcheck for visibility only (TCP check on 1143, shows in `docker compose ps`) and `restart: unless-stopped`. The worker does **not** `depends_on` Bridge health.
- **D-33:** Bridge problems are per-mailbox, not worker-wide: an affected mailbox shows a specific error in `mailbox_status` (e.g. "Bridge unreachable", "Bridge rejected login: run `sift bridge init`") with P1 D-51 backoff; other mailboxes and worker health are unaffected.
- **D-34:** Startup grace: for roughly the first minute (or first few attempts) after worker start, connection failures mark the mailbox `connecting`, not `error`, so a normal `docker compose up` where the worker beats Bridge never shows a misleading error. Adds `connecting` to the `mailbox_status.state` check.
- **D-35:** M1 documents **combined address mode**, one Sift mailbox per Proton account. Split mode is deferred (M5).

#### Bridge login, vault and secrets
- **D-36:** One-time interactive setup: `sift bridge init` (running the Bridge container interactively) — the owner types the Proton password and 2FA without echo; Sift never stores the Proton password.
- **D-37:** Bridge's session vault and keychain (e.g. `pass` with a GPG key generated at init) live in a named volume `sift-bridge`, declared `external: true` (survives `docker compose down -v`) and excluded from backups. The vault's session tokens are as sensitive as the password; docs say so precisely ("Sift never stores your Proton password; Bridge stores session tokens in the `sift-bridge` volume").
- **D-38:** The GPG key protecting the vault has a passphrase from `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE`, given **only** to the Bridge container and unlocked at startup, so a copied volume alone is useless.
- **D-39:** The Bridge-generated IMAP password never appears in the terminal: init captures it inside the container and **upserts** `NAME=value` into `.env.mailboxes` for each configured mailbox whose IMAP host is Bridge, using that mailbox's `password_env` name. It replaces an existing line rather than appending, keeps a backup of the previous file, creates/keeps the file at mode 0600, and prints only e.g. `wrote SIFT_PERSONAL_IMAP_PASSWORD to .env.mailboxes (mailbox "personal")`. `.env.mailboxes` is bind-mounted read-write into the init run only. Research must find the cleanest extraction route (Bridge's gRPC frontend API preferred over scraping CLI `info` output).

#### Bridge TLS
- **D-40:** The worker verifies Bridge by **SPKI public-key pin**, not hostname: a custom `checkServerIdentity` compares the certificate's public-key fingerprint with the pinned one and ignores the hostname (Bridge's cert is for 127.0.0.1/localhost, the worker connects to `bridge` or `localhost`). Only that exact key is accepted. The same pin works for host development.
- **D-41:** Bridge init exports its certificate to a small shared volume, writable by Bridge, read-only for the worker. When Bridge's certificate changes (expiry, reinstall), the worker fails closed: "Bridge's certificate changed. Run `sift bridge trust` to review the new fingerprint and accept it." No blind trust-on-first-use. (Importing an owner-generated cert into Bridge is a possible alternative; exporting Bridge's is the chosen path.)
- **D-42:** STARTTLS is required, with no plaintext fallback: the IMAP client refuses to log in unless the STARTTLS upgrade succeeded (check ImapFlow's exact option name in its docs). A test with a fake server that doesn't offer STARTTLS asserts the connection fails before any credentials are sent.

#### Spike additions (beyond SPK-01..04 as written)
- **D-43:** The spike must also answer:
  - whether Bridge adds a Proton internal-ID header and whether it is present and stable across folders (D-12);
  - how often distinct emails share a Message-ID in the real mailbox (D-14);
  - whether Bridge preserves the Message-ID header byte-for-byte (D-13);
  - **whether INTERNALDATE survives a UIDVALIDITY reset / Bridge cache rebuild** — record several INTERNALDATEs, force a cache reset or resync, compare. If it does not survive, the D-18/D-22 design must change, and the findings say how;
  - whether QRESYNC `VANISHED` works for removals (D-17) and whether IDLE works (D-27, for later);
  - confirmation that combined mode behaves as D-35 assumes.

### Claude's Discretion
- **Header set** stored per message (user said "you decide"): must cover Phase 3 exact rules (sender, domain, phrase in subject/body) and the `hdr:` identity fallback; typed columns vs JSONB is the planner's.
- **Spike method** (not discussed): default is a scripted, repeatable probe (kept in-repo so it can be rerun after Bridge upgrades) plus a findings document under the phase directory. It may modify the real mailbox only in a bounded way the owner approves at run time: apply/remove a dedicated test label on a test message, and force a Bridge resync. It never deletes, sends or moves mail outside that test.
- **CLI surface** (not discussed): names/grouping for the backfill one-shot, `sift mailbox resume`, optional `sift mailbox sync`, `sift bridge init`, `sift bridge trust`; follows the existing `node:util` `parseArgs` dispatch (P1 D-24) and P1 error-message style. Never mention purge (P1 D-69).
- **Ingest observability** (not discussed): what `sift mailbox list` shows (state incl. `connecting`/`needs_attention`, last sync, counts) and the per-run log lines.
- IMAP library (ImapFlow expected), chunk sizes, body cap exact value, sweep cadence, grace-period length, column names.

### Deferred Ideas (OUT OF SCOPE)
- IMAP IDLE wake-up via `nudge()` — later; polling is enough for M1.
- Polling `Labels/*` folders / relabel learning — M2.
- Split address mode, one Sift mailbox per Proton address — M5.
- Column-level encryption of stored data — not now; full-disk encryption is the requirement.
- Owner-generated certificate imported into Bridge — alternative to exporting Bridge's own, not needed.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPK-01 | Label folders documented from a real mailbox: `Labels/<name>` naming, apply/remove, multi-folder presence | §Pre-spike evidence (Bridge source: `Labels`/`Folders` prefixes, COPY = label, EXPUNGE from a label folder = unlabel); §Spike probe design steps 3-5 |
| SPK-02 | CONDSTORE/QRESYNC support (advertised and observed) | Gluon caps read from source and the live 3.27.0 greeting: no CONDSTORE, QRESYNC or ENABLE; probe still runs ENABLE/STATUS HIGHESTMODSEQ against the logged-in account |
| SPK-03 | Message-ID consistency across INBOX and label folders; how often missing or duplicated; is a header hash viable | Bridge adds `X-Pm-Internal-Id` to every IMAP-built message and synthesises `Message-Id` when it is missing (source-verified); probe compares raw header bytes across folders and counts duplicates |
| SPK-04 | UIDVALIDITY across restarts and resyncs; findings name the sync capability later work must assume and what Phase 4 must do | UIDVALIDITY = epoch-seconds generator, assigned when gluon creates a mailbox; INTERNALDATE comes from Proton's server `Time`; probe recipe for restart / `repair` / re-login |
| ING-01 | Worker connects through Bridge with the env password, reads the configured folder | ImapFlow `secure:false` + `doSTARTTLS:true` + `tls.ca` + custom `checkServerIdentity` (verified); socat bind on the container IP; per-mailbox error classes |
| ING-02 | Stored once with mailbox_id, UID, UIDVALIDITY, Message-ID (or fallback), headers and body text; no duplicates on rerun | `message.identity_key` + `UNIQUE(mailbox_id, identity_key)`, `message_location` unique key, body cache table, scoped-API `upsert` extension, NUL stripping |
| ING-03 | New mail picked up on the polling interval without a restart | Poll algorithm (EXAMINE, UIDNEXT compare, `UID FETCH last+1:*` with the RFC 3501 `n:*` filter), supervisor loop already ticks at the interval |
| ING-04 | `folder_sync` records UIDVALIDITY and position; a change triggers a safe resync with no duplicates or reclassification | Generation-tagged rescan (D-22/D-23), headers-only FETCH in batches of 500, `resyncing` state, INTERNALDATE watermark, volume valve |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Collected from `./CLAUDE.md` (OpenWolf), `.wolf/OPENWOLF.md`, `.claude/rules/openwolf.md`, `.wolf/cerebrum.md`, and the user's global CLAUDE.md. The planner must keep every plan compatible with these:

- **OpenWolf protocol:** check `.wolf/anatomy.md` before reading files; read `.wolf/cerebrum.md` (Do-Not-Repeat) before generating code; after creating or renaming files, update `.wolf/anatomy.md` and append to `.wolf/memory.md`; log every bug, failed test or failed build to `.wolf/buglog.json`.
- **Tooling directories are code:** `.claude/`, `.wolf/`, `.gsd/`, `.planning/` and `CLAUDE.md` are committed like source. Scan them for secrets first.
- **Commits:** lefthook runs Biome and commitlint. Header and body lines must be 100 characters or fewer. Never use `--no-verify`. Subjects must not start with an upper-case token (`fix(02): ... (CR-01)`, not `fix(02): CR-01 ...`). Commit with an explicit pathspec (`git commit -- <files>`), because the index holds the user's pre-staged `.wolf` files.
- **Shell:** agent Bash is zsh. Use arrays (`FILES=(a b); git add "${FILES[@]}"`), `command cp -f` (cp is aliased to `-i`), `printf '%s\n'` for strings with backslashes, and `PATH=$HOME/.nvm/versions/node/v26.10.0/bin:$HOME/Library/pnpm:$PATH` with `unfunction pnpm` first.
- **Secrets guard:** any Bash command whose text names `.env` or `.env.<suffix>` is blocked. Generate env files with scratchpad scripts that never print values. (This also affects how tests and probes name `.env.mailboxes` paths in shell commands.)
- **Apps reach the DB only through the scoped `@sift/db` API.** Biome bans `pg` and `drizzle-orm` imports under `apps/**/src/**`, and `@sift/worker` has no `pg` dependency (apps tests must not import pg either).
- **Every new mail-derived table:** NOT NULL `mailbox_id` FK, ENABLE+FORCE RLS, exactly one standard policy, `UNIQUE (mailbox_id, id)`, mailbox-paired child FKs, explicit grants and a `set_updated_at` trigger. Pair each generated migration with a custom one, and update `SCOPED_TABLE_NAMES`, `seedScopedRows` and the isolation tests.
- **Error messages** report all problems at once, name variables never values, and suggest the fix. Never mention purge (P1 D-69); `user-facing-text.test.ts` scans docs and `src`.
- **Supply-chain gate:** `minimumReleaseAge: 10080` (7 days) in `pnpm-workspace.yaml`. Exact pins only: `--save-exact` does not pin ranges, so hand-pin and rerun `pnpm install`.
- **Negative greps in acceptance criteria also scan comments.** Never write a forbidden literal (for example `rejectUnauthorized: false`) in a comment of a checked file.
- **Global (user):** put presentational offsets in CSS (not relevant here); leave time to run gsd-pause-work near 90% of the usage limit.

## Summary

Most of Phase 2's risk is in Proton Bridge, and most of it can be settled before the live spike by reading the pinned Bridge source and running the built binary. I did both this session. Bridge **v3.27.0** (latest stable; commit `04e46eb4fbc1c7ef4425a920bfc352050da0606b`) builds from source in Docker with `make build-nogui` on `golang:1.26.7-trixie` plus `libfido2-dev libcbor-dev libsecret-1-dev`, in about 205 s, producing a ~159 MB image. Its IMAP server, gluon, advertises exactly `AUTH=PLAIN ID IDLE IMAP4rev1 MOVE STARTTLS UIDPLUS UNSELECT`, with **no CONDSTORE, QRESYNC or ENABLE**. Removals therefore have to be found by a polling UID-set diff, and later relabel learning must assume polling only. Bridge stamps every IMAP-built message with `X-Pm-Internal-Id: <Proton message ID>`, overwriting any copy the sender supplied, so the `pm:` identity key (D-12) is close to certain. It is also the only key a sender cannot forge to make Sift drop their mail as a duplicate. INTERNALDATE comes from Proton's server-side `Time`, so it should survive cache rebuilds. The live spike confirms both.

Four deployment facts change how plans must be written. (1) Bridge listens on `127.0.0.1` only (a hard-coded constant). socat inside the container must bind the **container IP**, because binding `0.0.0.0:1143` fails with "Address already in use" (probed). (2) If the keychain is unusable, Bridge **silently falls back to an unencrypted vault** ("the vault will not be encrypted", probed). The entrypoint must check that the gpg/pass keychain can decrypt before it starts Bridge, and refuse to start otherwise. `gpg-preset-passphrase` (in `/usr/lib/gnupg`) with `allow-preset-passphrase` and a raised `max-cache-ttl` (the default is 2 h) unlocks it unattended (probed). (3) Node calls `checkServerIdentity` **only after the certificate chain verifies**. With `rejectUnauthorized: false` the pin check is silently skipped (probed). The pin therefore needs `ca: [trustedPem]` plus a custom `checkServerIdentity` that compares SPKI. (4) Compose 2.2.3 fails **every** `up` and `run` when an `external: true` volume does not exist (probed), so `sift-bridge` has to be created before any compose command, including in compose-smoke and CI.

On the ingest side the stack is ImapFlow 2.x (TypeScript types bundled, BODY.PEEK everywhere, EXAMINE via `readOnly`, `doSTARTTLS: true` throws before LOGIN when STARTTLS is missing), plus `html-to-text` and `libmime` for header parsing. The sync engine should be a pure module behind a small `FolderSource` interface. That lets idempotency, chunking, generation resync and the volume valve be unit-tested with an in-memory fake, while the ImapFlow adapter is tested against a Dovecot 2.4 container, which supports STARTTLS and can force a UIDVALIDITY change with `doveadm mailbox update --uid-validity`. The scoped `@sift/db` API needs three additions: an ON CONFLICT upsert, a per-mailbox ingest lock on a dedicated connection (a session advisory lock; running chunk transactions on that same connection avoids pool deadlock), and the new tables.

**Primary recommendation:** Plan the phase in this order: Bridge image, init and trust; then the scripted spike with an owner checkpoint (findings doc plus ADR-0003 addendum); then the schema; then the sync engine; then the adapter and worker. Write the `pm:`-first identity and polling-only removal path now, since the source evidence makes them near-certain. The spike *confirms* them; it does not *gate* the schema work.

## Pre-spike evidence: what is already known vs what only the live spike can answer

| Question | Already established (this session) | Live spike must still confirm |
|---|---|---|
| CONDSTORE / QRESYNC / ENABLE (SPK-02) | Not advertised. Gluon builds caps from `imap.IMAP4rev1, imap.UNSELECT, imap.UIDPLUS, imap.MOVE, imap.ID` + IDLE (unless a remote kill-switch flag) + `AUTH=PLAIN` + `STARTTLS`; no CONDSTORE/QRESYNC string anywhere in the gluon source [VERIFIED: gluon@7e800978 internal/session/session.go:120-128,172]. The live Bridge 3.27.0 greeting is `* OK [CAPABILITY AUTH=PLAIN ID IDLE IMAP4rev1 MOVE STARTTLS UIDPLUS UNSELECT]`, and pre-auth `CAPABILITY` is `AUTH=PLAIN ID IDLE IMAP4rev1 STARTTLS` [VERIFIED: runtime probe of the built image] | Post-login `CAPABILITY`, plus `ENABLE CONDSTORE` and `STATUS INBOX (HIGHESTMODSEQ)` responses (expect BAD/NO) on the real account |
| IDLE (D-27, for later) | Advertised. It can be switched off remotely by a Proton feature flag (`unleash.CapabilityKillSwitchMap`) [VERIFIED: session.go:122-124] | Whether EXISTS/EXPUNGE arrive during IDLE when mail lands |
| Proton internal-ID header (D-12, D-43) | `X-Pm-Internal-Id: <msg.ID>` is set on every message built for IMAP sync (`AddInternalID: true`). `setHeaderIfNeeded` overwrites a sender-supplied value [VERIFIED: proton-bridge v3.27.0 pkg/message/build.go:431-434,496-501; internal/services/imapservice/sync_build.go:48-58]. Also `X-Pm-External-Id: <ExternalID>` and `X-Pm-Date` | Header present on INBOX and `Labels/X` copies of the same message with identical value |
| Message-ID when missing (D-13, D-14) | Bridge keeps the stored `Message-Id`. If empty, it sets `<ExternalID>` or `<msg.ID@protonmail.internalid>` [VERIFIED: build.go:472-482, `InternalIDDomain = "protonmail.internalid"` build.go:50]. So "missing Message-ID" shows up as the `protonmail.internalid` domain, not as an absent header | Count of `@protonmail.internalid` IDs; duplicates (same Message-ID, different `X-Pm-Internal-Id`); raw-byte equality across folders |
| INTERNALDATE source (D-18, D-43) | `imap.Message.Date = time.Unix(message.Time, 0)` from Proton's API metadata; `time.Now()` only when `Time <= 0` [VERIFIED: internal/services/imapservice/helpers.go:123-139] | That values are unchanged after a forced resync (record N values, rebuild, compare) |
| UIDVALIDITY (SPK-04) | Generated as seconds since 2023-02-01 UTC, uint32, monotonic [VERIFIED: gluon imap/uid_validity_generator.go:24-45]. Assigned when gluon creates a mailbox, and re-generated for every mailbox on a `UIDValidityBumped` update [VERIFIED: gluon internal/backend/connector_updates.go:863-875]. Bridge 3.27.0 never emits `UIDValidityBumped` (no reference in the Bridge tree) [VERIFIED: grep of proton-bridge v3.27.0] | Behaviour across: container restart (expect stable), CLI `repair` / gRPC `TriggerRepair`, logout+login |
| Labels as folders (SPK-01) | Mailboxes are `Folders/<path>` and `Labels/<path>` plus system folders (INBOX, Sent, Drafts, Trash, Spam, Archive, All Mail, Starred) [VERIFIED: imapservice/connector.go:747, helpers.go:37-39,141-170]. COPY into a label folder = `LabelMessages`; EXPUNGE from a label folder = `unlabelMessages` [VERIFIED: connector.go:387-424] | Observed UIDs in each folder; that the INBOX copy survives unlabel; delimiter `/` |
| Combined mode (D-35) | New users default to `AddressMode: CombinedMode`; one Bridge password per account, any account address works as the IMAP username [VERIFIED: internal/vault/types_user.go:78-97] | Login works with the configured address |
| Bridge password format | 16 random bytes, `base64.RawURLEncoding` → 22 chars `[A-Za-z0-9_-]` (safe unquoted in an env file); kept per primary email in a password archive across re-adds [VERIFIED: internal/user/user.go:557-558, pkg/algo/encode.go:32-36, internal/vault/vault.go:221-223] | — |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Proton login, vault, keychain unlock | Bridge container (Go, our Dockerfile) | Owner terminal (init run only) | Only Bridge can talk to Proton; secrets stay in the `sift-bridge` volume |
| IMAP password extraction into `.env.mailboxes` | Bridge container helper (Go, gRPC `GetUserList`) | Host file bind mount (init run only) | The password never leaves the container except into the mounted file (D-39) |
| Certificate export and owner trust | Bridge container (writes current cert) | `sift bridge trust` (Node, writes trusted cert) | Worker reads the volume read-only (D-41) |
| TLS (STARTTLS + SPKI pin) | Worker IMAP adapter (ImapFlow + node:tls) | — | Client-side verification; Bridge's cert names only 127.0.0.1 |
| Fetch/parse messages | Worker IMAP adapter | `@sift/core` (pure parsing: identity, normalisation, text) | Keep parsing pure and unit-testable |
| Sync decisions (new/old/removed/resync/valve) | Worker sync engine (pure, no I/O) | — | Deterministic and testable with a fake source |
| Persistence, dedup, generations | Database (constraints) via `@sift/db` scoped API | — | `UNIQUE` constraints make idempotency a DB guarantee, not app luck |
| Cross-process ingest exclusion (D-03) | Database (advisory lock) | `@sift/db` API | Two containers share only Postgres |
| Scheduling, nudge, states, grace | Worker supervisor + mailbox callbacks | `mailbox_status` | Existing P1 seam |
| Owner commands (backfill, resume, trust) | `sift` CLI (`parseArgs`) | Compose `run`/`exec` | Follows P1 D-24 |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| imapflow | **2.1.0** (2026-09-27; newest past the 7-day gate on 2026-10-05) | IMAP client: STARTTLS, EXAMINE, FETCH, download | Maintained (Postal Systems / Nodemailer author), TypeScript types bundled since 2.0, PEEK-only fetches, typed error codes (`ImapFlowErrorCode`) [VERIFIED: npm registry + package source] |
| html-to-text | **10.0.1** | HTML part → text for the body cache (D-06) | The converter mailparser itself uses; ESM/CJS; no postinstall [VERIFIED: npm registry; mailparser 3.9.28 depends on it] |
| libmime | **5.4.4** (the exact version imapflow 2.1.0 pins, so it dedupes) | `decodeHeaders` (unfold + split) and `decodeWords` (RFC 2047) for the selected header block | Already in the tree through imapflow; correct folding/encoded-word handling [VERIFIED: npm registry + libmime source] |
| Proton Bridge | **v3.27.0**, commit `04e46eb4fbc1c7ef4425a920bfc352050da0606b` | IMAP gateway to Proton | Latest stable on GitHub; v3.27.1 is a pre-release [VERIFIED: `gh release list`, `git ls-remote`] |
| Go toolchain image | `golang:1.26.7-trixie` | Builds Bridge (go.mod `toolchain go1.26.7`), set `GOTOOLCHAIN=local` | Matches the module's toolchain line, so nothing is downloaded mid-build [VERIFIED: Docker Hub tags, Bridge go.mod] |
| Bridge runtime base | `debian:trixie-20260918-slim` + `ca-certificates libfido2-1 libsecret-1-0 pass gnupg socat openssl tini` | Runs Bridge, the keychain and the port forward | All packages present in trixie (probed with `apt-cache policy`) [VERIFIED: runtime probe] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/html-to-text | 9.0.4 | Types (html-to-text 10 ships none; the v9 API, `convert()`, is unchanged) | Typecheck |
| @types/libmime | 5.3.0 | Types for libmime | Typecheck |
| Dovecot (test only) | `dovecot/dovecot:2.4.5` (rootless, IMAP on 31143) | Real IMAP server for adapter tests: STARTTLS, flags, `doveadm mailbox update --uid-validity` | Integration tests of the ImapFlow adapter (Bridge is not available in CI) [CITED: doc.dovecot.org/latest/installation/docker.html, doveadm-mailbox.1] |
| Renovate | GitHub App or `renovatebot/github-action` | Bumps `BRIDGE_VERSION` + `BRIDGE_COMMIT` together | D-31 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| BODYSTRUCTURE + `download(part, {maxBytes})` | Fetch full `source` + `mailparser.simpleParser` | simpleParser buffers every attachment in memory, which is unbounded for 25 MB mail. Part download is bounded and decodes charset and transfer encoding itself |
| libmime header parsing | Hand-rolled unfold/split | Folding, duplicates and encoded words are easy to get subtly wrong |
| Go gRPC helper for password extraction | Scrape `bridge --cli` `info` output | `info` prints the password to the TTY (violates D-39) and is fragile ishell output |
| Session advisory lock | Lease row in `folder_sync` with expiry | A lease needs clock and expiry handling; Postgres releases a session lock on disconnect for free |
| Dovecot test container | GreenMail, or a hand-written fake IMAP server | GreenMail's STARTTLS support is unclear; a fake server reimplements IMAP. Use a fake only for the "no STARTTLS" negative test |

**Installation (worker package; pin exactly, then rerun `pnpm install`):**
```bash
pnpm --filter @sift/worker add imapflow@2.1.0 html-to-text@10.0.1 libmime@5.4.4
pnpm --filter @sift/worker add -D @types/html-to-text@9.0.4 @types/libmime@5.3.0
# then hand-edit package.json to exact versions (cerebrum: --save-exact does not pin ranges)
```
If `minimumReleaseAge` rejects a transitive version on install day, take the newest version whose whole tree is older than 7 days, as P1 did for `@types/node`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| imapflow | npm | since 2019; pinned 2.1.0 = 8 days | ~2.9M/wk | github.com/postalsys/imapflow | [SUS] (reason: `too-new`, the *latest* 2.2.5 is 1 day old) | Keep, pinned to 2.1.0 (older than the 7-day gate). Planner adds `checkpoint:human-verify` before install per protocol |
| html-to-text | npm | since 2012; 10.0.1 = 47 days | ~22.4M/wk | github.com/html-to-text/node-html-to-text | [OK] | Approved |
| libmime | npm | since 2014; pinned 5.4.4 = 20 days | ~10.1M/wk | github.com/nodemailer/libmime | [SUS] (reason: `too-new`, latest 5.4.7 is 1 day old) | Keep, pinned to 5.4.4. Checkpoint per protocol |
| @types/html-to-text | npm | 2023 | ~3.5M/wk | DefinitelyTyped | [OK] | Approved |
| @types/libmime | npm | 2025 | ~128k/wk | DefinitelyTyped | [OK] | Approved |

No package has a `postinstall` script (`npm view <pkg>@<ver> scripts.postinstall` is empty for all three runtime packages) [VERIFIED: npm registry].
**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** imapflow, libmime. Both are flagged only because their *latest* release is under 7 days old. The pinned versions predate the repo's own supply-chain gate. The planner inserts `checkpoint:human-verify` before installing them.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌────────────────────── bridge container (sift-bridge volume, keychain) ──────────────┐
 Proton API  <──HTTPS──> │ bridge --noninteractive  ── listens 127.0.0.1:1143 (gluon IMAP, STARTTLS, self-signed) │
                         │        ▲                                                                             │
                         │ socat bind=<container IP>:1143 ──> 127.0.0.1:1143        writes current cert ──┐     │
                         └────────┬────────────────────────────────────────────────────────────────────┼─────┘
                                  │ TCP (TLS end-to-end after STARTTLS)                                  ▼
 host 127.0.0.1:1143 ─────────────┤                                          sift-bridge-cert volume (current.pem, trusted.pem)
                                  │                                                    │ ro                 ▲ rw (trust run)
  ┌──────────────────── worker container ─────────────────────────────────────────────┼────────────────────┼──────────┐
  │ supervisor tick ──> runBatch(mailbox, signal)                                     │                    │          │
  │   └─ ingest lock (pg_try_advisory_lock on a dedicated connection) ── busy? → skip │          sift bridge trust     │
  │        └─ ImapFlow connect: STARTTLS required → tls{ca:trusted, checkServerIdentity: SPKI pin} → LOGIN (env pw)  │
  │             └─ EXAMINE folder → {uidValidity, uidNext}                                                            │
  │                  ├─ no folder_sync row → first sync (D-01 start point, or initial_backfill_days)                  │
  │                  ├─ uidValidity changed → RESYNC: headers-only rescan in 500-UID batches, generation N+1 ──┐       │
  │                  └─ same → UID FETCH last+1:* (filter uid > last) → classify new/old by INTERNALDATE        │       │
  │                       └─ volume valve (> cap new) → mailbox_status needs_attention, stop                    │       │
  │                       └─ chunks of ~50: fetch headers/bodystructure → download text part (PEEK, maxBytes)  │       │
  │                            → build rows (identity key, headers, body text) → one tx per chunk:             │       │
  │                               upsert message, upsert location, insert body cache, advance folder_sync ◄────┘       │
  │             └─ periodic UID-set diff → removed_at on vanished locations; delete never-classified body rows        │
  │   └─ mailbox_status: ok | connecting (startup grace) | error (classified) | needs_attention | disabled           │
  └──────────────────────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                                 ▼
                                              Postgres (FORCE RLS on app.mailbox_id): message, message_location,
                                              message_body, folder_sync, mailbox_status
```

### Recommended Project Structure

```
bridge/                          # new: everything for the Bridge image
├── Dockerfile                   # 2-stage: golang build (tag + SHA check) → debian runtime
├── entrypoint.sh                # modes: serve (default) | init | (spike helper passthrough)
└── helper/main.go               # copied into the Bridge source tree at build time
                                 # (cmd/sift-helper) so it can import internal/frontend/grpc
apps/worker/src/
├── imap/                        # ImapFlow adapter implementing FolderSource
│   ├── connect.ts               # STARTTLS + pin options, error classification
│   ├── pin.ts                   # SPKI sha256 of a PEM / peer cert; trusted-cert loading
│   └── folder-source.ts         # examine, fetchRange, fetchHeaders, uidList, downloadText
├── ingest/                      # pure sync engine (no ImapFlow, no DB imports)
│   ├── plan.ts                  # decide first-sync / poll / resync / valve
│   ├── identity.ts              # pm:/mid:/hdr: keys and normalisation (or packages/core)
│   ├── message.ts               # header subset, attachment metadata, text truncation
│   └── run.ts                   # orchestrates source + store per chunk, honours AbortSignal
├── runtime/mailbox-batch.ts     # runBatch wires lock → connect → ingest → status
└── commands/                    # mailbox-backfill.ts, mailbox-resume.ts, bridge-trust.ts,
                                 # bridge-probe.ts (spike, opt-in mutating steps)
packages/db/src/
├── schema/scoped.ts             # message columns, message_location, message_body, folder_sync cols
├── ingest.ts                    # use-cases: upsertMessages, upsertLocations, markRemoved, ...
└── lock.ts                      # withMailboxSession / tryIngestLock
packages/db/migrations/          # 0005 generated + 0006 custom (FORCE RLS, grants, triggers, check)
```
The spike findings go to `.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md`, plus an addendum to `docs/adr/0003-traces-and-mail-app-relabels.md`. ADR-0003 already says the answers will be recorded as an addendum to it.

### Pattern 1: Bridge image built from a pinned tag and verified SHA

**What:** A two-stage Dockerfile that clones the tag, fails if HEAD is not the pinned commit, builds without the GUI, and ships only the `bridge` binary.
**When:** The `bridge` compose service (D-30).
**Example (built successfully this session; ~205 s compile, 159 MB image):**
```dockerfile
# syntax=docker/dockerfile:1
# Source: trial build in scratchpad, 2026-10-05 (exit 0); Bridge BUILDS.md "Build Bridge without GUI"
ARG GO_VERSION=1.26.7
FROM golang:${GO_VERSION}-trixie AS build
# renovate: datasource=github-tags depName=ProtonMail/proton-bridge
ARG BRIDGE_VERSION=v3.27.0
ARG BRIDGE_COMMIT=04e46eb4fbc1c7ef4425a920bfc352050da0606b
RUN apt-get update && apt-get install -y --no-install-recommends \
      libfido2-dev libcbor-dev libsecret-1-dev libssl-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch "${BRIDGE_VERSION}" https://github.com/ProtonMail/proton-bridge.git . \
 && test "$(git rev-parse HEAD)" = "${BRIDGE_COMMIT}"
ENV GOTOOLCHAIN=local
# COPY helper/main.go cmd/sift-helper/main.go   # in-tree, so it may import internal/frontend/grpc
RUN make build-nogui BRIDGE_APP_VERSION="${BRIDGE_VERSION#v}"
# RUN go build -o sift-helper ./cmd/sift-helper

FROM debian:trixie-20260918-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libfido2-1 libsecret-1-0 pass gnupg socat openssl tini \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/bridge /usr/local/bin/bridge
RUN useradd -m -u 1000 bridge && install -d -o bridge -m 0700 /data /run/user/1000
USER bridge
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
```
`make build-nogui` also builds the `proton-bridge` launcher. Do not ship it: the launcher is the auto-update path, and D-30 disables self-update [VERIFIED: Makefile:108-148, BUILDS.md "Launchers ... allowing the automatic update feature"]. Still set `AutoUpdate` off in the vault: it defaults to `true` (`types_settings.go:94`), and with updates on, Bridge checks hourly (`UpdateCheckInterval = time.Hour`) [VERIFIED: internal/constants/update_default.go]. A Proton API `AppVersionBadCode` response publishes `UpdateForced` and the pinned Bridge stops working [VERIFIED: internal/bridge/bridge.go:390-392]. That is why the Renovate bump (D-31) matters.

### Pattern 2: Entrypoint keychain unlock that fails closed

**What:** Before Bridge starts: start gpg-agent with presetting allowed, preset the passphrase for every keygrip, prove `pass` can decrypt a canary, and only then `exec bridge`. If any step fails, exit non-zero with a fixed message.
**Why:** If the keychain is unusable, Bridge logs `Could not load/create vault key ... no keychain` and then `The vault key could not be retrieved; the vault will not be encrypted`, and keeps running with an insecure vault in `<config>/vault/insecure` [VERIFIED: runtime probe; internal/app/vault.go:86-110].
**Probed working sequence:**
```bash
# Source: runtime probe in sift-bridge-probe image, 2026-10-05
export HOME=/data GNUPGHOME=/data/.gnupg PASSWORD_STORE_DIR=/data/.password-store \
       XDG_CONFIG_HOME=/data/config XDG_DATA_HOME=/data/data XDG_CACHE_HOME=/data/cache
printf 'allow-preset-passphrase\nmax-cache-ttl 34560000\ndefault-cache-ttl 34560000\n' > "$GNUPGHOME/gpg-agent.conf"
# init only: gpg --batch --pinentry-mode loopback --passphrase-fd 0 --quick-gen-key 'sift-bridge-vault' rsa3072 encr never
#            pass init "$FPR"; pass insert -m sift/canary   (non-secret marker)
gpg-connect-agent /bye
for KG in $(gpg --list-secret-keys --with-keygrip --with-colons | awk -F: '/^grp/{print $10}'); do
  printf '%s' "$SIFT_BRIDGE_KEYCHAIN_PASSPHRASE" | "$(gpgconf --list-dirs libexecdir)/gpg-preset-passphrase" --preset "$KG"
done
unset SIFT_BRIDGE_KEYCHAIN_PASSPHRASE
pass show sift/canary >/dev/null || { echo "Bridge keychain locked: check SIFT_BRIDGE_KEYCHAIN_PASSPHRASE" >&2; exit 78; }
[ ! -e /data/config/protonmail/bridge-v3/insecure ] || { echo "insecure Bridge vault found" >&2; exit 78; }
socat TCP-LISTEN:1143,bind="$(hostname -i | awk '{print $1}')",fork,reuseaddr TCP:127.0.0.1:1143 &
exec bridge --noninteractive
```
Facts behind it: `gpg-preset-passphrase` lives at `/usr/lib/gnupg` on trixie [VERIFIED: probe `gpgconf --list-dirs libexecdir`]. It needs `--allow-preset-passphrase`. "The maximum cache time as set with --max-cache-ttl is still honored" [CITED: gnupg.org gpg-preset-passphrase], and that default is "2 hours (7200 seconds)" [CITED: gnupg.org Agent-Options]. With the preset, Bridge logged `no vault key found, generating new`, i.e. a secure vault [VERIFIED: probe]. Linux helper order is pass (if usable) → secret-service → dbus [VERIFIED: pkg/keychain/helper_linux.go:58-66]. Put the agent socket outside the shared volume: probed, `gpgconf --list-dirs agent-socket` = `/data/.gnupg/S.gpg-agent` when `/run/user/<uid>` is missing, so create `/run/user/1000` in the image [ASSUMED: that gpgconf then prefers /run/user/1000/gnupg].

### Pattern 3: Init = Proton's own CLI for login + an in-tree Go helper over gRPC for everything secret

**What:** `init` mode (1) creates the GPG key and pass store if absent; (2) runs `bridge --cli` attached to the owner's TTY, where the owner types `login`. Proton's code reads the password without echo and handles TOTP, FIDO, two-password mode and human-verification URLs [VERIFIED: internal/frontend/cli/accounts.go:151-305]. The owner then types `exit`. (3) It starts `bridge --grpc` in the background and runs `sift-helper`. The helper reads `grpcServerConfig.json` (`{port, cert, token, fileSocketPath}`) from the settings dir. It connects to the unix socket with TLS (RootCAs = config cert, ServerName `127.0.0.1`) and `server-token` metadata [VERIFIED: internal/frontend/grpc/service.go:60-61,120-170,544-588; internal/service/config.go:27-32]. Then it calls:
- `SetIsTelemetryDisabled(true)` (default telemetry is on: `TelemetryDisabled: false` [VERIFIED: vault/types_settings.go:95]; PROJECT.md says no telemetry),
- `SetIsAutomaticUpdateOn(false)`,
- `GetUserList` → `User{username, addresses[], password(bytes)}`, where `password` = the IMAP password [VERIFIED: bridge.proto:204-214; grpc/utils.go:67-79],
- for each mailbox in the mounted `config.yaml` whose `imap.username` (case-insensitive) is in a user's `addresses`: upsert `password_env=<password>` in the mounted `.env.mailboxes`, printing only the D-39 line,
- capture the presented IMAP cert over STARTTLS on `127.0.0.1:1143` and write it to the cert volume (both `current.pem` and, at init, `trusted.pem`), printing the SPKI fingerprint,
- `Quit`.

**Why the in-tree helper:** Go `internal/` packages can only be imported from inside the module tree. Copying `helper/main.go` to `cmd/sift-helper/` in the build stage lets it reuse the generated `grpc` client (`bridge_grpc.pb.go`) and the pinned grpc v1.82.1 with no extra module [VERIFIED: go.mod; Go internal-package rule ASSUMED from training knowledge, a standard language rule]. `gopkg.in/yaml.v3` is already in Bridge's module graph (indirect) for reading config.yaml [VERIFIED: go.mod:152].
**Do not use `ExportTLSCertificates`** for D-41: it writes `cert.pem` **and `key.pem`** to the target folder [VERIFIED: grpc/service_cert.go:63-78]. Capture the cert from the STARTTLS handshake instead; the private key never leaves the vault.
**Single instance:** the lock file is `<XDG_CACHE_HOME>/protonmail/bridge-v3/bridge-v3.lock` [VERIFIED: locations.go:67-69 and probe listing]. Keep the cache dir inside the shared volume, so an `init` run against a volume whose `bridge` service is still running fails on the lock instead of opening the vault twice. Still document "stop the bridge service first".

### Pattern 4: STARTTLS-required ImapFlow connection with an SPKI pin

```ts
// Source: imapflow 2.1.0 dist/esm/imap-flow.js:1290-1330 (doSTARTTLS semantics, tls opts merged into
// tls.connect); Node TLS behaviour probed 2026-10-05 (checkServerIdentity runs only after chain
// verification; with a self-signed cert that needs `ca`).
import { createHash, X509Certificate } from 'node:crypto';
import type { PeerCertificate } from 'node:tls';
import { ImapFlow } from 'imapflow';

export function spkiSha256(pem: string): string {
  const key = new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(key).digest('base64');
}

export function bridgeClient(opts: { host: string; port: number; user: string; pass: string; trustedPem: string }) {
  const pinned = spkiSha256(opts.trustedPem);
  return new ImapFlow({
    host: opts.host,
    port: opts.port,
    secure: false,
    doSTARTTLS: true,              // no STARTTLS → throws 'Server does not support STARTTLS' before LOGIN
    auth: { user: opts.user, pass: opts.pass },
    logger: false,                 // never ImapFlow's own pino output; Sift logs counts only
    disableAutoIdle: true,         // polling only (D-27)
    clientInfo: { name: 'Sift' },
    tls: {
      ca: [opts.trustedPem],       // required: without it Node fails DEPTH_ZERO_SELF_SIGNED_CERT first
      minVersion: 'TLSv1.2',
      checkServerIdentity: (_host: string, cert: PeerCertificate) =>
        createHash('sha256').update(cert.pubkey).digest('base64') === pinned
          ? undefined
          : Object.assign(new Error('Bridge certificate changed'), { code: 'SIFT_BRIDGE_PIN_MISMATCH' }),
    },
  });
}
```
Probe results (Node 26.10, CA:true self-signed cert, servername `bridge`):
| tls options | result | checkServerIdentity called |
|---|---|---|
| `rejectUnauthorized: true`, no `ca` | `DEPTH_ZERO_SELF_SIGNED_CERT` | no |
| `rejectUnauthorized: false`, no `ca` | **connects, `authorized=false`** | **no (pin skipped!)** |
| `rejectUnauthorized: true`, `ca: [pinned cert]` | connects, `authorized=true` | yes |
| `rejectUnauthorized: true`, `ca: [other cert]` | `DEPTH_ZERO_SELF_SIGNED_CERT` | no |
[VERIFIED: runtime probe; the same results for a CA:false leaf]. Bridge's cert is `CN=127.0.0.1`, `CA:TRUE`, SAN `IP:127.0.0.1` only, valid 20 years [VERIFIED: internal/certs/tls.go:40-62 and live `openssl s_client -starttls imap`]. Because the cert is created with the vault, a vault reset (including a fall-back to an insecure vault) changes the key, and the pin turns that into the D-41 fail-closed path.

### Pattern 5: Pure sync engine behind a `FolderSource` interface

```ts
// Shape sketch (names are the planner's; behaviour is the research recommendation)
export interface FolderStatus { uidValidity: number; uidNext: number; exists: number }
export interface HeaderRecord { uid: number; internalDate: Date; rawHeaders: Buffer; size: number;
                                bodyStructure?: unknown; flags?: Set<string> }
export interface FolderSource {
  examine(folder: string): Promise<FolderStatus>;                       // EXAMINE (readOnly)
  fetchHeaders(uids: string): Promise<HeaderRecord[]>;                  // fetchAll, never fetch() iterator
  listUids(): Promise<number[]>;                                        // UID SEARCH ALL (removal diff)
  searchSince(date: Date): Promise<number[]>;                           // backfill window
  downloadText(uid: number, part: string, maxBytes: number): Promise<{ text: string; truncated: boolean }>;
}
```
Poll algorithm (same UIDVALIDITY):
1. `examine` → if `uidNext <= last_uid + 1`, nothing new (skip FETCH).
2. `UID FETCH (last_uid+1):*` with `uid, internalDate, envelope, bodyStructure, size, headers:[...]`. **Drop every `uid <= last_uid`**: "a UID range of 559:* always includes the UID of the last message in the mailbox, even if 559 is higher than any assigned UID value" [CITED: RFC 3501 §6.4.8, rfc3501.txt lines 3379-3384].
3. Classify each record: candidate-new if `internalDate > watermark − 5 min` (D-19), else historical (D-21). Apply this on the UID fast path too, not only in resync (see Pitfall 6).
4. If candidate-new count > cap → `needs_attention`, stop (D-26).
5. Process in chunks of ~50: download text parts, then one transaction per chunk: upsert `message` on `(mailbox_id, identity_key)`, upsert `message_location`, insert the body row for eligible messages, advance `folder_sync.last_uid` and `internal_date_watermark`. Check `signal.aborted` between chunks (D-04, P1 D-53).

First sync (no `folder_sync` row): record `uidvalidity`, `last_uid = uidNext − 1`, `watermark = now()`. With `initial_backfill_days = N`: `searchSince(now − N days)` → ingest those UIDs as eligible, the watermark being `now − N days` for the boundary.
Removal diff (every K polls, or when `exists` differs from the live-location count): `listUids()` vs live locations of `(folder, uidvalidity)` → `removed_at`; delete body rows for removed messages with no decision (D-07).
Resync (UIDVALIDITY differs): set `folder_sync.state = 'resyncing'`, `pending_generation = generation + 1` (reused on retry). Headers-only `fetchHeaders` over `1:*` in 500-UID windows of the `listUids()` result. Upsert locations with the pending generation. Unknown key + new INTERNALDATE → normal new mail (body download); unknown + old → historical. Final transaction: mark older-generation live locations superseded and `removed_at`, set `uidvalidity`, `last_uid`, `generation`, `state='ok'`, and the D-25 counts.

### Pattern 6: Ingest lock and connection budget

Use a **session-level** advisory lock on a **dedicated** client and run that mailbox's chunk transactions on the same client:
```ts
// packages/db/src/lock.ts (shape; pool internals stay private per D-42)
// select pg_try_advisory_lock($1::int, hashtext($2))  -- $1 = INGEST_LOCK_CLASS (constant), $2 = mailbox_id::text
```
- The two-int key form lives in a different key space from the existing single-bigint locks (`MIGRATE_LOCK_KEY = 815309001`, `CONFIG_APPLY_LOCK_KEY = 815309002` [VERIFIED: packages/db/src/owner/migrate.ts:20, packages/db/src/owner/registry.ts:20]): "these two key spaces do not overlap" [CITED: postgresql.org/docs/18/functions-admin.html].
- A session lock is released automatically "at session end, even if the client disconnects ungracefully" [CITED: same page], so a crashed CLI never wedges the worker.
- **Why the same client:** the app pool defaults to 4 connections (`DEFAULT_MAX_CONNECTIONS = 4` [VERIFIED: packages/db/src/app-db.ts:46]). If every running mailbox holds one client for the lock and then asks the pool for a second one for each chunk transaction, four concurrent mailboxes exhaust the pool and deadlock. Running scoped transactions on the lock's client uses exactly one connection per active mailbox.
- A busy lock means "skip this run" (log `ingest busy (another process holds mailbox)`), not an error, so the supervisor's backoff is untouched.

### Pattern 7: Scoped-API additions that keep D-42/D-43 intact

The current `ScopedTableApi` has `insert/find/update/delete` with **equality-only** matching, and there is no ON CONFLICT [VERIFIED: packages/db/src/scope.ts:34-42,123-136]. Add, inside `packages/db`:
- `upsert(rows, { target: [...] })`, where `target` is typed to the table's unique-constraint columns and `mailbox_id` is always prepended, returning `{ id, inserted }` (for example `sql\`(xmax = 0)\``) [ASSUMED: drizzle 0.45 `.onConflictDoUpdate({ target: [...] })` + `.returning({...})` composition];
- set-valued updates (`removed_at` for many ids) via an `inArray` match, or as a use-case in `packages/db/src/ingest.ts` like `status.ts`;
- every new table added to the frozen `Scope` object and `SCOPED_TABLE_NAMES`.

### Anti-Patterns to Avoid

- **`rejectUnauthorized: false` "because the cert is self-signed":** it disables the pin silently (probe row B). Never write that literal anywhere, including comments; add a negative grep.
- **Running IMAP commands inside `for await (… of client.fetch())`:** it deadlocks; use `fetchAll` [CITED: imapflow.com/docs/guides/fetching-messages].
- **SELECT instead of EXAMINE:** use `mailboxOpen(folder, { readOnly: true })` / `getMailboxLock(folder, { readOnly: true })`, which issue EXAMINE [VERIFIED: imapflow commands/select.js:52]. That is a protocol-level guarantee for D-11 on top of BODY.PEEK.
- **Deriving "new" from UID alone:** see Pitfall 6.
- **Persistent IMAP connection with auto-IDLE:** connect per run, `logout` in `finally`. Bridge sessions die on restart, and gluon invalidates selected state when UIDVALIDITY bumps (`markInvalid`) [VERIFIED: gluon internal/state/updates.go:526-534].
- **Storing the IMAP password, the Proton password, or bodies on `message`:** D-05/D-06/ADR-0001.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IMAP protocol, literals, STARTTLS | Own socket client | ImapFlow | Literal parsing, STARTTLS injection guard (`STARTTLS_INJECTION`), throttling |
| Transfer-encoding and charset decode | Base64/QP/iconv code | `client.download(uid, part, { uid: true, maxBytes })` | Decodes QP/base64, converts charsets, enforces a byte cap [VERIFIED: imapflow dist/esm/download.js:27-34,196-267] |
| HTML → text | Regex stripping | `html-to-text` `convert()` | Entities, block layout, tables |
| Header unfolding and RFC 2047 | Regex | `libmime.decodeHeaders` / `decodeWords` | Folding and duplicate headers [VERIFIED: libmime.js:436-484] |
| Bridge login, 2FA, HV, FIDO | gRPC login state machine | `bridge --cli` `login` | Proton maintains it; HV needs a browser URL flow |
| IMAP password retrieval | Vault decryption, CLI scraping | gRPC `GetUserList` from the in-tree helper | Official frontend API |
| Cross-process mutual exclusion | Lock files, lease rows | `pg_try_advisory_lock` (two-int form) | Auto-release on disconnect |
| Cert fingerprinting | Manual DER parsing | `X509Certificate.publicKey.export({type:'spki',format:'der'})` / `PeerCertificate.pubkey` + sha256 | Node built-ins |
| Test IMAP server with STARTTLS and UIDVALIDITY control | Fake IMAP server | Dovecot 2.4.5 container | Real semantics; `doveadm mailbox update --uid-validity` |

**Key insight:** Sift's job here is *bookkeeping*: identity, locations, watermarks and generations. Everything protocol-shaped already exists, and getting it subtly wrong costs duplicates or missed mail.

## Runtime State Inventory

Not a rename or refactor phase, but it introduces long-lived runtime state that plans must create and document:

| Category | Items | Action Required |
|----------|-------|-----------------|
| Stored data | New: `message` identity columns, `message_location`, body cache, `folder_sync` watermarks. `message` is empty in every deployment today (no ingest in Phase 1), so NOT NULL columns need no backfill. Test fixtures *do* insert bare `message (mailbox_id)` rows [VERIFIED: packages/db/test/support/seed.ts:63-65] | Code edit: update `seedScopedRows` and isolation tests |
| Live service config | Bridge vault settings (telemetry off, autoupdate off, IMAP port) live in the encrypted vault, not git | Set by the init helper; documented |
| OS-registered state | Docker named volumes `sift-bridge` (external) and the cert volume | Owner runs `docker volume create sift-bridge` once; compose-smoke/CI create their own |
| Secrets/env vars | `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE` (`.env`, bridge service only); Bridge IMAP passwords in `.env.mailboxes` | `.env.example` + compose test updates |
| Build artifacts | `sift-bridge:local` image built locally | Rebuilt on every Renovate bump |

## Common Pitfalls

### Pitfall 1: Bridge binds loopback only, and socat cannot share the port on 0.0.0.0
**What goes wrong:** Publishing `127.0.0.1:1143:1143` reaches nothing, or socat dies with `bind(5, {AF=2 0.0.0.0:1143}): Address already in use`.
**Why:** `constants.Host = "127.0.0.1"` is a constant used by both listeners [VERIFIED: internal/constants/constants.go:70-71; services/imapsmtpserver/listener.go:30-38]. Linux refuses a wildcard bind on a port already bound on 127.0.0.1 [VERIFIED: probe output above].
**How to avoid:** `socat TCP-LISTEN:1143,bind=$(hostname -i),fork,reuseaddr TCP:127.0.0.1:1143` (probed: greeting returned through it). Alternatively, move Bridge's own IMAP port (`SetMailServerSettings`) and let socat own `0.0.0.0:1143`.
**Warning signs:** the healthcheck is green but the worker gets `ECONNREFUSED` on `bridge:1143`.

### Pitfall 2: Silent unencrypted vault
**What goes wrong:** A wrong or missing passphrase leaves Bridge running with an insecure vault, the account appears logged out, and the cert changes.
**How to avoid:** Pattern 2's canary check plus the `insecure` dir check; exit 78 with a fixed message. The worker's pin mismatch is a second net.

### Pitfall 3: Compose 2.2.3 fails every command when an external volume is missing
**What goes wrong:** `external volume "" not found` on `docker compose up b`, even for services that do not use the volume [VERIFIED: probe on this machine's Compose v2.2.3; the empty name is a 2.2.3 quirk].
**How to avoid:** The README quick start adds `docker volume create sift-bridge` before the first `up`. compose-smoke uses `${SIFT_BRIDGE_VOLUME:-sift-bridge}`-style naming and creates its own (mirror the `SIFT_PGDATA_VOLUME` pattern). `compose.test.ts` asserts the name variable. It is the same class of problem as the existing `.env.mailboxes` env_file trap (cerebrum).

### Pitfall 4: `.env.mailboxes` bind mount, atomic rename and backups
**What goes wrong:** Writing a temp file and `rename()`-ing it over a single-file bind mount fails with `EBUSY` ("Device or resource busy"). A backup written next to it inside the container is not on the host [VERIFIED: probe with a neutral filename]. If the host file is missing, Docker creates a *directory* at the mount source [ASSUMED: standard Docker bind-mount behaviour].
**How to avoid:** Write in place (`open(O_WRONLY|O_TRUNC)` + fsync) after the backup exists on the host. Either a host-side wrapper makes the backup and checks preconditions (file exists, is a regular file, mode 0600) before `docker compose run --rm bridge init`, or a second pre-created file is bind-mounted for the backup. This is an open question for the planner (see Open Questions).

### Pitfall 5: The pin silently disabled
See Pattern 4, probe row B. Add a lint or negative-grep test over `apps/**/src` for the `rejectUnauthorized` false literal, plus a positive test that a different cert fails.

### Pitfall 6: "New" by UID alone ingests history
**What goes wrong:** During Bridge's initial sync (or after a cache rebuild without a UIDVALIDITY change), old messages receive UIDs above the recorded start point and look "new". They get classified and labelled.
**Why:** UIDs are assigned when gluon learns a message, not when mail arrives [ASSUMED: whether Bridge serves IMAP while its first sync is still running is a spike question].
**How to avoid:** Always gate eligibility on INTERNALDATE > watermark − 5 min (D-19) and keep the volume valve on every cycle (D-26). The spike notes whether login works mid-sync.

### Pitfall 7: NUL bytes in mail
**What goes wrong:** An insert fails with `invalid byte sequence for encoding "UTF8": 0x00` (text) or `unsupported Unicode escape sequence` (jsonb), so one bad mail blocks the chunk forever [VERIFIED: probe against sift-db-1, PG 18.6].
**How to avoid:** Strip `\u0000` from every header and body string before persistence. Add a unit test with a NUL-bearing fixture.

### Pitfall 8: bigint values
**What goes wrong:** ImapFlow returns `uidValidity` and `highestModseq` as `bigint`, and `uidNext` as `number` [VERIFIED: imapflow dist/esm/types.d.ts:175-181]. JSON logging throws on bigint, and a Postgres `integer` overflows above 2^31 (UIDs and UIDVALIDITY are unsigned 32-bit [CITED: RFC 3501 §2.3.1.1]).
**How to avoid:** `bigint` columns (`mode: 'number'` is safe below 2^53); convert at the adapter boundary.

### Pitfall 9: Pool exhaustion under the ingest lock
See Pattern 6. The symptom is mailboxes hanging until the 20 s shutdown drain.

### Pitfall 10: Gluon kills sessions on resync
**What goes wrong:** A mid-run disconnect (`NoConnection` / `EConnectionClosed`) when Bridge resyncs.
**How to avoid:** Treat it as a retryable mailbox error (backoff). The next run's EXAMINE sees the new UIDVALIDITY. Never advance `folder_sync` outside a committed chunk.

### Pitfall 11: The host Bridge app collides on 127.0.0.1:1143
The owner's Mac has **Proton Mail Bridge.app 3.8.1** installed [VERIFIED: Info.plist CFBundleShortVersionString]. If it runs, it holds `127.0.0.1:1143`, and the compose port publish fails, or host dev scripts reach the wrong Bridge. README: quit the desktop Bridge first, or set `SIFT_BRIDGE_PORT`.

### Pitfall 12: `pm:` trusted on a non-Bridge server
Bridge overwrites `X-Pm-Internal-Id`, but any other IMAP server would pass a sender-supplied one through. Use `pm:` only for Bridge mailboxes (in M1, `labels.apply_as: proton_labels` is the only accepted value [VERIFIED: packages/core/src/config/schema.ts:69-73 `apply_as: z.enum(['proton_labels'], ...)`]). With `mid:`, a sender who copies a known Message-ID makes their mail dedupe into an existing row and escape classification (D-14 merges on conflict). That is a further reason `pm:` must win wherever available.

### Pitfall 13: Spike leaking mail content
The probe must log counts, hashes and header *names*, never subjects, senders or bodies (PROJECT.md: never commit real email). The findings doc likewise holds aggregates only.

## Code Examples

### Identity key (D-12/D-13), pure function
```ts
// Source: research recommendation; normalisation rules from CONTEXT D-13
export function normaliseMessageId(raw: string): string | null {
  const v = raw.replace(/\u0000/g, '').trim().replace(/^<|>$/g, '').trim();
  if (v === '') return null;
  const at = v.lastIndexOf('@');
  return at < 0 ? v : `${v.slice(0, at)}@${v.slice(at + 1).toLowerCase()}`;
}
export function identityKey(h: { pmInternalId?: string; messageId?: string; stableHash: string }, isBridge: boolean): string {
  if (isBridge && h.pmInternalId) return `pm:${h.pmInternalId.trim()}`;
  const mid = h.messageId ? normaliseMessageId(h.messageId) : null;
  return mid ? `mid:${mid}` : `hdr:${h.stableHash}`;
}
```

### Header request set (covers Phase 3 rules + identity + fallback hash)
```ts
// Fetched with BODY.PEEK[HEADER.FIELDS (...)] via ImapFlow `headers: [...]`
const HEADERS = ['message-id', 'x-pm-internal-id', 'x-pm-external-id', 'date', 'from', 'sender', 'reply-to',
  'to', 'cc', 'subject', 'list-id', 'list-unsubscribe', 'precedence', 'auto-submitted', 'in-reply-to',
  'references', 'content-type'];
```
Suggested `hdr:` hash inputs, for the spike to confirm: sha256 over normalised `Date`, `From`, `To`, `Cc`, `Subject`, `In-Reply-To`, plus RFC822.SIZE [ASSUMED].

### Renovate custom manager bumping tag + SHA together (D-31)
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "customManagers": [{
    "customType": "regex",
    "managerFilePatterns": ["/^bridge/Dockerfile$/"],
    "matchStrings": [
      "# renovate: datasource=(?<datasource>\\S+) depName=(?<depName>\\S+)\\s+ARG BRIDGE_VERSION=(?<currentValue>\\S+)\\s+ARG BRIDGE_COMMIT=(?<currentDigest>[0-9a-f]{40})"
    ]
  }],
  "packageRules": [{ "matchDepNames": ["ProtonMail/proton-bridge"], "ignoreUnstable": true }]
}
```
Regex managers require `currentValue` or `currentDigest` plus `depName` and `datasource` captures [CITED: docs.renovatebot.com/modules/manager/regex]. Whether `github-tags` fills `currentDigest` with the tag's commit SHA is [ASSUMED]. Verify with `renovate-config-validator` and a dry run. Bridge's v3 tags are lightweight (the tag ref SHA equals the commit) [VERIFIED: `git ls-remote` returned one line for v3.27.0]. Add a test in the style of `node-version.test.ts`: the Dockerfile's `BRIDGE_COMMIT` is 40 hex chars and `BRIDGE_VERSION` matches `^v3\.\d+\.\d+$`.

### Compose service shape (D-29/D-32/D-37/D-38)
```yaml
  bridge:
    build: { context: ./bridge }
    image: ${SIFT_BRIDGE_IMAGE:-sift-bridge:local}
    environment:
      SIFT_BRIDGE_KEYCHAIN_PASSPHRASE: ${SIFT_BRIDGE_KEYCHAIN_PASSPHRASE:?set in .env}
    volumes:
      - sift-bridge:/data
      - sift-bridge-cert:/cert
    ports: ["127.0.0.1:${SIFT_BRIDGE_PORT:-1143}:1143"]
    healthcheck:
      test: ["CMD", "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/1143"]
      interval: 30s
      timeout: 5s
      retries: 3
    restart: unless-stopped
volumes:
  sift-bridge:
    name: ${SIFT_BRIDGE_VOLUME:-sift-bridge}
    external: true
```
The worker gets `sift-bridge-cert:/bridge-cert:ro` and no `depends_on: bridge`. No `start_interval` (Compose 2.2.3; existing compose test).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| imapflow 1.x JS + `@types` | imapflow 2.x TypeScript, ESM+CJS, `lib/` no longer published | 2.0.0, 2026-09-07 | Import from the root only; types bundled [VERIFIED: CHANGELOG] |
| Bridge `--enable/disable-keychain-test` flags | Deprecated no-ops (BRIDGE-281) | ≤ v3.27 | Do not rely on them [VERIFIED: app.go:107-121] |
| Community images (shenxn etc.) with socat 143→1143 | Same idea; bind the container IP | — | Pattern 1/Pitfall 1 |

**Deprecated/outdated:** the host's Bridge.app 3.8.1 is about three years old. Do not use it for the spike; use the pinned 3.27.0 container.

## Spike probe design (SPK-01..04, D-43)

A repeatable, opt-in command, for example `sift bridge probe [--label-test] [--json <path>]` under `apps/worker/src/commands/`, using the same `bridgeClient()` (so it exercises STARTTLS and the pin). Read-only by default; the `--label-test` steps print what they will do and require a typed confirmation:
1. CAPABILITY pre- and post-auth; `ENABLE CONDSTORE QRESYNC`; `STATUS <folder> (HIGHESTMODSEQ UIDNEXT UIDVALIDITY MESSAGES)`; LIST `"" "*"` (names only, delimiter).
2. Headers-only scan of INBOX: counts of `X-Pm-Internal-Id` present/absent, `Message-ID` absent, `@protonmail.internalid` IDs, duplicate normalised Message-IDs with distinct internal IDs, `Message-ID` ≠ `X-Pm-External-Id`, and INTERNALDATE vs Date skew. Record (uid, internalDate, sha256(internalId)) for N=20 messages into the JSON for later comparison.
3. (`--label-test`) Create or reuse `Labels/Sift Spike`; `UID COPY` the owner-chosen test UID; read it there: UID, raw `Message-ID` + `X-Pm-Internal-Id` bytes compared with INBOX; check the INBOX copy is still present.
4. Optional: IDLE for 60 s while the owner sends themselves a mail, recording untagged responses.
5. Remove the label (`\Deleted` + `UID EXPUNGE` in the label folder); confirm the INBOX copy remains.
6. UIDVALIDITY: record → `docker compose restart bridge` → record; then a gRPC `TriggerRepair` (helper) or CLI `repair` → record; compare INTERNALDATEs from step 2.
7. Write aggregates to `02-SPIKE-FINDINGS.md`: the capability decision ("polling only"), the Phase 4 implications (apply = `UID COPY INBOX → Labels/X`; remove = expunge in the label folder; record the `Labels/X` UID for echo suppression), the identity decision, the hash inputs, and the UIDVALIDITY triggers. Then add the ADR-0003 addendum.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | drizzle 0.45 `onConflictDoUpdate` with a composite target plus `returning` with `sql\`(xmax = 0)\`` works as sketched | Pattern 7 | Small: fall back to `onConflictDoNothing` + select |
| A2 | Renovate `github-tags` fills `currentDigest` with the tag's commit SHA | Code Examples | Bumps tag without SHA → build fails at the `test` line (fail-safe); fix the config |
| A3 | `gpgconf` puts the agent socket in `/run/user/1000/gnupg` once that dir exists | Pattern 2 | Two containers sharing one socket path in the volume; harmless if init never runs concurrently |
| A4 | Bridge serves IMAP during its first full sync (UIDs assigned to old mail after Sift's start point) | Pitfall 6 | None if the INTERNALDATE gate is implemented as recommended |
| A5 | A missing bind-mount source becomes a directory | Pitfall 4 | Init writes into a directory and fails; guard by checking file type |
| A6 | `hdr:` hash inputs (Date, From, To, Cc, Subject, In-Reply-To, size) | Code Examples | Spike decides; affects only fallback keys |
| A7 | Go `internal/` import rule lets an in-tree `cmd/sift-helper` import `internal/frontend/grpc` | Pattern 3 | Then vendor `bridge.proto` and generate a client (protoc) instead |
| A8 | `make build-nogui` setting `BRIDGE_APP_VERSION=3.27.0` (instead of `3.27.0+git`) is accepted by Proton's API version checks | Pattern 1 | Possible `AppVersionBad`; the trial build reported version `3.27.0` and community images do the same, but untested against the API |

## Open Questions

1. **Where `sift bridge init` actually runs.**
   - Known: the `sift` CLI lives in the Node image without Docker access. Bridge's login must run in the Bridge image. README already says `docker compose run --rm bridge init`.
   - Unclear: whether D-36's `sift bridge init` is a documented alias, a host wrapper script (which could also take the `.env.mailboxes` backup, Pitfall 4), or the bridge entrypoint mode.
   - Recommendation: entrypoint mode `init` in the bridge image, invoked as `docker compose run --rm bridge init`, plus `scripts/bridge-init.sh` for the host-side precondition checks and backup. Confirm the user-facing name with the owner (`user-facing-text.test.ts` pins documented commands).
2. **Where the trusted cert lives.** Recommendation: `trusted.pem` in the cert volume, written by init (owner present, fingerprint shown) and by `sift bridge trust` (a one-off run that mounts the volume rw). The worker mounts it ro. Alternative: a DB table written by the owner role. That needs a catalog allowlist entry; reject it unless the planner needs multi-Bridge support.
3. **Config placement (one-way).** `initial_backfill_days` under `mailboxes[].imap` vs on the mailbox entry, and the cap key (suggest `worker.max_new_messages_per_cycle`, default 200). Neither needs a registry column: the worker reads them from config at start (they only matter for first sync and per-cycle checks). That avoids changing the fixed `MAILBOX_COLUMNS` / catalog test.
4. **Backfill vs cap.** Recommend the CLI backfill bypasses the cap (the owner asked for it explicitly), but prints the count and requires `--days` between 1 and 30. State it in help text.
5. **Running the CLI backfill:** `docker compose exec worker sift mailbox backfill <slug> --days 3`. The worker container has the app URL, mailbox passwords and the cert mount, and the ingest lock serialises it against the running worker. `sift mailbox resume <slug>` can run via `setup` (owner, like `mailbox list`).
6. **`sift mailbox sync` cross-process nudge.** `nudge()` is in-process. A CLI in another container needs a DB signal (for example `mailbox_status.sync_requested_at` read on each tick) or LISTEN/NOTIFY. The command is optional; defer it unless cheap.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker Engine | Bridge build/run, Dovecot tests | ✓ | 20.10.12 (Docker Desktop, hyperkit, x86_64) | — |
| Docker Compose | stack | ✓ | v2.2.3 (no `start_interval`, no `additional_contexts`; external-volume trap) | — |
| BuildKit / buildx | `# syntax=docker/dockerfile:1` | ✓ | buildx 0.7.1; trial build succeeded | — |
| Network to GitHub + proxy.golang.org | Bridge build | ✓ | trial build downloaded modules | — |
| Node | worker | ✓ | 26.10.0 via nvm (shell default 26.3.0 — use PATH prefix) | — |
| openssl CLI | test cert generation, probes | ✓ | macOS openssl (supports `-addext`) | commit a test-only fixture cert |
| Go | not needed on host (built in Docker) | ✓ | 1.27.1 | — |
| Postgres 18 + pgvector | DB tests | ✓ | sift-db-1 running (PG 18.6) | — |
| Proton paid account + 2FA device | live spike | owner | — | none: the spike is a human checkpoint |
| Desktop Proton Mail Bridge.app | — | installed 3.8.1 (not running) | conflicts on 127.0.0.1:1143 if started | quit it during the spike |
| Dovecot image | adapter tests | pullable | `dovecot/dovecot:2.4.5` | in-memory fake for engine tests |

**Missing dependencies with no fallback:** none. The live spike needs the owner (credentials, 2FA, approval of the label test).
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.2 (root `vitest.config.ts`, `include: packages/*/test/**, apps/*/test/**`, globalSetup migrates a template DB) |
| Config file | `/Users/samuel/dev/sift/vitest.config.ts` |
| Quick run command | `pnpm vitest run apps/worker/test/<file>.test.ts` (with the cerebrum PATH prefix) |
| Full suite command | `pnpm lint && pnpm typecheck && pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SPK-01..04 | Findings doc exists with required sections (labels, CONDSTORE/QRESYNC decision, Message-ID stats, UIDVALIDITY, Phase 4 implications) and no mail content | doc-contract unit | `pnpm vitest run apps/worker/test/spike-findings.test.ts` | ❌ Wave 0 |
| SPK-01..04 | Live measurements on the real mailbox | manual (human checkpoint) | `docker compose run --rm worker sift bridge probe --json …` | ❌ |
| SPK (probe) | Probe output holds aggregates only (no subject/from/body) | unit (fake source) | `pnpm vitest run apps/worker/test/bridge-probe.test.ts` | ❌ Wave 0 |
| ING-01 | No STARTTLS → fails before any LOGIN/AUTHENTICATE bytes (D-42) | unit (fake net.Server) | `pnpm vitest run apps/worker/test/imap-starttls.test.ts` | ❌ Wave 0 |
| ING-01 | Pin match connects; other key → `SIFT_BRIDGE_PIN_MISMATCH` and the D-41 message; never `rejectUnauthorized` false | unit (node tls server + openssl cert) + negative grep | `pnpm vitest run apps/worker/test/imap-pin.test.ts` | ❌ Wave 0 |
| ING-01 | Error classes → `connecting` during grace, then "Bridge unreachable" / "Bridge rejected login" | unit | `pnpm vitest run apps/worker/test/mailbox-batch.test.ts` | ❌ Wave 0 |
| ING-02 | Ingest twice → same row counts; identity kinds; NUL stripping; header subset; body cap + truncated flag; attachments metadata | unit (engine, fake source) + DB integration | `pnpm vitest run apps/worker/test/ingest-engine.test.ts packages/db/test/ingest.test.ts` | ❌ Wave 0 |
| ING-02 | New tables pass catalog + isolation suites | DB integration | `pnpm vitest run packages/db/test/catalog.test.ts packages/db/test/isolation.test.ts` | ✅ (update) |
| ING-02 / D-11 | Flags identical before/after ingest; EXAMINE used | integration (Dovecot) | `pnpm vitest run apps/worker/test/imap-dovecot.test.ts` | ❌ Wave 0 |
| ING-03 | New message after first sync ingested on next poll; `n:*` boundary returns no duplicate | unit (fake) + Dovecot APPEND | same files as above | ❌ |
| ING-04 | UIDVALIDITY change → generation N+1, no new `message` rows, eligibility unchanged, counts persisted; failure mid-resync keeps generation N authoritative; `resyncing` set | unit (fake) + Dovecot `doveadm mailbox update --uid-validity` | `pnpm vitest run apps/worker/test/ingest-resync.test.ts` | ❌ Wave 0 |
| D-26 | > cap new → `needs_attention`, nothing stored; `sift mailbox resume` clears it | unit + CLI | `pnpm vitest run apps/worker/test/mailbox-resume.test.ts` | ❌ |
| D-03 | Second concurrent ingest of one mailbox skips (lock busy); lock released on disconnect | DB integration | `pnpm vitest run packages/db/test/lock.test.ts` | ❌ Wave 0 |
| D-04/D-53 | Abort between chunks; resume from the last committed chunk | unit | `pnpm vitest run apps/worker/test/ingest-engine.test.ts` | ❌ |
| D-28 | `nudge()` runs a due mailbox now, never overlapping | unit (fake timers) | `pnpm vitest run apps/worker/test/supervisor.test.ts` | ✅ (extend) |
| D-29..D-38 | compose: bridge service, loopback port, external volume name var, passphrase only on bridge, worker cert mount ro, no depends_on bridge | static | `pnpm vitest run apps/worker/test/compose.test.ts` | ✅ (update "defines db, setup and worker") |
| D-30/D-31 | Dockerfile pins tag+SHA, SHA check line present; renovate.json validates | static | `pnpm vitest run apps/worker/test/bridge-image.test.ts` | ❌ Wave 0 |
| D-02 | Config schema accepts/rejects `initial_backfill_days` and the cap; example config validates | unit | `pnpm vitest run packages/core/test/config.test.ts packages/core/test/example-config.test.ts` | ✅ (extend) |

### Sampling Rate
- **Per task commit:** the quick command for the touched test file(s).
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm test`.
- **Phase gate:** full suite green before `/gsd-verify-work`, plus the owner-run spike and a manual end-to-end check (worker ingests a self-sent mail within one interval; restart adds nothing).

### Wave 0 Gaps
- [ ] `apps/worker/test/support/fake-folder-source.ts`: in-memory `FolderSource` with `bumpUidValidity()`, `append()`, `expunge()`.
- [ ] `apps/worker/test/support/tls-fixtures.ts`: generates two CA:true self-signed certs via `openssl req -x509 … -addext` into a temp dir (verified to work on this Mac).
- [ ] `apps/worker/test/support/fake-imap-server.ts`: plaintext greeting without STARTTLS that records received lines. Call `socket.resume()` / attach a `data` listener (cerebrum Do-Not-Repeat).
- [ ] Dovecot harness: compose profile or `docker run` step (rootless image, IMAP 31143, mounted `tls.crt/tls.key`, `USER_PASSWORD`), env `SIFT_TEST_IMAP_URL`. CI: a step after checkout (service containers start before checkout, so they cannot mount repo files).
- [ ] `packages/db/test/support/seed.ts`: seed the new tables and the new NOT NULL `message` columns.
- [ ] `packages/db/test/lock.test.ts`, `packages/db/test/ingest.test.ts`.

## Security Domain

`security_enforcement` is true, ASVS level 1, block on high.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (IMAP to Bridge; Bridge to Proton) | Bridge password from env (`password_env`), never logged (ImapFlow marks the LOGIN arg `sensitive` [VERIFIED: commands/login.js:17-21]), plus `redactText` with the secret values; the Proton password is typed only into Bridge's no-echo prompt |
| V3 Session Management | yes (Bridge vault session tokens) | `sift-bridge` volume, GPG/pass keychain with an env passphrase, excluded from backups; docs state the token sensitivity (D-37) |
| V4 Access Control | yes | RLS on every new table; ingest lock; Bridge port on loopback only |
| V5 Validation, Sanitization | yes (untrusted mail) | libmime parsing, length caps on stored headers, NUL stripping, `maxBytes` on downloads, html-to-text (no HTML stored) |
| V6 Cryptography | yes | No hand-rolled crypto: Node TLS + `X509Certificate` SPKI sha256; GnuPG for the vault key |
| V7 Error Handling, Logging | yes | Counts and IDs only; no subjects, senders or bodies in logs or findings; fixed error messages per class |
| V9 Communications | yes | STARTTLS mandatory (`doSTARTTLS: true`), `ca` + SPKI pin, TLS ≥ 1.2; no plaintext fallback |
| V14 Configuration | yes | Pinned Bridge tag+SHA; telemetry off; auto-update off; passphrase only on the bridge service |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| STARTTLS stripping on the compose network | Tampering / Info disclosure | `doSTARTTLS: true` throws before LOGIN [VERIFIED: imap-flow.js:1290-1300]; D-42 fake-server test |
| STARTTLS response injection | Tampering | ImapFlow `STARTTLS_INJECTION` guard (built in) |
| Swapped Bridge / new vault presenting a new cert | Spoofing | SPKI pin with `ca`; fail closed; owner-run `sift bridge trust` |
| Pin bypass via `rejectUnauthorized: false` | Spoofing | Banned literal (negative grep), probe-backed test |
| Sender forges Message-ID to suppress classification | Tampering / Repudiation | `pm:` identity (Bridge overwrites `X-Pm-Internal-Id`); `mid:` only as fallback |
| Copied `sift-bridge` volume | Info disclosure | Vault key in pass/GPG behind `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE` (not in the volume); FDE (D-10) |
| Silent insecure-vault fallback | Info disclosure | Entrypoint canary + `insecure` dir check, exit 78 |
| Passphrase in `docker inspect` / tini's environ | Info disclosure | Accepted: Docker access is root-equivalent. `unset` before `exec bridge`; consider Compose `secrets:` later |
| Huge or malformed mail exhausting memory | DoS | Part download with `maxBytes`, headers-only resync, chunking, volume valve |
| Bridge telemetry leaving the network | Info disclosure | `SetIsTelemetryDisabled(true)` at init; no Sentry DSN in local builds [CITED: BUILDS.md] |
| Bridge port exposed beyond loopback | Elevation | `127.0.0.1:` publish only (compose test) |

## Sources

### Primary (HIGH confidence)
- `ProtonMail/proton-bridge` at tag v3.27.0 (commit 04e46eb4…), cloned and read: `Makefile`, `BUILDS.md`, `go.mod`, `internal/app/{app,vault,frontend,singleinstance}.go`, `internal/constants/*`, `internal/frontend/grpc/{bridge.proto,service.go,service_user.go,service_cert.go,utils.go}`, `internal/frontend/cli/accounts.go`, `internal/vault/*`, `internal/user/user.go`, `pkg/algo/encode.go`, `pkg/keychain/helper_linux.go`, `pkg/message/build.go`, `internal/services/imapservice/{helpers,connector,sync_build}.go`, `internal/certs/tls.go`, `internal/locations/*`
- `ProtonMail/gluon` at 7e800978ab4a (Bridge's pinned version): `imap/capabilities.go`, `internal/session/session.go`, `imap/uid_validity_generator.go`, `internal/backend/connector_updates.go`, `internal/state/updates.go`
- Runtime probes this session: Bridge 3.27.0 Docker build (exit 0) and `--version`; keychain fallback and preset unlock; listener addresses, greeting/CAPABILITY, cert via `openssl s_client -starttls imap`; socat bind; Node 26.10 TLS `checkServerIdentity` matrix; Compose 2.2.3 external-volume failure; single-file bind-mount rename EBUSY; PG 18.6 NUL rejection
- imapflow 2.1.0 package source (`dist/esm/imap-flow.js`, `commands/{fetch,login,select}.js`, `download.js`, `errors.d.ts`, `types.d.ts`, `CHANGELOG.md`); libmime 5.4.5 source; html-to-text 10.0.1 package; mailparser 3.9.28 source
- npm registry (`npm view` versions, publish times, deps, postinstall); gsd package-legitimacy seam
- Repo files read this session: `packages/db/src/{scope,app-db,status,index,registry-read}.ts`, `packages/db/src/schema/{scoped,index,mailbox}.ts`, `packages/db/src/owner/{registry,migrate}.ts`, `packages/db/test/support/seed.ts`, `packages/core/src/config/schema.ts`, `apps/worker/src/runtime/{mailbox-batch,supervisor}.ts`, `apps/worker/src/{cli,command}.ts`, `apps/worker/src/commands/worker.ts`, `compose.yaml`, `Dockerfile`, `config/config.example.yaml`, `pnpm-workspace.yaml`, `vitest.config.ts`, `.github/workflows/ci.yml`, `docs/adr/0003-*.md`

### Secondary (MEDIUM confidence)
- Context7 `/websites/imapflow` (configuration, fetch deadlock warning, getMailboxLock); `/websites/renovatebot` (regex manager, required capture groups)
- postgresql.org/docs/18/functions-admin.html (advisory lock key spaces, release at session end)
- gnupg.org manual (gpg-preset-passphrase, Agent-Options)
- doc.dovecot.org (Docker image, doveadm mailbox update)
- RFC 3501 text (§2.3.1.1, §6.4.8)

### Tertiary (LOW confidence)
- None relied on.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Versions from the registry; behaviour read from the package source.
- Bridge deployment (build, keychain, ports, cert, gRPC): HIGH. Source plus runtime probes. The remaining unknowns are the live-account questions, which belong to the spike by design.
- Architecture (sync engine, lock, schema shape): MEDIUM-HIGH. It rests on verified primitives; exact column names are the planner's.
- Pitfalls: HIGH. Most were reproduced this session.

**Research date:** 2026-10-05
**Valid until:** about 2026-11-05 for Bridge (monthly releases; Renovate will bump) and about 2026-10-20 for the npm pins (imapflow and libmime ship several releases a week).
