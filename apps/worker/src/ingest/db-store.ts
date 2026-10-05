import {
  advanceFolderSync,
  type BackfillCursor,
  beginResync,
  createFolderSync,
  deleteExpiredBodies,
  deleteOrphanBodies,
  type FolderSyncRow,
  finishResync,
  getFolderSync,
  type IngestSession,
  knownIdentityKeys,
  liveLocations,
  markLocationsRemoved,
  type StoreItem,
  setFolderBackfill,
  storeMessages,
} from '@sift/db';
import type {
  BackfillState,
  ChunkAdvance,
  FolderState,
  IngestStore,
  LiveLocationRef,
  MessageRecord,
  ResyncCounts,
} from './types.ts';

/**
 * The sync engine's store over the database (02-13): every IngestStore method
 * is exactly one `session.run`, i.e. one scoped transaction on the mailbox's
 * ingest-lock connection (D-03, ISO-04), over the @sift/db ingest use-cases.
 *
 * No method calls another store method or a second `session.run`: the session
 * is not re-entrant (IngestSessionBusyError), and one transaction per method is
 * what makes a chunk, its watermark move and a resync's generation switch
 * atomic (D-04, D-23).
 */

function folderState(row: FolderSyncRow): FolderState {
  const backfill: BackfillState | null =
    row.backfillCursorUid === null ||
    row.backfillSince === null ||
    row.backfillUntilUid === null ||
    row.backfillTotal === null
      ? null
      : {
          since: row.backfillSince,
          cursorUid: row.backfillCursorUid,
          untilUid: row.backfillUntilUid,
          total: row.backfillTotal,
        };
  return {
    folder: row.folder,
    uidValidity: row.uidvalidity,
    lastUid: row.lastUid,
    watermark: row.internalDateWatermark,
    generation: row.generation,
    state: row.state === 'resyncing' ? 'resyncing' : 'ok',
    pendingUidValidity: row.pendingUidvalidity,
    pendingGeneration: row.pendingGeneration,
    backfill,
  };
}

function backfillCursor(backfill: BackfillState | null): BackfillCursor | null {
  return backfill === null
    ? null
    : {
        since: backfill.since,
        cursorUid: backfill.cursorUid,
        untilUid: backfill.untilUid,
        total: backfill.total,
      };
}

function storeItem(
  folder: string,
  uidValidity: number,
  generation: number,
  record: MessageRecord,
): StoreItem {
  const { parsed } = record;
  return {
    message: {
      identityKey: parsed.identityKey,
      messageIdHeader: parsed.messageIdHeader,
      internalDate: parsed.internalDate,
      sentAt: parsed.sentAt,
      fromAddress: parsed.fromAddress,
      fromDomain: parsed.fromDomain,
      subject: parsed.subject,
      headers: parsed.headers,
      attachments: parsed.attachments,
      sizeBytes: parsed.sizeBytes,
      eligibleForClassification: record.eligible,
    },
    location: { folder, uidvalidity: uidValidity, uid: record.uid, generation },
    body:
      record.body === null
        ? null
        : {
            bodyText: record.body.text,
            source: record.body.source,
            truncated: record.body.truncated,
          },
  };
}

/** An IngestStore whose every method is one transaction of `session`. */
export function createDbStore(session: IngestSession): IngestStore {
  return {
    getFolder(folder: string): Promise<FolderState | null> {
      return session.run(async (scope) => {
        const row = await getFolderSync(scope, folder);
        return row === null ? null : folderState(row);
      });
    },

    createFolder(init): Promise<FolderState> {
      return session.run(async (scope) =>
        folderState(
          await createFolderSync(scope, {
            folder: init.folder,
            uidvalidity: init.uidValidity,
            lastUid: init.lastUid,
            internalDateWatermark: init.watermark,
            backfill: backfillCursor(init.backfill),
          }),
        ),
      );
    },

    commitChunk(
      folder: string,
      uidValidity: number,
      generation: number,
      records: readonly MessageRecord[],
      advance: ChunkAdvance | null,
      options: { promoteEligible?: boolean } = {},
    ): Promise<{ inserted: number; existing: number }> {
      const items = records.map((record) => storeItem(folder, uidValidity, generation, record));
      return session.run(async (scope) => {
        const result = await storeMessages(scope, items, {
          promoteEligible: options.promoteEligible === true,
        });
        if (advance !== null) {
          await advanceFolderSync(scope, folder, {
            lastUid: advance.lastUid,
            internalDateWatermark: advance.watermark,
            backfillCursorUid: advance.backfillCursorUid,
          });
        }
        return { inserted: result.insertedMessages, existing: result.existingMessages };
      });
    },

    setBackfill(folder: string, backfill: BackfillState | null): Promise<void> {
      return session.run((scope) => setFolderBackfill(scope, folder, backfillCursor(backfill)));
    },

    knownIdentities(keys: readonly string[]): Promise<Set<string>> {
      return session.run(async (scope) => new Set((await knownIdentityKeys(scope, keys)).keys()));
    },

    liveLocations(folder: string): Promise<LiveLocationRef[]> {
      return session.run(async (scope) =>
        (await liveLocations(scope, folder)).map((l) => ({
          id: l.id,
          uid: l.uid,
          uidValidity: l.uidvalidity,
          generation: l.generation,
          messageId: l.messageId,
        })),
      );
    },

    markVanished(locationIds: readonly string[]): Promise<number> {
      return session.run(async (scope) => {
        if (locationIds.length === 0) return 0;
        const ids = [...locationIds];
        const messageIds = (await scope.messageLocation.find({ id: ids })).map(
          (row) => row.messageId,
        );
        const marked = await markLocationsRemoved(scope, ids, 'vanished');
        // D-07: mail that left before it was ever classified keeps no body.
        await deleteOrphanBodies(scope, messageIds);
        return marked;
      });
    },

    beginResync(folder: string, pendingUidValidity: number, pendingGeneration: number) {
      return session.run((scope) =>
        beginResync(scope, folder, {
          pendingUidvalidity: pendingUidValidity,
          pendingGeneration,
        }),
      );
    },

    finishResync(folder, done): Promise<ResyncCounts> {
      // One run: the generation switch and the recomputed backfill cursor
      // commit together, so a crash never leaves an old-UIDVALIDITY cursor.
      return session.run(async (scope) => {
        const { summary } = await finishResync(scope, folder, {
          uidvalidity: done.uidValidity,
          generation: done.generation,
          lastUid: done.lastUid,
          internalDateWatermark: done.watermark,
          summary: done.counts,
          ...(done.backfill === undefined ? {} : { backfill: backfillCursor(done.backfill) }),
        });
        return {
          matched: summary.matched,
          new: summary.new,
          gone: summary.gone,
          older: summary.older,
        };
      });
    },

    deleteExpiredBodies(at: Date): Promise<number> {
      return session.run((scope) => deleteExpiredBodies(scope, at));
    },
  };
}
