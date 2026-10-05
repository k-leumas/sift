import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

const DOCKERFILE = read('bridge/Dockerfile');
const ENTRYPOINT = read('bridge/entrypoint.sh');
const COMPOSE = read('compose.yaml');
const SMOKE = read('scripts/bridge-smoke.sh');

const RENOVATE_LINE = '# renovate: datasource=github-tags depName=ProtonMail/proton-bridge';

/**
 * The all-interfaces IPv4 address, assembled from parts so this file does not
 * contain the literal it forbids (cerebrum: negative greps scan everything).
 */
const WILDCARD = new RegExp(['0', '0', '0', '0'].join('\\.'));

describe('bridge/Dockerfile pins the Bridge release (D-30, D-31)', () => {
  const lines = DOCKERFILE.split('\n');

  it('has exactly one BRIDGE_VERSION pin on a v3 release tag', () => {
    const versions = [...DOCKERFILE.matchAll(/^ARG BRIDGE_VERSION=(\S+)\s*$/gm)].map((m) => m[1]);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatch(/^v3\.\d+\.\d+$/);
  });

  it('has exactly one BRIDGE_COMMIT pin of 40 lowercase hex', () => {
    const commits = [...DOCKERFILE.matchAll(/^ARG BRIDGE_COMMIT=(\S+)\s*$/gm)].map((m) => m[1]);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatch(/^[0-9a-f]{40}$/);
  });

  it('keeps the renovate comment, version and commit adjacent in that order', () => {
    const at = lines.indexOf(RENOVATE_LINE);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toMatch(/^ARG BRIDGE_VERSION=/);
    expect(lines[at + 2]).toMatch(/^ARG BRIDGE_COMMIT=/);
  });

  it('fails the build when the tag no longer points at the pinned commit', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell expansion, not JS
    expect(DOCKERFILE).toContain('test "$(git rev-parse HEAD)" = "${BRIDGE_COMMIT}"');
  });

  it('builds with the local Go toolchain only', () => {
    expect(DOCKERFILE).toMatch(/^ENV GOTOOLCHAIN=local$/m);
  });

  it('never ships the auto-updating launcher', () => {
    const copies = lines.filter((line) => line.startsWith('COPY'));
    expect(copies.length).toBeGreaterThan(0);
    for (const line of copies) expect(line).not.toMatch(/\/proton-bridge(\s|$)/);
  });

  it('starts the entrypoint under tini in serve mode', () => {
    expect(DOCKERFILE).toContain(
      'ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]',
    );
    expect(DOCKERFILE).toMatch(/^CMD \["serve"\]$/m);
  });
});

describe('bridge/entrypoint.sh fails closed (D-38, D-73)', () => {
  it.each([
    'pass show sift/canary',
    'exit 78',
    'bridge-v3/insecure',
    'setpriv',
    'bind=',
    'wait -n',
    'socat exited; stopping Bridge',
    'Bridge exited; stopping socat',
    'Bridge certificate SHA-256 (public key)',
    'unset SIFT_BRIDGE_KEYCHAIN_PASSPHRASE',
  ])('contains %s', (needle) => {
    expect(ENTRYPOINT).toContain(needle);
  });

  it('refuses with exit 78 in at least three places', () => {
    expect(ENTRYPOINT.match(/exit 78/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('never tries to exec the as_bridge shell function', () => {
    const execLines = ENTRYPOINT.split('\n').filter((line) => /^\s*exec as_bridge/.test(line));
    expect(execLines).toEqual([]);
  });

  it('never traces commands, so the passphrase cannot be echoed', () => {
    expect(ENTRYPOINT).not.toMatch(/set -[a-z]*x/);
  });
});

describe('sift-helper is built and tested inside the image (D-39)', () => {
  const lines = DOCKERFILE.split('\n');
  const at = (line: string) => lines.indexOf(line);

  it('copies the helper sources into the Bridge tree as cmd/sift-helper', () => {
    expect(at('COPY helper/*.go /src/cmd/sift-helper/')).toBeGreaterThan(0);
  });

  it('runs the helper Go tests before building it, after the Bridge build', () => {
    const bridgeBuild = lines.findIndex((line) => line.startsWith('RUN make build-nogui'));
    const test = at('RUN go test ./cmd/sift-helper/...');
    const build = at('RUN go build -o /src/sift-helper ./cmd/sift-helper');
    expect(bridgeBuild).toBeGreaterThan(0);
    expect(test).toBeGreaterThan(bridgeBuild);
    expect(build).toBeGreaterThan(test);
  });

  it('ships the helper as /usr/local/bin/sift-helper', () => {
    expect(at('COPY --from=build /src/sift-helper /usr/local/bin/sift-helper')).toBeGreaterThan(0);
  });
});

describe('bridge/entrypoint.sh one-shot modes (D-39, D-43, D-73, D-79)', () => {
  it.each(['configure', 'repair'])('has a %s case', (mode) => {
    expect(ENTRYPOINT).toMatch(new RegExp(`^  ${mode}\\)$`, 'm'));
  });

  it('prints the line the owner pastes into config.yaml', () => {
    expect(ENTRYPOINT).toContain("under the mailbox's imap.tls:   pin_sha256: $fpr");
  });

  it('runs sift-helper configure with the bridge-init mounts', () => {
    expect(ENTRYPOINT).toContain(
      'sift-helper configure --config "$SIFT_CONFIG" --env-file "$ENV_FILE" --backup "$ENV_BACKUP"',
    );
    expect(ENTRYPOINT).toContain('readonly ENV_FILE=/run/sift/.env.mailboxes');
    expect(ENTRYPOINT).toContain('readonly ENV_BACKUP=/run/sift/.env.mailboxes.bak');
  });

  it.each([
    'run this in the bridge-init service: docker compose run --rm bridge-init',
    'create .env.mailboxes first: cp .env.mailboxes.example .env.mailboxes',
    'stop the bridge service first: docker compose stop bridge',
    'Bridge did not start its gRPC frontend',
  ])('refuses with %s', (message) => {
    expect(ENTRYPOINT).toContain(message);
  });

  it('writes no certificate file and keeps nothing of Sift in the vault volume (D-73, D-79)', () => {
    expect(ENTRYPOINT).not.toContain('trusted.pem');
    expect(ENTRYPOINT).not.toContain('/data/sift');
  });
});

describe('bridge healthcheck probes the socat listener (D-32)', () => {
  it('targets the container IP, not Bridge loopback', () => {
    const compose = parse(COMPOSE) as {
      services: Record<string, { healthcheck?: { test?: string[] | string } }>;
    };
    const test = compose.services.bridge?.healthcheck?.test;
    const text = Array.isArray(test) ? test.join(' ') : String(test ?? '');
    expect(text).toContain('hostname -i');
    expect(text).not.toContain('127.0.0.1/1143');
  });
});

describe('Bridge is never published on all interfaces (T-02-03)', () => {
  it.each([
    ['bridge/Dockerfile', DOCKERFILE],
    ['bridge/entrypoint.sh', ENTRYPOINT],
    ['compose.yaml', COMPOSE],
    ['scripts/bridge-smoke.sh', SMOKE],
  ])('%s has no wildcard address', (_file, text) => {
    const hits = text.split('\n').filter((line) => WILDCARD.test(line));
    expect(hits).toEqual([]);
  });
});
