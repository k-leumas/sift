# Architecture

This page covers the system design of Sift: how mail data is scoped and isolated, how the repository is laid out, the stack, and the decision records behind it.

## Data model

Sift has **one owner and many mailboxes**. There's no users table. The mailbox is the isolation boundary, and every piece of mail-derived data belongs to exactly one mailbox. See [ADR 0001](adr/0001-multiple-mailboxes-single-owner.md).

| Table | Holds | Scoped by |
|---|---|---|
| `mailbox` | Slug, IMAP settings (not secrets), label strategy, sync cursor | n/a |
| `message` | `Message-ID`, headers, extracted text, embedding | `mailbox_id` |
| `label` | The current category for a message, whether it was **confirmed** by you or **applied** by Sift, and where a confirmation came from (review queue, quick confirm, mail app) | `mailbox_id` |
| `decision` | One row per classification, never changed afterwards: the outcome (labelled or review), category and confidence, the deciding tier, the review reason, the rule-set, prompt and model versions (classifier versions from M2), and the full trace, one span per tier. A re-run with `sift classify` adds a row; the newest counts | `mailbox_id` |
| `folder_sync` | Per label folder: the last list of UIDs seen, the folder's UIDVALIDITY, and a change-tracking marker where supported | `mailbox_id` |
| `label_event` | Each label change Sift detects in your mail app (removed, added, deleted), and how it was resolved | `mailbox_id` |
| `rule_set` | Versioned snapshots of a mailbox's `rules.yaml`, one per distinct content, never changed afterwards (from M3: the `rules.md` source and compiled `rules.lock.yaml`) | `mailbox_id` |
| `classifier` | Versioned classifier weights, training-set size, metrics | `mailbox_id` |
| `prompt_version` | LLM prompt templates and model options, one row per version. Not mail-derived and not per mailbox | global |
| `eval_run` | Eval results per model, prompt and rule version | `mailbox_id` or synthetic |
| `flag` | Suspected injection attempts and other audit events | `mailbox_id` |

**Isolation is enforced by the database, not by remembering to add a `WHERE` clause.** Every mailbox-scoped table has a Postgres row-level security policy keyed on a per-request `app.mailbox_id` setting. Vector search, classifier training and LLM retrieval therefore can't see another mailbox's mail. A dedicated test seeds two mailboxes with look-alike emails and fails if either one's examples ever appear in the other's prompts or training set.

The UI shows one review queue across all mailboxes and filters through the URL (`/review?mailbox=job-search`). Reading across mailboxes is fine; *learning* across them is not.

## Project structure

```
sift/
├── apps/
│   ├── web/            # React Router v7: review queue, rules editor, evals, audit log
│   └── worker/         # per-mailbox IMAP ingest, tier pipeline, label actions
├── packages/
│   ├── core/           # rule interpreter, prompt builder, output schemas (zod)
│   ├── classifier/     # classifier: embeddings, kNN + logistic regression, training
│   ├── db/             # Drizzle schema, migrations, row-level security policies
│   └── evals/          # eval runner, metrics, model and version comparison
├── fixtures/
│   └── synthetic-inbox/
├── evals/
│   ├── injection/      # adversarial test emails
│   └── isolation/      # cross-mailbox leakage tests
├── docs/
│   └── adr/            # architecture decision records
├── data/               # rules files per mailbox (gitignored except examples)
├── config/
│   └── config.example.yaml   # copy to config/config.yaml (gitignored)
├── db/
│   └── bootstrap.sql   # roles and extensions, run once when the database is created
├── backups/            # pg_dump files written before migrations (gitignored)
├── compose.yaml
├── .env.example        # database passwords (copy to .env)
└── .env.mailboxes.example   # mailbox IMAP passwords (copy to .env.mailboxes)
```

**Stack:** TypeScript end to end (including the classifier, so no Python) · React Router v7 · Hono · Postgres + pgvector · Drizzle · Ollama · Docker Compose. Major decisions are recorded as ADRs in `docs/adr/`.

## Architecture decision records

- [ADR 0001: Multiple mailboxes, single owner](adr/0001-multiple-mailboxes-single-owner.md)
- [ADR 0002: Tiered classification](adr/0002-tiered-classification.md)
- [ADR 0003: Traces and mail app relabels](adr/0003-traces-and-mail-app-relabels.md)
