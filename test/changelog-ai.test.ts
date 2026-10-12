import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  buildPrompt,
  CHANGELOG_MODEL,
  cleanText,
  commitLink,
  type Highlights,
  renderHighlights,
  writeHighlights,
} from '../scripts/changelog-ai.ts';
import { repoUrlFromEnv } from '../scripts/release.ts';
import type { RawCommit } from '../scripts/release-plan.ts';
import { planRelease, renderChangelogSection } from '../scripts/release-plan.ts';

const REPO = 'https://github.com/owner/sift';
const A = 'aaaaaaa1111111111111111111111111111111111'.slice(0, 40);
const B = 'bbbbbbb2222222222222222222222222222222222'.slice(0, 40);
const C = 'ccccccc3333333333333333333333333333333333'.slice(0, 40);

const COMMITS: RawCommit[] = [
  { sha: A, subject: 'feat(worker): classify mail with the local LLM', body: 'Adds the LLM tier.' },
  { sha: B, subject: 'fix: keep the mailbox ok when one message fails', body: '' },
  { sha: C, subject: 'docs: link the quick start from the intro', body: '' },
];

const HIGHLIGHTS: Highlights = {
  summary: 'Sift now classifies mail with a local model.',
  features: [
    { text: 'Mail no rule matches is classified by the local LLM.', commits: ['aaaaaaa'] },
  ],
  updates: [{ text: 'The README links the quick start from the top.', commits: ['ccccccc'] }],
  fixes: [
    { text: 'One failing message no longer marks the mailbox as down.', commits: ['bbbbbbb'] },
  ],
};

/** A client whose beta.messages.parse returns `result` (or throws it) and records the request. */
function fakeClient(result: unknown): { client: Anthropic; requests: unknown[] } {
  const requests: unknown[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: unknown) => {
          requests.push(params);
          if (result instanceof Error) throw result;
          return result;
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

describe('writeHighlights', () => {
  it('asks the default model with fallbacks, structured output and the commit messages', async () => {
    const { client, requests } = fakeClient({ stop_reason: 'end_turn', parsed_output: HIGHLIGHTS });
    const warnings: string[] = [];

    const result = await writeHighlights({
      version: '0.2.0',
      commits: COMMITS,
      client,
      warn: (line) => warnings.push(line),
    });

    expect(result).toEqual(HIGHLIGHTS);
    expect(warnings).toEqual([]);
    const request = requests[0] as Record<string, unknown>;
    expect(request.model).toBe(CHANGELOG_MODEL);
    expect(request.fallbacks).toBe('default');
    expect(request.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect((request.output_config as Record<string, unknown>).format).toBeDefined();
    const content = (request.messages as Array<{ content: string }>)[0]?.content ?? '';
    expect(content).toContain('Release v0.2.0, 3 commits');
    expect(content).toContain(
      'aaaaaaa feat(worker): classify mail with the local LLM\nAdds the LLM tier.',
    );
  });

  it.each([
    ['a refusal', { stop_reason: 'refusal', parsed_output: null }, 'declined'],
    ['a truncated answer', { stop_reason: 'max_tokens', parsed_output: null }, 'unusable'],
    ['unparsed output', { stop_reason: 'end_turn', parsed_output: null }, 'unusable'],
    ['a thrown error', new Error('network down'), 'network down'],
  ])('returns null and warns on %s', async (_name, result, reason) => {
    const { client } = fakeClient(result);
    const warnings: string[] = [];

    const out = await writeHighlights({
      version: '0.2.0',
      commits: COMMITS,
      client,
      warn: (line) => warnings.push(line),
    });

    expect(out).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(reason);
    expect(warnings[0]).toContain('using the commit lists');
  });
});

describe('renderHighlights', () => {
  it('renders the summary and the three groups, each entry linked to its commits', () => {
    expect(renderHighlights(HIGHLIGHTS, COMMITS, REPO)).toBe(
      [
        '### Highlights',
        '',
        'Sift now classifies mail with a local model.',
        '',
        '### New features',
        '',
        `- Mail no rule matches is classified by the local LLM. ([aaaaaaa](${REPO}/commit/${A}))`,
        '',
        '### Updates',
        '',
        `- The README links the quick start from the top. ([ccccccc](${REPO}/commit/${C}))`,
        '',
        '### Bug fixes',
        '',
        `- One failing message no longer marks the mailbox as down. ([bbbbbbb](${REPO}/commit/${B}))`,
        '',
      ].join('\n'),
    );
  });

  it('drops entries citing no release commit and unknown SHAs, and dedupes the rest', () => {
    const out = renderHighlights(
      {
        summary: '',
        features: [
          { text: 'Made up.', commits: ['1234567', 'not-a-sha'] },
          { text: 'Real.', commits: ['AAAAAAA', A, 'ddddddd'] },
        ],
        updates: [],
        fixes: [{ text: '', commits: ['bbbbbbb'] }],
      },
      COMMITS,
      REPO,
    );
    expect(out).toBe(`### New features\n\n- Real. ([aaaaaaa](${REPO}/commit/${A}))\n`);
  });

  it('keeps bare short SHAs without a repository URL', () => {
    expect(renderHighlights(HIGHLIGHTS, COMMITS, undefined)).toContain('local LLM. (aaaaaaa)');
  });

  it('gives an empty string when nothing usable is left', () => {
    expect(
      renderHighlights({ summary: ' ', features: [], updates: [], fixes: [] }, COMMITS, REPO),
    ).toBe('');
  });
});

describe('cleanText', () => {
  it('strips links, URLs, HTML brackets, line breaks and leading Markdown', () => {
    expect(cleanText('## [see](https://x.test) <b>this</b>\nnow https://evil.test/a ok')).toBe(
      'see bthis/b now ok',
    );
  });

  it('cuts long text at a word', () => {
    const out = cleanText(`${'word '.repeat(200)}end`);
    expect(out.length).toBeLessThanOrEqual(403);
    expect(out.endsWith('word...')).toBe(true);
  });
});

describe('commit links', () => {
  it('links a short SHA to the full commit', () => {
    expect(commitLink(A, REPO)).toBe(`[aaaaaaa](${REPO}/commit/${A})`);
    expect(commitLink(A, undefined)).toBe('aaaaaaa');
  });

  it('builds the repository URL only from well-formed Actions variables', () => {
    expect(
      repoUrlFromEnv({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'owner/sift' }),
    ).toBe(REPO);
    expect(repoUrlFromEnv({ GITHUB_REPOSITORY: 'owner/sift' })).toBeUndefined();
    expect(
      repoUrlFromEnv({ GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'a/b)c' }),
    ).toBeUndefined();
  });

  it('links every commit bullet in a section', () => {
    const plan = planRelease(
      { lastTag: 'v0.1.0', commits: COMMITS, date: '2026-10-12' },
      { repoUrl: REPO },
    );
    expect(plan.section).toContain(
      `- **worker:** classify mail with the local LLM ([aaaaaaa](${REPO}/commit/${A}))`,
    );
    expect(plan.releasable).toEqual(COMMITS);
  });

  it('puts the highlights first and every commit, grouped, under All commits', () => {
    const highlights = renderHighlights(HIGHLIGHTS, COMMITS, REPO);
    const plan = planRelease(
      { lastTag: 'v0.1.0', commits: COMMITS, date: '2026-10-12' },
      { repoUrl: REPO, highlights },
    );
    const section = plan.section;
    expect(section.startsWith(`## v0.2.0 (2026-10-12)\n\n${highlights}`)).toBe(true);
    const all = section.slice(section.indexOf('### All commits'));
    expect(all).toContain('#### Features');
    expect(all).toContain('#### Fixes');
    expect(all).toContain(
      `#### Other changes\n\n- link the quick start from the intro ([ccccccc](${REPO}/commit/${C}))`,
    );
    expect(section.endsWith('\n')).toBe(true);
    expect(section.endsWith('\n\n')).toBe(false);
  });

  it('keeps the plain lists unchanged without highlights', () => {
    expect(
      renderChangelogSection('0.1.1', '2026-10-12', [
        { sha: B, type: 'fix', scope: undefined, description: 'x', breaking: false },
      ]),
    ).toBe('## v0.1.1 (2026-10-12)\n\n### Fixes\n\n- x (bbbbbbb)\n');
  });
});

describe('buildPrompt', () => {
  it('lists each commit by short SHA, subject and body', () => {
    expect(buildPrompt('0.2.0', COMMITS.slice(1))).toBe(
      'Release v0.2.0, 2 commits:\n\nbbbbbbb fix: keep the mailbox ok when one message fails\n\nccccccc docs: link the quick start from the intro',
    );
  });
});
