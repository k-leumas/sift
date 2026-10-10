import type { PromptMaterial } from '@sift/core/classify';
import { eq, sql } from 'drizzle-orm';
import { type AppDb, internalsOf } from './app-db.ts';
import { promptVersion } from './schema/index.ts';

/**
 * Transaction-level advisory lock serialising prompt_version inserts (D-29).
 * Next to CONFIG_APPLY_LOCK_KEY (815309002) in the 8153090xx range.
 */
export const PROMPT_VERSION_LOCK_KEY = 815309003;

/**
 * The prompt_version row for a prompt's material (D-29, TRC-04): the
 * existing row when its hash is known, otherwise a new row with the next
 * global version (1 when there is none). Versions never skip.
 *
 * prompt_version is unscoped (code-derived, no mail content) and shared by
 * every mailbox, so concurrent batches can meet on a new prompt's first use.
 * One transaction takes pg_advisory_xact_lock(PROMPT_VERSION_LOCK_KEY) before
 * the select-then-insert, so they queue instead of hitting the unique hash
 * or version constraint (RESEARCH Pitfall 8). sift_app may select and insert
 * (0010).
 *
 * Runs in its own transaction, outside any mailbox scope.
 */
export async function ensurePromptVersion(
  db: AppDb,
  material: PromptMaterial,
): Promise<{ id: string; version: number; created: boolean }> {
  const { orm } = internalsOf(db);
  return orm.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${PROMPT_VERSION_LOCK_KEY})`);
    const [known] = await tx
      .select({ id: promptVersion.id, version: promptVersion.version })
      .from(promptVersion)
      .where(eq(promptVersion.hash, material.hash));
    if (known !== undefined) return { ...known, created: false };

    const [top] = await tx
      .select({ max: sql<number>`coalesce(max(${promptVersion.version}), 0)`.mapWith(Number) })
      .from(promptVersion);
    const [row] = await tx
      .insert(promptVersion)
      .values({
        version: (top?.max ?? 0) + 1,
        hash: material.hash,
        template: material.template,
        schemaShape: material.schemaShape,
      })
      .returning({ id: promptVersion.id, version: promptVersion.version });
    if (row === undefined) throw new Error('ensurePromptVersion: the insert returned no row');
    return { ...row, created: true };
  });
}
