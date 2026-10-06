# Phase 2 Spike Findings: Proton Bridge against the owner's mailbox

Measured on Proton Bridge v3.27.0 (commit 04e46eb4), 2026-10-06; later Bridge versions may differ.

Every statement below is an observation of that Bridge build against the owner's real, paid Proton account in combined address mode. The account was in its **initial Bridge sync** for the whole run (see Method). Numbers are aggregates from probe reports kept in the git-ignored `data/spike/` directory.

## Labels as folders (SPK-01)

- **Layout:** the hierarchy delimiter is `/`. LIST returned 26 folders before the test: 6 under the `Labels/` prefix, 10 under `Folders/`, and the special-use roles `\Archive`, `\Drafts`, `\Inbox`, `\Junk`, `\Sent` and `\Trash`. After the test there were 27 folders, 7 of them under `Labels/` (the new, empty spike label).
- **Create:** `CREATE Labels/Sift Spike` created the label. The new label folder got its own UIDVALIDITY (116084798), different from INBOX's (116082324).
- **Apply:** `UID COPY <uid> Labels/<name>` applies the label. It returned COPYUID (UIDPLUS), which named the label-folder UID of the copy.
- **Bridge refuses COPY from an EXAMINEd source.** The first attempt copied from INBOX opened with EXAMINE. Bridge answered `NO` ("the mailbox is read-only") and wrote nothing; the label folder stayed at 0 messages. RFC 3501 allows COPY from a read-only mailbox, and Dovecot accepts it, but Bridge's IMAP layer (gluon) does not. The source must be SELECTed read-write for the COPY. COPY itself does not change the source message. The SELECT clears only the session-only `\Recent` flag, which Bridge never syncs to Proton.
- **Remove:** in the SELECTed label folder, `\Deleted` plus `UID EXPUNGE <copy uid>` removed the copy. The label folder went back to 0 messages (uidNext 2, so exactly one copy was ever made).
- **INBOX survives both:** the INBOX copy was present after the COPY and after the expunge in the label folder. Removing a label folder copy does not delete the message.
- **Test target:** one of the owner's own self-sent test emails, less than one hour old, chosen by explicit UID (see Method).

## CONDSTORE and QRESYNC (SPK-02)

- **Greeting `[CAPABILITY ...]`:** AUTH=PLAIN, ID, IDLE, IMAP4REV1, MOVE, STARTTLS, UIDPLUS, UNSELECT.
- **Pre-auth CAPABILITY (plaintext, before STARTTLS):** AUTH=PLAIN, ID, IDLE, IMAP4REV1, STARTTLS.
- **Post-auth CAPABILITY:** AUTH=PLAIN, ID, IDLE, IMAP4REV1, MOVE, STARTTLS, UIDPLUS, UNSELECT.
- **CONDSTORE:** not advertised. `ENABLE CONDSTORE QRESYNC` was answered `BAD`; Bridge's log calls ENABLE an unknown command.
- **STATUS HIGHESTMODSEQ:** answered `BAD` (unknown status attribute).
- **QRESYNC:** not advertised, so `VANISHED` is not available for removals (D-17).
- The answers were identical on every probe run, before and after both Bridge restarts.

## Message identity (SPK-03)

Header scan of the newest 2000 INBOX messages by sequence number, plus a fixed snapshot of UIDs 1 to 2000 (1998 messages present):

- **X-Pm-Internal-Id:** present on 2000 of 2000 scanned messages (0 absent) and on 1998 of 1998 in the snapshot. It is unique per message: 0 internal IDs were shared by two UIDs.
- **Across folders:** on the label-test message, the raw X-Pm-Internal-Id bytes and the raw Message-ID bytes of the INBOX copy and the label-folder copy were equal.
- **Message-ID absent:** 0 of 2000. Bridge supplies one when the original has none: 10 of 2000 carried a Message-ID in the `protonmail.internalid` domain.
- **Message-ID versus Bridge's external ID:** 0 of 2000 differed.
- **Duplicate Message-IDs:** 32 Message-IDs in the 2000-message scan were each shared by two or more distinct Proton internal IDs (1.6%); 6 in the fixed snapshot. Proton treats these as distinct messages. Keyed by Message-ID they would merge (D-14); keyed by the internal ID they stay apart.
- **Date skew (Date header versus INTERNALDATE):** p50 2 s, p95 1613 s.
- **Raw bytes:** Message-ID is preserved byte-for-byte across folders (D-13), so the conservative `mid:` normalisation stays correct for servers without the internal ID.

**Identity key:** confirmed, in this order: `pm:` (X-Pm-Internal-Id, trusted only for Bridge mailboxes), then `mid:`, then `hdr:v1:`. On Bridge, `pm:` is present on every message, so `mid:` and `hdr:v1:` are fallbacks for other servers only. The 1.6% duplicate Message-ID rate is the reason `pm:` must come first.

**hdr: inputs (A6):** unchanged. `hdr:v1:` (date, from, to, cc, subject, in-reply-to, plus RFC822.SIZE) was never needed on Bridge: 0 scanned messages lacked both the internal ID and a Message-ID. With no evidence for a change, no `hdr:v2:` is needed.

## UIDVALIDITY and INTERNALDATE (SPK-04)

- **Restart 1 (unplanned, mid-sync):** the owner stopped and started Bridge once at 13:22:57Z, cancelling and restarting the account load. INBOX UIDVALIDITY stayed at 116082324 and the sync resumed from where it was (uidNext 666 before, 778 at the next probe), with no renumbering.
- **Restart 2 (planned, `docker compose restart bridge`):** healthy again after 33 s.
  - INBOX UIDVALIDITY was unchanged (116082324), and the spike label folder's was unchanged too (116084798). No folders were added or missing.
  - Fixed snapshot of UIDs 1 to 2000: 1998 of 1998 messages matched by internal-ID hash, with 0 UID changes and 0 INTERNALDATE changes.
  - Probe sample of 200: 123 matched with 0 UID and 0 INTERNALDATE changes. The other 77 had moved out of the newest-200 window because exactly 77 messages synced in between (6065 to 6142); none were lost.
- **Repair (cache rebuild):** not run. The owner approved `no-repair`, so whether INTERNALDATE and UIDVALIDITY survive a forced repair is **not measured** in this spike.
- **UID order during the initial sync:** Bridge assigned UIDs newest-first. Across UIDs 1 to 2000, INTERNALDATE decreased with rising UID in 1968 of 1997 consecutive pairs and increased in 12 (new mail arriving mid-sync). UID 1 was hours old, UID 1000 about 27 days and UID 2000 about 55 days. New mail that arrives during the sync gets the next free UID in the middle of that range (the test emails got UIDs 1156, 1157 and 1384). A high UID is therefore **not** a sign of new mail while Bridge is still syncing.

**D-18/D-22 design:** stands for restarts: UIDVALIDITY and INTERNALDATE survived two Bridge restarts unchanged, and INTERNALDATE (not UID order) correctly separates new from old mail during Bridge's newest-first initial sync. The last-UID fast path is only a cursor, never a "new mail" test. Survival across a forced repair is unmeasured: plan 02-19 must treat a repair as a UIDVALIDITY reset (D-22 rescan) and record what it sees.

## IDLE

- IDLE is advertised before and after login.
- An IDLE on INBOX saw an untagged EXISTS within 25 s of starting, while the initial sync was adding messages. The probe reported `existsEventSeen: true` and `newMessageArrived: true`.
- During the initial sync, EXISTS events come from synced old mail as well as from new mail, so the IDLE wait's newest UID pointed at synced old mail, not at a new message.
- M1 keeps polling (D-27). IDLE works on this Bridge build and is an option for later.

## Address mode

- The owner's init output: `account 1: addresses: 15, address mode: combined, state: connected`.
- Combined mode is confirmed: one IMAP login and one INBOX for all 15 addresses, which is what D-35 assumes (one Sift mailbox per Proton account).

## Decision for later phases

**Sync capability to assume:** polling only

Bridge v3.27.0 advertises neither CONDSTORE nor QRESYNC, and it answers `BAD` to ENABLE and to STATUS HIGHESTMODSEQ. Change detection must work from UID sets, UIDVALIDITY and INTERNALDATE alone. Removals (D-17) use a periodic UID-set diff, not `VANISHED`.

**Phase 4 label application:** SELECT the source folder read-write (Bridge refuses COPY from EXAMINE). Apply with `UID COPY <uid> Labels/<name>`, creating the label folder with CREATE when it is missing. Record the label-folder UID from COPYUID as the echo-suppression record and as a new `message_location`. Remove by SELECTing the label folder, then `UID STORE <copy uid> +FLAGS (\Deleted)` and `UID EXPUNGE <copy uid>`, never a plain EXPUNGE. Never touch the INBOX copy. Treat a COPY without COPYUID as unconfirmed: write nothing further and resync the label folder. Pause all label actions on a folder while its `folder_sync` is resyncing (D-24).

**M2 relabel detection:** polling only. Per label folder, on each poll: check UIDVALIDITY (a change triggers the D-22 rescan), then diff the folder's UID set against the stored locations. Identify gained or lost messages by X-Pm-Internal-Id (`pm:`), never by Message-ID (1.6% duplicates) or by UID. Skip changes matching Sift's own COPYUID echo records. Without CONDSTORE, flag changes cannot be fetched incrementally; relabel learning needs only membership, not flags.

**Plan 02-19:** start the worker only after Bridge's initial sync has finished (uidNext unchanged across two light probes). Otherwise, also confirm that the INTERNALDATE watermark, not UID order, decides what is new.

## Method

- **Bridge:** Proton Bridge v3.27.0, built from source at commit `04e46eb4fbc1c7ef4425a920bfc352050da0606b` (`bridge/Dockerfile` ARGs `BRIDGE_VERSION` and `BRIDGE_COMMIT`), image `sift-bridge:local`, keychain initialised with `docker compose run --rm --no-deps -T bridge-init keychain-init`.
- **Account setup (Task 2, owner):** interactive login through `docker compose run --rm bridge-init`. The owner's reply: `done: no-repair, backfill 30.` The init output line: `account 1: addresses: 15, address mode: combined, state: connected`. The pin was pasted into the owner's config, and `sift config check` passed. The spike never rewrote the owner's env file after init.
- **Probe:** `docker compose run --rm --no-deps -T worker sift bridge probe personal [--label-test] [--uid <n>] [--wait-new-seconds <n>] [--compare -] [--sample <n>] [--scan-limit <n>]` (plan 02-11), run from the main repository checkout. Each run prints one ProbeReport JSON, saved to `data/spike/`.
- **Supplementary read-only snapshots:** a one-off script used the worker's own config loader and pinned `openImap`. It EXAMINEd INBOX and fetched UID, INTERNALDATE and SHA-256 hashes of the raw X-Pm-Internal-Id and Message-ID values for UIDs 1 to 2000, before and after the planned restart. The probe's newest-by-sequence sample moves while Bridge syncs, so a fixed UID range was needed to compare restarts. The same method (UIDs and ages only) found the test email's UID, and a Message-ID hash match against the Sent folder confirmed it was self-sent.
- **Run date and timeline (2026-10-06, UTC):**
  - 13:18: Bridge started.
  - 13:19: IDLE wait, ended in 25 s by sync EXISTS.
  - 13:20 to 13:56: light probes every 60 s. uidNext grew from 307 to 5572 (about 150 to 210 messages per minute) and never settled within the plan's 30-minute limit, so the initial sync was still running for every later step.
  - 13:22:57: the owner's own Bridge stop and start (restart 1 above).
  - 13:46: first label test refused by Bridge (EXAMINE source).
  - 13:48: label test completed after the probe fix.
  - 13:59: baseline probe and snapshot.
  - 13:59: planned restart and comparison.
- **Login while syncing:** worked on 32 of 34 light probes. The 2 failures ran while the owner had Bridge stopped. Bridge answered LOGIN and STATUS throughout the sync, and folderStatus.uidNext grew between every pair of successful probes.
- **Label test:** completed on one message. The probe's IDLE-reported UID was synced old mail, so it was not used. Three INBOX messages had an INTERNALDATE under one hour old, and all three matched a Message-ID in the Sent folder, so all were the owner's own test emails. The newest one was tested, with an explicit `--uid` and the typed LABEL confirmation. The probe's one-hour age gate and COPYUID-confirmed removal applied. The probe needed one fix first (SELECT the source for COPY; see Labels as folders). No label copy remains; the empty spike label folder remains, as the plan expects.
- **Approved steps:** `no-repair` covers the IDLE wait, the label test on one fresh test email and a restart comparison. No forced Bridge repair was run.
- **Data rule:** this document holds aggregates only: counts, booleans, capability atoms, UID and UIDVALIDITY numbers and durations. No subjects, senders, recipients, email addresses, label names other than Sift's own spike label, raw Message-IDs or message bodies. Raw probe reports never leave `data/spike/`.

**Post-spike initial_backfill_days:** 30
