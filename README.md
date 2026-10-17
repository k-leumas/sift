# Sift

**Self-hosted email triage that learns from you. Rules in plain English, a tiny classifier trained on your corrections, and a small local LLM only when it's needed.**

Sift runs on a small machine at home, such as a mini PC or Mac mini. It reads your mailboxes over IMAP, sorts each message into categories you define, and applies those categories as labels in your mail client. Most mail is handled by a tiny classifier trained on *your* corrections. A small local LLM steps in only when that classifier isn't sure. When neither is sure, Sift asks you instead of guessing.

One owner, as many mailboxes as you like: a personal inbox, a job-search inbox, a side-project address, each with its own rules and its own trained classifier.

Your email never leaves your network. No cloud model, no telemetry, no accounts.

**Proton Mail only, for now.** Sift supports only Proton Mail, through Proton Bridge, for now. Supporting one mail service keeps the logic simpler and the test surface small, and it is the more security-minded choice: Sift talks to one known server, Bridge running on your own machine, and pins its certificate.

> **Status: pre-alpha, in design.** This README and the docs it links describe the target. See [Roadmap](#roadmap) for what exists today.

**Get started:** the [Quick start](#quick-start) takes you from cloning the repository to a running Sift in 12 numbered steps. Today Sift reads your mail and classifies each new message on your machine; it does not put labels in Proton yet.

**Read more:** [Where to read next](#where-to-read-next) lists the detailed docs by subject.

---

## Why

Most "AI email" tools ask you to send your whole inbox to someone else's model and trust a black box. Sift takes the other approach:

- **Tiny and local.** Most mail is sorted by an embedding model and a classifier small enough to retrain in milliseconds. The LLM is a 1B-class model on a CPU, and it only sees the mail the classifier can't handle.
- **Actually trained on you.** Every label you confirm or correct retrains your mailbox's classifier. No fine-tuning, no GPU. The model gets better at *your* inbox specifically.
- **Configured in plain English.** You write *"Recruiter emails about frontend roles are important; crypto ones aren't."* No YAML, no regex, no prompt engineering.
- **Learns where you already work.** Move an email to a different label in your normal mail app and Sift notices and learns from it. You don't have to open Sift to teach it.
- **Shows its work.** Every decision keeps a full trace, like a stack trace for a label: each tier that ran, what it saw, how confident it was, and why it passed the email on or decided.
- **Treats email as hostile input.** Email content can't change rules or trigger actions, and the injection defenses have their own test suite.

---

## Running it at home

Sift is designed for an always-on machine on your home network.

### Requirements

- Docker and Docker Compose
- 8 GB of RAM is enough for the default models
- A paid Proton Mail plan, which **Proton Bridge** requires. Sift supports only Proton Mail, through Proton Bridge, for now (the reasons are at the [top](#sift)). Sift runs Bridge in its own container, built from source at a pinned release.
- Combined address mode: one Sift mailbox per Proton account, with all of that account's addresses arriving in one inbox (Bridge's default). One Bridge serves several Proton accounts. Split mode, one Sift mailbox per address, is a later milestone.
- A disk with full-disk encryption: FileVault on macOS, LUKS on Linux (see [Security model](docs/security.md))
- A host clock kept in sync over NTP. Proton's servers set each email's arrival time (its IMAP INTERNALDATE), while the worker and Bridge both run on this machine and share its clock. Sift caps arrival times at the worker's clock, and on each check it re-reads only mail dated up to 5 minutes before the newest arrival time it has recorded, so a host clock that drifts more than a few minutes from Proton's time can make Sift treat new mail as old. macOS and most Linux systems sync over NTP by default. To check on macOS, open System Settings > General > Date & Time and make sure "Set time and date automatically" is on, or run `sntp time.apple.com`, which prints the offset and changes nothing. On Linux, run `timedatectl` and look for `System clock synchronized: yes`.
- [Ollama](https://ollama.com)

### Quick start

What works today: the database, the one-shot `setup` service (migrations with a backup first, then your mailboxes registered from `config/config.yaml`), Proton Bridge in its own container, and the worker, which runs one loop per enabled mailbox and reads its mail over IMAP: new mail on every check, and the last 3 days slowly in the background. The worker also classifies each new message, by your exact rules first and then by the local LLM, and stores the decision with its [trace](docs/how-it-works.md#decision-traces) in the database. Labels in Proton arrive next, with the rest of M1: nothing is written into your mailbox yet.

1. **Clone the repository.**

   ```sh
   git clone https://github.com/<you>/sift && cd sift
   ```

2. **Create your config file and add your mailboxes.**

   ```sh
   cp config/config.example.yaml config/config.yaml
   ```

   Then edit `config/config.yaml` for your mailboxes. Each Sift mailbox is one Proton account (see [Requirements](#requirements)): set `username` to the account's address, and keep `host: bridge` and `port: 1143`, which point at the Bridge container in the Compose stack.

3. **Create the database settings file.**

   ```sh
   cp .env.example .env
   ```

   Then fill in every password in `.env`. Generate each one with `openssl rand -hex 24`.

4. **Create the mailbox password file.**

   ```sh
   cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes
   ```

   This makes the file readable by you only. It gets one line per `password_env` in `config/config.yaml`. You don't type Bridge's IMAP passwords in yourself: the Bridge login in step 8 writes each one into this file (and sets it to mode 600 again if it is wider). Database passwords stay in `.env`; mailbox passwords never go there.

5. **Set the Bridge keychain passphrase.**

   Set `SIFT_BRIDGE_KEYCHAIN_PASSPHRASE` in `.env`, also generated with `openssl rand -hex 24`. It unlocks the key that encrypts Bridge's session vault, and only the Bridge containers receive it. Keep a copy somewhere safe, such as a password manager: without it the vault cannot be opened, and you would have to remove the `sift-bridge` volume and log in again.

6. **Create Bridge's volume, once.**

   ```sh
   docker volume create sift-bridge
   ```

   The volume holds Bridge's login session (see [Security model](docs/security.md)), and Compose refuses every command, for every service, while it is missing.

7. **Create the backup file for the mailbox passwords, once.**

   ```sh
   touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak
   ```

   The Bridge login saves the previous `.env.mailboxes` into this file before changing it. It holds the same passwords, hence mode 600. Compose refuses to start `bridge-init` while this file is missing, so keep it (empty it rather than delete it).

8. **Log in to Proton through Bridge.**

   ```sh
   docker compose run --rm bridge-init
   ```

   Run it in a terminal: the command is interactive. The first run builds the Bridge image from source, which takes several minutes.

   Bridge's own command line opens. Type `login`, then your Proton address, password and 2FA code. Bridge's command line does not echo them, and Sift never sees your Proton password. When Bridge says the account was added, type `exit` (not `info`, which would show the IMAP password). Sift then switches off Bridge's telemetry and automatic updates (Sift pins a tested Bridge release instead), waits up to two minutes for Bridge to load the account, and writes the IMAP password into `.env.mailboxes` itself. You should see lines like these, with your own fingerprint and counts:

   ```text
   Bridge certificate SHA-256 (public key): <fingerprint>
   Add it to config/config.yaml under the mailbox's imap.tls:   pin_sha256: <fingerprint>
   telemetry: off
   automatic updates: off
   accounts: 1
   account 1: addresses: 3, address mode: combined, state: connected
   backup of the previous file: .env.mailboxes.bak (next to .env.mailboxes)
   wrote SIFT_PERSONAL_IMAP_PASSWORD to .env.mailboxes (mailbox "personal")
   ```

   If init is interrupted while it writes `.env.mailboxes`, restore the previous file with `cp .env.mailboxes.bak .env.mailboxes` before you run it again.

9. **Pin Bridge's certificate.**

   Copy the `pin_sha256:` value from the step 8 output into `config/config.yaml`, under the mailbox's `imap.tls` (it replaces the commented `# pin_sha256:` line). The worker then accepts exactly that key and refuses any other (see [Security model](docs/security.md)):

   ```yaml
       tls:
         mode: starttls
         pin_sha256: <fingerprint>
   ```

10. **Create a rules file for each mailbox.**

    ```sh
    mkdir -p data/mailboxes/<slug> && cp data/mailboxes/example/rules.example.yaml data/mailboxes/<slug>/rules.yaml
    ```

    This copies the example rules file. Run it once per slug in `config/config.yaml` (for example `personal`), then edit its categories, judgment lines and exact rules (see [The rules file today](docs/configuration.md#the-rules-file-today)).

    The containers mount `data/` read-only and never create files in it. On Linux, creating the folders yourself before you start the stack (step 12) also keeps Docker from creating `data/` owned by root.

11. **Install Ollama and pull the model.**

    Install Ollama on this machine (see [Mac mini vs mini PC](docs/operations.md#mac-mini-vs-mini-pc)), then pull the model named in `models.llm`:

    ```sh
    ollama pull qwen3:1.7b
    ```

    The last line of the output should be `success`.

12. **Start Sift and check your setup.**

    On Linux, do this first: the `setup` and `worker` containers run as uid 1000, and Linux enforces file ownership on the folders they mount. `setup` writes a backup to `backups/` before it migrates, so if `id -u` does not print `1000`, hand that folder to the container user. Also leave `config/config.yaml` and your rules files readable by others (the mode `cp` gives them is fine):

    ```sh
    sudo chown 1000 backups
    ```

    Then, on any system:

    ```sh
    docker compose up -d
    ```

    Compose starts `db` and `bridge`, runs `setup` once, and starts `worker` when setup has finished. Check your config, passwords and rules files:

    ```sh
    docker compose run --rm --no-deps worker sift config check
    ```

    It should print one line, with your own slugs: `Config OK: 2 mailboxes (personal, job-search); password env vars present; rules files valid`.

For the first minutes, worker health and what arrives in later milestones, see [After the first start](docs/operations.md#after-the-first-start) in the operations doc. When something goes wrong, see [Troubleshooting](docs/troubleshooting.md).

---

## Where to read next

| Subject | Read |
|---|---|
| How it works: the three tiers (exact rules, classifier, LLM), spot checks, quick confirm, the review queue, learning from your mail app and decision traces | [docs/how-it-works.md](docs/how-it-works.md) |
| Configuring Sift in plain English: the rules file today, what happens when you save, preview before it applies and the technical settings | [docs/configuration.md](docs/configuration.md) |
| Operations: Mac mini vs mini PC, after the first start, managing mailboxes and remote access | [docs/operations.md](docs/operations.md) |
| Troubleshooting: symptom, cause and fix for common problems | [docs/troubleshooting.md](docs/troubleshooting.md) |
| System design: the data model and mailbox isolation, the project structure, the stack and the ADRs | [docs/architecture.md](docs/architecture.md) |
| Security model: trusted and untrusted input, the pinned Bridge certificate, the Bridge session and privacy | [docs/security.md](docs/security.md) |
| Evals: the synthetic inbox, what each eval run reports and the open learn-from-LLM experiment | [docs/evals.md](docs/evals.md) |
| Design decisions, one record per decision | [docs/adr/](docs/adr/) |
| Contributing: the development setup, the checks and the PR rules | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

## Roadmap

- [ ] **M1: Classify.** One mailbox: IMAP → exact rules (hardcoded) and the LLM → Proton labels, running on a real inbox. No UI. Decision traces from the first classification. The schema is mailbox-scoped with row-level security from day one. Includes a spike on Proton Bridge: how labels appear as folders, whether CONDSTORE/QRESYNC are supported, and whether `Message-ID` is reliable across folders ([findings](.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md)).
- [ ] **M2: Learn.** Review queue with **Why?** traces, one-key labeling, and the classifier: embeddings plus a model retrained on every correction, with cold-start thresholds, spot checks, quick confirm, and learning from relabels in your mail app.
- [ ] **M3: Plain-English rules.** `rules.md`, the interpretation step, `rules.lock.yaml`, the rules editor, and conflict handling for previously confirmed labels.
- [ ] **M4: Evals.** Synthetic inbox, per-tier metrics, model comparison, change preview, and the learn-from-LLM experiment.
- [ ] **M5: Multiple mailboxes.** Add and manage mailboxes in the UI, per-mailbox rules and classifiers, `shared-rules.md`, a unified review queue, and the isolation test suite.
- [ ] **M6: Guardrails.** Injection test suite, audit view, public demo deploy on synthetic data.
- [ ] **M7: Extras.** Draft replies to recruiters from a `resume.yaml`, and webhooks (for example, n8n) for "when something Important arrives, do X".

**Not planned:** sending email, a hosted version. Multiple *users* (a household sharing one box) isn't planned either, but the mailbox model is built so that adding logins on top wouldn't require a rewrite. See [ADR 0001](docs/adr/0001-multiple-mailboxes-single-owner.md).

---

## Contributing

Issues and PRs are welcome. For anything beyond a small fix, please open an issue first. If it changes architecture, it probably needs an ADR.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you start; it has the development setup, the checks and the rules every contribution follows.

---

## License

[AGPL-3.0](LICENSE). You're free to use, modify and self-host Sift. If you run a modified version as a network service for other people, you must make your source available to them.
