import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

/** Address domains a committed spike or live-run document may name. */
const ALLOWED_DOMAINS = ['example.test', 'protonmail.internalid'];

/** Denylist entries shorter than this would match ordinary words. */
const MIN_DENYLIST_LENGTH = 3;

const HEADER_LINE = /^\s*(subject|from|to):/i;
const EMAIL_ADDRESS = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

function allowedDomain(domain: string): boolean {
  const lower = domain.toLowerCase();
  return ALLOWED_DOMAINS.some((allowed) => lower === allowed || lower.endsWith(`.${allowed}`));
}

/**
 * Privacy problems in a document meant for git: one string per offending line,
 * naming the line number and the kind of problem, never the matched text.
 * Flags header-style lines (Subject:, From:, To:), email addresses outside
 * the allowlisted domains, and any case-insensitive occurrence of an
 * extraDenylist entry of 3 or more characters.
 */
export function privacyProblems(text: string, extraDenylist: readonly string[] = []): string[] {
  const denylist = extraDenylist
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length >= MIN_DENYLIST_LENGTH);
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (HEADER_LINE.test(line)) problems.push(`line ${lineNumber}: header-style line`);
    for (const match of line.matchAll(EMAIL_ADDRESS)) {
      if (!allowedDomain(match[1] ?? '')) {
        problems.push(`line ${lineNumber}: email address outside the allowlisted domains`);
        break;
      }
    }
    const lower = line.toLowerCase();
    if (denylist.some((entry) => lower.includes(entry))) {
      problems.push(`line ${lineNumber}: denylisted identifier`);
    }
  });
  return problems;
}

/**
 * Identifiers from the owner's config that must never appear in a committed
 * document: each mailbox's imap.username and that username's local part.
 * Returns [] when the file does not exist (CI, worktrees). Reads the YAML
 * only; never loads env files.
 */
export function configDenylist(configPath: string): string[] {
  if (!existsSync(configPath)) return [];
  const config: unknown = parse(readFileSync(configPath, 'utf8'));
  const mailboxes =
    config !== null && typeof config === 'object' && 'mailboxes' in config ? config.mailboxes : [];
  if (!Array.isArray(mailboxes)) return [];
  const denylist: string[] = [];
  for (const mailbox of mailboxes) {
    const username: unknown = mailbox?.imap?.username;
    if (typeof username !== 'string' || username.trim() === '') continue;
    denylist.push(username.trim());
    const at = username.indexOf('@');
    if (at > 0) denylist.push(username.slice(0, at).trim());
  }
  return denylist;
}
