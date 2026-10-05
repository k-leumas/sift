import type {
  BackfillState,
  BodyText,
  ChunkAdvance,
  FolderState,
  IngestStore,
  LiveLocationRef,
  MessageRecord,
  ParsedMessage,
  ResyncCounts,
} from '../../src/ingest/types.ts';

/**
 * In-memory IngestStore with the semantics of the @sift/db ingest use-cases
 * (packages/db/src/ingest.ts, 02-06), for the sync engine tests (02-10).
 *
 * Every method is one transaction: it either applies all of its changes or,
 * when it throws (an injected failure included), none. Each call is recorded
 * in `events` as `<method>:start` / `<method>:end`, and `overlaps` counts calls
 * that started while another was still in flight (02-13 runs every store call
 * on one connection, so the engine must never overlap them).
 */

export type StoreMethod = keyof IngestStore;

export interface StoredMessage {
  id: string;
  identityKey: string;
  parsed: ParsedMessage;
  eligible: boolean;
}

export interface StoredLocation {
  id: string;
  messageId: string;
  folder: string;
  uidValidity: number;
  uid: number;
  generation: number;
  removedAt: Date | null;
  removedReason: 'vanished' | 'superseded' | null;
}

export interface StoredBody {
  messageId: string;
  body: BodyText;
  expiresAt: Date | null;
}

export interface StoredFolder extends FolderState {
  lastResyncSummary: ResyncCounts | null;
}

export interface CommitLogEntry {
  folder: string;
  uidValidity: number;
  generation: number;
  uids: number[];
  eligible: boolean[];
  advance: ChunkAdvance | null;
  promoteEligible: boolean;
}

interface Data {
  messages: Map<string, StoredMessage>;
  byKey: Map<string, string>;
  locations: Map<string, StoredLocation>;
  bodies: Map<string, StoredBody>;
  folders: Map<string, StoredFolder>;
  decisions: Set<string>;
  nextId: number;
}

function emptyData(): Data {
  return {
    messages: new Map(),
    byKey: new Map(),
    locations: new Map(),
    bodies: new Map(),
    folders: new Map(),
    decisions: new Set(),
    nextId: 1,
  };
}

function locationKey(folder: string, uidValidity: number, uid: number): string {
  return JSON.stringify([folder, uidValidity, uid]);
}

function copyBackfill(backfill: BackfillState | null): BackfillState | null {
  return backfill === null ? null : { ...backfill, since: new Date(backfill.since) };
}

export class FakeIngestStore implements IngestStore {
  readonly events: string[] = [];
  readonly commitLog: CommitLogEntry[] = [];
  overlaps = 0;
  private data: Data = emptyData();
  private inFlight = 0;
  private readonly failures: { method: StoreMethod; remaining: number }[] = [];
  private holds: Promise<void>[] = [];

  /** Make the nth call (1-based, counted from now) of `method` throw, writing nothing. */
  failOn(method: StoreMethod, nth = 1): void {
    this.failures.push({ method, remaining: nth });
  }

  /**
   * Hold the next commitChunk: it stays pending (after its start event) until
   * the returned function is called.
   */
  holdCommit(): () => void {
    let release: () => void = () => {};
    this.holds.push(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  /** Record a decision for a message (keeps its body when its location vanishes, D-07). */
  addDecision(messageId: string): void {
    this.data.decisions.add(messageId);
  }

  /** Set a body's expires_at (Phase 3 sets it after a decision, D-07). */
  setBodyExpiry(messageId: string, expiresAt: Date | null): void {
    const body = this.data.bodies.get(messageId);
    if (body === undefined) throw new Error(`no body for ${messageId}`);
    body.expiresAt = expiresAt;
  }

  messages(): StoredMessage[] {
    return [...this.data.messages.values()];
  }

  messageByKey(identityKey: string): StoredMessage | undefined {
    const id = this.data.byKey.get(identityKey);
    return id === undefined ? undefined : this.data.messages.get(id);
  }

  locations(): StoredLocation[] {
    return [...this.data.locations.values()];
  }

  liveLocationsOf(folder: string): StoredLocation[] {
    return this.locations().filter((l) => l.folder === folder && l.removedAt === null);
  }

  bodies(): StoredBody[] {
    return [...this.data.bodies.values()];
  }

  bodyOf(messageId: string): StoredBody | undefined {
    return this.data.bodies.get(messageId);
  }

  folder(name: string): StoredFolder | undefined {
    return this.data.folders.get(name);
  }

  /** Store calls (start events) of one method. */
  count(method: StoreMethod): number {
    return this.events.filter((e) => e === `${method}:start`).length;
  }

  private async op<T>(method: StoreMethod, apply: (data: Data) => T): Promise<T> {
    if (this.inFlight > 0) this.overlaps += 1;
    this.inFlight += 1;
    this.events.push(`${method}:start`);
    try {
      await Promise.resolve();
      for (const failure of this.failures) {
        if (failure.method !== method || failure.remaining <= 0) continue;
        failure.remaining -= 1;
        if (failure.remaining === 0) throw new Error(`injected failure: ${method}`);
      }
      if (method === 'commitChunk') {
        const hold = this.holds.shift();
        if (hold !== undefined) await hold;
      }
      // One transaction: work on a copy and keep it only when nothing threw.
      const draft = structuredClone(this.data);
      const result = apply(draft);
      this.data = draft;
      return result;
    } finally {
      this.inFlight -= 1;
      this.events.push(`${method}:end`);
    }
  }

  private static folderOf(data: Data, folder: string): StoredFolder {
    const row = data.folders.get(folder);
    if (row === undefined) throw new Error(`folder_sync row missing for folder "${folder}"`);
    return row;
  }

  private static publicState(row: StoredFolder): FolderState {
    return {
      folder: row.folder,
      uidValidity: row.uidValidity,
      lastUid: row.lastUid,
      watermark: new Date(row.watermark),
      generation: row.generation,
      state: row.state,
      pendingUidValidity: row.pendingUidValidity,
      pendingGeneration: row.pendingGeneration,
      backfill: copyBackfill(row.backfill),
    };
  }

  /** Delete bodies of messages with no live location anywhere and no decision (D-07). */
  private static deleteOrphanBodies(data: Data, messageIds: Iterable<string>): number {
    let deleted = 0;
    for (const id of new Set(messageIds)) {
      const live = [...data.locations.values()].some(
        (l) => l.messageId === id && l.removedAt === null,
      );
      if (live || data.decisions.has(id)) continue;
      if (data.bodies.delete(id)) deleted += 1;
    }
    return deleted;
  }

  private static markRemoved(
    data: Data,
    ids: readonly string[],
    reason: 'vanished' | 'superseded',
    at: Date,
  ): number {
    let marked = 0;
    for (const id of ids) {
      const location = data.locations.get(id);
      if (location === undefined || location.removedAt !== null) continue;
      location.removedAt = at;
      location.removedReason = reason;
      marked += 1;
    }
    return marked;
  }

  getFolder(folder: string): Promise<FolderState | null> {
    return this.op('getFolder', (data) => {
      const row = data.folders.get(folder);
      return row === undefined ? null : FakeIngestStore.publicState(row);
    });
  }

  createFolder(init: {
    folder: string;
    uidValidity: number;
    lastUid: number;
    watermark: Date;
    backfill: BackfillState | null;
  }): Promise<FolderState> {
    return this.op('createFolder', (data) => {
      if (data.folders.has(init.folder)) throw new Error(`duplicate folder_sync ${init.folder}`);
      const row: StoredFolder = {
        folder: init.folder,
        uidValidity: init.uidValidity,
        lastUid: init.lastUid,
        watermark: new Date(init.watermark),
        generation: 1,
        state: 'ok',
        pendingUidValidity: null,
        pendingGeneration: null,
        backfill: copyBackfill(init.backfill),
        lastResyncSummary: null,
      };
      data.folders.set(init.folder, row);
      return FakeIngestStore.publicState(row);
    });
  }

  commitChunk(
    folder: string,
    uidValidity: number,
    generation: number,
    records: readonly MessageRecord[],
    advance: ChunkAdvance | null,
    options: { promoteEligible?: boolean } = {},
  ): Promise<{ inserted: number; existing: number }> {
    this.commitLog.push({
      folder,
      uidValidity,
      generation,
      uids: records.map((r) => r.uid),
      eligible: records.map((r) => r.eligible),
      advance,
      promoteEligible: options.promoteEligible === true,
    });
    return this.op('commitChunk', (data) => {
      // Group by identity key (one message row per key, D-14).
      const groups = new Map<string, MessageRecord[]>();
      for (const record of records) {
        const group = groups.get(record.parsed.identityKey);
        if (group === undefined) groups.set(record.parsed.identityKey, [record]);
        else group.push(record);
      }
      let inserted = 0;
      let existing = 0;
      for (const [key, group] of groups) {
        const anyEligible = group.some((r) => r.eligible);
        const storedId = data.byKey.get(key);
        let message: StoredMessage;
        if (storedId === undefined) {
          message = {
            id: `m${data.nextId++}`,
            identityKey: key,
            parsed: (group[0] as MessageRecord).parsed,
            eligible: anyEligible,
          };
          data.messages.set(message.id, message);
          data.byKey.set(key, message.id);
          inserted += 1;
        } else {
          message = data.messages.get(storedId) as StoredMessage;
          existing += 1;
          if (options.promoteEligible === true && anyEligible && !message.eligible) {
            message.eligible = true;
          }
        }
        for (const record of group) {
          const lk = locationKey(folder, uidValidity, record.uid);
          const location = data.locations.get(lk);
          if (location === undefined) {
            data.locations.set(lk, {
              id: `l${data.nextId++}`,
              messageId: message.id,
              folder,
              uidValidity,
              uid: record.uid,
              generation,
              removedAt: null,
              removedReason: null,
            });
          } else {
            // A re-seen location: generation set, made live; message never rewritten.
            location.generation = generation;
            location.removedAt = null;
            location.removedReason = null;
          }
        }
        // Bodies only for eligible messages (D-21), inserted once.
        const body = group.find((r) => r.body !== null)?.body;
        if (message.eligible && body != null && !data.bodies.has(message.id)) {
          data.bodies.set(message.id, { messageId: message.id, body, expiresAt: null });
        }
      }
      if (advance !== null) {
        const row = FakeIngestStore.folderOf(data, folder);
        if (advance.lastUid !== undefined && advance.lastUid > row.lastUid) {
          row.lastUid = advance.lastUid;
        }
        if (
          advance.watermark !== undefined &&
          advance.watermark.getTime() > row.watermark.getTime()
        ) {
          row.watermark = new Date(advance.watermark);
        }
        if (advance.backfillCursorUid !== undefined) {
          if (row.backfill === null) throw new Error(`no backfill pending for folder "${folder}"`);
          if (advance.backfillCursorUid > row.backfill.cursorUid) {
            row.backfill.cursorUid = advance.backfillCursorUid;
          }
        }
      }
      return { inserted, existing };
    });
  }

  setBackfill(folder: string, backfill: BackfillState | null): Promise<void> {
    return this.op('setBackfill', (data) => {
      FakeIngestStore.folderOf(data, folder).backfill = copyBackfill(backfill);
    });
  }

  knownIdentities(keys: readonly string[]): Promise<Set<string>> {
    return this.op('knownIdentities', (data) => new Set(keys.filter((k) => data.byKey.has(k))));
  }

  liveLocations(folder: string): Promise<LiveLocationRef[]> {
    return this.op('liveLocations', (data) =>
      [...data.locations.values()]
        .filter((l) => l.folder === folder && l.removedAt === null)
        .map((l) => ({
          id: l.id,
          uid: l.uid,
          uidValidity: l.uidValidity,
          generation: l.generation,
          messageId: l.messageId,
        })),
    );
  }

  markVanished(locationIds: readonly string[]): Promise<number> {
    return this.op('markVanished', (data) => {
      const byId = new Map([...data.locations.values()].map((l) => [l.id, l]));
      const messageIds = locationIds.flatMap((id) => {
        const l = byId.get(id);
        return l === undefined ? [] : [l.messageId];
      });
      const ids = locationIds.flatMap((id) => {
        const l = byId.get(id);
        return l === undefined ? [] : [locationKey(l.folder, l.uidValidity, l.uid)];
      });
      const marked = FakeIngestStore.markRemoved(data, ids, 'vanished', new Date());
      FakeIngestStore.deleteOrphanBodies(data, messageIds);
      return marked;
    });
  }

  beginResync(
    folder: string,
    pendingUidValidity: number,
    pendingGeneration: number,
  ): Promise<void> {
    return this.op('beginResync', (data) => {
      const row = FakeIngestStore.folderOf(data, folder);
      row.state = 'resyncing';
      row.pendingUidValidity = pendingUidValidity;
      row.pendingGeneration = pendingGeneration;
    });
  }

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
  ): Promise<ResyncCounts> {
    return this.op('finishResync', (data) => {
      const row = FakeIngestStore.folderOf(data, folder);
      const live = [...data.locations.entries()].filter(
        ([, l]) => l.folder === folder && l.removedAt === null,
      );
      const current = new Set(
        live.filter(([, l]) => l.generation === done.generation).map(([, l]) => l.messageId),
      );
      const old = live.filter(([, l]) => l.generation !== done.generation);
      const superseded = old.filter(([, l]) => current.has(l.messageId));
      const vanished = old.filter(([, l]) => !current.has(l.messageId));
      const at = new Date();
      FakeIngestStore.markRemoved(
        data,
        superseded.map(([k]) => k),
        'superseded',
        at,
      );
      FakeIngestStore.markRemoved(
        data,
        vanished.map(([k]) => k),
        'vanished',
        at,
      );
      const gone = [...new Set(vanished.map(([, l]) => l.messageId))];
      FakeIngestStore.deleteOrphanBodies(data, gone);
      const counts: ResyncCounts = { ...done.counts, gone: gone.length };
      row.uidValidity = done.uidValidity;
      row.generation = done.generation;
      row.lastUid = done.lastUid;
      row.watermark = new Date(done.watermark);
      row.state = 'ok';
      row.pendingUidValidity = null;
      row.pendingGeneration = null;
      row.lastResyncSummary = counts;
      if (done.backfill !== undefined) row.backfill = copyBackfill(done.backfill);
      return counts;
    });
  }

  deleteExpiredBodies(at: Date): Promise<number> {
    return this.op('deleteExpiredBodies', (data) => {
      let deleted = 0;
      for (const [id, body] of data.bodies) {
        if (body.expiresAt !== null && body.expiresAt.getTime() <= at.getTime()) {
          data.bodies.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    });
  }
}
