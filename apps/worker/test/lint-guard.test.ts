import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const BIOME = path.join(REPO_ROOT, 'node_modules', '.bin', 'biome');

let work: string;

/** Lint one file at apps/worker/src/<name> with the repository's biome.json. */
function lintAppSource(name: string, source: string): { status: number | null; output: string } {
  const file = path.join(work, 'apps', 'worker', 'src', name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, source);
  const result = spawnSync(BIOME, ['lint', '--colors=off', path.relative(work, file)], {
    cwd: work,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// biome.json has vcs.useIgnoreFile, so the scratch copy needs a git repo.
beforeAll(() => {
  work = mkdtempSync(path.join(tmpdir(), 'sift-lint-guard-'));
  cpSync(path.join(REPO_ROOT, 'biome.json'), path.join(work, 'biome.json'));
  writeFileSync(path.join(work, '.gitignore'), 'node_modules\n');
  spawnSync('git', ['init', '-q'], { cwd: work });
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('ISO-04 import guard on apps/**/src (IN-02)', () => {
  it.each([
    ['a relative import of packages/db internals', '../../../packages/db/src/app-db.ts'],
    ['a deep import of a workspace package src file', '@sift/db/src/app-db.ts'],
  ])('rejects %s', (_label, specifier) => {
    const { status, output } = lintAppSource(
      'probe-internal.ts',
      `import { internalsOf } from '${specifier}';\n\nexport const probe = internalsOf;\n`,
    );
    expect(status).not.toBe(0);
    expect(output).toContain('noRestrictedImports');
    expect(output).toContain('never their src files');
  });

  it('still allows the package exports and local modules', () => {
    const { status, output } = lintAppSource(
      'probe-allowed.ts',
      [
        "import { createAppDb } from '@sift/db';",
        "import { loadConfig } from '@sift/core/config';",
        "import { local } from './local.ts';",
        '',
        'export const probe = [createAppDb, loadConfig, local];',
        '',
      ].join('\n'),
    );
    expect(output).not.toContain('noRestrictedImports');
    expect(status).toBe(0);
  });
});
