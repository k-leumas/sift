/**
 * `pnpm release [--dry-run]`: cut a release locally from the Conventional Commits
 * since the last `v*` tag. Writes the version into every package.json, prepends
 * CHANGELOG.md, makes one `chore(release): vX.Y.Z` commit and an annotated tag.
 * It never pushes. Git runs through execFileSync with an argv array only, so no
 * commit text or tag name ever reaches a shell.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

    if (dryRun) {
      const after = lastTag === null ? 'first release, no v* tag' : `after ${lastTag}`;
      process.stdout.write(`Next release: ${plan.tag} (${after})\n\n${plan.section}`);
      return 0;
    }

    const paths = [...packageJsonFiles(root), CHANGELOG];
    for (const file of packageJsonFiles(root)) {
      const full = path.join(root, file);
      writeFileSync(full, setPackageVersion(readFileSync(full, 'utf8'), plan.version));
    }
    const changelogPath = path.join(root, CHANGELOG);
    writeFileSync(changelogPath, prependChangelog(readIfExists(changelogPath), plan.section));

    git(root, ['add', '--', ...paths]);
    git(root, ['commit', '-m', `chore(release): ${plan.tag}`, '--', ...paths]);
    git(root, ['tag', '-a', plan.tag, '-m', `Release ${plan.tag}`]);
    process.stdout.write(
      `Created commit chore(release): ${plan.tag} and annotated tag ${plan.tag}.\n` +
        'Push when ready: git push --follow-tags\n',
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
