import {
  type HeartbeatStall,
  SHUTDOWN_TIMEOUT_MS,
  type Supervisor,
  type SupervisorLog,
} from './supervisor.ts';

/**
 * Exit code after too many missed heartbeats (IN-05): 75, EX_TEMPFAIL in
 * sysexits.h. It differs from 1 (startup and config errors) and 2 (usage), so
 * the log and `docker compose ps` tell a stall apart. Any non-zero code makes
 * Compose's `restart: unless-stopped` restart the worker.
 */
export const EXIT_HEARTBEAT_STALLED = 75;

export const HEARTBEAT_STALLED_MESSAGE =
  'heartbeat missed too many times in a row; exiting so Docker restarts the worker';

type Outcome = { signal: NodeJS.Signals } | { stall: HeartbeatStall };

/**
 * Run a started supervisor until SIGTERM/SIGINT (D-53, exit code 0) or until
 * it reports a heartbeat stall (IN-05, EXIT_HEARTBEAT_STALLED). Both paths
 * take the same bounded drain; the caller then closes the pool.
 *
 * The stall is logged as one error line naming the step, the reason and the
 * number of misses, plus the last error's name, code and redacted message
 * (summarized by the supervisor; never the database URL or a secret).
 */
export async function runUntilStopped(
  supervisor: Supervisor,
  log: SupervisorLog,
  waitForSignal: (abort: AbortSignal) => Promise<NodeJS.Signals>,
  shutdownTimeoutMs: number = SHUTDOWN_TIMEOUT_MS,
): Promise<number> {
  const abort = new AbortController();
  const outcome = await Promise.race<Outcome>([
    waitForSignal(abort.signal).then((signal) => ({ signal })),
    supervisor.stalled.then((stall) => ({ stall })),
  ]);
  // A stall shutdown no longer waits for a signal: one that arrives now
  // force-exits, like a second signal during a normal shutdown.
  abort.abort();

  let code = 0;
  if ('signal' in outcome) {
    log.info({ signal: outcome.signal }, 'shutting down');
  } else {
    code = EXIT_HEARTBEAT_STALLED;
    log.error({ ...outcome.stall, exitCode: code }, HEARTBEAT_STALLED_MESSAGE);
  }

  const { drained } = await supervisor.stop(shutdownTimeoutMs);
  if (!drained) {
    log.warn({ timeoutMs: shutdownTimeoutMs }, 'in-flight mailbox runs did not finish in time');
  }
  return code;
}
