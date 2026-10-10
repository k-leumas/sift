import type { MailboxConfig } from '@sift/core/config';
import { type ClassifyCandidate, type IngestSession, restoreBody } from '@sift/db';
import { closeImap, type ImapFlow, openImap } from '../imap/connect.ts';
import { createFolderSource } from '../imap/folder-source.ts';
import { BODY_DOWNLOAD_MAX_BYTES, parseMessage, toBodyText } from '../ingest/message.ts';
import type { FolderSource } from '../ingest/types.ts';
import {
  ingestKind,
  MailboxSyncError,
  type OwnerMessageContext,
  ownerMessageFor,
  trackedSource,
  trustsPmHeader,
} from '../runtime/mailbox-batch.ts';

/**
 * The refetch half of D-32 (P2 D-08): before an owner re-run classifies a
 * message whose cached body has expired, read the body back from IMAP, and
 * only from the server copy that is provably the same message.
 *
 * - The connection is the worker's pinned one, and the folder is opened with
 *   EXAMINE and read with BODY.PEEK only, so nothing on the server changes.
 * - The stored location must belong to the folder's current UIDVALIDITY; a
 *   UID from an older generation may now name another message (T-03-44).
 * - The identity key is re-derived from the server's headers with the ingest
 *   parser and must equal the stored one; a UID alone never attaches a body.
 */

/** What happened to one expired body: put back, not on the server, or a different message there. */
export type RefetchResult = 'restored' | 'gone' | 'mismatch';

/** The refetch could not reach or read the server; `message` is one fixed owner line. */
export class RefetchFailedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RefetchFailedError';
  }
}

export interface RefetchDeps {
  entry: MailboxConfig;
  /** The mailbox's IMAP password (from its password_env). Never printed. */
  password: string;
  /** Tests only. */
  openImap?: typeof openImap;
}

async function refetchOne(
  session: IngestSession,
  source: FolderSource,
  candidate: ClassifyCandidate,
  entry: MailboxConfig,
  uidValidity: number,
): Promise<RefetchResult> {
  const locations = await session.run((s) =>
    s.messageLocation.find({ messageId: candidate.id, folder: entry.imap.folder, removedAt: null }),
  );
  const location = locations.find((l) => l.uidvalidity === uidValidity);
  if (location === undefined) return 'gone';

  const [record] = await source.fetchHeaders([location.uid]);
  if (record === undefined || record.uid !== location.uid) return 'gone';
  const parsed = parseMessage(record, { trustPmHeader: trustsPmHeader(entry) });
  if (parsed.identityKey !== candidate.identityKey) return 'mismatch';

  const part = parsed.textPart;
  const body =
    part === null
      ? toBodyText(null, null)
      : toBodyText(
          await source.downloadText(location.uid, part.part, BODY_DOWNLOAD_MAX_BYTES),
          part.kind,
        );
  // expires_at stays null; the re-run's decision starts the 7-day expiry (D-32).
  await session.run((s) =>
    restoreBody(s, candidate.id, {
      bodyText: body.text,
      source: body.source,
      truncated: body.truncated,
    }),
  );
  return 'restored';
}

/**
 * Refetch the expired bodies among `candidates` (body null), under the
 * caller's ingest lock. Returns a result per expired candidate; candidates
 * that still have a body are not in the map. No connection is opened when
 * none has expired.
 *
 * Throws RefetchFailedError with a fixed owner line when the server cannot be
 * reached or read (never the server's reply); database errors pass through.
 */
export async function refetchBodies(
  session: IngestSession,
  candidates: readonly ClassifyCandidate[],
  deps: RefetchDeps,
): Promise<Map<string, RefetchResult>> {
  const results = new Map<string, RefetchResult>();
  const expired = candidates.filter((c) => c.body === null);
  if (expired.length === 0) return results;

  const { entry } = deps;
  const owner: OwnerMessageContext = {
    slug: entry.slug,
    host: entry.imap.host,
    port: entry.imap.port,
    pinned: entry.imap.tls.pin_sha256 !== undefined,
    passwordEnv: entry.imap.password_env,
  };
  const open = deps.openImap ?? openImap;
  let client: ImapFlow;
  try {
    client = await open({
      host: entry.imap.host,
      port: entry.imap.port,
      user: entry.imap.username,
      pass: deps.password,
      tls: { mode: entry.imap.tls.mode, pinSha256: entry.imap.tls.pin_sha256 },
    });
  } catch (error) {
    throw new RefetchFailedError(ownerMessageFor(error, owner).message, { cause: error });
  }

  const imapErrors = new WeakSet<object>();
  try {
    const source = trackedSource(createFolderSource(client), imapErrors);
    const { uidValidity } = await source.examine(entry.imap.folder);
    for (const candidate of expired) {
      results.set(candidate.id, await refetchOne(session, source, candidate, entry, uidValidity));
    }
    return results;
  } catch (error) {
    if (typeof error === 'object' && error !== null && imapErrors.has(error)) {
      const kind = ingestKind(error, client);
      throw new RefetchFailedError(ownerMessageFor(new MailboxSyncError(kind, ''), owner).message, {
        cause: error,
      });
    }
    throw error;
  } finally {
    // Bounded and never throws (02-18), so the lock is always released.
    await closeImap(client);
  }
}
