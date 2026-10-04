#!/bin/sh
# Run pg_dump 18 inside the Compose db container (D-29 host-dev note).
#
# For a host without pg_dump 18 (e.g. a Mac): set SIFT_PG_DUMP to this script.
# Arguments are passed through unchanged, except that the host:port of the
# --dbname= URL becomes 127.0.0.1:5432, the server's own address inside the
# container. PGPASSWORD is forwarded from the caller's environment by name
# only, so the password never appears in argv. The dump streams to stdout.
set -eu

cd "$(dirname "$0")/.."

for arg do
  shift
  case $arg in
    --dbname=*)
      arg=$(printf '%s\n' "$arg" | sed -E 's#^(--dbname=[a-z]+://([^@/]*@)?)[^/?]*#\1127.0.0.1:5432#')
      ;;
  esac
  set -- "$@" "$arg"
done

exec docker compose exec -T -e PGPASSWORD db pg_dump "$@"
