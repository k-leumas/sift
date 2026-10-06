import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import type { FetchMessageObject, ListResponse, MailboxObject } from 'imapflow';
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

/** EXAMINE `folder`; fail closed if the server grants read-write (D-11). */
async function examine(client: ImapFlow, folder: string): Promise<MailboxObject> {
  const mailbox = await client.mailboxOpen(folder, { readOnly: true });
  if (mailbox?.readOnly === false) throw new Error('the server opened a folder read-write');
  return mailbox;
}

/** A fetched INTERNALDATE as a valid Date, or null. */
function internalDateOf(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
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
  const internalDate = internalDateOf(msg.internalDate);
  if (typeof uid !== 'number' || internalDate === null) return null;
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

  const mailbox = await examine(client, opts.folder);
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

/** The label test only touches mail that arrived in the last hour: the owner's fresh test email (T-02-68). */
export const LABEL_TEST_MAX_AGE_MS = 3_600_000;

/** The exact line the owner types to allow the label test (D-11). */
export const LABEL_CONFIRMATION = 'LABEL';

/** What the label test will do, shown before the confirmation. Folder and UID only, never content. */
export function labelTestPlan(folder: string, uid: number, labelPath: string): string {
  return (
    `Label test: copy UID ${uid} from ${folder} into ${labelPath}, then remove it from ` +
    `${labelPath} only. Type ${LABEL_CONFIRMATION} to continue:`
  );
}

/** True only for the exact confirmation word (no case folding, no surrounding spaces). */
export function isLabelConfirmation(line: string | null): boolean {
  return line === LABEL_CONFIRMATION;
}

async function uidPresent(client: ImapFlow, folder: string, uid: number): Promise<boolean> {
  await examine(client, folder);
  const found = await client.search({ uid: String(uid) }, { uid: true });
  // search() gives false when SEARCH failed: not proof of presence.
  return Array.isArray(found) && found.includes(uid);
}

/**
 * Raw value bytes (everything after the colon, folding kept) of each field
 * named `name` in a header block, concatenated; null when absent.
 */
function rawHeaderValue(block: Buffer, name: string): Buffer | null {
  const parts: Buffer[] = [];
  const lower = name.toLowerCase();
  let start = 0;
  while (start < block.length) {
    let end = start;
    // A field ends at a line break not followed by folding whitespace.
    for (;;) {
      const lf = block.indexOf(0x0a, end);
      if (lf < 0) {
        end = block.length;
        break;
      }
      const next = block[lf + 1];
      end = lf + 1;
      if (next !== 0x20 && next !== 0x09) break;
    }
    const field = block.subarray(start, end);
    const colon = field.indexOf(0x3a);
    if (colon > 0 && field.subarray(0, colon).toString('latin1').trim().toLowerCase() === lower) {
      parts.push(field.subarray(colon + 1));
    }
    start = end;
  }
  return parts.length === 0 ? null : Buffer.concat(parts);
}

async function identityHeaderBytes(
  client: ImapFlow,
  uid: number,
): Promise<{ messageId: Buffer | null; pmInternalId: Buffer | null } | null> {
  const msg = await client.fetchOne(
    String(uid),
    { uid: true, headers: ['message-id', 'x-pm-internal-id'] },
    { uid: true },
  );
  if (msg === false || msg === undefined || msg.uid !== uid) return null;
  const block = Buffer.isBuffer(msg.headers) ? msg.headers : Buffer.alloc(0);
  return {
    messageId: rawHeaderValue(block, 'message-id'),
    pmInternalId: rawHeaderValue(block, 'x-pm-internal-id'),
  };
}

/** Byte equality of one header across two copies; undefined when neither copy has it. */
function bytesEqual(a: Buffer | null, b: Buffer | null): boolean | undefined {
  if (a === null && b === null) return undefined;
  return a !== null && b !== null && a.equals(b);
}

/**
 * The bounded label test (SPK-01, D-11, T-02-68). With `confirmed`, it COPYs
 * exactly `uid` from `folder` into `Labels<delim>Sift Spike` (created if
 * missing), compares the raw Message-ID and X-Pm-Internal-Id bytes of both
 * copies, and then removes the copy from the label folder only (\Deleted plus
 * UID EXPUNGE of the one copied UID). The removal happens only when COPYUID
 * named the label-folder copy and the original is confirmed still present;
 * otherwise nothing is expunged and the owner removes the label in the Proton
 * client. A target older than LABEL_TEST_MAX_AGE_MS, or missing, stops the
 * test before any write. `folder` is EXAMINEd for every read and SELECTed
 * only for the COPY, which Bridge refuses from an EXAMINEd mailbox.
 */
export async function labelTest(
  client: ImapFlow,
  opts: { folder: string; uid: number; delimiter: string; confirmed: boolean },
): Promise<NonNullable<ProbeReport['labelTest']>> {
  if (!opts.confirmed) return { performed: false, skippedReason: 'not confirmed' };
  const { folder, uid } = opts;
  const labelPath = spikeLabelPath(opts.delimiter);

  await examine(client, folder);
  const target = await client.fetchOne(
    String(uid),
    { uid: true, internalDate: true },
    { uid: true },
  );
  if (target === false || target === undefined || target.uid !== uid) {
    return { performed: false, skippedReason: 'target not found' };
  }
  const internalDate = internalDateOf(target.internalDate);
  if (internalDate === null) return { performed: false, skippedReason: 'target not found' };
  if (Date.now() - internalDate.getTime() > LABEL_TEST_MAX_AGE_MS) {
    return { performed: false, skippedReason: 'target older than one hour' };
  }

  // Writes start here: from now on a copy may exist in the label folder.
  const notConfirmed = (
    partial: NonNullable<ProbeReport['labelTest']>,
  ): NonNullable<ProbeReport['labelTest']> => ({
    ...partial,
    performed: false,
    skippedReason: 'label copy not confirmed',
    labelCopyMayRemain: true,
  });

  const exists = (await client.list()).some((entry) => entry.path === labelPath);
  let labelFolderCreated = false;
  if (!exists) labelFolderCreated = (await client.mailboxCreate(labelPath)).created === true;

  await examine(client, folder);
  const original = await identityHeaderBytes(client, uid);
  // Bridge (gluon) refuses COPY from an EXAMINEd mailbox ("the mailbox is
  // read-only"), stricter than RFC 3501. SELECT the source for the COPY only:
  // COPY never changes the source message, and every read stays on EXAMINE.
  const source = await client.mailboxOpen(folder);
  if (source?.path !== folder) return notConfirmed({ performed: false, labelFolderCreated });
  const copy = await client.messageCopy(String(uid), labelPath, { uid: true });
  const labelUid = copy === false ? undefined : copy.uidMap?.get(uid);
  const copyUidPlus = labelUid !== undefined;
  const inboxCopyAfterCopy = await uidPresent(client, folder, uid);

  const result: NonNullable<ProbeReport['labelTest']> = {
    performed: false,
    labelFolderCreated,
    copyUidPlus,
    inboxCopyAfterCopy,
  };
  if (labelUid !== undefined) {
    await examine(client, labelPath);
    const labelled = await identityHeaderBytes(client, labelUid);
    if (original !== null && labelled !== null) {
      const mid = bytesEqual(original.messageId, labelled.messageId);
      const pm = bytesEqual(original.pmInternalId, labelled.pmInternalId);
      if (mid !== undefined) result.messageIdBytesEqual = mid;
      if (pm !== undefined) result.pmInternalIdBytesEqual = pm;
    }
  }

  // Expunge only the COPYUID-named copy, only while the original is still there,
  // and only with UID EXPUNGE (UIDPLUS): a plain EXPUNGE would also remove any
  // other \Deleted message in the label folder.
  if (labelUid === undefined || !inboxCopyAfterCopy || !client.capabilities.has('UIDPLUS')) {
    return notConfirmed(result);
  }
  const opened = await client.mailboxOpen(labelPath);
  if (opened?.path !== labelPath || opened.readOnly === true) return notConfirmed(result);
  const removedFromLabel = (await client.messageDelete(String(labelUid), { uid: true })) === true;
  const inboxCopyAfterRemove = await uidPresent(client, folder, uid);

  return {
    ...result,
    performed: true,
    removedFromLabel,
    inboxCopyAfterRemove,
    ...(removedFromLabel ? {} : { labelCopyMayRemain: true }),
  };
}

/**
 * IDLE on `folder` for up to `seconds` (D-27, D-43): records whether an EXISTS
 * arrived, and whether UIDNEXT grew. It stops at the first EXISTS. The new UID
 * is the highest UID at or above the old UIDNEXT. It only reports the UID; it
 * never chooses a label-test target.
 */
export async function waitForNew(
  client: ImapFlow,
  folder: string,
  seconds: number,
): Promise<{ report: NonNullable<ProbeReport['idle']>; newUid: number | null }> {
  const mailbox = await examine(client, folder);
  const uidNextBefore = toNumber(mailbox?.uidNext) ?? 1;

  let existsEventSeen = false;
  let wake: () => void = () => {};
  const woken = new Promise<void>((resolve) => {
    wake = resolve;
  });
  const onExists = (event: { path?: string } | undefined) => {
    if (event?.path !== undefined && event.path !== folder) return;
    existsEventSeen = true;
    wake();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  client.on('exists', onExists);
  try {
    const idling = client.idle().catch(() => undefined);
    await Promise.race([
      woken,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, seconds * 1000);
      }),
    ]);
    // A NOOP ends IDLE (ImapFlow sends DONE first) and collects pending updates.
    await client.noop();
    await idling;
  } finally {
    clearTimeout(timer);
    client.off('exists', onExists);
  }

  const status = await statusOf(client, folder);
  const newMessageArrived = status.uidNext !== null && status.uidNext > uidNextBefore;
  let newUid: number | null = null;
  if (newMessageArrived) {
    const found = await client.search({ uid: `${uidNextBefore}:*` }, { uid: true });
    const fresh = Array.isArray(found) ? found.filter((u) => u >= uidNextBefore) : [];
    newUid = fresh.length === 0 ? null : Math.max(...fresh);
  }
  return { report: { seconds, existsEventSeen, newMessageArrived, newUid }, newUid };
}

/**
 * Compare an earlier report with this one (SPK-04, D-43): per folder whether
 * UIDVALIDITY changed, folders present in only one report, and for sampled
 * messages matched by internal-ID hash how many changed UID or INTERNALDATE.
 */
export function compareReports(
  previous: ProbeReport,
  current: ProbeReport,
): NonNullable<ProbeReport['compare']> {
  const before = new Map(Object.entries(previous.uidValidity));
  const after = new Map(Object.entries(current.uidValidity));
  const changed: [string, boolean][] = [];
  const missingFolders: string[] = [];
  for (const [folder, value] of before) {
    if (after.has(folder)) changed.push([folder, after.get(folder) !== value]);
    else missingFolders.push(folder);
  }
  const addedFolders = [...after.keys()].filter((folder) => !before.has(folder));

  const byHash = new Map<string, ProbeReport['sample'][number]>();
  for (const entry of current.sample) {
    if (entry.internalIdSha256 !== null) byHash.set(entry.internalIdSha256, entry);
  }
  let sampleMatched = 0;
  let uidChanged = 0;
  let internalDateChanged = 0;
  let sampleMissing = 0;
  for (const entry of previous.sample) {
    if (entry.internalIdSha256 === null) continue;
    const match = byHash.get(entry.internalIdSha256);
    if (match === undefined) {
      sampleMissing += 1;
      continue;
    }
    sampleMatched += 1;
    if (match.uid !== entry.uid) uidChanged += 1;
    if (match.internalDate !== entry.internalDate) internalDateChanged += 1;
  }

  return {
    uidValidityChanged: Object.fromEntries(changed),
    addedFolders: addedFolders.sort(),
    missingFolders: missingFolders.sort(),
    sampleMatched,
    uidChanged,
    internalDateChanged,
    sampleMissing,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An earlier probe report from JSON text, or null when the text is not one.
 * Only the fields compareReports reads are checked.
 */
export function parseProbeReport(text: string): ProbeReport | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.probeVersion !== 1) return null;
  const { uidValidity, sample } = value;
  if (!isRecord(uidValidity) || !Object.values(uidValidity).every((v) => typeof v === 'number')) {
    return null;
  }
  if (
    !Array.isArray(sample) ||
    !sample.every(
      (s) =>
        isRecord(s) &&
        typeof s.uid === 'number' &&
        typeof s.internalDate === 'string' &&
        (s.internalIdSha256 === null || typeof s.internalIdSha256 === 'string'),
    )
  ) {
    return null;
  }
  return value as unknown as ProbeReport;
}
