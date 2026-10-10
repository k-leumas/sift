import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRules, RULES_EXAMPLE_PATH, resolveDataPath, rulesPathFor } from '@sift/core/rules';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const EXAMPLE = fileURLToPath(new URL(`../../../${RULES_EXAMPLE_PATH}`, import.meta.url));

/** Same address shape as apps/worker/test/support/privacy-scan.ts. */
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const EXAMPLE_DOMAIN = /^(?:[a-z0-9-]+\.)*example\.test$/;

describe('resolveDataPath', () => {
  it('defaults to ./data under the working directory', () => {
    expect(resolveDataPath({}, '/w')).toBe('/w/data');
    expect(resolveDataPath({ SIFT_DATA: '   ' }, '/w')).toBe('/w/data');
  });

  it('uses a trimmed SIFT_DATA, resolving a relative one against cwd', () => {
    expect(resolveDataPath({ SIFT_DATA: ' /x ' }, '/w')).toBe('/x');
    expect(resolveDataPath({ SIFT_DATA: 'mail-data' }, '/w')).toBe('/w/mail-data');
  });
});

describe('rulesPathFor', () => {
  it('builds <dataDir>/mailboxes/<slug>/rules.yaml', () => {
    expect(rulesPathFor('/d', 'personal')).toBe('/d/mailboxes/personal/rules.yaml');
    expect(rulesPathFor('/d', 'job-search')).toBe('/d/mailboxes/job-search/rules.yaml');
  });

  it.each(['../etc', 'Bad', '', 'a/b', '.', 'shared'])(
    'refuses the invalid slug %j with a TypeError',
    (slug) => {
      expect(() => rulesPathFor('/d', slug)).toThrow(TypeError);
      expect(() => rulesPathFor('/d', slug)).toThrow(/^invalid mailbox slug: /);
    },
  );
});

describe(`${RULES_EXAMPLE_PATH} (D-04)`, () => {
  it('validates with the real schema and uses the README categories', async () => {
    const result = await loadRules(EXAMPLE);
    if (!result.ok) throw new Error(`example rules are invalid: ${JSON.stringify(result.issues)}`);
    const { rules } = result;
    expect(rules.categories.map((c) => c.name)).toEqual([
      'Important',
      'Job search',
      'Receipts',
      'Reading',
      'Noise',
    ]);
    expect(rules.judgment.length).toBeGreaterThanOrEqual(1);
    const matches = rules.rules.map((rule) => rule.match);
    expect(matches.some((m) => m.domain !== undefined)).toBe(true);
    expect(
      matches.some((m) => m.from !== undefined && m.phrase !== undefined && m.in === 'subject'),
    ).toBe(true);
    expect(matches.some((m) => m.phrase !== undefined && m.in === 'body')).toBe(true);
  });

  it('names only example.test addresses and domains', async () => {
    const text = readFileSync(EXAMPLE, 'utf8');
    const addresses = [...text.matchAll(EMAIL_ADDRESS)];
    expect(addresses.length).toBeGreaterThan(0);
    for (const match of addresses) {
      expect(match[1]?.toLowerCase()).toMatch(EXAMPLE_DOMAIN);
    }

    const result = await loadRules(EXAMPLE);
    if (!result.ok) throw new Error('example rules are invalid');
    const domains = result.rules.rules.flatMap((rule) => [
      ...(rule.match.domain ?? []),
      ...(rule.match.from ?? []).map((from) => from.slice(from.indexOf('@') + 1)),
    ]);
    expect(domains.length).toBeGreaterThan(0);
    for (const domain of domains) expect(domain).toMatch(EXAMPLE_DOMAIN);
  });
});

describe('.gitignore keeps real rules out of git (D-04, T-03-02)', () => {
  const IGNORED = [
    'data/mailboxes/personal/rules.yaml',
    'data/mailboxes/example/rules.yaml',
    'data/mailboxes/example/eval/set.yaml',
    'data/mailboxes/personal/eval/set.yaml',
    'data/shared-rules.md',
    'data/live/worker.log',
  ];

  /** pattern per path from `git check-ignore -v --non-matching` ('' = no pattern matched). */
  function patterns(paths: string[]): Map<string, string> {
    const run = spawnSync('git', ['check-ignore', '--no-index', '-v', '--non-matching', ...paths], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(run.error).toBeUndefined();
    const out = new Map<string, string>();
    for (const line of run.stdout.split('\n')) {
      if (line === '') continue;
      // <source>:<line>:<pattern>\t<path>, or ::\t<path> when nothing matched
      const [where = '', path = ''] = line.split('\t');
      out.set(path, where.split(':').slice(2).join(':'));
    }
    return out;
  }

  it('ignores every real rules file, eval set and shared rules file', () => {
    const found = patterns(IGNORED);
    for (const path of IGNORED) {
      const pattern = found.get(path);
      expect(pattern, path).toBeTruthy();
      expect(pattern?.startsWith('!'), path).toBe(false);
    }
  });

  it('re-includes only the example rules file', () => {
    const pattern = patterns([RULES_EXAMPLE_PATH]).get(RULES_EXAMPLE_PATH);
    expect(pattern === '' || pattern?.startsWith('!')).toBe(true);
  });

  it('leaves only the example file as a candidate for git under data/', () => {
    const run = spawnSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', 'data'],
      {
        cwd: ROOT,
        encoding: 'utf8',
      },
    );
    expect(run.stdout.split('\n').filter((line) => line !== '')).toEqual([RULES_EXAMPLE_PATH]);
  });
});
