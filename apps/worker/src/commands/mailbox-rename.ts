import { parseArgs } from 'node:util';
import { redactText } from '@sift/core/log';
import { requireDatabaseUrl } from '@sift/db';
import { renameMailbox } from '@sift/db/registry';
import type { CommandIO } from '../command.ts';

const USAGE = 'Usage: sift mailbox rename <old-slug> <new-slug>';

/**
 * `sift mailbox rename <old-slug> <new-slug>` (D-32, D-63). Changes the slug
 * and keeps the mailbox id, so its history stays attached. The owner then
 * updates config.yaml to match and reruns setup.
 *
 * Env: SIFT_OWNER_DATABASE_URL (required). The URL is never printed.
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
