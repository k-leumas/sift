/**
 * Read the certificate an IMAP server presents, without verifying it, so it can
 * be compared with the owner's pin (`imap.tls.pin_sha256`, D-73).
 *
 * Durable decision: D-80 in 02-CONTEXT.md (also the resolved Open Question 2 in
 * 02-RESEARCH.md and the D-80 entry in the .wolf/cerebrum.md Decision Log).
 * The governing rule is "never send credentials or data over an unverified
 * connection". This module is the only place under apps/worker/src that turns
 * certificate verification off, and only for this handshake: Node runs
 * checkServerIdentity only after the chain verifies, so a self-signed server
 * (Bridge) cannot be pinned by fingerprint alone without first seeing its
 * certificate.
 *
 * What this socket carries, and nothing more:
 * - starttls: the server greeting is read, then exactly one line is written,
 *   `<tag> STARTTLS`, followed by the TLS handshake;
 * - implicit: the TLS handshake only.
 * No capability request, no client ID, no logout, no login commands and no
 * credentials are ever written; the socket is destroyed as soon as the
 * certificate is read. The login connection in connect.ts verifies the same
 * certificate again, twice (chain against the captured certificate, then the
 * SPKI pin), before anything else crosses it.
 *
 * The certificate is returned to the caller and nothing is kept: no module
 * state, no cache, nothing on disk. Every call is a fresh handshake.
 */
import { X509Certificate } from 'node:crypto';
import { isIP, connect as netConnect, type Socket } from 'node:net';
import { type ConnectionOptions, type TLSSocket, connect as tlsConnect } from 'node:tls';
import { pemFromDer, spkiSha256 } from './pin.ts';

export interface CapturedCertificate {
  /** PEM of the leaf certificate the server presented. */
  pem: string;
  /** Its SPKI fingerprint, in the format of `imap.tls.pin_sha256`. */
  spkiSha256: string;
  /** X509Certificate.validTo of the certificate. */
  validTo: string;
  /** X509Certificate.subject of the certificate. */
  subject: string;
}

export interface CaptureOptions {
  host: string;
  port: number;
  mode: 'starttls' | 'implicit';
  /** One deadline for the whole capture, connect included. Default 10000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** The tag of the one command this module writes. */
const TAG = 'C1';
/** A greeting or a STARTTLS reply longer than this is not an IMAP server talking. */
const MAX_PLAINTEXT_BYTES = 16_384;

/** An Error with a stable code, for classifyImapError. */
function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function noStarttls(message: string): Error {
  return codedError('SIFT_NO_STARTTLS', message);
}

/** Capability names from a `[CAPABILITY ...]` response code, or null when there is none. */
function greetingCapabilities(greeting: string): string[] | null {
  const match = /^\* OK \[CAPABILITY ([^\]]*)\]/i.exec(greeting);
  if (match === null) return null;
  return (match[1] ?? '').split(' ').map((name) => name.toUpperCase());
}

function certificateOf(socket: TLSSocket): CapturedCertificate {
  const peer = socket.getPeerCertificate(true);
  if (!peer || !Buffer.isBuffer(peer.raw) || peer.raw.length === 0) {
    throw codedError('SIFT_TLS_NO_CERTIFICATE', 'the IMAP server presented no certificate');
  }
  const pem = pemFromDer(peer.raw);
  const parsed = new X509Certificate(pem);
  return { pem, spkiSha256: spkiSha256(pem), validTo: parsed.validTo, subject: parsed.subject };
}

/**
 * Handshake with the server, read the certificate it presents and close the
 * connection. Rejects with code SIFT_NO_STARTTLS when a starttls server does not
 * offer or refuses STARTTLS, and with SIFT_TLS_CAPTURE_TIMEOUT after timeoutMs.
 */
export function capturePeerCertificate(opts: CaptureOptions): Promise<CapturedCertificate> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // SNI only for host names; an IP literal is not a valid server name.
  const servername = isIP(opts.host) === 0 ? opts.host : undefined;

  return new Promise<CapturedCertificate>((resolve, reject) => {
    let plain: Socket | undefined;
    let secure: TLSSocket | undefined;
    let settled = false;

    const finish = (error: unknown, certificate?: CapturedCertificate) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      secure?.destroy();
      plain?.destroy();
      if (certificate !== undefined && error === undefined) resolve(certificate);
      else reject(error);
    };

    const timer = setTimeout(() => {
      finish(
        codedError(
          'SIFT_TLS_CAPTURE_TIMEOUT',
          `no TLS certificate from ${opts.host}:${opts.port} within ${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);

    const handshake = (options: ConnectionOptions) => {
      secure = tlsConnect({
        ...options,
        servername,
        minVersion: 'TLSv1.2',
        // D-80: verification is off for this read-only handshake alone. The
        // login connection in connect.ts verifies this certificate twice.
        rejectUnauthorized: false,
      });
      secure.once('secureConnect', () => {
        try {
          const certificate = certificateOf(secure as TLSSocket);
          finish(undefined, certificate);
        } catch (error) {
          finish(error);
        }
      });
      secure.on('error', (error) => finish(error));
      secure.on('close', () =>
        finish(codedError('ECONNRESET', 'connection closed during the TLS handshake')),
      );
    };

    if (opts.mode === 'implicit') {
      handshake({ host: opts.host, port: opts.port });
      return;
    }

    const socket = netConnect({ host: opts.host, port: opts.port });
    plain = socket;
    let buffered = '';
    let greeted = false;

    const onClose = () =>
      finish(codedError('ECONNRESET', 'connection closed before the TLS handshake'));

    const upgrade = () => {
      socket.off('data', onData);
      socket.off('close', onClose);
      socket.pause();
      handshake({ socket });
    };

    const onLine = (line: string): boolean => {
      if (!greeted) {
        greeted = true;
        if (/^\* PREAUTH/i.test(line)) {
          finish(noStarttls('the server greets as already authenticated; STARTTLS is impossible'));
          return false;
        }
        if (!/^\* OK/i.test(line)) {
          finish(codedError('SIFT_IMAP_GREETING', 'the server did not greet with OK'));
          return false;
        }
        const capabilities = greetingCapabilities(line);
        if (capabilities !== null && !capabilities.includes('STARTTLS')) {
          // Nothing has been written; nothing will be.
          finish(noStarttls('the server does not offer STARTTLS'));
          return false;
        }
        // The only command this module ever writes.
        socket.write(`${TAG} STARTTLS\r\n`);
        return true;
      }
      if (line.startsWith('* ')) return true; // untagged data before the reply
      const reply = /^(\S+) (OK|NO|BAD)\b/i.exec(line);
      if (reply === null || reply[1] !== TAG) {
        finish(codedError('SIFT_IMAP_PROTOCOL', 'unexpected reply to STARTTLS'));
        return false;
      }
      if ((reply[2] ?? '').toUpperCase() !== 'OK') {
        finish(noStarttls('the server refused STARTTLS'));
        return false;
      }
      return true;
    };

    const onData = (chunk: Buffer) => {
      buffered += chunk.toString('latin1');
      if (buffered.length > MAX_PLAINTEXT_BYTES) {
        finish(codedError('SIFT_IMAP_PROTOCOL', 'oversized plaintext response'));
        return;
      }
      let end = buffered.indexOf('\r\n');
      while (end >= 0 && !settled) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const wasGreeting = !greeted;
        if (!onLine(line)) return;
        if (!wasGreeting && !line.startsWith('* ')) {
          // The tagged OK: a compliant server is silent until the handshake.
          if (buffered.length > 0) {
            finish(codedError('SIFT_IMAP_PROTOCOL', 'plaintext data after the STARTTLS reply'));
            return;
          }
          upgrade();
          return;
        }
        end = buffered.indexOf('\r\n');
      }
    };

    socket.on('data', onData);
    socket.on('error', (error) => finish(error));
    socket.on('close', onClose);
    // A socket without a reader never sees the peer's FIN.
    socket.resume();
  });
}
