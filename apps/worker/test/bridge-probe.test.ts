import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommandIO } from '../src/command.ts';
import { run } from '../src/commands/bridge-probe.ts';
import { closeImap, type ImapFlow, openImap } from '../src/imap/connect.ts';
import {
  compareReports,
  encodeModifiedUtf7,
  LABEL_TEST_MAX_AGE_MS,
  labelTest,
  type ProbeReport,
  runProbe,
  SPIKE_LABEL_NAME,
  waitForNew,
} from '../src/spike/probe.ts';
import {
  appendMessage,
  bumpUidValidity,
  createFolder,
  freshImapUser,
  messageFlags,
  requireTestImap,
  setFlags,
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
  stdin?: string,
): Promise<Result> {
  const config = await writeConfig(user);
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIO = {
    env: { SIFT_CONFIG: config, [PASSWORD_ENV]: TEST_IMAP.password, ...env },
    cwd: dir,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    ...(stdin === undefined ? {} : { stdin: Readable.from([stdin]) }),
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

const LABEL_PATH = `Labels/${SPIKE_LABEL_NAME}`;

function planLine(uid: number): string {
  return (
    `Label test: copy UID ${uid} from INBOX into ${LABEL_PATH}, then remove it from ` +
    `${LABEL_PATH} only. Type LABEL to continue:`
  );
}

/** Three fresh messages (INTERNALDATE now); uid 2 is the label-test target, uid 3 is flagged. */
async function seedLabelFixtures(user: string): Promise<void> {
  await appendMessage(user, 'INBOX', message([`Message-ID: <${SENTINELS[4]}-a@example.test>`]));
  await appendMessage(
    user,
    'INBOX',
    message([`Message-ID: <${SENTINELS[4]}-target@example.test>`, 'X-Pm-Internal-Id: target42']),
  );
  await appendMessage(user, 'INBOX', message([`Message-ID: <${SENTINELS[4]}-c@example.test>`]));
  await setFlags(user, 'INBOX', 3, ['\\Flagged', '\\Seen']);
}

/** Whether `folder` exists for `user`, from a fresh read-only LIST. */
async function folderExists(user: string, folder: string): Promise<boolean> {
  const client = await connectAs(user);
  try {
    return (await client.list()).some((entry) => entry.path === folder);
  } finally {
    await closeImap(client);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('sift bridge probe --label-test (SPK-01, D-11)', () => {
  it('copies only the confirmed UID into the spike label and removes it from there only', async () => {
    const user = freshImapUser('probe-labeltest');
    await seedLabelFixtures(user);
    const before = await messageFlags(user, 'INBOX');

    const result = await probe(user, ['--label-test', '--uid', '2'], {}, 'LABEL\n');
    const report = reportOf(result);
    expectPrivate(result);

    expect(report.labelTest).toEqual({
      performed: true,
      labelFolderCreated: true,
      copyUidPlus: true,
      inboxCopyAfterCopy: true,
      messageIdBytesEqual: true,
      pmInternalIdBytesEqual: true,
      removedFromLabel: true,
      inboxCopyAfterRemove: true,
    });
    // The plan names the folder and the UID, nothing about the message.
    expect(result.stderr).toContain(planLine(2));
    // INBOX: same messages, same flags; the label folder is empty again.
    expect(await messageFlags(user, 'INBOX')).toEqual(before);
    expect((await messageFlags(user, LABEL_PATH)).size).toBe(0);
  });

  it('does nothing without the typed word LABEL', async () => {
    const user = freshImapUser('probe-unconfirmed');
    await seedLabelFixtures(user);
    const before = await messageFlags(user, 'INBOX');

    for (const stdin of ['yes\n', 'label\n', ' LABEL\n', undefined]) {
      const report = reportOf(await probe(user, ['--label-test', '--uid', '2'], {}, stdin));
      expect(report.labelTest).toEqual({ performed: false, skippedReason: 'not confirmed' });
    }
    expect(await folderExists(user, LABEL_PATH)).toBe(false);
    expect(await messageFlags(user, 'INBOX')).toEqual(before);
  });

  it.each([
    [['--label-test']],
    [['--label-test', '--wait-new-seconds', '5']],
    [['--uid', '2']],
    [['--label-test', '--uid', '2', '--compare', '-']],
  ])('%j exits 2 with the usage', async (args) => {
    const result = await probe(freshImapUser('probe-labelusage'), args, {}, 'LABEL\n');
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: sift bridge probe <slug>');
  });

  it('refuses a target older than one hour, before any write', async () => {
    const user = freshImapUser('probe-old');
    const client = await connectAs(user);
    try {
      const old = new Date(Date.now() - 2 * LABEL_TEST_MAX_AGE_MS);
      await client.append('INBOX', message(['X-Pm-Internal-Id: old1']), [], old);
    } finally {
      await closeImap(client);
    }
    const before = await messageFlags(user, 'INBOX');

    const report = reportOf(await probe(user, ['--label-test', '--uid', '1'], {}, 'LABEL\n'));
    expect(report.labelTest).toEqual({
      performed: false,
      skippedReason: 'target older than one hour',
    });
    expect(await folderExists(user, LABEL_PATH)).toBe(false);
    expect(await messageFlags(user, 'INBOX')).toEqual(before);
  });

  it('reports a missing target UID, before any write', async () => {
    const user = freshImapUser('probe-missing');
    await seedLabelFixtures(user);

    const report = reportOf(await probe(user, ['--label-test', '--uid', '99'], {}, 'LABEL\n'));
    expect(report.labelTest).toEqual({ performed: false, skippedReason: 'target not found' });
    expect(await folderExists(user, LABEL_PATH)).toBe(false);
  });

  it('expunges nothing when COPYUID did not identify the label copy', async () => {
    const user = freshImapUser('probe-nocopyuid');
    await seedLabelFixtures(user);
    const client = await connectAs(user);
    try {
      const realCopy = client.messageCopy.bind(client);
      vi.spyOn(client, 'messageCopy').mockImplementation(async (...args) => {
        const result = await realCopy(...args);
        if (result === false) return result;
        const { uidMap: _dropped, ...rest } = result;
        return rest;
      });
      const deleteSpy = vi.spyOn(client, 'messageDelete');

      const result = await labelTest(client, {
        folder: 'INBOX',
        uid: 2,
        delimiter: '/',
        confirmed: true,
      });
      expect(result).toMatchObject({
        performed: false,
        skippedReason: 'label copy not confirmed',
        copyUidPlus: false,
        labelCopyMayRemain: true,
      });
      expect(deleteSpy).not.toHaveBeenCalled();
    } finally {
      await closeImap(client);
    }
    // The original is untouched; the label copy is left for the owner.
    expect((await messageFlags(user, 'INBOX')).has(2)).toBe(true);
    expect((await messageFlags(user, LABEL_PATH)).size).toBe(1);
  });
});

describe('sift bridge probe --wait-new-seconds (D-27, D-43)', () => {
  it('sees new mail during IDLE and reports its UID; no label test runs', async () => {
    const user = freshImapUser('probe-idle');
    await appendMessage(user, 'INBOX', message([]));

    const running = probe(user, ['--wait-new-seconds', '20', '--scan-limit', '0', '--sample', '0']);
    await sleep(3_000);
    await appendMessage(user, 'INBOX', message(['X-Pm-Internal-Id: fresh1']));
    const result = await running;
    const report = reportOf(result);
    expectPrivate(result);

    expect(report.idle).toEqual({
      seconds: 20,
      existsEventSeen: true,
      newMessageArrived: true,
      newUid: 2,
    });
    expect(report.labelTest).toBeUndefined();
  }, 40_000);

  it('reports no new mail when none arrives', async () => {
    const user = freshImapUser('probe-idle-quiet');
    await appendMessage(user, 'INBOX', message([]));
    const client = await connectAs(user);
    try {
      const { report, newUid } = await waitForNew(client, 'INBOX', 1);
      expect(report).toEqual({
        seconds: 1,
        existsEventSeen: false,
        newMessageArrived: false,
        newUid: null,
      });
      expect(newUid).toBeNull();
    } finally {
      await closeImap(client);
    }
  });
});

describe('report comparison (SPK-04, D-43)', () => {
  it('--compare <file> reports a UIDVALIDITY change and matches the sample', async () => {
    const user = freshImapUser('probe-compare');
    await seedIdentityFixtures(user);
    const first = await probe(user);
    const previous = reportOf(first);
    const file = path.join(dir, `${user}-previous.json`);
    await writeFile(file, first.stdout);

    await bumpUidValidity(user, 'INBOX');
    const report = reportOf(await probe(user, ['--compare', file]));
    const hashed = previous.sample.filter((s) => s.internalIdSha256 !== null).length;
    expect(report.compare).toEqual({
      uidValidityChanged: { INBOX: true },
      addedFolders: [],
      missingFolders: [],
      sampleMatched: hashed,
      uidChanged: 0,
      internalDateChanged: 0,
      sampleMissing: 0,
    });
  });

  it('--compare - reads the previous report from stdin', async () => {
    const user = freshImapUser('probe-compare-stdin');
    await seedIdentityFixtures(user);
    const first = await probe(user);

    const report = reportOf(await probe(user, ['--compare', '-'], {}, first.stdout));
    expect(report.compare?.uidValidityChanged).toEqual({ INBOX: false });
    expect(report.compare?.sampleMatched).toBe(4);
  });

  it('unparseable input exits 1 naming the source only', async () => {
    const user = freshImapUser('probe-compare-bad');
    const file = path.join(dir, `${user}-garbage.json`);
    await writeFile(file, `not a report ${SENTINELS[3]}`);

    const fromFile = await probe(user, ['--compare', file]);
    expect(fromFile.code).toBe(1);
    expect(fromFile.stderr).toContain(file);
    expect(fromFile.stdout).toBe('');
    expectPrivate(fromFile);

    const fromStdin = await probe(
      user,
      ['--compare', '-'],
      {},
      `{"probeVersion": 2} ${SENTINELS[3]}`,
    );
    expect(fromStdin.code).toBe(1);
    expect(fromStdin.stderr).toContain('stdin');
    expectPrivate(fromStdin);
  });

  it('lists folders present in only one report and counts changed sample entries', () => {
    const base = {
      probeVersion: 1,
      at: '2026-10-05T00:00:00.000Z',
      folder: 'INBOX',
      sample: [],
    } as unknown as ProbeReport;
    const previous: ProbeReport = {
      ...base,
      uidValidity: { INBOX: 10, [LABEL_PATH]: 20 },
      sample: [
        { uid: 1, internalDate: '2026-10-01T00:00:00.000Z', internalIdSha256: 'a' },
        { uid: 2, internalDate: '2026-10-02T00:00:00.000Z', internalIdSha256: 'b' },
        { uid: 3, internalDate: '2026-10-03T00:00:00.000Z', internalIdSha256: 'c' },
        { uid: 4, internalDate: '2026-10-04T00:00:00.000Z', internalIdSha256: null },
      ],
    };
    const current: ProbeReport = {
      ...base,
      uidValidity: { INBOX: 11, Other: 5 },
      sample: [
        { uid: 7, internalDate: '2026-10-01T00:00:00.000Z', internalIdSha256: 'a' },
        { uid: 2, internalDate: '2026-10-09T00:00:00.000Z', internalIdSha256: 'b' },
      ],
    };
    expect(compareReports(previous, current)).toEqual({
      uidValidityChanged: { INBOX: true },
      addedFolders: ['Other'],
      missingFolders: [LABEL_PATH],
      sampleMatched: 2,
      uidChanged: 1,
      internalDateChanged: 1,
      sampleMissing: 1,
    });
  });
});
