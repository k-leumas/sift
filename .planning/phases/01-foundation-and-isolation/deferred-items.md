## Deferred Items

- Developer docs do not mention `.env.mailboxes` (found in 01-12)
  status: open
  **What:** compose.yaml now gives the worker `env_file: .env.mailboxes`. Docker Compose v2.2.3 refuses to load the project at all while that file is missing, so every `docker compose` command fails, including `docker compose up -d --wait db`, `docker compose exec db ...` and scripts/pg-dump-via-compose.sh (used by the DB backup tests through SIFT_PG_DUMP). Newer Compose (2.24+) supports `required: false`, but v2.2.3 does not.
  **Fix:** CONTRIBUTING.md (and README quick start, when written) should tell developers to `cp .env.mailboxes.example .env.mailboxes` alongside `.env`. Outside 01-12's files_modified, so not changed there.
