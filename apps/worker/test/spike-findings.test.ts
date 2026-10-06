import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configDenylist, privacyProblems } from './support/privacy-scan.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FINDINGS_PATH = '.planning/phases/02-bridge-spike-and-imap-ingest/02-SPIKE-FINDINGS.md';
const ADR_PATH = 'docs/adr/0003-traces-and-mail-app-relabels.md';

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

const findings = read(FINDINGS_PATH);
const adr = read(ADR_PATH);
/** The owner's IMAP usernames when the main checkout has config/config.yaml; [] in CI. */
const denylist = configDenylist(path.join(REPO_ROOT, 'config/config.yaml'));

const SECTIONS = [
  '## Labels as folders (SPK-01)',
  '## CONDSTORE and QRESYNC (SPK-02)',
  '## Message identity (SPK-03)',
  '## UIDVALIDITY and INTERNALDATE (SPK-04)',
  '## IDLE',
  '## Address mode',
  '## Decision for later phases',
  '## Method',
];

function section(text: string, heading: string): string {
  const start = text.indexOf(`${heading}\n`);
  if (start === -1) return '';
  const rest = text.slice(start + heading.length + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('02-SPIKE-FINDINGS.md (SPK-01..04, D-43)', () => {
  it('has every section heading', () => {
    for (const heading of SECTIONS) {
      expect(findings.split('\n'), heading).toContain(heading);
    }
  });

  it('opens with the Bridge version scope line and is no longer in progress', () => {
    expect(findings).toContain('Measured on Proton Bridge v3.27.0');
    expect(findings).not.toContain('Status: in progress');
  });

  it('records the post-spike initial_backfill_days in the Method section (D-84)', () => {
    expect(section(findings, '## Method')).toMatch(
      /^\*\*Post-spike initial_backfill_days:\*\* [0-9]+$/m,
    );
  });

  it('names one allowed sync capability to assume', () => {
    const lines = findings
      .split('\n')
      .filter((line) => line.startsWith('**Sync capability to assume:**'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\*\*Sync capability to assume:\*\* (polling only|CONDSTORE|QRESYNC)\b/,
    );
  });

  it('has the Phase 4 label application and identity key decision lines', () => {
    expect(findings).toMatch(/^\*\*Phase 4 label application:\*\* \S/m);
    expect(findings).toMatch(/^\*\*Identity key:\*\* \S/m);
    expect(findings).toMatch(/^\*\*D-18\/D-22 design:\*\* \S/m);
  });

  it('holds aggregates only: no header lines, addresses or configured usernames', () => {
    expect(privacyProblems(findings, denylist)).toEqual([]);
  });
});

describe('ADR-0003 addendum', () => {
  it('has the spike addendum linking the findings', () => {
    expect(adr).toContain('## Addendum');
    expect(section(adr, '## Addendum (2026-10): Proton Bridge spike (M1)')).toContain(
      FINDINGS_PATH,
    );
  });

  it('resolves raw-prompt retention: traces store the prompt recipe (D-09)', () => {
    expect(section(adr, '## Addendum (2026-10): Proton Bridge spike (M1)')).toMatch(
      /prompt recipe/,
    );
  });

  it('holds aggregates only: no header lines, addresses or configured usernames', () => {
    expect(privacyProblems(adr, denylist)).toEqual([]);
  });
});

describe('privacyProblems', () => {
  it('flags a planted denylist word and a planted address without echoing them', () => {
    const planted = [
      'ok line',
      'contains Zebracorn here',
      'mail jane.doe@realmail.example now',
    ].join('\n');
    const problems = privacyProblems(planted, ['zebracorn', 'ab']);
    expect(problems).toEqual([
      'line 2: denylisted identifier',
      'line 3: email address outside the allowlisted domains',
    ]);
    const joined = problems.join('\n').toLowerCase();
    expect(joined).not.toContain('zebracorn');
    expect(joined).not.toContain('jane.doe');
    expect(joined).not.toContain('realmail');
  });

  it('flags header-style lines and allows the allowlisted domains', () => {
    const text = [
      'Subject: hello',
      'from: someone',
      'a@x.example.test',
      'id@protonmail.internalid',
    ].join('\n');
    expect(privacyProblems(text)).toEqual([
      'line 1: header-style line',
      'line 2: header-style line',
    ]);
  });

  it('ignores denylist entries shorter than 3 characters', () => {
    expect(privacyProblems('ab cd', ['ab', ' '])).toEqual([]);
  });
});

describe('configDenylist', () => {
  it('returns [] when the config file does not exist', () => {
    expect(configDenylist(path.join(REPO_ROOT, 'config/no-such-config.yaml'))).toEqual([]);
  });

  it('lists each mailbox username and its local part, not the slug', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sift-privacy-scan-'));
    try {
      const file = path.join(dir, 'config.yaml');
      writeFileSync(
        file,
        [
          'mailboxes:',
          '  - slug: personal',
          '    imap: { host: bridge, username: owner.name@realmail.example }',
          '  - slug: work',
          '    imap: { host: bridge, username: plainuser }',
        ].join('\n'),
      );
      expect(configDenylist(file)).toEqual([
        'owner.name@realmail.example',
        'owner.name',
        'plainuser',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
