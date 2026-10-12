import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { releaseNotes } from '../scripts/release-notes.ts';
import { REPO_ROOT } from './support/release-repo.ts';

const CHANGELOG = [
  '# Changelog',
  '',
  'Intro.',
  '',
  '## v0.2.0 (2026-10-12)',
  '',
  '### Highlights',
  '',
  'New things.',
  '',
  '## v0.1.0 (2026-10-11)',
  '',
  '### Fixes',
  '',
  '- a (aaaaaaa)',
  '',
].join('\n');

function run(dir: string, ...args: string[]) {
  return spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/release-notes.ts'), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
}

describe('releaseNotes', () => {
  it('returns the section body without its heading, up to the next version', () => {
    expect(releaseNotes(CHANGELOG, 'v0.2.0')).toBe('### Highlights\n\nNew things.');
    expect(releaseNotes(CHANGELOG, 'v0.1.0')).toBe('### Fixes\n\n- a (aaaaaaa)');
  });

  it('gives null for a version with no section, and never matches a longer tag', () => {
    expect(releaseNotes(CHANGELOG, 'v0.3.0')).toBeNull();
    expect(releaseNotes('## v0.1.10 (2026-10-11)\n\nx\n', 'v0.1.1')).toBeNull();
  });
});

describe('node scripts/release-notes.ts', () => {
  it('prints the notes, refuses a missing section, and rejects bad arguments', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sift-notes-'));
    writeFileSync(path.join(dir, 'CHANGELOG.md'), CHANGELOG);

    const ok = run(dir, 'v0.1.0');
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe('### Fixes\n\n- a (aaaaaaa)\n');

    const missing = run(dir, 'v9.9.9');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('no "## v9.9.9" section');

    expect(run(dir).status).toBe(2);
    expect(run(dir, 'main').status).toBe(2);
  });
});
