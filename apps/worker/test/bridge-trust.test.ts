import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CommandIO } from '../src/command.ts';
import { run } from '../src/commands/bridge-trust.ts';
import {
  type FakeImapServer,
  makeTestCertificates,
  startFakeImapServer,
  type TestCertificate,
} from './support/fake-imap-server.ts';
import { requireTestImap, TEST_IMAP, testImapPin } from './support/test-imap.ts';

const SLUG = 'trusted';
/** Named in the config, never set: the command must not need it (D-80). */
const PASSWORD_ENV = 'SIFT_TRUST_TEST_PASSWORD';

let dir: string;
let pin: string;
let fakeCertificate: TestCertificate;
let configCount = 0;
const servers: FakeImapServer[] = [];

beforeAll(async () => {
  await requireTestImap();
  pin = await testImapPin();
  fakeCertificate = (await makeTestCertificates()).captured;
  dir = await mkdtemp(path.join(tmpdir(), 'sift-trust-test-'));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

interface MailboxTarget {
  host?: string;
  port?: number;
  mode?: 'starttls' | 'implicit';
  pin?: string;
}

/** A config.yaml with one mailbox; returns its path. */
async function writeConfig(target: MailboxTarget = {}): Promise<string> {
  configCount += 1;
  const file = path.join(dir, `config-${configCount}.yaml`);
  await writeFile(
    file,
    [
      'version: 1',
      'mailboxes:',
      `  - slug: ${SLUG}`,
      '    imap:',
      `      host: ${target.host ?? TEST_IMAP.host}`,
      `      port: ${target.port ?? TEST_IMAP.port}`,
      '      username: trust-user',
      `      password_env: ${PASSWORD_ENV}`,
      '      folder: INBOX',
      '      tls:',
      `        mode: ${target.mode ?? 'starttls'}`,
      ...(target.pin === undefined ? [] : [`        pin_sha256: ${target.pin}`]),
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

/** Run the command in-process and check that the config file is byte-identical afterwards. */
async function trust(config: string, args: string[] = [SLUG]): Promise<Result> {
  const before = await readFile(config);
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIO = {
    env: { SIFT_CONFIG: config },
    cwd: dir,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  };
  const code = await run(args, io);
  expect((await readFile(config)).equals(before), 'config file unchanged').toBe(true);
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

/** A local port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

describe('sift bridge trust <slug> (D-73)', () => {
  it('exits 0 and says so when the fingerprint matches the configured pin', async () => {
    const result = await trust(await writeConfig({ pin }));

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `Certificate the worker sees for ${SLUG} (${TEST_IMAP.host}:${TEST_IMAP.port}): ${pin} (valid until `,
    );
    expect(result.stdout).toMatch(/\(valid until \d{4}-\d{2}-\d{2}T[\d:.]+Z\)/);
    expect(result.stdout).toContain('It matches imap.tls.pin_sha256.');
    expect(result.stdout).not.toContain('pin_sha256: ');
    expect(result.stderr).toBe('');
  });

  it('exits 1 when the certificate has expired, even though it matches the pin (WR-05)', async () => {
    // Only Date is faked: the 30-day test certificate is a year old "now".
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 365 * 86_400_000);
    try {
      const result = await trust(await writeConfig({ pin }));

      expect(result.code, result.stderr).toBe(1);
      expect(result.stdout).toContain(`): ${pin} (valid until `);
      expect(result.stdout).toMatch(
        /outside its validity dates \(valid from \d{4}-\d{2}-\d{2}T[\d:.]+Z until \d{4}-/,
      );
      expect(result.stdout).toContain("Check this machine's clock.");
      expect(result.stdout).not.toContain('It matches imap.tls.pin_sha256.');
      expect(result.stdout).not.toContain('pin_sha256: ');
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits 1 with the line to paste when no pin is configured', async () => {
    const result = await trust(await writeConfig());

    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toContain(`): ${pin} (valid until `);
    expect(result.stdout).toContain(`No pin is configured for ${SLUG}.`);
    expect(result.stdout).toContain('docker compose run --rm bridge-init printed');
    expect(result.stdout).toContain(`mailboxes[${SLUG}].imap.tls in config/config.yaml:`);
    expect(result.stdout.split('\n')).toContain(`  pin_sha256: ${pin}`);
    expect(result.stdout).toContain('Then restart the worker: docker compose restart worker');
  });

  it('exits 1 with the line to paste when the configured pin differs', async () => {
    const other = createHash('sha256').update('another key').digest('base64');
    expect(other).not.toBe(pin);
    const result = await trust(await writeConfig({ pin: other }));

    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toContain(`It differs from imap.tls.pin_sha256 (${other}).`);
    expect(result.stdout).toContain('replace the pin in config/config.yaml:');
    expect(result.stdout.split('\n')).toContain(`  pin_sha256: ${pin}`);
    expect(result.stdout).toContain('Then restart the worker: docker compose restart worker');
  });

  it('exits 1 for an unknown slug, without connecting', async () => {
    const result = await trust(await writeConfig({ pin }), ['nobody']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('sift bridge trust: no mailbox with slug "nobody"');
    expect(result.stdout).toBe('');
  });

  it('exits 2 with the usage when no slug or an unknown option is given', async () => {
    const config = await writeConfig({ pin });
    for (const args of [[], [SLUG, 'extra'], [SLUG, '--write']]) {
      const result = await trust(config, args);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('Usage: sift bridge trust <slug>');
      expect(result.stdout).toBe('');
    }
  });

  it('exits 1 with a fixed message when the server is unreachable', async () => {
    const port = await closedPort();
    const result = await trust(await writeConfig({ port, pin }));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`sift bridge trust: IMAP server unreachable at 127.0.0.1:${port}`);
    expect(result.stdout).toBe('');
  });

  it('exits 1 with a fixed message when the server offers no STARTTLS', async () => {
    const server = await startFakeImapServer({ mode: 'plain' });
    servers.push(server);
    const result = await trust(await writeConfig({ port: server.port }));

    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `sift bridge trust: IMAP server at 127.0.0.1:${server.port} does not offer STARTTLS; ` +
        'Sift never logs in without TLS',
    );
    expect(result.stdout).toBe('');
    // Nothing was written to a server that offers no STARTTLS.
    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    expect(only(server.connections()).plaintextLines).toEqual([]);
  });

  it('never logs in: one STARTTLS line, the handshake, no bytes after it, no password (D-80)', async () => {
    expect(process.env[PASSWORD_ENV]).toBeUndefined();
    const server = await startFakeImapServer({
      mode: 'starttls',
      certificates: [fakeCertificate],
    });
    servers.push(server);

    const result = await trust(await writeConfig({ port: server.port }));

    expect(result.code, result.stderr).toBe(1);
    expect(result.stdout).toContain(`): ${fakeCertificate.spkiSha256} (valid until `);
    expect(result.stdout.split('\n')).toContain(`  pin_sha256: ${fakeCertificate.spkiSha256}`);
    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    const connection = only(server.connections());
    expect(connection.plaintextLines).toHaveLength(1);
    expect(connection.plaintextLines[0]).toMatch(/^\S+ STARTTLS$/);
    expect(connection.upgraded).toBe(true);
    expect(connection.tlsBytes.length).toBe(0);
  });
});
