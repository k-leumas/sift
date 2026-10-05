#!/usr/bin/env bash
# Full-stack smoke test: build the image, bring up db -> setup -> worker, and
# check that setup exited 0, the worker is healthy, and migrations and the
# mailbox registry were applied. Used locally and by the CI job compose-smoke.
# It builds and starts only db, setup and worker; the Bridge image is checked
# separately by scripts/bridge-smoke.sh.
#
# Run from the repository root:
#   scripts/compose-smoke.sh           leave the stack running afterwards
#   scripts/compose-smoke.sh --down    remove containers AND volumes at exit
#
# The smoke stack shares none of your files: it never reads or writes your
# .env, .env.mailboxes, config/config.yaml or backups/. Its own copies live in
# .smoke/<project>/ (git-ignored), made from the committed examples with
# throwaway values: .env (random database passwords, kept across runs because
# the smoke volume stores them), .env.mailboxes (placeholders) and
# config/config.yaml (IMAP hosts replaced by an unroutable .invalid name, so no
# smoke worker can reach your real mailboxes). It also builds its own image,
# sift-smoke:local, and leaves your sift:local alone.
#
# The smoke stack never touches your database: it runs on its own volume,
# <project>-pgdata-smoke (SIFT_PGDATA_VOLUME), never sift-pgdata. Outside CI it
# also needs its own Compose project, so it cannot replace your running
# containers: set COMPOSE_PROJECT_NAME (and SIFT_DB_PORT if your db already
# publishes 5432). In CI too, it refuses a project that already has containers
# unless they are an earlier smoke stack on the same volume.
#
# The Bridge volume is external, and Compose fails every command while it is
# missing, so the smoke stack creates its own, <project>-bridge-smoke
# (SIFT_BRIDGE_VOLUME), never sift-bridge, and fills its own throwaway
# SIFT_BRIDGE_KEYCHAIN_PASSPHRASE. It also points bridge-init's backup file
# (SIFT_MAILBOXES_BAK_FILE) at a path that does not exist, proving the base
# stack starts without it.
#
# Pre-migration dumps go to .smoke/<project>/backups (SIFT_BACKUP_HOST_DIR),
# never to ./backups: every smoke run migrates a fresh database, and the dump
# prune would otherwise delete your own pre-migration backups.
#
# --down runs `docker compose down -v`, which deletes the smoke volume, and
# removes the smoke Bridge volume (down -v never removes external volumes). It
# only runs when CI=true or SMOKE_ALLOW_VOLUME_REMOVAL=yes is set.
#
# Env: SMOKE_TIMEOUT (seconds, default 300), COMPOSE_PROJECT_NAME, SIFT_DB_PORT
# (beats the smoke .env), SIFT_BACKUP_HOST_DIR.
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
bridge_volume=${SIFT_BRIDGE_VOLUME:-$project-bridge-smoke}
export SIFT_BRIDGE_VOLUME=$bridge_volume

refuse() {
  echo "compose-smoke: $*" >&2
  exit 2
}

if [ "$volume" = sift-pgdata ]; then
  refuse "refusing to run on sift-pgdata, the database volume of your own stack; unset SIFT_PGDATA_VOLUME."
fi
if [ "$bridge_volume" = sift-bridge ]; then
  refuse "refusing to run on sift-bridge, the Bridge volume of your own stack; unset SIFT_BRIDGE_VOLUME."
fi
if [ "${CI:-}" != true ] && [ "$project" = "$default_project" ]; then
  refuse "outside CI, set COMPOSE_PROJECT_NAME (and SIFT_DB_PORT if 5432 is taken) so the smoke stack does not replace your own containers."
fi
if [ "$down" = true ] && [ "${CI:-}" != true ] && [ "${SMOKE_ALLOW_VOLUME_REMOVAL:-}" != yes ]; then
  echo "compose-smoke: --down deletes the smoke volume $volume." >&2
  echo "Refusing outside CI; set SMOKE_ALLOW_VOLUME_REMOVAL=yes to confirm." >&2
  exit 2
fi

# The env-var checks above cannot see CI=true in a local shell, or an explicit
# COMPOSE_PROJECT_NAME that names your own project. So also check what Docker
# actually runs: a project that already has containers must be an earlier
# smoke stack (one of them mounts the smoke volume), or `up` would recreate
# your containers on the smoke volume and --down would remove them. This runs
# before the EXIT trap is set, so a refusal never triggers --down.
project_filter="label=com.docker.compose.project=$project"
existing=$(docker ps -aq --filter "$project_filter") \
  || refuse "docker ps failed; is the Docker daemon running?"
if [ -n "$existing" ]; then
  on_volume=$(docker ps -aq --filter "$project_filter" --filter "volume=$volume") \
    || refuse "docker ps failed; is the Docker daemon running?"
  if [ -z "$on_volume" ]; then
    refuse "Compose project $project already has containers that are not a smoke stack (none mounts $volume); pick another COMPOSE_PROJECT_NAME."
  fi
fi

# Resolved physical path of an existing directory.
real_dir() { (cd "$1" && pwd -P); }

# setup and worker run as uid 1000 (the image's node user) and bind-mount the
# smoke config dir read-only and the backup dir read-write. Linux enforces host
# ownership on bind mounts (Docker Desktop on macOS does not), so the config dir
# and config.yaml must be readable by others and the backup dir must be owned
# by uid 1000. The .env files stay 0600: only the compose CLI on the host reads
# them.
(umask 022 && mkdir -p ".smoke/$project/config")
smoke_dir=$(real_dir ".smoke/$project")
umask 077

backup_dir=${SIFT_BACKUP_HOST_DIR:-$smoke_dir/backups}
mkdir -p "$backup_dir"
if [ -d backups ] && [ "$(real_dir "$backup_dir")" = "$(real_dir backups)" ]; then
  refuse "refusing to write smoke dumps into ./backups, your own backup folder; unset SIFT_BACKUP_HOST_DIR."
fi
SIFT_BACKUP_HOST_DIR=$(real_dir "$backup_dir")
export SIFT_BACKUP_HOST_DIR

# bridge-init's backup bind source (D-81). It must not exist: every smoke run
# then proves `up` of db, setup and worker ignores the missing file.
SIFT_MAILBOXES_BAK_FILE=$smoke_dir/no-such-backup
if [ -e "$SIFT_MAILBOXES_BAK_FILE" ]; then
  refuse "$SIFT_MAILBOXES_BAK_FILE exists; remove it, the smoke stack needs that path missing."
fi
export SIFT_MAILBOXES_BAK_FILE

smoke_env=$smoke_dir/.env
if [ ! -f "$smoke_env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in
      *_PASSWORD= | *_PASSPHRASE=) printf '%s%s\n' "$line" "$(openssl rand -hex 24)" ;;
      *) printf '%s\n' "$line" ;;
    esac
  done < .env.example > "$smoke_env"
  echo "compose-smoke: created $smoke_env from .env.example (random passwords)"
fi
# A smoke .env from before Bridge lacks the keychain passphrase.
if ! grep -q '^SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=' "$smoke_env"; then
  printf 'SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=%s\n' "$(openssl rand -hex 24)" >> "$smoke_env"
  echo "compose-smoke: added SIFT_BRIDGE_KEYCHAIN_PASSPHRASE to $smoke_env"
fi

while IFS= read -r line || [ -n "$line" ]; do
  case $line in
    *_PASSWORD=) printf '%s%s\n' "$line" "smoke-placeholder" ;;
    *) printf '%s\n' "$line" ;;
  esac
done < .env.mailboxes.example > "$smoke_dir/.env.mailboxes"

(umask 022 && sed -E 's/^([[:space:]]*host:).*/\1 imap.smoke.invalid/' \
  config/config.example.yaml > "$smoke_dir/config/config.yaml")

export SIFT_CONFIG_HOST_DIR=$smoke_dir/config
export SIFT_MAILBOXES_ENV_FILE=$smoke_dir/.env.mailboxes
export SIFT_IMAGE=sift-smoke:local

# Every compose call reads the smoke .env, never ./.env.
dc() { docker compose --env-file "$smoke_env" "$@"; }

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
    dc down -v --remove-orphans || true
    docker volume rm "$SIFT_BRIDGE_VOLUME" >/dev/null || true
  fi
}
trap cleanup EXIT

fail() {
  echo "compose-smoke: FAILED: $*" >&2
  dc logs --no-color || true
  exit 1
}

# The service's main container (not `docker compose run` one-off containers).
container() {
  docker ps -aq \
    --filter "label=com.docker.compose.project=$project" \
    --filter "label=com.docker.compose.service=$1" \
    --filter "label=com.docker.compose.oneoff=False" | head -n 1
}

docker volume create "$SIFT_BRIDGE_VOLUME" >/dev/null || fail "docker volume create $SIFT_BRIDGE_VOLUME"
dc build setup worker || fail "docker compose build setup worker"
dc up -d db setup worker || fail "docker compose up -d db setup worker"

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
  dc exec -T db psql -U postgres -d sift -Atc "$1"
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
