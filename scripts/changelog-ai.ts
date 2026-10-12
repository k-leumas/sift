/**
 * The written part of a CHANGELOG section: Claude reads the release's commit
 * messages (never mail or any other repository content) and returns a short
 * summary plus new features, updates and bug fixes, each citing the commits it
 * comes from. Only commits in the release become links; an entry citing none of
 * them is dropped, so a made-up item never reaches CHANGELOG.md. Any failure
 * (no ANTHROPIC_API_KEY, an API error, a refusal, unusable output) returns null
 * and the release goes out with the plain commit lists alone.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { RawCommit } from './release-plan.ts';

export const CHANGELOG_MODEL = 'claude-opus-5-5';

/** Characters kept per summary or entry after cleaning; longer text is cut at a word. */
const MAX_TEXT = 400;
/** Entries kept per group, in the order Claude gave them. */
const MAX_ENTRIES = 12;

const entrySchema = z.object({
  text: z.string(),
  commits: z.array(z.string()),
});

export const highlightsSchema = z.object({
  summary: z.string(),
  features: z.array(entrySchema),
  updates: z.array(entrySchema),
  fixes: z.array(entrySchema),
});

export type Highlights = z.infer<typeof highlightsSchema>;

const SYSTEM = `You write the release notes for Sift, a self-hosted email triage tool that runs on a small machine at home. The reader is the person who runs Sift: technical enough to use Docker, but not reading the code.

You get the Conventional Commit messages of one release. Write:
- summary: two or three plain sentences on what this release means for the owner.
- features: new things the owner can now do or see.
- updates: changes to existing behaviour, documentation, setup or tooling that the owner would notice.
- fixes: problems that no longer happen, said as the problem that is gone.

Each entry is one sentence in plain words, about the effect, not the code. Merge commits that belong to one change into one entry and list all their short SHAs in "commits". Leave out tests, planning notes and internal refactors unless they change something the owner sees. Keep each group to the dozen most important entries; a group can be empty. Use only facts in the commit messages, and cite only SHAs that appear in them. Do not write links, headings or Markdown.`;

function commitLines(commits: readonly RawCommit[]): string {
  return commits
    .map((c) => {
      const body = c.body.trim();
      return body === ''
        ? `${c.sha.slice(0, 7)} ${c.subject}`
        : `${c.sha.slice(0, 7)} ${c.subject}\n${body}`;
    })
    .join('\n\n');
}

export function buildPrompt(version: string, commits: readonly RawCommit[]): string {
  return `Release v${version}, ${commits.length} commits:\n\n${commitLines(commits)}`;
}

/** Ask Claude for the highlights; null on any failure, with the reason on `warn`. */
export async function writeHighlights(input: {
  version: string;
  commits: readonly RawCommit[];
  client?: Anthropic;
  warn: (line: string) => void;
}): Promise<Highlights | null> {
  const client = input.client ?? new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: CHANGELOG_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(highlightsSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(input.version, input.commits) }],
    });
    if (response.stop_reason === 'refusal') {
      input.warn('changelog: Claude declined to write the highlights; using the commit lists');
      return null;
    }
    if (response.stop_reason === 'max_tokens' || response.parsed_output === null) {
      input.warn('changelog: Claude returned unusable highlights; using the commit lists');
      return null;
    }
    return response.parsed_output;
  } catch (error) {
    const reason =
      error instanceof Anthropic.APIError
        ? `API error ${error.status ?? 'without status'}`
        : error instanceof Error
          ? error.message
          : String(error);
    input.warn(`changelog: could not write the highlights (${reason}); using the commit lists`);
    return null;
  }
}

/** One line of plain text: no links, HTML or Markdown structure, at most MAX_TEXT characters. */
export function cleanText(text: string): string {
  let out = text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/^[\s#>*-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > MAX_TEXT) {
    const cut = out.slice(0, MAX_TEXT);
    const space = cut.lastIndexOf(' ');
    out = `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}...`;
  }
  return out;
}

/** `[abc1234](<repo>/commit/<full sha>)`, or the bare short SHA without a repository URL. */
export function commitLink(sha: string, repoUrl: string | undefined): string {
  const short = sha.slice(0, 7);
  return repoUrl === undefined ? short : `[${short}](${repoUrl}/commit/${sha})`;
}

/** Full SHAs of the release commits a cited SHA (7 or more hex characters) names, once each. */
function resolveShas(cited: readonly string[], commits: readonly RawCommit[]): string[] {
  const found: string[] = [];
  for (const raw of cited) {
    const sha = raw.trim().toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) continue;
    const match = commits.find((c) => c.sha.toLowerCase().startsWith(sha));
    if (match !== undefined && !found.includes(match.sha)) found.push(match.sha);
  }
  return found;
}

/** The `### Highlights` .. `### Bug fixes` part of a section; '' when nothing usable is left. */
export function renderHighlights(
  highlights: Highlights,
  commits: readonly RawCommit[],
  repoUrl: string | undefined,
): string {
  const lines: string[] = [];
  const summary = cleanText(highlights.summary);
  if (summary !== '') lines.push('### Highlights', '', summary, '');
  const groups: Array<[string, Highlights['features']]> = [
    ['New features', highlights.features],
    ['Updates', highlights.updates],
    ['Bug fixes', highlights.fixes],
  ];
  for (const [heading, entries] of groups) {
    const bullets: string[] = [];
    for (const entry of entries) {
      if (bullets.length === MAX_ENTRIES) break;
      const text = cleanText(entry.text);
      const shas = resolveShas(entry.commits, commits);
      if (text === '' || shas.length === 0) continue;
      bullets.push(`- ${text} (${shas.map((sha) => commitLink(sha, repoUrl)).join(', ')})`);
    }
    if (bullets.length > 0) lines.push(`### ${heading}`, '', ...bullets, '');
  }
  return lines.join('\n');
}
