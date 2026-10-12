/**
 * `node scripts/release-notes.ts <vX.Y.Z>`: print that version's CHANGELOG.md
 * section without its `## vX.Y.Z (date)` heading, for the GitHub Release body.
 * Node built-ins only, like release-check.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TAG = /^v\d+\.\d+\.\d+$/;
const USAGE = 'Usage: node scripts/release-notes.ts <vX.Y.Z>';

/** The section body for `tag`, trimmed, or null when CHANGELOG.md has no such section. */
export function releaseNotes(changelog: string, tag: string): string | null {
  const lines = changelog.split('\n');
  const heading = `## ${tag}`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
}

export function main(argv: readonly string[]): number {
  const [tag, ...rest] = argv;
  if (tag === undefined || !TAG.test(tag) || rest.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const file = path.join(process.cwd(), 'CHANGELOG.md');
  const notes = existsSync(file) ? releaseNotes(readFileSync(file, 'utf8'), tag) : null;
  if (notes === null) {
    process.stderr.write(`release-notes: CHANGELOG.md has no "## ${tag}" section\n`);
    return 1;
  }
  process.stdout.write(`${notes}\n`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
