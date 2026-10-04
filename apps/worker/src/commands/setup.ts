import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { formatIssue, loadConfig } from '@sift/core/config';
import type { CommandIO } from '../command.ts';
import { run as configApply } from './config-apply.ts';
import { run as migrate } from './migrate.ts';

const STOPPED = 'Setup stopped: fix config/config.yaml and run setup again. Nothing was changed.';

/** Show a path relative to the working directory when it lives under it. */
function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

/**
 * `sift setup [--confirm]` (FND-01, D-27, D-28, D-33). The Compose `setup`
 * service runs it before the worker starts:
 *
 *   1. config schema check (D-67: password_env names only, no values),
 *   2. `sift migrate` (backup + pending migrations as sift_owner),
 *   3. `sift config apply [--confirm]` (mailbox registry reconciliation).
 *
 * A broken config stops setup before any migration or registry change.
 * Every step is idempotent, so rerunning setup is always safe.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  let confirm: boolean;
  try {
    const { values } = parseArgs({
      args: [...args],
      options: { confirm: { type: 'boolean', default: false } },
      strict: true,
      allowPositionals: false,
    });
    confirm = values.confirm === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sift setup: ${message}`);
    return 1;
  }

  const path = resolveConfigPath(io.env, io.cwd);
  const loaded = await loadConfig(path);
  if (!loaded.ok) {
    const source = displayPath(path, io.cwd);
    for (const issue of loaded.issues) io.stderr(formatIssue(issue, source));
    io.stderr(STOPPED);
    return 1;
  }

  const migrated = await migrate([], io);
  if (migrated !== 0) return migrated;

  return configApply(confirm ? ['--confirm'] : [], io);
}
