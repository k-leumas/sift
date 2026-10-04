import type { MailboxConfig, SiftConfig } from '@sift/core/config';
import { describe, expect, it } from 'vitest';
import {
  describeChange,
  findRenameSuspects,
  mailboxValuesFromConfig,
  planRegistryChanges,
  type RegistryRowLike,
} from '../src/registry-plan.ts';

function mailbox(slug: string, imap: Partial<MailboxConfig['imap']> = {}): MailboxConfig {
  return {
    slug,
    display_name: `Mailbox ${slug}`,
    imap: {
      host: 'protonmail-bridge',
      port: 1143,
      username: `${slug}@proton.me`,
      password_env: 'SIFT_TEST_IMAP_PASSWORD',
      folder: 'INBOX',
      ...imap,
    },
    labels: { apply_as: 'proton_labels' },
  };
}

function config(...mailboxes: MailboxConfig[]): SiftConfig {
  return {
    version: 1,
    mailboxes,
    models: {
      provider: 'ollama',
      url: 'http://localhost:11434',
      embeddings: 'nomic-embed-text',
      llm: 'qwen3:1.7b',
    },
    worker: { poll_interval_seconds: 60 },
  };
}

function row(m: MailboxConfig, disabledAt: Date | null = null): RegistryRowLike {
  const { slug: _slug, ...values } = mailboxValuesFromConfig(m);
  return { slug: m.slug, ...values, disabledAt };
}

describe('planRegistryChanges', () => {
  it('returns no changes when the registry matches config', () => {
    const personal = mailbox('personal');
    const jobs = mailbox('jobs');
    expect(planRegistryChanges(config(personal, jobs), [row(jobs), row(personal)])).toEqual([]);
  });

  it('reports a changed port as one update', () => {
    const before = mailbox('personal');
    const after = mailbox('personal', { port: 1144 });
    const changes = planRegistryChanges(config(after), [row(before)]);
    expect(changes).toEqual([
      { kind: 'update', slug: 'personal', changes: [{ field: 'imap_port', from: 1143, to: 1144 }] },
    ]);
    expect(changes.map(describeChange)).toEqual([
      'update mailbox "personal": imap_port 1143 -> 1144',
    ]);
  });

  it('adds a config slug that has no row', () => {
    const side = mailbox('side');
    const changes = planRegistryChanges(config(side), []);
    expect(changes).toEqual([{ kind: 'add', slug: 'side', values: mailboxValuesFromConfig(side) }]);
    expect(describeChange(changes[0] ?? { kind: 'disable', slug: '?' })).toBe('add mailbox "side"');
  });

  it('disables an enabled row that is no longer in config', () => {
    const personal = mailbox('personal');
    const changes = planRegistryChanges(config(personal), [row(personal), row(mailbox('jobs'))]);
    expect(changes).toEqual([{ kind: 'disable', slug: 'jobs' }]);
    expect(changes.map(describeChange)).toEqual([
      'disable mailbox "jobs" (no longer in config.yaml; its data is kept)',
    ]);
  });

  it('re-enables a disabled row that is back in config', () => {
    const jobs = mailbox('jobs');
    const changes = planRegistryChanges(config(jobs), [row(jobs, new Date())]);
    expect(changes).toEqual([{ kind: 'enable', slug: 'jobs', changes: [] }]);
    expect(changes.map(describeChange)).toEqual(['re-enable mailbox "jobs"']);
  });

  it('leaves a disabled row that is still absent from config alone', () => {
    const personal = mailbox('personal');
    expect(
      planRegistryChanges(config(personal), [row(personal), row(mailbox('jobs'), new Date())]),
    ).toEqual([]);
  });

  it('orders config entries first, then disables by slug', () => {
    const changes = planRegistryChanges(config(mailbox('zeta'), mailbox('alpha')), [
      row(mailbox('old-b')),
      row(mailbox('old-a')),
    ]);
    expect(changes.map((c) => `${c.kind}:${c.slug}`)).toEqual([
      'add:zeta',
      'add:alpha',
      'disable:old-a',
      'disable:old-b',
    ]);
  });

  it('stores password_env as the variable name only', () => {
    const values = mailboxValuesFromConfig(mailbox('personal'));
    expect(values.passwordEnv).toBe('SIFT_TEST_IMAP_PASSWORD');
  });
});

describe('findRenameSuspects', () => {
  it('flags one disable next to one add', () => {
    const changes = planRegistryChanges(config(mailbox('job-search')), [row(mailbox('jobs'))]);
    expect(findRenameSuspects(changes)).toEqual({
      removed: ['jobs'],
      added: ['job-search'],
      pairs: [{ from: 'jobs', to: 'job-search' }],
    });
  });

  it('flags a lone pair whose IMAP identity differs, and only then (IN-09)', () => {
    const rows = [row(mailbox('jobs', { username: 'jobs@proton.me' }))];
    const other = planRegistryChanges(
      config(mailbox('side', { username: 'side@proton.me' })),
      rows,
    );
    expect(findRenameSuspects(other, rows)?.pairs).toEqual([
      { from: 'jobs', to: 'side', identityDiffers: true },
    ]);

    const same = planRegistryChanges(
      config(mailbox('job-search', { username: 'Jobs@Proton.me' })),
      rows,
    );
    const pairs = findRenameSuspects(same, rows)?.pairs;
    expect(pairs).toEqual([{ from: 'jobs', to: 'job-search' }]);
    expect(pairs?.[0]).not.toHaveProperty('identityDiffers');
  });

  it('pairs several renames by IMAP identity, not by position (WR-05)', () => {
    const alpha = mailbox('alpha', { username: 'a@proton.me' });
    const beta = mailbox('beta', { username: 'b@proton.me' });
    // Config order puts B's new slug first; removed slugs are sorted.
    const gamma = mailbox('gamma', { username: 'b@proton.me' });
    const zeta = mailbox('zeta', { username: 'A@Proton.me' });
    const rows = [row(alpha), row(beta)];
    const changes = planRegistryChanges(config(gamma, zeta), rows);
    expect(findRenameSuspects(changes, rows)).toEqual({
      removed: ['alpha', 'beta'],
      added: ['gamma', 'zeta'],
      pairs: [
        { from: 'alpha', to: 'zeta' },
        { from: 'beta', to: 'gamma' },
      ],
    });
  });

  it('pairs by the same identity as the D-64 duplicate check: INBOX in any case (IN-01)', () => {
    const alpha = mailbox('alpha', { username: 'a@proton.me', folder: 'INBOX' });
    const beta = mailbox('beta', { username: 'b@proton.me' });
    const zeta = mailbox('zeta', { username: 'a@proton.me', folder: 'inbox' });
    const gamma = mailbox('gamma', { username: 'b@proton.me' });
    const rows = [row(alpha), row(beta)];
    const changes = planRegistryChanges(config(zeta, gamma), rows);
    expect(findRenameSuspects(changes, rows)?.pairs).toEqual([
      { from: 'alpha', to: 'zeta' },
      { from: 'beta', to: 'gamma' },
    ]);
  });

  it('suggests no pair when several slugs change and no IMAP identity matches', () => {
    const rows = [row(mailbox('alpha')), row(mailbox('beta'))];
    const changes = planRegistryChanges(config(mailbox('gamma'), mailbox('zeta')), rows);
    expect(findRenameSuspects(changes, rows)?.pairs).toEqual([]);
  });

  it('suggests no pair when an identity matches more than one slug', () => {
    const shared = { username: 'shared@proton.me' };
    const rows = [row(mailbox('alpha', shared)), row(mailbox('beta', shared))];
    const changes = planRegistryChanges(
      config(mailbox('gamma', shared), mailbox('zeta', { username: 'z@proton.me' })),
      rows,
    );
    expect(findRenameSuspects(changes, rows)?.pairs).toEqual([]);
  });

  it('returns null for adds only or disables only', () => {
    expect(findRenameSuspects(planRegistryChanges(config(mailbox('a'), mailbox('b')), []))).toBe(
      null,
    );
    const a = mailbox('a');
    expect(findRenameSuspects(planRegistryChanges(config(a), [row(a), row(mailbox('b'))]))).toBe(
      null,
    );
  });
});
