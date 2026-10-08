---
status: complete
phase: 01-foundation-and-isolation
source: [01-VERIFICATION.md]
started: 2026-10-04T20:30:00Z
updated: 2026-10-08T01:50:26.022Z
---

## Current Test

[testing complete]

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
result: pass
evidence: "2026-10-07 on home machine: 103549 messages / 173 bodies ingested; 3 passwords from .env.mailboxes; no match in config/ (2 files) or in a 176M plain pg_dump as sift_backup (11 COPY blocks)"

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
