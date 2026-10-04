import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@sift/core/config';
import { describe, expect, it } from 'vitest';

const EXAMPLE = fileURLToPath(new URL('../../../config/config.example.yaml', import.meta.url));
const CLI = fileURLToPath(new URL('../../../apps/worker/src/cli.ts', import.meta.url));

describe('config/config.example.yaml (D-61)', () => {
  it('validates with the real schema', async () => {
    const result = await loadConfig(EXAMPLE);
    if (!result.ok) throw new Error(`example config is invalid: ${JSON.stringify(result.issues)}`);
    expect(result.config.mailboxes.map((m) => m.slug)).toEqual(['personal', 'job-search']);
    expect(result.config.worker.poll_interval_seconds).toBe(60);
    expect(result.config.models.url).toBe('http://host.docker.internal:11434');
  });

  it('passes `sift config check --schema-only`', () => {
    const run = spawnSync(process.execPath, [CLI, 'config', 'check', '--schema-only'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SIFT_CONFIG: EXAMPLE },
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^Config OK: 2 mailboxes/);
  });

  it('reports a missing config file and exits 1', () => {
    const run = spawnSync(process.execPath, [CLI, 'config', 'check', '--schema-only'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SIFT_CONFIG: '/nonexistent/sift/config.yaml' },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('config file not found');
  });
});
