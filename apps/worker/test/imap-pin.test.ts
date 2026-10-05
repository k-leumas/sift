import { execFile } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, createServer, type Socket } from 'node:net';
import path from 'node:path';
import { type TLSSocket, connect as tlsConnect } from 'node:tls';
import { promisify } from 'node:util';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { peerSpkiSha256, pemFromDer, spkiSha256 } from '../src/imap/pin.ts';
import {
  appendMessage,
  bumpUidValidity,
  createFolder,
  freshImapUser,
  messageFlags,
  requireTestImap,
  TEST_IMAP,
  testImapCertPem,
} from './support/test-imap.ts';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** The four stages bridge/entrypoint.sh pipes a PEM through (spki_fingerprint). */
const SPKI_STAGES = [
  'openssl x509 -pubkey -noout',
  'openssl pkey -pubin -outform DER',
  'openssl dgst -sha256 -binary',
  'openssl base64 -A',
];

const PIN_FORMAT = /^[A-Za-z0-9+/]{43}=$/;

/** The fingerprint openssl computes from the certificate presented over STARTTLS. */
async function opensslWireFingerprint(port: number): Promise<string> {
  const pipeline = [
    'openssl s_client -starttls imap -connect "127.0.0.1:$SIFT_PIN_PORT" </dev/null 2>/dev/null',
    ...SPKI_STAGES,
  ].join(' | ');
  const pending = execFileAsync('sh', ['-c', pipeline], {
    env: { ...process.env, SIFT_PIN_PORT: String(port) },
  });
  pending.child.stdin?.end();
  const { stdout } = await pending;
  return stdout.trim();
}

/** Read from `socket` until a CRLF-terminated line matching `done` arrives. */
function readUntil(socket: Socket, done: RegExp): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const onData = (chunk: Buffer) => {
      text += chunk.toString('latin1');
      const lines = text.split('\r\n');
      if (lines.slice(0, -1).some((line) => done.test(line))) {
        cleanup();
        resolve(text);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`connection closed before ${done}; got ${JSON.stringify(text)}`));
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.pause();
    };
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
    socket.resume();
  });
}

/** STARTTLS by hand (test code only) and return the TLS socket after the handshake. */
async function startTls(pem: string): Promise<TLSSocket> {
  const socket = connect({ host: TEST_IMAP.host, port: TEST_IMAP.port });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });
    const greeting = await readUntil(socket, /^\* OK/);
    expect(greeting).toContain('STARTTLS');
    socket.write('a STARTTLS\r\n');
    await readUntil(socket, /^a OK/);
    const secure = tlsConnect({
      socket,
      ca: [pem],
      // The test server's certificate names 127.0.0.1; the pin, not the name, is checked.
      checkServerIdentity: () => undefined,
    });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', resolve);
      secure.once('error', reject);
    });
    return secure;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

/** A local port nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

describe('SPKI pin against the STARTTLS test server (D-40, D-73)', () => {
  let pem: string;

  beforeAll(async () => {
    await requireTestImap();
    pem = await testImapCertPem();
  });

  it('spkiSha256 equals the openssl pipeline over the certificate on the wire', async () => {
    const ours = spkiSha256(pem);
    expect(ours).toMatch(PIN_FORMAT);
    expect(await opensslWireFingerprint(TEST_IMAP.port)).toBe(ours);
  });

  it('uses the same openssl pipeline as bridge/entrypoint.sh', () => {
    const entrypoint = readFileSync(path.join(REPO_ROOT, 'bridge/entrypoint.sh'), 'utf8');
    for (const stage of SPKI_STAGES) expect(entrypoint).toContain(stage);
  });

  it('pemFromDer round-trips the test server certificate', () => {
    const der = new X509Certificate(pem).raw;
    const back = pemFromDer(der);
    expect(back.trim()).toBe(pem.trim());
    expect(spkiSha256(back)).toBe(spkiSha256(pem));
  });

  it('pemFromDer rejects bytes that are not a certificate', () => {
    expect(() => pemFromDer(Buffer.from('not a certificate'))).toThrow();
  });

  it('peerSpkiSha256 of a real STARTTLS peer certificate equals spkiSha256 of its PEM', async () => {
    const secure = await startTls(pem);
    try {
      const peer = secure.getPeerCertificate();
      expect(peerSpkiSha256(peer)).toBe(spkiSha256(pem));
      expect(pemFromDer(peer.raw).trim()).toBe(pem.trim());
    } finally {
      secure.destroy();
    }
  });

  it('peerSpkiSha256 refuses a certificate without a public key', () => {
    expect(() => peerSpkiSha256({} as never)).toThrow('peer certificate has no public key');
  });
});

describe('test server harness', () => {
  beforeAll(async () => {
    await requireTestImap();
  });

  it('appends a message that arrives unseen', async () => {
    const user = freshImapUser('pin');
    await appendMessage(
      user,
      'INBOX',
      'From: a@example.test\r\nTo: b@example.test\r\nSubject: harness\r\n' +
        'Message-ID: <harness@example.test>\r\n\r\nhello\r\n',
    );
    const flags = await messageFlags(user, 'INBOX');
    expect([...flags.keys()]).toEqual([1]);
    expect(flags.get(1)).not.toContain('\\Seen');
  });

  it('creates folders and bumps UIDVALIDITY by one each time', async () => {
    const user = freshImapUser('uidvalidity');
    await createFolder(user, 'Archive/Sift');
    await appendMessage(user, 'Archive/Sift', 'Subject: x\r\n\r\nx\r\n');
    expect([...(await messageFlags(user, 'Archive/Sift')).keys()]).toEqual([1]);
    const first = await bumpUidValidity(user, 'Archive/Sift');
    const second = await bumpUidValidity(user, 'Archive/Sift');
    expect(second).toBe(first + 1);
  });
});

describe('requireTestImap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('fails, naming the container and port it expects, when nothing listens', async () => {
    const port = await closedPort();
    vi.stubEnv('SIFT_TEST_IMAP_PORT', String(port));
    vi.resetModules();
    const fresh = await import('./support/test-imap.ts');
    expect(fresh.TEST_IMAP.container).toBe(`sift-test-imap-${port}`);
    await expect(fresh.requireTestImap()).rejects.toThrow(
      `IMAP test server sift-test-imap-${port} not reachable at 127.0.0.1:${port}; ` +
        'run scripts/test-imap.sh up',
    );
  });
});
