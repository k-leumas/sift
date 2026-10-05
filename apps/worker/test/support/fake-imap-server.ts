import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';
import { spkiSha256 } from '../../src/imap/pin.ts';

/**
 * A recording fake IMAP server for wire-level tests (D-80): it records every
 * plaintext line a client sends before TLS and every decrypted byte after it,
 * per connection, so a test can prove what a connection carried.
 */

const execFileAsync = promisify(execFile);

export interface TestCertificate {
  pem: string;
  key: string;
  spkiSha256: string;
}

export interface FakeConnection {
  /** Lines (without CRLF) the client sent before TLS. */
  plaintextLines: string[];
  /** Every decrypted byte the client sent after the TLS handshake. */
  tlsBytes: Buffer;
  /** The TLS handshake completed. */
  upgraded: boolean;
  /** The TCP connection has closed. */
  closed: boolean;
}

export interface FakeImapServerOptions {
  mode: 'plain' | 'starttls' | 'implicit';
  /** First line the server sends (CRLF added). An empty string means it never greets. */
  greeting?: string;
  /** Connection i presents certificates[i]; the last one repeats. Required for TLS modes. */
  certificates?: TestCertificate[];
  /** Reply to the STARTTLS command. Default 'OK'. */
  starttlsReply?: 'OK' | 'BAD';
}

export interface FakeImapServer {
  port: number;
  connections(): FakeConnection[];
  close(): Promise<void>;
}

const DEFAULT_GREETINGS = {
  plain: '* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] fake ready',
  starttls: '* OK [CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN] fake ready',
  implicit: '* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] fake ready',
} as const;

async function openssl(args: string[]): Promise<void> {
  await execFileAsync('openssl', args);
}

const KEY_ARGS = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];

/** Self-signed CA:TRUE certificate shaped like Bridge's and the test server's. */
async function selfSigned(dir: string, name: string): Promise<TestCertificate> {
  const keyFile = path.join(dir, `${name}.key`);
  const certFile = path.join(dir, `${name}.crt`);
  await openssl([
    'req',
    '-x509',
    ...KEY_ARGS,
    '-keyout',
    keyFile,
    '-out',
    certFile,
    '-days',
    '30',
    '-subj',
    `/CN=127.0.0.1/O=sift-fake-${name}`,
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=keyCertSign,digitalSignature',
    '-addext',
    'subjectAltName=IP:127.0.0.1',
  ]);
  const pem = await readFile(certFile, 'utf8');
  return { pem, key: await readFile(keyFile, 'utf8'), spkiSha256: spkiSha256(pem) };
}

/** A leaf certificate signed with `issuer`'s key. */
async function issuedBy(dir: string, name: string, issuer: string): Promise<TestCertificate> {
  const keyFile = path.join(dir, `${name}.key`);
  const csrFile = path.join(dir, `${name}.csr`);
  const certFile = path.join(dir, `${name}.crt`);
  const extFile = path.join(dir, `${name}.ext`);
  await openssl([
    'req',
    '-new',
    ...KEY_ARGS,
    '-keyout',
    keyFile,
    '-out',
    csrFile,
    '-subj',
    `/CN=127.0.0.1/O=sift-fake-${name}`,
  ]);
  await writeFile(
    extFile,
    'basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature\nsubjectAltName=IP:127.0.0.1\n',
  );
  await openssl([
    'x509',
    '-req',
    '-in',
    csrFile,
    '-CA',
    path.join(dir, `${issuer}.crt`),
    '-CAkey',
    path.join(dir, `${issuer}.key`),
    '-set_serial',
    '2',
    '-days',
    '30',
    '-extfile',
    extFile,
    '-out',
    certFile,
  ]);
  const pem = await readFile(certFile, 'utf8');
  return { pem, key: await readFile(keyFile, 'utf8'), spkiSha256: spkiSha256(pem) };
}

/**
 * Three certificates made with openssl in a temporary directory, which is
 * removed before this resolves: `captured` and `unrelated` are self-signed,
 * `issuedByCaptured` is a leaf signed with captured's key.
 */
export async function makeTestCertificates(): Promise<{
  captured: TestCertificate;
  unrelated: TestCertificate;
  issuedByCaptured: TestCertificate;
}> {
  const dir = await mkdtemp(path.join(tmpdir(), 'sift-fake-imap-'));
  try {
    const captured = await selfSigned(dir, 'captured');
    const unrelated = await selfSigned(dir, 'unrelated');
    const issuedByCaptured = await issuedBy(dir, 'issued', 'captured');
    return { captured, unrelated, issuedByCaptured };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Calls onLine for every CRLF-terminated line of a byte stream. */
function lineReader(onLine: (line: string) => void): (chunk: Buffer) => void {
  let text = '';
  return (chunk) => {
    text += chunk.toString('latin1');
    let end = text.indexOf('\r\n');
    while (end >= 0) {
      const line = text.slice(0, end);
      text = text.slice(end + 2);
      onLine(line);
      end = text.indexOf('\r\n');
    }
  };
}

/** `<tag> OK done` to every tagged line. */
function answerTagged(socket: Socket | TLSSocket, line: string): void {
  const tag = /^(\S+) /.exec(line)?.[1];
  if (tag !== undefined && tag !== '*' && !socket.destroyed) socket.write(`${tag} OK done\r\n`);
}

export async function startFakeImapServer(opts: FakeImapServerOptions): Promise<FakeImapServer> {
  const greeting = opts.greeting ?? DEFAULT_GREETINGS[opts.mode];
  const certificates = opts.certificates ?? [];
  if (opts.mode !== 'plain' && certificates.length === 0) {
    throw new Error(`a ${opts.mode} fake needs certificates`);
  }
  const records: FakeConnection[] = [];
  const sockets = new Set<Socket>();

  const greet = (socket: Socket | TLSSocket) => {
    if (greeting !== '') socket.write(`${greeting}\r\n`);
  };

  const startTls = (socket: Socket, record: FakeConnection, index: number) => {
    const certificate = certificates[Math.min(index, certificates.length - 1)];
    if (certificate === undefined) throw new Error('no certificate');
    const secure = new TLSSocket(socket, {
      isServer: true,
      key: certificate.key,
      cert: certificate.pem,
    });
    secure.on('error', () => {
      // A client that rejects the certificate or resets the connection.
    });
    secure.on('secure', () => {
      record.upgraded = true;
      if (opts.mode === 'implicit') greet(secure);
    });
    const read = lineReader((line) => answerTagged(secure, line));
    secure.on('data', (chunk: Buffer) => {
      record.tlsBytes = Buffer.concat([record.tlsBytes, chunk]);
      read(chunk);
    });
  };

  const server = createServer((socket) => {
    const index = records.length;
    const record: FakeConnection = {
      plaintextLines: [],
      tlsBytes: Buffer.alloc(0),
      upgraded: false,
      closed: false,
    };
    records.push(record);
    sockets.add(socket);
    socket.on('error', () => {
      // Reset by the client.
    });
    socket.on('close', () => {
      record.closed = true;
      sockets.delete(socket);
    });

    if (opts.mode === 'implicit') {
      startTls(socket, record, index);
      return;
    }

    const read = lineReader((line) => {
      record.plaintextLines.push(line);
      const starttls = /^(\S+) STARTTLS$/i.exec(line);
      if (opts.mode === 'starttls' && starttls !== null && !record.upgraded) {
        const reply = opts.starttlsReply ?? 'OK';
        socket.write(`${starttls[1]} ${reply} ${reply === 'OK' ? 'begin TLS' : 'no TLS'}\r\n`);
        if (reply === 'OK') {
          socket.off('data', onData);
          startTls(socket, record, index);
        }
        return;
      }
      answerTagged(socket, line);
    });
    const onData = (chunk: Buffer) => read(chunk);
    socket.on('data', onData);
    // A socket without a reader never sees the peer's FIN.
    socket.resume();
    greet(socket);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('fake IMAP server has no port');

  return {
    port: address.port,
    connections: () => records,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
