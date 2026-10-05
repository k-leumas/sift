// Brings in the vitest ProvidedContext augmentation that types inject('testDb').
/// <reference path="../../../../packages/db/test/global-setup.ts" />
import { randomUUID } from 'node:crypto';
import type { MailboxConfig, SiftConfig } from '@sift/core/config';
import { connect } from '../../../../packages/db/test/support/db.ts';
import type { SupervisorLog } from '../../src/runtime/supervisor.ts';
import { TEST_IMAP } from './test-imap.ts';

/**
 * Shared pieces of the worker-callback tests (02-13): a config entry for a
 * test-server user, a recording log, and superuser reads of what a run left
 * in the database (bypassing RLS, test inspection only).
 */

export const E2E_PASSWORD_ENV = 'SIFT_E2E_IMAP_PASSWORD';

export function imapMailbox(
  slug: string,
  username: string,
  options: {
    pin?: string;
    port?: number;
    host?: string;
    initialBackfillDays?: number;
    newMailCap?: number;
    passwordEnv?: string;
  } = {},
): MailboxConfig {
  return {
    slug,
    imap: {
      host: options.host ?? TEST_IMAP.host,
      port: options.port ?? TEST_IMAP.port,
      username,
      password_env: options.passwordEnv ?? E2E_PASSWORD_ENV,
      folder: 'INBOX',
      tls:
        options.pin === undefined
          ? { mode: 'starttls' }
          : { mode: 'starttls', pin_sha256: options.pin },
    },
    ingest: {
      initial_backfill_days: options.initialBackfillDays ?? 0,
      new_mail_cap: options.newMailCap ?? 200,
    },
    labels: { apply_as: 'proton_labels' },
  };
}

export function siftConfig(...mailboxes: MailboxConfig[]): SiftConfig {
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

export interface LogLine {
  level: 'info' | 'warn' | 'error' | 'debug';
  obj: object;
  msg: string | undefined;
}

/** A SupervisorLog that keeps every line. */
export function recordingLog(): SupervisorLog & { lines: LogLine[]; messages(): string[] } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine['level']) =>
    (obj: object, msg?: string): void => {
      lines.push({ level, obj, msg });
    };
  return {
    lines,
    messages: () => lines.map((l) => l.msg ?? ''),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    debug: at('debug'),
  };
}

/** A small RFC 5322 message with a unique Message-ID. */
export function rawMessage(subject: string, body = `Body of ${subject}.`): string {
  return [
    'From: Sender <sender@example.test>',
    'To: Owner <owner@example.test>',
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@example.test>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
    '',
  ].join('\r\n');
}

export interface MailboxCounts {
  messages: number;
  /** Messages eligible for classification (new mail and the first backfill, D-21). */
  eligible: number;
  locations: number;
  liveLocations: number;
  bodies: number;
  /** Rows of message, message_location and message_body under any other mailbox_id. */
  foreign: number;
}

/** What a mailbox has stored, read as the superuser. */
export async function mailboxCounts(adminUrl: string, mailboxId: string): Promise<MailboxCounts> {
  const admin = await connect(adminUrl);
  try {
    const { rows } = await admin.query<MailboxCounts>(
      `select
         (select count(*)::int from message where mailbox_id = $1) as messages,
         (select count(*)::int from message
           where mailbox_id = $1 and eligible_for_classification) as eligible,
         (select count(*)::int from message_location where mailbox_id = $1) as locations,
         (select count(*)::int from message_location
           where mailbox_id = $1 and removed_at is null) as "liveLocations",
         (select count(*)::int from message_body where mailbox_id = $1) as bodies,
         (select count(*)::int from message where mailbox_id <> $1)
           + (select count(*)::int from message_location where mailbox_id <> $1)
           + (select count(*)::int from message_body where mailbox_id <> $1) as foreign`,
      [mailboxId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('mailboxCounts: no row');
    return row;
  } finally {
    await admin.end();
  }
}

export interface StatusRow {
  state: string | null;
  last_error: string | null;
  last_seen_at: Date | null;
  last_sync_at: Date | null;
  held_new_count: number | null;
  approved_new_count: number | null;
  backfill_done: number | null;
  backfill_total: number | null;
}

/** The mailbox's status row (all null when it has none), read as the superuser. */
export async function mailboxStatus(adminUrl: string, mailboxId: string): Promise<StatusRow> {
  const admin = await connect(adminUrl);
  try {
    const { rows } = await admin.query<StatusRow>(
      `select state, last_error, last_seen_at, last_sync_at, held_new_count,
              approved_new_count, backfill_done, backfill_total
         from mailbox_status where mailbox_id = $1`,
      [mailboxId],
    );
    return (
      rows[0] ?? {
        state: null,
        last_error: null,
        last_seen_at: null,
        last_sync_at: null,
        held_new_count: null,
        approved_new_count: null,
        backfill_done: null,
        backfill_total: null,
      }
    );
  } finally {
    await admin.end();
  }
}

export interface FolderSyncView {
  uidvalidity: number;
  generation: number;
  state: string;
  last_uid: number;
  last_resync_summary: { matched: number; new: number; gone: number; older: number } | null;
  backfill_cursor_uid: number | null;
}

/** The mailbox's folder_sync row for `folder`, or null, read as the superuser. */
export async function folderSync(
  adminUrl: string,
  mailboxId: string,
  folder = 'INBOX',
): Promise<FolderSyncView | null> {
  const admin = await connect(adminUrl);
  try {
    const { rows } = await admin.query<FolderSyncView>(
      `select uidvalidity::float8 as uidvalidity, generation, state, last_uid::float8 as last_uid,
              last_resync_summary, backfill_cursor_uid::float8 as backfill_cursor_uid
         from folder_sync where mailbox_id = $1 and folder = $2`,
      [mailboxId, folder],
    );
    return rows[0] ?? null;
  } finally {
    await admin.end();
  }
}

/** Run `sql` as the owner inside the mailbox's scope (FORCE RLS needs app.mailbox_id). */
export async function ownerSql(
  ownerUrl: string,
  mailboxId: string,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  const owner = await connect(ownerUrl);
  try {
    await owner.query('begin');
    await owner.query("select set_config('app.mailbox_id', $1, true)", [mailboxId]);
    const result = await owner.query(sql, params);
    await owner.query('commit');
    return result.rowCount ?? 0;
  } catch (error) {
    await owner.query('rollback').catch(() => {});
    throw error;
  } finally {
    await owner.end();
  }
}
