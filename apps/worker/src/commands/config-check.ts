import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { applyEnvOverrides, checkMailboxEnv, formatIssue, loadConfig } from '@sift/core/config';
import type { CommandIO } from '../command.ts';

/** Show a path relative to the working directory when it lives under it. */
function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

/**
 * `sift config check [--schema-only]` (D-65). Needs no database. Prints every
 * problem as `<file>:<line>:<col> <path>: <message>` and exits 1 on any.
 * Raw YAML values and env values are never echoed.
 *
 * `--schema-only` skips the password_env presence check (D-67): setup validates
 * variable names only, the worker and the owner check presence.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  const { values } = parseArgs({
    args: [...args],
    options: { 'schema-only': { type: 'boolean', default: false } },
    strict: true,
    allowPositionals: false,
  });
  const schemaOnly = values['schema-only'] === true;

  const path = resolveConfigPath(io.env, io.cwd);
  const source = displayPath(path, io.cwd);
  const loaded = await loadConfig(path);
  if (!loaded.ok) {
    for (const issue of loaded.issues) io.stderr(formatIssue(issue, source));
    return 1;
  }

  const result = applyEnvOverrides(loaded.config, io.env);
  if (!result.ok) {
    for (const issue of result.issues) io.stderr(formatIssue(issue, result.source));
    return 1;
  }

  let envNote = 'env vars not checked (--schema-only)';
  if (!schemaOnly) {
    const env = checkMailboxEnv(result.config, io.env);
    if (!env.ok) {
      io.stderr(env.message);
      return 1;
    }
    envNote = 'password env vars present';
  }

  const slugs = result.config.mailboxes.map((m) => m.slug);
  io.stdout(`Config OK: ${slugs.length} mailboxes (${slugs.join(', ')}); ${envNote}`);
  return 0;
}
