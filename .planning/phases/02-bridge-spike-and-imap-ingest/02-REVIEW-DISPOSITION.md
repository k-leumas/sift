---
phase: 02
review: 02-REVIEW.md
titles: json
findings:
  - id: WR-01
    severity: warning
    disposition: open
    title: "A watermark already stored in the future is never lowered, so \"read as now\" makes delayed mail historical on every cycle"
  - id: WR-02
    severity: warning
    disposition: open
    title: "The compose-smoke status check passes on stale rows when the smoke volume is reused"
  - id: IN-01
    severity: info
    disposition: open
    title: "The `cert_expired` owner message speaks of the pin and `sift bridge trust` even for unpinned mailboxes"
  - id: IN-02
    severity: info
    disposition: open
    title: "The clock-cap warning is skipped on early returns"
  - id: IN-03
    severity: info
    disposition: open
    title: "If the WR-06 progress write fails, a dropped backfill's progress is never cleared"
  - id: IN-04
    severity: info
    disposition: open
    title: "The cause-chain helper is still duplicated, plus a no-op alias"
  - id: IN-05
    severity: info
    disposition: open
    title: "The CLI \"stopped between chunks\" path lost its command-level test"
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "Resync and removal break on folders with more than 65,535 live locations"
  - id: CR-02
    severity: critical
    disposition: fixed
    title: "`.env.mailboxes` receives the IMAP password but is never forced to mode 0600 (D-39)"
  - id: WR-03
    severity: warning
    disposition: fixed
    title: "The INTERNALDATE watermark has no upper bound"
  - id: WR-04
    severity: warning
    disposition: fixed
    title: "`trustPmHeader` is always true, and the first of several X-Pm-Internal-Id values is trusted"
  - id: WR-05
    severity: warning
    disposition: fixed
    title: "An expired pinned certificate is reported as a \"pin mismatch\", while `sift bridge trust` reports \"It matches\""
  - id: WR-06
    severity: warning
    disposition: fixed
    title: "First-backfill progress in `mailbox_status` is never cleared when a resync drops the backfill"
open: 7
total: 13
recorded: 2026-10-07T06:42:51.225Z
---

# Phase 02: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| CR-01 | critical | fixed | 02-REVIEW-FIX.md (not in the current review) |
| CR-02 | critical | fixed | 02-REVIEW-FIX.md (not in the current review) |
| WR-03 | warning | fixed | 02-REVIEW-FIX.md (not in the current review) |
| WR-04 | warning | fixed | 02-REVIEW-FIX.md (not in the current review) |
| WR-05 | warning | fixed | 02-REVIEW-FIX.md (not in the current review) |
| WR-06 | warning | fixed | 02-REVIEW-FIX.md (not in the current review) |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
