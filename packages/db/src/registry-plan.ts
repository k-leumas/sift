import type { MailboxConfig, SiftConfig } from '@sift/core/config';
import type { MailboxRow } from './schema/index.ts';

/**
 * Pure diff between config.yaml and the mailbox registry (D-32, D-34).
 * `sift config apply` executes the plan; the worker's drift check only needs
 * to know whether it is empty. This module imports types only, so loading it
 * pulls in no database driver.
 */

/** Registry columns that config.yaml controls. */
export type RegistryField =
  | 'display_name'
  | 'imap_host'
  | 'imap_port'
  | 'imap_username'
  | 'imap_folder'
  | 'password_env'
  | 'labels_apply_as';

export interface FieldChange {
  field: RegistryField;
  from: string | number | null;
  to: string | number | null;
}

/** The registry values one config entry stands for. */
export interface MailboxValues {
  slug: string;
  displayName: string | null;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapFolder: string;
  passwordEnv: string;
  labelsApplyAs: string;
}

export type RegistryChange =
  | { kind: 'add'; slug: string; values: MailboxValues }
  | { kind: 'update'; slug: string; changes: FieldChange[] }
  | { kind: 'enable'; slug: string; changes: FieldChange[] }
  | { kind: 'disable'; slug: string };

export type RegistryRowLike = Pick<
  MailboxRow,
  | 'slug'
  | 'displayName'
  | 'imapHost'
  | 'imapPort'
  | 'imapUsername'
  | 'imapFolder'
  | 'passwordEnv'
  | 'labelsApplyAs'
  | 'disabledAt'
>;

/** Registry column -> MailboxValues key, in the order changes are reported. */
const FIELDS: readonly (readonly [RegistryField, Exclude<keyof MailboxValues, 'slug'>])[] = [
  ['display_name', 'displayName'],
  ['imap_host', 'imapHost'],
  ['imap_port', 'imapPort'],
  ['imap_username', 'imapUsername'],
  ['imap_folder', 'imapFolder'],
  ['password_env', 'passwordEnv'],
  ['labels_apply_as', 'labelsApplyAs'],
];

export function mailboxValuesFromConfig(m: MailboxConfig): MailboxValues {
  return {
    slug: m.slug,
    displayName: m.display_name ?? null,
    imapHost: m.imap.host,
    imapPort: m.imap.port,
    imapUsername: m.imap.username,
    imapFolder: m.imap.folder,
    passwordEnv: m.imap.password_env,
    labelsApplyAs: m.labels.apply_as,
  };
}

function fieldChanges(row: RegistryRowLike, values: MailboxValues): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, key] of FIELDS) {
    const from = row[key];
    const to = values[key];
    if (from !== to) changes.push({ field, from, to });
  }
  return changes;
}

/**
 * Changes that make the registry match config. Config entries come first in
 * config order (add, update or enable), then disables in slug order. Rows that
 * are already disabled and absent from config produce nothing. An empty result
 * means the registry matches config.
 */
export function planRegistryChanges(
  config: SiftConfig,
  rows: readonly RegistryRowLike[],
): RegistryChange[] {
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const configured = new Set<string>();
  const changes: RegistryChange[] = [];

  for (const mailbox of config.mailboxes) {
    const values = mailboxValuesFromConfig(mailbox);
    configured.add(values.slug);
    const row = bySlug.get(values.slug);
    if (row === undefined) {
      changes.push({ kind: 'add', slug: values.slug, values });
      continue;
    }
    const diff = fieldChanges(row, values);
    if (row.disabledAt !== null) {
      changes.push({ kind: 'enable', slug: values.slug, changes: diff });
    } else if (diff.length > 0) {
      changes.push({ kind: 'update', slug: values.slug, changes: diff });
    }
  }

  const removed = rows
    .filter((row) => !configured.has(row.slug) && row.disabledAt === null)
    .map((row) => row.slug)
    .sort();
  for (const slug of removed) changes.push({ kind: 'disable', slug });

  return changes;
}

/**
 * A slug that disappears while another appears in the same apply may be a
 * rename typed into config.yaml (D-33). Returns both lists when there is at
 * least one disable and at least one add, otherwise null.
 */
export function findRenameSuspects(
  changes: readonly RegistryChange[],
): { removed: string[]; added: string[] } | null {
  const removed = changes.filter((c) => c.kind === 'disable').map((c) => c.slug);
  const added = changes.filter((c) => c.kind === 'add').map((c) => c.slug);
  return removed.length > 0 && added.length > 0 ? { removed, added } : null;
}

function formatValue(value: string | number | null): string {
  if (value === null) return '(none)';
  return typeof value === 'number' ? String(value) : JSON.stringify(value);
}

function formatChanges(changes: readonly FieldChange[]): string {
  return changes.map((c) => `${c.field} ${formatValue(c.from)} -> ${formatValue(c.to)}`).join(', ');
}

/** One line per change for the owner. Values are registry data, never secrets. */
export function describeChange(change: RegistryChange): string {
  switch (change.kind) {
    case 'add':
      return `add mailbox "${change.slug}"`;
    case 'update':
      return `update mailbox "${change.slug}": ${formatChanges(change.changes)}`;
    case 'enable':
      return change.changes.length === 0
        ? `re-enable mailbox "${change.slug}"`
        : `re-enable mailbox "${change.slug}": ${formatChanges(change.changes)}`;
    case 'disable':
      return `disable mailbox "${change.slug}" (no longer in config.yaml; its data is kept)`;
  }
}
