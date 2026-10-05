import {
  and,
  eq,
  getTableColumns,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  isNull,
  lte,
  type SQL,
  sql,
} from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { type AppDb, internalsOf } from './app-db.ts';
import {
  decision,
  folderSync,
  label,
  labelEvent,
  mailbox,
  mailboxStatus,
  message,
  messageBody,
  messageLocation,
  ruleSet,
} from './schema/index.ts';

type Tx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

/** A registered mailbox-scoped table: it has a mailbox_id column. */
type ScopedTable = PgTable & { mailboxId: PgColumn };

/**
 * Equality filter on a scoped table. `null` means IS NULL; undefined keys are
 * ignored. An array value matches any of its elements (IN); an empty array
 * matches nothing, and the helper returns [] without running SQL. Arrays
 * cannot hold null.
 */
export type Match<T extends PgTable> = {
  [K in keyof Omit<InferSelectModel<T>, 'mailboxId'>]?:
    | InferSelectModel<T>[K]
    | readonly NonNullable<InferSelectModel<T>[K]>[];
};

/**
 * A column that can be part of a conflict target or an upsert's update list.
 * mailbox_id is always prepended by the helper; id and the timestamps are
 * never caller-chosen.
 */
export type UniqueKey<T extends PgTable> = Exclude<
  keyof InferSelectModel<T> & string,
  'mailboxId' | 'id' | 'createdAt' | 'updatedAt'
>;

/** Rows for insertOrIgnore and upsert: the scope fills mailbox_id, the database fills id. */
export type ConflictRow<T extends PgTable> = Omit<InferInsertModel<T>, 'mailboxId' | 'id'>;

/** Per-table helpers. Every statement is filtered by, or filled with, the scope's mailbox. */
export interface ScopedTableApi<T extends PgTable> {
  insert(rows: readonly Omit<InferInsertModel<T>, 'mailboxId'>[]): Promise<InferSelectModel<T>[]>;
  /**
   * INSERT ... ON CONFLICT (mailbox_id, ...target) DO NOTHING RETURNING *.
   *
   * Returns only the rows it inserted, in no promised order: callers match
   * them to their input by the target columns, never by index. Repeated keys
   * inside `rows` are fine (PostgreSQL skips the later ones). Existing rows
   * are not touched, so their updated_at stays. Empty input runs no SQL.
   */
  insertOrIgnore(
    rows: readonly ConflictRow<T>[],
    options: { target: readonly UniqueKey<T>[] },
  ): Promise<InferSelectModel<T>[]>;
  /**
   * INSERT ... ON CONFLICT (mailbox_id, ...target) DO UPDATE SET <each update
   * column> = EXCLUDED.<column> RETURNING *, (xmax = 0) AS inserted.
   *
   * Throws TypeError('upsert rows repeat a conflict key') before any SQL when
   * two rows share the target values, because PostgreSQL rejects such a
   * statement ("ON CONFLICT DO UPDATE command cannot affect row a second
   * time"). `update` must be non-empty: a no-op DO UPDATE would still touch
   * updated_at through the trigger (use insertOrIgnore for that). Results come
   * in no promised order; callers match them by the target columns.
   */
  upsert(
    rows: readonly ConflictRow<T>[],
    options: { target: readonly UniqueKey<T>[]; update: readonly UniqueKey<T>[] },
  ): Promise<(InferSelectModel<T> & { inserted: boolean })[]>;
  find(match?: Match<T>): Promise<InferSelectModel<T>[]>;
  update(
    set: Partial<Omit<InferInsertModel<T>, 'mailboxId' | 'id'>>,
    match?: Match<T>,
  ): Promise<InferSelectModel<T>[]>;
  delete(match?: Match<T>): Promise<InferSelectModel<T>[]>;
}

/** The body cache adds an expiry sweep (D-07). */
export interface MessageBodyApi extends ScopedTableApi<typeof messageBody> {
  /** Delete this mailbox's body rows with expires_at at or before `at`; returns the count. */
  deleteExpired(at: Date): Promise<number>;
}

/** Append-only tables (D-40): no update or delete, by type as well as by privilege. */
export interface AppendOnlyTableApi<T extends PgTable> {
  insert: ScopedTableApi<T>['insert'];
  find: ScopedTableApi<T>['find'];
}

export type MailboxStatusRow = InferSelectModel<typeof mailboxStatus>;

/** The scope's single mailbox_status row (D-07). */
export interface MailboxStatusApi {
  get(): Promise<MailboxStatusRow | null>;
  upsert(
    values: Partial<Omit<InferInsertModel<typeof mailboxStatus>, 'mailboxId'>>,
  ): Promise<MailboxStatusRow>;
}

/** Everything app code can do with one mailbox's data (D-43). */
export interface Scope {
  readonly mailboxId: string;
  readonly message: ScopedTableApi<typeof message>;
  /** Where each message sits on the server (D-15). */
  readonly messageLocation: ScopedTableApi<typeof messageLocation>;
  /** The short-lived body cache (D-06). */
  readonly messageBody: MessageBodyApi;
  readonly label: ScopedTableApi<typeof label>;
  readonly folderSync: ScopedTableApi<typeof folderSync>;
  readonly ruleSet: ScopedTableApi<typeof ruleSet>;
  readonly decision: AppendOnlyTableApi<typeof decision>;
  readonly labelEvent: AppendOnlyTableApi<typeof labelEvent>;
  readonly mailboxStatus: MailboxStatusApi;
}

export interface WithMailboxOptions {
  /** Run requireActive before the callback (D-45). */
  requireActive?: boolean;
}

/** The scope's mailbox has disabled_at set (D-45). */
export class MailboxDisabledError extends Error {
  constructor(slug: string) {
    super(`mailbox "${slug}" is disabled`);
    this.name = 'MailboxDisabledError';
  }
}

/** No mailbox row has the scope's id. */
export class MailboxNotFoundError extends Error {
  constructor() {
    super('Mailbox not found');
    this.name = 'MailboxNotFoundError';
  }
}

/** The mailbox id is not a UUID. Thrown before any query runs. */
export class InvalidMailboxIdError extends Error {
  constructor() {
    super('Mailbox id must be a UUID');
    this.name = 'InvalidMailboxIdError';
  }
}

/** A Scope was used after its withMailbox callback settled. */
export class ScopeClosedError extends Error {
  constructor() {
    super('Scope used after its withMailbox callback finished');
    this.name = 'ScopeClosedError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys a caller can never set or match on through a helper. */
const FORBIDDEN_SET_KEYS = new Set(['mailboxId', 'id']);

/** Keys that can never be part of a conflict target or an upsert update list. */
const CONFLICT_FORBIDDEN_KEYS = new Set(['mailboxId', 'id', 'createdAt', 'updatedAt']);

interface ScopeContext {
  tx: Tx;
  mailboxId: string;
  assertOpen(): void;
}

/** Scope -> its transaction context; never reachable from outside this module. */
const contexts = new WeakMap<Scope, ScopeContext>();

/**
 * The SQL conditions for a Match, or null when the match can select nothing
 * (an empty array value), so the helper can return without running SQL.
 */
function matchConditions(table: ScopedTable, match: object | undefined): SQL[] | null {
  if (match === undefined) return [];
  const columns: Record<string, PgColumn> = getTableColumns(table);
  const conditions: SQL[] = [];
  let empty = false;
  for (const [key, value] of Object.entries(match)) {
    if (value === undefined) continue;
    const column = columns[key];
    if (column === undefined || key === 'mailboxId') {
      throw new TypeError(`Cannot match on "${key}"`);
    }
    if (Array.isArray(value)) {
      if (value.some((v) => v === null || v === undefined)) {
        throw new TypeError(`Cannot match "${key}" on an array holding null`);
      }
      if (value.length === 0) empty = true;
      else conditions.push(inArray(column, [...value]));
    } else {
      conditions.push(value === null ? isNull(column) : eq(column, value));
    }
  }
  return empty ? null : conditions;
}

function definedEntries(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}

/** The columns named by a conflict target or update list; mailboxId, id and timestamps are refused. */
function conflictColumns(
  table: ScopedTable,
  keys: readonly string[],
  what: 'target' | 'update',
): PgColumn[] {
  const columns: Record<string, PgColumn> = getTableColumns(table);
  return keys.map((key) => {
    const column = columns[key];
    if (column === undefined || CONFLICT_FORBIDDEN_KEYS.has(key)) {
      const place = what === 'target' ? 'a conflict target' : 'an upsert update list';
      throw new TypeError(`Cannot use "${key}" in ${place}`);
    }
    return column;
  });
}

/** Rows for insertOrIgnore / upsert: undefined dropped, mailboxId/id refused, mailbox filled in. */
function conflictRows(rows: readonly object[], mailboxId: string): Record<string, unknown>[] {
  return rows.map((row) => {
    const values = definedEntries(row);
    for (const key of Object.keys(values)) {
      if (FORBIDDEN_SET_KEYS.has(key)) throw new TypeError(`Cannot insert "${key}"`);
    }
    return { ...values, mailboxId };
  });
}

/**
 * The generic helper behind every scoped table (D-43): inserts are filled
 * with the scope's mailbox, and every read or write adds
 * `mailbox_id = scope.mailboxId` itself, independently of RLS.
 */
function scopedTable<T extends ScopedTable>(ctx: ScopeContext, table: T): ScopedTableApi<T> {
  const { tx, mailboxId } = ctx;
  /** The WHERE for a match, or null when it can select nothing (no SQL runs). */
  const where = (match: object | undefined): SQL | undefined | null => {
    const conditions = matchConditions(table, match);
    return conditions === null ? null : and(eq(table.mailboxId, mailboxId), ...conditions);
  };
  // Drizzle's builders do not narrow over a generic table; the public
  // ScopedTableApi<T> signature is what callers are held to.
  const anyTable = table as unknown as PgTable;

  return Object.freeze({
    async insert(rows: readonly object[]) {
      ctx.assertOpen();
      if (rows.length === 0) return [];
      const values = rows.map((row) => ({ ...definedEntries(row), mailboxId }));
      return (await tx
        .insert(anyTable)
        .values(values as never)
        .returning()) as InferSelectModel<T>[];
    },
    async insertOrIgnore(rows: readonly object[], options: { target: readonly string[] }) {
      ctx.assertOpen();
      const target = conflictColumns(table, options.target, 'target');
      const values = conflictRows(rows, mailboxId);
      if (values.length === 0) return [];
      return (await tx
        .insert(anyTable)
        .values(values as never)
        .onConflictDoNothing({ target: [table.mailboxId, ...target] })
        .returning()) as InferSelectModel<T>[];
    },
    async upsert(
      rows: readonly object[],
      options: { target: readonly string[]; update: readonly string[] },
    ) {
      ctx.assertOpen();
      const target = conflictColumns(table, options.target, 'target');
      const update = conflictColumns(table, options.update, 'update');
      if (update.length === 0) {
        throw new TypeError('upsert needs at least one update column (use insertOrIgnore)');
      }
      const values = conflictRows(rows, mailboxId);
      if (values.length === 0) return [];
      // One statement cannot touch the same row twice: refuse before any SQL.
      const seen = new Set<string>();
      for (const row of values) {
        const key = JSON.stringify(options.target.map((k) => row[k] ?? null));
        if (seen.has(key)) throw new TypeError('upsert rows repeat a conflict key');
        seen.add(key);
      }
      const set = Object.fromEntries(
        options.update.map((key, i) => [
          key,
          sql.raw(`excluded.${JSON.stringify((update[i] as PgColumn).name)}`),
        ]),
      );
      return (await tx
        .insert(anyTable)
        .values(values as never)
        .onConflictDoUpdate({ target: [table.mailboxId, ...target], set: set as never })
        .returning({
          ...getTableColumns(anyTable),
          // A row this statement inserted has no deleting/locking xid yet.
          inserted: sql<boolean>`(xmax = 0)`,
        })) as (InferSelectModel<T> & { inserted: boolean })[];
    },
    async find(match?: object) {
      ctx.assertOpen();
      const condition = where(match);
      if (condition === null) return [];
      return (await tx.select().from(anyTable).where(condition)) as InferSelectModel<T>[];
    },
    async update(set: object, match?: object) {
      ctx.assertOpen();
      const values = definedEntries(set);
      for (const key of Object.keys(values)) {
        if (FORBIDDEN_SET_KEYS.has(key)) throw new TypeError(`Cannot update "${key}"`);
      }
      const condition = where(match);
      if (condition === null) return [];
      // An empty set still runs (touching updated_at through the trigger).
      const assignments =
        Object.keys(values).length > 0 ? values : { mailboxId: sql`${table.mailboxId}` };
      return (await tx
        .update(anyTable)
        .set(assignments as never)
        .where(condition)
        .returning()) as InferSelectModel<T>[];
    },
    async delete(match?: object) {
      ctx.assertOpen();
      const condition = where(match);
      if (condition === null) return [];
      return (await tx.delete(anyTable).where(condition).returning()) as InferSelectModel<T>[];
    },
  }) as ScopedTableApi<T>;
}

/** The body cache: the scoped helpers plus the expiry sweep (D-07). */
function messageBodyApi(ctx: ScopeContext): MessageBodyApi {
  const { tx, mailboxId } = ctx;
  return Object.freeze({
    ...scopedTable(ctx, messageBody),
    async deleteExpired(at: Date) {
      ctx.assertOpen();
      const rows = await tx
        .delete(messageBody)
        .where(and(eq(messageBody.mailboxId, mailboxId), lte(messageBody.expiresAt, at)))
        .returning({ id: messageBody.id });
      return rows.length;
    },
  });
}

/** insert and find only (D-40). */
function appendOnlyTable<T extends ScopedTable>(
  ctx: ScopeContext,
  table: T,
): AppendOnlyTableApi<T> {
  const { insert, find } = scopedTable(ctx, table);
  return Object.freeze({ insert, find });
}

function mailboxStatusApi(ctx: ScopeContext): MailboxStatusApi {
  const { tx, mailboxId } = ctx;
  return Object.freeze({
    async get() {
      ctx.assertOpen();
      const rows = await tx
        .select()
        .from(mailboxStatus)
        .where(eq(mailboxStatus.mailboxId, mailboxId));
      return rows[0] ?? null;
    },
    async upsert(values: Partial<Omit<InferInsertModel<typeof mailboxStatus>, 'mailboxId'>>) {
      ctx.assertOpen();
      const set = definedEntries(values);
      if ('mailboxId' in set) throw new TypeError('Cannot set "mailboxId"');
      // updated_at is maintained by the set_updated_at trigger.
      const onConflictSet = Object.keys(set).length > 0 ? set : { updatedAt: sql`now()` };
      const rows = await tx
        .insert(mailboxStatus)
        .values({ ...set, mailboxId })
        .onConflictDoUpdate({ target: mailboxStatus.mailboxId, set: onConflictSet })
        .returning();
      const row = rows[0];
      if (row === undefined) throw new Error('mailbox_status upsert returned no row');
      return row;
    },
  });
}

/**
 * Throw unless the scope's mailbox exists and is enabled (D-45). Processing
 * entry points (ingest, classify, apply labels) call this; reading status
 * and history does not.
 */
export async function requireActive(scope: Scope): Promise<void> {
  const ctx = contexts.get(scope);
  if (ctx === undefined) throw new TypeError('Not a Scope created by withMailbox');
  ctx.assertOpen();
  const rows = await ctx.tx
    .select({ slug: mailbox.slug, disabledAt: mailbox.disabledAt })
    .from(mailbox)
    .where(eq(mailbox.id, ctx.mailboxId));
  const row = rows[0];
  if (row === undefined) throw new MailboxNotFoundError();
  if (row.disabledAt !== null) throw new MailboxDisabledError(row.slug);
}

/** True when `mailboxId` is a UUID string; callers check before any query runs. */
export function isMailboxId(mailboxId: unknown): mailboxId is string {
  return typeof mailboxId === 'string' && UUID.test(mailboxId);
}

/**
 * @internal The transaction body behind withMailbox and IngestSession.run:
 * one transaction on `orm` with `app.mailbox_id` set transaction-locally and a
 * frozen Scope that stops working once `fn` settles. The caller has already
 * validated `mailboxId`.
 */
export async function runScoped<T>(
  orm: NodePgDatabase,
  mailboxId: string,
  fn: (scope: Scope) => Promise<T>,
  options: WithMailboxOptions,
): Promise<T> {
  return orm.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.mailbox_id', ${mailboxId}, true)`);
    let open = true;
    const ctx: ScopeContext = {
      tx,
      mailboxId,
      assertOpen() {
        if (!open) throw new ScopeClosedError();
      },
    };
    const scope: Scope = Object.freeze({
      mailboxId,
      message: scopedTable(ctx, message),
      messageLocation: scopedTable(ctx, messageLocation),
      messageBody: messageBodyApi(ctx),
      label: scopedTable(ctx, label),
      folderSync: scopedTable(ctx, folderSync),
      ruleSet: scopedTable(ctx, ruleSet),
      decision: appendOnlyTable(ctx, decision),
      labelEvent: appendOnlyTable(ctx, labelEvent),
      mailboxStatus: mailboxStatusApi(ctx),
    });
    contexts.set(scope, ctx);
    try {
      if (options.requireActive === true) await requireActive(scope);
      return await fn(scope);
    } finally {
      open = false;
    }
  });
}

/**
 * Run `fn` inside one transaction scoped to `mailboxId` (D-42).
 *
 * `app.mailbox_id` is set transaction-locally, so a pooled connection never
 * carries a mailbox to its next user. `fn` receives only per-table helpers,
 * never the transaction, pool or Drizzle instance; the Scope stops working
 * once `fn` settles.
 */
export async function withMailbox<T>(
  db: AppDb,
  mailboxId: string,
  fn: (scope: Scope) => Promise<T>,
  options: WithMailboxOptions = {},
): Promise<T> {
  if (!isMailboxId(mailboxId)) throw new InvalidMailboxIdError();
  return runScoped(internalsOf(db).orm, mailboxId, fn, options);
}
