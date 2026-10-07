import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageJsonFiles, WORKSPACE_DIRS } from '../scripts/release.ts';
import {
  latestReleaseTag,
  type ParsedCommit,
  parseCommit,
  planRelease,
  prependChangelog,
  type RawCommit,
  ReleaseRefusedError,
  renderChangelogSection,
  setPackageVersion,
} from '../scripts/release-plan.ts';
import { parseYaml, REPO_ROOT } from './support/release-repo.ts';

const DATE = '2026-10-07';

let counter = 0;
/** A raw commit with a unique 40-hex sha. */
function raw(subject: string, body = ''): RawCommit {
  counter += 1;
  return { sha: counter.toString(16).padStart(40, 'a'), subject, body };
}

function next(lastTag: string | null, ...commits: RawCommit[]): string {
  return planRelease({ lastTag, commits, date: DATE }).version;
}

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

describe('planRelease bump rules (LD-2, LD-3)', () => {
  it('gives 0.1.0 for the first release whatever the commit types are', () => {
    expect(next(null, raw('fix: a'))).toBe('0.1.0');
    expect(next(null, raw('feat: a'), raw('fix: b'))).toBe('0.1.0');
    expect(next(null, raw('feat!: a'))).toBe('0.1.0');
    const plan = planRelease({ lastTag: null, commits: [raw('fix: a')], date: DATE });
    expect(plan.tag).toBe('v0.1.0');
    expect(plan.section.startsWith('## v0.1.0 (2026-10-07)\n')).toBe(true);
  });

  it('bumps minor for any feat', () => {
    expect(next('v0.1.0', raw('fix: a'), raw('feat(core): b'))).toBe('0.2.0');
  });

  it('bumps patch when there is no feat and no breaking change', () => {
    expect(next('v0.1.0', raw('fix: a'))).toBe('0.1.1');
    expect(next('v0.1.0', raw('perf: a'))).toBe('0.1.1');
    expect(next('v0.1.0', raw('docs: a'), raw('test: b'), raw('chore(deps): c'))).toBe('0.1.1');
    expect(next('v0.1.0', raw('Update things'))).toBe('0.1.1');
  });

  it('bumps minor for a breaking change while major is 0, never reaching 1.0.0', () => {
    expect(next('v0.3.2', raw('feat(core)!: drop x'))).toBe('0.4.0');
    expect(next('v0.3.2', raw('fix: y', 'BREAKING CHANGE: z'))).toBe('0.4.0');
    expect(next('v0.3.2', raw('fix: y', 'BREAKING-CHANGE: z'))).toBe('0.4.0');
    expect(next('v0.9.0', raw('refactor!: x'))).toBe('0.10.0');
  });

  it('follows normal semver from 1.x on', () => {
    expect(next('v1.2.3', raw('feat!: x'))).toBe('2.0.0');
    expect(next('v1.2.3', raw('feat: x'))).toBe('1.3.0');
  });

  it('refuses when there are no releasable commits', () => {
    expect(() => next('v0.1.0')).toThrow(ReleaseRefusedError);
    expect(() => next('v0.1.0')).toThrow(/no releasable commits since v0\.1\.0/);
    expect(() => next('v0.1.0', raw('chore(release): v0.1.1'))).toThrow(ReleaseRefusedError);
    expect(() => next('v0.1.0', raw('chore(release): v0.1.1'))).toThrow(
      /no releasable commits since v0\.1\.0/,
    );
  });
});

describe('latestReleaseTag', () => {
  it('picks the numerically highest plain vX.Y.Z tag', () => {
    expect(latestReleaseTag(['v0.9.0', 'v0.10.0', 'vnext', 'v1.0.0-rc.1', 'release-1'])).toBe(
      'v0.10.0',
    );
    expect(latestReleaseTag([])).toBeNull();
  });
});

describe('parseCommit', () => {
  it('parses type, scope, description and the breaking marker', () => {
    expect(parseCommit({ sha: 'abc', subject: 'feat(worker)!: drop x', body: '' })).toEqual({
      sha: 'abc',
      type: 'feat',
      scope: 'worker',
      description: 'drop x',
      breaking: true,
    });
  });

  it('gives type other for a non-conventional subject', () => {
    const parsed = parseCommit({ sha: 'abc', subject: 'Initial commit', body: '' });
    expect(parsed.type).toBe('other');
    expect(parsed.breaking).toBe(false);
    expect(parsed.description).toBe('Initial commit');
  });
});

describe('renderChangelogSection', () => {
  const commit = (over: Partial<ParsedCommit>): ParsedCommit => ({
    sha: '1234567890abcdef',
    type: 'fix',
    scope: undefined,
    description: 'x',
    breaking: false,
    ...over,
  });

  it('renders breaking, features and fixes groups, leaving other types out', () => {
    const section = renderChangelogSection('0.2.0', DATE, [
      commit({
        sha: 'aaaaaaa111',
        type: 'feat',
        scope: 'db',
        description: 'drop y',
        breaking: true,
      }),
      commit({ sha: 'bbbbbbb222', type: 'feat', scope: 'core', description: 'add alpha' }),
      commit({ sha: 'ccccccc333', type: 'fix', description: 'repair beta' }),
      commit({ sha: 'ddddddd444', type: 'docs', description: 'explain gamma' }),
    ]);
    expect(section).toBe(
      [
        '## v0.2.0 (2026-10-07)',
        '',
        '### Breaking',
        '',
        '- **db:** drop y (aaaaaaa)',
        '',
        '### Features',
        '',
        '- **core:** add alpha (bbbbbbb)',
        '',
        '### Fixes',
        '',
        '- repair beta (ccccccc)',
        '',
      ].join('\n'),
    );
  });

  it('says so when there are no features or fixes', () => {
    expect(renderChangelogSection('0.1.1', DATE, [commit({ type: 'docs' })])).toBe(
      '## v0.1.1 (2026-10-07)\n\n- No features or fixes (1 other commit).\n',
    );
    expect(
      renderChangelogSection('0.1.1', DATE, [commit({ type: 'docs' }), commit({ type: 'ci' })]),
    ).toContain('(2 other commits).');
  });
});

describe('prependChangelog', () => {
  const v1 = '## v0.1.0 (2026-10-01)\n\n### Fixes\n\n- a (aaaaaaa)\n';
  const v2 = '## v0.2.0 (2026-10-07)\n\n### Features\n\n- b (bbbbbbb)\n';

  it('creates the file with a title and an intro', () => {
    const text = prependChangelog(null, v1);
    expect(text.startsWith('# Changelog\n\n')).toBe(true);
    expect(text).toContain('pnpm release');
    expect(text.endsWith(v1)).toBe(true);
  });

  it('puts the new section above the previous one with one blank line between', () => {
    const text = prependChangelog(prependChangelog(null, v1), v2);
    expect(text.match(/^# Changelog$/gm)).toHaveLength(1);
    expect(text.indexOf('## v0.2.0')).toBeLessThan(text.indexOf('## v0.1.0'));
    expect(text).toContain(`${v2}\n${v1}`);
    expect(text).not.toContain(`${v2}\n\n`);
  });
});

describe('setPackageVersion', () => {
  it('keeps every real package.json byte for byte (biome format)', () => {
    for (const file of packageJsonFiles(REPO_ROOT)) {
      const text = read(file);
      const version = (JSON.parse(text) as { version: string }).version;
      expect(setPackageVersion(text, version), file).toBe(text);
    }
  });

  it('inserts version as the second key when absent', () => {
    expect(setPackageVersion('{"name":"x","private":true}', '1.2.3')).toBe(
      '{\n  "name": "x",\n  "version": "1.2.3",\n  "private": true\n}\n',
    );
  });

  it('replaces an existing version in place', () => {
    expect(setPackageVersion('{"private":true,"version":"0.0.0","name":"x"}', '0.1.0')).toBe(
      '{\n  "private": true,\n  "version": "0.1.0",\n  "name": "x"\n}\n',
    );
  });

  it('refuses text that is not a named package', () => {
    expect(() => setPackageVersion('[]', '0.1.0')).toThrow();
    expect(() => setPackageVersion('{"private":true}', '0.1.0')).toThrow();
  });
});

describe('real repository invariants', () => {
  it('gives every package.json the root version', () => {
    const versions = packageJsonFiles(REPO_ROOT).map(
      (file) => (JSON.parse(read(file)) as { version?: string }).version,
    );
    expect(versions.length).toBeGreaterThanOrEqual(4);
    expect(new Set(versions)).toEqual(new Set([versions[0]]));
  });

  it('mirrors the pnpm-workspace.yaml package globs', () => {
    const workspace = parseYaml(read('pnpm-workspace.yaml')) as { packages: string[] };
    expect(WORKSPACE_DIRS.map((dir) => `${dir}/*`)).toEqual(workspace.packages);
  });
});
