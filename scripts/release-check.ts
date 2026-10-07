/**
 * CI tag check: `node scripts/release-check.ts <vX.Y.Z>`, run at the checkout root
 * by .github/workflows/release-tag.yml. Fails unless the tag equals `v` + the root
 * package.json version, every workspace package.json has that version, and
 * CHANGELOG.md has a `## vX.Y.Z` section. Node built-ins only: CI installs nothing.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { packageJsonFiles } from './release.ts';

const TAG = /^v\d+\.\d+\.\d+$/;
const USAGE = 'Usage: node scripts/release-check.ts <vX.Y.Z>';

export function releaseProblems(input: {
  tag: string;
  rootVersion: string | undefined;
  packageVersions: ReadonlyArray<{ file: string; version: string | undefined }>;
  changelog: string | null;
}): string[] {
  const { tag, rootVersion } = input;
  const problems: string[] = [];
  // A malformed tag is never compared or looked up any further.
  if (!TAG.test(tag)) return [`tag ${tag} is not in the vX.Y.Z format`];
  if (rootVersion === undefined) {
    problems.push('package.json has no version');
  } else if (tag !== `v${rootVersion}`) {
    problems.push(`tag ${tag} does not match package.json version ${rootVersion}`);
  }
  for (const { file, version } of input.packageVersions) {
    if (version !== rootVersion) {
      problems.push(
        `${file} has version ${version ?? '(none)'}, but package.json has ${rootVersion ?? '(none)'}`,
      );
    }
  }
  if (input.changelog === null) {
    problems.push('CHANGELOG.md is missing');
  } else {
    const heading = `## ${tag}`;
    const lines = input.changelog.split('\n');
    if (!lines.some((line) => line === heading || line.startsWith(`${heading} `))) {
      problems.push(`CHANGELOG.md has no "${heading}" section`);
    }
  }
  return problems;
}

function readVersion(file: string): string | undefined {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const version = (parsed as { version?: unknown }).version;
  return typeof version === 'string' ? version : undefined;
}

export function main(argv: readonly string[]): number {
  const [tag, ...rest] = argv;
  if (tag === undefined || tag.startsWith('-') || rest.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const root = process.cwd();
  let rootVersion: string | undefined;
  const packageVersions: Array<{ file: string; version: string | undefined }> = [];
  for (const file of packageJsonFiles(root)) {
    const version = readVersion(path.join(root, file));
    if (file === 'package.json') rootVersion = version;
    else packageVersions.push({ file, version });
  }
  const changelogPath = path.join(root, 'CHANGELOG.md');
  const changelog = existsSync(changelogPath) ? readFileSync(changelogPath, 'utf8') : null;

  const problems = releaseProblems({ tag, rootVersion, packageVersions, changelog });
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`release-check: ${problem}\n`);
    return 1;
  }
  process.stdout.write(`release-check: ${tag} matches package.json versions and CHANGELOG.md\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
