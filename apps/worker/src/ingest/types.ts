/**
 * Ingest contracts shared by the IMAP adapter (02-09), the sync engine (02-10)
 * and the worker store (02-13). Types only: no runtime code, no IMAP client or
 * database imports, so the engine can be tested against in-memory fakes.
 */

export interface FolderStatus {
  uidValidity: number;
  uidNext: number;
  exists: number;
}

export interface UidDate {
  uid: number;
  internalDate: Date;
}

export interface AddressLite {
  name?: string;
  address?: string;
}

export interface EnvelopeLite {
  date?: Date;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  from?: AddressLite[];
  sender?: AddressLite[];
  replyTo?: AddressLite[];
  to?: AddressLite[];
  cc?: AddressLite[];
}

/** One BODYSTRUCTURE node, shaped like the IMAP client's structure object. */
export interface BodyNode {
  part?: string;
  type: string;
  parameters?: Record<string, string>;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  size?: number;
  childNodes?: BodyNode[];
}

/** One message as fetched for ingest: the selected header block plus IMAP metadata. */
export interface HeaderRecord {
  uid: number;
  internalDate: Date;
  size: number;
  rawHeaders: Buffer;
  envelope?: EnvelopeLite;
  bodyStructure?: BodyNode;
}

export interface TextPart {
  text: string;
  truncated: boolean;
}

/** Read-only view of one IMAP folder. Every fetch uses BODY.PEEK (D-11). */
export interface FolderSource {
  /** EXAMINE (read-only). */
  examine(folder: string): Promise<FolderStatus>;
  /** UID FETCH <range> (UID INTERNALDATE); may include uids at or below the range start (RFC 3501 n:*). */
  fetchDates(range: string): Promise<UidDate[]>;
  /** BODY.PEEK[HEADER.FIELDS (HEADER_FIELDS)], ENVELOPE, BODYSTRUCTURE, RFC822.SIZE, INTERNALDATE. */
  fetchHeaders(uids: readonly number[]): Promise<HeaderRecord[]>;
  /** UID SEARCH UID <range>. */
  listUids(range: string): Promise<number[]>;
  /** UID SEARCH SINCE <date>. */
  searchSince(since: Date): Promise<number[]>;
  /** Decoded text of one part, BODY.PEEK only. */
  downloadText(uid: number, part: string, maxBytes: number): Promise<TextPart>;
}

export interface AttachmentMeta {
  name: string | null;
  mimeType: string;
  sizeBytes: number | null;
}

export interface ParsedMessage {
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
  textPart: { part: string; kind: 'text_plain' | 'text_html' } | null;
}

export interface BodyText {
  text: string;
  source: 'text_plain' | 'text_html' | 'none';
  truncated: boolean;
}

export interface MessageRecord {
  parsed: ParsedMessage;
  uid: number;
  eligible: boolean;
  body: BodyText | null;
}

/** D-75 first backfill of a folder. */
export interface BackfillState {
  since: Date;
  cursorUid: number;
  untilUid: number;
  total: number;
}

export interface FolderState {
  folder: string;
  uidValidity: number;
  lastUid: number;
  watermark: Date;
  generation: number;
  state: 'ok' | 'resyncing';
  pendingUidValidity: number | null;
  pendingGeneration: number | null;
  backfill: BackfillState | null;
}

export interface ChunkAdvance {
  lastUid?: number;
  watermark?: Date;
  backfillCursorUid?: number;
}

export interface ResyncCounts {
  matched: number;
  new: number;
  gone: number;
  older: number;
}

export interface LiveLocationRef {
  id: string;
  uid: number;
  uidValidity: number;
  generation: number;
  messageId: string;
}

/** Each method is one transaction; implemented over the database in 02-13, in memory in 02-10 tests. */
export interface IngestStore {
  getFolder(folder: string): Promise<FolderState | null>;
  createFolder(init: {
    folder: string;
    uidValidity: number;
    lastUid: number;
    watermark: Date;
    backfill: BackfillState | null;
  }): Promise<FolderState>;
  commitChunk(
    folder: string,
    uidValidity: number,
    generation: number,
    records: readonly MessageRecord[],
    advance: ChunkAdvance | null,
    options?: { promoteEligible?: boolean },
  ): Promise<{ inserted: number; existing: number }>;
  setBackfill(folder: string, backfill: BackfillState | null): Promise<void>;
  knownIdentities(keys: readonly string[]): Promise<Set<string>>;
  liveLocations(folder: string): Promise<LiveLocationRef[]>;
  /** removed_at + reason vanished + orphan body delete. */
  markVanished(locationIds: readonly string[]): Promise<number>;
  beginResync(folder: string, pendingUidValidity: number, pendingGeneration: number): Promise<void>;
  /**
   * gone = locations marked vanished by this call; backfill is written in the
   * same transaction when present (02-10).
   */
  finishResync(
    folder: string,
    done: {
      uidValidity: number;
      generation: number;
      lastUid: number;
      watermark: Date;
      counts: Omit<ResyncCounts, 'gone'>;
      backfill?: BackfillState | null;
    },
  ): Promise<ResyncCounts>;
  deleteExpiredBodies(at: Date): Promise<number>;
}

export type IngestOutcome =
  | {
      kind: 'synced';
      firstSync: boolean;
      stored: number;
      historical: number;
      vanished: number;
      backfill: { done: number; total: number; finished: boolean } | null;
    }
  | { kind: 'resynced'; counts: ResyncCounts }
  | { kind: 'needs_attention'; candidateNew: number }
  | { kind: 'aborted'; stored: number };

export interface IngestLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}
