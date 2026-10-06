---
status: testing
phase: 02-bridge-spike-and-imap-ingest
source: [02-VERIFICATION.md]
started: 2026-10-06T21:42:48Z
updated: 2026-10-06T21:42:48Z
---

## Current Test

number: 1
name: Redeploy the worker with the review fixes
expected: |
  After `docker compose up -d --build worker`, `sift mailbox list` shows personal ok, and the duplicate-count query from 02-LIVE-INGEST.md returns 0 duplicate identity keys and 0 duplicate (uidvalidity, uid) pairs.
awaiting: user response

## Tests

### 1. Redeploy the worker with the review fixes
expected: worker rebuilt from HEAD (fixes 9d1daa6..c7a580c); personal ok; 0 duplicates
result: [pending]

### 2. SPK-04 Bridge repair behaviour
expected: owner either accepts the override (repair unmeasured, restart measured) or approves one bridge-init repair and the UIDVALIDITY/INTERNALDATE outcome is recorded
result: [pending]

### 3. 02-16 lock-span must-have changed by WR-02
expected: owner accepts two lock sessions (count, ingest) with D-03 preserved, or asks for the original single-lock behaviour
result: [pending]

### 4. WR-03 watermark capped at worker clock
expected: owner confirms capping INTERNALDATE at "now" is the intended trade-off
result: [pending]

### 5. WR-04 pm: trust requires a pin
expected: owner confirms "mailbox has pin_sha256" is an acceptable stand-in for "server is Proton Bridge"
result: [pending]

### 6. Judgment-tier prohibitions in 02-11, 02-14, 02-19
expected: owner confirms the records match what happened (dump taken, worker stopped, single UPDATE 1, Bridge never repaired, no mail content recorded)
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
