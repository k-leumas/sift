import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { formatIssue, loadConfig } from '@sift/core/config';
import { redactText } from '@sift/core/log';
import { requireDatabaseUrl } from '@sift/db';
import { applyConfig } from '@sift/db/registry';
import { describeChange, type RenameSuspects } from '@sift/db/registry-plan';
import type { CommandIO } from '../command.ts';

/** Show a path relative to the working directory when it lives under it. */
function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

function printRenameHint(suspects: RenameSuspects, io: CommandIO) {
  const { removed, added, pairs } = suspects;
  io.stderr(
    'sift config apply: a mailbox slug left config.yaml while a new one appeared. ' +
      'This may be a rename.',
  );
  for (const { from, to, identityDiffers } of pairs) {
    io.stderr(`  "${from}" is no longer in config.yaml, and "${to}" is new.`);
    if (identityDiffers) {
      io.stderr(
        `  Their IMAP host, username or folder differ, so rename only if "${to}" is the same ` +
          `account as "${from}"; otherwise its history would be attached to another account.`,
      );
    }
    io.stderr('  To keep its data under the new slug, rename it:');
    io.stderr(`    sift mailbox rename ${from} ${to}`);
    io.stderr(`    (in Docker: docker compose run --rm setup sift mailbox rename ${from} ${to})`);
    io.stderr('  then run setup again: docker compose run --rm setup');
  }
  const unpairedRemoved = removed.filter((slug) => !pairs.some((p) => p.from === slug));
  const unpairedAdded = added.filter((slug) => !pairs.some((p) => p.to === slug));
  if (unpairedRemoved.length > 0 || unpairedAdded.length > 0) {
    io.stderr(`  No longer in config.yaml: ${unpairedRemoved.map((s) => `"${s}"`).join(', ')}`);
    io.stderr(`  New in config.yaml: ${unpairedAdded.map((s) => `"${s}"`).join(', ')}`);
    if (unpairedRemoved.length > 0 && unpairedAdded.length > 0) {
      io.stderr(
        '  Sift cannot tell which of these became which (their IMAP host, username and folder ' +
          'do not match one to one), so it suggests no rename for them. Rename each one yourself ' +
          'with sift mailbox rename <old> <new> if it is the same account.',
      );
    }
  }
  io.stderr(
    'If these are different mailboxes, rerun with --confirm to disable the old ones and add the new ones.',
  );
  io.stderr('No changes applied.');
}

/**
 * `sift config apply [--confirm]` (FND-02, D-32, D-33). Reconciles the mailbox
 * registry with config.yaml as sift_owner.
 *
 * Validates the config schema only (D-67): setup never receives mailbox
 * passwords, so password_env must be a valid name but its value is not read.
 * A broken or empty config changes nothing.
 *
 * Env: SIFT_OWNER_DATABASE_URL (required), SIFT_CONFIG. The URL is never printed.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  const secrets = [io.env.SIFT_OWNER_DATABASE_URL].filter(
    (s): s is string => s !== undefined && s.trim() !== '',
  );

  try {
    const { values } = parseArgs({
      args: [...args],
      options: { confirm: { type: 'boolean', default: false } },
      strict: true,
      allowPositionals: false,
    });

    const path = resolveConfigPath(io.env, io.cwd);
    const loaded = await loadConfig(path);
    if (!loaded.ok) {
      const source = displayPath(path, io.cwd);
      for (const issue of loaded.issues) io.stderr(formatIssue(issue, source));
      io.stderr('No changes applied.');
      return 1;
    }

    const ownerUrl = requireDatabaseUrl(io.env, 'SIFT_OWNER_DATABASE_URL');
    const result = await applyConfig(ownerUrl, loaded.config, {
      confirm: values.confirm === true,
    });

    switch (result.status) {
      case 'applied':
        for (const change of result.changes) io.stdout(describeChange(change));
        io.stdout(
          `Applied ${result.changes.length} ${result.changes.length === 1 ? 'change' : 'changes'}.`,
        );
        return 0;
      case 'unchanged':
        io.stdout('Mailbox registry already matches config.yaml.');
        return 0;
      case 'refused-rename':
        printRenameHint(result, io);
        return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sift config apply: ${redactText(message, secrets)}`);
    io.stderr('No changes applied.');
    return 1;
  }
}
