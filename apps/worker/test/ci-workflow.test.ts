import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  env?: Record<string, unknown>;
  services?: Record<string, { image?: string }>;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

function checkJob(): Job {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
  const job = workflow.jobs?.check;
  if (job === undefined) {
    throw new Error('ci.yml has no job "check"');
  }
  return job;
}

/** Index of the first run step containing `command`, or -1. */
function runIndex(steps: Step[], command: string): number {
  return steps.findIndex((s) => s.run?.includes(command) === true);
}

describe('.github/workflows/ci.yml (D-26)', () => {
  const job = checkJob();
  const steps = job.steps ?? [];

  it('runs against a Postgres 18 + pgvector service container', () => {
    const image = job.services?.postgres?.image ?? '';
    expect(image.startsWith('pgvector/pgvector:')).toBe(true);
    expect(image).toContain('pg18');
  });

  it('reads the Node version from .nvmrc and sets pnpm up without corepack', () => {
    const setupNode = steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
    expect(setupNode?.with?.['node-version-file']).toBe('.nvmrc');
    expect(steps.some((s) => s.uses?.startsWith('pnpm/action-setup@'))).toBe(true);
    expect(steps.some((s) => s.run?.includes('corepack') === true)).toBe(false);
  });

  it('bootstraps the database with db/bootstrap.sql', () => {
    expect(runIndex(steps, 'db/bootstrap.sql')).toBeGreaterThanOrEqual(0);
  });

  it('runs lint, typecheck and test in that order, after the bootstrap', () => {
    const bootstrap = runIndex(steps, 'db/bootstrap.sql');
    const lint = runIndex(steps, 'pnpm lint');
    const typecheck = runIndex(steps, 'pnpm typecheck');
    const test = runIndex(steps, 'pnpm test');
    expect(lint).toBeGreaterThan(bootstrap);
    expect(typecheck).toBeGreaterThan(lint);
    expect(test).toBeGreaterThan(typecheck);
  });

  it('defines CI and SIFT_TEST_ADMIN_URL so DB tests run instead of failing', () => {
    expect(job.env?.CI).toBe('true');
    expect(typeof job.env?.SIFT_TEST_ADMIN_URL).toBe('string');
    expect(job.env).toHaveProperty('SIFT_DB_OWNER_PASSWORD');
    expect(job.env).toHaveProperty('SIFT_DB_APP_PASSWORD');
    expect(job.env).toHaveProperty('SIFT_DB_BACKUP_PASSWORD');
  });
});
