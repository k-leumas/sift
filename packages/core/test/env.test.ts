import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyEnvOverrides,
  checkMailboxEnv,
  formatPath,
  parseConfigText,
  type SiftConfig,
  secretValues,
} from '@sift/core/config';
import { describe, expect, it } from 'vitest';

const EXAMPLE = fileURLToPath(new URL('../../../config/config.example.yaml', import.meta.url));
const CLI = fileURLToPath(new URL('../../../apps/worker/src/cli.ts', import.meta.url));

/** A value that must never appear in any message. */
const SENTINEL = 'sentinel-Zq9!value';

function configWith(mailboxes: { slug: string; passwordEnv: string }[]): SiftConfig {
  const items = mailboxes.map((m, index) =>
    [
      `  - slug: ${m.slug}`,
      '    imap:',
      '      host: protonmail-bridge',
      '      port: 1143',
      `      username: user${index}@proton.me`,
      `      password_env: ${m.passwordEnv}`,
      '    labels:',
      '      apply_as: proton_labels',
    ].join('\n'),
  );
  const text = [
    'version: 1',
    'mailboxes:',
    ...items,
    'models:',
    '  provider: ollama',
    '  embeddings: nomic-embed-text',
    '  llm: qwen3:1.7b',
    '',
  ].join('\n');
  const result = parseConfigText(text, 'config.yaml');
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.config;
}

const THREE = configWith([
  { slug: 'personal', passwordEnv: 'SIFT_PERSONAL_IMAP_PASSWORD' },
  { slug: 'job-search', passwordEnv: 'SIFT_JOBS_IMAP_PASSWORD' },
  { slug: 'side', passwordEnv: 'SIFT_SIDE_IMAP_PASSWORD' },
]);

describe('checkMailboxEnv (D-35)', () => {
  it('passes when every password_env variable is set', () => {
    const env = {
      SIFT_PERSONAL_IMAP_PASSWORD: 'a',
      SIFT_JOBS_IMAP_PASSWORD: 'b',
      SIFT_SIDE_IMAP_PASSWORD: 'c',
    };
    expect(checkMailboxEnv(THREE, env)).toEqual({ ok: true });
  });

  it('reports every missing variable in one line, in config order', () => {
    const check = checkMailboxEnv(THREE, { SIFT_PERSONAL_IMAP_PASSWORD: SENTINEL });
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toBe(
      'Missing env vars: SIFT_JOBS_IMAP_PASSWORD (mailbox "job-search"), SIFT_SIDE_IMAP_PASSWORD (mailbox "side")',
    );
    expect(check.missing).toEqual([
      { name: 'SIFT_JOBS_IMAP_PASSWORD', slugs: ['job-search'] },
      { name: 'SIFT_SIDE_IMAP_PASSWORD', slugs: ['side'] },
    ]);
    expect(JSON.stringify(check)).not.toContain(SENTINEL);
  });

  it('lists a variable shared by two mailboxes once', () => {
    const config = configWith([
      { slug: 'a', passwordEnv: 'SIFT_SHARED' },
      { slug: 'b', passwordEnv: 'SIFT_SHARED' },
    ]);
    const check = checkMailboxEnv(config, {});
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toBe('Missing env vars: SIFT_SHARED (mailboxes "a", "b")');
  });

  it.each(['', '   ', '\t\n'])('treats %j as missing', (value) => {
    const config = configWith([{ slug: 'a', passwordEnv: 'SIFT_A' }]);
    const check = checkMailboxEnv(config, { SIFT_A: value });
    expect(check.ok).toBe(false);
  });
});

describe('applyEnvOverrides (D-60)', () => {
  it('replaces models.url with SIFT_MODELS_URL', () => {
    const result = applyEnvOverrides(THREE, { SIFT_MODELS_URL: 'http://localhost:11434' });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.config.models.url).toBe('http://localhost:11434');
    expect(THREE.models.url).toBe('http://host.docker.internal:11434');
  });

  it('keeps models.url when SIFT_MODELS_URL is unset or blank', () => {
    for (const env of [{}, { SIFT_MODELS_URL: '  ' }]) {
      const result = applyEnvOverrides(THREE, env);
      if (!result.ok) throw new Error(JSON.stringify(result.issues));
      expect(result.config.models.url).toBe('http://host.docker.internal:11434');
    }
  });

  it('rejects an invalid SIFT_MODELS_URL without echoing it', () => {
    const result = applyEnvOverrides(THREE, { SIFT_MODELS_URL: 'not a url' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => formatPath(issue.path))).toEqual(['env.SIFT_MODELS_URL']);
    expect(JSON.stringify(result.issues)).not.toContain('not a url');
  });
});

describe('secretValues', () => {
  it('returns only the non-blank values of password_env variables', () => {
    const values = secretValues(THREE, {
      SIFT_PERSONAL_IMAP_PASSWORD: 'p1',
      SIFT_JOBS_IMAP_PASSWORD: '  ',
      OTHER_VAR: 'not-a-secret',
    });
    expect(values).toEqual(['p1']);
  });
});

describe('sift config check env step', () => {
  function check(env: Record<string, string>, ...args: string[]) {
    return spawnSync(process.execPath, [CLI, 'config', 'check', ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SIFT_CONFIG: EXAMPLE, ...env },
    });
  }

  it('exits 1 with the D-35 line when password variables are missing', () => {
    const run = check({ SIFT_JOBS_IMAP_PASSWORD: '' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(
      /^Missing env vars: SIFT_PERSONAL_IMAP_PASSWORD \(mailbox "personal"\), SIFT_JOBS_IMAP_PASSWORD \(mailbox "job-search"\)/,
    );
  });

  it('exits 0 when the variables are present, never printing their values', () => {
    const run = check({ SIFT_PERSONAL_IMAP_PASSWORD: SENTINEL, SIFT_JOBS_IMAP_PASSWORD: 'y' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('password env vars present');
    expect(run.stdout + run.stderr).not.toContain(SENTINEL);
  });

  it('skips the presence check with --schema-only (D-67)', () => {
    const run = check({}, '--schema-only');
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('env vars not checked (--schema-only)');
  });

  it('rejects an invalid SIFT_MODELS_URL', () => {
    const run = check({ SIFT_MODELS_URL: 'ftp://nope' }, '--schema-only');
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('SIFT_MODELS_URL');
    expect(run.stderr).not.toContain('ftp://nope');
  });
});
