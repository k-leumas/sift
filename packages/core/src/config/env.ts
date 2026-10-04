import type { ConfigIssue } from './errors.ts';
import type { LoadResult } from './load.ts';
import type { SiftConfig } from './schema.ts';

type Env = Readonly<Record<string, string | undefined>>;

export type EnvCheck =
  | { ok: true }
  | { ok: false; missing: { name: string; slugs: string[] }[]; message: string };

export function checkMailboxEnv(_config: SiftConfig, _env: Env): EnvCheck {
  return { ok: true };
}

export function applyEnvOverrides(config: SiftConfig, _env: Env): LoadResult {
  const issues: ConfigIssue[] = [];
  return issues.length > 0
    ? { ok: false, issues, source: 'env' }
    : { ok: true, config, source: 'env' };
}

export function secretValues(_config: SiftConfig, _env: Env): string[] {
  return [];
}
