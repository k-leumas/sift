import { createLogger, REDACT_PATHS, redactText } from '@sift/core/log';
import { describe, expect, it } from 'vitest';

function capture(level?: string) {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    destination: { write: (line: string) => lines.push(line) },
  });
  return { logger, lines };
}

describe('createLogger (D-23)', () => {
  it('censors password and connectionString fields at every listed depth', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        password: 's1',
        db: { connectionString: 'postgres://u:p@h/d' },
        nested: { deeper: { password: 's2' } },
        secret: 's4',
        token: 's5',
      },
      'connecting',
    );
    expect(lines).toHaveLength(1);
    const output = lines.join('');
    const entry = JSON.parse(output);
    expect(entry.password).toBe('[REDACTED]');
    expect(entry.db.connectionString).toBe('[REDACTED]');
    expect(entry.nested.deeper.password).toBe('[REDACTED]');
    expect(entry.secret).toBe('[REDACTED]');
    expect(entry.token).toBe('[REDACTED]');
    for (const value of ['s1', 's2', 's4', 's5', ':p@']) {
      expect(output).not.toContain(value);
    }
  });

  it('writes JSON with the sift service name', () => {
    const { logger, lines } = capture();
    logger.info('hello');
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.service).toBe('sift');
    expect(entry.msg).toBe('hello');
  });

  it('honours the level option', () => {
    const { logger, lines } = capture('warn');
    logger.info('hidden');
    logger.warn('shown');
    expect(lines).toHaveLength(1);
  });

  it('lists the password, secret, token and connectionString paths', () => {
    for (const path of [
      'password',
      '*.password',
      '*.*.password',
      'secret',
      '*.secret',
      'token',
      '*.token',
      'connectionString',
      '*.connectionString',
      '*.*.connectionString',
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});

describe('redactText', () => {
  it('replaces secret values and postgres URL passwords', () => {
    expect(redactText('login failed for s3cr3t at postgres://u:pw@h/db', ['s3cr3t'])).toBe(
      'login failed for [REDACTED] at postgres://u:[REDACTED]@h/db',
    );
  });

  it('masks postgresql:// URLs and every occurrence of a secret', () => {
    expect(redactText('a.b a.b postgresql://owner:x%40y@db:5432/sift', ['a.b'])).toBe(
      '[REDACTED] [REDACTED] postgresql://owner:[REDACTED]@db:5432/sift',
    );
  });

  it('treats secrets literally, never as patterns', () => {
    expect(redactText('cost is $1.00 (.*)', ['(.*)', '$1'])).toBe(
      'cost is [REDACTED].00 [REDACTED]',
    );
  });

  it('ignores empty secrets', () => {
    expect(redactText('unchanged', ['', '   '])).toBe('unchanged');
  });
});
