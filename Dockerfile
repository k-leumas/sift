# Sift image, used by both the `setup` and `worker` Compose services.
#
# NODE_VERSION must equal .nvmrc without the leading "v"
# (apps/worker/test/node-version.test.ts fails on drift).
ARG NODE_VERSION=26.10.0
FROM node:${NODE_VERSION}-trixie-slim

# pg_dump must match the server major (18); Debian trixie ships client 17 only,
# so take postgresql-client-18 from the official PGDG apt repository.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg postgresql-common \
  && /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y \
  && apt-get install -y --no-install-recommends postgresql-client-18 \
  && rm -rf /var/lib/apt/lists/*

# Node 26 ships without corepack: install a pinned corepack, which provides the
# pnpm version pinned by package.json "packageManager".
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN npm install -g corepack@0.36.0 && corepack enable pnpm

WORKDIR /app

# Dependencies first, so source edits do not invalidate the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile --prod

# The workspace is copied as-is: workspace packages stay symlinked from
# node_modules, so their .ts sources run through Node type stripping.
COPY tsconfig.base.json ./
COPY apps/worker/src apps/worker/src
COPY packages/core/src packages/core/src
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations

RUN printf '#!/bin/sh\nexec node /app/apps/worker/src/cli.ts "$@"\n' > /usr/local/bin/sift \
  && chmod 0755 /usr/local/bin/sift

USER node
CMD ["sift", "--help"]
