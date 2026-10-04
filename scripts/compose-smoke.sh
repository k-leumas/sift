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
# --down runs `docker compose down -v`, which deletes the sift-pgdata volume
# (the whole database). It therefore only runs when CI=true or
# SMOKE_ALLOW_VOLUME_REMOVAL=yes is set.
#
# Env: SMOKE_TIMEOUT (seconds, default 300), COMPOSE_PROJECT_NAME.
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

if [ "$down" = true ] && [ "${CI:-}" != true ] && [ "${SMOKE_ALLOW_VOLUME_REMOVAL:-}" != yes ]; then
  echo "compose-smoke: --down deletes the sift-pgdata volume (all data)." >&2
  echo "Refusing outside CI; set SMOKE_ALLOW_VOLUME_REMOVAL=yes to confirm." >&2
  exit 2
fi

timeout=${SMOKE_TIMEOUT:-300}
# Compose's default project name: the directory name, lowercased, restricted
# to [a-z0-9_-].
project=${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')}

umask 077

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

if [ ! -f config/config.yaml ]; then
  cp config/config.example.yaml config/config.yaml
  echo "compose-smoke: created config/config.yaml from config/config.example.yaml"
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
