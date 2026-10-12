import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  commit,
  git,
  PACKAGE_FILES,
  type Repo,
  readWork,
  release,
  releaseRepos,
  remoteRefs,
  snapshot,
  writeWork,
} from './support/release-repo.ts';

/** Each case spawns git and node a dozen times; slow under full-suite load (bug-189). */
const E2E_TIMEOUT_MS = 120_000;

const repos = releaseRepos();
beforeAll(() => repos.setup(), E2E_TIMEOUT_MS);
afterEach(() => repos.reset());
afterAll(() => repos.cleanup());

function failingPreCommitHook(repo: Repo, script: string): void {
  const hook = path.join(repo.work, '.git/hooks/pre-commit');
  writeFileSync(hook, `#!/bin/sh\n${script}\n`);
  chmodSync(hook, 0o755);
}

describe('pnpm release: first release (LD-3, LD-4)', { timeout: E2E_TIMEOUT_MS }, () => {
  it('dry run computes v0.1.0 and changes nothing', () => {
    const repo = repos.fresh();
    const before = snapshot(repo);

    const { status, stdout, stderr } = release(repo, '--dry-run');

    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('Next release: v0.1.0 (first release, no v* tag)');
    expect(stdout).toContain('### Features');
    expect(stdout).toContain('**core:** add alpha');
    expect(stdout).toContain('repair beta');
    expect(snapshot(repo)).toEqual(before);
    expect(existsSync(path.join(repo.work, 'CHANGELOG.md'))).toBe(false);
  });

  it('first release commits and tags v0.1.0 without pushing', () => {
    const repo = repos.fresh();
    const originals = Object.fromEntries(PACKAGE_FILES.map((f) => [f, readWork(repo, f)]));

    const { status, stdout, stderr } = release(repo);

    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('The release workflow pushes both.');
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('chore(release): v0.1.0');
    const committed = git(repo, 'show', '--name-only', '--format=', 'HEAD')
      .split('\n')
      .filter((line) => line !== '')
      .sort();
    expect(committed).toEqual([
      'CHANGELOG.md',
      'apps/worker/package.json',
      'package.json',
      'packages/core/package.json',
      'packages/db/package.json',
    ]);
    expect(git(repo, 'cat-file', '-t', 'v0.1.0').trim()).toBe('tag');
    expect(git(repo, 'rev-parse', 'v0.1.0^{commit}')).toBe(git(repo, 'rev-parse', 'HEAD'));
    for (const file of PACKAGE_FILES) {
      const original = originals[file] ?? '';
      expect(original).toContain('"version": "0.0.0"');
      expect(readWork(repo, file)).toBe(
        original.replace('"version": "0.0.0"', '"version": "0.1.0"'),
      );
    }
    const changelog = readWork(repo, 'CHANGELOG.md');
    expect(changelog.startsWith('# Changelog')).toBe(true);
    expect(changelog).toMatch(/^## v0\.1\.0 \(\d{4}-\d{2}-\d{2}\)$/m);
    expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe('');
    expect(remoteRefs(repo)).toBe('');
  });

  it('rejects an unknown flag with exit 2 and the usage line', () => {
    const repo = repos.fresh();
    const { status, stderr } = release(repo, '--bogus');
    expect(status).toBe(2);
    expect(stderr).toContain('Usage: pnpm release');
  });
});

describe('pnpm release: later releases (LD-1, LD-2)', { timeout: E2E_TIMEOUT_MS }, () => {
  it('releases v0.2.0 after a feat, above v0.1.0 in CHANGELOG.md', () => {
    const repo = repos.released();
    commit(repo, 'feat(db): add gamma');

    const { status, stderr } = release(repo);

    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('chore(release): v0.2.0');
    expect(git(repo, 'cat-file', '-t', 'v0.2.0').trim()).toBe('tag');
    const changelog = readWork(repo, 'CHANGELOG.md');
    expect(changelog).toContain('**db:** add gamma');
    expect(changelog.indexOf('## v0.2.0')).toBeGreaterThan(-1);
    expect(changelog.indexOf('## v0.2.0')).toBeLessThan(changelog.indexOf('## v0.1.0'));
    expect(JSON.parse(readWork(repo, 'packages/db/package.json')).version).toBe('0.2.0');
    expect(remoteRefs(repo)).toBe('');
  });

  it('releases v0.1.1 after a fix', () => {
    const repo = repos.released();
    commit(repo, 'fix: mend delta');

    const { status, stderr } = release(repo);

    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(git(repo, 'tag', '-l', 'v0.1.1').trim()).toBe('v0.1.1');
    expect(JSON.parse(readWork(repo, 'package.json')).version).toBe('0.1.1');
  });

  it('refuses with no releasable commits since the last tag, in both modes', () => {
    const repo = repos.released();
    const before = snapshot(repo);

    const real = release(repo);
    expect(real.status).toBe(1);
    expect(real.stderr).toContain('no releasable commits since v0.1.0');
    expect(snapshot(repo)).toEqual(before);

    const dry = release(repo, '--dry-run');
    expect(dry.status).toBe(1);
    expect(dry.stderr).toContain('no releasable commits since v0.1.0');
    expect(snapshot(repo)).toEqual(before);
  });
});

describe('pnpm release: guards and rollback (LD-4)', { timeout: E2E_TIMEOUT_MS }, () => {
  it('refuses a real run outside the release workflow, but still dry-runs', () => {
    const repo = repos.released();
    commit(repo, 'feat: more');
    delete repo.env.SIFT_RELEASE_CI;
    const before = snapshot(repo);

    const real = release(repo);
    expect(real.status).toBe(1);
    expect(real.stderr).toContain('releases are cut by the release workflow');
    expect(real.stderr).toContain('pnpm release --dry-run');
    expect(snapshot(repo)).toEqual(before);

    const dry = release(repo, '--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.stderr).toBe('');
    expect(dry.stdout).toContain('Next release: v0.2.0 (after v0.1.0)');
  });

  it('refuses on an untracked file', () => {
    const repo = repos.released();
    commit(repo, 'feat: more');
    writeWork(repo, 'notes.txt', 'scratch\n');
    const before = snapshot(repo);

    const { status, stderr } = release(repo);

    expect(status).toBe(1);
    expect(stderr).toContain('clean');
    expect(stderr).toContain('notes.txt');
    expect(snapshot(repo)).toEqual(before);
  });

  it('refuses on a modified tracked file', () => {
    const repo = repos.released();
    commit(repo, 'feat: more');
    writeWork(repo, 'package.json', `${readWork(repo, 'package.json')}\n`);
    const before = snapshot(repo);

    const { status, stderr } = release(repo);

    expect(status).toBe(1);
    expect(stderr).toContain('clean');
    expect(snapshot(repo)).toEqual(before);
  });

  it('refuses off main and names main', () => {
    const repo = repos.released();
    git(repo, 'switch', '-q', '-c', 'topic');
    commit(repo, 'feat: on topic');
    const before = snapshot(repo);

    const { status, stderr } = release(repo);

    expect(status).toBe(1);
    expect(stderr).toContain('main');
    expect(stderr).toContain('topic');
    expect(snapshot(repo)).toEqual(before);
  });

  it('refuses when the computed tag already exists and writes nothing', () => {
    const repo = repos.released();
    git(repo, 'switch', '-q', '-c', 'side');
    commit(repo, 'feat: side work');
    git(repo, 'tag', 'v0.2.0');
    git(repo, 'switch', '-q', 'main');
    commit(repo, 'feat: main work');
    const before = snapshot(repo);

    const { status, stderr } = release(repo);

    expect(status).toBe(1);
    expect(stderr).toContain('v0.2.0 already exists');
    expect(snapshot(repo)).toEqual(before);
  });

  it('rolls back files and index when the commit hook fails', () => {
    const repo = repos.released();
    commit(repo, 'feat: hooked');
    failingPreCommitHook(repo, 'echo "hook says no" >&2\nexit 1');
    const before = snapshot(repo);

    const { status, stderr } = release(repo);

    expect(status).toBe(1);
    expect(stderr).toContain('hook says no');
    expect(snapshot(repo)).toEqual(before);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('rolls back a first release, removing the new CHANGELOG.md', () => {
    const repo = repos.fresh();
    failingPreCommitHook(repo, 'exit 1');
    const before = snapshot(repo);

    const { status } = release(repo);

    expect(status).toBe(1);
    expect(snapshot(repo)).toEqual(before);
    expect(existsSync(path.join(repo.work, 'CHANGELOG.md'))).toBe(false);
  });

  it('dry run on a dirty tree or off main still prints the plan and says it would refuse', () => {
    const repo = repos.released();
    commit(repo, 'feat: more');
    writeWork(repo, 'notes.txt', 'scratch\n');

    const dirty = release(repo, '--dry-run');
    expect(dirty.status).toBe(0);
    expect(dirty.stdout).toContain('Next release: v0.2.0 (after v0.1.0)');
    expect(dirty.stdout).toContain('## v0.2.0 (');
    expect(dirty.stderr).toContain('would refuse');
    expect(dirty.stderr).toContain('clean');

    rmSync(path.join(repo.work, 'notes.txt'));
    git(repo, 'switch', '-q', '-c', 'topic');
    const topic = release(repo, '--dry-run');
    expect(topic.status).toBe(0);
    expect(topic.stdout).toContain('Next release: v0.2.0');
    expect(topic.stderr).toContain('would refuse');
    expect(topic.stderr).toContain('main');
    expect(git(repo, 'tag', '-l')).toBe('v0.1.0\n');
  });
});
