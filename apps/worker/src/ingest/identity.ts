import { createHash } from 'node:crypto';

/**
 * Headers hashed into the `hdr:` fallback key, in this order, plus RFC822.SIZE
 * (D-12). Assumption A6: the live spike confirms or changes this set. A
 * confirmed change bumps HDR_KEY_VERSION, so stored keys stay valid and are
 * never reused for a different input set (D-82).
 */
export const HDR_HASH_INPUTS = ['date', 'from', 'to', 'cc', 'subject', 'in-reply-to'] as const;

/** Names the HDR_HASH_INPUTS set; a changed input set gets a new version, never a reused one (D-82). */
export const HDR_KEY_VERSION = 'v1';

/**
 * Longest usable Message-ID, in UTF-8 bytes: the RFC 5322 line limit. A longer
 * one falls through to the `hdr:` key, so a hostile header can never exceed the
 * unique index's row size and block a chunk forever.
 */
export const MESSAGE_ID_MAX_BYTES = 998;

/** A Proton internal ID as Bridge writes it (base64url-like, bounded). */
const PM_INTERNAL_ID = /^[A-Za-z0-9_=-]{1,200}$/;

/** Postgres rejects NUL in text and jsonb (Pitfall 7), so every stored string goes through this. */
export function stripNul(value: string): string {
  return value.replaceAll('\u0000', '');
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Cut `value` to at most `max` Unicode code points. A surrogate pair counts as
 * one code point and is never split.
 */
export function truncateCodePoints(
  value: string,
  max: number,
): { text: string; truncated: boolean } {
  // A string of at most `max` UTF-16 units has at most `max` code points.
  if (value.length <= max) return { text: value, truncated: false };
  let count = 0;
  let i = 0;
  while (i < value.length) {
    if (count >= max) return { text: value.slice(0, i), truncated: true };
    const pair =
      isHighSurrogate(value.charCodeAt(i)) &&
      i + 1 < value.length &&
      isLowSurrogate(value.charCodeAt(i + 1));
    i += pair ? 2 : 1;
    count += 1;
  }
  return { text: value, truncated: false };
}

/**
 * Conservative Message-ID normalisation (D-13): strip NUL, surrounding
 * whitespace and one pair of angle brackets, then lowercase only the domain
 * after the last `@`. The local part is case-sensitive and compared byte-wise,
 * so `<A@x>` and `<a@x>` stay different. Empty, whitespace-only, `<>` or
 * over-long values give null, which falls through to the next key kind.
 */
export function normaliseMessageId(raw: string): string | null {
  let v = stripNul(raw).trim();
  if (v.startsWith('<')) v = v.slice(1);
  if (v.endsWith('>')) v = v.slice(0, -1);
  v = v.trim();
  if (v === '') return null;
  const at = v.lastIndexOf('@');
  const normalised = at < 0 ? v : `${v.slice(0, at)}@${v.slice(at + 1).toLowerCase()}`;
  if (Buffer.byteLength(normalised, 'utf8') > MESSAGE_ID_MAX_BYTES) return null;
  return normalised;
}

function canonicalValue(value: string): string {
  return stripNul(value).trim().replace(/\s+/g, ' ');
}

/**
 * sha256 hex over canonical JSON of the HDR_HASH_INPUTS headers (in that order,
 * values NUL-stripped, trimmed, whitespace collapsed) followed by the size
 * (D-12, A6). Header names must be lowercase, as parseHeaderBlock gives them.
 */
export function stableHeaderHash(headers: Record<string, string[]>, size: number | null): string {
  const pairs = HDR_HASH_INPUTS.map((name) => [name, (headers[name] ?? []).map(canonicalValue)]);
  const canonical = JSON.stringify([...pairs, size]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * The stable identity key of a message (D-12), first match wins:
 * - `pm:<id>` from Bridge's X-Pm-Internal-Id, only when `trustPmHeader` is set.
 *   Bridge overwrites any sender copy of that header, so it is the one key a
 *   sender cannot forge; any other server passes a forged one through
 *   (Pitfall 12), hence the explicit trust flag.
 * - `mid:<normalised Message-ID>` (D-13). Two different messages with the same
 *   Message-ID share this key by design and merge (D-14).
 * - `hdr:v1:<sha256>` from stableHeaderHash; the version names the hash inputs (D-82).
 */
export function identityKey(
  input: { pmInternalId: string | null; messageId: string | null; stableHash: string },
  opts: { trustPmHeader: boolean },
): string {
  if (opts.trustPmHeader && input.pmInternalId !== null) {
    const pm = stripNul(input.pmInternalId).trim();
    if (PM_INTERNAL_ID.test(pm)) return `pm:${pm}`;
  }
  const mid = input.messageId === null ? null : normaliseMessageId(input.messageId);
  if (mid !== null) return `mid:${mid}`;
  return `hdr:${HDR_KEY_VERSION}:${input.stableHash}`;
}
