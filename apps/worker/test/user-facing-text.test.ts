import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
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
    'version: 1',
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

  it('starts the technical-settings example with version: 1', () => {
    const section = readme.slice(readme.indexOf('### Technical settings'));
    const firstYaml = section.slice(section.indexOf('```yaml') + '```yaml'.length).trimStart();
    expect(firstYaml.startsWith('version: 1\n')).toBe(true);
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
