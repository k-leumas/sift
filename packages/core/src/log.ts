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

/** Stands in for a database query wrapper that has no coded cause (WR-01). */
export class QueryFailedError extends Error {
  override name = 'QueryFailedError';
}

/**
 * Drizzle's "Failed query: <sql> params: ..." wrapper (DrizzleQueryError),
 * recognised by shape because apps may not import drizzle-orm. Its params
 * can hold mail fields.
 */
function isQueryWrapper(error: Error): boolean {
  const { query, params } = error as { query?: unknown; params?: unknown };
  return (
    (typeof query === 'string' && Array.isArray(params)) ||
    error.message.startsWith('Failed query:')
  );
}

/**
 * The error that is safe to log or store for a failure: the first error in
 * the cause chain (at most 5 deep) that carries a string code, i.e. a
 * SQLSTATE or socket code inside Drizzle's wrapper. Without a coded cause
 * the error itself is returned, except a query wrapper: its text holds the
 * statement's params, which can be mail fields, so a QueryFailedError naming
 * only the innermost error's class takes its place (WR-01).
 */
export function codedCause(error: unknown): unknown {
  let current: unknown = error;
  let innermost: Error | undefined;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (typeof (current as { code?: unknown }).code === 'string') return current;
    if (!isQueryWrapper(current)) innermost = current;
    current = current.cause;
  }
  if (!(error instanceof Error) || !isQueryWrapper(error)) return error;
  const name = innermost?.name ?? 'no cause';
  return new QueryFailedError(`database query failed without an error code (${name})`);
}
