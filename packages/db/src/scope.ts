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
import { message } from './schema/index.ts';

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

/** Everything app code can do with one mailbox's data (D-43). */
export interface Scope {
  readonly mailboxId: string;
  readonly message: ScopedTableApi<typeof message>;
}

export interface WithMailboxOptions {
  /** Reserved for requireActive (D-45). */
  requireActive?: boolean;
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
  _options: WithMailboxOptions = {},
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
    });
    try {
      return await fn(scope);
    } finally {
      open = false;
    }
  });
}
