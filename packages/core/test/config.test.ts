import { type ConfigIssue, formatPath, imapIdentityKey, parseConfigText } from '@sift/core/config';
import { describe, expect, it } from 'vitest';

interface MailboxYaml {
  slug?: string;
  host?: string;
  port?: string;
  username?: string;
  passwordEnv?: string;
  folder?: string;
  /** Extra raw lines appended inside the imap mapping (6-space indent). */
  imapExtra?: string[];
}

/** One mailbox list item. Values are inserted raw, so tests control YAML quoting. */
function mailbox(m: MailboxYaml = {}): string {
  return [
    `  - slug: ${m.slug ?? 'personal'}`,
    '    imap:',
    `      host: ${m.host ?? 'protonmail-bridge'}`,
    `      port: ${m.port ?? '1143'}`,
    `      username: ${m.username ?? 'me@proton.me'}`,
    `      password_env: ${m.passwordEnv ?? 'SIFT_PERSONAL_IMAP_PASSWORD'}`,
    `      folder: ${m.folder ?? 'INBOX'}`,
    ...(m.imapExtra ?? []),
    '    labels:',
    '      apply_as: proton_labels',
  ].join('\n');
}

const MODELS = [
  'models:',
  '  provider: ollama',
  '  url: http://host.docker.internal:11434',
  '  embeddings: nomic-embed-text',
  '  llm: qwen3:1.7b',
].join('\n');

function configYaml(
  mailboxes: string[] = [mailbox()],
  options: { models?: string; worker?: string; head?: string } = {},
): string {
  return [
    options.head ?? 'version: 1',
    'mailboxes:',
    ...mailboxes,
    options.models ?? MODELS,
    options.worker ?? 'worker:\n  poll_interval_seconds: 60',
    '',
  ].join('\n');
}

function issuesOf(text: string): ConfigIssue[] {
  const result = parseConfigText(text, 'config.yaml');
  if (result.ok) throw new Error('expected the config to be rejected');
  return result.issues;
}

function expectValid(text: string): void {
  const result = parseConfigText(text, 'config.yaml');
  if (!result.ok) throw new Error(`expected a valid config: ${JSON.stringify(result.issues)}`);
}

/** Messages of the issues located at `path` (YAML-style, e.g. `mailboxes[0].slug`). */
function messagesAt(text: string, path: string): string[] {
  return issuesOf(text)
    .filter((issue) => formatPath(issue.path) === path)
    .map((issue) => issue.message);
}

function slugMessages(slug: string): string[] {
  return messagesAt(configYaml([mailbox({ slug })]), 'mailboxes[0].slug');
}

describe('slug rules (D-63)', () => {
  it.each(['personal', 'job-search', 'side2', 'a'.repeat(40)])('accepts %s', (slug) => {
    expectValid(configYaml([mailbox({ slug })]));
  });

  it.each(['"jobs-"', '"-jobs"', 'job--search'])('rejects %s with the pattern message', (slug) => {
    const [message] = slugMessages(slug);
    expect(message).toContain('slugs may contain only a-z, 0-9 and single hyphens');
  });

  it('rejects Personal with "slugs must be lowercase" and never fixes it', () => {
    const [message] = slugMessages('Personal');
    expect(message).toContain('slugs must be lowercase');
    expect(message).toContain('"Personal"');
  });

  it('rejects non-ASCII slugs without normalising them', () => {
    const [message] = slugMessages('café');
    expect(message).toContain('slugs may contain only a-z, 0-9 and single hyphens');
  });

  it('accepts 40 characters and rejects 41 with "slug too long"', () => {
    expect(slugMessages('b'.repeat(41))[0]).toContain('slug too long (41 characters, max 40)');
  });

  it.each(['all', 'new', 'settings', 'shared'])('rejects the reserved slug %s', (slug) => {
    expect(slugMessages(slug)[0]).toContain(`slug "${slug}" is reserved`);
  });

  it('tells the owner to quote an unquoted numeric slug', () => {
    const [message] = slugMessages('2024');
    expect(message).toContain('quote it');
    expect(message).toContain('"2024"');
  });

  it('rejects a duplicate slug and names both mailboxes', () => {
    const text = configYaml([
      mailbox({ slug: 'personal', username: 'a@x' }),
      mailbox({ slug: 'personal', username: 'b@x' }),
    ]);
    const [message] = messagesAt(text, 'mailboxes[1].slug');
    expect(message).toContain('duplicate slug "personal"');
    expect(message).toContain('mailboxes[0]');
  });
});

describe('numeric boundaries', () => {
  it.each(['1', '65535'])('accepts port %s', (port) => {
    expectValid(configYaml([mailbox({ port })]));
  });

  it.each(['0', '65536', '1143.5', '"1143"'])('rejects port %s without coercion', (port) => {
    expect(messagesAt(configYaml([mailbox({ port })]), 'mailboxes[0].imap.port')).toHaveLength(1);
  });

  it.each(['10', '3600'])('accepts poll_interval_seconds %s', (value) => {
    expectValid(configYaml(undefined, { worker: `worker:\n  poll_interval_seconds: ${value}` }));
  });

  it.each(['9', '3601', '60.5'])('rejects poll_interval_seconds %s', (value) => {
    const text = configYaml(undefined, { worker: `worker:\n  poll_interval_seconds: ${value}` });
    expect(messagesAt(text, 'worker.poll_interval_seconds')).toHaveLength(1);
  });
});

describe('password_env and duplicate mailboxes (D-62, D-64)', () => {
  it('rejects a lowercase password_env name', () => {
    const text = configYaml([mailbox({ passwordEnv: 'lowercase_name' })]);
    expect(messagesAt(text, 'mailboxes[0].imap.password_env')[0]).toContain('^[A-Z_][A-Z0-9_]*$');
  });

  it('allows two mailboxes to share one password_env', () => {
    expectValid(
      configYaml([
        mailbox({ slug: 'a', username: 'a@x', passwordEnv: 'SIFT_SHARED' }),
        mailbox({ slug: 'b', username: 'b@x', passwordEnv: 'SIFT_SHARED' }),
      ]),
    );
  });

  it('rejects the same host + username + folder, comparing case-insensitively', () => {
    const text = configYaml([
      mailbox({ slug: 'a', host: 'Bridge', username: 'Me@x', folder: 'inbox' }),
      mailbox({ slug: 'b', host: 'bridge', username: 'me@x', folder: 'INBOX' }),
    ]);
    const messages = issuesOf(text).map((issue) => issue.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('mailboxes[0] and mailboxes[1] read the same IMAP mailbox');
    expect(messages[0]).toContain('this would process mail twice');
  });

  it('allows the same account on different folders', () => {
    expectValid(
      configYaml([
        mailbox({ slug: 'a', folder: 'Archive' }),
        mailbox({ slug: 'b', folder: 'INBOX' }),
      ]),
    );
  });

  it('rejects the same account when values differ only by surrounding spaces (IN-01)', () => {
    // The schema stores trimmed values, so these two entries would be identical.
    const text = configYaml([
      mailbox({ slug: 'a', host: '"bridge "', username: '" me@x"', folder: '" INBOX "' }),
      mailbox({ slug: 'b', host: 'bridge', username: 'me@x', folder: 'INBOX' }),
    ]);
    const messages = issuesOf(text).map((issue) => issue.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('mailboxes[0] and mailboxes[1] read the same IMAP mailbox');
  });

  it('builds one identity key for trimmed, case-folded host and username (IN-01)', () => {
    expect(imapIdentityKey(' Bridge ', 'Me@X ', ' inbox')).toBe(
      imapIdentityKey('bridge', 'me@x', 'INBOX'),
    );
    expect(imapIdentityKey('bridge', 'me@x', ' Archive ')).toBe(
      imapIdentityKey('bridge', 'me@x', 'Archive'),
    );
    expect(imapIdentityKey('bridge', 'me@x', 'Archive')).not.toBe(
      imapIdentityKey('bridge', 'me@x', 'archive'),
    );
  });

  it('compares folders other than INBOX exactly', () => {
    expectValid(
      configYaml([
        mailbox({ slug: 'a', folder: 'Archive' }),
        mailbox({ slug: 'b', folder: 'archive' }),
      ]),
    );
  });
});

describe('literal secrets (D-57)', () => {
  it('rejects imap.password without echoing its value', () => {
    const text = configYaml([mailbox({ imapExtra: ['      password: hunter2'] })]);
    const issues = issuesOf(text);
    expect(issues).toHaveLength(1);
    expect(formatPath(issues[0]?.path ?? [])).toBe('mailboxes[0].imap.password');
    expect(issues[0]?.message).toContain('looks like a secret');
    expect(issues[0]?.message).toContain('password_env');
    expect(issues[0]?.line).toBe(10);
    expect(JSON.stringify(issues)).not.toContain('hunter2');
  });

  it('rejects a top-level token without echoing its value', () => {
    const issues = issuesOf(configYaml(undefined, { head: 'version: 1\ntoken: abc' }));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('looks like a secret');
    expect(JSON.stringify(issues)).not.toContain('abc');
  });

  it('rejects models.api_key without echoing its value', () => {
    const issues = issuesOf(configYaml(undefined, { models: `${MODELS}\n  api_key: x` }));
    expect(issues).toHaveLength(1);
    expect(formatPath(issues[0]?.path ?? [])).toBe('models.api_key');
    expect(issues[0]?.message).toContain('password_env');
    expect(JSON.stringify(issues)).not.toMatch(/\bx\b/);
  });
});

describe('structure', () => {
  it('reports an unknown key with its line number', () => {
    const text = configYaml([mailbox({ imapExtra: ['      starttls: true'] })]);
    const issues = issuesOf(text);
    expect(issues).toHaveLength(1);
    expect(formatPath(issues[0]?.path ?? [])).toBe('mailboxes[0].imap.starttls');
    expect(issues[0]?.message).toContain('unrecognized key');
    expect(issues[0]?.line).toBe(10);
    expect(issues[0]?.column).toBe(7);
  });

  it('rejects an empty file', () => {
    expect(issuesOf('')[0]?.message).toContain('config file is empty');
    expect(issuesOf('# nothing here\n')[0]?.message).toContain('config file is empty');
  });

  it('rejects a file with only version: 1, naming what is missing', () => {
    const messages = issuesOf('version: 1\n').map((issue) => issue.message);
    expect(messages).toContain('mailboxes is required: add at least one mailbox');
    expect(messages).toContain('models is required');
  });

  it('rejects an empty mailbox list', () => {
    const text = `version: 1\nmailboxes: []\n${MODELS}\n`;
    expect(messagesAt(text, 'mailboxes')[0]).toContain('at least one mailbox');
  });

  it('rejects version 2 and a missing version, naming the supported version', () => {
    expect(messagesAt(configYaml(undefined, { head: 'version: 2' }), 'version')[0]).toBe(
      'unsupported config version 2; this Sift build supports version 1',
    );
    expect(messagesAt(configYaml(undefined, { head: '' }), 'version')[0]).toBe(
      'version is required (this Sift build supports version 1)',
    );
  });

  it('returns every issue of a multi-error file together', () => {
    const text = configYaml(
      [
        mailbox({ slug: 'Personal', port: '"1143"', imapExtra: ['      password: hunter2'] }),
        mailbox({ slug: 'dup', username: 'a@x' }),
        mailbox({ slug: 'dup', username: 'b@x', imapExtra: ['      tls: true'] }),
      ],
      { head: 'version: 2', worker: 'worker:\n  poll_interval_seconds: 5' },
    );
    const paths = issuesOf(text).map((issue) => formatPath(issue.path));
    expect(paths).toEqual(
      expect.arrayContaining([
        'version',
        'mailboxes[0].slug',
        'mailboxes[0].imap.port',
        'mailboxes[0].imap.password',
        'mailboxes[2].slug',
        'mailboxes[2].imap.tls',
        'worker.poll_interval_seconds',
      ]),
    );
    expect(JSON.stringify(issuesOf(text))).not.toContain('hunter2');
  });
});
