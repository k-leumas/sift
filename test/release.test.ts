import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RELEASE = path.join(REPO_ROOT, 'scripts/release.ts');

/** The four package.json files the throwaway repos start from (copied from this repo). */
const PACKAGE_FILES = [
  'package.json',
  'apps/worker/package.json',
  'packages/core/package.json',
  'packages/db/package.json',
] as const;

interface Repo {
  /** The git work tree. */
  work: string;
  /** Sibling dir with the empty global gitconfig and the bare remote. */
  aux: string;
  remote: string;
  env: NodeJS.ProcessEnv;
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Child env without the owner's GIT_* variables, global config, signing or hooksPath. */
function isolatedEnv(aux: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: path.join(aux, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Release Test',
    GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
    GIT_COMMITTER_NAME: 'Release Test',
    GIT_COMMITTER_EMAIL: 'release-test@example.invalid',
  };
}

function git(repo: Repo, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo.work,
    env: repo.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function release(repo: Repo, ...args: string[]) {
  const result = spawnSync(process.execPath, [RELEASE, ...args], {
    cwd: repo.work,
    env: repo.env,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readWork(repo: Repo, file: string): string {
  return readFileSync(path.join(repo.work, file), 'utf8');
}

function writeWork(repo: Repo, file: string, text: string): void {
  writeFileSync(path.join(repo.work, file), text);
}

/** A repo on main with the four package.json files, `chore: init`, a feat and a fix. */
function makeRepo(): Repo {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sift-release-'));
  tempDirs.push(dir);
  const work = path.join(dir, 'work');
  const aux = path.join(dir, 'aux');
  mkdirSync(work);
  mkdirSync(aux);
  writeFileSync(path.join(aux, 'gitconfig'), '');
  const remote = path.join(aux, 'remote.git');
  const repo: Repo = { work, aux, remote, env: isolatedEnv(aux) };
  execFileSync('git', ['init', '--bare', '-q', remote], { env: repo.env });

  for (const file of PACKAGE_FILES) {
    mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    writeWork(repo, file, readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'add', '--', ...PACKAGE_FILES);
  git(repo, 'commit', '-q', '-m', 'chore: init');
  commit(repo, 'feat(core): add alpha');
  commit(repo, 'fix: repair beta');
  return repo;
}

function commit(repo: Repo, subject: string, body?: string): void {
  const message = body === undefined ? ['-m', subject] : ['-m', subject, '-m', body];
  git(repo, 'commit', '-q', '--allow-empty', ...message);
}

/** HEAD, porcelain status, tags and every package.json + CHANGELOG.md text. */
function snapshot(repo: Repo) {
  return {
    head: git(repo, 'rev-parse', 'HEAD').trim(),
    status: git(repo, 'status', '--porcelain', '--untracked-files=all'),
    tags: git(repo, 'tag', '-l'),
    files: Object.fromEntries(
      [...PACKAGE_FILES, 'CHANGELOG.md'].map((file) => [
        file,
        existsSync(path.join(repo.work, file)) ? readWork(repo, file) : null,
      ]),
    ),
  };
}

describe('pnpm release: first release (LD-3, LD-4)', () => {
  it('dry run computes v0.1.0 and changes nothing', () => {
    const repo = makeRepo();
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
    const repo = makeRepo();
    const originals = Object.fromEntries(PACKAGE_FILES.map((f) => [f, readWork(repo, f)]));

    const { status, stdout, stderr } = release(repo);

    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('git push --follow-tags');
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
    expect(
      execFileSync('git', ['ls-remote', repo.remote], { env: repo.env, encoding: 'utf8' }),
    ).toBe('');
  });

  it('rejects an unknown flag with exit 2 and the usage line', () => {
    const repo = makeRepo();
    const { status, stderr } = release(repo, '--bogus');
    expect(status).toBe(2);
    expect(stderr).toContain('Usage: pnpm release');
  });
});
