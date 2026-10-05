import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseConfigText } from '@sift/core/config';
import { describe, expect, it } from 'vitest';

const EXAMPLE = fileURLToPath(new URL('../../../config/config.example.yaml', import.meta.url));
const CLI = fileURLToPath(new URL('../../../apps/worker/src/cli.ts', import.meta.url));

describe('config/config.example.yaml (D-61)', () => {
  it('validates with the real schema', async () => {
    const result = await loadConfig(EXAMPLE);
    if (!result.ok) throw new Error(`example config is invalid: ${JSON.stringify(result.issues)}`);
    expect(result.config.mailboxes.map((m) => m.slug)).toEqual(['personal', 'job-search']);
    expect(result.config.worker.poll_interval_seconds).toBe(60);
    expect(result.config.models.url).toBe('http://host.docker.internal:11434');
  });

  it('targets the Compose bridge service with the D-74 defaults on every mailbox (D-29)', async () => {
    const result = await loadConfig(EXAMPLE);
    if (!result.ok) throw new Error(`example config is invalid: ${JSON.stringify(result.issues)}`);
    expect(result.config.version).toBe(1);
    for (const mailbox of result.config.mailboxes) {
      expect(mailbox.imap.host).toBe('bridge');
      expect(mailbox.imap.port).toBe(1143);
      expect(mailbox.imap.tls).toEqual({ mode: 'starttls' });
      expect(mailbox.ingest).toEqual({ initial_backfill_days: 30, new_mail_cap: 200 });
    }
  });

  it('places each commented pin_sha256 line inside a tls block, ready to uncomment', () => {
    const lines = readFileSync(EXAMPLE, 'utf8').split('\n');
    const indent = (line: string) => line.length - line.trimStart().length;
    const pinLines = lines.flatMap((line, index) =>
      /^\s*# pin_sha256:/.test(line) ? [index] : [],
    );
    expect(pinLines).toHaveLength(2);

    for (const index of pinLines) {
      const pinIndent = indent(lines[index] ?? '');
      // The enclosing key is the nearest line above that is indented less.
      let parent = index - 1;
      while (
        parent >= 0 &&
        (lines[parent]?.trim() === '' || indent(lines[parent] ?? '') >= pinIndent)
      ) {
        parent -= 1;
      }
      expect(lines[parent]?.trim()).toBe('tls:');
      expect(indent(lines[parent] ?? '')).toBeLessThan(pinIndent);
      // Its sibling `mode:` sits at the same depth, so uncommenting yields tls.pin_sha256.
      const siblings = lines
        .slice(parent + 1, index)
        .filter((line) => !line.trim().startsWith('#'));
      expect(siblings.map((line) => [line.trim(), indent(line)])).toEqual([
        ['mode: starttls', pinIndent],
      ]);
    }
  });

  it('parses a copy with the pin lines uncommented to the pasted fingerprint', () => {
    const pin = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';
    const text = readFileSync(EXAMPLE, 'utf8').replace(
      /^(\s*)# pin_sha256:.*$/gm,
      (_line, lead: string) => `${lead}pin_sha256: ${pin}`,
    );
    const result = parseConfigText(text, 'config.example.yaml');
    if (!result.ok)
      throw new Error(`uncommented example is invalid: ${JSON.stringify(result.issues)}`);
    expect(result.config.mailboxes.map((m) => m.imap.tls)).toEqual([
      { mode: 'starttls', pin_sha256: pin },
      { mode: 'starttls', pin_sha256: pin },
    ]);
  });

  it('passes `sift config check --schema-only`', () => {
    const run = spawnSync(process.execPath, [CLI, 'config', 'check', '--schema-only'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SIFT_CONFIG: EXAMPLE },
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^Config OK: 2 mailboxes/);
  });

  it('reports a missing config file and exits 1', () => {
    const run = spawnSync(process.execPath, [CLI, 'config', 'check', '--schema-only'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SIFT_CONFIG: '/nonexistent/sift/config.yaml' },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('config file not found');
  });
});
