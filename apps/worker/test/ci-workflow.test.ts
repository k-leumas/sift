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
  'runs-on'?: string;
  env?: Record<string, unknown>;
  services?: Record<string, { image?: string }>;
  steps?: Step[];
}

interface Workflow {
  jobs?: Record<string, Job>;
}

function workflowJob(name: string): Job {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
  const job = workflow.jobs?.[name];
  if (job === undefined) {
    throw new Error(`ci.yml has no job "${name}"`);
  }
  return job;
}

function checkJob(): Job {
  return workflowJob('check');
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

describe('.github/workflows/ci.yml compose-smoke job', () => {
  const job = workflowJob('compose-smoke');
  const steps = job.steps ?? [];

  it('checks out the repository and runs the full-stack smoke script', () => {
    expect(job['runs-on']).toBe('ubuntu-24.04');
    expect(steps.some((s) => s.uses?.startsWith('actions/checkout@'))).toBe(true);
    expect(runIndex(steps, 'scripts/compose-smoke.sh')).toBeGreaterThanOrEqual(0);
  });

  it('tears the throwaway stack down, volumes included', () => {
    const smoke = steps[runIndex(steps, 'scripts/compose-smoke.sh')];
    expect(smoke?.run).toContain('--down');
  });
});

describe('third-party actions (IN-07)', () => {
  it('pins every action to a full commit SHA with its version in a comment', () => {
    const lines = readFileSync(WORKFLOW, 'utf8')
      .split('\n')
      .filter((line) => /^\s*(-\s*)?uses:/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });
});
