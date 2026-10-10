import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { validateSlug } from '@sift/core/config';
import { redactText } from '@sift/core/log';
import { resolveDataPath, rulesPathFor } from '@sift/core/rules';
import { requireDatabaseUrl } from '@sift/db';
import { renameMailbox } from '@sift/db/registry';
import type { CommandIO } from '../command.ts';

const USAGE = 'Usage: sift mailbox rename <old-slug> <new-slug>';

/**
 * `sift mailbox rename <old-slug> <new-slug>` (D-32, D-63). Changes the slug
 * and keeps the mailbox id, so its history stays attached. The owner then
 * updates config.yaml to match and reruns setup.
 *
 * D-07: the mailbox's rules file lives at <data>/mailboxes/<slug>/rules.yaml,
 * so a rename refuses, before touching the database, until the owner has moved
 * the folder and <data>/mailboxes/<new-slug>/rules.yaml exists. Sift only checks
 * for the file: it never creates, moves or edits anything under the data
 * directory. An invalid new slug skips the check, so renameMailbox reports it.
 *
 * Env: SIFT_OWNER_DATABASE_URL (required; never printed), SIFT_DATA (data
 * directory, default ./data).
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  let positionals: string[];
  try {
    ({ positionals } = parseArgs({
      args: [...args],
      options: {},
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    io.stderr(`sift mailbox rename: ${error instanceof Error ? error.message : String(error)}`);
    io.stderr(USAGE);
    return 2;
  }
  const [oldSlug, newSlug] = positionals;
  if (positionals.length !== 2 || oldSlug === undefined || newSlug === undefined) {
    io.stderr(USAGE);
    return 2;
  }

  if (validateSlug(newSlug) === null) {
    const rulesPath = rulesPathFor(resolveDataPath(io.env, io.cwd), newSlug);
    if (!existsSync(rulesPath)) {
      io.stderr(
        `sift mailbox rename: ${rulesPath} does not exist. Move the mailbox's rules folder ` +
          `first (data/mailboxes/${oldSlug} to data/mailboxes/${newSlug}); ` +
          'Sift never moves your files. Then run this again.',
      );
      return 1;
    }
  }

  const secrets = [io.env.SIFT_OWNER_DATABASE_URL].filter(
    (s): s is string => s !== undefined && s.trim() !== '',
  );
  try {
    const ownerUrl = requireDatabaseUrl(io.env, 'SIFT_OWNER_DATABASE_URL');
    await renameMailbox(ownerUrl, oldSlug, newSlug);
    io.stdout(
      `Renamed mailbox "${oldSlug}" to "${newSlug}". Make sure config/config.yaml uses ` +
        `"${newSlug}", then run setup again: docker compose run --rm setup`,
    );
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sift mailbox rename: ${redactText(message, secrets)}`);
    return 1;
  }
}
