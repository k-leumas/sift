import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@sift/core/config';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

/**
 * D-69: until the mailbox hard-delete command exists, no owner-facing text and
 * no shipped source may name it. The word is assembled here so this file does
 * not match its own scan (test files are deliberately outside the scan).
 */
const DEFERRED_COMMAND = new RegExp(['pur', 'ge'].join(''), 'i');

/** Owner- and contributor-facing files that ship with the repository. */
const SCANNED_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'config/config.example.yaml',
  '.env.example',
  '.env.mailboxes.example',
  '.env.development.example',
  'compose.yaml',
  'Dockerfile',
  'bridge/Dockerfile',
  'bridge/entrypoint.sh',
];

/** Shipped source trees (tests live outside them). */
const SCANNED_DIRS = ['apps/worker/src', 'packages/core/src', 'packages/db/src'];

/** Every file under a directory, as repo-relative paths. */
function filesUnder(dir: string): string[] {
  return readdirSync(path.join(REPO_ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
}

/** Lines of `text` matching `pattern`, as "file:line: text" for a readable failure. */
function matches(file: string, text: string, pattern: RegExp): string[] {
  return text
    .split('\n')
    .flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
}

describe('D-69: the deferred mailbox hard-delete command is never named', () => {
  it('scans files that exist', () => {
    for (const file of SCANNED_FILES) {
      expect(existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
    }
    for (const dir of SCANNED_DIRS) {
      expect(filesUnder(dir).length, dir).toBeGreaterThan(0);
    }
  });

  it('is absent from owner-facing files', () => {
    const hits = SCANNED_FILES.flatMap((file) => matches(file, read(file), DEFERRED_COMMAND));
    expect(hits).toEqual([]);
  });

  it('is absent from shipped source under apps/worker/src and packages/*/src', () => {
    const files = SCANNED_DIRS.flatMap(filesUnder);
    expect(files).toContain(path.join('apps', 'worker', 'src', 'cli.ts'));
    const hits = files.flatMap((file) => matches(file, read(file), DEFERRED_COMMAND));
    expect(hits).toEqual([]);
  });
});

describe('README quick start (D-28, D-56, D-58)', () => {
  const readme = read('README.md');

  it.each([
    'cp config/config.example.yaml config/config.yaml',
    'cp .env.example .env',
    'cp .env.mailboxes.example .env.mailboxes',
    'docker compose up -d',
    'docker compose run --rm setup',
    'sudo chown 1000 backups',
    'docker compose logs worker',
    'version: 1',
    // Phase 2: Bridge setup, pinning and the owner's mailbox commands.
    'docker volume create sift-bridge',
    'docker compose run --rm bridge-init',
    'touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak',
    'cp .env.mailboxes.bak .env.mailboxes',
    // CR-02 (D-39): the IMAP password file is created owner-only.
    'cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes',
    'does not echo',
    'pin_sha256',
    'sift bridge trust <slug>',
    'sift mailbox resume <slug>',
    'sift mailbox backfill <slug> --days 3',
    'SIFT_BRIDGE_KEYCHAIN_PASSPHRASE',
    // D-37, D-10, D-73 and the scoped spike outcome (SPK-04).
    'Sift never stores your Proton password; Bridge stores session tokens in the sift-bridge volume',
    'FileVault',
    'LUKS',
    'imap.tls.pin_sha256',
    'Proton Bridge v3.27.0',
    '02-SPIKE-FINDINGS.md',
  ])('contains %s', (text) => {
    expect(readme).toContain(text);
  });

  it('copies the example files in the same order the compose smoke test creates them', () => {
    const steps = [
      'cp config/config.example.yaml config/config.yaml',
      'cp .env.example .env',
      'cp .env.mailboxes.example .env.mailboxes',
      'docker compose up -d',
    ].map((step) => readme.indexOf(step));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('creates the volume and the backup file before the first Bridge login, then starts (D-81)', () => {
    const quickStart = readme.slice(
      readme.indexOf('### Quick start'),
      readme.indexOf('### Managing mailboxes'),
    );
    const steps = [
      'cp config/config.example.yaml config/config.yaml',
      'cp .env.example .env',
      'cp .env.mailboxes.example .env.mailboxes',
      'docker volume create sift-bridge',
      'touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak',
      'docker compose run --rm bridge-init',
      'pin_sha256',
      'docker compose up -d',
    ].map((step) => quickStart.indexOf(step));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('no longer lists the Bridge login under later milestones', () => {
    const start = readme.indexOf('**Arriving in later milestones**');
    expect(start).toBeGreaterThanOrEqual(0);
    const later = readme.slice(start, readme.indexOf('### Managing mailboxes'));
    expect(later).not.toMatch(/bridge/i);
  });

  /** The first YAML block under "Technical settings". */
  function technicalSettingsYaml(): string {
    const section = readme.slice(readme.indexOf('### Technical settings'));
    const start = section.indexOf('```yaml') + '```yaml'.length;
    return section.slice(start, section.indexOf('```', start)).trimStart();
  }

  it('starts the technical-settings example with version: 1', () => {
    expect(technicalSettingsYaml().startsWith('version: 1\n')).toBe(true);
  });

  it('keeps the active technical-settings keys valid for the strict config schema', async () => {
    const active = technicalSettingsYaml()
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    // Later-milestone blocks stay in the README, but only as comments.
    expect(active).not.toMatch(/^(tiers|quick_confirm|relabel_sync):/m);
    expect(technicalSettingsYaml()).toMatch(/^# tiers:/m);
    const dir = mkdtempSync(path.join(tmpdir(), 'sift-readme-config-'));
    try {
      const file = path.join(dir, 'config.yaml');
      writeFileSync(file, active);
      const result = await loadConfig(file);
      expect(result.ok ? [] : result.issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no longer points at the old add-mailbox command or the root example config', () => {
    const oldAdd = new RegExp(['sift', 'mailbox', 'add'].join('\\s+'));
    expect(readme).not.toMatch(oldAdd);
    expect(readme).not.toMatch(/cp config\.example\.yaml/);
  });

  it('documents rename and list through the setup service, with no deletion step', () => {
    expect(readme).toContain('docker compose run --rm setup sift mailbox rename <old> <new>');
    expect(readme).toContain('docker compose run --rm setup sift mailbox list');
  });
});

describe('README scope and host requirements (G-02-8, G-02-9)', () => {
  const readme = read('README.md');
  const SCOPE = 'Sift supports only Proton Mail, through Proton Bridge, for now';

  /** The part of `readme` from `from` up to `to`; fails if either heading is missing. */
  function between(from: string, to: string): string {
    const start = readme.indexOf(from);
    const end = readme.indexOf(to, start);
    expect(start, from).toBeGreaterThanOrEqual(0);
    expect(end, to).toBeGreaterThan(start);
    return readme.slice(start, end);
  }

  it('states the Proton-only scope in the intro and in Requirements', () => {
    expect(readme.slice(0, readme.indexOf('## Why'))).toContain(SCOPE);
    expect(between('### Requirements', '### Mac mini vs mini PC')).toContain(SCOPE);
  });

  it('asks for an NTP-synced host clock in Requirements, with the macOS and Linux checks', () => {
    const requirements = between('### Requirements', '### Mac mini vs mini PC');
    expect(requirements).toContain('A host clock kept in sync over NTP');
    expect(requirements).toContain('timedatectl');
    expect(requirements).toContain('sntp time.apple.com');
  });

  // Wording that implied mail servers other than Proton Bridge (case-insensitive).
  it.each([
    'any IMAP client',
    'other IMAP servers',
    'non-Proton',
    'fastmail',
    'implicit',
    'public certificate authority',
    'For a Bridge mailbox',
    'for Proton,',
    'An IMAP account per mailbox',
  ])('no longer contains %s', (phrase) => {
    expect(readme.toLowerCase()).not.toContain(phrase.toLowerCase());
  });
});

describe('CONTRIBUTING development loop and gates (D-22, D-31, D-47)', () => {
  const contributing = read('CONTRIBUTING.md');

  it.each([
    'pnpm install',
    'cp .env.development.example .env.development',
    'cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes',
    'docker compose up -d db',
    'pnpm sift migrate && pnpm sift config apply',
    'pnpm dev',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
    'SIFT_TEST_ADMIN_URL',
    'SIFT_PG_DUMP=scripts/pg-dump-via-compose.sh',
    'packages/db/test/catalog.test.ts',
    'packages/db/test/isolation.test.ts',
    'pnpm db:generate',
    'withMailbox',
    // Phase 2: Bridge prerequisites, host development and the extra checks.
    'SIFT_BRIDGE_KEYCHAIN_PASSPHRASE',
    'docker volume create sift-bridge',
    'docker compose run --rm bridge-init',
    'docker compose up -d bridge',
    'SIFT_BRIDGE_PORT',
    'host: localhost',
    'imap.tls.pin_sha256',
    'sift bridge trust <slug>',
    'scripts/test-imap.sh up',
    'scripts/bridge-smoke.sh',
  ])('contains %s', (text) => {
    expect(contributing).toContain(text);
  });

  it('no longer claims the repository has no code or no linter', () => {
    const staleLinter = new RegExp(
      ['No', 'linter', 'or', 'formatter', 'is', 'configured'].join(' '),
    );
    expect(contributing).not.toMatch(staleLinter);
    expect(contributing).not.toMatch(/There is nothing to build or run yet/);
  });

  it('creates the Bridge volume right before starting the database', () => {
    expect(contributing).toContain('docker volume create sift-bridge\n   docker compose up -d db');
  });

  it('names commands that exist in package.json', () => {
    const scripts = Object.keys(
      (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
    );
    const named = [...contributing.matchAll(/`pnpm ([a-z][a-z:-]*)/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect(named).toContain('db:generate');
    // pnpm built-ins, plus `pnpm eval`, which CONTRIBUTING marks as planned (M4).
    const builtins = new Set(['install', 'vitest', 'eval']);
    expect(named.filter((name) => !builtins.has(name) && !scripts.includes(name))).toEqual([]);
  });
});

describe('Bridge command form and bind addresses (D-79)', () => {
  /**
   * The pre-D-79 init command (`bridge` and `init` as two words). Built from
   * parts so this file does not contain it.
   */
  const OLD_INIT = new RegExp(['run --rm bridge', 'init'].join(' '));
  /** The wildcard bind address, built from parts so this file does not contain it. */
  const WILDCARD_BIND = new RegExp(['0', '0', '0', '0'].join('\\.'));

  it.each(['README.md', 'CONTRIBUTING.md', 'bridge/entrypoint.sh', 'compose.yaml'])(
    '%s never shows the old init command form',
    (file) => {
      expect(matches(file, read(file), OLD_INIT)).toEqual([]);
    },
  );

  it.each(['README.md', 'CONTRIBUTING.md'])('%s never shows the wildcard bind address', (file) => {
    expect(matches(file, read(file), WILDCARD_BIND)).toEqual([]);
  });
});
