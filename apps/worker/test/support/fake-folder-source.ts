import type {
  BodyNode,
  EnvelopeLite,
  FolderSource,
  FolderStatus,
  HeaderRecord,
  TextPart,
  UidDate,
} from '../../src/ingest/types.ts';

/**
 * In-memory FolderSource for the sync engine tests (02-10). Synthetic mail
 * only (example.test addresses, invented text), never real mail.
 *
 * It follows the IMAP semantics the engine relies on: UIDs ascend in arrival
 * order, `n:*` always includes the highest UID even when n is above it
 * (RFC 3501 6.4.8), and SEARCH SINCE is day-granular (UTC days here).
 */

export interface FakeMessageInput {
  internalDate: Date;
  /** Lowercase header name -> values; written into rawHeaders so parseMessage runs for real. */
  headers: Record<string, string[]>;
  envelope?: EnvelopeLite;
  bodyStructure?: BodyNode;
  /** Part number -> decoded text. */
  parts?: Record<string, string>;
}

export interface FakeMessage extends FakeMessageInput {
  uid: number;
}

export type FolderSourceMethod = keyof FolderSource;

export interface FolderSourceCall {
  method: FolderSourceMethod;
  args: unknown[];
}

const DAY_MS = 86_400_000;

function headerBlock(headers: Record<string, string[]>): Buffer {
  const lines: string[] = [];
  for (const [name, values] of Object.entries(headers)) {
    for (const value of values) lines.push(`${name}: ${value}`);
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');
}

export class FakeFolderSource implements FolderSource {
  readonly folder: string;
  uidValidity: number;
  uidNext = 1;
  readonly calls: FolderSourceCall[] = [];
  private readonly messages = new Map<number, FakeMessage>();
  private readonly failures: { method: FolderSourceMethod; remaining: number }[] = [];

  constructor(opts: { folder?: string; uidValidity?: number } = {}) {
    this.folder = opts.folder ?? 'INBOX';
    this.uidValidity = opts.uidValidity ?? 1000;
  }

  /** Deliver a message; it gets the next UID, which is returned. */
  append(message: FakeMessageInput): number {
    const uid = this.uidNext;
    this.uidNext += 1;
    this.messages.set(uid, { ...message, uid });
    return uid;
  }

  expunge(uid: number): void {
    this.messages.delete(uid);
  }

  /** The message currently at `uid`, if any. */
  get(uid: number): FakeMessage | undefined {
    return this.messages.get(uid);
  }

  /** Current UIDs, ascending. */
  uids(): number[] {
    return [...this.messages.keys()].sort((a, b) => a - b);
  }

  /**
   * A new UIDVALIDITY. With `renumber` every message gets a fresh UID from 1 in
   * the old UID order, as after a Bridge cache rebuild. Returns the new value.
   */
  bumpUidValidity(opts: { renumber: boolean }): number {
    this.uidValidity += 1;
    if (opts.renumber) {
      const ordered = this.uids().map((uid) => this.messages.get(uid) as FakeMessage);
      this.messages.clear();
      this.uidNext = 1;
      for (const message of ordered) this.append(message);
    }
    return this.uidValidity;
  }

  /** Make the nth call (1-based, counted from now) of `method` throw. */
  failOn(method: FolderSourceMethod, nth = 1): void {
    this.failures.push({ method, remaining: nth });
  }

  /** Calls of one method, in order. */
  callsOf(method: FolderSourceMethod): FolderSourceCall[] {
    return this.calls.filter((call) => call.method === method);
  }

  private enter(method: FolderSourceMethod, args: unknown[]): void {
    this.calls.push({ method, args: args.map((a) => (Array.isArray(a) ? [...a] : a)) });
    for (const failure of this.failures) {
      if (failure.method !== method || failure.remaining <= 0) continue;
      failure.remaining -= 1;
      if (failure.remaining === 0) throw new Error(`injected failure: ${method}`);
    }
  }

  /** UIDs matched by an IMAP sequence set like `1:*`, `5`, `3:7,9`. */
  private resolveSet(set: string): number[] {
    const present = this.uids();
    const highest = present.at(-1);
    if (highest === undefined) return [];
    const toNumber = (token: string): number => {
      if (token === '*') return highest;
      const value = Number(token);
      if (!Number.isInteger(value) || value < 1) throw new Error(`bad uid set: ${set}`);
      return value;
    };
    const matched = new Set<number>();
    for (const item of set.split(',')) {
      const [from, to = from] = item.split(':') as [string, string?];
      const a = toNumber(from);
      const b = toNumber(to);
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      for (const uid of present) if (uid >= lo && uid <= hi) matched.add(uid);
    }
    return [...matched].sort((x, y) => x - y);
  }

  async examine(folder: string): Promise<FolderStatus> {
    this.enter('examine', [folder]);
    if (folder !== this.folder) throw new Error(`no such folder: ${folder}`);
    return { uidValidity: this.uidValidity, uidNext: this.uidNext, exists: this.messages.size };
  }

  async fetchDates(range: string): Promise<UidDate[]> {
    this.enter('fetchDates', [range]);
    return this.resolveSet(range).map((uid) => ({
      uid,
      internalDate: (this.messages.get(uid) as FakeMessage).internalDate,
    }));
  }

  async fetchHeaders(uids: readonly number[]): Promise<HeaderRecord[]> {
    this.enter('fetchHeaders', [uids]);
    const out: HeaderRecord[] = [];
    for (const uid of [...new Set(uids)].sort((a, b) => a - b)) {
      const message = this.messages.get(uid);
      if (message === undefined) continue;
      const rawHeaders = headerBlock(message.headers);
      const bodyBytes = Object.values(message.parts ?? {}).reduce(
        (sum, text) => sum + Buffer.byteLength(text, 'utf8'),
        0,
      );
      out.push({
        uid,
        internalDate: message.internalDate,
        size: rawHeaders.length + bodyBytes,
        rawHeaders,
        ...(message.envelope === undefined ? {} : { envelope: message.envelope }),
        ...(message.bodyStructure === undefined ? {} : { bodyStructure: message.bodyStructure }),
      });
    }
    return out;
  }

  async listUids(range: string): Promise<number[]> {
    this.enter('listUids', [range]);
    return this.resolveSet(range);
  }

  async searchSince(since: Date): Promise<number[]> {
    this.enter('searchSince', [since]);
    const day = Math.floor(since.getTime() / DAY_MS) * DAY_MS;
    return this.uids().filter(
      (uid) => (this.messages.get(uid) as FakeMessage).internalDate.getTime() >= day,
    );
  }

  async downloadText(uid: number, part: string, maxBytes: number): Promise<TextPart> {
    this.enter('downloadText', [uid, part, maxBytes]);
    const text = this.messages.get(uid)?.parts?.[part];
    if (text === undefined) throw new Error(`part ${part} of uid ${uid} not found`);
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length <= maxBytes) return { text, truncated: false };
    return { text: bytes.subarray(0, maxBytes).toString('utf8'), truncated: true };
  }
}

let counter = 0;

/**
 * One synthetic single-part text/plain message. Each call gets a unique
 * Message-ID unless `messageId` is given (the identity key, D-12).
 */
export function fakeMail(
  internalDate: Date,
  opts: { messageId?: string; subject?: string; text?: string; html?: boolean } = {},
): FakeMessageInput {
  counter += 1;
  const messageId = opts.messageId ?? `<fake-${counter}@example.test>`;
  const subject = opts.subject ?? `Synthetic message ${counter}`;
  const text = opts.text ?? `Synthetic body ${counter}`;
  const type = opts.html === true ? 'text/html' : 'text/plain';
  return {
    internalDate,
    headers: {
      'message-id': [messageId],
      date: [internalDate.toUTCString()],
      from: ['Sender <sender@example.test>'],
      to: ['owner@example.test'],
      subject: [subject],
    },
    envelope: {
      date: internalDate,
      subject,
      messageId,
      from: [{ name: 'Sender', address: 'sender@example.test' }],
      to: [{ address: 'owner@example.test' }],
    },
    bodyStructure: { type, size: Buffer.byteLength(text, 'utf8') },
    parts: { '1': text },
  };
}
