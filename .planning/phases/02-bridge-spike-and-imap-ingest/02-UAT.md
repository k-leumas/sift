---
status: testing
phase: 02-bridge-spike-and-imap-ingest
source: [02-VERIFICATION.md]
started: 2026-10-06T21:42:48Z
updated: 2026-10-06T23:42:14Z
---

## Current Test

number: 2
name: SPK-04 Bridge repair behaviour
expected: |
  Owner accepts the override (repair unmeasured) or approves one bridge-init repair.
awaiting: user response

## Tests

### 1. Redeploy the worker with the review fixes
expected: worker rebuilt from HEAD (fixes 9d1daa6..c7a580c); personal ok; 0 duplicates
result: pass (worker image 2026-10-06T23:41:32Z, personal ok, 91,359 messages = 91,359 live locations, 0 duplicate keys, 0 duplicate (folder, uidvalidity, uid), bridge untouched)

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
passed: 1
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
