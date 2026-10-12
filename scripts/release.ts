/**
 * `pnpm release [--dry-run]`: cut a release from the Conventional Commits since
 * the last `v*` tag. Writes the version into every package.json, prepends
 * CHANGELOG.md, makes one `chore(release): vX.Y.Z` commit and an annotated tag.
 * A real run happens only in the release workflow (SIFT_RELEASE_CI=1), after CI
 * passes on main; locally only `--dry-run` works. It never pushes: the workflow does. Git runs through execFileSync with an argv array only, so no
 * commit text or tag name ever reaches a shell.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  latestReleaseTag,
  planRelease,
  prependChangelog,
  type RawCommit,
  ReleaseRefusedError,
  setPackageVersion,
} from './release-plan.ts';

/** Mirrors the `apps/*` and `packages/*` globs in pnpm-workspace.yaml. */
export const WORKSPACE_DIRS = ['apps', 'packages'] as const;

const CHANGELOG = 'CHANGELOG.md';
const USAGE = 'Usage: pnpm release [--dry-run]';
/** Set only by .github/workflows/release.yml; a real run refuses without it. */
export const RELEASE_CI_ENV = 'SIFT_RELEASE_CI';

/** Repo-relative POSIX paths: `package.json`, then every workspace package.json, sorted. */
export function packageJsonFiles(root: string): string[] {
  const workspace: string[] = [];
  for (const dir of WORKSPACE_DIRS) {
    const base = path.join(root, dir);
    if (!existsSync(base)) continue;
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (existsSync(path.join(base, entry.name, 'package.json'))) {
        workspace.push(`${dir}/${entry.name}/package.json`);
      }
    }
  }
  return ['package.json', ...workspace.sort()];
}

/** A failed git call; the message carries git's stderr when there is any. */
class GitError extends Error {
  constructor(args: readonly string[], cause: unknown) {
    const stderr =
      typeof cause === 'object' && cause !== null && 'stderr' in cause
        ? String((cause as { stderr: unknown }).stderr).trim()
        : '';
    super(`git ${args[0] ?? ''} failed${stderr === '' ? '' : `: ${stderr}`}`);
    this.name = 'GitError';
  }
}

function git(root: string, args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new GitError(args, error);
  }
}

function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function readCommits(root: string, lastTag: string | null): RawCommit[] {
  const range = lastTag === null ? 'HEAD' : `${lastTag}..HEAD`;
  const out = git(root, ['log', '--no-merges', '--format=%H%x1f%s%x1f%b%x1e', range]);
  const commits: RawCommit[] = [];
  for (const record of out.split('\x1e')) {
    const text = record.replace(/^\n/, '');
    if (text.trim() === '') continue;
    const [sha = '', subject = '', ...body] = text.split('\x1f');
    commits.push({ sha, subject, body: body.join('\x1f') });
  }
  return commits;
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

/** True when the git call exits 0 (for checks whose failure is an answer, not an error). */
function gitSucceeds(root: string, args: readonly string[]): boolean {
  try {
    git(root, args);
    return true;
  } catch {
    return false;
  }
}

/** Why a real run must refuse: dirty tree, not on main, or the tag exists (LD-4). */
function guardProblems(root: string, tag: string): string[] {
  const problems: string[] = [];
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n')
    .filter((line) => line !== '');
  if (dirty.length > 0) {
    const more = dirty.length > 5 ? `, and ${dirty.length - 5} more` : '';
    problems.push(
      `the working tree must be clean; commit or remove: ${dirty.slice(0, 5).join(', ')}${more}`,
    );
  }
  let branch: string;
  try {
    branch = git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim();
  } catch {
    branch = 'detached HEAD';
  }
  if (branch !== 'main') problems.push(`releases run on main, not on ${branch}`);
  if (gitSucceeds(root, ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`])) {
    problems.push(`tag ${tag} already exists`);
  }
  return problems;
}

/**
 * Write every package.json version and CHANGELOG.md, then make the one release
 * commit with explicit pathspecs. If staging or the commit fails (a hook, say),
 * put the files and the index back as they were: never leave a half release.
 */
function commitRelease(root: string, version: string, section: string, tag: string): void {
  const packages = packageJsonFiles(root);
  const paths = [...packages, CHANGELOG];
  const originals = new Map(paths.map((file) => [file, readIfExists(path.join(root, file))]));

  try {
    for (const file of packages) {
      writeFileSync(path.join(root, file), setPackageVersion(originals.get(file) ?? '', version));
    }
    writeFileSync(
      path.join(root, CHANGELOG),
      prependChangelog(originals.get(CHANGELOG) ?? null, section),
    );
    // CHANGELOG.md may be new: a commit pathspec rejects paths git does not know yet.
    git(root, ['add', '--', ...paths]);
    git(root, ['commit', '-m', `chore(release): ${tag}`, '--', ...paths]);
  } catch (error) {
    for (const [file, text] of originals) {
      const full = path.join(root, file);
      if (text === null) rmSync(full, { force: true });
      else writeFileSync(full, text);
    }
    gitSucceeds(root, ['reset', '-q', '--', ...paths]);
    throw error;
  }
}

export function main(argv: readonly string[]): number {
  let dryRun: boolean;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { 'dry-run': { type: 'boolean' } },
      strict: true,
      allowPositionals: false,
    });
    dryRun = values['dry-run'] === true;
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  try {
    const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
    const tags = git(root, ['tag', '--list', 'v*', '--merged', 'HEAD']).split('\n');
    const lastTag = latestReleaseTag(tags.map((t) => t.trim()));
    const commits = readCommits(root, lastTag);
    const plan = planRelease({ lastTag, commits, date: localDate(new Date()) });

    const problems = guardProblems(root, plan.tag);

    if (dryRun) {
      const after = lastTag === null ? 'first release, no v* tag' : `after ${lastTag}`;
      process.stdout.write(`Next release: ${plan.tag} (${after})\n\n${plan.section}`);
      for (const problem of problems) {
        process.stderr.write(`release: a real run would refuse: ${problem}\n`);
      }
      return 0;
    }
    if (process.env[RELEASE_CI_ENV] !== '1') {
      problems.unshift(
        'releases are cut by the release workflow after CI passes on main; ' +
          'run pnpm release --dry-run to preview the next one',
      );
    }
    if (problems.length > 0) throw new ReleaseRefusedError(problems.join('; '));

    commitRelease(root, plan.version, plan.section, plan.tag);
    try {
      git(root, ['tag', '-a', plan.tag, '-m', `Release ${plan.tag}`]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ReleaseRefusedError(
        `${reason}. The release commit was kept; finish by hand with: ` +
          `git tag -a ${plan.tag} -m "Release ${plan.tag}"`,
      );
    }
    process.stdout.write(
      `Created commit chore(release): ${plan.tag} and annotated tag ${plan.tag}.\n` +
        'The release workflow pushes both.\n',
    );
    return 0;
  } catch (error) {
    if (error instanceof ReleaseRefusedError || error instanceof GitError) {
      process.stderr.write(`release: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  // Set exitCode instead of calling process.exit so buffered output is flushed.
  process.exitCode = main(process.argv.slice(2));
}
