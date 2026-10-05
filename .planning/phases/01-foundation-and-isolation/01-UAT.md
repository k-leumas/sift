---
status: testing
phase: 01-foundation-and-isolation
source: [01-VERIFICATION.md]
started: 2026-10-04T20:30:00Z
updated: 2026-10-04T20:30:00Z
---

## Current Test

number: 1
name: Target-machine bring-up (SC1)
expected: |
  On the Mac mini or Linux mini PC, follow README quick start steps 1-5 (on Linux with `id -u` != 1000, run `sudo chown 1000 backups` first), then `docker compose up -d`.
  db is healthy; setup exits 0 after writing a dump to ./backups and recording 5 migrations; worker is healthy.
awaiting: user response

## Tests

### 1. Target-machine bring-up (SC1)
expected: db healthy; setup exits 0 after writing a dump to ./backups and recording 5 migrations; worker healthy.
result: [pending]

### 2. Real-password grep (SC2 manual half)
expected: After a real bring-up, grepping config/ and a pg_dump of `sift` for each real Bridge password finds no match.
result: [pending]

### 3. CI on GitHub
expected: After a push, the Actions run shows `check` green and `compose-smoke` green, ending in "compose smoke OK".
result: [pending]

### 4. Backstop: id-based comparisons in isolation tests
expected: The assertions in isolation.test.ts and owner-rls.test.ts use only id-set comparisons (sortedIds, arrayContaining, every) and never index query results by position.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
