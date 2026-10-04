import { parseArgs } from 'node:util';
import { redactText } from '@sift/core/log';
import { requireDatabaseUrl } from '@sift/db';
import { listMailboxes, type MailboxListing } from '@sift/db/registry';
import type { CommandIO } from '../command.ts';

const ERROR_PREVIEW = 80;

function status(m: MailboxListing): string {
  if (m.disabledAt !== null) return `disabled since ${m.disabledAt.toISOString().slice(0, 10)}`;
  switch (m.state) {
    case 'ok':
      return 'ok';
    case 'error':
      return `error: ${(m.lastError ?? '').replace(/\s+/g, ' ').trim().slice(0, ERROR_PREVIEW)}`;
    case 'disabled':
      return 'disabled';
    case null:
      return 'never run';
  }
}

function when(at: Date | null): string {
  return at === null ? '-' : at.toISOString();
}

/** Left-align every column but the last to its widest cell. */
function table(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
      .join('  ')
      .trimEnd(),
  );
}

/**
 * `sift mailbox list` (D-69). Every registered mailbox with its status,
 * disabled ones included. Disabled mailboxes keep their data; this command
 * only reports.
 *
 * Env: SIFT_OWNER_DATABASE_URL (required). The URL is never printed.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  const secrets = [io.env.SIFT_OWNER_DATABASE_URL].filter(
    (s): s is string => s !== undefined && s.trim() !== '',
  );
  try {
    parseArgs({ args: [...args], options: {}, strict: true, allowPositionals: false });
    const ownerUrl = requireDatabaseUrl(io.env, 'SIFT_OWNER_DATABASE_URL');
    const mailboxes = await listMailboxes(ownerUrl);
    if (mailboxes.length === 0) {
      io.stdout('No mailboxes registered. Add them to config/config.yaml, then run setup.');
      return 0;
    }
    const rows = [
      ['SLUG', 'STATUS', 'LAST SEEN', 'LAST SYNC'],
      ...mailboxes.map((m) => [m.slug, status(m), when(m.lastSeenAt), when(m.lastSyncAt)]),
    ];
    for (const line of table(rows)) io.stdout(line);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sift mailbox list: ${redactText(message, secrets)}`);
    return 1;
  }
}
