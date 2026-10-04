import { z } from 'zod';
import { SUPPORTED_CONFIG_VERSION } from '../index.ts';

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

export const Mailbox = z.strictObject({
  slug: nonEmpty('slug'),
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
      .min(1, 'mailboxes must list at least one mailbox'),
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
