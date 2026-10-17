# Troubleshooting

Each entry gives what you see, why, and the fix, with a link to the section that explains it in full. Run every command from the repository root.

## Ollama unreachable or the model is missing

**What you see:** `docker compose run --rm setup sift mailbox list` shows the mailbox as `error: Ollama unreachable at http://host.docker.internal:11434 (ECONNREFUSED)` or `error: Ollama at http://host.docker.internal:11434 has no model qwen3:1.7b; run: ollama pull qwen3:1.7b`.

**Why:** Sift talks only to the Ollama server at `models.url` and uses the model named in `models.llm`. Before each pass it checks that the model is pulled on that server. Sift retries on its own and carries on once Ollama answers again. An Ollama outage never puts a message in review: its mail stays pending until Ollama answers again.

**Fix:** make sure Ollama is installed and running on this machine, then pull the model named in `models.llm`:

```sh
ollama pull qwen3:1.7b
```

On a Linux mini PC, Ollama runs on the host. Compose maps `host.docker.internal` to the host for the worker, but Ollama must accept connections from the Docker network there: if `sift mailbox list` shows `Ollama unreachable at http://host.docker.internal:11434`, it does not.

**Details:** [LLM (small, local)](how-it-works.md#llm-small-local), [Mac mini vs mini PC](operations.md#mac-mini-vs-mini-pc) and the [Quick start](../README.md#quick-start), step 11.

## Rules file not found or has problems

**What you see:** `docker compose run --rm setup sift mailbox list` shows the mailbox as `error: rules file not found: /data/mailboxes/<slug>/rules.yaml...` when the file is missing, or `error: rules file /data/mailboxes/<slug>/rules.yaml has <n> problems: ...` when it is broken.

**Why:** each mailbox reads its rules from `data/mailboxes/<slug>/rules.yaml`. A missing or broken file pauses classification for that mailbox only. Its mail is still read and kept, and the other mailboxes carry on.

**Fix:** if the file is missing, start it from the example:

```sh
mkdir -p data/mailboxes/<slug> && cp data/mailboxes/example/rules.example.yaml data/mailboxes/<slug>/rules.yaml
```

Then check every mailbox's file:

```sh
docker compose run --rm --no-deps worker sift config check
```

It prints each problem as `<file>:<line>:<column> <key>: <problem>` and exits with code 1. Fix the file and the next check picks it up, with no restart.

**Details:** [The rules file today](configuration.md#the-rules-file-today).

## Mailbox shows needs attention

**What you see:** `sift mailbox list` shows `needs attention: <n> new messages held; run sift mailbox resume <slug>`.

**Why:** a single check would have treated more than `ingest.new_mail_cap` messages (default 200) as new, for example after a mass move into the inbox. The worker processes none of them and holds the mailbox instead of flooding Sift.

**Fix:** when you have checked that the mail is expected, release the hold:

```sh
docker compose run --rm setup sift mailbox resume <slug>
```

The next check processes the held messages, plus new mail up to the usual limit.

**Details:** [Managing mailboxes](operations.md#managing-mailboxes).

## Certificate error after Bridge was reinstalled

**What you see:** the mailbox stops with a certificate error after you reinstalled Bridge or its certificate was regenerated.

**Why:** Sift pins Bridge's public key in `imap.tls.pin_sha256` and accepts exactly that key. A regenerated certificate has a new key, so the mailbox stops instead of trusting it. A mailbox without the pin shows a certificate error too: the worker then checks the certificate the normal way, which a self-signed certificate fails, so it refuses to log in.

**Fix:** show the fingerprint the worker now sees and compare it with the one `docker compose run --rm bridge-init` printed:

```sh
docker compose run --rm --no-deps worker sift bridge trust <slug>
```

It prints the fingerprint and whether it matches `imap.tls.pin_sha256`. Only if the two are the same, replace the pin in `config/config.yaml`, then restart the worker with `docker compose restart worker`. `sift bridge trust <slug>` never logs in and never changes your config. For a mailbox with no pin yet, paste the `pin_sha256` from the Bridge login into its `imap.tls` ([Quick start](../README.md#quick-start), step 9).

**Details:** [Managing mailboxes](operations.md#managing-mailboxes) and the [Security model](security.md).

## Port 1143 already in use

**What you see:** the desktop Proton Mail Bridge app runs on the same machine as Sift.

**Why:** the `bridge` service publishes IMAP on host loopback port 1143 (`127.0.0.1` only), and the desktop app already holds that port.

**Fix:** quit the app, or set `SIFT_BRIDGE_PORT` in `.env` to another port. Inside Compose the worker always reaches Bridge at `bridge:1143`.

**Details:** [After the first start](operations.md#after-the-first-start).

## New mail treated as old because the host clock drifts

**What you see:** new mail is treated as old.

**Why:** Proton's servers set each email's arrival time (its IMAP INTERNALDATE), while the worker and Bridge both run on this machine and share its clock. Sift caps arrival times at the worker's clock, and on each check it re-reads only mail dated up to 5 minutes before the newest arrival time it has recorded, so a host clock that drifts more than a few minutes from Proton's time can make Sift treat new mail as old.

**Fix:** keep the host clock in sync over NTP. On macOS, open System Settings > General > Date & Time and make sure "Set time and date automatically" is on, or run `sntp time.apple.com`, which prints the offset and changes nothing. On Linux, run `timedatectl` and look for `System clock synchronized: yes`.

**Details:** [Requirements](../README.md#requirements).

## Bridge login interrupted, or bridge-init will not start

**What you see:** the Bridge login was interrupted while it wrote `.env.mailboxes`, or Compose stops `bridge-init` with `bind source path does not exist`.

**Why:** `bridge-init` saves the previous `.env.mailboxes` into `.env.mailboxes.bak` before changing it, and Compose refuses to start `bridge-init` while that backup file is missing.

**Fix:** after an interrupted login, restore the previous file before you run it again:

```sh
cp .env.mailboxes.bak .env.mailboxes
```

If the backup file is missing, recreate it:

```sh
touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak
```

Keep the file: empty it rather than delete it.

**Details:** the [Quick start](../README.md#quick-start), steps 7 and 8, and [Managing mailboxes](operations.md#managing-mailboxes).

## Linux file ownership for the containers

**What you see:** on Linux, `id -u` does not print `1000`.

**Why:** the `setup` and `worker` containers run as uid 1000, and Linux enforces file ownership on the folders they mount. `setup` writes a backup to `backups/` before it migrates.

**Fix:** hand the backups folder to the container user:

```sh
sudo chown 1000 backups
```

Also leave `config/config.yaml` and your rules files readable by others (the mode `cp` gives them is fine). Create the `data/mailboxes/<slug>` folders yourself before you start the stack, which also keeps Docker from creating `data/` owned by root.

**Details:** the [Quick start](../README.md#quick-start), steps 10 and 12.

## Older mail missing because the first Bridge sync is slow

**What you see:** older mail is missing after the first read.

**Why:** as measured on Proton Bridge v3.27.0 in the M1 spike, Bridge needed well over 30 minutes to download a large account, newest mail first. Mail that Bridge had not downloaded yet when the first read ran was not there to read.

**Fix:** once Bridge has finished its own first sync, read the range again:

```sh
docker compose run --rm worker sift mailbox backfill <slug> --days 3
```

It first shows how many messages it found in the last `--days` days (1 to 365, default 3), then asks you to type `yes`. Messages Sift already has are skipped.

**Details:** [After the first start](operations.md#after-the-first-start) and [Managing mailboxes](operations.md#managing-mailboxes).

## The worker keeps restarting

**What you see:** the worker exits with code 75 and Docker starts it again, every minute or so.

**Why:** the worker cannot read the mailbox registry or write its heartbeat three times in a row (about 30 seconds), for example because the database is unreachable. While the database stays down, this repeats until the database is back.

**Fix:** read the reason for each exit, then bring back what it names:

```sh
docker compose logs worker
```

`docker compose ps` shows the worker as `healthy` while it works. A Bridge outage does not stop the worker: the affected mailbox shows an error in `sift mailbox list` until Bridge is back.

**Details:** [After the first start](operations.md#after-the-first-start).

## Compose refuses every command

**What you see:** Compose refuses every command, for every service.

**Why:** the `sift-bridge` volume, which holds Bridge's login session, is missing.

**Fix:** create it, once:

```sh
docker volume create sift-bridge
```

Deleting the volume removes the Bridge session it held, so if it existed before, log in to Proton through Bridge again (step 8 of the Quick start).

**Details:** the [Quick start](../README.md#quick-start), step 6, and the [Security model](security.md).

## One message could not be classified

**What you see:** `sift mailbox list` shows `ok; 1 message could not be classified (ids: <id>); see docker compose logs worker`, or `sift classify` prints `message <id>: Ollama failed on this message (HTTP 500); skipped`.

**Why:** Ollama fails on that one message only (for example an HTTP 500 every time it sees that email) while it answers for the rest. The other mail is still classified and the mailbox stays ok. After three such passes, if Ollama still answers a short test request that contains no mail, the worker holds that message for review with the reason `llm_error`, so it no longer stays pending.

**Fix:** read `docker compose logs worker` for the cause. The message ends in review on its own; to try it again later, run `sift classify` with `--message <id>`.

**Details:** [LLM (small, local)](how-it-works.md#llm-small-local) and [The rules file today](configuration.md#the-rules-file-today).
