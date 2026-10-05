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
