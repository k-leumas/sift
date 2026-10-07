# Phase 2 Live Ingest: the worker against the owner's Proton mailbox

Measured on Proton Bridge v3.27.0 (commit 04e46eb4) with the Phase 2 worker, 2026-10-06.

This record covers ROADMAP Phase 2 success criteria 3, 4 and 5 on the owner's real mailbox. It holds counts, UIDs, UIDVALIDITY numbers, generations, durations and times only. The raw snapshots (`s1.json`, `s2.json`, ...) and worker logs stay in the git-ignored `data/live/` directory.

## Method

- **Bridge:** v3.27.0 (commit 04e46eb4), the `sift-bridge:local` container logged in by 02-14. This run never stopped, restarted or recreated it: the worker was brought up with a scoped `docker compose up -d --build worker` instead of the plan's `docker compose up -d --build`, so only `setup` and `worker` were recreated. (The bridge container was created at 13:18:21Z; its last start, 17:27:40Z, came before this run's `up`.)
- **TLS pin preflight:** `sift bridge trust personal` printed `It matches imap.tls.pin_sha256.` and exited 0 (17:20Z).
- **Worker image:** `sift:local`, created 2026-10-06T14:43:11Z. The 17:53Z build reused every cached layer of that build, so the code is the same.
- **initial_backfill_days:** 1. **Deviation from D-84:** 02-SPIKE-FINDINGS.md records `**Post-spike initial_backfill_days:** 30`, and the plan restores that value before the worker starts. At an ad-hoc checkpoint during Bridge's initial sync the owner changed it from 30 to 1 and chose to start at once ("1 day, start now"). The recorded spike value was left unchanged.
- **Correction (2026-10-07, phase 02 UAT):** 02-SPIKE-FINDINGS.md now records `**Post-spike initial_backfill_days:** 3` as the owner's intended value. This run's 1 day departs from that value too. The 30 cited above is kept as the run-time record.
- **Poll interval:** 60 s (`worker.poll_interval_seconds`). **Folder:** INBOX. **Mailboxes:** one configured mailbox, `personal`. Setup disabled one older mailbox row that is no longer in config.yaml; it holds 0 messages.
- **The run started mid-sync.** Bridge was still running its first, newest-first sync of the account. At the last sync-watch probe (16:34:43Z) INBOX uidNext was 28525. At the worker's first sync the start UID (UIDNEXT - 1) was at most 40828, and Bridge kept adding older mail at higher UIDs for the whole run (S2: last_uid 41320). INBOX UIDVALIDITY was 116082324 throughout.
- **Backups ownership fix:** the first `up` (about 17:23Z) failed in `setup` (exit 1) before any migration ran: the container could not write its pre-migration dump into `backups/`, which on the macOS host was owned by uid 1000. The owner ran `sudo chown "$(id -u)" backups`; a write test from the setup container then passed. The rerun at 17:53:10Z wrote the pre-migration dump and applied 3 migrations (`0005_ingest_preflight`, `0006_ingest_tables`, `0007_ingest_tables_force_grants`), taking the database from 5 to 8 applied migrations.
- **Worker downtime:** the Phase 1 worker was removed at about 17:23Z by the first `up`; the Phase 2 worker started at 17:53:19Z, so no worker ran for about 30 minutes.
- **First sync and backfill:** worker start 17:53:19Z; first-sync watermark logged 17:53:30Z (the newest INTERNALDATE Bridge reported, 505 s old at the time); first `mailbox synced` 17:53:53Z with backfill 55 of 55 finished. **Backfill duration:** 34 s. The first `sift mailbox list` afterwards showed `personal` as `ok` with 55 messages.
- **Commands** (run from the main checkout; outputs kept in `data/live/` or reduced to counts):
  - `docker compose up -d --build worker`
  - `docker compose logs worker` (only the `msg`, `time` and count fields were read)
  - `docker compose run --rm -T setup sift mailbox list`
  - the counts-only snapshot query of the plan, `docker compose exec -T db psql -U postgres -d sift -Atc "<query>" > data/live/<step>.json`
  - R1 and R2 as defined in the plan, with S1's uidvalidity 116082324 and last_uid 40936 and T1 = 17:55:03Z
  - `docker compose restart worker`, then a wait of 2 x 60 s + 30 s
  - criterion 4: every 10 s, `docker compose run --rm --no-deps -T worker sift bridge probe personal --scan-limit 0 --sample 200`, reduced with jq to the count of sample entries with INTERNALDATE at or after T_send, plus one psql count of eligible `personal` rows with a body and INTERNALDATE at or after T_send
  - criterion 5: `docker compose stop worker`, S4, `docker compose exec -T db pg_dump -U postgres -Fc sift > backups/sift-<stamp>-pre-live-resync.dump`, the plan's one-row `update folder_sync set uidvalidity = uidvalidity + 1 ...` for INBOX, `docker compose start worker`, then S5 and C1 to C3 as defined in the plan

## Mid-sync historical rows

Because Bridge was still syncing older mail, every poll found new UIDs above the start UID that carry old INTERNALDATEs. The worker stores them as historical rows (D-21): a message row and a location, no body, not eligible for classification.

| Check | S1 (17:54:38Z) | S2 (17:57:38Z) |
|-------|----------------|----------------|
| Historical rows above the start UID | 108 (UIDs 40829 to 40936) | 492 |
| ... eligible | 0 | 0 |
| ... with a body row | 0 | 0 |
| ... with INTERNALDATE after the first-sync watermark | 0 | 0 |
| ... with INTERNALDATE within the 1-day window | 0 | 0 |
| Eligible rows (all from the backfill) | 55 | 55 |
| mailbox_status state | ok | ok |
| held_new_count | none | none |

The worker log's `mailbox synced` lines report `stored` 0 and `historical` 0, 108, 104, 111 and 169 for the five cycles, which adds up to the 492 rows. No log line mentions the volume valve, a hold or needs attention. The INTERNALDATE gate therefore kept every mid-sync historical row out of the eligible and new-mail counts, and they did not trip the volume valve (D-26).

## Criterion 3: stored once, restart adds nothing

S1 was taken at 17:54:38Z. T1 = 17:55:03Z; `docker compose restart worker` finished at 17:55:04Z, the worker logged `worker started` at 17:55:06Z and its first cycle at 17:55:07Z. S2 was taken at 17:57:38Z, after 150 s.

| Count | S1 | S2 |
|-------|----|----|
| messages | 163 | 547 |
| eligible | 55 | 55 |
| live locations | 163 | 547 |
| removed locations | 0 | 0 |
| bodies | 55 | 55 |
| outside (rows of any other mailbox) | 0 | 0 |
| folder uidvalidity | 116082324 | 116082324 |
| folder last_uid | 40936 | 41320 |
| folder generation | 1 | 1 |
| folder state | ok | ok |
| mailbox_status state | ok | ok |

- **R1** (locations at uidvalidity 116082324 with UID <= 40936): 163 before the restart, 163 after.
- **R2** (messages created after T1 with no location above UID 40936): 0. All 384 messages created after T1 have a location above 40936; they are the mid-sync historical rows above.
- **Duplicates at S2:** 0 (uidvalidity, UID) pairs with more than one location, 0 identity keys with more than one message row, and messages equal live locations (547).

**Criterion 3:** pass

## Criterion 4: new mail within one poll

The owner replied `ready: simulate` and then sent one short email from an external (non-Proton) account. T_send = 19:17:44Z, the time the reply reached the orchestrator; the email was sent after it. Nothing was restarted from T_send until the measurement ended at 19:21:10Z: the worker and Bridge ran throughout.

- **Signal (deviation from the plan):** the plan takes T_bridge from the light probe's `folderStatus.uidNext` growing past U0. Bridge was still adding older mail at higher UIDs (about 120 UIDs a minute, see the mid-sync section), so uidNext grew every few seconds whatever the owner sent. T_bridge is instead the end of the first probe whose newest-200 sample holds an entry with INTERNALDATE at or after T_send. T_db is the first 10 s check that finds an eligible `personal` row with a body row and INTERNALDATE at or after T_send.
- **U0:** uidNext 50813 at 19:18:18Z (one light probe before polling). **S3** (19:19:26Z): last_uid 50922, 10149 messages, 57 eligible, 57 bodies, generation 1, state ok.
- **Polling:** started at 19:18:42Z, 58 s after T_send. Seven probes found no new entry, the last ending at 19:20:15Z. The eighth ran from 19:20:26Z to 19:20:35Z and found 1 entry, UID 51105. **T_bridge = 19:20:35Z**, 171 s after T_send (this includes the external delivery). The message's INTERNALDATE is 153 s after T_send.
- **Database:** the check at 19:20:58Z found 0 rows; the check at 19:21:09Z found 1. The message row and its body row were created at 19:21:08.882Z by the worker cycle logged at 19:21:09Z (`stored` 1, `historical` 108). The cycle before it ran at 19:20:09Z, before Bridge had the message. **T_db = 19:21:09Z.**
- **T_db - T_bridge:** 34 s. The limit is the 60 s poll interval plus 20 s of measurement granularity, 80 s. From INTERNALDATE to the row: 52 s.
- **The row:** eligible for classification: yes. Body rows: 1. Location UID 51105, above S3's last_uid 50922, UIDVALIDITY 116082324, generation 1.

**Criterion 4:** pass

## Criterion 5: UIDVALIDITY resync

**UIDVALIDITY method:** simulated mismatch

Bridge's own UIDVALIDITY change was not observed; Sift changed its stored value instead. The spike did not run a Bridge repair (the owner approved `no-repair`), so [02-SPIKE-FINDINGS.md](02-SPIKE-FINDINGS.md) (SPK-04) does not record a repair changing UIDVALIDITY, and it stayed 116082324 across two Bridge restarts. The owner chose `ready: simulate`. Bridge was not stopped, restarted or repaired: its container still shows the 17:27:40Z start.

- **Worker stopped:** `docker compose stop worker` from 19:21:39Z to 19:21:45Z.
- **T4 = 19:21:48Z**, the time of S4, taken with the worker stopped.
- **Dump:** `backups/sift-20261006T192158Z-pre-live-resync.dump` (custom format, 4445734 bytes, 11 table-data entries; git-ignored).
- **The change:** one `update folder_sync` (`UPDATE 1`) set INBOX uidvalidity from 116082324 to 116082325 at 19:22:28Z or just before; last_uid 51176, generation 1 and state ok were left as they were. No other row was edited.
- **Worker started:** `docker compose start worker` at 19:22:39Z; `worker started` logged at 19:22:42Z.
- **T5 = 19:24:55.994Z**, the time of the one log line `INBOX resynced: 10,403 matched, 1 new, 0 gone, 40,939 older than backfill window`, 2 min 14 s after the start. The next line, `mailbox synced`, came at 19:24:56Z. S5 was taken at 19:25:19Z.

| Count | S4 (worker stopped) | S5 (after the resync) |
|-------|---------------------|-----------------------|
| messages | 10403 | 51343 |
| eligible | 58 | 59 |
| live locations | 10403 | 51343 |
| removed locations | 0 | 0 |
| bodies | 58 | 59 |
| outside (rows of any other mailbox) | 0 | 0 |
| folder uidvalidity | 116082324 (116082325 after the change) | 116082324 |
| folder last_uid | 51176 | 51345 |
| folder generation | 1 | 2 |
| folder state | ok | ok |
| mailbox_status state | ok | ok |
| held_new_count | none | none |

- **Persisted resync summary** (`folder_sync.last_resync_summary`): matched 10403, new 1, gone 0, older 40939.
- **Matched:** 10403, the same as the 10403 rows created up to T4. Every row Sift already had kept its message row; the resync only moved their locations to generation 2.
- **Older:** 40939 messages of the folder that Sift had not stored before: the mail below the first-sync start UID and the older mail Bridge kept adding above S4's last_uid. All of them are historical rows: no body, not eligible.
- **New:** 1 eligible row with a body (UID 51307), mail that arrived after S4's last_uid with an INTERNALDATE after the first-sync watermark.
- **C1** (live locations not in generation 2): 0.
- **C2** (rows created after T4 and up to T5): 40940, which equals the summary's new + older (1 + 40939). Of these 1 is eligible and 1 has a body. No row was created between T5 and S5.
- **C3** (rows created up to T4 that are eligible): 58, which equals S4's eligible (58). Rows created up to T4 still have 58 bodies.
- **Duplicates at S5:** 0 (uidvalidity, UID) pairs with more than one live location, 0 identity keys with more than one message row, 0 messages with more than one location; all 51343 locations are at UIDVALIDITY 116082324.
- **The criterion 4 message** kept its single row and UID 51105, now in generation 2.
- **Held count:** none. The resync was not held by the new-mail limit, mailbox_status stayed ok and `sift mailbox resume personal` was not run. The worker logged no warning or error from 19:18Z to S5.

**Criterion 5:** pass

## Result

Criteria 3, 4 and 5 passed on the owner's real mailbox through Bridge v3.27.0. Criterion 5 used the simulated mismatch, so per D-86 the result is partial.

**Live ingest:** partial: criterion 5 by simulated mismatch; Bridge's own UIDVALIDITY change was not observed
