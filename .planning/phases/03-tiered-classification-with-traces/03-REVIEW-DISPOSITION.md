---
phase: 03
review: 03-REVIEW.md
titles: json
findings:
  - id: CR-01
    severity: critical
    disposition: fixed
    title: "One message that always fails puts its mailbox in permanent backoff and blocks all older LLM-bound mail (open owner decision, severity assessment)"
  - id: CR-02
    severity: critical
    disposition: fixed
    title: "Bodies refetched by `sift classify` never expire when the re-run does not decide them"
  - id: CR-03
    severity: critical
    disposition: fixed
    title: "When the classification pass throws after a synced ingest, the volume valve's approval and last_sync_at are never cleared, so the cap stays raised by the old approval"
  - id: WR-01
    severity: warning
    disposition: fixed
    title: "A model reason that contains `\\u0000` cannot be stored, so that message fails on every pass and five in a row make the batch throw"
  - id: WR-02
    severity: warning
    disposition: fixed
    title: "`sift config check` accepts a rules file with NUL or other control characters, but the worker then fails on every pass"
  - id: WR-03
    severity: warning
    disposition: fixed
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
  - id: WR-04
    severity: warning
    disposition: open
    title: "A model reason that contains a lone UTF-16 surrogate cannot be stored, so that message fails on every pass (WR-01 residual)"
  - id: WR-05
    severity: warning
    disposition: open
    title: "A rules file with a lone surrogate passes `sift config check`, then every decision of that mailbox fails (WR-02 residual)"
  - id: WR-06
    severity: warning
    disposition: open
    title: "A third message Ollama fails on alone in one pass is declared an outage with no re-probe: error status, backoff and delayed IMAP polling (CR-01 residual)"
  - id: WR-07
    severity: warning
    disposition: open
    title: "`llm_error` can be written after a few minutes of transient Ollama contention, and that decision is permanent for the worker"
  - id: IN-08
    severity: info
    disposition: open
    title: "After a failed re-probe, the outage reports the chat's code, not the probe's fresher diagnosis"
  - id: IN-09
    severity: info
    disposition: open
    title: "The CR-02 expiry uses the wall clock while decisions and the sweep use the injected clock"
  - id: IN-10
    severity: info
    disposition: open
    title: "`done.ollamaFailed` is unused, and `messageFailures` entries are never removed for messages that stop being candidates"
  - id: IN-11
    severity: info
    disposition: open
    title: "A busy or aborted pass clears the unclassified notice although nothing was rechecked"
  - id: IN-12
    severity: info
    disposition: open
    title: "README security bullet has a garbled tense"
open: 16
total: 22
recorded: 2026-10-12T21:30:00.000Z
---

# Phase 03: Code Review Disposition

| Finding | Severity | Disposition | Source |
|---------|----------|-------------|--------|
| CR-01 | critical | fixed | 03-17..03-20, 03-22 (review 05faf3b) |
| CR-02 | critical | fixed | 03-14 (review 05faf3b) |
| CR-03 | critical | fixed | 03-15 (review 05faf3b) |
| WR-01 | warning | fixed | 03-16 (review 05faf3b) |
| WR-02 | warning | fixed | 03-21 (review 05faf3b) |
| WR-03 | warning | fixed | 03-18 (review 05faf3b) |
| IN-01 | info | open | - |
| IN-02 | info | open | - |
| IN-03 | info | open | - |
| IN-04 | info | open | - |
| IN-05 | info | open | - |
| IN-06 | info | open | - |
| IN-07 | info | open | - |
| WR-04 | warning | open | - |
| WR-05 | warning | open | - |
| WR-06 | warning | open | - |
| WR-07 | warning | open | - |
| IN-08 | info | open | - |
| IN-09 | info | open | - |
| IN-10 | info | open | - |
| IN-11 | info | open | - |
| IN-12 | info | open | - |

Dispositions: `open` (recorded, not yet triaged), `fixed`, `skipped`, `deferred`.
Set `deferred` by hand and put the reason in the Source cell; both are preserved. A `|` in the reason is kept as prose and escaped on the next run.
Re-running the gate keeps every row it can. A row the current review no longer reports is kept and its Source cell flagged, so a finding does not leave this record silently. ONE exception: when a finding id is REUSED by a different finding, the earlier decision cannot keep a row — the id is taken — and it is dropped. A RECORDED decision (anything but `open`) is named on the console when that happens; a row still at `open` is replaced silently, because `open` records no decision to lose.
