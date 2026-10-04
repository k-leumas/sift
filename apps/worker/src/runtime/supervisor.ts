import { computeBackoff } from './backoff.ts';

/** How often the supervisor rereads the registry and touches the heartbeat (D-49, D-54). */
export const SUPERVISOR_TICK_MS = 15_000;

/** How long shutdown waits for in-flight batches before giving up (D-53). */
export const SHUTDOWN_TIMEOUT_MS = 20_000;

export interface MailboxEntry {
  id: string;
  slug: string;
  disabledAt: Date | null;
}

export interface SupervisorLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

export interface SupervisorDeps {
  readRegistry(): Promise<MailboxEntry[]>;
  runBatch(mailbox: MailboxEntry): Promise<void>;
  onBatchError(mailbox: MailboxEntry, error: unknown): Promise<void>;
  onMailboxStopped(mailbox: MailboxEntry): Promise<void>;
  heartbeat(): Promise<void>;
  log: SupervisorLog;
  pollIntervalMs: number;
  tickMs?: number;
  now?: () => number;
  random?: () => number;
  /**
   * Masks secrets in error messages before they are logged. Without it only
   * the error name and code are logged, since messages can quote secrets.
   */
  redact?: (text: string) => string;
}

export interface Supervisor {
  start(): void;
  stop(timeoutMs?: number): Promise<{ drained: boolean }>;
}

/**
 * Per-mailbox schedule. Whether a run is in progress lives in `running`,
 * keyed by mailbox id, so a run that outlives a dropped state (disabled, then
 * re-enabled) still blocks an overlapping run (D-50).
 */
interface MailboxState {
  failures: number;
  nextRunAt: number;
}

interface ErrorSummary {
  name: string;
  code?: string;
  message?: string;
}

/** Error fields safe to log. The message is included only after redaction. */
function summarizeError(error: unknown, redact?: (text: string) => string): ErrorSummary {
  const summary: ErrorSummary = { name: error instanceof Error ? error.name : typeof error };
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') summary.code = code;
  if (redact !== undefined && error instanceof Error) summary.message = redact(error.message);
  return summary;
}

/**
 * The worker's scheduler (D-49..D-53). Each tick rereads the registry,
 * touches the heartbeat and starts every enabled mailbox that is due, each as
 * its own async task. Ticks are chained with setTimeout, so a tick never
 * overlaps the previous one. Mailboxes fail independently and back off
 * (D-51); disabled ones are stopped (D-45); stop() drains with a bound (D-53).
 */
export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const { log, pollIntervalMs } = deps;
  const tickMs = deps.tickMs ?? SUPERVISOR_TICK_MS;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const describeError = (error: unknown) => summarizeError(error, deps.redact);

  const states = new Map<string, MailboxState>();
  const running = new Map<string, Promise<void>>();
  const inFlight = new Set<Promise<void>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let currentTick: Promise<void> | undefined;
  let started = false;
  let stopped = false;

  function track(id: string | undefined, task: Promise<void>): void {
    inFlight.add(task);
    if (id !== undefined) running.set(id, task);
    void task.finally(() => {
      inFlight.delete(task);
      if (id !== undefined && running.get(id) === task) running.delete(id);
    });
  }

  /**
   * One batch as its own task. Success returns the mailbox to the plain
   * interval, measured from the run's start so ticks do not stretch it.
   * Failure backs off exponentially (D-51). Nothing here can reject: one
   * mailbox never takes down the supervisor.
   */
  function runMailbox(entry: MailboxEntry, state: MailboxState): void {
    const task = (async () => {
      const startedAt = now();
      try {
        await deps.runBatch(entry);
        state.failures = 0;
        state.nextRunAt = startedAt + pollIntervalMs;
      } catch (error) {
        state.failures += 1;
        const retryInMs = computeBackoff(state.failures, pollIntervalMs, random);
        state.nextRunAt = now() + retryInMs;
        log.warn(
          {
            mailbox: entry.slug,
            failures: state.failures,
            retryInMs,
            error: describeError(error),
          },
          'mailbox run failed',
        );
        try {
          await deps.onBatchError(entry, error);
        } catch (recordError) {
          log.error(
            { mailbox: entry.slug, error: describeError(recordError) },
            'recording mailbox error failed',
          );
        }
      }
    })();
    track(entry.id, task);
  }

  /** Record a disable (D-45). Errors are logged; the mailbox stays stopped. */
  function stopMailbox(entry: MailboxEntry): void {
    log.info({ mailbox: entry.slug }, 'mailbox disabled, stopping');
    const task = (async () => {
      try {
        await deps.onMailboxStopped(entry);
      } catch (error) {
        log.error(
          { mailbox: entry.slug, error: describeError(error) },
          'recording mailbox stop failed',
        );
      }
    })();
    track(undefined, task);
  }

  function schedule(entries: readonly MailboxEntry[]): void {
    const listed = new Set<string>();
    for (const entry of entries) {
      listed.add(entry.id);
      const known = states.get(entry.id);

      if (entry.disabledAt !== null) {
        // Disabled mailboxes are never started; a known one is stopped once.
        if (known !== undefined) {
          states.delete(entry.id);
          stopMailbox(entry);
        }
        continue;
      }

      let state = known;
      if (state === undefined) {
        state = { failures: 0, nextRunAt: now() };
        states.set(entry.id, state);
      }
      if (now() < state.nextRunAt) continue;
      if (running.has(entry.id)) {
        // D-50: skip, do not queue. nextRunAt stays, so the next tick retries.
        log.debug({ mailbox: entry.slug }, 'skipped: previous run still in progress');
        continue;
      }
      runMailbox(entry, state);
    }

    for (const id of states.keys()) {
      if (!listed.has(id)) {
        states.delete(id);
        log.info({ mailboxId: id }, 'mailbox left the registry, stopping');
      }
    }
  }

  async function tick(): Promise<void> {
    let entries: MailboxEntry[];
    try {
      entries = await deps.readRegistry();
    } catch (error) {
      log.error({ error: describeError(error) }, 'reading the mailbox registry failed');
      return;
    }
    try {
      await deps.heartbeat();
    } catch (error) {
      log.error({ error: describeError(error) }, 'writing the heartbeat failed');
    }
    if (!stopped) schedule(entries);
  }

  function loop(): void {
    timer = undefined;
    if (stopped) return;
    currentTick = tick();
    void currentTick.finally(() => {
      if (!stopped) timer = setTimeout(loop, tickMs);
    });
  }

  return {
    start(): void {
      if (started) throw new Error('Supervisor already started');
      started = true;
      loop();
    },

    async stop(timeoutMs: number = SHUTDOWN_TIMEOUT_MS): Promise<{ drained: boolean }> {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      const pending = [...(currentTick ? [currentTick] : []), ...inFlight];
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<false>((resolve) => {
        deadline = setTimeout(() => resolve(false), timeoutMs);
      });
      const drained = await Promise.race([
        Promise.allSettled(pending).then(() => true as const),
        timedOut,
      ]);
      clearTimeout(deadline);
      return { drained };
    },
  };
}
