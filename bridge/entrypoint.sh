#!/bin/bash
# Entrypoint of the Sift Proton Bridge image (bridge/Dockerfile).
#
# Modes (first argument, default serve):
#   serve          unlock the keychain (fail closed), then run socat and Bridge
#                  side by side and stop both when either one exits
#   keychain-init  create the GPG key, pass store and canary when absent, then
#                  unlock and verify them
#
# Exit codes: 0 ok, 1 a supervised child exited, 64 unknown mode, 78 keychain
# or vault refusal. Messages are fixed text and never contain the passphrase.
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

usage() {
  echo "usage: entrypoint.sh [serve|keychain-init]" >&2
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

# Log the fingerprint of the certificate Bridge presents (D-73). Writes no file.
print_fingerprint() {
  local i pem fpr
  for ((i = 0; i < 60; i++)); do
    if (exec 3<>"/dev/tcp/127.0.0.1/$IMAP_PORT") 2>/dev/null; then
      pem=$(openssl s_client -starttls imap -connect "127.0.0.1:$IMAP_PORT" </dev/null 2>/dev/null \
        | openssl x509 -outform PEM 2>/dev/null) || pem=''
      if [ -n "$pem" ]; then
        fpr=$(printf '%s\n' "$pem" | spki_fingerprint)
        echo "Bridge certificate SHA-256 (public key): $fpr"
        return 0
      fi
    fi
    sleep 1
  done
  echo "Bridge certificate fingerprint unavailable: no STARTTLS answer on 127.0.0.1:$IMAP_PORT within 60 s" >&2
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
  *)
    usage
    exit 64
    ;;
esac
