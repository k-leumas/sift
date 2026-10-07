#!/usr/bin/env bash
# Bridge image smoke test: build bridge/Dockerfile, then on throwaway volumes
# check that the image
#   - creates and unlocks its keychain (keychain-init),
#   - serves STARTTLS through a port published on host loopback, via socat on
#     the container IP,
#   - logs the SPKI fingerprint of the certificate it presents (D-73), equal
#     to the one openssl computes from that port,
#   - passes its own Compose healthcheck command,
#   - stops with a non-zero exit when socat dies (supervised children),
#   - refuses configure and repair while a Bridge holds the volume's lock,
#   - configure: telemetry and automatic updates off, no account (exit 3), the
#     pin_sha256 line equal to the served fingerprint, env file untouched,
#   - repair: triggers Bridge's repair over gRPC without a TTY,
#   - refuses configure without the env file mount, with a directory there,
#     and init and cli without a terminal (exit 2),
#   - never prints a value of the mounted env file (sentinel),
#   - exits 78 with a wrong passphrase, with an insecure (unencrypted) vault
#     file on an initialised volume, and on a never-initialised volume (D-38).
#
# Run from the repository root:  scripts/bridge-smoke.sh
# Env: BRIDGE_SMOKE_PORT (host port, default 11143), SIFT_BRIDGE_IMAGE
# (default sift-bridge:local).
#
# It never touches the sift-bridge volume or your .env: every volume and
# passphrase here is random and removed at exit.
set -euo pipefail

port=${BRIDGE_SMOKE_PORT:-11143}
image=${SIFT_BRIDGE_IMAGE:-sift-bridge:local}
suffix=$(openssl rand -hex 4)
volume=sift-bridge-smoke-$suffix
empty_volume=sift-bridge-smoke-empty-$suffix
serve_name=sift-bridge-smoke-serve-$suffix
containers=()
# Host files bind-mounted into configure runs (neutral names; removed at exit).
work=$(mktemp -d "${TMPDIR:-/tmp}/sift-bridge-smoke.XXXXXX")

cleanup() {
  if [ "${#containers[@]}" -gt 0 ]; then
    docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  fi
  docker volume rm -f "$volume" "$empty_volume" >/dev/null 2>&1 || true
  command rm -rf "$work"
}
trap cleanup EXIT

fail() {
  echo "bridge-smoke: FAILED: $*" >&2
  exit 1
}

# SPKI fingerprint of a PEM certificate on stdin (same pipeline as the entrypoint).
spki_fingerprint() {
  openssl x509 -pubkey -noout \
    | openssl pkey -pubin -outform DER \
    | openssl dgst -sha256 -binary \
    | openssl base64 -A
}

# Run a one-shot container on a volume and wait up to 180 s for it to exit.
# Extra arguments go to docker run before the image (mounts). Sets run_out
# (its combined log) and run_code (its exit code). The passphrase goes in
# through the environment, never argv.
run_mode() {
  local vol=$1 passphrase=$2 mode=$3 name
  shift 3
  name=sift-bridge-smoke-run-$(openssl rand -hex 4)
  containers+=("$name")
  SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=$passphrase docker run -d --name "$name" \
    -e SIFT_BRIDGE_KEYCHAIN_PASSPHRASE -v "$vol:/data" "$@" "$image" "$mode" >/dev/null
  for _ in $(seq 1 180); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || break
    sleep 1
  done
  [ "$(docker inspect -f '{{.State.Running}}' "$name")" = false ] \
    || fail "$mode still running after 180 s"
  run_code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
  run_out=$(docker logs "$name" 2>&1)
}

# Fail unless run_out contains every given string.
expect_out() {
  local what=$1 needle
  shift
  for needle in "$@"; do
    case $run_out in
      *"$needle"*) ;;
      *) fail "$what output lacks '$needle': $run_out" ;;
    esac
  done
}

echo "bridge-smoke: building $image"
docker build -t "$image" bridge

docker volume create "$volume" >/dev/null
docker volume create "$empty_volume" >/dev/null
passphrase=$(openssl rand -hex 24)

echo "bridge-smoke: keychain-init"
run_mode "$volume" "$passphrase" keychain-init
[ "$run_code" = 0 ] || fail "keychain-init exited $run_code: $run_out"
case $run_out in
  *"Bridge keychain ready"*) ;;
  *) fail "keychain-init did not print 'Bridge keychain ready': $run_out" ;;
esac

echo "bridge-smoke: serve on 127.0.0.1:$port"
containers+=("$serve_name")
SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=$passphrase docker run -d --name "$serve_name" \
  -e SIFT_BRIDGE_KEYCHAIN_PASSPHRASE -v "$volume:/data" \
  -p "127.0.0.1:$port:1143" "$image" serve >/dev/null

pem=''
for _ in $(seq 1 120); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$serve_name")" != true ]; then
    docker logs "$serve_name" >&2 || true
    fail "serve container stopped before answering STARTTLS"
  fi
  answer=$(openssl s_client -starttls imap -connect "127.0.0.1:$port" </dev/null 2>/dev/null || true)
  case $answer in
    *"BEGIN CERTIFICATE"*)
      pem=$(printf '%s\n' "$answer" | openssl x509 -outform PEM)
      break
      ;;
  esac
  sleep 1
done
[ -n "$pem" ] || fail "no certificate via STARTTLS on 127.0.0.1:$port within 120 s"
echo "bridge-smoke: STARTTLS answered on 127.0.0.1:$port"

expected=$(printf '%s\n' "$pem" | spki_fingerprint)
line="Bridge certificate SHA-256 (public key): $expected"
logged=false
for _ in $(seq 1 30); do
  # Capture first: under pipefail, `docker logs | grep -q` fails whenever grep
  # exits before docker logs has written its last line (EPIPE).
  serve_log=$(docker logs "$serve_name" 2>&1)
  if [[ $serve_log == *"$line"* ]]; then
    logged=true
    break
  fi
  sleep 1
done
[ "$logged" = true ] || fail "container log lacks '$line'"
echo "bridge-smoke: logged fingerprint matches $expected"

# The Compose healthcheck command, run inside the serving container.
docker exec "$serve_name" bash -c 'exec 3<>/dev/tcp/$(hostname -i | cut -d" " -f1)/1143' \
  || fail "healthcheck command failed inside the serve container"
echo "bridge-smoke: healthcheck command passes"

# A one-shot mode on the volume of a running Bridge fails on the lock.
run_mode "$volume" "$passphrase" repair
[ "$run_code" = 1 ] || fail "repair beside a running Bridge exited $run_code, expected 1: $run_out"
expect_out "repair beside a running Bridge" "stop the bridge service first: docker compose stop bridge"
echo "bridge-smoke: repair refused while the serve container holds the lock (exit 1)"

# Supervised children: killing socat must stop the whole container, non-zero.
docker exec "$serve_name" pkill -x socat || fail "could not kill socat"
stopped=false
for _ in $(seq 1 15); do
  if [ "$(docker inspect -f '{{.State.Running}}' "$serve_name")" = false ]; then
    stopped=true
    break
  fi
  sleep 1
done
[ "$stopped" = true ] || fail "container still running 15 s after socat was killed"
code=$(docker inspect -f '{{.State.ExitCode}}' "$serve_name")
[ "$code" != 0 ] || fail "container exited 0 after socat was killed"
serve_log=$(docker logs "$serve_name" 2>&1)
[[ $serve_log == *'socat exited; stopping Bridge'* ]] \
  || fail "log lacks 'socat exited; stopping Bridge': $serve_log"
echo "bridge-smoke: socat death stopped the container (exit $code)"

# configure on the keychain-initialised volume, no Proton login: telemetry
# and automatic updates off, the pin line equal to the served fingerprint,
# exit 3, and the env file left exactly as it was.
mkdir -p "$work/config"
cat >"$work/config/config.yaml" <<'YAML'
mailboxes:
  - slug: smoke
    imap:
      host: bridge
      port: 1143
      username: smoke@example.test
      password_env: SIFT_SMOKE_IMAP_PASSWORD
YAML
# The sentinel stands in for a secret already in the file: configure must
# never print it.
sentinel=sift-smoke-sentinel-$(openssl rand -hex 8)
env_content="KEEP=1
SIFT_SMOKE_SENTINEL=$sentinel"
printf '%s\n' "$env_content" >"$work/env-mailboxes"
: >"$work/env-mailboxes-bak"
chmod 600 "$work/env-mailboxes" "$work/env-mailboxes-bak"
configure_mounts=(
  -v "$work/config:/run/sift/config:ro"
  -v "$work/env-mailboxes:/run/sift/.env.mailboxes"
  -v "$work/env-mailboxes-bak:/run/sift/.env.mailboxes.bak"
)

echo "bridge-smoke: configure (no account)"
run_mode "$volume" "$passphrase" configure "${configure_mounts[@]}"
[ "$run_code" = 3 ] || fail "configure without an account exited $run_code, expected 3: $run_out"
expect_out configure "telemetry: off" "automatic updates: off" "accounts: 0" \
  "no Bridge account is logged in" "pin_sha256: $expected"
[ "$(cat "$work/env-mailboxes")" = "$env_content" ] || fail "configure changed the env file"
case $run_out in
  *"$sentinel"*) fail "configure output contains a value from the env file" ;;
esac
echo "bridge-smoke: configure turned telemetry and updates off, printed the pin (exit 3)"

echo "bridge-smoke: configure and init refusals"
run_mode "$volume" "$passphrase" configure -v "$work/config:/run/sift/config:ro"
[ "$run_code" = 2 ] || fail "configure without the env file mount exited $run_code, expected 2: $run_out"
expect_out "configure without the env file mount" \
  "run this in the bridge-init service: docker compose run --rm bridge-init"

mkdir -p "$work/env-dir"
run_mode "$volume" "$passphrase" configure -v "$work/config:/run/sift/config:ro" \
  -v "$work/env-dir:/run/sift/.env.mailboxes"
[ "$run_code" = 2 ] || fail "configure with a directory as env file exited $run_code, expected 2: $run_out"
expect_out "configure with a directory as env file" \
  "create .env.mailboxes first: cp .env.mailboxes.example .env.mailboxes"

# run_mode never allocates a TTY (docker run without -t).
run_mode "$volume" "$passphrase" init "${configure_mounts[@]}"
[ "$run_code" = 2 ] || fail "init without a TTY exited $run_code, expected 2: $run_out"
expect_out "init without a TTY" "init needs an interactive terminal: docker compose run --rm bridge-init"

run_mode "$volume" "$passphrase" cli "${configure_mounts[@]}"
[ "$run_code" = 2 ] || fail "cli without a TTY exited $run_code, expected 2: $run_out"
expect_out "cli without a TTY" "cli needs an interactive terminal: docker compose run --rm bridge-init cli"
[ "$(cat "$work/env-mailboxes")" = "$env_content" ] || fail "a refused mode changed the env file"
echo "bridge-smoke: missing or directory env file and no-TTY init and cli refused (exit 2)"

echo "bridge-smoke: repair"
run_mode "$volume" "$passphrase" repair
[ "$run_code" = 0 ] || fail "repair exited $run_code, expected 0: $run_out"
expect_out repair "repair triggered"
echo "bridge-smoke: repair triggered over gRPC (exit 0)"

# Wrong passphrase on the initialised volume.
run_mode "$volume" "$(openssl rand -hex 24)" serve
[ "$run_code" = 78 ] || fail "serve with a wrong passphrase exited $run_code, expected 78: $run_out"
case $run_out in
  *"Bridge keychain locked"*) ;;
  *) fail "wrong passphrase output lacks 'Bridge keychain locked': $run_out" ;;
esac
echo "bridge-smoke: wrong passphrase refused (exit 78)"

# Bridge writes bridge-v3/insecure when it falls back to an unencrypted vault.
# Plant one on the initialised volume: serve must refuse even with the right
# passphrase. Runs last on this volume, since it leaves the vault unusable.
docker run --rm --user 1000:1000 --entrypoint sh -v "$volume:/data" "$image" \
  -c 'mkdir -p /data/config/protonmail/bridge-v3 && : >/data/config/protonmail/bridge-v3/insecure' \
  || fail "could not plant the insecure vault file"
run_mode "$volume" "$passphrase" serve
[ "$run_code" = 78 ] || fail "serve with an insecure vault exited $run_code, expected 78: $run_out"
expect_out "insecure vault" "Insecure Bridge vault found; Sift refuses to run it"
echo "bridge-smoke: insecure vault refused (exit 78)"

# Never-initialised volume.
run_mode "$empty_volume" "$passphrase" serve
[ "$run_code" = 78 ] || fail "serve on an empty volume exited $run_code, expected 78: $run_out"
case $run_out in
  *"not initialised"*) ;;
  *) fail "empty volume output lacks 'not initialised': $run_out" ;;
esac
echo "bridge-smoke: uninitialised volume refused (exit 78)"

echo "bridge smoke OK"
