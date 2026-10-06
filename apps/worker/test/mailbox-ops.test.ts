// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../packages/db/test/global-setup.ts" />
import {
  type AppDb,
  createAppDb,
  recordNeedsAttention,
  recordSyncSuccess,
  withMailbox,
} from '@sift/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshDatabase, type TestDatabase } from '../../../packages/db/test/support/db.ts';
import { seedMailboxes } from '../../../packages/db/test/support/seed.ts';
import type { CommandIO } from '../src/command.ts';
import { run as resume } from '../src/commands/mailbox-resume.ts';
import { mailboxStatus } from './support/mailbox-harness.ts';

/**
 * Owner mailbox operations (02-16): `sift mailbox resume` releases a volume
 * hold (D-26) and `sift mailbox backfill` counts, confirms and ingests
 * (D-03, D-75). Everything runs in-process against the real database; the
 * backfill also against the Dovecot test server.
 */

let db: TestDatabase;
let appDb: AppDb;

beforeAll(async () => {
  db = await freshDatabase();
  appDb = createAppDb(db.appUrl);
});

afterAll(async () => {
  await appDb?.close();
  await db?.drop();
});

interface Captured {
  code: number;
  stdout: string[];
  stderr: string[];
}

/** Run a command in-process with the given environment; collect its output. */
async function capture(
  command: (args: readonly string[], io: CommandIO) => Promise<number>,
  args: readonly string[],
  env: Record<string, string>,
  stdin?: CommandIO['stdin'],
): Promise<Captured> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await command(args, {
    env,
    cwd: process.cwd(),
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    ...(stdin === undefined ? {} : { stdin }),
  });
  return { code, stdout, stderr };
}

describe('sift mailbox resume (D-26)', () => {
  let ids: Record<string, string>;
  const owner = () => ({ SIFT_OWNER_DATABASE_URL: db.ownerUrl });

  beforeAll(async () => {
    ids = await seedMailboxes(db.ownerUrl, ['personal', 'quiet']);
    const id = ids.personal ?? '';
    await withMailbox(appDb, id, (scope) => recordNeedsAttention(scope, 250, 'personal'));
  });

  it('approves the held count of a mailbox in needs_attention', async () => {
    const result = await capture(resume, ['personal'], owner());

    expect(result.stderr).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      'Resumed personal: the next check processes up to 250 held messages, plus new mail up to the per-cycle limit.',
    ]);
    const status = await mailboxStatus(db.adminUrl, ids.personal ?? '');
    expect(status.state).toBe('needs_attention');
    expect(status.held_new_count).toBe(250);
    expect(status.approved_new_count).toBe(250);
  });

  it('changes nothing on a mailbox that is not waiting', async () => {
    await withMailbox(appDb, ids.personal ?? '', (scope) => recordSyncSuccess(scope));
    const before = await mailboxStatus(db.adminUrl, ids.personal ?? '');

    const result = await capture(resume, ['personal'], owner());

    expect(result.code).toBe(0);
    expect(result.stdout).toEqual(['Mailbox personal is not waiting for a resume (status: ok).']);
    expect(await mailboxStatus(db.adminUrl, ids.personal ?? '')).toEqual(before);
  });

  it('reports never run for a mailbox without a status row', async () => {
    const result = await capture(resume, ['quiet'], owner());

    expect(result.code).toBe(0);
    expect(result.stdout).toEqual([
      'Mailbox quiet is not waiting for a resume (status: never run).',
    ]);
    expect((await mailboxStatus(db.adminUrl, ids.quiet ?? '')).state).toBeNull();
  });

  it('exits 1 for an unknown slug and 2 for bad usage', async () => {
    const unknown = await capture(resume, ['nope'], owner());
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toEqual(['sift mailbox resume: no mailbox with slug "nope"']);

    for (const args of [[], ['a', 'b'], ['--force', 'personal']]) {
      const usage = await capture(resume, args, owner());
      expect(usage.code, args.join(' ')).toBe(2);
      expect(usage.stderr.join('\n')).toContain('Usage: sift mailbox resume <slug>');
    }
  });

  it('never prints the owner database URL', async () => {
    const missing = await capture(resume, ['personal'], {});
    expect(missing.code).toBe(1);
    expect(missing.stderr.join('\n')).toContain('SIFT_OWNER_DATABASE_URL');

    const results = [
      await capture(resume, ['personal'], owner()),
      await capture(resume, ['nope'], owner()),
    ];
    for (const r of results) {
      expect([...r.stdout, ...r.stderr].join('\n')).not.toContain(db.ownerUrl);
    }
  });
});
