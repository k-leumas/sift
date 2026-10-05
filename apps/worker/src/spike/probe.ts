import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import type { FetchMessageObject, ListResponse } from 'imapflow';
import type { ImapFlow } from '../imap/connect.ts';
import { normaliseMessageId, stripNul } from '../ingest/identity.ts';
import { parseHeaderBlock } from '../ingest/message.ts';

/**
 * The Bridge spike probe (SPK-01..04, D-43). It measures how an IMAP server
 * behaves and reports aggregates only: counts, capability atoms, special-use
 * roles, UIDs, dates and sha256 hashes. It never reports a subject, sender,
 * recipient, body, address, raw Message-ID, raw internal ID or a folder or
 * label name other than the spike label (Pitfall 13).
 */

/** The one label the probe may create and write to (SPK-01). */
export const SPIKE_LABEL_NAME = 'Sift Spike';

/** Proton Bridge's top-level label and folder namespaces. */
const LABELS_ROOT = 'Labels';
const FOLDERS_ROOT = 'Folders';
/** The domain Bridge gives a Message-ID it had to make up (RESEARCH, Pre-spike evidence). */
const INTERNAL_ID_DOMAIN = 'protonmail.internalid';
const PRE_AUTH_TIMEOUT_MS = 10_000;
/** Mailbox delimiter assumed when LIST reports none. */
const DEFAULT_DELIMITER = '/';

export type TaggedStatus = 'OK' | 'NO' | 'BAD' | 'none';

export interface ProbeReport {
  probeVersion: 1;
  at: string;
  folder: string;
  capabilities: {
    /** Atoms in the plaintext greeting's [CAPABILITY ...] code (empty when absent or skipped). */
    greeting: string[];
    /** Atoms of the pre-login CAPABILITY reply (empty when skipped). */
    preAuth: string[];
    postAuth: string[];
  };
  condstore: { advertised: boolean; enable: TaggedStatus; statusHighestModseq: TaggedStatus };
  qresync: { advertised: boolean };
  idleAdvertised: boolean;
  folders: {
    delimiter: string | null;
    total: number;
    labelsPrefix: number;
    foldersPrefix: number;
    specialUse: string[];
    spikeLabelExists: boolean;
  };
  /** Configured folder and the spike label folder only. */
  uidValidity: Record<string, number>;
  /** Configured folder, via client.status() (not the raw HIGHESTMODSEQ STATUS, which gluon may refuse). */
  folderStatus: { messages: number | null; uidNext: number | null; uidValidity: number | null };
  identity: {
    scanned: number;
    pmInternalIdPresent: number;
    pmInternalIdAbsent: number;
    messageIdAbsent: number;
    messageIdInternalDomain: number;
    duplicateMessageIds: number;
    messageIdDiffersFromExternalId: number;
    dateSkewSeconds: { p50: number | null; p95: number | null };
  };
  sample: { uid: number; internalDate: string; internalIdSha256: string | null }[];
  idle?: {
    seconds: number;
    existsEventSeen: boolean;
    newMessageArrived: boolean;
    newUid: number | null;
  };
  labelTest?: {
    performed: boolean;
    skippedReason?:
      | 'not confirmed'
      | 'target not found'
      | 'target older than one hour'
      | 'label copy not confirmed';
    labelFolderCreated?: boolean;
    copyUidPlus?: boolean;
    inboxCopyAfterCopy?: boolean;
    messageIdBytesEqual?: boolean;
    pmInternalIdBytesEqual?: boolean;
    removedFromLabel?: boolean;
    inboxCopyAfterRemove?: boolean;
    /** True when a copy may have been made but was not removed: the owner removes the label in the Proton client. */
    labelCopyMayRemain?: boolean;
  };
  compare?: {
    uidValidityChanged: Record<string, boolean>;
    addedFolders: string[];
    missingFolders: string[];
    sampleMatched: number;
    uidChanged: number;
    internalDateChanged: number;
    sampleMissing: number;
  };
}

/** Capability atoms of a `[CAPABILITY ...]` code or a `* CAPABILITY` line, upper-cased (atoms are case-insensitive). */
function capabilityAtoms(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((atom) => atom !== '')
    .map((atom) => atom.toUpperCase());
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * The server's capabilities before login: the greeting's `[CAPABILITY ...]`
 * code and the reply to one plaintext CAPABILITY, then LOGOUT. Over node:net,
 * so nothing but CAPABILITY and LOGOUT is ever sent; never credentials (D-80).
 */
export async function preAuthCapabilities(
  host: string,
  port: number,
  timeoutMs: number = PRE_AUTH_TIMEOUT_MS,
): Promise<{ greeting: string[]; capability: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    let buffer = '';
    let greeting: string[] | null = null;
    let capability: string[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners('data');
      socket.end();
      socket.destroy();
      if (error !== undefined) reject(error);
      else
        resolve({ greeting: sortedUnique(greeting ?? []), capability: sortedUnique(capability) });
    };
    socket.setTimeout(timeoutMs, () =>
      finish(
        Object.assign(new Error('no IMAP greeting or CAPABILITY reply in time'), {
          code: 'ETIMEDOUT',
        }),
      ),
    );
    socket.on('error', (error) => finish(error));
    socket.on('close', () => finish(new Error('the server closed the connection before replying')));
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('latin1');
      for (let end = buffer.indexOf('\r\n'); end >= 0; end = buffer.indexOf('\r\n')) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (greeting === null) {
          if (!/^\* (OK|PREAUTH)\b/i.test(line)) {
            finish(new Error('unexpected IMAP greeting'));
            return;
          }
          const code = /^\* \w+ \[CAPABILITY ([^\]]*)\]/i.exec(line);
          greeting = code?.[1] === undefined ? [] : capabilityAtoms(code[1]);
          socket.write('P1 CAPABILITY\r\n');
          continue;
        }
        const untagged = /^\* CAPABILITY (.*)$/i.exec(line);
        if (untagged?.[1] !== undefined) {
          capability = capabilityAtoms(untagged[1]);
          continue;
        }
        if (/^P1 /i.test(line)) {
          socket.write('P2 LOGOUT\r\n');
          continue;
        }
        if (/^P2 /i.test(line)) {
          finish();
          return;
        }
      }
    });
    // Keep reading after the reply so the peer's FIN is seen (cerebrum).
    socket.resume();
  });
}

type ExecResult = { response?: { command?: unknown }; next?: () => void };
type ExecFn = (command: string, attributes: unknown, options?: object) => Promise<ExecResult>;

/**
 * Send one raw command through ImapFlow's low-level command method and report
 * its tagged status. A NO or BAD (or no answer at all) is recorded, never
 * thrown (SPK-02 empty edge).
 */
async function taggedStatus(
  client: ImapFlow,
  command: string,
  attributes: unknown,
): Promise<TaggedStatus> {
  const exec = (client as unknown as { exec?: ExecFn }).exec;
  if (typeof exec !== 'function') return 'none';
  try {
    const result = await exec.call(client, command, attributes);
    result?.next?.();
    const status = String(result?.response?.command ?? '').toUpperCase();
    return status === 'OK' ? 'OK' : 'none';
  } catch (error) {
    const status = (error as { responseStatus?: unknown } | null)?.responseStatus;
    return status === 'NO' || status === 'BAD' ? status : 'none';
  }
}

/** RFC 3501 §5.1.3 modified UTF-7, for mailbox names in raw commands. */
export function encodeModifiedUtf7(name: string): string {
  let out = '';
  let pending = '';
  const flush = () => {
    if (pending === '') return;
    const utf16 = Buffer.alloc(pending.length * 2);
    for (let i = 0; i < pending.length; i += 1) utf16.writeUInt16BE(pending.charCodeAt(i), i * 2);
    out += `&${utf16.toString('base64').replace(/=+$/, '').replaceAll('/', ',')}-`;
    pending = '';
  };
  for (const unit of name) {
    const code = unit.codePointAt(0) as number;
    if (code >= 0x20 && code <= 0x7e) {
      flush();
      out += unit === '&' ? '&-' : unit;
    } else {
      pending += unit;
    }
  }
  flush();
  return out;
}

/** Label path of the spike label under `delimiter` (the server's own, SPK-01 encoding edge). */
export function spikeLabelPath(delimiter: string | null): string {
  return `${LABELS_ROOT}${delimiter ?? DEFAULT_DELIMITER}${SPIKE_LABEL_NAME}`;
}

function folderSummary(entries: ListResponse[]): ProbeReport['folders'] {
  const delimiter =
    entries.find((entry) => typeof entry.delimiter === 'string' && entry.delimiter !== '')
      ?.delimiter ?? null;
  const sep = delimiter ?? DEFAULT_DELIMITER;
  const labelPath = spikeLabelPath(delimiter);
  return {
    delimiter,
    total: entries.length,
    labelsPrefix: entries.filter((e) => e.path.startsWith(`${LABELS_ROOT}${sep}`)).length,
    foldersPrefix: entries.filter((e) => e.path.startsWith(`${FOLDERS_ROOT}${sep}`)).length,
    specialUse: sortedUnique(
      entries
        .map((e) => e.specialUse)
        .filter((role): role is string => typeof role === 'string' && role !== ''),
    ),
    spikeLabelExists: entries.some((e) => e.path === labelPath),
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

async function statusOf(client: ImapFlow, folder: string): Promise<ProbeReport['folderStatus']> {
  try {
    const status = await client.status(folder, {
      messages: true,
      uidNext: true,
      uidValidity: true,
    });
    if (status === false) return { messages: null, uidNext: null, uidValidity: null };
    return {
      messages: toNumber(status.messages),
      uidNext: toNumber(status.uidNext),
      uidValidity: toNumber(status.uidValidity),
    };
  } catch {
    return { messages: null, uidNext: null, uidValidity: null };
  }
}

/** First non-empty value of a parsed header, NUL-stripped and trimmed. */
function firstValue(headers: Record<string, string[]>, name: string): string | null {
  for (const value of headers[name] ?? []) {
    const v = stripNul(value).trim();
    if (v !== '') return v;
  }
  return null;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Nearest-rank percentile of ascending `sorted`, or null when empty. */
function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

interface ScannedMessage {
  uid: number;
  internalDate: Date;
  pmInternalId: string | null;
  messageId: string | null;
  externalId: string | null;
  date: Date | null;
}

function scanned(msg: FetchMessageObject): ScannedMessage | null {
  const uid = msg.uid;
  const internalDate =
    msg.internalDate instanceof Date ? msg.internalDate : new Date(String(msg.internalDate));
  if (typeof uid !== 'number' || Number.isNaN(internalDate.getTime())) return null;
  const headers = parseHeaderBlock(Buffer.isBuffer(msg.headers) ? msg.headers : Buffer.alloc(0));
  const rawDate = firstValue(headers, 'date');
  const date = rawDate === null ? null : new Date(rawDate);
  return {
    uid,
    internalDate,
    pmInternalId: firstValue(headers, 'x-pm-internal-id'),
    messageId: (() => {
      const raw = firstValue(headers, 'message-id');
      return raw === null ? null : normaliseMessageId(raw);
    })(),
    externalId: (() => {
      const raw = firstValue(headers, 'x-pm-external-id');
      return raw === null ? null : normaliseMessageId(raw);
    })(),
    date: date !== null && !Number.isNaN(date.getTime()) ? date : null,
  };
}

function identityStats(messages: readonly ScannedMessage[]): ProbeReport['identity'] {
  const internalIdsByMessageId = new Map<string, Set<string>>();
  const skews: number[] = [];
  let pmPresent = 0;
  let messageIdAbsent = 0;
  let internalDomain = 0;
  let differsFromExternal = 0;
  for (const m of messages) {
    if (m.pmInternalId !== null) pmPresent += 1;
    if (m.messageId === null) {
      messageIdAbsent += 1;
    } else {
      const at = m.messageId.lastIndexOf('@');
      if (at >= 0 && m.messageId.slice(at + 1) === INTERNAL_ID_DOMAIN) internalDomain += 1;
      if (m.externalId !== null && m.externalId !== m.messageId) differsFromExternal += 1;
      if (m.pmInternalId !== null) {
        const ids = internalIdsByMessageId.get(m.messageId) ?? new Set<string>();
        ids.add(m.pmInternalId);
        internalIdsByMessageId.set(m.messageId, ids);
      }
    }
    if (m.date !== null) {
      skews.push(Math.round(Math.abs(m.date.getTime() - m.internalDate.getTime()) / 1000));
    }
  }
  skews.sort((a, b) => a - b);
  return {
    scanned: messages.length,
    pmInternalIdPresent: pmPresent,
    pmInternalIdAbsent: messages.length - pmPresent,
    messageIdAbsent,
    messageIdInternalDomain: internalDomain,
    duplicateMessageIds: [...internalIdsByMessageId.values()].filter((ids) => ids.size > 1).length,
    messageIdDiffersFromExternalId: differsFromExternal,
    dateSkewSeconds: { p50: percentile(skews, 50), p95: percentile(skews, 95) },
  };
}

/** Headers the identity scan reads; never stored or printed, only counted and hashed. */
const SCAN_HEADERS = ['message-id', 'x-pm-internal-id', 'x-pm-external-id', 'date'];

/**
 * The read-only probe (SPK-02, SPK-03, SPK-04, D-43). It sends ENABLE and one
 * raw STATUS, lists folders, EXAMINEs `folder` and reads four header fields of
 * at most max(scanLimit, sample) newest messages with BODY.PEEK. It never
 * selects a folder read-write and never writes. Pre-auth capabilities are
 * filled in by the caller (preAuthCapabilities).
 */
export async function runProbe(
  client: ImapFlow,
  opts: { folder: string; sample: number; scanLimit: number },
): Promise<ProbeReport> {
  const postAuth = sortedUnique([...client.capabilities.keys()].map((c) => c.toUpperCase()));
  const has = (atom: string) => postAuth.includes(atom);

  const enable = await taggedStatus(client, 'ENABLE', [
    { type: 'ATOM', value: 'CONDSTORE' },
    { type: 'ATOM', value: 'QRESYNC' },
  ]);
  const statusHighestModseq = await taggedStatus(client, 'STATUS', [
    { type: 'STRING', value: encodeModifiedUtf7(opts.folder) },
    ['HIGHESTMODSEQ', 'UIDNEXT', 'UIDVALIDITY', 'MESSAGES'].map((value) => ({
      type: 'ATOM',
      value,
    })),
  ]);

  const folders = folderSummary(await client.list());

  const mailbox = await client.mailboxOpen(opts.folder, { readOnly: true });
  const exists = typeof mailbox?.exists === 'number' ? mailbox.exists : 0;
  const window = Math.min(exists, Math.max(opts.scanLimit, opts.sample));
  let newest: ScannedMessage[] = [];
  if (window > 0) {
    const fetched = await client.fetchAll(`${exists - window + 1}:*`, {
      uid: true,
      internalDate: true,
      headers: SCAN_HEADERS,
    });
    newest = fetched
      .map(scanned)
      .filter((m): m is ScannedMessage => m !== null)
      .sort((a, b) => a.uid - b.uid);
  }
  const identity = identityStats(opts.scanLimit === 0 ? [] : newest.slice(-opts.scanLimit));
  const sample =
    opts.sample === 0
      ? []
      : newest.slice(-opts.sample).map((m) => ({
          uid: m.uid,
          internalDate: m.internalDate.toISOString(),
          internalIdSha256: m.pmInternalId === null ? null : sha256Hex(m.pmInternalId),
        }));

  const folderStatus = await statusOf(client, opts.folder);
  const uidValidity: Record<string, number> = {};
  if (folderStatus.uidValidity !== null) uidValidity[opts.folder] = folderStatus.uidValidity;
  if (folders.spikeLabelExists) {
    const labelPath = spikeLabelPath(folders.delimiter);
    const label = await statusOf(client, labelPath);
    if (label.uidValidity !== null) uidValidity[labelPath] = label.uidValidity;
  }

  return {
    probeVersion: 1,
    at: new Date().toISOString(),
    folder: opts.folder,
    capabilities: { greeting: [], preAuth: [], postAuth },
    condstore: { advertised: has('CONDSTORE'), enable, statusHighestModseq },
    qresync: { advertised: has('QRESYNC') },
    idleAdvertised: has('IDLE'),
    folders,
    uidValidity,
    folderStatus,
    identity,
    sample,
  };
}
