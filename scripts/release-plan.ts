/**
 * Pure release logic for `pnpm release`: version computation from Conventional
 * Commits, CHANGELOG rendering and package.json version edits. No I/O here;
 * scripts/release.ts does the git and file work.
 */

export interface RawCommit {
  sha: string;
  subject: string;
  body: string;
}

export interface ParsedCommit {
  sha: string;
  type: string;
  scope: string | undefined;
  description: string;
  breaking: boolean;
}

export interface ReleasePlan {
  version: string;
  tag: string;
  section: string;
  /** The commits the section is built from (release commits left out), newest first. */
  releasable: RawCommit[];
}

export interface SectionOptions {
  /** `https://github.com/<owner>/<repo>`: every short SHA links to its commit. */
  repoUrl?: string | undefined;
  /** Written summary and groups (scripts/changelog-ai.ts), put above the commit lists. */
  highlights?: string | undefined;
}

/** A refusal the owner can act on (no releasable commits, dirty tree, ...). */
export class ReleaseRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseRefusedError';
  }
}

/** The first release is always this version, whatever the commit types are. */
export const FIRST_VERSION = '0.1.0';

const HEADER = /^([a-z]+)(?:\(([^()]*)\))?(!)?: (.+)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

export function parseCommit(raw: RawCommit): ParsedCommit {
  const footer = BREAKING_FOOTER.test(raw.body);
  const match = HEADER.exec(raw.subject);
  if (match === null) {
    return {
      sha: raw.sha,
      type: 'other',
      scope: undefined,
      description: raw.subject,
      breaking: footer,
    };
  }
  const [, type = 'other', scope, bang, description = ''] = match;
  return {
    sha: raw.sha,
    type,
    scope: scope === undefined || scope === '' ? undefined : scope,
    description,
    breaking: bang === '!' || footer,
  };
}

type Triple = [number, number, number];

function parseTag(tag: string): Triple | null {
  const match = RELEASE_TAG.exec(tag);
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareTriples(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Highest plain `vX.Y.Z` tag by numeric order (v0.10.0 beats v0.9.0), or null. */
export function latestReleaseTag(tags: readonly string[]): string | null {
  let best: { tag: string; triple: Triple } | null = null;
  for (const tag of tags) {
    const triple = parseTag(tag);
    if (triple === null) continue;
    if (best === null || compareTriples(triple, best.triple) > 0) best = { tag, triple };
  }
  return best === null ? null : best.tag;
}

export function planRelease(
  input: {
    lastTag: string | null;
    commits: readonly RawCommit[];
    date: string;
  },
  options: SectionOptions = {},
): ReleasePlan {
  // Merge commits never arrive: the wrapper logs with --no-merges.
  const raw = input.commits.filter((c) => !isReleaseCommit(parseCommit(c)));
  const releasable = raw.map(parseCommit);
  if (releasable.length === 0) {
    const since = input.lastTag === null ? 'the first commit' : input.lastTag;
    throw new ReleaseRefusedError(`no releasable commits since ${since}`);
  }
  const version = input.lastTag === null ? FIRST_VERSION : bump(input.lastTag, releasable);
  return {
    version,
    tag: `v${version}`,
    section: renderChangelogSection(version, input.date, releasable, options),
    releasable: raw,
  };
}

/** LD-2: breaking = minor while major is 0 (major after), else feat = minor, else patch. */
function bump(lastTag: string, commits: readonly ParsedCommit[]): string {
  const triple = parseTag(lastTag);
  if (triple === null) throw new ReleaseRefusedError(`${lastTag} is not a vX.Y.Z tag`);
  const [major, minor, patch] = triple;
  const minorBump = `${major}.${minor + 1}.0`;
  if (commits.some((c) => c.breaking)) return major === 0 ? minorBump : `${major + 1}.0.0`;
  if (commits.some((c) => c.type === 'feat')) return minorBump;
  return `${major}.${minor}.${patch + 1}`;
}

function isReleaseCommit(commit: ParsedCommit): boolean {
  return commit.type === 'chore' && commit.scope === 'release';
}

function bullet(commit: ParsedCommit, repoUrl: string | undefined): string {
  const short = commit.sha.slice(0, 7);
  const sha = repoUrl === undefined ? short : `[${short}](${repoUrl}/commit/${commit.sha})`;
  return commit.scope === undefined
    ? `- ${commit.description} (${sha})`
    : `- **${commit.scope}:** ${commit.description} (${sha})`;
}

/**
 * Without highlights: Breaking, Features and Fixes as `###` lists (other types
 * left out). With highlights: those first, then every commit under
 * `### All commits`, the same groups one level down plus Other changes.
 */
export function renderChangelogSection(
  version: string,
  date: string,
  commits: readonly ParsedCommit[],
  options: SectionOptions = {},
): string {
  const isFix = (c: ParsedCommit) => c.type === 'fix' || c.type === 'perf';
  const groups: Array<[string, ParsedCommit[]]> = [
    ['Breaking', commits.filter((c) => c.breaking)],
    ['Features', commits.filter((c) => !c.breaking && c.type === 'feat')],
    ['Fixes', commits.filter((c) => !c.breaking && isFix(c))],
  ];
  const highlights = options.highlights?.trim() ?? '';
  const lines = [`## v${version} (${date})`, ''];
  if (highlights !== '') {
    groups.push([
      'Other changes',
      commits.filter((c) => !c.breaking && c.type !== 'feat' && !isFix(c)),
    ]);
    lines.push(highlights, '', '### All commits', '');
  }
  const level = highlights === '' ? '###' : '####';
  for (const [heading, entries] of groups) {
    if (entries.length === 0) continue;
    lines.push(`${level} ${heading}`, '', ...entries.map((c) => bullet(c, options.repoUrl)), '');
  }
  if (lines.length === 2) {
    const n = commits.filter((c) => !isReleaseCommit(c)).length;
    lines.push(`- No features or fixes (${n} other ${n === 1 ? 'commit' : 'commits'}).`, '');
  }
  // `lines` ends with '' so the join ends with exactly one newline.
  return lines.join('\n');
}

const CHANGELOG_INTRO =
  'Each version is computed by `pnpm release` from the Conventional Commits since the ' +
  'previous tag (see CONTRIBUTING.md).';

export function prependChangelog(existing: string | null, section: string): string {
  if (existing === null) return `# Changelog\n\n${CHANGELOG_INTRO}\n\n${section}`;
  const lines = existing.split('\n');
  const at = lines.findIndex((line) => line.startsWith('## '));
  if (at === -1) return `${existing.trimEnd()}\n\n${section}`;
  const before = lines.slice(0, at).join('\n');
  const after = lines.slice(at).join('\n');
  return `${before}${at > 0 ? '\n' : ''}${section}\n${after}`;
}

export function setPackageVersion(text: string, version: string): string {
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).name !== 'string'
  ) {
    throw new Error('package.json must be an object with a string "name"');
  }
  const source = parsed as Record<string, unknown>;
  let result: Record<string, unknown>;
  if (Object.hasOwn(source, 'version')) {
    result = { ...source, version };
  } else {
    result = {};
    for (const [key, value] of Object.entries(source)) {
      result[key] = value;
      if (key === 'name') result.version = version;
    }
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}
