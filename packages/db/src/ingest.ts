import type { Scope } from './scope.ts';

/**
 * Ingest use-cases over the scoped API (D-14, D-15, D-06, D-07, D-21, D-23).
 *
 * Every function runs inside the caller's transaction, which is the scope:
 * none opens a transaction of its own. A multi-statement use-case is atomic
 * only because the caller runs it in one withMailbox scope (02-13 maps each
 * IngestStore method to exactly one session.run).
 *
 * Batch results from the database come back in no promised order, so rows
 * are always matched to their input by key (identity key, or the location's
 * folder/UIDVALIDITY/UID), never by array position.
 */

/** One attachment's metadata (D-08). Never its content. */
export interface AttachmentMeta {
  name: string | null;
  mimeType: string;
  sizeBytes: number | null;
}

/** The stored fields of one email (D-08, D-12, D-21). */
export interface MessageInput {
  identityKey: string;
  messageIdHeader: string | null;
  internalDate: Date;
  sentAt: Date | null;
  fromAddress: string | null;
  fromDomain: string | null;
  subject: string | null;
  headers: Record<string, string[]>;
  attachments: AttachmentMeta[];
  sizeBytes: number | null;
  eligibleForClassification: boolean;
}

/** Where the email was seen (D-15). */
export interface LocationInput {
  folder: string;
  uidvalidity: number;
  uid: number;
  generation: number;
}

/**
 * The body-cache entry (D-06). A message with no text part has source 'none'
 * and bodyText '' (02-07 toBodyText), never a missing body.
 */
export interface BodyInput {
  bodyText: string;
  source: 'text_plain' | 'text_html' | 'none';
  truncated: boolean;
}

/** One fetched UID: the message, its location and, when fetched, its body. */
export interface StoreItem {
  message: MessageInput;
  location: LocationInput;
  body: BodyInput | null;
}

export interface StoreResult {
  /** Distinct identity keys this call inserted. */
  insertedMessages: number;
  /** Distinct identity keys that were already stored. */
  existingMessages: number;
  /** Existing historical messages made eligible (promoteEligible only). */
  promotedMessages: number;
  /** Location rows this call inserted (a re-seen location is updated, not counted). */
  insertedLocations: number;
  /** Body rows this call inserted. */
  insertedBodies: number;
}

export interface StoreOptions {
  /**
   * Make an existing historical message eligible when an item for it is
   * eligible, and give it its body (CLI backfill, D-02). Without it a stored
   * message's eligibility never changes here.
   */
  promoteEligible?: boolean;
}

/**
 * Remove NUL from every string, including nested object keys and values
 * (RESEARCH Pitfall 7: PostgreSQL rejects 0x00 in text and jsonb, which would
 * make a chunk fail on every retry). Dates and other values pass through.
 */
function stripNul<V>(value: V): V {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as V;
  if (Array.isArray(value)) return value.map((v) => stripNul(v)) as V;
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [stripNul(k), stripNul(v)]),
    ) as V;
  }
  return value;
}

/** The message row for a group of items sharing one identity key. */
function messageRow(group: readonly StoreItem[]) {
  const first = group[0]?.message as MessageInput;
  return {
    identityKey: first.identityKey,
    messageIdHeader: first.messageIdHeader,
    internalDate: first.internalDate,
    sentAt: first.sentAt,
    fromAddress: first.fromAddress,
    fromDomain: first.fromDomain,
    subject: first.subject,
    headers: first.headers,
    attachments: first.attachments,
    sizeBytes: first.sizeBytes,
    eligibleForClassification: group.some((item) => item.message.eligibleForClassification),
  };
}

/**
 * Store a chunk of fetched messages (ING-02, D-14, D-15, D-21).
 *
 * Items are grouped by identity key: one message row per key (the first
 * item's fields; eligible when any item of the key is), one location per
 * (folder, UIDVALIDITY, UID), and one body for each eligible message. A key
 * already stored is "the same message" and only gains locations (D-14).
 * Message ids are looked up by identity key after the insert, so a location
 * or body is never paired with a message by position.
 *
 * Idempotent: running it again with the same items inserts nothing and
 * leaves message updated_at unchanged (messages and bodies use ON CONFLICT DO
 * NOTHING). A location seen again is set to the item's generation and made
 * live; its message is never rewritten (UIDs are immutable within one
 * UIDVALIDITY).
 *
 * Historical messages (not eligible) get no body even when one is supplied
 * (D-21). Supplying the body of an eligible message is the caller's job.
 *
 * Runs in the caller's transaction (the scope); it opens none of its own.
 */
export async function storeMessages(
  scope: Scope,
  items: readonly StoreItem[],
  options: StoreOptions = {},
): Promise<StoreResult> {
  const result: StoreResult = {
    insertedMessages: 0,
    existingMessages: 0,
    promotedMessages: 0,
    insertedLocations: 0,
    insertedBodies: 0,
  };
  if (items.length === 0) return result;

  // Group by identity key, keeping the order of first appearance.
  const groups = new Map<string, StoreItem[]>();
  for (const item of items.map((i) => stripNul(i))) {
    const group = groups.get(item.message.identityKey);
    if (group === undefined) groups.set(item.message.identityKey, [item]);
    else group.push(item);
  }
  const keys = [...groups.keys()];

  // One row per key, so the statement never holds a key twice.
  const inserted = await scope.message.insertOrIgnore(
    [...groups.values()].map((group) => messageRow(group)),
    { target: ['identityKey'] },
  );
  const insertedKeys = new Set(inserted.map((row) => row.identityKey));

  const stored = new Map<string, { id: string; eligible: boolean }>();
  for (const row of await scope.message.find({ identityKey: keys })) {
    stored.set(row.identityKey, { id: row.id, eligible: row.eligibleForClassification });
  }
  const missing = keys.filter((key) => !stored.has(key)).length;
  if (missing > 0) {
    throw new Error(`storeMessages: ${missing} message rows missing after insert`);
  }

  if (options.promoteEligible === true) {
    const promote = keys.filter((key) => {
      const row = stored.get(key);
      const group = groups.get(key) ?? [];
      return (
        !insertedKeys.has(key) &&
        row?.eligible === false &&
        group.some((item) => item.message.eligibleForClassification)
      );
    });
    const ids = promote.map((key) => stored.get(key)?.id as string);
    const promoted = await scope.message.update(
      { eligibleForClassification: true },
      { id: ids, eligibleForClassification: false },
    );
    for (const row of promoted) {
      stored.set(row.identityKey, { id: row.id, eligible: true });
    }
    result.promotedMessages = promoted.length;
  }

  // Locations: one per (folder, UIDVALIDITY, UID); the last item wins.
  const locations = new Map<
    string,
    {
      messageId: string;
      folder: string;
      uidvalidity: number;
      uid: number;
      generation: number;
      removedAt: null;
      removedReason: null;
    }
  >();
  for (const item of [...groups.values()].flat()) {
    const { folder, uidvalidity, uid, generation } = item.location;
    locations.set(JSON.stringify([folder, uidvalidity, uid]), {
      messageId: stored.get(item.message.identityKey)?.id as string,
      folder,
      uidvalidity,
      uid,
      generation,
      removedAt: null,
      removedReason: null,
    });
  }
  const upserted = await scope.messageLocation.upsert([...locations.values()], {
    target: ['folder', 'uidvalidity', 'uid'],
    update: ['generation', 'removedAt', 'removedReason'],
  });
  result.insertedLocations = upserted.filter((row) => row.inserted).length;

  // Bodies: only for messages whose stored row is eligible (D-21).
  const bodies = [];
  for (const [key, group] of groups) {
    const row = stored.get(key);
    if (row?.eligible !== true) continue;
    const body = group.find((item) => item.body !== null)?.body;
    if (body == null) continue;
    bodies.push({
      messageId: row.id,
      bodyText: body.bodyText,
      source: body.source,
      truncated: body.truncated,
    });
  }
  const insertedBodies = await scope.messageBody.insertOrIgnore(bodies, {
    target: ['messageId'],
  });

  result.insertedMessages = insertedKeys.size;
  result.existingMessages = keys.length - insertedKeys.size;
  result.insertedBodies = insertedBodies.length;
  return result;
}
