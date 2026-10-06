import { createServer } from 'node:net';
import { ImapFlow, type ImapFlowOptions } from 'imapflow';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CapturedCertificate, capturePeerCertificate } from '../src/imap/capture.ts';
import {
  type BridgeConnectOptions,
  classifyImapError,
  closeImap,
  openImap,
  PinMismatchError,
} from '../src/imap/connect.ts';
import {
  type FakeConnection,
  type FakeImapServer,
  type FakeImapServerOptions,
  makeTestCertificates,
  startFakeImapServer,
  type TestCertificate,
} from './support/fake-imap-server.ts';
import { freshImapUser, requireTestImap, TEST_IMAP, testImapPin } from './support/test-imap.ts';

// Built from parts so this file does not spell the commands it looks for.
const AUTH_COMMAND = new RegExp(['^\\S+ (LOG', 'IN|AUTHEN', 'TICATE)\\b'].join(''), 'i');
const NEGOTIATION_ONLY = /^\S+ (CAPABILITY|STARTTLS)$/i;
/** Bridge v3.27.0's pre-login capability list (RESEARCH), which includes ID. */
const BRIDGE_GREETING =
  '* OK [CAPABILITY IMAP4rev1 UNSELECT UIDPLUS MOVE ID IDLE STARTTLS AUTH=PLAIN] fake ready';
/** A well-formed pin that matches no certificate in these tests. */
const OTHER_PIN = Buffer.alloc(32, 7).toString('base64');

type TlsMode = BridgeConnectOptions['tls']['mode'];

let certs: {
  captured: TestCertificate;
  unrelated: TestCertificate;
  issuedByCaptured: TestCertificate;
};
const servers: FakeImapServer[] = [];

async function fake(opts: FakeImapServerOptions): Promise<FakeImapServer> {
  const server = await startFakeImapServer(opts);
  servers.push(server);
  return server;
}

/** Fake-server connection options; the password never reaches a fake in these tests. */
function fakeOptions(port: number, tls: BridgeConnectOptions['tls']): BridgeConnectOptions {
  return {
    host: '127.0.0.1',
    port,
    user: 'owner@example.test',
    pass: 'not-a-real-password',
    tls,
    connectTimeoutMs: 3_000,
  };
}

function dovecotOptions(tls: BridgeConnectOptions['tls'], user = 'connect'): BridgeConnectOptions {
  return {
    host: TEST_IMAP.host,
    port: TEST_IMAP.port,
    user: freshImapUser(user),
    pass: TEST_IMAP.password,
    tls,
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

function expectNoAuthCommand(connection: FakeConnection): void {
  expect(connection.plaintextLines.filter((line) => AUTH_COMMAND.test(line))).toEqual([]);
  expect(connection.tlsBytes.length).toBe(0);
}

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

beforeAll(async () => {
  certs = await makeTestCertificates();
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('openImap against the Dovecot test server', () => {
  let pin: string;

  beforeAll(async () => {
    await requireTestImap();
    pin = await testImapPin();
  });

  it('logs in over STARTTLS through the capture, the pin and a doubly verified connection', async () => {
    const client = await openImap(dovecotOptions({ mode: 'starttls', pinSha256: pin }, 'tracer'));
    try {
      const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
      expect(Number(mailbox.uidValidity)).toBeGreaterThan(0);
    } finally {
      await expect(closeImap(client)).resolves.toBeUndefined();
    }
  });

  it('fails with PinMismatchError before any client exists when the pin differs', async () => {
    const createClient = vi.fn((o: ImapFlowOptions) => new ImapFlow(o));

    const error = await failure(
      openImap(dovecotOptions({ mode: 'starttls', pinSha256: OTHER_PIN }), { createClient }),
    );

    expect(error).toBeInstanceOf(PinMismatchError);
    expect((error as PinMismatchError).seen).toBe(pin);
    expect(classifyImapError(error)).toBe('pin_mismatch');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps chain and hostname verification without a pin: a self-signed server is untrusted', async () => {
    const error = await failure(openImap(dovecotOptions({ mode: 'starttls' })));
    expect(classifyImapError(error)).toBe('cert_untrusted');
  });

  it('classifies a wrong password as auth_rejected', async () => {
    const error = await failure(
      openImap({ ...dovecotOptions({ mode: 'starttls', pinSha256: pin }), pass: 'wrong' }),
    );
    expect(classifyImapError(error)).toBe('auth_rejected');
  });

  it('captures afresh on every call, and each login trusts its own capture', async () => {
    const returned: CapturedCertificate[] = [];
    const capture = vi.fn(async (opts: Parameters<typeof capturePeerCertificate>[0]) => {
      const real = await capturePeerCertificate(opts);
      // A distinct but equivalent PEM per call, so each `ca` can be traced to its capture.
      const mine = { ...real, pem: `${real.pem}${'\n'.repeat(returned.length + 1)}` };
      returned.push(mine);
      return mine;
    });
    const createClient = vi.fn((o: ImapFlowOptions) => new ImapFlow(o));
    const tls = { mode: 'starttls', pinSha256: pin } as const;

    for (let i = 0; i < 2; i += 1) {
      await closeImap(await openImap(dovecotOptions(tls), { capture, createClient }));
    }
    expect(capture).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenCalledTimes(2);
    for (const [i, call] of createClient.mock.calls.entries()) {
      expect(call[0].tls?.ca).toEqual([returned[i]?.pem]);
    }

    capture.mockClear();
    createClient.mockClear();
    await failure(
      openImap(dovecotOptions({ mode: 'starttls', pinSha256: OTHER_PIN }), {
        capture,
        createClient,
      }),
    );
    await closeImap(await openImap(dovecotOptions(tls), { capture, createClient }));
    expect(capture).toHaveBeenCalledTimes(2);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient.mock.calls[0]?.[0].tls?.ca).toEqual([returned.at(-1)?.pem]);
  });
});

describe('openImap fails closed against fake servers', () => {
  const swaps = [
    { mode: 'starttls', swapped: 'unrelated', expected: 'cert_untrusted' },
    { mode: 'starttls', swapped: 'issuedByCaptured', expected: 'pin_mismatch' },
    { mode: 'implicit', swapped: 'unrelated', expected: 'cert_untrusted' },
    { mode: 'implicit', swapped: 'issuedByCaptured', expected: 'pin_mismatch' },
  ] as const;

  it.each(swaps)(
    '$mode: a $swapped certificate on the login connection fails as $expected before any login command',
    async ({ mode, swapped, expected }) => {
      const server = await fake({ mode, certificates: [certs.captured, certs[swapped]] });

      const error = await failure(
        openImap(fakeOptions(server.port, { mode, pinSha256: certs.captured.spkiSha256 })),
      );

      expect(classifyImapError(error)).toBe(expected);
      const connections = server.connections();
      expect(connections).toHaveLength(2);
      for (const connection of connections) expectNoAuthCommand(connection);
    },
  );

  it('refuses a server without STARTTLS and sends it no login command', async () => {
    const server = await fake({ mode: 'plain' });

    const error = await failure(openImap(fakeOptions(server.port, { mode: 'starttls' })));

    expect(classifyImapError(error)).toBe('no_starttls');
    const connection = server.connections()[0];
    expect(connection).toBeDefined();
    expectNoAuthCommand(connection as FakeConnection);
    expect(connection?.plaintextLines).toEqual([]);
  });

  it('refuses a server without STARTTLS when pinned, at the capture', async () => {
    const server = await fake({ mode: 'plain' });
    const createClient = vi.fn((o: ImapFlowOptions) => new ImapFlow(o));

    const error = await failure(
      openImap(fakeOptions(server.port, { mode: 'starttls', pinSha256: OTHER_PIN }), {
        createClient,
      }),
    );

    expect(classifyImapError(error)).toBe('no_starttls');
    expect(createClient).not.toHaveBeenCalled();
    expect(server.connections().map((connection) => connection.plaintextLines)).toEqual([[]]);
  });

  it.each([
    { greeting: BRIDGE_GREETING, name: 'a Bridge-like greeting offering ID' },
    { greeting: undefined, name: 'the default greeting' },
  ])(
    'sends only CAPABILITY and STARTTLS before TLS on the login connection ($name)',
    async ({ greeting }) => {
      const server = await fake({
        mode: 'starttls',
        certificates: [certs.captured, certs.captured],
        ...(greeting === undefined ? {} : { greeting }),
      });

      // What happens after TLS does not matter here.
      await openImap(
        fakeOptions(server.port, { mode: 'starttls', pinSha256: certs.captured.spkiSha256 }),
      )
        .then(closeImap)
        .catch(() => undefined);

      const login = server.connections()[1];
      expect(login).toBeDefined();
      const lines = login?.plaintextLines ?? [];
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).toMatch(NEGOTIATION_ONLY);
      expect(lines.at(-1)).toMatch(/^\S+ STARTTLS$/i);
      expect(login?.upgraded).toBe(true);
    },
  );

  it('classifies a closed port as unreachable', async () => {
    const port = await closedPort();
    const error = await failure(openImap(fakeOptions(port, { mode: 'starttls' })));
    expect(classifyImapError(error)).toBe('unreachable');
    const pinned = await failure(
      openImap(fakeOptions(port, { mode: 'starttls', pinSha256: OTHER_PIN })),
    );
    expect(classifyImapError(pinned)).toBe('unreachable');
  });
});

describe('classifyImapError', () => {
  const coded = (code: string) => Object.assign(new Error('x'), { code });

  it.each([
    ['SIFT_TLS_PIN_MISMATCH', 'pin_mismatch'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'cert_untrusted'],
    ['SELF_SIGNED_CERT_IN_CHAIN', 'cert_untrusted'],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'cert_untrusted'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'cert_untrusted'],
    ['CERT_HAS_EXPIRED', 'cert_expired'],
    ['CERT_NOT_YET_VALID', 'cert_expired'],
    ['SIFT_NO_STARTTLS', 'no_starttls'],
    ['ETIMEDOUT', 'timeout'],
    ['GREETING_TIMEOUT', 'timeout'],
    ['SIFT_TLS_CAPTURE_TIMEOUT', 'timeout'],
    ['ECONNREFUSED', 'unreachable'],
    ['ENOTFOUND', 'unreachable'],
    ['ECONNRESET', 'unreachable'],
    ['NoConnection', 'unreachable'],
    ['EConnectionClosed', 'unreachable'],
    ['SOMETHING_ELSE', 'protocol'],
  ] as const)('%s gives %s', (code, expected) => {
    expect(classifyImapError(coded(code))).toBe(expected);
  });

  it('reads ImapFlow flags and PinMismatchError', () => {
    expect(classifyImapError(Object.assign(new Error('x'), { authenticationFailed: true }))).toBe(
      'auth_rejected',
    );
    expect(classifyImapError(Object.assign(new Error('x'), { tlsFailed: true }))).toBe(
      'no_starttls',
    );
    expect(classifyImapError(new PinMismatchError(OTHER_PIN))).toBe('pin_mismatch');
  });

  it('follows cause up to five levels, and no further', () => {
    const wrap = (inner: unknown, levels: number): unknown => {
      let error = inner;
      for (let i = 0; i < levels; i += 1) error = new Error('wrapper', { cause: error });
      return error;
    };
    expect(classifyImapError(wrap(coded('DEPTH_ZERO_SELF_SIGNED_CERT'), 5))).toBe('cert_untrusted');
    expect(classifyImapError(wrap(coded('DEPTH_ZERO_SELF_SIGNED_CERT'), 6))).toBe('protocol');
  });

  it('gives protocol for anything without a known code', () => {
    expect(classifyImapError(new Error('Connection refused by owner@example.test'))).toBe(
      'protocol',
    );
    expect(classifyImapError('ECONNREFUSED')).toBe('protocol');
    expect(classifyImapError(undefined)).toBe('protocol');
  });
});

describe('the TLS mode reaches ImapFlow unchanged', () => {
  it.each([
    ['starttls', { secure: false, doSTARTTLS: true }],
    ['implicit', { secure: true }],
  ] as const)('%s', async (mode: TlsMode, expected) => {
    const createClient = vi.fn((o: ImapFlowOptions) => {
      const client = new ImapFlow(o);
      vi.spyOn(client, 'connect').mockRejectedValue(Object.assign(new Error('x'), { code: 'X' }));
      return client;
    });
    await failure(openImap(fakeOptions(1, { mode }), { createClient }));
    const options = createClient.mock.calls[0]?.[0];
    expect(options).toMatchObject({ ...expected, logger: false, disableAutoIdle: true });
    if (mode === 'implicit') expect(options?.doSTARTTLS).toBeUndefined();
    expect(options?.tls).toEqual({ minVersion: 'TLSv1.2' });
  });
});
