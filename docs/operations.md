# Operations

This page covers the day-to-day running of Sift once the [Quick start](../README.md#quick-start) is done: choosing the machine, the first start, worker health, managing mailboxes and remote access.

## Mac mini vs mini PC

- **Mac mini (Apple Silicon):** run **Ollama natively**, not in Docker. Docker on macOS can't use the GPU, so a containerized model runs CPU-only and much slower. Sift's containers reach the native Ollama at `host.docker.internal:11434`. This is the default.
- **Linux mini PC:** the target is to run everything in Docker, using an `ollama` Compose profile, which arrives in a later milestone. With the classifier handling most mail, CPU-only inference is fine. For now, install Ollama on the host as well. Compose maps `host.docker.internal` to the host for the worker, but Ollama must accept connections from the Docker network there: if `sift mailbox list` shows `Ollama unreachable at http://host.docker.internal:11434`, it does not.

## After the first start

- **Port 1143.** The `bridge` service publishes IMAP on host loopback port 1143 (`127.0.0.1` only). If the desktop Proton Mail Bridge app runs on the same machine, it already holds that port: quit the app, or set `SIFT_BRIDGE_PORT` in `.env` to another port. Inside Compose the worker always reaches Bridge at `bridge:1143`.
- **Classification.** The worker classifies new mail on every check. A mailbox whose rules file is missing or broken, or an Ollama that is down, shows as an `error` in `sift mailbox list` (see [The rules file today](configuration.md#the-rules-file-today) and [LLM](how-it-works.md#llm-small-local)); mail is still read meanwhile.
- **First minutes.** `docker compose run --rm setup sift mailbox list` shows each mailbox's state. While Bridge starts, the worker shows `connecting` for up to a minute instead of an error. Then it reads the last 3 days of mail slowly in the background (`ingest.initial_backfill_days`), shown as `ok, backfilling <done> of <total>`, while new mail keeps arriving as usual.
- **Bridge's own first sync is slow.** As measured on Proton Bridge v3.27.0 in the M1 spike, Bridge needed well over 30 minutes to download a large account, newest mail first ([findings](../.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md)). Older mail that Bridge had not downloaded yet when the first read ran can be read later with `sift mailbox backfill` (see [Managing mailboxes](#managing-mailboxes)).

`docker compose ps` shows the worker as `healthy` while it works. If it cannot read the mailbox registry or write its heartbeat three times in a row (about 30 seconds), for example because the database is unreachable, it logs the reason, exits with code 75, and Docker starts it again. While the database stays down, this repeats every minute or so until the database is back. `docker compose logs worker` shows the reason for each exit. A Bridge outage does not stop the worker: the affected mailbox shows an error in `sift mailbox list` until Bridge is back.

**Arriving in later milestones** (these commands do not work yet):

```sh
# The embedding model for the classifier (M2)
ollama pull nomic-embed-text

# Linux: run Ollama in Docker too, using the ollama Compose profile
docker compose --profile ollama up -d
```

The web UI at `http://<your-machine>:3000` also arrives in a later milestone.

## Managing mailboxes

The mailboxes in `config/config.yaml` are the source of truth. Every change goes through `docker compose run --rm setup`:

- **Add a mailbox:** add it to `config/config.yaml` (another Proton account; see [Requirements](../README.md#requirements)) and create its rules file (see [The rules file today](configuration.md#the-rules-file-today)), then let Bridge write its IMAP password and register it. Bridge allows one instance per vault, so stop the `bridge` service first:

  ```sh
  docker compose stop bridge
  docker compose run --rm bridge-init configure
  docker compose start bridge
  docker compose run --rm setup
  docker compose up -d --force-recreate worker
  ```

  `configure` writes the IMAP password of every configured mailbox whose address Bridge knows, saving the previous file to `.env.mailboxes.bak` first. If the account is not logged in to Bridge yet, run `docker compose run --rm bridge-init` instead of the `configure` line and type `login` again. Paste the printed `pin_sha256` into the new mailbox's `imap.tls` too; it is the same for every mailbox on this Bridge. The worker reads `.env.mailboxes` only when its container is created, hence the last line. Once the new file works, empty the backup with `: > .env.mailboxes.bak`, but keep the file. If it goes missing, Compose stops `bridge-init` with `bind source path does not exist`; recreate it with `touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak`.
- **Change a mailbox's settings:** edit `config/config.yaml`, run `docker compose run --rm setup`, then `docker compose up -d --force-recreate worker` (the worker reads `config/config.yaml` and `.env.mailboxes` only when it starts). Bridge writes the IMAP passwords, so if a mailbox's password changed, run the three Bridge lines of **Add a mailbox** first.
- **Remove a mailbox:** delete its entry from `config/config.yaml` and rerun setup. The mailbox is disabled and its data is kept.
- **Bring it back:** add the same slug again and rerun setup. It is re-enabled with its data.
- **Rename a mailbox:** first move its rules folder, `data/mailboxes/<old>`, to `data/mailboxes/<new>` (Sift never moves your files, and the rename refuses until `data/mailboxes/<new>/rules.yaml` exists):

  ```sh
  mv data/mailboxes/<old> data/mailboxes/<new>
  ```

  Then run `docker compose run --rm setup sift mailbox rename <old> <new>`, change the slug in `config/config.yaml` to match, then rerun setup. The mailbox keeps its data under the new slug. If setup sees one slug disappear while a new one appears, it refuses to apply until you either rename the mailbox or rerun with `docker compose run --rm setup sift setup --confirm`, which disables the old mailbox and adds the new one.
- **See every mailbox and its status:** `docker compose run --rm setup sift mailbox list`. Disabled mailboxes are listed too. The status is one of `ok` (with `, backfilling <done> of <total>` during the first read (3 days by default, `ingest.initial_backfill_days`)), `connecting`, `needs attention`, `error: <reason>`, `disabled since <date>` or `never run`.
- **Needs attention:** if a single check would treat more than `ingest.new_mail_cap` messages (default 200) as new, for example after a mass move into the inbox, the worker processes none of them and holds the mailbox instead of flooding Sift. The status reads `needs attention: <n> new messages held; run sift mailbox resume <slug>`. When you have checked that the mail is expected, release the hold:

  ```sh
  docker compose run --rm setup sift mailbox resume <slug>
  ```

  The next check processes the held messages, plus new mail up to the usual limit.
- **Classify mail again:** `docker compose run --rm --no-deps worker sift classify <slug> --all-pending`, or `--since <YYYY-MM-DD>` or `--message <id>` (see [The rules file today](configuration.md#the-rules-file-today)). It adds new decisions and keeps the earlier ones.
- **Read older mail on demand:** the first read (3 days by default, `ingest.initial_backfill_days`) happens once. To read a range again, for example after Bridge finished its own first sync, run:

  ```sh
  docker compose run --rm worker sift mailbox backfill <slug> --days 3
  ```

  It first shows how many messages it found in the last `--days` days (1 to 365, default 3), then asks you to type `yes`; `--yes` skips the question. Messages Sift already has are skipped. It waits up to a minute if the worker is reading the same mailbox at that moment.
- **Bridge's certificate changed:** if you reinstalled Bridge or its certificate was regenerated, the mailbox stops with a certificate error instead of trusting the new key. Show the fingerprint the worker now sees and compare it with the one `docker compose run --rm bridge-init` printed:

  ```sh
  docker compose run --rm --no-deps worker sift bridge trust <slug>
  ```

  It prints the fingerprint and whether it matches `imap.tls.pin_sha256`. Only if the two are the same, replace the pin in `config/config.yaml`, then restart the worker with `docker compose restart worker`. `sift bridge trust <slug>` never logs in and never changes your config.

## Remote access

Don't expose Sift to the internet. To use it from your phone, put the machine on [Tailscale](https://tailscale.com) (or a similar private network) and open it through that.
