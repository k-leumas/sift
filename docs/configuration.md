# Configuring Sift in plain English

Each mailbox has a `rules.md` file. You can edit it on the **Rules** page of the web UI, which writes the same file, so a non-technical person never needs to SSH into anything. An optional `shared-rules.md` applies to every mailbox.

```
data/
├── shared-rules.md              # optional: applies to all mailboxes
└── mailboxes/
    ├── personal/rules.md
    └── job-search/rules.md
```

```md
# Categories

- Important: things I need to act on or reply to personally
- Job search: recruiters, interviews, applications, offers
- Receipts: orders, invoices, shipping updates
- Reading: newsletters and articles I might read later
- Noise: promotions, marketing, social notifications

# Rules

- Anything from my landlord or property manager is Important.
- Recruiter emails about frontend or AI roles are Job search. Crypto or web3 ones are Noise.
- Newsletters are Reading, unless they mention me by name. Then they're Important.
- Never mark anything from my bank as Noise.
```

## The rules file today

`rules.md` and the interpretation step below arrive in M3. Until then, each mailbox reads its rules from `data/mailboxes/<slug>/rules.yaml`, where `<slug>` is the mailbox's slug in `config/config.yaml`. Your rules files stay out of git: only the example, [`data/mailboxes/example/rules.example.yaml`](../data/mailboxes/example/rules.example.yaml), is committed. Start each mailbox from it:

```sh
mkdir -p data/mailboxes/<slug> && cp data/mailboxes/example/rules.example.yaml data/mailboxes/<slug>/rules.yaml
```

The file has three parts:

- **`categories`:** 2 to 20, each with a `name` and a one-line `description` the LLM reads. Names become Proton labels, `Labels/<Category>`, so they are kept to what a label folder can safely hold: letters (A to Z, a to z), digits, single spaces, `-` and `&`, 1 to 40 characters, and no two names that differ only in upper or lower case. A name that breaks this is rejected, never fixed for you.
- **`judgment`:** plain sentences, one per line, given to the LLM as your rules for mail no exact rule decides.
- **`rules`:** exact rules, which run in code before the LLM. Each one sets a `label` (one of your category names, spelled exactly) and a `match` with any of:
  - `from`: sender addresses. Only the From address counts, so a display name such as "Bank Support" or a Reply-To address never matches.
  - `domain`: sender domains, without `@`. A domain also matches its subdomains: `example.test` matches `mail.example.test`.
  - `phrase`, with `in: subject`, `in: body` or `in: any` (the default): literal text, not a pattern. Upper or lower case and runs of spaces don't matter.

  Every condition in one rule must hold, and a list inside a condition means any one of its entries. Rules run in file order and the first matching rule wins.

Check the file with:

```sh
docker compose run --rm --no-deps worker sift config check
```

When every mailbox's file is valid, it prints one line, with your own slugs:

```text
Config OK: 2 mailboxes (personal, job-search); password env vars present; rules files valid
```

Otherwise it prints each problem as `<file>:<line>:<column> <key>: <problem>` and exits with code 1.

- **Edits apply to new mail.** The worker reads the file again on every check, so a saved edit is used for the next mail it classifies, with no restart. It never redoes earlier decisions on its own.
- **A missing or broken file pauses classification for that mailbox only.** Its mail is still read and kept, and the other mailboxes carry on. `docker compose run --rm setup sift mailbox list` shows the mailbox as `error: rules file /data/mailboxes/<slug>/rules.yaml has <n> problems: ...`, or `error: rules file not found: /data/mailboxes/<slug>/rules.yaml...` when it is missing. Fix the file and the next check picks it up.

**Redo decisions with `sift classify`.** This is the only way to classify mail again, for example after you edit the rules or pull a new model:

```sh
docker compose run --rm --no-deps worker sift classify <slug> --all-pending
```

Choose exactly one of:

- `--all-pending`: every message that has no decision yet.
- `--since <YYYY-MM-DD>`: every message received on or after that day, decided or not.
- `--message <id>`: one message, by its id in Sift's database.

It prints `Found <n> messages to classify in <slug>.` first. Above 20 messages it asks `Classify them? Type yes to continue:`, and `--yes` skips the question. If the worker is classifying the same mailbox at that moment, it says so and waits for it, up to five minutes. Each new decision is added next to the earlier ones, which are kept, and the newest one counts. A message whose cached body has expired (7 days after its decision) is read again from Bridge first, and only if the copy on the server is still the same message; otherwise that message is skipped with one line naming its id. It ends with `Classified <n> messages of <slug>: <x> labelled, <y> review.` If Ollama stops answering, it prints the problem and `classified <x> of <n>; <y> left`, exits with code 1, and you can run it again. If Ollama fails on one message only, that message is skipped with one line naming its id, such as `message <id>: Ollama failed on this message (HTTP 500); skipped`, the others are classified, and the last line counts it as skipped.

## What happens when you save

Sift **interprets** each rule and shows you what it understood before anything changes:

| You wrote | Sift understood | Runs as |
|---|---|---|
| *Anything from my landlord…* | Sender is `jane@acmeproperty.com` (found in your recent mail, so please confirm) | **Exact**, exact rules |
| *Recruiter emails about frontend or AI roles…* | Category definition for the LLM, learned by the classifier from your labels | **Judgment**, classifier and LLM |
| *…unless they mention me by name* | Body contains "Samuel" | **Exact**, exact rules |

You confirm or fix each interpretation. Sift saves the confirmed version to that mailbox's `rules.lock.yaml`, a generated file you review in the UI and never edit by hand:

```yaml
# Generated from rules.md. Review in the UI; do not hand-edit.
rules:
  - source: "Anything from my landlord or property manager is Important."
    kind: exact
    match:
      from: ["jane@acmeproperty.com"]
    label: Important
    confirmed: true
```

## Preview before it applies

Before a change goes live, Sift replays it against the mailbox's recent mail:

> This change would move **14 of your last 200 emails**. 3 would move to Important, 11 to Noise.
> **2 labels you confirmed earlier now conflict** with the new rules. [Keep them] [Relabel them]
> [Review all] [Apply] [Cancel]

The classifier learns judgment rules from your confirmed labels, so a rule change can contradict what it learned before. The preview shows those conflicts, and the classifier retrains as soon as you resolve them.

## Technical settings

Connection details and tuning live in `config/config.yaml`, which a non-technical person never needs to touch. Passwords are never stored in it; each mailbox points to an environment variable whose value lives in `.env.mailboxes`.

```yaml
version: 1

mailboxes:
  - slug: personal
    imap:
      host: bridge              # the Bridge service in the Compose stack
      port: 1143
      username: me@proton.me    # the Proton account's address
      password_env: SIFT_PERSONAL_IMAP_PASSWORD
      folder: INBOX
      tls:
        mode: starttls          # Bridge's STARTTLS; Sift never connects without TLS
        # pin_sha256: <the fingerprint printed by docker compose run --rm bridge-init>
    ingest:
      initial_backfill_days: 3  # the first sync reads this many days back, in the background; 0 = new mail only
      new_mail_cap: 200         # more new messages in one check holds the mailbox until `sift mailbox resume`
    labels:
      apply_as: proton_labels   # copies to Labels/<Category>; the only value accepted so far
  - slug: job-search
    imap:
      host: bridge
      port: 1143
      username: jobs@proton.me  # a second Proton account
      password_env: SIFT_JOBS_IMAP_PASSWORD
      folder: INBOX
      tls:
        mode: starttls
        # pin_sha256: <the same fingerprint: one Bridge, one certificate>
    labels:
      apply_as: proton_labels   # no ingest block: the defaults above apply

models:
  provider: ollama              # or any OpenAI-compatible endpoint (later)
  url: http://host.docker.internal:11434
  embeddings: nomic-embed-text
  llm: qwen3:1.7b               # any small instruct model; let `pnpm eval --models` choose

worker:
  poll_interval_seconds: 60     # how often each mailbox is checked (10 to 3600)

tiers:
# A later milestone adds the classifier tier (not accepted by sift config check yet):
#   classifier:
#     confidence_threshold: 0.85
#     min_examples_per_category: 15
#     spot_check_rate: 0.05
  llm:
    confidence_threshold: 0.75  # an LLM answer below this goes to review instead of a label (0 to 1)
#     examples_per_prompt: 6    # later milestone

# Later milestones (not accepted by sift config check yet):
# quick_confirm:
#   batch_size: 20
#   max_per_day: 1
#
# relabel_sync:
#   enabled: true                 # label folders are compared on every worker poll
```

[`config/config.example.yaml`](../config/config.example.yaml) is the authoritative list of the keys the current version accepts. Unknown keys are rejected, with the path of each one in the error. `tiers.llm.confidence_threshold` is read today. The commented keys (`tiers.classifier`, `tiers.llm.examples_per_prompt`, `quick_confirm`, `relabel_sync`) arrive with later milestones; until then, leave them out of your `config/config.yaml`. Every mailbox needs `imap.tls.pin_sha256`: paste it from the Bridge login ([Quick start](../README.md#quick-start), step 9). After editing the file, apply it with:

```sh
docker compose run --rm setup
```
