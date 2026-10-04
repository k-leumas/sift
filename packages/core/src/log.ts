import { type DestinationStream, type Logger, pino } from 'pino';

export const REDACT_PATHS: readonly string[] = [];

export function createLogger(
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  return pino({ level: options.level ?? 'info' }, options.destination ?? process.stdout);
}

export function redactText(text: string, _secrets: readonly string[]): string {
  return text;
}
