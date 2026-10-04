import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export interface AppDbOptions {
  /** Pool size. Defaults to 4. */
  maxConnections?: number;
  /**
   * Called when an idle pooled client errors (e.g. the server restarted).
   * Without a handler such an error would crash the process. The default
   * emits a process warning carrying only the error code.
   */
  onPoolError?: (error: Error) => void;
}

export interface CloseOptions {
  /**
   * How long to wait for checked-out clients to be released. After that,
   * every remaining client is ended (its in-flight query fails with
   * "Connection terminated") and close() waits at most FORCED_CLOSE_WAIT_MS
   * more. Without it, close() waits for every client, however long that takes.
   */
  timeoutMs?: number;
}

export interface CloseResult {
  /** True when clients were still checked out at the timeout and were ended. */
  forced: boolean;
}

/**
 * Opaque handle to the application database. It exposes only `close()`;
 * the pool and the Drizzle instance stay inside packages/db (D-42).
 */
export interface AppDb {
  close(options?: CloseOptions): Promise<CloseResult>;
}

/** @internal Sibling modules only. Not re-exported from index.ts. */
export interface AppDbInternals {
  pool: pg.Pool;
  orm: NodePgDatabase;
}

const internals = new WeakMap<AppDb, AppDbInternals>();

const DEFAULT_MAX_CONNECTIONS = 4;

/** After forcing clients closed, how long close() still waits for the pool. */
export const FORCED_CLOSE_WAIT_MS = 1_000;

/** Resolve true when `promise` settles within `ms`, false otherwise. Never rejects. */
function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(ms, 0));
  });
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

function defaultPoolErrorHandler(error: Error): void {
  const code = (error as { code?: unknown }).code;
  // Only the code: messages can quote connection details.
  process.emitWarning(`Postgres pool client error${typeof code === 'string' ? ` (${code})` : ''}`, {
    code: 'SIFT_DB_POOL_ERROR',
  });
}

/**
 * Create the app's database handle over a pg pool. The connection string is
 * a secret and is never logged.
 */
export function createAppDb(connectionString: string, options: AppDbOptions = {}): AppDb {
  // Every client the pool creates, idle, checked out or still connecting, so
  // close() can end the ones a stuck batch never releases (pool.end() alone
  // waits forever). Tracked from construction: pg-pool emits 'connect' only
  // after the handshake, which would miss a client stuck in TCP connect or
  // authentication and leave its socket keeping the process alive (IN-12).
  const clients = new Set<pg.Client>();
  class TrackedClient extends pg.Client {
    constructor(config?: string | pg.ClientConfig) {
      super(config);
      clients.add(this);
      this.once('end', () => clients.delete(this));
    }
  }
  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    Client: TrackedClient,
  });
  pool.on('error', options.onPoolError ?? defaultPoolErrorHandler);
  pool.on('remove', (client) => clients.delete(client as pg.Client));
  const orm = drizzle({ client: pool });

  let closing: Promise<void> | undefined;
  const db: AppDb = Object.freeze({
    async close(closeOptions: CloseOptions = {}): Promise<CloseResult> {
      closing ??= pool.end();
      const { timeoutMs } = closeOptions;
      if (timeoutMs === undefined) {
        await closing;
        return { forced: false };
      }
      if (await settlesWithin(closing, timeoutMs)) {
        await closing;
        return { forced: false };
      }
      // pg's Client.end() destroys the socket when a query is in flight or the
      // client is still connecting, so the query or connect rejects and its
      // holder releases the client.
      for (const client of clients) {
        client.end().catch(() => {});
        // end() only half-closes a client that has not finished its handshake
        // (it sends Terminate and waits for the server); destroy its socket so
        // it cannot keep the process alive (IN-12). end() ran first, so the
        // client treats the close as requested and emits no 'error'.
        client.connection.stream.destroy();
      }
      await settlesWithin(closing, FORCED_CLOSE_WAIT_MS);
      return { forced: true };
    },
  });
  internals.set(db, { pool, orm });
  return db;
}

/** @internal Resolve the pool and Drizzle instance behind an AppDb. */
export function internalsOf(db: AppDb): AppDbInternals {
  const found = internals.get(db);
  if (found === undefined) {
    throw new TypeError('Not an AppDb created by createAppDb');
  }
  return found;
}
