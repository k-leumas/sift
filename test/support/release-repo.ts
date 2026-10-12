/**
 * Throwaway git repositories for the `pnpm release` and release-check tests.
 *
 * Each repo is a temp dir holding `work/` (the repository) and `aux/` (an empty
 * global gitconfig and a bare `remote.git`), so aux files never dirty the tree.
 * Git calls are slow on some hosts, so the two starting points (fresh, and after
 * a first release) are built once per file and copied for every test.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** The four package.json files the throwaway repos start from (copied from this repo). */
export const PACKAGE_FILES = [
  'package.json',
  'apps/worker/package.json',
  'packages/core/package.json',
  'packages/db/package.json',
] as const;

/**
 * `yaml` from the worker's dependencies. The repository root has no `yaml`
 * dependency and this task adds none, so resolve it where the worker does.
 */
export const parseYaml = (
  createRequire(path.join(REPO_ROOT, 'apps/worker/package.json'))('yaml') as {
    parse: (text: string) => unknown;
  }
).parse;

export interface Repo {
  /** The git work tree. */
  work: string;
  /** Sibling dir with the empty global gitconfig and the bare remote. */
  aux: string;
  remote: string;
  env: NodeJS.ProcessEnv;
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Child env without the owner's GIT_* variables, global config, signing or hooksPath; runs as the release workflow. */
function isolatedEnv(aux: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: path.join(aux, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    // The release workflow sets this; a test that checks the local refusal deletes it.
    SIFT_RELEASE_CI: '1',
    GIT_AUTHOR_NAME: 'Release Test',
    GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
    GIT_COMMITTER_NAME: 'Release Test',
    GIT_COMMITTER_EMAIL: 'release-test@example.invalid',
  };
}

function repoAt(dir: string): Repo {
  const aux = path.join(dir, 'aux');
  return {
    work: path.join(dir, 'work'),
    aux,
    remote: path.join(aux, 'remote.git'),
    env: isolatedEnv(aux),
  };
}

export function git(repo: Repo, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo.work,
    env: repo.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Run a repository script (e.g. scripts/release.ts) with cwd at the repo. */
export function runScript(repo: Repo, script: string, ...args: string[]): RunResult {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, script), ...args], {
    cwd: repo.work,
    env: repo.env,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function release(repo: Repo, ...args: string[]): RunResult {
  return runScript(repo, 'scripts/release.ts', ...args);
}

export function readWork(repo: Repo, file: string): string {
  return readFileSync(path.join(repo.work, file), 'utf8');
}

export function writeWork(repo: Repo, file: string, text: string): void {
  writeFileSync(path.join(repo.work, file), text);
}

export function commit(repo: Repo, subject: string, body?: string): void {
  const message = body === undefined ? ['-m', subject] : ['-m', subject, '-m', body];
  git(repo, 'commit', '-q', '--allow-empty', ...message);
}

/** HEAD, porcelain status, tags and every package.json + CHANGELOG.md text. */
export function snapshot(repo: Repo) {
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

/** Refs in the bare remote; empty when nothing was ever pushed. */
export function remoteRefs(repo: Repo): string {
  return execFileSync('git', ['ls-remote', repo.remote], { env: repo.env, encoding: 'utf8' });
}

/** A repo on main with the four package.json files, `chore: init`, a feat and a fix. */
function buildFresh(dir: string): Repo {
  const repo = repoAt(dir);
  mkdirSync(repo.work, { recursive: true });
  mkdirSync(repo.aux, { recursive: true });
  writeFileSync(path.join(repo.aux, 'gitconfig'), '');
  execFileSync('git', ['init', '--bare', '-q', repo.remote], { env: repo.env });
  for (const file of PACKAGE_FILES) {
    mkdirSync(path.dirname(path.join(repo.work, file)), { recursive: true });
    writeWork(repo, file, readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  }
  git(repo, 'init', '-q', '-b', 'main');
  // Relative to the work tree, so the URL stays right in every copy of the template.
  git(repo, 'remote', 'add', 'origin', '../aux/remote.git');
  git(repo, 'add', '--', ...PACKAGE_FILES);
  git(repo, 'commit', '-q', '-m', 'chore: init');
  commit(repo, 'feat(core): add alpha');
  commit(repo, 'fix: repair beta');
  return repo;
}

/**
 * Template factory for one test file: call `setup()` in beforeAll, `cleanup()`
 * in afterAll and `reset()` in afterEach.
 */
export function releaseRepos() {
  const copies: string[] = [];
  let templates: string | undefined;

  const copy = (name: 'fresh' | 'released'): Repo => {
    if (templates === undefined) throw new Error('releaseRepos().setup() has not run');
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sift-release-'));
    copies.push(dir);
    cpSync(path.join(templates, name), dir, { recursive: true });
    return repoAt(dir);
  };

  return {
    setup(): void {
      templates = mkdtempSync(path.join(os.tmpdir(), 'sift-release-tpl-'));
      const fresh = path.join(templates, 'fresh');
      const released = path.join(templates, 'released');
      buildFresh(fresh);
      cpSync(fresh, released, { recursive: true });
      const first = release(repoAt(released));
      if (first.status !== 0) throw new Error(`template release failed: ${first.stderr}`);
    },
    /** Fresh repo: no tag, `chore: init`, a feat and a fix. */
    fresh: (): Repo => copy('fresh'),
    /** The fresh repo after a real first release (v0.1.0). */
    released: (): Repo => copy('released'),
    /** Remove the per-test copies. */
    reset(): void {
      for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
    /** Remove the copies and the templates. */
    cleanup(): void {
      for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true });
      if (templates !== undefined) rmSync(templates, { recursive: true, force: true });
      templates = undefined;
    },
  };
}
