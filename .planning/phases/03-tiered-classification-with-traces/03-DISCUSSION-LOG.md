# Phase 3: Tiered Classification with Traces - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-08
**Phase:** 03-tiered-classification-with-traces
**Areas discussed:** Rules & categories source, Exact-rule semantics, Pipeline timing & re-runs, LLM call & trace shape, Action span, Review outcome, Tests, Body expiry

---

## Rules & categories source

| Option | Description | Selected |
|--------|-------------|----------|
| YAML per mailbox | data/mailboxes/<slug>/rules.yaml, strict Zod, shaped like rules.lock.yaml | ✓ |
| TypeScript module per slug | Rules in packages/core; every tweak is a code change; real senders in a public repo | |
| Inside config.yaml | One file, but one-way key names and M3 moves rules out anyway | |

| Option | Description | Selected |
|--------|-------------|----------|
| Content hash, auto-row | Worker hashes the file; new hash inserts a rule_set row with snapshot | ✓ |
| Applied by setup | config apply loads rules; worker refuses to start on drift | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Categories + judgment rules | Names, one-line descriptions, plain-English judgment rules | ✓ |
| Categories only | Smaller prompt, nuance only via exact rules | |

| Option | Description | Selected |
|--------|-------------|----------|
| Example committed, real gitignored | Example + CI schema test; real files ignored | ✓ |
| Commit real rules | Leaks real addresses into a public repo | |

| Option | Description | Selected |
|--------|-------------|----------|
| Mailbox fails closed | Ingest continues, no classification, specific mailbox_status error | ✓ |
| Everything to review | Classify with no rules | |

| Option | Description | Selected |
|--------|-------------|----------|
| Strict, label-safe | Letters/digits/spaces/-/&, 1–40, no '/', unique, 2–20 categories | ✓ |
| Loose | Any non-empty string | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Rename refuses until moved | Check the new rules.yaml exists; never move files | ✓ |
| Rename moves the folder | Needs a writable data mount | |

---

## Exact-rule semantics

| Option | Description | Selected |
|--------|-------------|----------|
| From address only | Case-insensitive, domain matches subdomains, display name/Reply-To/Sender ignored | ✓ |
| From + Reply-To + Sender | More list cases, spoofable via Reply-To | |
| From, exact domain only | No subdomain match | |

| Option | Description | Selected |
|--------|-------------|----------|
| Subject + body, per rule | `in: subject/body/any`, plain substring, no regex | ✓ |
| Subject only | Can't express README's body example | |
| Regex allowed | ReDoS risk, harder nearest miss | |

| Option | Description | Selected |
|--------|-------------|----------|
| First match in file order | Owner orders priority; trace lists all matches | ✓ |
| Conflict goes to review | Can't express "unless" patterns | |
| Conflict falls through to LLM | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, AND within a rule | Fields AND, lists OR | ✓ |
| One condition per rule | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Most conditions met | Highest fraction of conditions met, per-condition pass/fail | ✓ |
| None in M1 | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Category only | Rule targets validated against categories | ✓ |
| Also 'review' | Pseudo-category | |

---

## Pipeline timing & re-runs

| Option | Description | Selected |
|--------|-------------|----------|
| Same mailbox tick, after ingest | One loop, existing no-overlap rule | ✓ |
| Separate classify loop | Decoupled, more scheduler machinery | |

| Option | Description | Selected |
|--------|-------------|----------|
| No decision for this message | Version changes never auto-reclassify | ✓ |
| No decision for current versions | Every version change reruns the backlog | |

| Option | Description | Selected |
|--------|-------------|----------|
| No decision, retry next tick | Infra failure is not a classification | ✓ |
| Mark for review | Outage dumps mail into review | |

| Option | Description | Selected |
|--------|-------------|----------|
| CLI command, scoped | `sift classify <slug> --message/--since/--all-pending`, append-only | ✓ |
| Defer re-run to M2/M4 | | |

**User clarification:** "backfills should only be 3days not 30days" — changes the P2 D-74 default.

| Option | Description | Selected |
|--------|-------------|----------|
| Fold into Phase 3 | Small task in this phase | ✓ |
| Quick task now | Separate /gsd-quick | |

| Option | Description | Selected |
|--------|-------------|----------|
| Newest first, small per-tick cap | ~25 LLM calls per tick, code constant | ✓ |
| Drain everything each tick | | |

| Option | Description | Selected |
|--------|-------------|----------|
| One request at a time, worker-wide | Process-wide semaphore | ✓ |
| Per mailbox | | |

---

## LLM call & trace shape

| Option | Description | Selected |
|--------|-------------|----------|
| From, Subject, body excerpt | ~4,000 chars, nonce fence | ✓ |
| Full cached body | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| tiers.llm.confidence_threshold only | Matches README, default 0.75 | ✓ |
| Threshold + timeout | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Typed columns + JSONB spans | Queried fields typed, spans validated by Zod | ✓ |
| Separate span table | | |

| Option | Description | Selected |
|--------|-------------|----------|
| prompt_version table by hash | Unscoped, allowlisted | ✓ |
| Mailbox-scoped prompt rows | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Self-reported in JSON | | ✓ |
| Token logprobs | | |
| You decide | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Temp 0, thinking off, fixed seed | Options recorded in span | ✓ |
| Thinking on | | |

---

## Additional areas

| Question | Options | Selected |
|----------|---------|----------|
| Action span before Phase 4 | Intended action, status pending / No action span until Phase 4 | Intended action, status pending |
| Review in the DB | Decision outcome + reason code / Also a label row | Decision outcome + reason code |
| Injection & failure tests | Fixtures + fake Ollama in CI / Also live model in CI | Fixtures + fake Ollama in CI |
| Body cache expiry | Any decision incl. review / Labelled only | Any decision incl. review |

---

## Claude's Discretion

rules.yaml key names beyond the decided semantics; data/ mounting; hash normalisation; timeouts, backoff and per-tick cap values; fence format; reason-code names; decision uniqueness mechanism; plan split.

## Deferred Ideas

Logprob confidence (M4); `tiers.llm.timeout_seconds`; live-model injection tests (M6); `review` target for exact rules (M3).
