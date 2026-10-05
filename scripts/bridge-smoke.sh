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
#   - exits 78 with a wrong passphrase and on a never-initialised volume (D-38).
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

cleanup() {
  if [ "${#containers[@]}" -gt 0 ]; then
    docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
  fi
  docker volume rm -f "$volume" "$empty_volume" >/dev/null 2>&1 || true
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

# Run a one-shot container on a volume and wait up to 90 s for it to exit.
# Sets run_out (its combined log) and run_code (its exit code). The passphrase
# goes in through the environment, never argv.
run_mode() {
  local vol=$1 passphrase=$2 mode=$3 name
  name=sift-bridge-smoke-run-$(openssl rand -hex 4)
  containers+=("$name")
  SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=$passphrase docker run -d --name "$name" \
    -e SIFT_BRIDGE_KEYCHAIN_PASSPHRASE -v "$vol:/data" "$image" "$mode" >/dev/null
  for _ in $(seq 1 90); do
    [ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || break
    sleep 1
  done
  [ "$(docker inspect -f '{{.State.Running}}' "$name")" = false ] \
    || fail "$mode still running after 90 s"
  run_code=$(docker inspect -f '{{.State.ExitCode}}' "$name")
  run_out=$(docker logs "$name" 2>&1)
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
  if docker logs "$serve_name" 2>&1 | grep -qF "$line"; then
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
docker logs "$serve_name" 2>&1 | grep -qF 'socat exited; stopping Bridge' \
  || fail "log lacks 'socat exited; stopping Bridge'"
echo "bridge-smoke: socat death stopped the container (exit $code)"

# Wrong passphrase on the initialised volume.
run_mode "$volume" "$(openssl rand -hex 24)" serve
[ "$run_code" = 78 ] || fail "serve with a wrong passphrase exited $run_code, expected 78: $run_out"
case $run_out in
  *"Bridge keychain locked"*) ;;
  *) fail "wrong passphrase output lacks 'Bridge keychain locked': $run_out" ;;
esac
echo "bridge-smoke: wrong passphrase refused (exit 78)"

# Never-initialised volume.
run_mode "$empty_volume" "$passphrase" serve
[ "$run_code" = 78 ] || fail "serve on an empty volume exited $run_code, expected 78: $run_out"
case $run_out in
  *"not initialised"*) ;;
  *) fail "empty volume output lacks 'not initialised': $run_out" ;;
esac
echo "bridge-smoke: uninitialised volume refused (exit 78)"

echo "bridge smoke OK"
