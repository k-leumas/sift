---
phase: 03
review: 03-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: open
    title: "One message that always fails puts its mailbox in permanent backoff and blocks all older LLM-bound mail (open owner decision, severity assessment)"
  - id: CR-02
    severity: critical
    disposition: open
    title: "Bodies refetched by `sift classify` never expire when the re-run does not decide them"
  - id: CR-03
    severity: critical
    disposition: open
    title: "When the classification pass throws after a synced ingest, the volume valve's approval and last_sync_at are never cleared, so the cap stays raised by the old approval"
  - id: WR-01
    severity: warning
    disposition: open
    title: "A model reason that contains `\\u0000` cannot be stored, so that message fails on every pass and five in a row make the batch throw"
  - id: WR-02
    severity: warning
    disposition: open
    title: "`sift config check` accepts a rules file with NUL or other control characters, but the worker then fails on every pass"
  - id: WR-03
    severity: warning
    disposition: open
    title: "Messages that fail on every pass are hidden: status shows `ok` and they stay pending with no owner-visible sign"
  - id: IN-01
    severity: info
    disposition: open
    title: "`body.original_chars` and the prompt's \"first N of M characters\" count the cleaned body, not the original"
  - id: IN-02
    severity: info
    disposition: open
    title: "A path prefix in `models.url` is silently discarded"
  - id: IN-03
    severity: info
    disposition: open
    title: "The preflight does not enforce a minimum Ollama version, although T-03-23 depends on the server honouring `truncate:false` and `shift:false`"
  - id: IN-04
    severity: info
    disposition: open
    title: "`--since` and \"after today\" use UTC days, not the owner's"
  - id: IN-05
    severity: info
    disposition: open
    title: "Mail content is sent over plain `http://` to any `models.url` host"
  - id: IN-06
    severity: info
    disposition: open
    title: "After the lock connection is lost, `classifyCandidates` keeps sending mail to Ollama"
  - id: IN-07
    severity: info
    disposition: open
    title: "`loadRules` reads the whole file before checking the 256 KiB cap and blocks on a FIFO"
open: 13
total: 13
recorded: 2026-10-10T23:57:22.544Z
---

# Phase 03: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | open | - |
| CR-02 | critical | open | - |
| CR-03 | critical | open | - |
| WR-01 | warning | open | - |
| WR-02 | warning | open | - |
| WR-03 | warning | open | - |
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
