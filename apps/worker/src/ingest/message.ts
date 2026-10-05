import { convert, type HtmlToTextOptions } from 'html-to-text';
import libmime from 'libmime';
import {
  identityKey,
  normaliseMessageId,
  stableHeaderHash,
  stripNul,
  truncateCodePoints,
} from './identity.ts';
import type {
  AttachmentMeta,
  BodyNode,
  BodyText,
  HeaderRecord,
  ParsedMessage,
  TextPart,
} from './types.ts';

/**
 * Header fields fetched for every message with BODY.PEEK[HEADER.FIELDS (...)]:
 * identity (D-12), the `hdr:` hash inputs, and what Phase 3 rules read.
 */
export const HEADER_FIELDS: readonly string[] = [
  'message-id',
  'x-pm-internal-id',
  'x-pm-external-id',
  'date',
  'from',
  'sender',
  'reply-to',
  'to',
  'cc',
  'subject',
  'list-id',
  'list-unsubscribe',
  'precedence',
  'auto-submitted',
  'in-reply-to',
  'references',
  'content-type',
];

/** Stored body text cap in code points (D-06). */
export const BODY_TEXT_MAX_CHARS = 32_768;
/** Largest body part download in bytes (D-06). */
export const BODY_DOWNLOAD_MAX_BYTES = 262_144;
/** Per header value cap in code points (T-02-24). */
export const HEADER_VALUE_MAX_CHARS = 2_000;
/** Values kept per header name (T-02-24). */
export const HEADER_VALUES_MAX = 20;
/** Attachment metadata entries kept per message (D-06). */
export const ATTACHMENTS_MAX = 100;
/** Attachment name cap in code points. */
export const ATTACHMENT_NAME_MAX_CHARS = 255;

/** A header field name: printable ASCII except the colon (RFC 5322 ftext). */
const HEADER_NAME = /^[\x21-\x39\x3b-\x7e]{1,200}$/;
const ENCODED_WORD = /=\?[^?\s]+\?([bBqQ])\?([^?\s]*)\?=/g;
const BASE64_TEXT = /^[A-Za-z0-9+/]*={0,2}$/;

/** NUL-free, well-formed (no lone surrogates) and capped. */
function clean(value: string, max: number): string {
  return truncateCodePoints(stripNul(value).toWellFormed(), max).text;
}

/**
 * RFC 2047 decoding that never throws and never loses text: a value holding a
 * malformed B-encoded word keeps its raw text, as does any decode failure.
 */
function decodeWordsSafe(value: string): string {
  for (const match of value.matchAll(ENCODED_WORD)) {
    if (match[1]?.toUpperCase() === 'B' && !BASE64_TEXT.test(match[2] ?? '')) return value;
  }
  try {
    return libmime.decodeWords(value);
  } catch {
    return value;
  }
}

/**
 * Header block -> lowercase name -> values. libmime unfolds; values are then
 * optionally RFC 2047-decoded, NUL-stripped and capped. Lines without a usable
 * name are dropped. The input is read as UTF-8: encoded words are ASCII, and
 * raw 8-bit UTF-8 headers decode correctly (invalid bytes become U+FFFD).
 */
function readHeaderBlock(raw: Buffer, decodeWords: boolean): Record<string, string[]> {
  let decoded: Record<string, string[]>;
  try {
    decoded = libmime.decodeHeaders(raw.toString('utf8'));
  } catch {
    return {};
  }
  const out = new Map<string, string[]>();
  for (const [rawName, values] of Object.entries(decoded)) {
    const name = stripNul(rawName).trim().toLowerCase();
    if (!HEADER_NAME.test(name)) continue;
    const kept = out.get(name) ?? [];
    for (const value of values) {
      if (kept.length >= HEADER_VALUES_MAX) break;
      kept.push(clean(decodeWords ? decodeWordsSafe(value) : value, HEADER_VALUE_MAX_CHARS));
    }
    out.set(name, kept);
  }
  return Object.fromEntries(out);
}

/** Parsed, RFC 2047-decoded header record of one message (ING-02). Never throws. */
export function parseHeaderBlock(raw: Buffer): Record<string, string[]> {
  return readHeaderBlock(raw, true);
}

/** Address with only the domain (after the last `@`) lowercased. */
function splitAddress(address: string | undefined): {
  address: string | null;
  domain: string | null;
} {
  if (address === undefined) return { address: null, domain: null };
  const v = clean(address, HEADER_VALUE_MAX_CHARS).trim();
  if (v === '') return { address: null, domain: null };
  const at = v.lastIndexOf('@');
  if (at < 0 || at === v.length - 1) return { address: v, domain: null };
  const domain = v.slice(at + 1).toLowerCase();
  return { address: `${v.slice(0, at)}@${domain}`, domain };
}

/**
 * One fetched header record -> identity-keyed, bounded ParsedMessage. Identity
 * reads the raw (not RFC 2047-decoded) Message-ID and X-Pm-Internal-Id, never
 * the envelope, because their exact bytes are the key (D-13). `trustPmHeader`
 * is true only for Bridge mailboxes (Pitfall 12).
 */
export function parseMessage(rec: HeaderRecord, opts: { trustPmHeader: boolean }): ParsedMessage {
  const headers = parseHeaderBlock(rec.rawHeaders);
  const rawHeaders = readHeaderBlock(rec.rawHeaders, false);
  const rawMessageId = rawHeaders['message-id']?.[0] ?? null;
  const pmInternalId = rawHeaders['x-pm-internal-id']?.[0] ?? null;
  const sizeBytes = Number.isFinite(rec.size) ? rec.size : null;

  const key = identityKey(
    { pmInternalId, messageId: rawMessageId, stableHash: stableHeaderHash(rawHeaders, sizeBytes) },
    opts,
  );
  const from = splitAddress(rec.envelope?.from?.[0]?.address);
  const envelopeSubject = rec.envelope?.subject;
  const subject =
    envelopeSubject !== undefined && envelopeSubject !== ''
      ? clean(envelopeSubject, HEADER_VALUE_MAX_CHARS)
      : (headers.subject?.[0] ?? null);
  const date = rec.envelope?.date;

  return {
    identityKey: key,
    messageIdHeader: rawMessageId === null ? null : normaliseMessageId(rawMessageId),
    internalDate: rec.internalDate,
    sentAt: date instanceof Date && !Number.isNaN(date.getTime()) ? date : null,
    fromAddress: from.address,
    fromDomain: from.domain,
    subject,
    headers,
    attachments: attachmentsOf(rec.bodyStructure),
    sizeBytes,
    textPart: selectTextPart(rec.bodyStructure),
  };
}

type TextKind = 'text_plain' | 'text_html';

function lower(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isAttachmentDisposition(node: BodyNode): boolean {
  return lower(node.disposition) === 'attachment';
}

/** message/rfc822 and friends: their parts belong to the attached message, not this one. */
function isEmbeddedMessage(node: BodyNode): boolean {
  return lower(node.type).startsWith('message/');
}

/**
 * Nodes in document (depth-first) order, iteratively so a hostile, deeply
 * nested structure cannot overflow the stack. Embedded messages are yielded
 * but not entered.
 */
function* walk(root: BodyNode): Generator<BodyNode> {
  const stack: BodyNode[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    yield node;
    if (isEmbeddedMessage(node) || !node.childNodes) continue;
    for (let i = node.childNodes.length - 1; i >= 0; i -= 1) {
      const child = node.childNodes[i];
      if (child) stack.push(child);
    }
  }
}

/**
 * The body part to download (D-06): the first text/plain part, else the first
 * text/html part, depth-first. Parts with attachment disposition and parts of
 * attached messages are never the body. A single-part message without a part
 * number is part 1 (RFC 3501 BODY[1]).
 */
export function selectTextPart(
  root: BodyNode | undefined,
): { part: string; kind: TextKind } | null {
  if (root === undefined) return null;
  let html: { part: string; kind: TextKind } | null = null;
  for (const node of walk(root)) {
    if (isAttachmentDisposition(node)) continue;
    const part = node.part ?? (node === root ? '1' : undefined);
    if (part === undefined) continue;
    const type = lower(node.type);
    if (type === 'text/plain') return { part, kind: 'text_plain' };
    if (type === 'text/html' && html === null) html = { part, kind: 'text_html' };
  }
  return html;
}

function attachmentName(node: BodyNode): string | null {
  const raw = node.dispositionParameters?.filename ?? node.parameters?.name;
  if (raw === undefined) return null;
  const name = clean(decodeWordsSafe(raw), ATTACHMENT_NAME_MAX_CHARS).trim();
  return name === '' ? null : name;
}

/**
 * Attachment metadata only, never content (D-06): parts with attachment
 * disposition or a file name, in document order, at most ATTACHMENTS_MAX.
 */
export function attachmentsOf(root: BodyNode | undefined): AttachmentMeta[] {
  if (root === undefined) return [];
  const out: AttachmentMeta[] = [];
  for (const node of walk(root)) {
    if (out.length >= ATTACHMENTS_MAX) break;
    const name = attachmentName(node);
    if (!isAttachmentDisposition(node) && name === null) continue;
    const size = node.size;
    out.push({
      name,
      mimeType: clean(lower(node.type), ATTACHMENT_NAME_MAX_CHARS) || 'application/octet-stream',
      sizeBytes: typeof size === 'number' && Number.isFinite(size) && size >= 0 ? size : null,
    });
  }
  return out;
}

/**
 * HTML nesting depth converted to text. Deeper nodes are dropped: without a
 * limit, a few thousand nested elements overflow html-to-text's recursion.
 */
export const HTML_MAX_DEPTH = 200;

/**
 * html-to-text options (T-02-25): no wrapping; script, style and images are
 * skipped explicitly rather than by library default; link targets dropped.
 */
const HTML_TO_TEXT_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  limits: { maxDepth: HTML_MAX_DEPTH, ellipsis: '' },
  selectors: [
    { selector: 'img', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'style', format: 'skip' },
    { selector: 'a', options: { ignoreHref: true } },
  ],
};

/**
 * Stored body text (D-06): plain text as is, HTML converted to text, then NUL
 * stripped and capped at BODY_TEXT_MAX_CHARS code points. `truncated` is also
 * true when the download itself was cut at BODY_DOWNLOAD_MAX_BYTES. No text
 * part gives source `none` with empty text.
 */
export function toBodyText(download: TextPart | null, kind: TextKind | null): BodyText {
  if (download === null || kind === null) return { text: '', source: 'none', truncated: false };
  const input = stripNul(download.text);
  const text = kind === 'text_html' ? convert(input, HTML_TO_TEXT_OPTIONS) : input;
  const capped = truncateCodePoints(stripNul(text).toWellFormed(), BODY_TEXT_MAX_CHARS);
  return { text: capped.text, source: kind, truncated: download.truncated || capped.truncated };
}
