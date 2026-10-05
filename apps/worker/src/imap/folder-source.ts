import { buffer } from 'node:stream/consumers';
import type {
  FetchMessageObject,
  MessageAddressObject,
  MessageEnvelopeObject,
  MessageStructureObject,
} from 'imapflow';
import { HEADER_FIELDS } from '../ingest/message.ts';
import type {
  AddressLite,
  BodyNode,
  EnvelopeLite,
  FolderSource,
  FolderStatus,
  HeaderRecord,
  TextPart,
  UidDate,
} from '../ingest/types.ts';
import type { ImapFlow } from './connect.ts';

/** Largest IMAP UID (RFC 3501 §2.3.1.1: unsigned 32-bit, non-zero). */
const MAX_UID = 0xffff_ffff;

function assertUid(uid: number): void {
  if (!Number.isInteger(uid) || uid < 1 || uid > MAX_UID) {
    throw new Error(`invalid IMAP uid ${String(uid)}`);
  }
}

/**
 * Compact UID set for a UID command: sorted, deduplicated, consecutive runs
 * compressed (`[1,2,3,7,9,10]` -> `1:3,7,9:10`). Throws on an empty list or a
 * value that is not a UID.
 */
export function toUidSet(uids: readonly number[]): string {
  if (uids.length === 0) throw new Error('toUidSet: empty uid list');
  for (const uid of uids) assertUid(uid);
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0] as number;
  let end = start;
  for (const uid of sorted.slice(1)) {
    if (uid === end + 1) {
      end = uid;
      continue;
    }
    runs.push(start === end ? String(start) : `${start}:${end}`);
    start = uid;
    end = uid;
  }
  runs.push(start === end ? String(start) : `${start}:${end}`);
  return runs.join(',');
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** uid and INTERNALDATE are required; the error names the uid, never content. */
function requireMeta(msg: FetchMessageObject): { uid: number; internalDate: Date } {
  const uid = msg.uid;
  if (typeof uid !== 'number' || !Number.isInteger(uid) || uid < 1) {
    throw new Error(`IMAP FETCH returned a message without a uid (seq ${String(msg.seq)})`);
  }
  const internalDate = toDate(msg.internalDate);
  if (internalDate === undefined) {
    throw new Error(`IMAP FETCH returned uid ${uid} without a valid INTERNALDATE`);
  }
  return { uid, internalDate };
}

function stringRecord(
  value: { [key: string]: string } | undefined,
): Record<string, string> | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return undefined;
  // Object.fromEntries defines own properties, so a `__proto__` key stays a plain key.
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

function toAddresses(list: MessageAddressObject[] | undefined): AddressLite[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((entry) => {
    const out: AddressLite = {};
    if (typeof entry?.name === 'string') out.name = entry.name;
    if (typeof entry?.address === 'string') out.address = entry.address;
    return out;
  });
}

/** ImapFlow's envelope -> EnvelopeLite, copying only the typed fields. */
function toEnvelope(envelope: MessageEnvelopeObject | undefined): EnvelopeLite | undefined {
  if (envelope === undefined || envelope === null) return undefined;
  const out: EnvelopeLite = {};
  const date = toDate(envelope.date);
  if (date !== undefined) out.date = date;
  if (typeof envelope.subject === 'string') out.subject = envelope.subject;
  if (typeof envelope.messageId === 'string') out.messageId = envelope.messageId;
  if (typeof envelope.inReplyTo === 'string') out.inReplyTo = envelope.inReplyTo;
  const lists = ['from', 'sender', 'replyTo', 'to', 'cc'] as const;
  for (const key of lists) {
    const addresses = toAddresses(envelope[key]);
    if (addresses !== undefined) out[key] = addresses;
  }
  return out;
}

function toBodyNodeShallow(node: MessageStructureObject): BodyNode {
  const out: BodyNode = { type: typeof node.type === 'string' ? node.type : '' };
  if (typeof node.part === 'string') out.part = node.part;
  const parameters = stringRecord(node.parameters);
  if (parameters !== undefined) out.parameters = parameters;
  if (typeof node.disposition === 'string') out.disposition = node.disposition;
  const dispositionParameters = stringRecord(node.dispositionParameters);
  if (dispositionParameters !== undefined) out.dispositionParameters = dispositionParameters;
  if (typeof node.size === 'number' && Number.isFinite(node.size)) out.size = node.size;
  return out;
}

/**
 * ImapFlow's BODYSTRUCTURE -> BodyNode, iteratively so a hostile, deeply nested
 * structure cannot overflow the stack.
 */
function toBodyStructure(root: MessageStructureObject | undefined): BodyNode | undefined {
  if (root === undefined || root === null) return undefined;
  const top = toBodyNodeShallow(root);
  const stack: Array<[MessageStructureObject, BodyNode]> = [[root, top]];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [source, target] = item;
    if (!Array.isArray(source.childNodes)) continue;
    const children: BodyNode[] = [];
    for (const child of source.childNodes) {
      const mapped = toBodyNodeShallow(child);
      children.push(mapped);
      stack.push([child, mapped]);
    }
    target.childNodes = children;
  }
  return top;
}

/** Find a part's BODYSTRUCTURE node by part number. */
function findPart(
  root: MessageStructureObject | undefined,
  part: string,
): MessageStructureObject | undefined {
  if (root === undefined) return undefined;
  const stack: MessageStructureObject[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if ((node.part ?? (node === root ? '1' : undefined)) === part) return node;
    if (Array.isArray(node.childNodes)) stack.push(...node.childNodes);
  }
  return undefined;
}

/**
 * Read-only FolderSource over one ImapFlow client (D-11): the folder is opened
 * with EXAMINE, every fetch is BODY.PEEK (ImapFlow's default), and no method
 * sends STORE, COPY, MOVE, EXPUNGE, APPEND or SELECT. Every method but examine
 * runs only while the examined folder is the open one.
 */
export function createFolderSource(client: ImapFlow): FolderSource {
  let examined: string | null = null;
  let openedPath: string | null = null;

  function requireExamined(method: string): void {
    if (examined === null) throw new Error(`FolderSource.${method}: no folder examined yet`);
    const mailbox = client.mailbox;
    if (openedPath === null || mailbox === false || mailbox.path !== openedPath) {
      throw new Error(`FolderSource.${method}: ${examined} is not the examined folder`);
    }
  }

  return {
    async examine(folder: string): Promise<FolderStatus> {
      examined = folder;
      openedPath = null;
      const mailbox = await client.mailboxOpen(folder, { readOnly: true });
      openedPath = mailbox.path;
      return {
        uidValidity: Number(mailbox.uidValidity),
        uidNext: mailbox.uidNext,
        exists: mailbox.exists,
      };
    },

    async fetchDates(range: string): Promise<UidDate[]> {
      requireExamined('fetchDates');
      const messages = await client.fetchAll(
        range,
        { uid: true, internalDate: true },
        { uid: true },
      );
      return messages.map(requireMeta).sort((a, b) => a.uid - b.uid);
    },

    async fetchHeaders(uids: readonly number[]): Promise<HeaderRecord[]> {
      requireExamined('fetchHeaders');
      if (uids.length === 0) return [];
      const messages = await client.fetchAll(
        toUidSet(uids),
        {
          uid: true,
          internalDate: true,
          size: true,
          envelope: true,
          bodyStructure: true,
          headers: [...HEADER_FIELDS],
        },
        { uid: true },
      );
      return messages
        .map((msg): HeaderRecord => {
          const { uid, internalDate } = requireMeta(msg);
          const record: HeaderRecord = {
            uid,
            internalDate,
            size: typeof msg.size === 'number' ? msg.size : Number.NaN,
            rawHeaders: Buffer.isBuffer(msg.headers) ? msg.headers : Buffer.alloc(0),
          };
          const envelope = toEnvelope(msg.envelope);
          if (envelope !== undefined) record.envelope = envelope;
          const bodyStructure = toBodyStructure(msg.bodyStructure);
          if (bodyStructure !== undefined) record.bodyStructure = bodyStructure;
          return record;
        })
        .sort((a, b) => a.uid - b.uid);
    },

    async listUids(range: string): Promise<number[]> {
      requireExamined('listUids');
      const found = await client.search({ uid: range }, { uid: true });
      return found === false || found === undefined ? [] : [...found].sort((a, b) => a - b);
    },

    async searchSince(since: Date): Promise<number[]> {
      requireExamined('searchSince');
      const found = await client.search({ since }, { uid: true });
      return found === false || found === undefined ? [] : [...found].sort((a, b) => a - b);
    },

    async downloadText(uid: number, part: string, maxBytes: number): Promise<TextPart> {
      requireExamined('downloadText');
      assertUid(uid);
      const download = await client.download(String(uid), part, { uid: true, maxBytes });
      if (download.content === undefined) return { text: '', truncated: false };
      const bytes = await buffer(download.content);
      let size = download.meta.expectedSize;
      if (size === undefined) {
        const [msg] = await client.fetchAll(
          String(uid),
          { uid: true, bodyStructure: true },
          { uid: true },
        );
        size = findPart(msg?.bodyStructure, part)?.size;
      }
      return { text: bytes.toString('utf8'), truncated: size !== undefined && size > maxBytes };
    },
  };
}
