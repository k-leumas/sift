import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);

/** Body of a shell function `name() { ... }` in the entrypoint. */
function shellFunction(name: string): string {
  const start = ENTRYPOINT.indexOf(`\n${name}() {\n`);
  expect(start, `${name}() in bridge/entrypoint.sh`).toBeGreaterThanOrEqual(0);
  const end = ENTRYPOINT.indexOf('\n}\n', start + 1);
  return ENTRYPOINT.slice(start, end);
}

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
  it.each(['init', 'configure', 'cli', 'repair'])('has a %s case', (mode) => {
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

  it.each(['init_mode', 'cli_mode'])('%s refuses without a TTY before anything else', (fn) => {
    const body = shellFunction(fn);
    const firstStep = body.split('\n').find((line) => /^\s+\S/.test(line));
    expect(firstStep?.trim()).toMatch(/^require_tty (init|cli)$/);
  });

  it('checks the terminal with [ -t 0 ] and exits 2', () => {
    const body = shellFunction('require_tty');
    expect(body).toContain('[ ! -t 0 ]');
    expect(body).toContain('exit 2');
  });

  it("names the owner's command in init's refusal", () => {
    expect(ENTRYPOINT).toContain(
      'init needs an interactive terminal: docker compose run --rm bridge-init',
    );
  });

  it("init logs in through Bridge's own CLI, then configures", () => {
    const body = shellFunction('init_mode');
    expect(body.indexOf('keychain_init')).toBeGreaterThan(0);
    expect(body.indexOf('run_bridge_cli')).toBeGreaterThan(body.indexOf('keychain_unlock'));
    expect(body.indexOf('run_configure')).toBeGreaterThan(body.indexOf('run_bridge_cli'));
    expect(shellFunction('run_bridge_cli')).toContain('as_bridge bridge --cli');
  });

  it('writes no certificate file and keeps nothing of Sift in the vault volume (D-73, D-79)', () => {
    expect(ENTRYPOINT).not.toContain('trusted.pem');
    expect(ENTRYPOINT).not.toContain('/data/sift');
  });
});

describe('sift-helper writes the bind-mounted files in place only (D-81)', () => {
  const helperDir = path.join(REPO_ROOT, 'bridge/helper');
  const sources = readdirSync(helperDir).filter(
    (file) => file.endsWith('.go') && !file.endsWith('_test.go'),
  );

  it('has the helper sources', () => {
    expect(sources).toEqual(expect.arrayContaining(['envfile.go', 'main.go']));
  });

  it.each(sources)('%s has no rename, no temp file and no create flag', (file) => {
    const text = readFileSync(path.join(helperDir, file), 'utf8');
    expect(text).not.toMatch(/\bRename\b|renameat|CreateTemp|TempFile|O_CREATE|os\.Create\b/);
  });

  it.each(sources)('%s never exports the TLS key or writes certificate files (D-73)', (file) => {
    const text = readFileSync(path.join(helperDir, file), 'utf8');
    expect(text).not.toContain('ExportTLSCertificates');
    expect(text).not.toContain('trusted.pem');
    expect(text).not.toContain('/data/sift');
  });

  it('git ignores the host-side backup at the repository root (T-02-61)', async () => {
    // -v prints the deciding pattern; a negated (!) match also exits 0.
    const { stdout } = await execFileAsync(
      'git',
      ['check-ignore', '-v', '--no-index', '.env.mailboxes.bak'],
      { cwd: REPO_ROOT },
    );
    const pattern = stdout.split('\t')[0]?.split(':')[2] ?? '';
    expect(pattern).not.toBe('');
    expect(pattern.startsWith('!')).toBe(false);
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

/** A repository file, or null when it does not exist yet. */
function readIfPresent(file: string): string | null {
  return existsSync(path.join(REPO_ROOT, file)) ? read(file) : null;
}

interface RenovateRule {
  matchDepNames?: string[];
  ignoreUnstable?: boolean;
  prBodyNotes?: string[];
}

interface RenovateConfig {
  enabledManagers?: string[];
  customManagers?: {
    customType?: string;
    managerFilePatterns?: string[];
    matchStrings?: string[];
  }[];
  packageRules?: RenovateRule[];
}

function renovateConfig(): RenovateConfig {
  const text = readIfPresent('renovate.json');
  expect(text, 'renovate.json exists').not.toBeNull();
  return JSON.parse(text ?? '{}') as RenovateConfig;
}

/** The one ARG value of `name` in bridge/Dockerfile. */
function dockerfileArg(name: string): string {
  const values = [...DOCKERFILE.matchAll(new RegExp(`^ARG ${name}=(\\S+)\\s*$`, 'gm'))];
  expect(values).toHaveLength(1);
  return values[0]?.[1] ?? '';
}

describe('Renovate bumps the Bridge tag and commit together (D-31, T-02-SC)', () => {
  it('enables only the custom regex manager, so it opens no other PRs (T-02-52)', () => {
    const config = renovateConfig();
    expect(config.enabledManagers).toEqual(['custom.regex']);
    expect(config.customManagers).toHaveLength(1);
    expect(config.customManagers?.[0]?.customType).toBe('regex');
    expect(config.customManagers?.[0]?.managerFilePatterns).toEqual(['/^bridge/Dockerfile$/']);
  });

  it('matches the pin block in bridge/Dockerfile once and captures every field', () => {
    const matchStrings = renovateConfig().customManagers?.[0]?.matchStrings ?? [];
    expect(matchStrings).toHaveLength(1);
    // Renovate's named groups use the JavaScript syntax.
    const matches = [...DOCKERFILE.matchAll(new RegExp(matchStrings[0] ?? '(?!)', 'g'))];
    expect(matches).toHaveLength(1);
    expect(matches[0]?.groups).toEqual({
      datasource: 'github-tags',
      depName: 'ProtonMail/proton-bridge',
      currentValue: dockerfileArg('BRIDGE_VERSION'),
      currentDigest: dockerfileArg('BRIDGE_COMMIT'),
    });
  });

  it('skips unstable releases and tells every Bridge PR that the commit must move too', () => {
    const rules = (renovateConfig().packageRules ?? []).filter((rule) =>
      rule.matchDepNames?.includes('ProtonMail/proton-bridge'),
    );
    expect(rules).toHaveLength(1);
    expect(rules[0]?.ignoreUnstable).toBe(true);
    const notes = rules[0]?.prBodyNotes ?? [];
    expect(
      notes.some((note) => note.includes('BRIDGE_COMMIT') && note.includes('BRIDGE_VERSION')),
    ).toBe(true);
  });
});

interface WorkflowStep {
  uses?: string;
  run?: string;
}

interface BridgeWorkflow {
  on?: {
    push?: { branches?: string[]; paths?: string[] };
    pull_request?: { paths?: string[] };
  };
  permissions?: Record<string, string>;
  concurrency?: { group?: string };
  jobs?: Record<string, { 'runs-on'?: string; 'timeout-minutes'?: number; steps?: WorkflowStep[] }>;
}

const BRIDGE_WORKFLOW_FILE = '.github/workflows/bridge-image.yml';

function bridgeWorkflowText(): string {
  const text = readIfPresent(BRIDGE_WORKFLOW_FILE);
  expect(text, `${BRIDGE_WORKFLOW_FILE} exists`).not.toBeNull();
  return text ?? '';
}

function bridgeWorkflow(): BridgeWorkflow {
  return (parse(bridgeWorkflowText()) ?? {}) as BridgeWorkflow;
}

describe('CI builds and smoke-tests every Bridge image change (D-31)', () => {
  const PATHS = ['bridge/**', 'scripts/bridge-smoke.sh', BRIDGE_WORKFLOW_FILE];

  it('runs on pull requests and pushes to main that touch bridge/ or its smoke test', () => {
    const on = bridgeWorkflow().on;
    expect(on?.pull_request?.paths).toEqual(PATHS);
    expect(on?.push?.branches).toEqual(['main']);
    expect(on?.push?.paths).toEqual(PATHS);
  });

  it('reads the repository only and cancels superseded runs per ref', () => {
    const workflow = bridgeWorkflow();
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.concurrency?.group).toContain('github.ref');
  });

  it('has one job with a 45-minute timeout for a cold Go module cache', () => {
    const jobs = Object.values(bridgeWorkflow().jobs ?? {});
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.['runs-on']).toBe('ubuntu-24.04');
    expect(jobs[0]?.['timeout-minutes']).toBe(45);
  });

  it('checks out with the SHA-pinned action ci.yml uses, then runs the smoke script', () => {
    const steps = Object.values(bridgeWorkflow().jobs ?? {})[0]?.steps ?? [];
    expect(steps.map((step) => step.uses ?? step.run?.trim())).toEqual([
      expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
      'scripts/bridge-smoke.sh',
    ]);
    const usesLine = (text: string) =>
      text
        .split('\n')
        .find((line) => /^\s*-?\s*uses: actions\/checkout@/.test(line))
        ?.trim();
    const line = usesLine(bridgeWorkflowText());
    expect(line).toMatch(/uses: actions\/checkout@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    expect(line).toBe(usesLine(read('.github/workflows/ci.yml')));
  });
});
