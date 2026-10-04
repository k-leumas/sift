import { type AppDb, internalsOf } from './app-db.ts';

/**
 * Worker startup against the database (D-55, Pitfall 11). Docker can restart
 * the worker before Postgres accepts connections, so self-resolving errors are
 * retried for a while; configuration errors fail at once with a message that
 * tells the owner what to fix. No message ever contains the connection string
 * or a password: errors are mapped from their code, never passed through.
 */

export type ConnectErrorClass = 'retry' | 'fatal';

/** Errors that go away on their own while the database or network comes up. */
const RETRY_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  // cannot_connect_now: the database system is starting up.
  '57P03',
]);

const FATAL_MESSAGES: Readonly<Record<string, string>> = {
  '28P01':
    'database login failed for the worker role; check SIFT_DATABASE_URL / SIFT_DB_APP_PASSWORD',
  '3D000':
    'database does not exist; check the database name in SIFT_DATABASE_URL (the sift database is created when the db volume is first initialised)',
  '42501': 'the worker role is not allowed to connect',
  '28000': 'the worker role is not allowed to connect',
};

const DEFAULT_DEADLINE_MS = 30_000;
const INITIAL_DELAY_MS = 250;
const MAX_DELAY_MS = 5_000;
const JITTER = 0.2;

/** A startup failure whose message is safe to log. */
export class DatabaseStartupError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = 'DatabaseStartupError';
    this.code = code;
  }
}

function ownCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : undefined;
}

/** The error's own code, then the codes of an AggregateError's inner errors. */
function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  const own = ownCode(error);
  if (own !== undefined) codes.push(own);
  if (error instanceof AggregateError) {
    for (const inner of error.errors) {
      const code = ownCode(inner);
      if (code !== undefined) codes.push(code);
    }
  }
  return codes;
}

/** The first code that marks the error as retryable, if any. */
function retryCode(error: unknown): string | undefined {
  return errorCodes(error).find((code) => RETRY_CODES.has(code));
}

/** 'retry' for self-resolving connection errors (D-55); everything else is 'fatal'. */
export function classifyConnectError(error: unknown): ConnectErrorClass {
  return retryCode(error) !== undefined ? 'retry' : 'fatal';
}

function fatalError(error: unknown): DatabaseStartupError {
  const code = errorCodes(error)[0];
  const known = code === undefined ? undefined : FATAL_MESSAGES[code];
  return new DatabaseStartupError(
    known ?? `database connection failed (${code ?? 'no error code'})`,
    code,
  );
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reject with ETIMEDOUT when `promise` outlives `ms`, so one hung attempt cannot pass the deadline. */
function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  // A late rejection of the abandoned attempt must not become unhandled.
  promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(Object.assign(new Error('connection attempt timed out'), { code: 'ETIMEDOUT' })),
      Math.max(ms, 1),
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface ConnectWithRetryOptions {
  /** Give up after this long. Defaults to 30000 ms. */
  deadlineMs?: number;
  log?: { warn(obj: object, msg?: string): void };
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Wait until the database answers `select 1`. Retryable errors back off from
 * 250 ms, doubling up to 5000 ms with +/-20 % jitter, until the deadline;
 * then a DatabaseStartupError "database not reachable after <s> s (<code>)".
 * Any other error is thrown at once as a DatabaseStartupError.
 */
export async function connectWithRetry(
  db: AppDb,
  options: ConnectWithRetryOptions = {},
): Promise<void> {
  const { pool } = internalsOf(db);
  const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = Date.now();
  let delay = INITIAL_DELAY_MS;

  for (let attempt = 1; ; attempt += 1) {
    try {
      await bounded(pool.query('select 1'), deadlineMs - (Date.now() - startedAt));
      return;
    } catch (error) {
      const code = retryCode(error);
      if (code === undefined) throw fatalError(error);

      const remaining = deadlineMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        throw new DatabaseStartupError(
          `database not reachable after ${deadlineMs / 1000} s (${code})`,
          code,
        );
      }
      options.log?.warn({ code, attempt }, 'database not ready; retrying');
      const jittered = Math.round(delay * (1 - JITTER + Math.random() * 2 * JITTER));
      await sleep(Math.min(jittered, remaining));
      delay = Math.min(delay * 2, MAX_DELAY_MS);
    }
  }
}

interface RoleAttributes {
  name: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
  rolreplication: boolean;
  owns_objects: boolean;
  member_of: string[];
}

/** Why `role` is not a DML-only, owns-nothing role; empty when it is. */
function privilegeReasons(role: RoleAttributes): string[] {
  // A superuser is a member of every role; listing them adds nothing.
  if (role.rolsuper) return ['superuser'];
  const reasons: string[] = [];
  if (role.rolbypassrls) reasons.push('BYPASSRLS');
  if (role.rolcreaterole) reasons.push('CREATEROLE');
  if (role.rolcreatedb) reasons.push('CREATEDB');
  if (role.rolreplication) reasons.push('REPLICATION');
  if (role.owns_objects) reasons.push('owns database objects');
  if (role.member_of.length > 0) reasons.push(`member of ${role.member_of.join(', ')}`);
  return reasons;
}

/**
 * Refuse to run as anything but a DML-only role that owns nothing (T-01-43,
 * D-36). A superuser or BYPASSRLS role would silently turn off mailbox
 * isolation; an owner (sift_owner) could drop the policies or turn FORCE RLS
 * off; CREATEROLE or CREATEDB could mint such a role; REPLICATION can read
 * every row change through logical decoding, past RLS; and membership in another
 * role (sift_backup, pg_read_all_data, pg_write_all_data, ...) is one SET ROLE
 * away from its powers. The worker must connect as sift_app, which is a member
 * of nothing.
 */
export async function assertUnprivilegedRole(db: AppDb): Promise<void> {
  const { pool } = internalsOf(db);
  const { rows } = await pool.query<RoleAttributes>(
    `select r.rolname::text as name, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
            r.rolreplication,
            exists (select 1 from pg_class c where c.relowner = r.oid)
              or exists (select 1 from pg_namespace n where n.nspowner = r.oid)
              or exists (select 1 from pg_proc p where p.proowner = r.oid)
              or exists (select 1 from pg_database d where d.datdba = r.oid) as owns_objects,
            array(select b.rolname::text from pg_roles b
                   where b.oid <> r.oid and pg_has_role(r.oid, b.oid, 'MEMBER')
                   order by 1) as member_of
       from pg_roles r
      where r.rolname = current_user`,
  );
  const role = rows[0];
  if (role === undefined) {
    throw new DatabaseStartupError('could not read the attributes of the worker role', undefined);
  }
  const reasons = privilegeReasons(role);
  if (reasons.length > 0) {
    throw new DatabaseStartupError(
      `the worker must connect as sift_app (DML only, owns nothing); refusing to run as role "${role.name}": ${reasons.join(', ')}`,
      undefined,
    );
  }
}
