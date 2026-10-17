# Phase 4: Labels and Real-Inbox Run - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-17
**Phase:** 04-labels-and-real-inbox-run
**Areas discussed:** Turning labels on, Folders and re-runs, Finding a trace, Real-inbox acceptance

---

## Turning labels on

| Question | Options | Selected |
|---|---|---|
| How label writing is switched on | Dry-run first / Live from the start / Live with a pause flag | Dry-run first, plus a pause/enabled flag; the action record is always written |
| Decisions made before Phase 4 | Apply them too / Only after switch-on / Only within a window | Apply them too |
| New decisions while paused | Keep deciding, hold actions / Pause classification too / Record as skipped | Keep deciding, hold actions |
| Where the mode lives | Worker senses a config edit / Edit then config apply / CLI command only | CLI command only |
| Dry-run decisions on switch to apply | Apply after confirming / Only new decisions / Ask each time | Apply after confirming |
| Starting state | dry_run / paused / apply | dry_run |
| Going back from apply | Leave labels / Offer an undo | Leave labels |
| Catch-up pacing | Bounded per tick / All at once / You decide | Bounded per tick |
| Mode visible per decision | Yes, in the action record / Only applied actions | Yes, in the action record |

**Notes:** The owner asked how switching between paused and unpaused would look, and hoped the system would restart itself or notice the config edit. Claude explained that today `config.yaml` is read only at startup, the registry is reread every tick and `rules.yaml` every pass, and offered three options. The owner chose CLI-only, DB-backed state picked up on the next tick.

---

## Folders and re-runs

| Question | Options | Selected |
|---|---|---|
| Missing label folder | Create on first use / Create all at switch-on / Refuse until owner makes it | Create on first use |
| Existing label with the same name | Reuse case-insensitively / Exact match only / Never share | The owner wanted a config option. First called "ignoreCase", then the name was changed to `case_sensitive` (the other candidates were `ignore_case` and `strict_casing`), default false |
| Case conflict when case_sensitive is true | Hold and report / Fall back to reuse | Hold and report |
| Exact-name label the owner made | Reuse; only Sift's copies count / Sift-created folders only | Reuse |
| Re-run changes the category | Move Sift's label / Add only / Ask in the re-run | Move Sift's label |
| Re-run sends a labelled message to review | Remove the old label / Keep it | Remove it |
| Message already in the label | Skip and record "already present" / Copy anyway | Skip and record |
| COPY failure | Retry, then report / Retry forever / You decide | Retry, then report |
| Message gone before labelling | Skip and record why / Label wherever it is | Skip and record |
| Manual retry command | Yes, `sift labels retry` / No | Yes |

---

## Finding a trace

| Question | Options | Selected |
|---|---|---|
| How to point at a message | Search then pick / By header value / Both | Both |
| Output format | README tree with `--json` / JSON only | README tree with `--json` |
| Decision listing | `sift decisions` command / Documented SQL | Documented SQL |
| Re-run history | Latest plus a history line / Always all | Latest plus a history line |
| Print LLM reason and raw output | Yes / Hide by default | Yes |
| SQL documentation | README recipe / SQL view | README recipe |
| Rule detail | Rule summary inline / Ids only | Rule summary inline |
| Stale-rules hint | Yes, one line / No | Yes |
| Search matching | Case-insensitive substring / You decide | You decide |

---

## Real-inbox acceptance

| Question | Options | Selected |
|---|---|---|
| Run shape | Dry-run day then apply day / Short supervised session / Apply only | Short supervised session |
| Sample size | ~20 stratified / ~10 random / Every decision | ~20 stratified |
| SEC-02 proof | Lockdown plus check / Observe during the run / Both | Both |
| ACT-05 guarantee | Allowlist in code plus test / Review plus live check | Allowlist in code plus test |
| Defer `sift diagnose` | Yes / No | Yes |
| Where evidence goes | 04-LIVE-RUN.md, aggregates only / UAT only | 04-LIVE-RUN.md |
| Pass bar | Any unexplained decision is a gap / Majority explained | Any unexplained decision is a gap |

**Notes:** Before answering the SEC-02 and ACT-05 questions, the owner asked "how will we ever track problems with this approach?" Claude explained that problems are tracked locally (logs, mailbox list, traces, action records, label_event, healthcheck), that blocked calls fail loudly with logged errors, and that nothing is reported remotely. The owner then chose Both and the allowlist.

---

## Claude's Discretion

- `sift trace` search matching rules.
- CLI verbs, table shapes, per-tick cap, retry count, how "already present" is detected, how the lockdown is built and which capture tool is used.

## Deferred Ideas

- `sift diagnose` (redacted support bundle)
- `sift labels undo`
- `sift decisions` listing
