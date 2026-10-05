import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import { spkiSha256 } from '../../src/imap/pin.ts';

/**
 * Helpers for the Dovecot test server started by `scripts/test-imap.sh up`.
 * Tests that need it call requireTestImap() first: they fail, never skip, when
 * the server is not running.
 */

const execFileAsync = promisify(execFile);

const DEFAULT_PORT = 31143;
/** Where scripts/test-imap.sh puts the certificate inside the container. */
const CERT_PATH = '/etc/dovecot/ssl/tls.crt';
const GREETING_TIMEOUT_MS = 5_000;

function testImapPort(): number {
  const raw = process.env.SIFT_TEST_IMAP_PORT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`SIFT_TEST_IMAP_PORT must be a port number, got '${raw}'`);
  }
  return port;
}

const port = testImapPort();

/** The test server this process talks to. The container is named after its port. */
export const TEST_IMAP = {
  host: '127.0.0.1',
  port,
  /** Dovecot's static passdb: every user name logs in with this password. */
  password: 'sift-test-password',
  container: `sift-test-imap-${port}`,
} as const;

/**
 * Resolve when the server answers with an IMAP greeting. Otherwise reject with
 * the container and port it expected and how to start it.
 */
export async function requireTestImap(): Promise<void> {
  const { host, port, container } = TEST_IMAP;
  const message = `IMAP test server ${container} not reachable at ${host}:${port}; run scripts/test-imap.sh up`;
  await new Promise<void>((resolve, reject) => {
    const socket = connect({ host, port });
    let greeting = '';
    const fail = (cause?: unknown) => {
      socket.destroy();
      reject(new Error(message, { cause }));
    };
    socket.setTimeout(GREETING_TIMEOUT_MS, () => fail(new Error('no greeting')));
    socket.on('error', fail);
    socket.on('close', () => fail(new Error('closed before the greeting')));
    socket.on('data', (chunk: Buffer) => {
      greeting += chunk.toString('latin1');
      if (!greeting.includes('\r\n')) return;
      socket.removeAllListeners('close');
      socket.destroy();
      if (greeting.startsWith('* OK')) resolve();
      else fail(new Error('unexpected greeting'));
    });
  });
}

/** PEM of the certificate the test server presents. */
export async function testImapCertPem(): Promise<string> {
  const file = process.env.SIFT_TEST_IMAP_CERT_FILE;
  if (file !== undefined && file.trim() !== '') return readFile(file, 'utf8');
  // The image has no cat; its openssl prints the PEM.
  const { stdout } = await execFileAsync('docker', [
    'exec',
    TEST_IMAP.container,
    'openssl',
    'x509',
    '-in',
    CERT_PATH,
  ]);
  return stdout;
}

/** The SPKI pin (config.yaml imap.tls.pin_sha256 format) of the test server. */
export async function testImapPin(): Promise<string> {
  return spkiSha256(await testImapCertPem());
}

/** A user name no other test uses; Dovecot creates its mail home on first use. */
export function freshImapUser(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** Run a command, optionally feeding stdin; resolve stdout or reject with stderr. */
function run(command: string, args: string[], input?: string | Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
      } else {
        const detail = Buffer.concat(stderr).toString('utf8').trim();
        reject(new Error(`${command} ${args.join(' ')} exited ${code}: ${detail}`));
      }
    });
    child.stdin.on('error', () => {
      // A command that exits without reading stdin; 'close' reports it.
    });
    child.stdin.end(input);
  });
}

function doveadm(args: string[], input?: string | Buffer): Promise<string> {
  return run('docker', ['exec', '-i', TEST_IMAP.container, 'doveadm', ...args], input);
}

/** Parse doveadm `-f tab` output into one record per row, keyed by the header. */
function parseTab(output: string): Record<string, string>[] {
  const lines = output.split('\n').filter((line) => line !== '');
  const [header, ...rows] = lines;
  if (header === undefined) return [];
  const columns = header.split('\t');
  return rows.map((row) => {
    const cells = row.split('\t');
    return Object.fromEntries(columns.map((column, i) => [column, cells[i] ?? '']));
  });
}

/** Deliver a raw RFC 5322 message to `folder` of `user` (doveadm save). */
export async function appendMessage(
  user: string,
  folder: string,
  raw: string | Buffer,
): Promise<void> {
  await doveadm(['save', '-u', user, '-m', folder], raw);
}

/** Create `folder` for `user`. Use '/' as the hierarchy separator. */
export async function createFolder(user: string, folder: string): Promise<void> {
  await doveadm(['mailbox', 'create', '-u', user, folder]);
}

/** uid -> sorted flags of every message in `folder`. */
export async function messageFlags(user: string, folder: string): Promise<Map<number, string[]>> {
  const output = await doveadm([
    '-f',
    'tab',
    'fetch',
    '-u',
    user,
    'uid flags',
    'mailbox',
    folder,
    'all',
  ]);
  const flags = new Map<number, string[]>();
  for (const row of parseTab(output)) {
    const uid = Number(row.uid);
    if (!Number.isInteger(uid) || uid < 1) throw new Error(`doveadm fetch gave uid '${row.uid}'`);
    const list = (row.flags ?? '').split(' ').filter((flag) => flag !== '');
    flags.set(uid, list.sort());
  }
  return flags;
}

/** Add `flags` (e.g. ['\\Flagged', '\\Answered']) to message `uid` in `folder` (doveadm flags add). */
export async function setFlags(
  user: string,
  folder: string,
  uid: number,
  flags: string[],
): Promise<void> {
  if (!Number.isInteger(uid) || uid < 1) throw new Error(`setFlags: invalid uid ${uid}`);
  if (flags.length === 0) throw new Error('setFlags: no flags given');
  await doveadm([
    'flags',
    'add',
    '-u',
    user,
    flags.join(' '),
    'mailbox',
    folder,
    'uid',
    String(uid),
  ]);
}

async function uidValidity(user: string, folder: string): Promise<number> {
  const output = await doveadm([
    '-f',
    'tab',
    'mailbox',
    'status',
    '-u',
    user,
    'uidvalidity',
    folder,
  ]);
  const [row] = parseTab(output);
  const value = Number(row?.uidvalidity);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`doveadm mailbox status gave uidvalidity '${row?.uidvalidity}'`);
  }
  return value;
}

/** Force a UIDVALIDITY change on `folder` (current + 1) and return the new value. */
export async function bumpUidValidity(user: string, folder: string): Promise<number> {
  const current = await uidValidity(user, folder);
  // UIDVALIDITY is a non-zero 32-bit value.
  const next = current >= 0xffff_ffff ? 1 : current + 1;
  await doveadm(['mailbox', 'update', '-u', user, '--uid-validity', String(next), folder]);
  return next;
}
