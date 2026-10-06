import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** Deferred mailbox hard-delete command (D-69). It must not appear in any CLI output. */
const DEFERRED_COMMAND = /purge/i;

function sift(...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('sift CLI shell', () => {
  it('--help exits 0 and lists every Phase 1 command', () => {
    const { status, stdout, stderr } = sift('--help');
    expect(status).toBe(0);
    for (const usage of [
      'sift setup [--confirm]',
      'sift migrate',
      'sift config check [--schema-only]',
      'sift config apply [--confirm]',
      'sift mailbox list',
      'sift mailbox rename <old-slug> <new-slug>',
      'sift mailbox resume <slug>',
      'sift mailbox backfill <slug> [--days <n>] [--yes]',
      'sift bridge probe <slug> [--label-test] [--uid <n>] [--wait-new-seconds <n>] ' +
        '[--compare <file|->] [--sample <n>] [--scan-limit <n>]',
      'sift bridge trust <slug>',
      'sift worker',
    ]) {
      expect(stdout).toContain(usage);
    }
    expect(stdout).toContain('Supported config version: 1');
    expect(stdout).not.toMatch(DEFERRED_COMMAND);
    expect(stderr).not.toMatch(DEFERRED_COMMAND);
  });

  it('-h and help print the same usage', () => {
    const help = sift('--help').stdout;
    expect(sift('-h').stdout).toBe(help);
    expect(sift('help').stdout).toBe(help);
  });

  it('exits 2 with usage on stderr when no command is given', () => {
    const { status, stdout, stderr } = sift();
    expect(status).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage: sift');
    expect(stderr).not.toMatch(DEFERRED_COMMAND);
  });

  it('exits 2 for an unknown command', () => {
    const { status, stdout, stderr } = sift('frobnicate');
    expect(status).toBe(2);
    expect(stderr).toContain('Unknown command');
    expect(stdout).not.toMatch(DEFERRED_COMMAND);
    expect(stderr).not.toMatch(DEFERRED_COMMAND);
  });
});
