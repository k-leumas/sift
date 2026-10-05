import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CommandIO } from '../src/command.ts';
import { run } from '../src/commands/bridge-probe.ts';
import { closeImap, type ImapFlow, openImap } from '../src/imap/connect.ts';
import { encodeModifiedUtf7, type ProbeReport, runProbe } from '../src/spike/probe.ts';
import {
  appendMessage,
  createFolder,
  freshImapUser,
  requireTestImap,
  TEST_IMAP,
  testImapPin,
} from './support/test-imap.ts';

const PASSWORD_ENV = 'SIFT_PROBE_TEST_PASSWORD';
const SLUG = 'probe';

/** Strings planted in every subject, From, To, body, Message-ID local part and folder name. */
const SENTINELS = [
  'SentinelSubjectQx7',
  'sentinel-from-qx7',
  'sentinel-to-qx7',
  'SentinelBodyQx7',
  'sentinel-mid-qx7',
  'SentinelLabelQx7',
  'SentinelFolderQx7',
];
const EMAIL_ADDRESS = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/;

let pin: string;
let dir: string;

beforeAll(async () => {
  await requireTestImap();
  pin = await testImapPin();
  dir = await mkdtemp(path.join(tmpdir(), 'sift-probe-test-'));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** A config.yaml with one mailbox for `user` on the test server; returns its path. */
async function writeConfig(user: string): Promise<string> {
  const file = path.join(dir, `${user}.yaml`);
  await writeFile(
    file,
    [
      'version: 1',
      'mailboxes:',
      `  - slug: ${SLUG}`,
      '    imap:',
      `      host: ${TEST_IMAP.host}`,
      `      port: ${TEST_IMAP.port}`,
      `      username: ${user}`,
      `      password_env: ${PASSWORD_ENV}`,
      '      folder: INBOX',
      '      tls:',
      '        mode: starttls',
      `        pin_sha256: ${pin}`,
      '    labels:',
      '      apply_as: proton_labels',
      'models:',
      '  provider: ollama',
      '  embeddings: nomic-embed-text',
      '  llm: qwen3:1.7b',
      '',
    ].join('\n'),
  );
  return file;
}

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

async function probe(
  user: string,
  args: string[] = [],
  env: Record<string, string | undefined> = {},
): Promise<Result> {
  const config = await writeConfig(user);
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIO = {
    env: { SIFT_CONFIG: config, [PASSWORD_ENV]: TEST_IMAP.password, ...env },
    cwd: dir,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
  const code = await run([SLUG, ...args], io);
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function reportOf(result: Result): ProbeReport {
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as ProbeReport;
}

function expectPrivate(result: Result): void {
  const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
  for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel.toLowerCase());
  expect(text).not.toMatch(EMAIL_ADDRESS);
}

function message(headers: string[], body = `${SENTINELS[3]} text`): string {
  return [
    `Subject: ${SENTINELS[0]} hello`,
    `From: Sender <${SENTINELS[1]}@example.test>`,
    `To: Owner <${SENTINELS[2]}@example.test>`,
    'Date: Mon, 05 Oct 2026 10:00:00 +0000',
    ...headers,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
  ].join('\r\n');
}

/** Five fixtures whose identity statistics are known. */
async function seedIdentityFixtures(user: string): Promise<void> {
  await appendMessage(
    user,
    'INBOX',
    message([`Message-ID: <${SENTINELS[4]}-1@example.test>`, 'X-Pm-Internal-Id: abc123']),
  );
  await appendMessage(user, 'INBOX', message([]));
  await appendMessage(
    user,
    'INBOX',
    message([`Message-ID: <${SENTINELS[4]}-dup@example.test>`, 'X-Pm-Internal-Id: dupA']),
  );
  await appendMessage(
    user,
    'INBOX',
    message([`Message-ID: <${SENTINELS[4]}-dup@Example.TEST>`, 'X-Pm-Internal-Id: dupB']),
  );
  await appendMessage(
    user,
    'INBOX',
    message([
      'Message-ID: <xyz@protonmail.internalid>',
      'X-Pm-Internal-Id: xyz',
      `X-Pm-External-Id: <${SENTINELS[4]}-ext@example.test>`,
    ]),
  );
}

async function connectAs(user: string): Promise<ImapFlow> {
  return openImap({
    host: TEST_IMAP.host,
    port: TEST_IMAP.port,
    user,
    pass: TEST_IMAP.password,
    tls: { mode: 'starttls', pinSha256: pin },
    disableAutoEnable: true,
  });
}

type ExecFn = (command: string, attributes: unknown, options?: object) => Promise<unknown>;

/** Make the client's low-level command method fail for matching commands. */
function failCommands(client: ImapFlow, fail: (command: string, attributes: unknown) => unknown) {
  const target = client as unknown as { exec: ExecFn };
  const real = target.exec.bind(client);
  target.exec = (command, attributes, options) => {
    const error = fail(command, attributes);
    return error === undefined ? real(command, attributes, options) : Promise.reject(error);
  };
}

describe('sift bridge probe (read-only)', () => {
  it('reports capabilities, folders, identity statistics and a sample, privately', async () => {
    const user = freshImapUser('probe');
    await seedIdentityFixtures(user);
    await createFolder(user, `Labels/${SENTINELS[5]}`);
    await createFolder(user, `Folders/${SENTINELS[6]} Entwürfe`);

    const result = await probe(user);
    const report = reportOf(result);
    expectPrivate(result);

    expect(report.probeVersion).toBe(1);
    expect(report.folder).toBe('INBOX');
    // Positive control: Dovecot advertises and accepts CONDSTORE and QRESYNC (SPK-02).
    expect(report.condstore).toEqual({
      advertised: true,
      enable: 'OK',
      statusHighestModseq: 'OK',
    });
    expect(report.qresync.advertised).toBe(true);
    expect(report.idleAdvertised).toBe(true);
    expect(report.capabilities.preAuth).toContain('STARTTLS');
    expect(report.capabilities.postAuth).toContain('IMAP4REV1');
    for (const atom of [
      ...report.capabilities.greeting,
      ...report.capabilities.preAuth,
      ...report.capabilities.postAuth,
    ]) {
      expect(atom).toBe(atom.toUpperCase());
    }

    expect(report.folders.delimiter).toBe('/');
    expect(report.folders.labelsPrefix).toBe(1);
    expect(report.folders.foldersPrefix).toBe(1);
    expect(report.folders.specialUse).toEqual(expect.arrayContaining(['\\Inbox', '\\Sent']));
    expect(report.folders.spikeLabelExists).toBe(false);

    expect(report.folderStatus.messages).toBe(5);
    expect(report.folderStatus.uidNext).toBe(6);
    expect(report.uidValidity).toEqual({ INBOX: report.folderStatus.uidValidity });

    expect(report.identity).toMatchObject({
      scanned: 5,
      pmInternalIdPresent: 4,
      pmInternalIdAbsent: 1,
      messageIdAbsent: 1,
      messageIdInternalDomain: 1,
      duplicateMessageIds: 1,
      messageIdDiffersFromExternalId: 1,
    });
    expect(report.identity.dateSkewSeconds.p50).toEqual(expect.any(Number));
    expect(report.identity.dateSkewSeconds.p95).toEqual(expect.any(Number));

    expect(report.sample.map((s) => s.uid)).toEqual([1, 2, 3, 4, 5]);
    expect(report.sample[0]?.internalIdSha256).toBe(sha256('abc123'));
    expect(report.sample[1]?.internalIdSha256).toBeNull();
    expect(report.sample[4]?.internalDate).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('reads only the newest messages: --sample and --scan-limit bound the scan', async () => {
    const user = freshImapUser('probe-bounded');
    await seedIdentityFixtures(user);

    const report = reportOf(await probe(user, ['--sample', '2', '--scan-limit', '3']));
    expect(report.identity.scanned).toBe(3);
    expect(report.sample.map((s) => s.uid)).toEqual([4, 5]);
    expect(report.sample[1]?.internalIdSha256).toBe(sha256('xyz'));
  });

  it('--scan-limit 0 --sample 0 skips the header scan', async () => {
    const user = freshImapUser('probe-zero');
    await seedIdentityFixtures(user);

    const report = reportOf(await probe(user, ['--scan-limit', '0', '--sample', '0']));
    expect(report.identity.scanned).toBe(0);
    expect(report.identity.pmInternalIdPresent).toBe(0);
    expect(report.identity.dateSkewSeconds).toEqual({ p50: null, p95: null });
    expect(report.sample).toEqual([]);
    expect(report.folderStatus.messages).toBe(5);
  });

  it('an empty mailbox gives zero counts and no error (SPK-01 empty edge)', async () => {
    const user = freshImapUser('probe-empty');
    const result = await probe(user);
    const report = reportOf(result);
    expectPrivate(result);
    expect(report.identity).toEqual({
      scanned: 0,
      pmInternalIdPresent: 0,
      pmInternalIdAbsent: 0,
      messageIdAbsent: 0,
      messageIdInternalDomain: 0,
      duplicateMessageIds: 0,
      messageIdDiffersFromExternalId: 0,
      dateSkewSeconds: { p50: null, p95: null },
    });
    expect(report.sample).toEqual([]);
    expect(report.folders.labelsPrefix).toBe(0);
    expect(report.folders.foldersPrefix).toBe(0);
    expect(report.folderStatus.messages).toBe(0);
  });

  it('reports the spike label UIDVALIDITY when the label exists, and no other folder', async () => {
    const user = freshImapUser('probe-label');
    await createFolder(user, 'Labels/Sift Spike');
    await createFolder(user, `Labels/${SENTINELS[5]}`);

    const result = await probe(user);
    const report = reportOf(result);
    expectPrivate(result);
    expect(report.folders.spikeLabelExists).toBe(true);
    expect(Object.keys(report.uidValidity).sort()).toEqual(['INBOX', 'Labels/Sift Spike']);
  });

  it.each([
    [['--scan-limit', '10001']],
    [['--sample', '201']],
    [['--sample', '-1']],
    [['--scan-limit', '1e3']],
    [['--uid', '0']],
    [['--wait-new-seconds', 'soon']],
    [['--unknown']],
  ])('%j exits 2 with the usage', async (args) => {
    const result = await probe(freshImapUser('probe-usage'), args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: sift bridge probe <slug>');
  });

  it('an unknown slug exits 1 naming the slug', async () => {
    const out: string[] = [];
    const config = await writeConfig(freshImapUser('probe-slug'));
    const code = await run(['nope'], {
      env: { SIFT_CONFIG: config, [PASSWORD_ENV]: TEST_IMAP.password },
      cwd: dir,
      stdout: (line) => out.push(line),
      stderr: (line) => out.push(line),
    });
    expect(code).toBe(1);
    expect(out.join('\n')).toContain('no mailbox with slug "nope"');
  });

  it('a missing password variable exits 1 naming the variable', async () => {
    const result = await probe(freshImapUser('probe-env'), [], { [PASSWORD_ENV]: undefined });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(PASSWORD_ENV);
  });

  it('a rejected login exits 1 with the error class and never the password', async () => {
    const secret = 'wrong-secret-Qx7-value';
    const result = await probe(freshImapUser('probe-auth'), [], { [PASSWORD_ENV]: secret });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('sift bridge probe: auth_rejected');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });
});

describe('runProbe tagged statuses (SPK-02 empty edge)', () => {
  it('records BAD, NO and no answer instead of throwing', async () => {
    const user = freshImapUser('probe-stub');
    const client = await connectAs(user);
    try {
      failCommands(client, (command, attributes) => {
        if (command === 'ENABLE') {
          return Object.assign(new Error('Command failed'), { responseStatus: 'BAD' });
        }
        if (command === 'STATUS' && JSON.stringify(attributes).includes('HIGHESTMODSEQ')) {
          return Object.assign(new Error('Command failed'), { responseStatus: 'NO' });
        }
        return undefined;
      });
      const report = await runProbe(client, { folder: 'INBOX', sample: 20, scanLimit: 500 });
      expect(report.condstore.enable).toBe('BAD');
      expect(report.condstore.statusHighestModseq).toBe('NO');
      // client.status() still works: the raw STATUS failure does not hide the counts.
      expect(report.folderStatus.messages).toBe(0);
    } finally {
      await closeImap(client);
    }
  });

  it("records 'none' when the command fails without a tagged answer", async () => {
    const client = await connectAs(freshImapUser('probe-none'));
    try {
      failCommands(client, (command) =>
        command === 'ENABLE' ? new Error('connection lost') : undefined,
      );
      const report = await runProbe(client, { folder: 'INBOX', sample: 0, scanLimit: 0 });
      expect(report.condstore.enable).toBe('none');
      expect(report.condstore.statusHighestModseq).toBe('OK');
    } finally {
      await closeImap(client);
    }
  });
});

describe('encodeModifiedUtf7', () => {
  it('encodes non-ASCII and & as RFC 3501 modified UTF-7', () => {
    expect(encodeModifiedUtf7('INBOX')).toBe('INBOX');
    expect(encodeModifiedUtf7('Entwürfe')).toBe('Entw&APw-rfe');
    expect(encodeModifiedUtf7('A&B')).toBe('A&-B');
    expect(encodeModifiedUtf7('日本語')).toBe('&ZeVnLIqe-');
  });
});
