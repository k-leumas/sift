import type { PromptMaterial } from '@sift/core/classify';
import type { AppDb } from './app-db.ts';

/** Transaction-level advisory lock serialising prompt_version inserts (D-29). */
export const PROMPT_VERSION_LOCK_KEY = 815309003;

/** RED stub: replaced by the implementation in the GREEN commit. */
export async function ensurePromptVersion(
  _db: AppDb,
  _material: PromptMaterial,
): Promise<{ id: string; version: number; created: boolean }> {
  return { id: '', version: 0, created: false };
}
