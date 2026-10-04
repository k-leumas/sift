---
phase: 01
review: 01-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "compose-smoke cannot pass on GitHub's Linux runners: config.yaml is created mode 0600 and ./backups is not writable by the container user"
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "compose-smoke's COMPOSE_PROJECT_NAME does not isolate the database; the `--down` guard only checks env vars"
  - id: WR-02
    severity: warning
    disposition: fixed
    title: "The worker's role guard accepts sift_owner (schema owner with CREATEROLE)"
  - id: WR-03
    severity: warning
    disposition: fixed
    title: "Shutdown hangs, and never exits 0, when a batch outlives SHUTDOWN_TIMEOUT_MS"
  - id: WR-04
    severity: warning
    disposition: fixed
    title: "migrate() counts pending migrations while drizzle compares timestamps, so a skipped migration is reported as \"No pending migrations\""
  - id: WR-05
    severity: warning
    disposition: fixed
    title: "The rename hint pairs removed and added slugs arbitrarily and can steer the owner into attaching one mailbox's history to another account"
  - id: WR-06
    severity: warning
    disposition: fixed
    title: "The catalog gate (D-37) does not see column-level SELECT/INSERT grants to sift_app"
  - id: WR-07
    severity: warning
    disposition: fixed
    title: "Neither the catalog gate nor the runtime guard checks sift_app's membership in sift_backup or other RLS-bypassing roles"
  - id: WR-08
    severity: warning
    disposition: fixed
    title: "poll_interval_seconds values that are not multiples of the 15 s tick are rounded up (10 s runs every 15 s, 20 s every 30 s)"
  - id: IN-01
    severity: info
    disposition: open
    title: "The D-64 duplicate-account check uses raw values, but the stored values are trimmed"
  - id: IN-02
    severity: info
    disposition: open
    title: "The ISO-04 lint guard does not cover relative imports into packages/db internals"
  - id: IN-03
    severity: info
    disposition: open
    title: "Role passwords are sent as plaintext literals in DDL"
  - id: IN-04
    severity: info
    disposition: open
    title: "Unexpected worker errors bypass pino and redaction"
  - id: IN-05
    severity: info
    disposition: open
    title: "An unhealthy worker is never restarted, so the heartbeat healthcheck does not recover a stuck supervisor"
  - id: IN-06
    severity: info
    disposition: open
    title: "A mailbox disabled while the worker is down keeps a stale mailbox_status.state"
  - id: IN-07
    severity: info
    disposition: open
    title: "GitHub Actions are pinned by major tag, not commit SHA"
open: 7
total: 16
recorded: 2026-10-04T09:23:12.889Z
---

# Phase 01: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | fixed | 01-REVIEW-FIX.md |
| WR-01 | warning | fixed | 01-REVIEW-FIX.md |
| WR-02 | warning | fixed | 01-REVIEW-FIX.md |
| WR-03 | warning | fixed | 01-REVIEW-FIX.md |
| WR-04 | warning | fixed | 01-REVIEW-FIX.md |
| WR-05 | warning | fixed | 01-REVIEW-FIX.md |
| WR-06 | warning | fixed | 01-REVIEW-FIX.md |
| WR-07 | warning | fixed | 01-REVIEW-FIX.md |
| WR-08 | warning | fixed | 01-REVIEW-FIX.md |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| IN-06 | info | open | - |
| IN-07 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
