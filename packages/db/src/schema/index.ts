import type { mailbox } from './mailbox.ts';

export { mailbox } from './mailbox.ts';
export { promptVersion } from './prompt-version.ts';
export {
  decision,
  folderSync,
  label,
  labelEvent,
  type MessageAttachment,
  mailboxStatus,
  message,
  messageBody,
  messageLocation,
  type ResyncSummary,
  type RuleSetSnapshot,
  ruleSet,
} from './scoped.ts';

/** Every mailbox-scoped table: NOT NULL mailbox_id, forced RLS, one policy. */
export const SCOPED_TABLE_NAMES = [
  'mailbox_status',
  'message',
  'message_location',
  'message_body',
  'label',
  'decision',
  'folder_sync',
  'label_event',
  'rule_set',
] as const;

/**
 * Scoped tables where sift_app may only SELECT and INSERT (D-40): decision
 * traces, label events and the rule-set snapshots decisions replay against
 * (D-03).
 */
export const APPEND_ONLY_TABLE_NAMES = ['decision', 'label_event', 'rule_set'] as const;

/** The fixed mailbox registry column set (D-06, asserted by the catalog test). */
export const MAILBOX_COLUMNS = [
  'id',
  'slug',
  'display_name',
  'imap_host',
  'imap_port',
  'imap_username',
  'imap_folder',
  'password_env',
  'labels_apply_as',
  'disabled_at',
  'created_at',
  'updated_at',
] as const;

export type MailboxRow = typeof mailbox.$inferSelect;
