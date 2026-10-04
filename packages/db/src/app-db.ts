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

/**
 * Opaque handle to the application database. It exposes only `close()`;
 * the pool and the Drizzle instance stay inside packages/db (D-42).
 */
export interface AppDb {
  close(): Promise<void>;
}

/** @internal Sibling modules only. Not re-exported from index.ts. */
export interface AppDbInternals {
  pool: pg.Pool;
  orm: NodePgDatabase;
}

const internals = new WeakMap<AppDb, AppDbInternals>();

const DEFAULT_MAX_CONNECTIONS = 4;

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
  const pool = new pg.Pool({
    connectionString,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
  });
  pool.on('error', options.onPoolError ?? defaultPoolErrorHandler);
  const orm = drizzle({ client: pool });

  let closing: Promise<void> | undefined;
  const db: AppDb = Object.freeze({
    close(): Promise<void> {
      closing ??= pool.end();
      return closing;
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
