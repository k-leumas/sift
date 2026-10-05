# syntax=docker/dockerfile:1
# Proton Mail Bridge, built from source at a pinned release, for the `bridge`
# and `bridge-init` Compose services (D-29, D-30).
#
# apps/worker/test/bridge-image.test.ts pins this file: the release tag and
# commit, the commit check, the toolchain lock, and that the auto-updating
# launcher is never shipped. Renovate bumps BRIDGE_VERSION and BRIDGE_COMMIT
# together (D-31); keep the three pin lines below adjacent and in this order.
ARG GO_VERSION=1.26.7
FROM golang:${GO_VERSION}-trixie AS build

# renovate: datasource=github-tags depName=ProtonMail/proton-bridge
ARG BRIDGE_VERSION=v3.27.0
ARG BRIDGE_COMMIT=04e46eb4fbc1c7ef4425a920bfc352050da0606b

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libfido2-dev libcbor-dev libsecret-1-dev libssl-dev pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# A tag can be moved; the commit check in the same step fails the build if it was.
RUN git clone --depth 1 --branch "${BRIDGE_VERSION}" \
    https://github.com/ProtonMail/proton-bridge.git . \
  && test "$(git rev-parse HEAD)" = "${BRIDGE_COMMIT}"

# Build with the toolchain of this image only; never download another Go.
ENV GOTOOLCHAIN=local
RUN make build-nogui BRIDGE_APP_VERSION="${BRIDGE_VERSION#v}"

# sift-helper (bridge/helper, D-39): copied into Bridge's own module so it can
# import the generated gRPC client under internal/frontend/grpc. Its Go tests
# run in every image build, so a Bridge bump that changes that API, or a broken
# env-file writer, fails here and never reaches an owner.
COPY helper/*.go /src/cmd/sift-helper/
RUN go test ./cmd/sift-helper/...
RUN go build -o /src/sift-helper ./cmd/sift-helper

FROM debian:trixie-20260918-slim

# pass + gnupg hold the vault key (D-38); socat exposes Bridge's loopback-only
# IMAP port on the container IP; openssl logs the certificate fingerprint;
# procps provides pkill for scripts/bridge-smoke.sh; tini reaps children.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates libfido2-1 libsecret-1-0 pass gnupg socat openssl procps tini \
  && rm -rf /var/lib/apt/lists/* \
  && command -v setpriv \
  && command -v hostname

# Only the bridge binary. The proton-bridge launcher that `make build-nogui`
# also builds is the self-update path, which D-30 disables: never copy it.
COPY --from=build /src/bridge /usr/local/bin/bridge
COPY --from=build /src/sift-helper /usr/local/bin/sift-helper

RUN useradd -m -u 1000 bridge \
  && install -d -o bridge -g bridge -m 0700 /data /run/user/1000 \
  && install -d -m 0755 /run/sift

COPY --chmod=0755 entrypoint.sh /usr/local/bin/entrypoint.sh

EXPOSE 1143

# No USER line on purpose: the entrypoint starts as root under tini and runs
# every gpg, pass, socat and bridge process as uid 1000 (user bridge) through
# setpriv. Root is kept only so bridge-init can rewrite the bind-mounted
# .env.mailboxes in place with its host owner and mode intact.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["serve"]
