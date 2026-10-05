import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeImap, type ImapFlow, openImap } from '../src/imap/connect.ts';
import { createFolderSource, toUidSet } from '../src/imap/folder-source.ts';
import {
  attachmentsOf,
  BODY_DOWNLOAD_MAX_BYTES,
  parseMessage,
  selectTextPart,
  toBodyText,
} from '../src/ingest/message.ts';
import type { FolderSource, HeaderRecord } from '../src/ingest/types.ts';
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

const FIXTURES = new URL('./fixtures/mail/', import.meta.url);
const FIXTURE_NAMES = [
  'plain.eml',
  'alternative.eml',
  'html-only.eml',
  'attachment.eml',
  'encoded-headers.eml',
  'no-message-id.eml',
  'exact-64.eml',
] as const;
type FixtureName = (typeof FIXTURE_NAMES)[number];

function fixture(name: FixtureName): Promise<Buffer> {
  return readFile(new URL(name, FIXTURES));
}

const DAY_MS = 86_400_000;

describe('toUidSet', () => {
  it('sorts, deduplicates and compresses runs', () => {
    expect(toUidSet([5, 1, 2, 3, 9, 10, 10])).toBe('1:3,5,9:10');
    expect(toUidSet([1, 2, 3, 7, 9, 10])).toBe('1:3,7,9:10');
    expect(toUidSet([42])).toBe('42');
    expect(toUidSet([4_294_967_295, 4_294_967_294])).toBe('4294967294:4294967295');
  });

  it('throws on an empty list or a value that is not a uid', () => {
    expect(() => toUidSet([])).toThrow(/empty/);
    expect(() => toUidSet([0])).toThrow(/uid/);
    expect(() => toUidSet([1.5])).toThrow(/uid/);
    expect(() => toUidSet([4_294_967_296])).toThrow(/uid/);
  });
});

/** Minimal client double for the paths a real server cannot be made to take. */
function stubClient(overrides: Record<string, unknown>): ImapFlow {
  const mailbox = { path: 'INBOX', uidValidity: 7n, uidNext: 5, exists: 4, readOnly: true };
  const client: Record<string, unknown> = {
    mailbox: false,
    async mailboxOpen() {
      client.mailbox = { ...mailbox, ...((overrides.mailbox as object) ?? {}) };
      return client.mailbox;
    },
    ...overrides,
  };
  return client as unknown as ImapFlow;
}

describe('createFolderSource guards (client double)', () => {
  it('fails closed when the server opened the folder read-write', async () => {
    const source = createFolderSource(stubClient({ mailbox: { readOnly: false } }));
    await expect(source.examine('INBOX')).rejects.toThrow(/INBOX.*read-write/);
  });

  it('throws when UID SEARCH fails instead of reporting an empty folder', async () => {
    const search = vi.fn(async () => false);
    const source = createFolderSource(stubClient({ search }));
    await source.examine('INBOX');
    await expect(source.listUids('1:*')).rejects.toThrow(/FolderSource\.listUids.*INBOX/);
    await expect(source.searchSince(new Date())).rejects.toThrow(
      /FolderSource\.searchSince.*INBOX/,
    );
  });

  it('throws when the part to download is not found', async () => {
    const download = vi.fn(async () => ({}));
    const source = createFolderSource(stubClient({ download }));
    await source.examine('INBOX');
    await expect(source.downloadText(3, '1', 64)).rejects.toThrow(
      /FolderSource\.downloadText.*uid 3.*part 1/,
    );
  });

  it('never cuts a UTF-8 character in half at the byte cap', async () => {
    // 'aé' is 3 bytes; a 2-byte cap would end inside the é.
    const download = vi.fn(async () => ({
      meta: { expectedSize: 3 },
      content: Readable.from([Buffer.from('aé€', 'utf8')]),
    }));
    const source = createFolderSource(stubClient({ download }));
    await source.examine('INBOX');
    const result = await source.downloadText(3, '1', 2);
    expect(result).toEqual({ text: 'a', truncated: true });
  });
});

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

/** A fresh user whose `folder` holds `names`, in order; returns uid by fixture. */
async function mailboxWith(
  prefix: string,
  names: readonly FixtureName[],
  folder = 'INBOX',
): Promise<{ user: string; uids: Map<FixtureName, number> }> {
  const user = freshImapUser(prefix);
  if (folder !== 'INBOX') await createFolder(user, folder);
  for (const name of names) await appendMessage(user, folder, await fixture(name));
  // doveadm save assigns UIDs 1..n in delivery order on a new folder.
  return { user, uids: new Map(names.map((name, i) => [name, i + 1])) };
}

async function headerOf(source: FolderSource, uid: number): Promise<HeaderRecord> {
  const [record] = await source.fetchHeaders([uid]);
  if (record === undefined) throw new Error(`no header record for uid ${uid}`);
  return record;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

describe('createFolderSource against the Dovecot test server', () => {
  beforeAll(async () => {
    await requireTestImap();
    pin = await testImapPin();
  });

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => closeImap(client)));
  });

  it('examines read-only and fetches a real message into a HeaderRecord the parser accepts', async () => {
    const { user } = await mailboxWith('folder-source-tracer', ['plain.eml']);
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

    const record = await headerOf(source, uid);
    expect(record.uid).toBe(uid);
    expect(record.rawHeaders.length).toBeGreaterThan(0);
    expect(record.size).toBeGreaterThan(0);

    const parsed = parseMessage(record, { trustPmHeader: false });
    expect(parsed.identityKey.startsWith('mid:')).toBe(true);
    expect(parsed.subject).toBe('Weekly garden club update');
    expect(parsed.fromDomain).toBe('example.test');
    expect(parsed.textPart).toEqual({ part: '1', kind: 'text_plain' });
  });

  describe('over realistic synthetic mail', () => {
    let user: string;
    let uids: Map<FixtureName, number>;

    beforeAll(async () => {
      ({ user, uids } = await mailboxWith('folder-source-mail', FIXTURE_NAMES));
    });

    async function examined(): Promise<FolderSource> {
      const source = createFolderSource(await connect(user));
      await source.examine('INBOX');
      return source;
    }

    function uidOf(name: FixtureName): number {
      const uid = uids.get(name);
      if (uid === undefined) throw new Error(`no uid for ${name}`);
      return uid;
    }

    it('picks the plain part of multipart/alternative and downloads it decoded', async () => {
      const source = await examined();
      const uid = uidOf('alternative.eml');
      const record = await headerOf(source, uid);
      const selected = selectTextPart(record.bodyStructure);
      expect(selected).toEqual({ part: '1', kind: 'text_plain' });

      const download = await source.downloadText(uid, '1', BODY_DOWNLOAD_MAX_BYTES);
      expect(download.truncated).toBe(false);
      expect(download.text).toContain('Your order #1042 has shipped — it should arrive on Monday.');
      expect(download.text).not.toContain('<b>');
    });

    it('decodes a base64 iso-8859-1 HTML part to UTF-8 and keeps the umlauts as text', async () => {
      const source = await examined();
      const uid = uidOf('html-only.eml');
      const record = await headerOf(source, uid);
      const selected = selectTextPart(record.bodyStructure);
      expect(selected).toEqual({ part: '1', kind: 'text_html' });

      const download = await source.downloadText(uid, '1', BODY_DOWNLOAD_MAX_BYTES);
      expect(download.text).toContain('Grüße aus München');
      expect(download.text).not.toContain('�');

      const body = toBodyText(download, 'text_html');
      expect(body.source).toBe('text_html');
      expect(body.text).toContain('Schöne Wünsche zum Wochenende: Äpfel, Öl und Süßes vom Markt.');
      expect(body.text).not.toContain('tracking');
    });

    it('lists the PDF attachment from the body structure and never downloads it', async () => {
      const client = await connect(user);
      const source = createFolderSource(client);
      await source.examine('INBOX');
      const download = vi.spyOn(client, 'download');
      const uid = uidOf('attachment.eml');
      const record = await headerOf(source, uid);

      const attachments = attachmentsOf(record.bodyStructure);
      expect(attachments).toHaveLength(1);
      expect(attachments[0]?.name).toBe('invoice-2026-10.pdf');
      expect(attachments[0]?.mimeType).toBe('application/pdf');
      expect(attachments[0]?.sizeBytes).toBeGreaterThan(0);

      const selected = selectTextPart(record.bodyStructure);
      expect(selected).toEqual({ part: '1', kind: 'text_plain' });
      const text = await source.downloadText(
        uid,
        selected?.part as string,
        BODY_DOWNLOAD_MAX_BYTES,
      );
      expect(text.text).toContain('Your invoice for October is attached.');
      expect(download.mock.calls.map((call) => call[1])).toEqual(['1']);
    });

    it('decodes RFC 2047 subjects and folded From headers', async () => {
      const source = await examined();
      const record = await headerOf(source, uidOf('encoded-headers.eml'));
      const parsed = parseMessage(record, { trustPmHeader: false });
      expect(parsed.subject).toBe('Grüße aus dem Büro — Termin');
      expect(parsed.fromDomain).toBe('news.example.test');
      expect(parsed.fromAddress).toBe('juergen@news.example.test');
    });

    it('keys a message without Message-ID by its header hash when untrusted', async () => {
      const source = await examined();
      const record = await headerOf(source, uidOf('no-message-id.eml'));
      const parsed = parseMessage(record, { trustPmHeader: false });
      expect(parsed.identityKey.startsWith('hdr:')).toBe(true);
      expect(parsed.messageIdHeader).toBeNull();
    });

    it('stops a long part at maxBytes and reports it truncated', async () => {
      const source = await examined();
      const result = await source.downloadText(uidOf('plain.eml'), '1', 64);
      expect(byteLength(result.text)).toBeLessThanOrEqual(64);
      expect(byteLength(result.text)).toBeGreaterThan(48);
      expect(result.text.startsWith('Hello,')).toBe(true);
      expect(result.truncated).toBe(true);
    });

    it('does not report a part of exactly maxBytes as truncated, and does at one byte less', async () => {
      const source = await examined();
      const uid = uidOf('exact-64.eml');
      const record = await headerOf(source, uid);
      // Precondition: the server counts the part as exactly 64 bytes.
      expect(record.bodyStructure?.size).toBe(64);

      const whole = await source.downloadText(uid, '1', 64);
      expect(byteLength(whole.text)).toBe(64);
      expect(whole.truncated).toBe(false);

      const cut = await source.downloadText(uid, '1', 63);
      expect(byteLength(cut.text)).toBe(63);
      expect(cut.truncated).toBe(true);
    });

    it('finds fresh mail with searchSince and lists every uid ascending', async () => {
      const source = await examined();
      const all = [...uids.values()].sort((a, b) => a - b);
      const since = await source.searchSince(new Date(Date.now() - DAY_MS));
      expect(since).toEqual(expect.arrayContaining(all));
      expect(await source.listUids('1:*')).toEqual(all);
      expect(await source.listUids(`${Math.max(...all) + 1}:${Math.max(...all) + 5}`)).toEqual([]);
    });

    it('returns the highest message for n:* when nothing is new (RFC 3501)', async () => {
      const source = await examined();
      const maxUid = Math.max(...uids.values());
      const dates = await source.fetchDates(`${maxUid + 1}:*`);
      expect(dates).toHaveLength(1);
      expect(dates[0]?.uid).toBe(maxUid);
    });
  });

  it('leaves every flag unchanged over a full adapter pass (D-11)', async () => {
    const { user, uids } = await mailboxWith('folder-source-flags', FIXTURE_NAMES);
    const flaggedUid = uids.get('alternative.eml') as number;
    await setFlags(user, 'INBOX', flaggedUid, ['\\Flagged', '\\Answered']);
    const before = await messageFlags(user, 'INBOX');
    // \Recent is session state the server reports for mail no session has seen yet.
    const ownerFlags = (flags: string[] | undefined) => flags?.filter((f) => f !== '\\Recent');
    expect(ownerFlags(before.get(flaggedUid))).toEqual(['\\Answered', '\\Flagged']);

    const source = createFolderSource(await connect(user));
    await source.examine('INBOX');
    const dates = await source.fetchDates('1:*');
    const records = await source.fetchHeaders(dates.map((d) => d.uid));
    expect(records).toHaveLength(FIXTURE_NAMES.length);
    let downloads = 0;
    for (const record of records) {
      const selected = selectTextPart(record.bodyStructure);
      if (selected === null) continue;
      await source.downloadText(record.uid, selected.part, BODY_DOWNLOAD_MAX_BYTES);
      downloads += 1;
    }
    expect(downloads).toBe(FIXTURE_NAMES.length);

    const after = await messageFlags(user, 'INBOX');
    expect(after).toEqual(before);
    expect(ownerFlags(after.get(flaggedUid))).toEqual(['\\Answered', '\\Flagged']);
    for (const flags of after.values()) expect(flags).not.toContain('\\Seen');
  });

  it('refuses every method before examine, naming the method', async () => {
    const { user } = await mailboxWith('folder-source-guard', ['plain.eml']);
    const source = createFolderSource(await connect(user));
    await expect(source.fetchDates('1:*')).rejects.toThrow(
      /FolderSource\.fetchDates: no folder examined yet/,
    );
    await expect(source.fetchHeaders([1])).rejects.toThrow(/FolderSource\.fetchHeaders/);
    await expect(source.listUids('1:*')).rejects.toThrow(/FolderSource\.listUids/);
    await expect(source.searchSince(new Date())).rejects.toThrow(/FolderSource\.searchSince/);
    await expect(source.downloadText(1, '1', 64)).rejects.toThrow(/FolderSource\.downloadText/);
  });

  it('refuses to read another folder than the examined one, or after a failed examine', async () => {
    const { user } = await mailboxWith('folder-source-other', ['plain.eml']);
    await createFolder(user, 'Archive');
    const client = await connect(user);
    const source = createFolderSource(client);
    await source.examine('INBOX');
    await client.mailboxOpen('Archive', { readOnly: true });
    await expect(source.fetchDates('1:*')).rejects.toThrow(
      /FolderSource\.fetchDates: .*INBOX.*examined folder/,
    );

    await expect(source.examine('Missing')).rejects.toThrow();
    await expect(source.listUids('1:*')).rejects.toThrow(/FolderSource\.listUids: .*Missing/);
  });

  it('reports the new UIDVALIDITY after the server changes it', async () => {
    const { user } = await mailboxWith('folder-source-uidvalidity', ['plain.eml']);
    const source = createFolderSource(await connect(user));
    const first = await source.examine('INBOX');
    const bumped = await bumpUidValidity(user, 'INBOX');
    expect(bumped).not.toBe(first.uidValidity);

    const second = await source.examine('INBOX');
    expect(second.uidValidity).toBe(bumped);
    expect(typeof second.uidValidity).toBe('number');
  });
});
