import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { formatIssue, loadConfig } from '@sift/core/config';
import type { CommandIO } from '../command.ts';

/** Show a path relative to the working directory when it lives under it. */
function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

/**
 * `sift config check [--schema-only]` (D-65). Needs no database. Prints every
 * problem as `<file>:<line>:<col> <path>: <message>` and exits 1 on any.
 * Raw YAML values are never echoed.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  parseArgs({
    args: [...args],
    options: { 'schema-only': { type: 'boolean', default: false } },
    strict: true,
    allowPositionals: false,
  });

  const path = resolveConfigPath(io.env, io.cwd);
  const source = displayPath(path, io.cwd);
  const result = await loadConfig(path);
  if (!result.ok) {
    for (const issue of result.issues) io.stderr(formatIssue(issue, source));
    return 1;
  }

  const slugs = result.config.mailboxes.map((m) => m.slug);
  io.stdout(`Config OK: ${slugs.length} mailboxes (${slugs.join(', ')})`);
  return 0;
}
