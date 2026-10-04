import { type DestinationStream, type Logger, pino } from 'pino';

/**
 * Fields censored in every log line (D-23, T-01-16), at the depths Sift logs
 * them. Free-form strings are handled by redactText.
 */
export const REDACT_PATHS: readonly string[] = [
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
];

export const REDACTED = '[REDACTED]';

export interface LoggerOptions {
  /** Defaults to SIFT_LOG_LEVEL, then 'info'. */
  level?: string;
  /** Defaults to stdout. */
  destination?: DestinationStream;
}

/** pino JSON logger with redaction. No log shipping: lines go to stdout. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? (process.env.SIFT_LOG_LEVEL?.trim() || 'info');
  return pino(
    {
      level,
      base: { service: 'sift' },
      redact: { paths: [...REDACT_PATHS], censor: REDACTED },
    },
    options.destination ?? process.stdout,
  );
}

/** userinfo password of a postgres:// or postgresql:// URL. */
const POSTGRES_URL_PASSWORD = /(postgres(?:ql)?:\/\/[^:@/\s]*:)[^@\s]*@/gi;

/**
 * Mask secrets in free-form text: every occurrence of each non-blank secret,
 * then the password of any postgres URL. Secrets are matched literally
 * (split/join), so their characters can never act as a pattern.
 */
export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  // Longest first, so a secret that contains another is masked whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret.trim() === '') continue;
    out = out.split(secret).join(REDACTED);
  }
  return out.replace(POSTGRES_URL_PASSWORD, `$1${REDACTED}@`);
}
