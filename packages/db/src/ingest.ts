import type { InferSelectModel } from 'drizzle-orm';
import type { folderSync, ResyncSummary } from './schema/index.ts';
import type { Scope } from './scope.ts';

export type { ResyncSummary } from './schema/index.ts';

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

export type FolderSyncRow = InferSelectModel<typeof folderSync>;

/** A pending first backfill of a folder (D-75): all four columns are set together. */
export interface BackfillCursor {
  since: Date;
  cursorUid: number;
  untilUid: number;
  total: number;
}

/** The four backfill columns for a cursor, or all null. */
function backfillColumns(backfill: BackfillCursor | null) {
  return {
    backfillSince: backfill?.since ?? null,
    backfillCursorUid: backfill?.cursorUid ?? null,
    backfillUntilUid: backfill?.untilUid ?? null,
    backfillTotal: backfill?.total ?? null,
  };
}

/** Thrown when a folder has no folder_sync row; names the folder only. */
function missingFolder(folder: string): Error {
  return new Error(`folder_sync row missing for folder "${folder}"`);
}

/**
 * The folder's sync state, or null before its first sync (D-18).
 * Runs in the caller's transaction (the scope).
 */
export async function getFolderSync(scope: Scope, folder: string): Promise<FolderSyncRow | null> {
  const [row] = await scope.folderSync.find({ folder });
  return row ?? null;
}

/**
 * Create the folder's sync state at its first sync (D-18), with the first
 * backfill cursor when one is pending (D-75). Generation starts at 1.
 * Runs in the caller's transaction (the scope).
 */
export async function createFolderSync(
  scope: Scope,
  init: {
    folder: string;
    uidvalidity: number;
    lastUid: number;
    internalDateWatermark: Date;
    backfill: BackfillCursor | null;
  },
): Promise<FolderSyncRow> {
  const [row] = await scope.folderSync.insert([
    {
      folder: init.folder,
      uidvalidity: init.uidvalidity,
      lastUid: init.lastUid,
      internalDateWatermark: init.internalDateWatermark,
      ...backfillColumns(init.backfill),
    },
  ]);
  if (row === undefined) throw new Error('folder_sync insert returned no row');
  return row;
}

/**
 * Move the folder's watermarks forward after a committed chunk (D-04, D-18).
 * Each given value only ever moves forward (a lower one is ignored), and a
 * call that changes nothing writes nothing. Moving the backfill cursor needs
 * a pending backfill (D-75).
 * Runs in the caller's transaction (the scope; the ingest lock, D-03, keeps
 * other writers of this mailbox out between the read and the write).
 */
export async function advanceFolderSync(
  scope: Scope,
  folder: string,
  to: { lastUid?: number; internalDateWatermark?: Date; backfillCursorUid?: number },
): Promise<void> {
  const row = await getFolderSync(scope, folder);
  if (row === null) throw missingFolder(folder);
  const set: {
    lastUid?: number;
    internalDateWatermark?: Date;
    backfillCursorUid?: number;
  } = {};
  if (to.lastUid !== undefined && to.lastUid > row.lastUid) set.lastUid = to.lastUid;
  if (
    to.internalDateWatermark !== undefined &&
    to.internalDateWatermark.getTime() > row.internalDateWatermark.getTime()
  ) {
    set.internalDateWatermark = to.internalDateWatermark;
  }
  if (to.backfillCursorUid !== undefined) {
    if (row.backfillCursorUid === null) {
      throw new Error(`no backfill pending for folder "${folder}"`);
    }
    if (to.backfillCursorUid > row.backfillCursorUid) set.backfillCursorUid = to.backfillCursorUid;
  }
  if (Object.keys(set).length === 0) return;
  await scope.folderSync.update(set, { id: row.id });
}

/**
 * Start, restart (after a resync) or finish (null) the folder's first
 * backfill (D-75). All four backfill columns are written together.
 * Runs in the caller's transaction (the scope).
 */
export async function setFolderBackfill(
  scope: Scope,
  folder: string,
  backfill: BackfillCursor | null,
): Promise<void> {
  const rows = await scope.folderSync.update(backfillColumns(backfill), { folder });
  if (rows.length === 0) throw missingFolder(folder);
}

/** A location that is still on the server (removed_at is null). */
export interface LiveLocation {
  id: string;
  uid: number;
  uidvalidity: number;
  generation: number;
  messageId: string;
}

/**
 * The folder's live locations, of any UIDVALIDITY and generation (D-15,
 * D-17). Used for the removal diff and the resync.
 *
 * While folder_sync.state is 'resyncing', two generations can be live at
 * once, so readers that act on mailbox state (Phase 4 label application)
 * must treat a resyncing folder as "do not act" (D-24).
 *
 * Runs in the caller's transaction (the scope).
 */
export async function liveLocations(scope: Scope, folder: string): Promise<LiveLocation[]> {
  const rows = await scope.messageLocation.find({ folder, removedAt: null });
  return rows.map((row) => ({
    id: row.id,
    uid: row.uid,
    uidvalidity: row.uidvalidity,
    generation: row.generation,
    messageId: row.messageId,
  }));
}

/**
 * Mark live locations removed (D-17 'vanished', D-23 'superseded'). The
 * message row stays. Already-removed locations keep their first removal.
 * Returns the number of locations marked.
 * Runs in the caller's transaction (the scope).
 */
export async function markLocationsRemoved(
  scope: Scope,
  ids: readonly string[],
  reason: 'vanished' | 'superseded',
  at: Date = new Date(),
): Promise<number> {
  const rows = await scope.messageLocation.update(
    { removedAt: at, removedReason: reason },
    { id: ids, removedAt: null },
  );
  return rows.length;
}

/**
 * Delete the cached body of each given message that has no live location in
 * any folder and no decision row (D-07: mail that left before it was ever
 * classified keeps no body). Returns the number of bodies deleted.
 * Runs in the caller's transaction (the scope).
 */
export async function deleteOrphanBodies(
  scope: Scope,
  messageIds: readonly string[],
): Promise<number> {
  const candidates = [...new Set(messageIds)];
  if (candidates.length === 0) return 0;
  const keep = new Set<string>();
  for (const row of await scope.messageLocation.find({
    messageId: candidates,
    removedAt: null,
  })) {
    keep.add(row.messageId);
  }
  for (const row of await scope.decision.find({ messageId: candidates })) {
    keep.add(row.messageId);
  }
  const orphans = candidates.filter((id) => !keep.has(id));
  const deleted = await scope.messageBody.delete({ messageId: orphans });
  return deleted.length;
}

/**
 * Which of the given identity keys are stored, with their message id and
 * eligibility (D-12, D-19 dedup). Unknown keys are absent from the map.
 * Runs in the caller's transaction (the scope).
 */
export async function knownIdentityKeys(
  scope: Scope,
  keys: readonly string[],
): Promise<Map<string, { id: string; eligible: boolean }>> {
  const rows = await scope.message.find({ identityKey: [...new Set(keys)] });
  return new Map(
    rows.map((row) => [row.identityKey, { id: row.id, eligible: row.eligibleForClassification }]),
  );
}

/**
 * Mark the folder 'resyncing' toward a new UIDVALIDITY and generation
 * (D-23, D-24). The current generation stays authoritative until
 * finishResync; a failed resync restarts from here.
 * Runs in the caller's transaction (the scope).
 */
export async function beginResync(
  scope: Scope,
  folder: string,
  pending: { pendingUidvalidity: number; pendingGeneration: number },
): Promise<void> {
  const rows = await scope.folderSync.update(
    {
      state: 'resyncing',
      pendingUidvalidity: pending.pendingUidvalidity,
      pendingGeneration: pending.pendingGeneration,
    },
    { folder },
  );
  if (rows.length === 0) throw missingFolder(folder);
}

/**
 * Complete a resync (D-23, D-25, D-75).
 *
 * Every live location of the folder outside the new generation is marked
 * 'superseded' when its message has a live new-generation location in this
 * folder, and 'vanished' otherwise; the vanished messages' bodies are
 * deleted when they are orphans (D-07). Then folder_sync takes the new
 * UIDVALIDITY, generation, last UID and watermark, state 'ok' with the
 * pending columns cleared, last_resync_at and last_resync_summary (whose
 * `gone` is the number of distinct messages marked vanished). `backfill`
 * replaces the four backfill columns, null clears them, undefined leaves
 * them as they are.
 *
 * Several statements: atomic only because the caller runs it in one scope
 * (02-13 maps IngestStore.finishResync to exactly one session.run), so a
 * crash can never leave a backfill cursor from the old UIDVALIDITY next to
 * the new one. It opens no transaction of its own.
 */
export async function finishResync(
  scope: Scope,
  folder: string,
  done: {
    uidvalidity: number;
    generation: number;
    lastUid: number;
    internalDateWatermark: Date;
    summary: Omit<ResyncSummary, 'gone'>;
    backfill?: BackfillCursor | null;
    at?: Date;
  },
): Promise<{ superseded: number; vanished: number; summary: ResyncSummary }> {
  const at = done.at ?? new Date();
  const live = await liveLocations(scope, folder);
  const current = new Set(
    live.filter((l) => l.generation === done.generation).map((l) => l.messageId),
  );
  const old = live.filter((l) => l.generation !== done.generation);
  const superseded = old.filter((l) => current.has(l.messageId));
  const vanished = old.filter((l) => !current.has(l.messageId));

  const supersededCount = await markLocationsRemoved(
    scope,
    superseded.map((l) => l.id),
    'superseded',
    at,
  );
  const vanishedCount = await markLocationsRemoved(
    scope,
    vanished.map((l) => l.id),
    'vanished',
    at,
  );
  const goneMessages = [...new Set(vanished.map((l) => l.messageId))];
  await deleteOrphanBodies(scope, goneMessages);

  const summary: ResyncSummary = { ...done.summary, gone: goneMessages.length };
  const rows = await scope.folderSync.update(
    {
      uidvalidity: done.uidvalidity,
      generation: done.generation,
      lastUid: done.lastUid,
      internalDateWatermark: done.internalDateWatermark,
      state: 'ok',
      pendingUidvalidity: null,
      pendingGeneration: null,
      lastResyncAt: at,
      lastResyncSummary: summary,
      ...(done.backfill === undefined ? {} : backfillColumns(done.backfill)),
    },
    { folder },
  );
  if (rows.length === 0) throw missingFolder(folder);
  return { superseded: supersededCount, vanished: vanishedCount, summary };
}

/**
 * The body-cache sweep (D-07): delete this mailbox's bodies whose expires_at
 * is at or before `at`. Returns the count.
 * Runs in the caller's transaction (the scope).
 */
export async function deleteExpiredBodies(scope: Scope, at: Date = new Date()): Promise<number> {
  return scope.messageBody.deleteExpired(at);
}
