#!/bin/bash
# Entrypoint of the Sift Proton Bridge image (bridge/Dockerfile).
#
# Modes (first argument, default serve):
#   serve          unlock the keychain (fail closed), then run socat and Bridge
#                  side by side and stop both when either one exits
#   keychain-init  create the GPG key, pass store and canary when absent, then
#                  unlock and verify them
#   configure      start Bridge with its gRPC frontend, print the certificate
#                  fingerprint to pin (D-73), then run sift-helper configure:
#                  telemetry and automatic updates off, IMAP passwords into the
#                  mounted .env.mailboxes (D-39, D-81)
#   repair         start Bridge with its gRPC frontend and trigger its repair
#                  (the live spike's IMAP cache rebuild, D-43)
#   init           (default of bridge-init, needs a TTY) keychain-init, then
#                  Bridge's own CLI for `login` (password and 2FA typed without
#                  echo, D-36), then configure
#   cli            (needs a TTY) Bridge's own CLI for maintenance such as logout
#
# init, configure, cli and repair run in the one-shot bridge-init service
# (docker compose run --rm bridge-init [configure|cli|repair]), the only
# service that mounts .env.mailboxes, its backup and config (D-79).
#
# Exit codes: 0 ok, 1 a supervised child exited or Bridge did not start (or the
# bridge service still runs), 2 .env.mailboxes missing or not a regular file,
# its backup cannot be written, or init/cli without a terminal, 3 no Bridge account is logged in, 4 no
# configured mailbox matches a Bridge address, 64 unknown mode, 78 keychain or
# vault refusal. Messages are fixed text and never contain a secret.
#
# Runs as root under tini. Every gpg, pass, socat and bridge process runs as
# uid 1000 (user bridge) through setpriv.
set -euo pipefail

export HOME=/data
export GNUPGHOME=/data/.gnupg
export PASSWORD_STORE_DIR=/data/.password-store
export XDG_CONFIG_HOME=/data/config
export XDG_DATA_HOME=/data/data
# Bridge's single-instance lock lives under the cache dir, so it must stay in
# the volume: a second Bridge on the same vault then fails on the lock.
export XDG_CACHE_HOME=/data/cache

readonly IMAP_PORT=1143
readonly CANARY=sift/canary
readonly INSECURE_VAULT=/data/config/protonmail/bridge-v3/insecure
readonly SETPRIV=(setpriv --reuid=1000 --regid=1000 --init-groups)
# Bridge writes its gRPC server config (port, cert, token, socket path) here.
readonly GRPC_CONFIG=/data/config/protonmail/bridge-v3/grpcServerConfig.json
# Bridge's single-instance lock (flock), shared through the volume.
readonly LOCK_FILE=/data/cache/protonmail/bridge-v3/bridge-v3.lock
# Mounted by bridge-init only (compose.yaml, D-79, D-81).
readonly ENV_FILE=/run/sift/.env.mailboxes
readonly ENV_BACKUP=/run/sift/.env.mailboxes.bak
readonly SIFT_CONFIG=/run/sift/config/config.yaml

usage() {
  echo "usage: entrypoint.sh [serve|keychain-init|init|configure|cli|repair]" >&2
}

# Run a command as the bridge user, in the foreground.
as_bridge() {
  "${SETPRIV[@]}" "$@"
}

refuse() {
  echo "$1" >&2
  exit 78
}

require_passphrase() {
  if [ -z "${SIFT_BRIDGE_KEYCHAIN_PASSPHRASE:-}" ]; then
    echo "SIFT_BRIDGE_KEYCHAIN_PASSPHRASE is not set; add it to .env" >&2
    exit 78
  fi
}

# The volume root belongs to the bridge user, also on a volume that was
# created empty outside Compose.
prepare_dirs() {
  chown 1000:1000 /data
  chmod 0700 /data
  as_bridge install -d -m 0700 "$GNUPGHOME" "$XDG_CONFIG_HOME" "$XDG_DATA_HOME" "$XDG_CACHE_HOME"
}

has_secret_key() {
  as_bridge gpg --batch --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec:'
}

key_fingerprint() {
  as_bridge gpg --batch --list-secret-keys --with-colons 2>/dev/null \
    | awk -F: '/^fpr:/ { print $10; exit }'
}

write_agent_conf() {
  printf 'allow-preset-passphrase\nmax-cache-ttl 34560000\ndefault-cache-ttl 34560000\n' \
    | as_bridge tee "$GNUPGHOME/gpg-agent.conf" >/dev/null
}

keychain_init() {
  prepare_dirs
  write_agent_conf
  if ! has_secret_key; then
    # The passphrase goes in on stdin (printf is a builtin), never as an argument.
    printf '%s' "$SIFT_BRIDGE_KEYCHAIN_PASSPHRASE" \
      | as_bridge gpg --batch --pinentry-mode loopback --passphrase-fd 0 \
        --quick-gen-key sift-bridge-vault rsa3072 encr never >/dev/null 2>&1 \
      || refuse "Could not create the Bridge keychain key"
  fi
  local fpr
  fpr=$(key_fingerprint)
  [ -n "$fpr" ] || refuse "Could not read the Bridge keychain key"
  if [ ! -f "$PASSWORD_STORE_DIR/.gpg-id" ]; then
    as_bridge pass init "$fpr" >/dev/null || refuse "Could not create the Bridge password store"
  fi
  if [ ! -f "$PASSWORD_STORE_DIR/$CANARY.gpg" ]; then
    printf 'sift keychain canary (not a secret)\n' \
      | as_bridge pass insert -m "$CANARY" >/dev/null \
      || refuse "Could not write the Bridge keychain canary"
  fi
}

keychain_unlock() {
  if [ ! -d "$GNUPGHOME" ] || ! has_secret_key; then
    echo "Bridge is not initialised: run docker compose run --rm bridge-init" >&2
    exit 78
  fi
  prepare_dirs
  write_agent_conf
  as_bridge gpg-connect-agent /bye >/dev/null 2>&1 || refuse "Could not start gpg-agent"
  local preset keygrip
  preset="$(as_bridge gpgconf --list-dirs libexecdir)/gpg-preset-passphrase"
  while IFS= read -r keygrip; do
    [ -n "$keygrip" ] || continue
    printf '%s' "$SIFT_BRIDGE_KEYCHAIN_PASSPHRASE" \
      | as_bridge "$preset" --preset "$keygrip" >/dev/null 2>&1 \
      || refuse "Bridge keychain locked: check SIFT_BRIDGE_KEYCHAIN_PASSPHRASE"
  done < <(as_bridge gpg --batch --list-secret-keys --with-keygrip --with-colons 2>/dev/null \
    | awk -F: '/^grp:/ { print $10 }')
  # pinentry-mode error: a wrong cached passphrase fails here instead of
  # waiting for a pinentry that has no terminal.
  if ! PASSWORD_STORE_GPG_OPTS=--pinentry-mode=error \
    timeout 30 "${SETPRIV[@]}" pass show sift/canary >/dev/null 2>&1; then
    echo "Bridge keychain locked: check SIFT_BRIDGE_KEYCHAIN_PASSPHRASE" >&2
    exit 78
  fi
  # Bridge falls back to an unencrypted vault when the keychain is unusable.
  if [ -e "$INSECURE_VAULT" ]; then
    echo "Insecure Bridge vault found; Sift refuses to run it. Remove the sift-bridge volume and run docker compose run --rm bridge-init again" >&2
    exit 78
  fi
  unset SIFT_BRIDGE_KEYCHAIN_PASSPHRASE
}

# SPKI fingerprint of a PEM certificate on stdin: base64 of sha256 over the
# DER SubjectPublicKeyInfo (the value of imap.tls.pin_sha256 in config.yaml).
spki_fingerprint() {
  openssl x509 -pubkey -noout \
    | openssl pkey -pubin -outform DER \
    | openssl dgst -sha256 -binary \
    | openssl base64 -A
}

# Print the SPKI fingerprint of the certificate Bridge presents over STARTTLS
# on 127.0.0.1, waiting up to 60 s for it. Writes no file (D-73).
bridge_fingerprint() {
  local i pem
  for ((i = 0; i < 60; i++)); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$IMAP_PORT") 2>/dev/null; then
      pem=$(openssl s_client -starttls imap -connect "127.0.0.1:$IMAP_PORT" </dev/null 2>/dev/null \
        | openssl x509 -outform PEM 2>/dev/null) || pem=''
      if [ -n "$pem" ]; then
        printf '%s\n' "$pem" | spki_fingerprint
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

readonly FINGERPRINT_UNAVAILABLE="Bridge certificate fingerprint unavailable: no STARTTLS answer on 127.0.0.1:$IMAP_PORT within 60 s"

# Log the fingerprint of the certificate Bridge presents (D-73).
print_fingerprint() {
  local fpr
  if fpr=$(bridge_fingerprint); then
    echo "Bridge certificate SHA-256 (public key): $fpr"
  else
    echo "$FINGERPRINT_UNAVAILABLE" >&2
  fi
}

# PIDs of the supervised children (socat is empty until it starts).
socat_pid=''
bridge_pid=''

stop_children() {
  local pids=()
  [ -z "$socat_pid" ] || pids+=("$socat_pid")
  [ -z "$bridge_pid" ] || pids+=("$bridge_pid")
  [ "${#pids[@]}" -gt 0 ] || return 0
  kill -TERM "${pids[@]}" 2>/dev/null || true
  wait "${pids[@]}" 2>/dev/null || true
}

serve() {
  require_passphrase
  keychain_unlock

  local ip i exited status=0
  ip=$(hostname -i | cut -d' ' -f1)
  [ -n "$ip" ] || { echo "Could not determine the container IP" >&2; exit 1; }

  trap 'stop_children; exit 0' TERM INT

  # Bridge first. On a new vault it picks its IMAP port with a free-port probe
  # that also tries the wildcard address, so a socat already listening on
  # <container IP>:1143 would push it to 1144.
  "${SETPRIV[@]}" bridge --noninteractive &
  bridge_pid=$!
  for ((i = 0; ; i++)); do
    if ! kill -0 "$bridge_pid" 2>/dev/null; then
      echo "Bridge exited before listening on 127.0.0.1:$IMAP_PORT" >&2
      exit 1
    fi
    (exec 3<>"/dev/tcp/127.0.0.1/$IMAP_PORT") 2>/dev/null && break
    if [ "$i" -ge 120 ]; then
      echo "Bridge is not listening on 127.0.0.1:$IMAP_PORT after 120 s; stopping it" >&2
      stop_children
      exit 1
    fi
    sleep 1
  done

  # Bridge listens on 127.0.0.1 only, and a wildcard listener cannot share the
  # port, so socat binds the container IP (the address the published port and
  # other containers reach).
  "${SETPRIV[@]}" socat "TCP-LISTEN:$IMAP_PORT,bind=$ip,fork,reuseaddr" "TCP:127.0.0.1:$IMAP_PORT" &
  socat_pid=$!
  print_fingerprint &

  wait -n -p exited "$socat_pid" "$bridge_pid" || status=$?
  if [ "${exited:-}" = "$socat_pid" ]; then
    echo "socat exited; stopping Bridge" >&2
  else
    echo "Bridge exited; stopping socat" >&2
  fi
  trap - TERM INT
  stop_children
  echo "Exit status of the first child: $status" >&2
  exit 1
}

# The env file exists only in the bridge-init service. A missing short-syntax
# bind source makes Docker create a directory on the host (Pitfall 4).
require_env_file() {
  if [ ! -e "$ENV_FILE" ] && [ ! -L "$ENV_FILE" ]; then
    echo "run this in the bridge-init service: docker compose run --rm bridge-init" >&2
    exit 2
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "create .env.mailboxes first: cp .env.mailboxes.example .env.mailboxes" >&2
    exit 2
  fi
}

# A Bridge holding the single-instance lock on this volume means the bridge
# service still runs; a second Bridge would fail on the lock anyway.
require_bridge_stopped() {
  if [ -e "$LOCK_FILE" ] && ! as_bridge flock -n "$LOCK_FILE" true 2>/dev/null; then
    echo "stop the bridge service first: docker compose stop bridge" >&2
    exit 1
  fi
}

# Start Bridge with its gRPC frontend in the background (sets bridge_pid) and
# wait up to 90 s for its server config. Bridge's own output goes to its log
# files in the volume, so the owner sees only Sift's fixed lines.
start_grpc_bridge() {
  local i
  as_bridge rm -f "$GRPC_CONFIG"
  trap 'stop_children; exit 130' TERM INT
  "${SETPRIV[@]}" bridge --grpc >/dev/null 2>&1 &
  bridge_pid=$!
  for ((i = 0; ; i++)); do
    [ -s "$GRPC_CONFIG" ] && return 0
    if ! kill -0 "$bridge_pid" 2>/dev/null; then
      echo "Bridge did not start its gRPC frontend: it exited first" >&2
      exit 1
    fi
    if [ "$i" -ge 90 ]; then
      echo "Bridge did not start its gRPC frontend within 90 s; stopping it" >&2
      stop_children
      exit 1
    fi
    sleep 1
  done
}

# After the helper's Quit, give Bridge 30 s to exit, then stop it.
wait_bridge_exit() {
  local i
  for ((i = 0; i < 30; i++)); do
    if ! kill -0 "$bridge_pid" 2>/dev/null; then
      wait "$bridge_pid" 2>/dev/null || true
      bridge_pid=''
      return 0
    fi
    sleep 1
  done
  echo "Bridge still running 30 s after Quit; stopping it" >&2
  stop_children
  bridge_pid=''
}

# The configure steps on an unlocked keychain: fingerprint to pin (D-73), then
# sift-helper as root so the bind-mounted env file keeps its host owner and
# mode (D-81). Exits with the helper's code.
run_configure() {
  local fpr status=0
  start_grpc_bridge
  if fpr=$(bridge_fingerprint); then
    echo "Bridge certificate SHA-256 (public key): $fpr"
    echo "Add it to config/config.yaml under the mailbox's imap.tls:   pin_sha256: $fpr"
  else
    echo "$FINGERPRINT_UNAVAILABLE" >&2
  fi
  sift-helper configure --config "$SIFT_CONFIG" --env-file "$ENV_FILE" --backup "$ENV_BACKUP" \
    || status=$?
  wait_bridge_exit
  exit "$status"
}

configure_mode() {
  require_passphrase
  require_env_file
  require_bridge_stopped
  keychain_unlock
  run_configure
}

# init and cli attach the owner's terminal to Bridge's own CLI.
require_tty() {
  if [ ! -t 0 ]; then
    if [ "$1" = init ]; then
      echo "init needs an interactive terminal: docker compose run --rm bridge-init" >&2
    else
      echo "$1 needs an interactive terminal: docker compose run --rm bridge-init $1" >&2
    fi
    exit 2
  fi
}

# Bridge's CLI as the bridge user, attached to the terminal. The keychain
# passphrase is already unset by keychain_unlock.
run_bridge_cli() {
  if ! as_bridge bridge --cli; then
    echo "Bridge CLI exited with an error" >&2
    exit 1
  fi
}

init_mode() {
  require_tty init
  require_passphrase
  require_env_file
  require_bridge_stopped
  keychain_init
  keychain_unlock
  echo "Bridge CLI: type login, then your Proton address, password and 2FA code (none of it is shown);"
  echo "when Bridge says the account was added, type exit (not info: it would show the IMAP password)."
  echo "Sift then writes the IMAP password into .env.mailboxes itself."
  run_bridge_cli
  run_configure
}

cli_mode() {
  require_tty cli
  require_passphrase
  require_bridge_stopped
  keychain_unlock
  run_bridge_cli
}

repair_mode() {
  local status=0
  require_passphrase
  require_bridge_stopped
  keychain_unlock
  start_grpc_bridge
  sift-helper repair || status=$?
  wait_bridge_exit
  exit "$status"
}

mode=${1:-serve}
case $mode in
  serve)
    serve
    ;;
  keychain-init)
    require_passphrase
    keychain_init
    keychain_unlock
    echo "Bridge keychain ready"
    ;;
  init)
    init_mode
    ;;
  configure)
    configure_mode
    ;;
  cli)
    cli_mode
    ;;
  repair)
    repair_mode
    ;;
  *)
    usage
    exit 64
    ;;
esac
