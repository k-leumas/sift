import type { SiftConfig } from '@sift/core/config';
import { type AppDb, readRegistry } from '@sift/db';
import { describeChange, planRegistryChanges } from '@sift/db/registry-plan';

/**
 * Differences between config.yaml and the mailbox registry, one line per
 * change (D-34). An empty list means the registry matches config. The worker
 * only reads the registry (sift_app has SELECT on mailbox); applying config is
 * the setup service's job (D-27).
 */
export async function checkDrift(db: AppDb, config: SiftConfig): Promise<string[]> {
  return planRegistryChanges(config, await readRegistry(db)).map(describeChange);
}
