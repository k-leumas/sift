import type { ConnectionOptions, PeerCertificate } from 'node:tls';
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { capturePeerCertificate } from './capture.ts';
import { peerSpkiSha256 } from './pin.ts';

export type { ImapFlow } from 'imapflow';

/**
 * The worker's IMAP connection (D-40, D-42, D-73, D-74, D-80). Rule: never send
 * credentials or data over an unverified connection.
 * - starttls (default) requires the STARTTLS upgrade, implicit uses TLS from the
 *   first byte; there is no plaintext fallback.
 * - With a pin, the presented certificate is captured on a separate handshake
 *   that carries nothing else (capture.ts), compared with the pin, and then used
 *   as the only CA of the login connection, whose checkServerIdentity re-checks
 *   the pin: the connection that carries the password is verified twice.
 * - Without a pin, Node's default chain and hostname verification applies.
 */
export interface BridgeConnectOptions {
  host: string;
  port: number;
  user: string;
  pass: string;
  tls: { mode: 'starttls' | 'implicit'; pinSha256?: string };
  /** Connect, greeting and capture deadline. Default 15000. */
  connectTimeoutMs?: number;
  disableAutoEnable?: boolean;
}

export interface OpenImapDeps {
  createClient?: (options: ImapFlowOptions) => ImapFlow;
  capture?: typeof capturePeerCertificate;
}

export type ImapErrorClass =
  | 'unreachable'
  | 'timeout'
  | 'auth_rejected'
  | 'pin_mismatch'
  | 'cert_untrusted'
  | 'no_starttls'
  | 'protocol';

/** The server presented a certificate whose SPKI fingerprint is not the pin. */
export class PinMismatchError extends Error {
  readonly code = 'SIFT_TLS_PIN_MISMATCH';
  /** The fingerprint the server presented (imap.tls.pin_sha256 format). */
  readonly seen: string;

  constructor(seen: string) {
    super(`the IMAP server's certificate fingerprint ${seen} does not match imap.tls.pin_sha256`);
    this.name = 'PinMismatchError';
    this.seen = seen;
  }
}

const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 120_000;
const LOGOUT_TIMEOUT_MS = 5_000;

/**
 * TLS options for the login connection. Pinned: capture afresh (never cached,
 * D-80), compare, then trust only the captured certificate and re-check the pin.
 */
async function loginTls(
  opts: BridgeConnectOptions,
  capture: typeof capturePeerCertificate,
  timeoutMs: number,
): Promise<ConnectionOptions> {
  const pin = opts.tls.pinSha256;
  if (pin === undefined) return { minVersion: 'TLSv1.2' };

  const captured = await capture({
    host: opts.host,
    port: opts.port,
    mode: opts.tls.mode,
    timeoutMs,
  });
  if (captured.spkiSha256 !== pin) throw new PinMismatchError(captured.spkiSha256);

  return {
    ca: [captured.pem],
    minVersion: 'TLSv1.2',
    // Runs only after the chain verified against the captured certificate. The
    // hostname is ignored: the pin, not the name, identifies the server (D-40).
    checkServerIdentity: (_host: string, cert: PeerCertificate) => {
      let seen: string;
      try {
        seen = peerSpkiSha256(cert);
      } catch {
        return new PinMismatchError('(no public key)');
      }
      return seen === pin ? undefined : new PinMismatchError(seen);
    },
  };
}

type RunFn = (command: string, ...args: unknown[]) => Promise<unknown>;

/** Commands ImapFlow may send before TLS: protocol negotiation only (D-80). */
const PLAINTEXT_COMMANDS = new Set(['CAPABILITY', 'STARTTLS']);
/** Optional commands skipped before TLS; ID is sent again after login, over TLS. */
const PLAINTEXT_SKIPPED = new Set(['ID', 'LOGOUT']);

/**
 * ImapFlow sends ID (client name and version) before STARTTLS when the server
 * advertises it. Keep everything but CAPABILITY and STARTTLS off the plaintext
 * phase: skip ID and LOGOUT there, refuse anything else.
 */
function guardPlaintext(client: ImapFlow): void {
  const target = client as unknown as { run: RunFn };
  const run = target.run;
  target.run = (command: string, ...args: unknown[]) => {
    const name = command.toUpperCase();
    if (!client.secureConnection && !PLAINTEXT_COMMANDS.has(name)) {
      if (PLAINTEXT_SKIPPED.has(name)) return Promise.resolve(undefined);
      return Promise.reject(
        Object.assign(new Error(`refusing to send ${name} before TLS`), {
          code: 'SIFT_TLS_REQUIRED',
        }),
      );
    }
    return run.call(client, command, ...args);
  };
}

/** Connected and authenticated client, or the original error after closing it. */
export async function openImap(
  opts: BridgeConnectOptions,
  deps: OpenImapDeps = {},
): Promise<ImapFlow> {
  const timeoutMs = opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const tls = await loginTls(opts, deps.capture ?? capturePeerCertificate, timeoutMs);

  const options: ImapFlowOptions = {
    host: opts.host,
    port: opts.port,
    ...(opts.tls.mode === 'starttls' ? { secure: false, doSTARTTLS: true } : { secure: true }),
    auth: { user: opts.user, pass: opts.pass },
    tls,
    logger: false,
    disableAutoIdle: true,
    clientInfo: { name: 'Sift' },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: SOCKET_TIMEOUT_MS,
    ...(opts.disableAutoEnable === undefined ? {} : { disableAutoEnable: opts.disableAutoEnable }),
  };

  const client = (deps.createClient ?? ((o: ImapFlowOptions) => new ImapFlow(o)))(options);
  guardPlaintext(client);
  // ImapFlow closes the connection before emitting 'error'; the next command
  // then rejects with NoConnection, which is where callers see the failure.
  // Without a listener the emit would throw out of a socket callback.
  client.on('error', () => {});
  try {
    await client.connect();
  } catch (error) {
    await closeImap(client);
    throw error;
  }
  return client;
}

/** Log out (bounded by 5 s), then close. Never throws. */
export async function closeImap(client: ImapFlow): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.logout().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LOGOUT_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // logout() threw synchronously; close below.
  } finally {
    clearTimeout(timer);
    try {
      client.close();
    } catch {
      // Already closed.
    }
  }
}

const UNREACHABLE = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EHOSTDOWN',
  'NoConnection',
  'EConnectionClosed',
  'ClosedAfterConnectText',
  'ClosedAfterConnectTLS',
]);

const TIMEOUT = new Set([
  'ETIMEDOUT',
  'ETIMEOUT',
  'CONNECT_TIMEOUT',
  'GREETING_TIMEOUT',
  'UPGRADE_TIMEOUT',
  'SIFT_TLS_CAPTURE_TIMEOUT',
]);

const CERT_UNTRUSTED = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_SIGNATURE_FAILURE',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'INVALID_CA',
  'INVALID_PURPOSE',
  'PATH_LENGTH_EXCEEDED',
  'HOSTNAME_MISMATCH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const NO_STARTTLS = new Set(['SIFT_NO_STARTTLS']);

const MAX_CAUSE_DEPTH = 5;

/** One level of an error: its class, or null to look at its cause. */
function classifyOne(error: object): ImapErrorClass | null {
  const { code, authenticationFailed, tlsFailed } = error as {
    code?: unknown;
    authenticationFailed?: unknown;
    tlsFailed?: unknown;
  };
  if (code === 'SIFT_TLS_PIN_MISMATCH') return 'pin_mismatch';
  if (authenticationFailed === true) return 'auth_rejected';
  if (typeof code === 'string') {
    if (CERT_UNTRUSTED.has(code)) return 'cert_untrusted';
    if (NO_STARTTLS.has(code)) return 'no_starttls';
    if (TIMEOUT.has(code)) return 'timeout';
    if (UNREACHABLE.has(code)) return 'unreachable';
  }
  // ImapFlow's "STARTTLS required but not offered" error has no code, only this flag.
  if (tlsFailed === true) return 'no_starttls';
  return null;
}

/**
 * Stable class of an IMAP connection error, from codes and ImapFlow's flags
 * only (never message text, which can hold server replies), following `cause`
 * up to 5 levels.
 */
export function classifyImapError(error: unknown): ImapErrorClass {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (current === null || typeof current !== 'object') break;
    const found = classifyOne(current);
    if (found !== null) return found;
    current = (current as { cause?: unknown }).cause;
  }
  return 'protocol';
}
