---
status: testing
phase: 01-foundation-and-isolation
source: [01-VERIFICATION.md]
started: 2026-10-04T20:30:00Z
updated: 2026-10-07T23:06:51Z
---

## Current Test

number: 5
name: Real-password grep after real ingest (re-verification 2026-10-07)
expected: |
  On the home machine, after Bridge has run bridge-init and ingested real mail, grepping config/
  and a pg_dump of the `sift` database for each real Bridge IMAP password finds no match.
awaiting: user response

## Tests

### 1. Target-machine bring-up (SC1)
expected: db healthy; setup exits 0 after writing a dump to ./backups and recording 5 migrations; worker healthy.
result: pass

### 2. Real-password grep (SC2 manual half)
expected: After a real bring-up, grepping config/ and a pg_dump of `sift` for each real Bridge password finds no match.
result: pass

### 3. CI on GitHub
expected: After a push, the Actions run shows `check` green and `compose-smoke` green, ending in "compose smoke OK".
result: pass

### 4. Backstop: id-based comparisons in isolation tests
expected: The assertions in isolation.test.ts and owner-rls.test.ts use only id-set comparisons (sortedIds, arrayContaining, every) and never index query results by position.
result: pass

### 5. Real-password grep after real ingest (re-verification 2026-10-07)
expected: On the home machine, after bridge-init and a real ingest, grepping config/ and a pg_dump of `sift` for each real Bridge IMAP password finds no match. (Test 2 passed before any mail was stored and before bridge-init wrote .env.mailboxes / .env.mailboxes.bak.)
result: [pending]

## Summary

total: 5
passed: 4
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
