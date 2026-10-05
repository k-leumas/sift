#!/usr/bin/env bash
# Dovecot IMAP server for tests: a real STARTTLS server with a self-signed
# certificate, locally and in CI (Bridge is not available in CI).
#
# Run from anywhere:
#   scripts/test-imap.sh up       start it, or reuse the running one (idempotent)
#   scripts/test-imap.sh down     remove it
#   scripts/test-imap.sh status   exit 0 only while it is running
#
# The container is named after its port, sift-test-imap-<port>, so two
# checkouts on different SIFT_TEST_IMAP_PORT values never attach to each
# other's server, and apps/worker/test/support/test-imap.ts reads the pinned
# certificate from the same container it connects to.
#
# Every user name logs in with the password sift-test-password (Dovecot's
# static passdb), and doveadm creates the mailbox on first use. The server
# listens on 127.0.0.1 only.
#
# The certificate is made fresh for each container: self-signed, CA:TRUE, SAN
# IP:127.0.0.1, like the one Proton Bridge presents. The image's own baked-in
# certificate is not used because its private key ships with the image. The
# key never stays on the host: it is written to a temporary directory, copied
# into the created container and deleted.
#
# Env: SIFT_TEST_IMAP_PORT (default 31143), SIFT_TEST_IMAP_TIMEOUT (seconds to
# wait for STARTTLS, default 60).
set -euo pipefail

image=dovecot/dovecot:2.4.5
port=${SIFT_TEST_IMAP_PORT:-31143}
timeout=${SIFT_TEST_IMAP_TIMEOUT:-60}
password=sift-test-password
cert_dir=/etc/dovecot/ssl

refuse() {
  echo "test-imap: $*" >&2
  exit 2
}

case $port in
  '' | *[!0-9]*) refuse "SIFT_TEST_IMAP_PORT must be a port number, got '$port'." ;;
esac
if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
  refuse "SIFT_TEST_IMAP_PORT must be between 1 and 65535, got $port."
fi
case $timeout in
  '' | *[!0-9]*) refuse "SIFT_TEST_IMAP_TIMEOUT must be a number of seconds, got '$timeout'." ;;
esac

name=sift-test-imap-$port

container_exists() {
  docker container inspect "$name" >/dev/null 2>&1
}

container_running() {
  [ "$(docker container inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" = true ]
}

# True once the server answers STARTTLS with a certificate.
presents_certificate() {
  openssl s_client -starttls imap -connect "127.0.0.1:$port" </dev/null 2>/dev/null \
    | openssl x509 -noout 2>/dev/null
}

create_container() {
  local tmp
  tmp=$(mktemp -d)
  # shellcheck disable=SC2064 # expand now: tmp is local
  trap "rm -rf '$tmp'" EXIT
  mkdir "$tmp/ssl"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -subj /CN=sift-test-imap \
    -addext basicConstraints=critical,CA:TRUE \
    -addext subjectAltName=IP:127.0.0.1 \
    -keyout "$tmp/ssl/tls.key" -out "$tmp/ssl/tls.crt" 2>/dev/null \
    || refuse "openssl could not create the test certificate."
  # Dovecot runs as the image's vmail user, and docker cp keeps the modes.
  chmod 755 "$tmp/ssl"
  chmod 644 "$tmp/ssl/tls.key" "$tmp/ssl/tls.crt"
  docker create --name "$name" \
    --label sift.test-imap=true \
    -p "127.0.0.1:$port:31143" \
    -e "USER_PASSWORD=$password" \
    "$image" >/dev/null
  # Replaces the image's symlinks to its baked-in certificate.
  docker cp "$tmp/ssl/." "$name:$cert_dir/"
  rm -rf "$tmp"
  trap - EXIT
}

up() {
  if container_running; then
    :
  elif container_exists; then
    docker start "$name" >/dev/null
  else
    create_container
    docker start "$name" >/dev/null
  fi

  local waited=0
  until presents_certificate; do
    if [ "$waited" -ge "$timeout" ]; then
      echo "test-imap: $name gave no STARTTLS certificate on 127.0.0.1:$port within $timeout s" >&2
      docker logs --tail 20 "$name" >&2 || true
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "test IMAP server ready on 127.0.0.1:$port"
}

down() {
  if container_exists; then
    docker rm -f "$name" >/dev/null
    echo "removed $name"
  else
    echo "$name is not present"
  fi
}

status() {
  if container_running; then
    echo "$name running on 127.0.0.1:$port"
  else
    echo "$name not running"
    exit 1
  fi
}

case ${1:-} in
  up) up ;;
  down) down ;;
  status) status ;;
  *)
    echo "usage: scripts/test-imap.sh up|down|status" >&2
    exit 2
    ;;
esac
