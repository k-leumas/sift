import { relative } from 'node:path';
import { resolveConfigPath } from '@sift/core';
import {
  applyEnvOverrides,
  checkMailboxEnv,
  formatIssue,
  loadConfig,
  secretValues,
} from '@sift/core/config';
import { createLogger, redactText } from '@sift/core/log';
import { createAppDb, requireDatabaseUrl } from '@sift/db';
import { assertUnprivilegedRole, connectWithRetry, DatabaseStartupError } from '@sift/db/connect';
import type { CommandIO } from '../command.ts';
import { createHeartbeat, defaultHeartbeatFile } from '../runtime/heartbeat.ts';
import { createMailboxCallbacks } from '../runtime/mailbox-batch.ts';
import { EXIT_HEARTBEAT_STALLED, runUntilStopped } from '../runtime/run-until-stopped.ts';
import { waitForShutdownSignal } from '../runtime/shutdown.ts';
import { checkDrift } from '../runtime/startup.ts';
import { createSupervisor, SHUTDOWN_TIMEOUT_MS } from '../runtime/supervisor.ts';

/**
 * D-53: after the drain, wait this long for the pool to close, then end the
 * clients a stuck batch still holds (plus at most 1 s). 20 s drain + 3 s + 1 s
 * stays inside Compose's 30 s stop_grace_period, so the worker exits 0 rather
 * than being killed.
 */
const CLOSE_TIMEOUT_MS = 3_000;

/**
 * IN-05: after a stall shutdown, a step that hung (a stuck file write, say)
 * could keep the event loop alive. This unref'd timer exits anyway, so
 * Docker sees the exit code and restarts the worker.
 */
const STALL_EXIT_BACKSTOP_MS = 2_000;

/** Show a path relative to the working directory when it lives under it. */
function displayPath(path: string, cwd: string): string {
  const rel = relative(cwd, path);
  return rel !== '' && !rel.startsWith('..') ? rel : path;
}

function sqlStateOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The driver error inside drizzle's "Failed query: <sql> params: ..." wrapper,
 * so the log names the SQLSTATE and server message rather than the query text.
 * Falls back to the error itself.
 */
function databaseCause(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (sqlStateOf(current) !== undefined) return current;
    current = current.cause;
  }
  return error;
}

/**
 * `sift worker` (D-49..D-54). Startup order: config, password_env presence,
 * then the database as sift_app (SIFT_DATABASE_URL: classified connect retry
 * and the unprivileged-role guard, D-55), then the registry drift check
 * (D-34), then the supervisor.
 * Nothing touches the database before the env check (D-35), so a missing
 * password produces exactly one log line.
 *
 * Exit codes: 0 after SIGTERM/SIGINT, 1 for config and startup errors, and
 * EXIT_HEARTBEAT_STALLED (75) after MAX_MISSED_HEARTBEATS missed heartbeats in
 * a row (IN-05), so Compose's `restart: unless-stopped` restarts the worker.
 *
 * Logs are pino JSON lines on stdout, including unexpected errors (redacted).
 * The database URL, config secrets and env values are never logged.
 */
export async function run(_args: readonly string[], io: CommandIO): Promise<number> {
  const log = createLogger({
    level: io.env.SIFT_LOG_LEVEL?.trim() || 'info',
    destination: { write: (line: string) => io.stdout(line.replace(/\n$/, '')) },
  });

  const path = resolveConfigPath(io.env, io.cwd);
  const loaded = await loadConfig(path);
  if (!loaded.ok) {
    const source = displayPath(path, io.cwd);
    log.error({ issues: loaded.issues.map((i) => formatIssue(i, source)) }, 'invalid config');
    return 1;
  }

  const overridden = applyEnvOverrides(loaded.config, io.env);
  if (!overridden.ok) {
    const issues = overridden.issues.map((i) => formatIssue(i, overridden.source));
    log.error({ issues }, 'invalid environment override');
    return 1;
  }
  const config = overridden.config;

  const envCheck = checkMailboxEnv(config, io.env);
  if (!envCheck.ok) {
    log.error({}, envCheck.message);
    return 1;
  }

  let url: string;
  try {
    url = requireDatabaseUrl(io.env, 'SIFT_DATABASE_URL');
  } catch (error) {
    log.error({}, error instanceof Error ? error.message : 'Missing env var: SIFT_DATABASE_URL');
    return 1;
  }

  const secrets = secretValues(config, io.env);
  let exitCode = 0;
  // Each running mailbox holds one connection for its ingest lock and the
  // lock's transactions (02-12); two more keep the registry read and status
  // writes from waiting behind them.
  const db = createAppDb(url, {
    maxConnections: Math.max(4, config.mailboxes.length + 2),
    onPoolError: (e) =>
      log.warn({ code: (e as { code?: string }).code }, 'idle database client error'),
  });

  try {
    // D-55: retry only self-resolving connection errors, then refuse a role
    // that would bypass RLS (T-01-43).
    try {
      await connectWithRetry(db, { log });
      await assertUnprivilegedRole(db);
    } catch (error) {
      if (error instanceof DatabaseStartupError) {
        log.error({ code: error.code }, error.message);
        return 1;
      }
      throw error;
    }

    // D-34: never run against a registry that no longer matches config.yaml.
    // The worker does not reconcile config itself (D-27).
    const differences = await checkDrift(db, config);
    if (differences.length > 0) {
      log.error(
        { differences },
        'config.yaml differs from the mailbox registry; apply it with: docker compose run --rm setup',
      );
      return 1;
    }

    const supervisor = createSupervisor({
      ...createMailboxCallbacks(db, secrets, { config, env: io.env, log }),
      heartbeat: createHeartbeat(defaultHeartbeatFile(io.env)),
      log,
      pollIntervalMs: config.worker.poll_interval_seconds * 1000,
      redact: (text) => redactText(text, [...secrets, url]),
    });

    supervisor.start();
    log.info(
      {
        mailboxes: config.mailboxes.length,
        pollIntervalSeconds: config.worker.poll_interval_seconds,
      },
      'worker started',
    );

    exitCode = await runUntilStopped(supervisor, log, waitForShutdownSignal, SHUTDOWN_TIMEOUT_MS);
  } catch (error) {
    // Anything unexpected (a pg error from the role guard, the drift check or
    // the supervisor) is logged through pino, redacted, never raw on stderr.
    const root = databaseCause(error);
    const message = root instanceof Error ? root.message : String(root);
    log.error(
      { code: sqlStateOf(root) },
      `worker failed: ${redactText(message, [...secrets, url])}`,
    );
    return 1;
  } finally {
    const { forced } = await db.close({ timeoutMs: CLOSE_TIMEOUT_MS });
    if (forced) {
      log.warn({ timeoutMs: CLOSE_TIMEOUT_MS }, 'closed database connections still in use');
    }
  }
  log.info({ exitCode }, 'stopped');
  if (exitCode === EXIT_HEARTBEAT_STALLED) {
    setTimeout(() => process.exit(exitCode), STALL_EXIT_BACKSTOP_MS).unref();
  }
  return exitCode;
}
