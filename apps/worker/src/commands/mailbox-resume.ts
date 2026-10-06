import { parseArgs } from 'node:util';
import { redactText } from '@sift/core/log';
import { requireDatabaseUrl } from '@sift/db';
import { resumeMailbox } from '@sift/db/registry';
import type { CommandIO } from '../command.ts';

const COMMAND = 'sift mailbox resume';
const USAGE = 'Usage: sift mailbox resume <slug>';

/**
 * `sift mailbox resume <slug>` (D-26). The volume valve holds new mail when a
 * check finds more than the per-cycle limit; only the owner releases it. This
 * approves the held count; the worker's next check processes up to that many
 * held messages plus new mail up to the limit. A mailbox that is not waiting
 * is left as it is.
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
    io.stderr(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}`);
    io.stderr(USAGE);
    return 2;
  }
  const [slug] = positionals;
  if (positionals.length !== 1 || slug === undefined) {
    io.stderr(USAGE);
    return 2;
  }

  const secrets = [io.env.SIFT_OWNER_DATABASE_URL].filter(
    (s): s is string => s !== undefined && s.trim() !== '',
  );
  try {
    const ownerUrl = requireDatabaseUrl(io.env, 'SIFT_OWNER_DATABASE_URL');
    const result = await resumeMailbox(ownerUrl, slug);
    if (result.resumed) {
      io.stdout(
        `Resumed ${slug}: the next check processes up to ${result.held} held messages, ` +
          'plus new mail up to the per-cycle limit.',
      );
    } else {
      io.stdout(
        `Mailbox ${slug} is not waiting for a resume (status: ${result.state ?? 'never run'}).`,
      );
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${COMMAND}: ${redactText(message, secrets)}`);
    return 1;
  }
}
