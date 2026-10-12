import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW = fileURLToPath(new URL('../../../.github/workflows/release.yml', import.meta.url));
const CI_WORKFLOW = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

interface Step {
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface Workflow {
  name?: string;
  on?: {
    workflow_run?: { workflows?: string[]; types?: string[]; branches?: string[] };
  };
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs?: Record<string, { if?: string; steps?: Step[] }>;
}

const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
const ciName = (parse(readFileSync(CI_WORKFLOW, 'utf8')) as Workflow).name;
const job = workflow.jobs?.release;
const steps = job?.steps ?? [];
const run = steps.map((s) => s.run ?? '').join('\n');

describe('.github/workflows/release.yml', () => {
  it('runs only after a successful ci run for a push to main', () => {
    expect(workflow.on?.workflow_run?.workflows).toEqual([ciName]);
    expect(workflow.on?.workflow_run?.types).toEqual(['completed']);
    expect(workflow.on?.workflow_run?.branches).toEqual(['main']);
    expect(job?.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job?.if).toContain("github.event.workflow_run.event == 'push'");
  });

  it('releases one at a time and never cancels a release in progress', () => {
    expect(workflow.concurrency).toEqual({ group: 'release', 'cancel-in-progress': false });
    expect(workflow.permissions).toEqual({ contents: 'write' });
  });

  it('checks out the commit ci tested, with full history and tags', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.ref).toBe(['$', '{{ github.event.workflow_run.head_sha }}'].join(''));
    expect(checkout?.with?.['fetch-depth']).toBe(0);
    expect(checkout?.with?.['fetch-tags']).toBe(true);
  });

  it('pins every action to a full commit SHA', () => {
    for (const step of steps) {
      if (step.uses !== undefined) expect(step.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it('cuts the release in CI mode, checks the tag, then pushes commit and tag atomically', () => {
    const release = steps.find((s) => s.run?.includes('node scripts/release.ts') === true);
    expect(release?.env?.SIFT_RELEASE_CI).toBe('1');
    expect(run).not.toContain(['$', '{{'].join(''));
    expect(run.indexOf('node scripts/release.ts')).toBeLessThan(
      run.indexOf('node scripts/release-check.ts'),
    );
    expect(run.indexOf('node scripts/release-check.ts')).toBeLessThan(
      run.indexOf('git push --atomic'),
    );
    expect(run).toContain('git push --atomic origin HEAD:refs/heads/main "refs/tags/$TAG"');
  });

  it('passes the API key from a secret and skips the commit hooks on the release commit', () => {
    const release = steps.find((s) => s.run?.includes('node scripts/release.ts') === true);
    expect(release?.env?.ANTHROPIC_API_KEY).toBe(['$', '{{ secrets.ANTHROPIC_API_KEY }}'].join(''));
    expect(release?.env?.LEFTHOOK).toBe('0');
    expect(run.indexOf('pnpm install --frozen-lockfile')).toBeLessThan(
      run.indexOf('node scripts/release.ts'),
    );
  });

  it('publishes a GitHub Release from the CHANGELOG section only after the push', () => {
    const publish = steps.find((s) => s.run?.includes('gh release create') === true);
    expect(publish?.if).toBe("steps.release.outputs.tag != ''");
    expect(publish?.env?.GH_TOKEN).toBe(['$', '{{ github.token }}'].join(''));
    expect(publish?.run).toContain('node scripts/release-notes.ts "$TAG"');
    expect(publish?.run).toContain('--verify-tag');
    expect(steps.indexOf(publish as Step)).toBeGreaterThan(
      steps.findIndex((s) => s.run?.includes('git push --atomic') === true),
    );
    expect(run).toContain('echo "tag=$TAG" >> "$GITHUB_OUTPUT"');
  });

  it('pushes over the release deploy key, which the rulesets let bypass them', () => {
    const checkout = steps.find((s) => s.uses?.startsWith('actions/checkout@'));
    expect(checkout?.with?.['ssh-key']).toBe(['$', '{{ secrets.RELEASE_DEPLOY_KEY }}'].join(''));
  });

  it('stops on its own release commit, which the deploy-key push sends through ci', () => {
    expect(run).toContain(`git log -1 --format=%s "$HEAD_SHA" | grep -q '^chore(release): '`);
    expect(run.indexOf("grep -q '^chore(release): '")).toBeLessThan(
      run.indexOf('node scripts/release.ts'),
    );
  });

  it('stops without releasing when main has moved past the tested commit', () => {
    expect(run.indexOf('git rev-parse origin/main')).toBeLessThan(
      run.indexOf('node scripts/release.ts'),
    );
  });
});
