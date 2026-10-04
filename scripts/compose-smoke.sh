#!/usr/bin/env bash
# Full-stack smoke test: build the image, bring up db -> setup -> worker, and
# check that setup exited 0, the worker is healthy, and migrations and the
# mailbox registry were applied. Used locally and by the CI job compose-smoke.
#
# Run from the repository root:
#   scripts/compose-smoke.sh           leave the stack running afterwards
#   scripts/compose-smoke.sh --down    remove containers AND volumes at exit
#
# Missing owner files (.env, .env.mailboxes, config/config.yaml) are created
# from the committed examples with throwaway values; existing ones are never
# overwritten.
#
# The smoke stack never touches your database: it runs on its own volume,
# <project>-pgdata-smoke (SIFT_PGDATA_VOLUME), never sift-pgdata. Outside CI it
# also needs its own Compose project, so it cannot replace your running
# containers: set COMPOSE_PROJECT_NAME (and SIFT_DB_PORT if your db already
# publishes 5432).
#
# Pre-migration dumps go to .smoke/<project>/backups (SIFT_BACKUP_HOST_DIR),
# never to ./backups: every smoke run migrates a fresh database, and the dump
# prune would otherwise delete your own pre-migration backups.
#
# --down runs `docker compose down -v`, which deletes the smoke volume. It only
# runs when CI=true or SMOKE_ALLOW_VOLUME_REMOVAL=yes is set.
#
# Env: SMOKE_TIMEOUT (seconds, default 300), COMPOSE_PROJECT_NAME, SIFT_DB_PORT,
# SIFT_BACKUP_HOST_DIR.
set -euo pipefail

down=false
for arg in "$@"; do
  case $arg in
    --down) down=true ;;
    *)
      echo "usage: scripts/compose-smoke.sh [--down]" >&2
      exit 2
      ;;
  esac
done

timeout=${SMOKE_TIMEOUT:-300}
# Compose's default project name: the directory name, lowercased, restricted
# to [a-z0-9_-].
default_project=$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
project=${COMPOSE_PROJECT_NAME:-$default_project}
volume=${SIFT_PGDATA_VOLUME:-$project-pgdata-smoke}
export SIFT_PGDATA_VOLUME=$volume

refuse() {
  echo "compose-smoke: $*" >&2
  exit 2
}

if [ "$volume" = sift-pgdata ]; then
  refuse "refusing to run on sift-pgdata, the database volume of your own stack; unset SIFT_PGDATA_VOLUME."
fi
if [ "${CI:-}" != true ] && [ "$project" = "$default_project" ]; then
  refuse "outside CI, set COMPOSE_PROJECT_NAME (and SIFT_DB_PORT if 5432 is taken) so the smoke stack does not replace your own containers."
fi
if [ "$down" = true ] && [ "${CI:-}" != true ] && [ "${SMOKE_ALLOW_VOLUME_REMOVAL:-}" != yes ]; then
  echo "compose-smoke: --down deletes the smoke volume $volume." >&2
  echo "Refusing outside CI; set SMOKE_ALLOW_VOLUME_REMOVAL=yes to confirm." >&2
  exit 2
fi

umask 077

# Resolved physical path of an existing directory.
real_dir() { (cd "$1" && pwd -P); }

backup_dir=${SIFT_BACKUP_HOST_DIR:-$PWD/.smoke/$project/backups}
mkdir -p "$backup_dir"
if [ -d backups ] && [ "$(real_dir "$backup_dir")" = "$(real_dir backups)" ]; then
  refuse "refusing to write smoke dumps into ./backups, your own backup folder; unset SIFT_BACKUP_HOST_DIR."
fi
SIFT_BACKUP_HOST_DIR=$(real_dir "$backup_dir")
export SIFT_BACKUP_HOST_DIR

if [ ! -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      *_PASSWORD=) printf '%s%s\n' "$line" "$(openssl rand -hex 24)" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.example > .env
  echo "compose-smoke: created .env from .env.example (random passwords)"
fi

if [ ! -f .env.mailboxes ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      *_PASSWORD=) printf '%s%s\n' "$line" "smoke-placeholder" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.mailboxes.example > .env.mailboxes
  echo "compose-smoke: created .env.mailboxes from .env.mailboxes.example (placeholder values)"
fi

# setup and worker run as uid 1000 (the image's node user) and bind-mount
# ./config read-only and the backup dir read-write. Linux enforces host
# ownership on bind mounts (Docker Desktop on macOS does not), so config.yaml
# must be readable by others and the backup dir must be owned by uid 1000. The
# .env files stay 0600: only the compose CLI on the host reads them.
if [ ! -f config/config.yaml ]; then
  (umask 022 && cp config/config.example.yaml config/config.yaml)
  echo "compose-smoke: created config/config.yaml from config/config.example.yaml"
fi

as_root() {
  if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi
}

if [ "$(uname -s)" = Linux ] && [ "$(id -u)" != 1000 ] \
  && [ "$(ls -nd "$SIFT_BACKUP_HOST_DIR" | awk '{print $3}')" != 1000 ]; then
  echo "compose-smoke: chown 1000 $SIFT_BACKUP_HOST_DIR (setup writes pre-migration dumps there as uid 1000)"
  if ! as_root chown 1000 "$SIFT_BACKUP_HOST_DIR"; then
    echo "compose-smoke: FAILED: $SIFT_BACKUP_HOST_DIR must be writable by uid 1000; run: sudo chown 1000 $SIFT_BACKUP_HOST_DIR" >&2
    exit 1
  fi
fi

cleanup() {
  if [ "$down" = true ]; then
    docker compose down -v --remove-orphans || true
  fi
}
trap cleanup EXIT

fail() {
  echo "compose-smoke: FAILED: $*" >&2
  docker compose logs --no-color || true
  exit 1
}

# The service's main container (not `docker compose run` one-off containers).
container() {
  docker ps -aq \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$1" \
    --filter "label=com.docker.compose.oneoff=False" | head -n 1
}

docker compose build || fail "docker compose build"
docker compose up -d || fail "docker compose up -d"

deadline=$((SECONDS + timeout))
setup_done=false
worker_healthy=false
while [ "$SECONDS" -lt "$deadline" ]; do
  if [ "$setup_done" = false ]; then
    id=$(container setup)
    if [ -n "$id" ]; then
      read -r status code < <(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$id")
      if [ "$status" = exited ]; then
        [ "$code" = 0 ] || fail "setup exited with code $code"
        setup_done=true
        echo "compose-smoke: setup exited 0"
      fi
    fi
  fi
  if [ "$setup_done" = true ]; then
    id=$(container worker)
    if [ -n "$id" ]; then
      health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")
      if [ "$health" = healthy ]; then
        worker_healthy=true
        echo "compose-smoke: worker healthy"
        break
      fi
      read -r status restarts < <(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$id")
      if [ "$status" = exited ] || [ "$restarts" != 0 ]; then
        fail "worker exited (status $status, restarts $restarts)"
      fi
    fi
  fi
  sleep 5
done

[ "$setup_done" = true ] || fail "setup did not finish within ${timeout}s"
[ "$worker_healthy" = true ] || fail "worker not healthy within ${timeout}s"

# Inspection only: the image superuser bypasses RLS.
query() {
  docker compose exec -T db psql -U postgres -d sift -Atc "$1"
}

atleast() {
  local label=$1 min=$2 sql=$3 count
  count=$(query "$sql") || fail "query failed: $label"
  count=${count//[[:space:]]/}
  [ "$count" -ge "$min" ] || fail "$label: expected >= $min, got $count"
  echo "compose-smoke: $label = $count"
}

atleast "migrations applied" 5 "select count(*) from drizzle.__drizzle_migrations"
atleast "mailboxes registered" 1 "select count(*) from mailbox"
atleast "mailboxes ok" 1 "select count(*) from mailbox_status where state = 'ok'"

echo "compose smoke OK"
