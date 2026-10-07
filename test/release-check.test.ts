import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { releaseProblems } from '../scripts/release-check.ts';
import {
  parseYaml,
  REPO_ROOT,
  readWork,
  releaseRepos,
  runScript,
  writeWork,
} from './support/release-repo.ts';

/** Each case spawns git and node a dozen times; slow under full-suite load (bug-189). */
const E2E_TIMEOUT_MS = 120_000;

const WORKFLOW = '.github/workflows/release-tag.yml';

/** A repository file, or null while it does not exist (so RED fails on an assertion). */
function readIfPresent(file: string): string | null {
  const full = path.join(REPO_ROOT, file);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

describe('releaseProblems (LD-6)', () => {
  const good = {
    tag: 'v0.2.0',
    rootVersion: '0.2.0',
    packageVersions: [
      { file: 'apps/worker/package.json', version: '0.2.0' },
      { file: 'packages/core/package.json', version: '0.2.0' },
      { file: 'packages/db/package.json', version: '0.2.0' },
    ],
    changelog: '# Changelog\n\n## v0.2.0 (2026-10-07)\n\n- x (abcdef0)\n',
  };

  it('accepts a matching tag, versions and changelog', () => {
    expect(releaseProblems(good)).toEqual([]);
  });

  it('rejects a tag that is not vX.Y.Z', () => {
    const problems = releaseProblems({ ...good, tag: 'v0.2' });
    expect(problems.some((p) => p.includes('v0.2') && /vX\.Y\.Z|format/.test(p))).toBe(true);
  });

  it('names both values when the tag disagrees with the root version', () => {
    const problems = releaseProblems({
      ...good,
      tag: 'v0.2.1',
      changelog: `${good.changelog}\n## v0.2.1 (2026-10-08)\n`,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('v0.2.1');
    expect(problems[0]).toContain('0.2.0');
  });

  it('names a workspace package with another version', () => {
    const problems = releaseProblems({
      ...good,
      packageVersions: good.packageVersions.map((p) =>
        p.file === 'packages/db/package.json' ? { ...p, version: '0.1.0' } : p,
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('packages/db/package.json');
    expect(problems[0]).toContain('0.1.0');
    expect(problems[0]).toContain('0.2.0');
  });

  it('names a workspace package without a version', () => {
    const problems = releaseProblems({
      ...good,
      packageVersions: good.packageVersions.map((p) =>
        p.file === 'packages/core/package.json' ? { ...p, version: undefined } : p,
      ),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('packages/core/package.json');
  });

  it.each([
    ['only an older section', '# Changelog\n\n## v0.1.0 (2026-10-01)\n'],
    ['a longer version that only starts with the tag', '# Changelog\n\n## v0.2.00 (2026-10-07)\n'],
  ])('rejects a changelog with %s', (_name, changelog) => {
    const problems = releaseProblems({ ...good, changelog });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('CHANGELOG.md');
    expect(problems[0]).toContain('v0.2.0');
  });

  it('rejects a missing CHANGELOG.md', () => {
    expect(releaseProblems({ ...good, changelog: null })).toEqual(['CHANGELOG.md is missing']);
  });
});

describe('node scripts/release-check.ts (LD-6)', { timeout: E2E_TIMEOUT_MS }, () => {
  const repos = releaseRepos();
  beforeAll(() => repos.setup(), E2E_TIMEOUT_MS);
  afterEach(() => repos.reset());
  afterAll(() => repos.cleanup());

  const check = (repo: ReturnType<typeof repos.released>, ...args: string[]) =>
    runScript(repo, 'scripts/release-check.ts', ...args);

  it('accepts the tag of a real release', () => {
    const { status, stdout, stderr } = check(repos.released(), 'v0.1.0');
    expect(stderr).toBe('');
    expect(status).toBe(0);
    expect(stdout).toContain('v0.1.0');
  });

  it('rejects a tag that is not the root version and names that version', () => {
    const { status, stderr } = check(repos.released(), 'v0.1.1');
    expect(status).toBe(1);
    expect(stderr).toContain('0.1.0');
    expect(stderr).toContain('release-check:');
  });

  it('names a workspace package.json with another version', () => {
    const repo = repos.released();
    const file = 'packages/core/package.json';
    writeWork(repo, file, readWork(repo, file).replace('"version": "0.1.0"', '"version": "0.0.9"'));
    const { status, stderr } = check(repo, 'v0.1.0');
    expect(status).toBe(1);
    expect(stderr).toContain('packages/core/package.json');
  });

  it('exits 2 with a usage line without a tag', () => {
    const { status, stderr } = check(repos.released());
    expect(status).toBe(2);
    expect(stderr).toContain('Usage: node scripts/release-check.ts');
  });
});

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  on?: unknown;
  permissions?: unknown;
  jobs?: Record<string, { 'runs-on'?: string; 'timeout-minutes'?: number; steps?: Step[] }>;
}

describe('release-tag workflow (LD-6)', () => {
  const text = readIfPresent(WORKFLOW);
  const workflow = (text === null ? {} : parseYaml(text)) as Workflow;
  const job = Object.values(workflow.jobs ?? {})[0];
  const steps = job?.steps ?? [];

  /** The trimmed `uses:` line for an action, from raw workflow text (keeps the # vX.Y.Z). */
  const usesLine = (source: string | null, action: string) =>
    source
      ?.split('\n')
      .find((line) => new RegExp(`^\\s*-?\\s*uses: ${action}@`).test(line))
      ?.trim();

  it('exists', () => {
    expect(text).not.toBeNull();
  });

  it('runs only on pushed v* tags, with read-only contents', () => {
    expect(workflow.on).toEqual({ push: { tags: ['v*'] } });
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('has one short job on ubuntu-24.04', () => {
    expect(Object.keys(workflow.jobs ?? {})).toHaveLength(1);
    expect(job?.['runs-on']).toBe('ubuntu-24.04');
    expect(job?.['timeout-minutes']).toBe(5);
  });

  it('checks out, sets up Node from .nvmrc and runs the tag check with the quoted ref name', () => {
    expect(steps.map((step) => step.uses ?? step.run?.trim())).toEqual([
      expect.stringMatching(/^actions\/checkout@[0-9a-f]{40}$/),
      expect.stringMatching(/^actions\/setup-node@[0-9a-f]{40}$/),
      'node scripts/release-check.ts "$GITHUB_REF_NAME"',
    ]);
    expect(steps[1]?.with).toEqual({ 'node-version-file': '.nvmrc' });
  });

  it('reuses the SHA pins ci.yml uses, byte for byte', () => {
    const ci = readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
    for (const action of ['actions/checkout', 'actions/setup-node']) {
      const line = usesLine(text, action);
      expect(line).toMatch(/@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
      expect(line).toBe(usesLine(ci, action));
    }
  });

  it('never installs dependencies or interpolates an expression into a run step', () => {
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(step.run ?? '').not.toContain('pnpm');
      expect(step.run ?? '').not.toContain('${{');
    }
  });
});
