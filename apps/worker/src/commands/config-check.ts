import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { applyEnvOverrides, checkMailboxEnv, formatIssue, loadConfig } from '@sift/core/config';
import { loadRules, resolveDataPath, rulesPathFor } from '@sift/core/rules';
import type { CommandIO } from '../command.ts';

/** Show a path relative to the working directory when it lives under it. */
function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

/**
 * Check every mailbox's rules file (D-05) and print each problem with its
 * position. All mailboxes are checked before returning, so the owner sees every
 * problem in one run. Returns true when every file is present and valid.
 */
async function checkRulesFiles(slugs: readonly string[], io: CommandIO): Promise<boolean> {
  const dataDir = resolveDataPath(io.env, io.cwd);
  let ok = true;
  for (const slug of slugs) {
    const path = rulesPathFor(dataDir, slug);
    const result = await loadRules(path);
    if (result.ok) continue;
    ok = false;
    const source = displayPath(path, io.cwd);
    for (const issue of result.issues) io.stderr(formatIssue(issue, source));
  }
  return ok;
}

/**
 * `sift config check [--schema-only]` (D-65). Needs no database. Prints every
 * problem as `<file>:<line>:<col> <path>: <message>` and exits 1 on any.
 * Raw YAML values and env values are never echoed.
 *
 * Without `--schema-only` it also checks that every password_env variable is
 * set, then reads each mailbox's rules file at
 * `<data>/mailboxes/<slug>/rules.yaml` (D-05). The data directory is SIFT_DATA,
 * or `./data` when unset. Rules files are only read, never written.
 *
 * `--schema-only` skips the password_env presence check (D-67) and the rules
 * files: setup validates variable names only and never reads rules files, so
 * one bad rules.yaml cannot stop setup or the Compose stack. The worker and the
 * owner check the rest.
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

  const slugs = result.config.mailboxes.map((m) => m.slug);
  let note = 'env vars not checked (--schema-only)';
  if (!schemaOnly) {
    const env = checkMailboxEnv(result.config, io.env);
    if (!env.ok) {
      io.stderr(env.message);
      return 1;
    }
    if (!(await checkRulesFiles(slugs, io))) return 1;
    note = 'password env vars present; rules files valid';
  }

  io.stdout(`Config OK: ${slugs.length} mailboxes (${slugs.join(', ')}); ${note}`);
  return 0;
}
