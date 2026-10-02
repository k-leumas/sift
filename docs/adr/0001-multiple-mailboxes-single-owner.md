# ADR 0001: Multiple mailboxes, single owner

- **Status:** Accepted
- **Date:** 2026-09-30

## Context

Sift is a self-hosted email triage tool running on one always-on machine at home. Its first user wants to triage more than one mailbox (for example, a personal inbox and a job-search inbox), each with different categories and rules.

The next obvious request after that is from other people in the same household wanting to use the same box. Further out is a hosted, multi-tenant service.

Two parts of the design make the data boundary especially important:

- **The classifier** trains on confirmed labels.
- **The LLM** puts retrieved past emails into its prompts as examples.

If either one can see mail from the wrong scope, that content leaks into another scope's classifications and into the explanations shown in the UI. This is the same class of bug as cross-tenant leakage in a RAG system, and it's silent: nothing errors, the output is just quietly informed by data it shouldn't have.

## Decision

1. **The mailbox is the unit of isolation.** Every table holding mail-derived data (messages, embeddings, labels, decisions, classifiers, rule sets, eval runs, flags) has a non-null `mailbox_id`.
2. **There is exactly one owner and no users table.** Access to the web UI is gated at the network level (Tailscale or LAN), not by in-app accounts.
3. **Isolation is enforced by Postgres row-level security,** keyed on a per-request `app.mailbox_id` setting. Application code doesn't have to remember to filter. Anything that needs to read across mailboxes (the unified review queue) uses a separate role whose policy allows reading but is never used by training or retrieval.
4. **Learning never crosses mailboxes.** The classifier trains on, and the LLM retrieves from, a single mailbox's confirmed labels only.
5. **Rules are per mailbox,** in `data/mailboxes/<slug>/rules.md`, with an optional `data/shared-rules.md` merged in for every mailbox. Categories are defined per mailbox.
6. **Isolation is tested.** `evals/isolation/` seeds two mailboxes with look-alike emails and fails if either one's messages appear in the other's classifier training set, LLM prompts or explanations.
7. **Credentials are per mailbox** and supplied through environment variables (`password_env` in `config.yaml`), never stored in config files or the database in plaintext.

## Consequences

**Positive**

- The owner gets separate categories, rules and classifiers per mailbox, which is a real need, not a hypothetical one.
- Mail-derived data is scoped from day one. Adding household users later means adding an `owner` table, logins and an owner → mailbox mapping on top of an existing boundary, not adding a scope to every table and query.
- Leakage bugs fail closed: a query missing a filter returns nothing instead of returning everything.
- The isolation tests double as a demonstration of tenant-safe retrieval.

**Negative**

- Row-level security adds setup to every request (setting `app.mailbox_id`) and makes ad-hoc queries in a SQL console slightly more awkward.
- A new mailbox starts cold: its classifier has nothing to learn from, even if a similar mailbox already has hundreds of confirmed labels.
- Running one IMAP loop per mailbox means the worker has to schedule fairly across them, especially for LLM time on a single CPU.

## Alternatives considered

**Single mailbox only.** The simplest option, but it doesn't meet the first user's actual need, and it would mean adding a scope column to every table later, which is the expensive migration this ADR avoids.

**Multiple users now (household support).** It adds authentication, session handling and per-user settings to a pre-alpha project without a user asking for it. Deferred; this ADR keeps the door open.

**Hosted multi-tenant service.** Rejected. It means holding other people's decrypted email, running Proton Bridge on a server for other people's accounts (against Proton's model), and paying for inference. It also contradicts the project's core promise that your email never leaves your network.

**Shared learning across mailboxes (opt-in).** Let a new mailbox borrow confirmed labels from another to warm up its classifier. Not rejected outright, but deferred. If added, it must be an explicit per-mailbox setting, off by default, and covered by the isolation tests.

**Isolation by application-level filtering only.** Every query includes `WHERE mailbox_id = ?`. Rejected as the *only* mechanism, because one forgotten filter in a vector search is exactly the silent leak this ADR exists to prevent. Application-level filtering is still used; row-level security is the backstop.
