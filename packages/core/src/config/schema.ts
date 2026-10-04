import { z } from 'zod';
import { SUPPORTED_CONFIG_VERSION } from '../index.ts';
import { validateSlug } from './slug.ts';

/** Default Ollama endpoint as seen from inside the Compose network (D-60). */
export const DEFAULT_MODELS_URL = 'http://host.docker.internal:11434';

/** Default worker poll interval in seconds (D-52). */
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;
export const MIN_POLL_INTERVAL_SECONDS = 10;
export const MAX_POLL_INTERVAL_SECONDS = 3600;

/** Shape rule for `password_env` (D-62): an environment variable name. */
export const ENV_VAR_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/** Render a scalar for an error message. Only used for non-secret values (version). */
function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return Array.isArray(value) ? 'a list' : `a ${typeof value}`;
}

/** Returns undefined for a missing value so the generic "is required" message applies. */
function unlessMissing(message: string) {
  return (issue: { input?: unknown }) => (issue.input === undefined ? undefined : message);
}

const nonEmpty = (name: string) =>
  z
    .string({ error: unlessMissing(`${name} must be text`) })
    .trim()
    .min(1, `${name} must not be empty`);

/** An http(s) URL. Shared by models.url and the SIFT_MODELS_URL override. */
export const HttpUrl = z.url({
  protocol: /^https?$/,
  error: unlessMissing('must be an http:// or https:// URL'),
});

const Version = z.literal(SUPPORTED_CONFIG_VERSION, {
  error: (issue) =>
    issue.input === undefined
      ? `version is required (this Sift build supports version ${SUPPORTED_CONFIG_VERSION})`
      : `unsupported config version ${describe(issue.input)}; this Sift build supports version ${SUPPORTED_CONFIG_VERSION}`,
});

const Port = z
  .int({ error: unlessMissing('port must be a whole number from 1 to 65535') })
  .min(1, 'port must be from 1 to 65535')
  .max(65535, 'port must be from 1 to 65535');

const PasswordEnv = z
  .string({ error: unlessMissing('password_env must be text') })
  .regex(
    ENV_VAR_NAME_PATTERN,
    'password_env must be an environment variable name: A-Z, 0-9 and _, not starting with a digit (^[A-Z_][A-Z0-9_]*$)',
  );

export const Imap = z.strictObject({
  host: nonEmpty('host'),
  port: Port,
  username: nonEmpty('username'),
  password_env: PasswordEnv,
  folder: nonEmpty('folder').default('INBOX'),
});

export const Labels = z.strictObject({
  apply_as: z.enum(['proton_labels'], {
    error: unlessMissing('apply_as must be proton_labels'),
  }),
});

/**
 * Accepts any input so a numeric slug reaches validateSlug (and its "quote it"
 * hint) instead of Zod's generic type error.
 */
const Slug = z.unknown().transform((value, ctx): string => {
  const message = validateSlug(value);
  if (message !== null) {
    ctx.addIssue({ code: 'custom', message });
    return z.NEVER;
  }
  return value as string;
});

export const Mailbox = z.strictObject({
  slug: Slug,
  display_name: nonEmpty('display_name')
    .max(80, 'display_name must be at most 80 characters')
    .optional(),
  imap: Imap,
  labels: Labels,
});

export const Models = z.strictObject(
  {
    provider: z.enum(['ollama'], { error: unlessMissing('provider must be ollama') }),
    url: HttpUrl.default(DEFAULT_MODELS_URL),
    embeddings: nonEmpty('embeddings'),
    llm: nonEmpty('llm'),
  },
  { error: unlessMissing('models must be a mapping') },
);

export const Worker = z.strictObject(
  {
    poll_interval_seconds: z
      .int({
        error: unlessMissing(
          `poll_interval_seconds must be a whole number from ${MIN_POLL_INTERVAL_SECONDS} to ${MAX_POLL_INTERVAL_SECONDS}`,
        ),
      })
      .min(
        MIN_POLL_INTERVAL_SECONDS,
        `poll_interval_seconds must be from ${MIN_POLL_INTERVAL_SECONDS} to ${MAX_POLL_INTERVAL_SECONDS}`,
      )
      .max(
        MAX_POLL_INTERVAL_SECONDS,
        `poll_interval_seconds must be from ${MIN_POLL_INTERVAL_SECONDS} to ${MAX_POLL_INTERVAL_SECONDS}`,
      )
      .default(DEFAULT_POLL_INTERVAL_SECONDS),
  },
  { error: unlessMissing('worker must be a mapping') },
);

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Identity of an IMAP mailbox (D-64), shared by the duplicate check and the
 * registry's rename pairing. Values are trimmed, as the schema stores them.
 * Host and username compare case-insensitively; INBOX is case-insensitive per
 * RFC 3501, every other folder name is compared exactly.
 */
export function imapIdentityKey(host: string, username: string, folder: string): string {
  const trimmedFolder = folder.trim();
  const normalisedFolder = trimmedFolder.toUpperCase() === 'INBOX' ? 'INBOX' : trimmedFolder;
  return JSON.stringify([
    host.trim().toLowerCase(),
    username.trim().toLowerCase(),
    normalisedFolder,
  ]);
}

/** imapIdentityKey of a raw (not yet parsed) config entry, or undefined. */
function imapIdentity(mailbox: unknown): string | undefined {
  const imap = field(mailbox, 'imap');
  const host = field(imap, 'host');
  const username = field(imap, 'username');
  const folder = field(imap, 'folder') ?? 'INBOX';
  if (typeof host !== 'string' || typeof username !== 'string' || typeof folder !== 'string') {
    return undefined;
  }
  return imapIdentityKey(host, username, folder);
}

/** Slug uniqueness (D-63) and one config entry per IMAP mailbox (D-64). */
function checkMailboxDuplicates(mailboxes: unknown, ctx: z.RefinementCtx): void {
  if (!Array.isArray(mailboxes)) return;
  const slugs = new Map<string, number>();
  const accounts = new Map<string, number>();
  mailboxes.forEach((mailbox: unknown, index) => {
    const slug = field(mailbox, 'slug');
    if (typeof slug === 'string') {
      const first = slugs.get(slug);
      if (first === undefined) {
        slugs.set(slug, index);
      } else {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'slug'],
          message: `duplicate slug "${slug}" (also used by mailboxes[${first}])`,
        });
      }
    }

    const identity = imapIdentity(mailbox);
    if (identity !== undefined) {
      const first = accounts.get(identity);
      if (first === undefined) {
        accounts.set(identity, index);
      } else {
        const imap = field(mailbox, 'imap');
        const described = [
          field(imap, 'host'),
          field(imap, 'username'),
          field(imap, 'folder') ?? 'INBOX',
        ];
        ctx.addIssue({
          code: 'custom',
          path: [index, 'imap'],
          message: `mailboxes[${first}] and mailboxes[${index}] read the same IMAP mailbox (${described.join(' ')}); this would process mail twice`,
        });
      }
    }
  });
}

export const Config = z.strictObject(
  {
    version: Version,
    mailboxes: z
      .array(Mailbox, {
        error: (issue) =>
          issue.input === undefined
            ? 'mailboxes is required: add at least one mailbox'
            : 'mailboxes must be a list of mailboxes',
      })
      .min(1, 'mailboxes must list at least one mailbox')
      // `when` runs the cross-mailbox checks even if a field elsewhere failed,
      // so every problem in the file is reported in one pass.
      .superRefine(checkMailboxDuplicates, { when: () => true }),
    models: Models,
    worker: Worker.default({ poll_interval_seconds: DEFAULT_POLL_INTERVAL_SECONDS }),
  },
  { error: unlessMissing('the config file must be a mapping of keys (version, mailboxes, ...)') },
);

export type ImapConfig = z.output<typeof Imap>;
export type MailboxConfig = z.output<typeof Mailbox>;
export type ModelsConfig = z.output<typeof Models>;
export type WorkerConfig = z.output<typeof Worker>;
export type SiftConfig = z.output<typeof Config>;
