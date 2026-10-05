import {
  and,
  eq,
  getTableColumns,
  type InferInsertModel,
  type InferSelectModel,
  isNull,
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

/** Equality filter on a scoped table. `null` means IS NULL; undefined keys are ignored. */
export type Match<T extends PgTable> = Partial<Omit<InferSelectModel<T>, 'mailboxId'>>;

/** Per-table helpers. Every statement is filtered by, or filled with, the scope's mailbox. */
export interface ScopedTableApi<T extends PgTable> {
  insert(rows: readonly Omit<InferInsertModel<T>, 'mailboxId'>[]): Promise<InferSelectModel<T>[]>;
  find(match?: Match<T>): Promise<InferSelectModel<T>[]>;
  update(
    set: Partial<Omit<InferInsertModel<T>, 'mailboxId' | 'id'>>,
    match?: Match<T>,
  ): Promise<InferSelectModel<T>[]>;
  delete(match?: Match<T>): Promise<InferSelectModel<T>[]>;
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
  readonly messageBody: ScopedTableApi<typeof messageBody>;
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

interface ScopeContext {
  tx: Tx;
  mailboxId: string;
  assertOpen(): void;
}

/** Scope -> its transaction context; never reachable from outside this module. */
const contexts = new WeakMap<Scope, ScopeContext>();

function matchConditions(table: ScopedTable, match: object | undefined): SQL[] {
  if (match === undefined) return [];
  const columns: Record<string, PgColumn> = getTableColumns(table);
  const conditions: SQL[] = [];
  for (const [key, value] of Object.entries(match)) {
    if (value === undefined) continue;
    const column = columns[key];
    if (column === undefined || key === 'mailboxId') {
      throw new TypeError(`Cannot match on "${key}"`);
    }
    conditions.push(value === null ? isNull(column) : eq(column, value));
  }
  return conditions;
}

function definedEntries(values: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
}

/**
 * The generic helper behind every scoped table (D-43): inserts are filled
 * with the scope's mailbox, and every read or write adds
 * `mailbox_id = scope.mailboxId` itself, independently of RLS.
 */
function scopedTable<T extends ScopedTable>(ctx: ScopeContext, table: T): ScopedTableApi<T> {
  const { tx, mailboxId } = ctx;
  const where = (match: object | undefined): SQL | undefined =>
    and(eq(table.mailboxId, mailboxId), ...matchConditions(table, match));
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
    async find(match?: object) {
      ctx.assertOpen();
      return (await tx.select().from(anyTable).where(where(match))) as InferSelectModel<T>[];
    },
    async update(set: object, match?: object) {
      ctx.assertOpen();
      const values = definedEntries(set);
      for (const key of Object.keys(values)) {
        if (FORBIDDEN_SET_KEYS.has(key)) throw new TypeError(`Cannot update "${key}"`);
      }
      // An empty set still runs (touching updated_at through the trigger).
      const assignments =
        Object.keys(values).length > 0 ? values : { mailboxId: sql`${table.mailboxId}` };
      return (await tx
        .update(anyTable)
        .set(assignments as never)
        .where(where(match))
        .returning()) as InferSelectModel<T>[];
    },
    async delete(match?: object) {
      ctx.assertOpen();
      return (await tx.delete(anyTable).where(where(match)).returning()) as InferSelectModel<T>[];
    },
  }) as ScopedTableApi<T>;
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
  if (typeof mailboxId !== 'string' || !UUID.test(mailboxId)) {
    throw new InvalidMailboxIdError();
  }
  const { orm } = internalsOf(db);
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
      messageBody: scopedTable(ctx, messageBody),
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
