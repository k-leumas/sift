import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { configDenylist, privacyProblems } from './support/privacy-scan.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PHASE_DIR = '.planning/phases/02-bridge-spike-and-imap-ingest';
const RECORD_PATH = `${PHASE_DIR}/02-LIVE-INGEST.md`;
const FINDINGS_PATH = `${PHASE_DIR}/02-SPIKE-FINDINGS.md`;

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

const record = read(RECORD_PATH);
const findings = read(FINDINGS_PATH);
/** The owner's IMAP usernames when the main checkout has config/config.yaml; [] in CI. */
const denylist = configDenylist(path.join(REPO_ROOT, 'config/config.yaml'));

const SECTIONS = [
  '## Method',
  '## Criterion 3: stored once, restart adds nothing',
  '## Criterion 4: new mail within one poll',
  '## Criterion 5: UIDVALIDITY resync',
  '## Result',
];

function section(text: string, heading: string): string {
  const start = text.indexOf(`${heading}\n`);
  if (start === -1) return '';
  const rest = text.slice(start + heading.length + 1);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

function lineValue(text: string, label: string): string | undefined {
  const prefix = `**${label}:** `;
  return text
    .split('\n')
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
}

describe('02-LIVE-INGEST.md (ROADMAP Phase 2 criteria 3, 4 and 5 on the real mailbox)', () => {
  it('opens with the Bridge version scope line and is no longer in progress', () => {
    expect(record).toContain('Measured on Proton Bridge v3.27.0');
    expect(record).not.toContain('Status: in progress');
  });

  it('has the method, the three criterion sections and the result', () => {
    for (const heading of SECTIONS) {
      expect(record.split('\n'), heading).toContain(heading);
    }
  });

  it('has one result line per criterion, the UIDVALIDITY method and the overall result', () => {
    for (const label of ['Criterion 3', 'Criterion 4', 'Criterion 5']) {
      expect(lineValue(record, label), label).toMatch(/^(pass|fail: .+|not run.*)$/);
    }
    expect(lineValue(record, 'UIDVALIDITY method')).toMatch(
      /^(bridge repair|simulated mismatch|not run \(owner choice\))\b/,
    );
    const results = record.split('\n').filter((line) => line.startsWith('**Live ingest:**'));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatch(/^\*\*Live ingest:\*\* (pass|partial: .+|fail: .+)$/);
  });

  it('marks a simulated mismatch as partial: Bridge itself was not observed (D-86)', () => {
    const method = lineValue(record, 'UIDVALIDITY method') ?? '';
    if (!method.startsWith('simulated mismatch')) return;
    expect(record).toContain("Bridge's own UIDVALIDITY change was not observed");
    expect(section(record, '## Criterion 5: UIDVALIDITY resync')).toContain('02-SPIKE-FINDINGS.md');
    expect(lineValue(record, 'Live ingest')).not.toBe('pass');
  });

  it('runs with the spike initial_backfill_days or documents the owner override (D-84)', () => {
    const spike = findings.match(/^\*\*Post-spike initial_backfill_days:\*\* ([0-9]+)$/m)?.[1];
    expect(spike).toBeDefined();
    const method = section(record, '## Method');
    const used = method.match(/\*\*initial_backfill_days:\*\* ([0-9]+)\b/)?.[1];
    expect(used).toBeDefined();
    if (used === spike) return;
    // The owner changed the value mid-run ("1 day, start now"): the record must say so and
    // cite the spike value it departed from.
    expect(method).toContain('**Deviation from D-84:**');
    expect(method).toContain(`**Post-spike initial_backfill_days:** ${spike}`);
  });

  it('holds counts only: no header lines, addresses or configured usernames', () => {
    expect(privacyProblems(record, denylist)).toEqual([]);
  });
});
