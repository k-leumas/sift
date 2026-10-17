import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@sift/core/config';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

/**
 * D-69: until the mailbox hard-delete command exists, no owner-facing text and
 * no shipped source may name it. The word is assembled here so this file does
 * not match its own scan (test files are deliberately outside the scan).
 */
const DEFERRED_COMMAND = new RegExp(['pur', 'ge'].join(''), 'i');

/**
 * The owner-facing docs split out of README.md in quick-261017-505. Every new
 * owner doc is added here, so the D-69, bind, scope and old-config scans and
 * the link check below cover it.
 */
const OWNER_DOCS = [
  'docs/how-it-works.md',
  'docs/configuration.md',
  'docs/operations.md',
  'docs/troubleshooting.md',
  'docs/architecture.md',
  'docs/security.md',
  'docs/evals.md',
];

/** The README heading after the quick start; the quick-start slices end here. */
const QUICK_START_END = '## Where to read next';

/** Owner- and contributor-facing files that ship with the repository. */
const SCANNED_FILES = [
  'README.md',
  ...OWNER_DOCS,
  'CONTRIBUTING.md',
  'config/config.example.yaml',
  '.env.example',
  '.env.mailboxes.example',
  '.env.development.example',
  'compose.yaml',
  'Dockerfile',
  'bridge/Dockerfile',
  'bridge/entrypoint.sh',
];

/** Shipped source trees (tests live outside them). */
const SCANNED_DIRS = ['apps/worker/src', 'packages/core/src', 'packages/db/src'];

/** Every file under a directory, as repo-relative paths. */
function filesUnder(dir: string): string[] {
  return readdirSync(path.join(REPO_ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)));
}

/** Lines of `text` matching `pattern`, as "file:line: text" for a readable failure. */
function matches(file: string, text: string, pattern: RegExp): string[] {
  return text
    .split('\n')
    .flatMap((line, i) => (pattern.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
}

/** GitHub's heading anchor: trim, lower-case, keep a-z, 0-9, spaces and hyphens, spaces to hyphens. */
function anchor(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');
}

/** Markdown headings outside fenced code blocks (YAML comments in code blocks start with '#'). */
function headings(markdown: string): string[] {
  const found: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^ *```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const heading = /^#{1,6} (.*)$/.exec(line);
    if (!fenced && heading) found.push(heading[1] ?? '');
  }
  return found;
}

describe('D-69: the deferred mailbox hard-delete command is never named', () => {
  it('scans files that exist', () => {
    for (const file of SCANNED_FILES) {
      expect(existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
    }
    for (const dir of SCANNED_DIRS) {
      expect(filesUnder(dir).length, dir).toBeGreaterThan(0);
    }
  });

  it('is absent from owner-facing files', () => {
    const hits = SCANNED_FILES.flatMap((file) => matches(file, read(file), DEFERRED_COMMAND));
    expect(hits).toEqual([]);
  });

  it('is absent from shipped source under apps/worker/src and packages/*/src', () => {
    const files = SCANNED_DIRS.flatMap(filesUnder);
    expect(files).toContain(path.join('apps', 'worker', 'src', 'cli.ts'));
    const hits = files.flatMap((file) => matches(file, read(file), DEFERRED_COMMAND));
    expect(hits).toEqual([]);
  });
});

describe('README quick start (D-28, D-56, D-58)', () => {
  const readme = read('README.md');

  // Each pin is asserted in the file it lives in since the README split (quick-261017-505).
  it.each([
    // Quick start: copy the example files, Bridge setup and pinning, start (D-28, D-56, D-58).
    ['README.md', 'cp config/config.example.yaml config/config.yaml'],
    ['README.md', 'cp .env.example .env'],
    ['README.md', 'cp .env.mailboxes.example .env.mailboxes'],
    ['README.md', 'docker compose up -d'],
    ['README.md', 'sudo chown 1000 backups'],
    ['README.md', 'docker volume create sift-bridge'],
    ['README.md', 'docker compose run --rm bridge-init'],
    ['README.md', 'touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak'],
    ['README.md', 'cp .env.mailboxes.bak .env.mailboxes'],
    // CR-02 (D-39): the IMAP password file is created owner-only.
    ['README.md', 'cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes'],
    ['README.md', 'does not echo'],
    ['README.md', 'pin_sha256'],
    ['README.md', 'SIFT_BRIDGE_KEYCHAIN_PASSPHRASE'],
    // D-73 and the scoped spike outcome (SPK-04).
    ['README.md', 'FileVault'],
    ['README.md', 'LUKS'],
    ['README.md', '02-SPIKE-FINDINGS.md'],
    // Phase 3: the rules file and the local model (D-01, D-05).
    [
      'README.md',
      'mkdir -p data/mailboxes/<slug> && cp data/mailboxes/example/rules.example.yaml data/mailboxes/<slug>/rules.yaml',
    ],
    ['README.md', 'ollama pull qwen3:1.7b'],
    ['README.md', 'docker compose run --rm --no-deps worker sift config check'],
    [
      'README.md',
      'Config OK: 2 mailboxes (personal, job-search); password env vars present; rules files valid',
    ],
    ['README.md', 'rules files valid'],
    // Configuration: the technical settings and the re-run command (D-07, D-17).
    ['docs/configuration.md', 'docker compose run --rm setup'],
    ['docs/configuration.md', 'version: 1'],
    ['docs/configuration.md', 'Labels/<Category>'],
    [
      'docs/configuration.md',
      'docker compose run --rm --no-deps worker sift classify <slug> --all-pending',
    ],
    ['docs/configuration.md', 'sift classify <slug> --all-pending'],
    ['docs/configuration.md', '--since <YYYY-MM-DD>'],
    ['docs/configuration.md', '--message <id>'],
    ['docs/configuration.md', '`--yes`'],
    ['docs/configuration.md', 'imap.tls.pin_sha256'],
    // Operations: worker health and the owner's mailbox commands (Phase 2).
    ['docs/operations.md', 'docker compose logs worker'],
    ['docs/operations.md', 'sift bridge trust <slug>'],
    ['docs/operations.md', 'sift mailbox resume <slug>'],
    ['docs/operations.md', 'sift mailbox backfill <slug> --days 3'],
    ['docs/operations.md', 'Proton Bridge v3.27.0'],
    ['docs/operations.md', 'mv data/mailboxes/<old> data/mailboxes/<new>'],
    // Security model: D-37, D-10.
    [
      'docs/security.md',
      'Sift never stores your Proton password; Bridge stores session tokens in the sift-bridge volume',
    ],
    // How it works: what M1 stores today.
    ['docs/how-it-works.md', 'not trained'],
    ['docs/how-it-works.md', 'Nothing is written into your mailbox yet'],
  ])('%s contains %s', (file, text) => {
    expect(read(file)).toContain(text);
  });

  /** The later-milestones block of docs/operations.md, up to Managing mailboxes. */
  function laterMilestones(): string {
    const operations = read('docs/operations.md');
    const start = operations.indexOf('**Arriving in later milestones**');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = operations.indexOf('## Managing mailboxes', start);
    expect(end).toBeGreaterThan(start);
    return operations.slice(start, end);
  }

  it('creates the rules file and pulls the model before the first docker compose up -d', () => {
    const quickStart = readme.slice(
      readme.indexOf('### Quick start'),
      readme.indexOf(QUICK_START_END),
    );
    const steps = [
      'pin_sha256',
      'cp data/mailboxes/example/rules.example.yaml data/mailboxes/<slug>/rules.yaml',
      'ollama pull qwen3:1.7b',
      'docker compose up -d',
      'docker compose run --rm --no-deps worker sift config check',
    ].map((step) => quickStart.indexOf(step));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    // The model pull works today, so it is no longer listed under later milestones.
    expect(laterMilestones()).not.toContain('qwen3:1.7b');
  });

  it('quotes the owner lines exactly as the code prints them', async () => {
    const { infraOwnerMessage, unclassifiedNotice } = await import('../src/classify/run.ts');
    const howItWorks = read('docs/how-it-works.md');
    const ctx = { modelsUrl: 'http://host.docker.internal:11434', model: 'qwen3:1.7b' };
    for (const line of [
      infraOwnerMessage('unreachable', { ...ctx, status: null, detail: 'ECONNREFUSED' }),
      infraOwnerMessage('model_missing', { ...ctx, status: null, detail: '' }),
    ]) {
      expect(howItWorks).toContain(`error: ${line}`);
    }
    // The ok-state notice sift mailbox list shows for a message Ollama failed on alone (WR-03).
    expect(howItWorks).toContain(`ok; ${unclassifiedNotice(['<id>'])}`);
    const sources: Record<string, string[]> = {
      'apps/worker/src/commands/config-check.ts': ['password env vars present; rules files valid'],
      'apps/worker/src/commands/classify.ts': [
        'Classify them? Type yes to continue:',
        '--message <id> | --since <YYYY-MM-DD> | --all-pending) [--yes]',
        // The skip line for a message Ollama failed on alone (CR-01).
        'Ollama failed on this message (',
      ],
      'packages/core/src/rules/load.ts': ['rules file not found: '],
      'apps/worker/src/classify/run.ts': ['. See them all with: '],
    };
    for (const [file, texts] of Object.entries(sources)) {
      for (const text of texts) expect(read(file), file).toContain(text);
    }
  });

  it('copies the example files in the same order the compose smoke test creates them', () => {
    const steps = [
      'cp config/config.example.yaml config/config.yaml',
      'cp .env.example .env',
      'cp .env.mailboxes.example .env.mailboxes',
      'docker compose up -d',
    ].map((step) => readme.indexOf(step));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('creates the volume and the backup file before the first Bridge login, then starts (D-81)', () => {
    const quickStart = readme.slice(
      readme.indexOf('### Quick start'),
      readme.indexOf(QUICK_START_END),
    );
    const steps = [
      'cp config/config.example.yaml config/config.yaml',
      'cp .env.example .env',
      'cp .env.mailboxes.example .env.mailboxes',
      'docker volume create sift-bridge',
      'touch .env.mailboxes.bak && chmod 600 .env.mailboxes.bak',
      'docker compose run --rm bridge-init',
      'pin_sha256',
      'docker compose up -d',
    ].map((step) => quickStart.indexOf(step));
    expect(steps.every((i) => i >= 0)).toBe(true);
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
  });

  it('no longer lists the Bridge login under later milestones', () => {
    expect(laterMilestones()).not.toMatch(/bridge/i);
  });

  /** The first YAML block under "Technical settings" in docs/configuration.md. */
  function technicalSettingsYaml(): string {
    const configuration = read('docs/configuration.md');
    const heading = configuration.indexOf('## Technical settings');
    expect(heading).toBeGreaterThanOrEqual(0);
    const section = configuration.slice(heading);
    const start = section.indexOf('```yaml') + '```yaml'.length;
    return section.slice(start, section.indexOf('```', start)).trimStart();
  }

  it('starts the technical-settings example with version: 1', () => {
    expect(technicalSettingsYaml().startsWith('version: 1\n')).toBe(true);
  });

  it('keeps the active technical-settings keys valid for the strict config schema', async () => {
    const active = technicalSettingsYaml()
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    // tiers.llm.confidence_threshold is read today (D-25); later-milestone keys stay as comments.
    expect(active).not.toMatch(/^(quick_confirm|relabel_sync):/m);
    expect(active).toMatch(/^tiers:\n {2}llm:\n {4}confidence_threshold: 0\.75/m);
    expect(active).not.toMatch(/^\s+(classifier|examples_per_prompt):/m);
    expect(technicalSettingsYaml()).toMatch(/^#\s+classifier:/m);
    const dir = mkdtempSync(path.join(tmpdir(), 'sift-readme-config-'));
    try {
      const file = path.join(dir, 'config.yaml');
      writeFileSync(file, active);
      const result = await loadConfig(file);
      expect(result.ok ? [] : result.issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no longer points at the old add-mailbox command or the root example config', () => {
    const oldAdd = new RegExp(['sift', 'mailbox', 'add'].join('\\s+'));
    for (const file of ['README.md', ...OWNER_DOCS]) {
      const text = read(file);
      expect(text, file).not.toMatch(oldAdd);
      expect(text, file).not.toMatch(/cp config\.example\.yaml/);
    }
  });

  it('documents rename and list through the setup service, with no deletion step', () => {
    const operations = read('docs/operations.md');
    expect(operations).toContain('docker compose run --rm setup sift mailbox rename <old> <new>');
    expect(operations).toContain('docker compose run --rm setup sift mailbox list');
  });
});

describe('README quick start is easy to find and scan (G-03-8)', () => {
  const readme = read('README.md');

  interface QuickStartStep {
    number: number;
    /** The rest of the step's first line, after `<n>. `. */
    lead: string;
    /** The lines below the step's first line, up to the next step. */
    lines: string[];
  }

  /** The numbered steps between '### Quick start' and QUICK_START_END. */
  function quickStartSteps(): QuickStartStep[] {
    const start = readme.indexOf('### Quick start');
    const end = readme.indexOf(QUICK_START_END);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const lines = readme.slice(start, end).split('\n');
    const first = lines.findIndex((line) => /^1\. /.test(line));
    expect(first).toBeGreaterThanOrEqual(0);
    const steps: QuickStartStep[] = [];
    for (const line of lines.slice(first)) {
      const step = /^(\d+)\. (.*)$/.exec(line);
      if (step) {
        steps.push({ number: Number(step[1]), lead: step[2] ?? '', lines: [] });
        continue;
      }
      // A non-blank line at the left margin ends the list.
      if (line.trim() !== '' && !line.startsWith(' ')) break;
      steps[steps.length - 1]?.lines.push(line);
    }
    return steps;
  }

  it('links the quick start from the intro with its step count (G-03-8)', () => {
    const intro = readme.slice(0, readme.indexOf('## Why'));
    const count = quickStartSteps().length;
    expect(count).toBeGreaterThan(0);
    expect(intro).toContain('[Quick start](#quick-start)');
    expect(intro).toMatch(new RegExp(`(?<!\\d)${count} numbered steps`));
    expect(intro).toContain('it does not put labels in Proton yet');
    // The ordering pins read the first occurrence, so the intro names no quick-start command.
    for (const command of ['docker compose', 'cp ', 'ollama pull']) {
      expect(intro).not.toContain(command);
    }
  });

  it('has exactly one heading with the quick-start anchor (G-03-8)', () => {
    expect(headings(readme).filter((heading) => anchor(heading) === 'quick-start')).toEqual([
      'Quick start',
    ]);
    expect(readme).toMatch(/^### Quick start$/m);
  });

  it('numbers the steps 1 to 12, each led by a short bold imperative (G-03-8)', () => {
    const steps = quickStartSteps();
    expect(steps.map((step) => step.number)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    for (const { number, lead } of steps) {
      const bold = /^\*\*([^*]+)\*\*$/.exec(lead);
      expect(bold, `step ${number}: ${lead}`).not.toBeNull();
      const text = bold?.[1] ?? '';
      expect(text.endsWith('.'), `step ${number}: ${text}`).toBe(true);
      expect(text.length, `step ${number}: ${text}`).toBeLessThanOrEqual(60);
    }
  });

  it('indents every line of a step under its number (G-03-8)', () => {
    for (const { number, lines } of quickStartSteps()) {
      // `1. ` is 3 characters wide and `10. ` is 4: list content starts there, code fences too.
      const indent = number < 10 ? '   ' : '    ';
      for (const line of lines.filter((l) => l.trim() !== '')) {
        expect(line.startsWith(indent), `step ${number}: ${line}`).toBe(true);
      }
    }
  });

  it('keeps the step numbers other text refers to (G-03-8)', () => {
    const lead = (n: number) => quickStartSteps().find((step) => step.number === n)?.lead ?? '';
    // CONTRIBUTING "steps 6 to 9", README "step 8" (login), "step 9" (pin) and "step 12" (start).
    expect(lead(6)).toContain("Bridge's volume");
    expect(lead(8)).toMatch(/^\*\*Log in/);
    expect(lead(9)).toMatch(/^\*\*Pin/);
    expect(lead(12)).toMatch(/^\*\*Start/);
    expect(read('docs/configuration.md')).toContain(
      '([Quick start](../README.md#quick-start), step 9)',
    );
    expect(readme).toContain('the Bridge login in step 8');
    expect(readme).toContain('(step 12)');
    expect(read('CONTRIBUTING.md')).toContain('(README.md#quick-start) (steps 6 to 9)');
  });
});

describe('README scope and host requirements (G-02-8, G-02-9)', () => {
  const readme = read('README.md');
  const SCOPE = 'Sift supports only Proton Mail, through Proton Bridge, for now';

  /** The part of `readme` from `from` up to `to`; fails if either heading is missing. */
  function between(from: string, to: string): string {
    const start = readme.indexOf(from);
    const end = readme.indexOf(to, start);
    expect(start, from).toBeGreaterThanOrEqual(0);
    expect(end, to).toBeGreaterThan(start);
    return readme.slice(start, end);
  }

  it('states the Proton-only scope in the intro and in Requirements', () => {
    expect(readme.slice(0, readme.indexOf('## Why'))).toContain(SCOPE);
    expect(between('### Requirements', '### Quick start')).toContain(SCOPE);
  });

  it('asks for an NTP-synced host clock in Requirements, with the macOS and Linux checks', () => {
    const requirements = between('### Requirements', '### Quick start');
    expect(requirements).toContain('A host clock kept in sync over NTP');
    expect(requirements).toContain('timedatectl');
    expect(requirements).toContain('sntp time.apple.com');
  });

  // Wording that implied mail servers other than Proton Bridge (case-insensitive).
  it.each([
    'any IMAP client',
    'other IMAP servers',
    'non-Proton',
    'fastmail',
    'implicit',
    'public certificate authority',
    'For a Bridge mailbox',
    'for Proton,',
    'An IMAP account per mailbox',
  ])('no longer contains %s', (phrase) => {
    for (const file of ['README.md', ...OWNER_DOCS]) {
      expect(read(file).toLowerCase(), file).not.toContain(phrase.toLowerCase());
    }
  });
});

describe('CONTRIBUTING development loop and gates (D-22, D-31, D-47)', () => {
  const contributing = read('CONTRIBUTING.md');

  it.each([
    'pnpm install',
    'cp .env.development.example .env.development',
    'cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes',
    'docker compose up -d db',
    'pnpm sift migrate && pnpm sift config apply',
    'pnpm dev',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
    'SIFT_TEST_ADMIN_URL',
    'SIFT_PG_DUMP=scripts/pg-dump-via-compose.sh',
    'packages/db/test/catalog.test.ts',
    'packages/db/test/isolation.test.ts',
    'pnpm db:generate',
    'withMailbox',
    // Phase 2: Bridge prerequisites, host development and the extra checks.
    'SIFT_BRIDGE_KEYCHAIN_PASSPHRASE',
    'docker volume create sift-bridge',
    'docker compose run --rm bridge-init',
    'docker compose up -d bridge',
    'SIFT_BRIDGE_PORT',
    'host: localhost',
    'imap.tls.pin_sha256',
    'sift bridge trust <slug>',
    'scripts/test-imap.sh up',
    'scripts/bridge-smoke.sh',
    // Releases: the release workflow cuts them after ci passes on main; locally only a dry run.
    'pnpm release --dry-run',
    'pnpm release',
    '.github/workflows/release.yml',
    'SIFT_RELEASE_CI=1',
    'git pull --rebase',
    'chore(release): v',
    'sift --version',
    '.github/workflows/release-tag.yml',
    // Phase 3: classification tests are hermetic; the live baseline is manual.
    'apps/worker/test/support/fake-ollama.ts',
    'pnpm vitest run classify',
    'data/mailboxes/<slug>/rules.yaml',
    'node apps/worker/test/support/llm-baseline.ts --url',
  ])('contains %s', (text) => {
    expect(contributing).toContain(text);
  });

  it('no longer claims the repository has no code or no linter', () => {
    const staleLinter = new RegExp(
      ['No', 'linter', 'or', 'formatter', 'is', 'configured'].join(' '),
    );
    expect(contributing).not.toMatch(staleLinter);
    expect(contributing).not.toMatch(/There is nothing to build or run yet/);
  });

  it('creates the Bridge volume right before starting the database', () => {
    expect(contributing).toContain('docker volume create sift-bridge\n   docker compose up -d db');
  });

  it('names commands that exist in package.json', () => {
    const scripts = Object.keys(
      (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts,
    );
    const named = [...contributing.matchAll(/`pnpm ([a-z][a-z:-]*)/g)].flatMap((m) =>
      m[1] === undefined ? [] : [m[1]],
    );
    expect(named).toContain('db:generate');
    // pnpm built-ins, plus `pnpm eval`, which CONTRIBUTING marks as planned (M4).
    const builtins = new Set(['install', 'vitest', 'eval']);
    expect(named.filter((name) => !builtins.has(name) && !scripts.includes(name))).toEqual([]);
  });
});

describe('Bridge command form and bind addresses (D-79)', () => {
  /**
   * The pre-D-79 init command (`bridge` and `init` as two words). Built from
   * parts so this file does not contain it.
   */
  const OLD_INIT = new RegExp(['run --rm bridge', 'init'].join(' '));
  /** The wildcard bind address, built from parts so this file does not contain it. */
  const WILDCARD_BIND = new RegExp(['0', '0', '0', '0'].join('\\.'));

  it.each(['README.md', ...OWNER_DOCS, 'CONTRIBUTING.md', 'bridge/entrypoint.sh', 'compose.yaml'])(
    '%s never shows the old init command form',
    (file) => {
      expect(matches(file, read(file), OLD_INIT)).toEqual([]);
    },
  );

  it.each(['README.md', ...OWNER_DOCS, 'CONTRIBUTING.md'])(
    '%s never shows the wildcard bind address',
    (file) => {
      expect(matches(file, read(file), WILDCARD_BIND)).toEqual([]);
    },
  );
});

describe('README, CONTRIBUTING, docs and ADR links resolve (quick-261017-505)', () => {
  const ADR_DIR = 'docs/adr';
  const adrs = readdirSync(path.join(REPO_ROOT, ADR_DIR))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${ADR_DIR}/${name}`);
  const LINKED_FILES = ['README.md', 'CONTRIBUTING.md', ...OWNER_DOCS, ...adrs];

  /** Every `](target)` outside fenced code blocks, with inline code spans removed first. */
  function linkTargets(text: string): string[] {
    const targets: string[] = [];
    let fenced = false;
    for (const line of text.split('\n')) {
      if (/^ *```/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced) continue;
      const plain = line.replace(/`[^`]*`/g, '');
      for (const m of plain.matchAll(/\]\(([^)\s]*)\)/g)) targets.push(m[1] ?? '');
    }
    return targets;
  }

  it('resolves every relative link and anchor', () => {
    expect(adrs.length).toBeGreaterThan(0);
    const failures: string[] = [];
    let checked = 0;
    for (const file of LINKED_FILES) {
      for (const target of linkTargets(read(file))) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        checked++;
        const hash = target.indexOf('#');
        const pathPart = hash === -1 ? target : target.slice(0, hash);
        const fragment = hash === -1 ? '' : target.slice(hash + 1);
        const resolved =
          pathPart === '' ? file : path.join(path.dirname(file), decodeURIComponent(pathPart));
        if (!existsSync(path.join(REPO_ROOT, resolved))) {
          failures.push(`${file}: ${target} (no such path ${resolved})`);
          continue;
        }
        if (fragment !== '' && resolved.endsWith('.md')) {
          const anchors = headings(read(resolved)).map(anchor);
          if (!anchors.includes(fragment)) {
            failures.push(`${file}: ${target} (no heading ${fragment} in ${resolved})`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it('links every owner doc from the README', () => {
    const readme = read('README.md');
    for (const doc of OWNER_DOCS) expect(readme, doc).toContain(`](${doc}`);
  });

  it('gives every heading in the README and the owner docs its own anchor', () => {
    for (const file of ['README.md', ...OWNER_DOCS]) {
      const anchors = headings(read(file)).map(anchor);
      const repeated = anchors.filter((a, i) => anchors.indexOf(a) !== i);
      expect(repeated, file).toEqual([]);
    }
  });
});

describe('docs/troubleshooting.md gathers the scattered fixes (quick-261017-505)', () => {
  const troubleshooting = read('docs/troubleshooting.md');

  it.each([
    'Ollama unreachable at http://host.docker.internal:11434 (ECONNREFUSED)',
    'has no model qwen3:1.7b',
    'rules file not found',
    'needs attention: <n> new messages held',
    'sift bridge trust <slug>',
    'SIFT_BRIDGE_PORT',
    'sntp time.apple.com',
    'timedatectl',
    'cp .env.mailboxes.bak .env.mailboxes',
    'bind source path does not exist',
    'sudo chown 1000 backups',
    'sift mailbox backfill <slug>',
  ])('contains %s', (text) => {
    expect(troubleshooting).toContain(text);
  });

  it('has at least nine entries, each linking to the section with the full detail', () => {
    const sections = troubleshooting.split(/^(?=## )/m).filter((part) => part.startsWith('## '));
    expect(sections.length).toBeGreaterThanOrEqual(9);
    for (const section of sections) {
      const relative = [...section.matchAll(/\]\(([^)\s]+)\)/g)].filter(
        (m) => !/^[a-z][a-z0-9+.-]*:/i.test(m[1] ?? ''),
      );
      expect(relative.length, section.split('\n')[0]).toBeGreaterThan(0);
    }
  });
});
