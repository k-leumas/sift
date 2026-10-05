import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { capturePeerCertificate } from '../src/imap/capture.ts';
import {
  type FakeImapServer,
  type FakeImapServerOptions,
  makeTestCertificates,
  startFakeImapServer,
  type TestCertificate,
} from './support/fake-imap-server.ts';
import { requireTestImap, TEST_IMAP, testImapPin } from './support/test-imap.ts';

const SRC = path.resolve(import.meta.dirname, '../src');

let certificates: { captured: TestCertificate; unrelated: TestCertificate };
const servers: FakeImapServer[] = [];

async function fake(opts: FakeImapServerOptions): Promise<FakeImapServer> {
  const server = await startFakeImapServer(opts);
  servers.push(server);
  return server;
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  return items[0] as T;
}

beforeAll(async () => {
  certificates = await makeTestCertificates();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('capturePeerCertificate on the wire (D-80)', () => {
  it('starttls: writes only the STARTTLS line, then the handshake, and nothing after it', async () => {
    const server = await fake({ mode: 'starttls', certificates: [certificates.captured] });

    const captured = await capturePeerCertificate({
      host: '127.0.0.1',
      port: server.port,
      mode: 'starttls',
    });

    expect(captured.spkiSha256).toBe(certificates.captured.spkiSha256);
    expect(captured.pem).toContain('BEGIN CERTIFICATE');
    expect(captured.subject).toContain('sift-fake-captured');
    expect(captured.validTo).not.toBe('');
    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    const connection = only(server.connections());
    expect(connection.plaintextLines).toHaveLength(1);
    expect(connection.plaintextLines[0]).toMatch(/^\S+ STARTTLS$/);
    expect(connection.upgraded).toBe(true);
    expect(connection.tlsBytes.length).toBe(0);
  });

  it('implicit: writes nothing at all beyond the handshake', async () => {
    const server = await fake({ mode: 'implicit', certificates: [certificates.captured] });

    const captured = await capturePeerCertificate({
      host: '127.0.0.1',
      port: server.port,
      mode: 'implicit',
    });

    expect(captured.spkiSha256).toBe(certificates.captured.spkiSha256);
    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    const connection = only(server.connections());
    expect(connection.plaintextLines).toEqual([]);
    expect(connection.upgraded).toBe(true);
    expect(connection.tlsBytes.length).toBe(0);
  });

  it('rejects a server whose greeting does not offer STARTTLS, having written nothing', async () => {
    const server = await fake({ mode: 'plain' });

    await expect(
      capturePeerCertificate({ host: '127.0.0.1', port: server.port, mode: 'starttls' }),
    ).rejects.toMatchObject({ code: 'SIFT_NO_STARTTLS' });

    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    expect(only(server.connections()).plaintextLines).toEqual([]);
  });

  it('rejects a server that answers BAD to STARTTLS, after the one STARTTLS line', async () => {
    const server = await fake({
      mode: 'starttls',
      certificates: [certificates.captured],
      starttlsReply: 'BAD',
    });

    await expect(
      capturePeerCertificate({ host: '127.0.0.1', port: server.port, mode: 'starttls' }),
    ).rejects.toMatchObject({ code: 'SIFT_NO_STARTTLS' });

    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    const connection = only(server.connections());
    expect(connection.plaintextLines).toHaveLength(1);
    expect(connection.plaintextLines[0]).toMatch(/^\S+ STARTTLS$/);
    expect(connection.upgraded).toBe(false);
  });

  it('sends no capability request when the greeting has no capability code', async () => {
    const server = await fake({
      mode: 'starttls',
      greeting: '* OK fake ready',
      certificates: [certificates.captured],
    });

    const captured = await capturePeerCertificate({
      host: '127.0.0.1',
      port: server.port,
      mode: 'starttls',
    });

    expect(captured.spkiSha256).toBe(certificates.captured.spkiSha256);
    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    const connection = only(server.connections());
    expect(connection.plaintextLines).toHaveLength(1);
    expect(connection.plaintextLines[0]).toMatch(/^\S+ STARTTLS$/);
    expect(connection.tlsBytes.length).toBe(0);
  });

  it('gives up within timeoutMs on a server that never greets, having written nothing', async () => {
    const server = await fake({ mode: 'plain', greeting: '' });
    const started = Date.now();

    await expect(
      capturePeerCertificate({
        host: '127.0.0.1',
        port: server.port,
        mode: 'starttls',
        timeoutMs: 300,
      }),
    ).rejects.toMatchObject({ code: 'SIFT_TLS_CAPTURE_TIMEOUT' });

    expect(Date.now() - started).toBeLessThan(2_000);
    await vi.waitFor(() => expect(only(server.connections()).closed).toBe(true));
    const connection = only(server.connections());
    expect(connection.plaintextLines).toEqual([]);
    expect(connection.tlsBytes.length).toBe(0);
  });
});

describe('capturePeerCertificate against the Dovecot test server', () => {
  beforeAll(async () => {
    await requireTestImap();
  });

  it('returns the certificate whose SPKI fingerprint is the test server pin', async () => {
    const captured = await capturePeerCertificate({
      host: TEST_IMAP.host,
      port: TEST_IMAP.port,
      mode: 'starttls',
    });
    expect(captured.spkiSha256).toBe(await testImapPin());
  });
});

describe('static guarantees (D-80)', () => {
  // Built from parts so this file does not contain the literals it looks for.
  const verificationOff = new RegExp(['reject', 'Unauthorized', '\\s*:\\s*', 'fal', 'se'].join(''));
  const authCommand = new RegExp(['LOG', 'IN', '|', 'AUTHEN', 'TICATE'].join(''));
  const fsImport = new RegExp(
    [
      '(from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*)[\'"]',
      '(node:)?',
      'f',
      's',
      '(/promises)?[\'"]',
    ].join(''),
  );

  async function sourceFiles(): Promise<string[]> {
    const entries = await readdir(SRC, { recursive: true });
    return entries.filter((entry) => /\.[cm]?[jt]s$/.test(entry)).sort();
  }

  async function source(relative: string): Promise<string> {
    return readFile(path.join(SRC, relative), 'utf8');
  }

  it('only imap/capture.ts turns certificate verification off', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      if (verificationOff.test(await source(file))) offenders.push(file.split(path.sep).join('/'));
    }
    expect(offenders).toEqual(['imap/capture.ts']);
  });

  it('capture.ts names no IMAP authentication command', async () => {
    expect(await source('imap/capture.ts')).not.toMatch(authCommand);
  });

  it('neither capture.ts nor connect.ts imports a filesystem module', async () => {
    expect(await source('imap/capture.ts')).not.toMatch(fsImport);
    expect(await source('imap/connect.ts')).not.toMatch(fsImport);
  });

  it('the filesystem pattern matches the import forms it is meant to catch', () => {
    const quote = "'";
    expect(`import { readFile } from ${quote}node:${'f'}s/promises${quote};`).toMatch(fsImport);
    expect(`import x from ${quote}${'f'}s${quote};`).toMatch(fsImport);
    expect(`await import(${quote}node:${'f'}s${quote})`).toMatch(fsImport);
  });
});
