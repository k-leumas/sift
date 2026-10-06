# Phase 2 Live Ingest: the worker against the owner's Proton mailbox

Status: in progress

Measured on Proton Bridge v3.27.0 (commit 04e46eb4) with the Phase 2 worker, 2026-10-06.

This record covers ROADMAP Phase 2 success criteria 3, 4 and 5 on the owner's real mailbox. It holds counts, UIDs, UIDVALIDITY numbers, generations, durations and times only. The raw snapshots (`s1.json`, `s2.json`, ...) and worker logs stay in the git-ignored `data/live/` directory.

## Method

- **Bridge:** v3.27.0 (commit 04e46eb4), the `sift-bridge:local` container logged in by 02-14. This run never stopped, restarted or recreated it: the worker was brought up with a scoped `docker compose up -d --build worker` instead of the plan's `docker compose up -d --build`, so only `setup` and `worker` were recreated. (The bridge container was created at 13:18:21Z; its last start, 17:27:40Z, came before this run's `up`.)
- **TLS pin preflight:** `sift bridge trust personal` printed `It matches imap.tls.pin_sha256.` and exited 0 (17:20Z).
- **Worker image:** `sift:local`, created 2026-10-06T14:43:11Z. The 17:53Z build reused every cached layer of that build, so the code is the same.
- **initial_backfill_days:** 1. **Deviation from D-84:** 02-SPIKE-FINDINGS.md records `**Post-spike initial_backfill_days:** 30`, and the plan restores that value before the worker starts. At an ad-hoc checkpoint during Bridge's initial sync the owner changed it from 30 to 1 and chose to start at once ("1 day, start now"). The recorded spike value was left unchanged.
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
