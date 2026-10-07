import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T-02-31 / D-11: ingest never changes the owner's mail. folder-source.ts
 * opens folders with EXAMINE and fetches with BODY.PEEK; this pins the static
 * half so a later edit cannot add a write call outside the owner-run probe.
 */
const SRC = path.resolve(import.meta.dirname, '../src');

// The owner-run `sift bridge probe` label test (02-11, T-02-39/T-02-68) is the
// only code allowed to write to a mailbox.
const PROBE = 'spike/probe.ts';

const mutatingCall = new RegExp(
  [
    '\\.(',
    'messageFlags(Add|Set|Remove)',
    '|messageMove|messageCopy|messageDelete',
    '|mailbox(Create|Delete|Rename|Subscribe|Unsubscribe)',
    '|append|setFlagColor',
    ')\\s*\\(',
  ].join(''),
  'g',
);
const mailboxOpen = /\.mailboxOpen\s*\(([^)]*)\)/g;

async function sources(): Promise<Map<string, string>> {
  const entries = await readdir(SRC, { recursive: true });
  const files = entries.filter((entry) => /\.[cm]?[jt]s$/.test(entry)).sort();
  const out = new Map<string, string>();
  for (const file of files) {
    out.set(file.split(path.sep).join('/'), await readFile(path.join(SRC, file), 'utf8'));
  }
  return out;
}

describe('read-only ingest (T-02-31, D-11)', () => {
  it('no source file outside the probe calls an ImapFlow write method', async () => {
    const offenders: string[] = [];
    for (const [file, text] of await sources()) {
      if (file === PROBE) continue;
      for (const match of text.matchAll(mutatingCall)) offenders.push(`${file}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every mailboxOpen outside the probe is read-only', async () => {
    const opens: string[] = [];
    for (const [file, text] of await sources()) {
      if (file === PROBE) continue;
      for (const match of text.matchAll(mailboxOpen)) {
        opens.push(`${file}: ${/readOnly:\s*true/.test(match[1] ?? '') ? 'readOnly' : match[0]}`);
      }
    }
    expect(opens).toEqual(['imap/folder-source.ts: readOnly']);
  });

  it('the patterns catch the probe write calls they exist to ban', async () => {
    const probe = (await sources()).get(PROBE) ?? '';
    const found = [...probe.matchAll(mutatingCall)].map((match) => match[1]);
    expect(found).toEqual(
      expect.arrayContaining(['mailboxCreate', 'messageCopy', 'messageDelete']),
    );
    const writable = [...probe.matchAll(mailboxOpen)].filter(
      (match) => !/readOnly:\s*true/.test(match[1] ?? ''),
    );
    expect(writable.length).toBeGreaterThan(0);
  });
});
