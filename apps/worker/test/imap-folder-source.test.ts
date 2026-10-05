import { readFile } from 'node:fs/promises';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closeImap, type ImapFlow, openImap } from '../src/imap/connect.ts';
import { createFolderSource } from '../src/imap/folder-source.ts';
import { parseMessage } from '../src/ingest/message.ts';
import {
  appendMessage,
  freshImapUser,
  requireTestImap,
  TEST_IMAP,
  testImapPin,
} from './support/test-imap.ts';

const FIXTURES = new URL('./fixtures/mail/', import.meta.url);

function fixture(name: string): Promise<Buffer> {
  return readFile(new URL(name, FIXTURES));
}

let pin: string;
const clients: ImapFlow[] = [];

async function connect(user: string): Promise<ImapFlow> {
  const client = await openImap({
    host: TEST_IMAP.host,
    port: TEST_IMAP.port,
    user,
    pass: TEST_IMAP.password,
    tls: { mode: 'starttls', pinSha256: pin },
  });
  clients.push(client);
  return client;
}

beforeAll(async () => {
  await requireTestImap();
  pin = await testImapPin();
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => closeImap(client)));
});

describe('createFolderSource against the Dovecot test server', () => {
  it('examines read-only and fetches a real message into a HeaderRecord the parser accepts', async () => {
    const user = freshImapUser('folder-source-tracer');
    await appendMessage(user, 'INBOX', await fixture('plain.eml'));
    const client = await connect(user);
    const source = createFolderSource(client);

    const status = await source.examine('INBOX');
    expect(typeof status.uidValidity).toBe('number');
    expect(status.uidValidity).toBeGreaterThan(0);
    expect(status.exists).toBe(1);
    expect(client.mailbox === false ? undefined : client.mailbox.readOnly).toBe(true);

    const dates = await source.fetchDates('1:*');
    expect(dates).toHaveLength(1);
    const [first] = dates;
    expect(first?.internalDate).toBeInstanceOf(Date);
    const uid = first?.uid as number;

    const [record] = await source.fetchHeaders([uid]);
    expect(record?.uid).toBe(uid);
    expect(record?.rawHeaders.length).toBeGreaterThan(0);
    expect(record?.size).toBeGreaterThan(0);

    const parsed = parseMessage(record as NonNullable<typeof record>, { trustPmHeader: false });
    expect(parsed.identityKey.startsWith('mid:')).toBe(true);
    expect(parsed.subject).toBe('Weekly garden club update');
    expect(parsed.fromDomain).toBe('example.test');
    expect(parsed.textPart).toEqual({ part: '1', kind: 'text_plain' });
  });
});
