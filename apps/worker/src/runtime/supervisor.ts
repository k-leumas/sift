import { computeBackoff } from './backoff.ts';

/**
 * The longest gap between supervisor ticks, each of which rereads the registry
 * and touches the heartbeat (D-49, D-54). A tick also runs as soon as the next
 * mailbox is due, so poll intervals are kept exactly, not rounded up to this.
 */
export const SUPERVISOR_TICK_MS = 15_000;

/** How long shutdown waits for in-flight batches before giving up (D-53). */
export const SHUTDOWN_TIMEOUT_MS = 20_000;

/**
 * Consecutive missed heartbeats after which the supervisor reports a stall and
 * the worker exits, so Docker's restart policy restarts it (IN-05).
 */
export const MAX_MISSED_HEARTBEATS = 3;

/** The tick step that kept the heartbeat from being written. */
export type HeartbeatStep = 'registry_read' | 'heartbeat_write';

/**
 * Why the heartbeat was not written: the step threw (`failed`), or the tick
 * was still waiting on it a full tick interval after it started (`timed_out`).
 */
export type HeartbeatMissReason = 'failed' | 'timed_out';

export interface ErrorSummary {
  name: string;
  code?: string;
  message?: string;
}

/** The last of MAX_MISSED_HEARTBEATS consecutive misses. Holds no secrets. */
export interface HeartbeatStall {
  missedHeartbeats: number;
  step: HeartbeatStep;
  reason: HeartbeatMissReason;
  error?: ErrorSummary;
}

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
  /**
   * One mailbox's batch. `signal` aborts the moment stop() begins, so a
   * chunked ingest can stop between chunks (D-04, P1 D-53).
   */
  runBatch(mailbox: MailboxEntry, signal: AbortSignal): Promise<void>;
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
  /** Defaults to MAX_MISSED_HEARTBEATS. */
  maxMissedHeartbeats?: number;
}

export interface Supervisor {
  start(): void;
  stop(timeoutMs?: number): Promise<{ drained: boolean }>;
  /**
   * Make a mailbox due now instead of at its next poll slot (D-28). A mailbox
   * that is running is never started twice (D-50): it runs once more right
   * after the current run succeeds; a failed run drops the nudge and keeps
   * its backoff (D-51). Returns false, starting nothing, for an unknown,
   * disabled or removed mailbox and after stop(). Nothing calls it in Phase 2;
   * a future IDLE listener or sync command uses it.
   */
  nudge(mailboxId: string): boolean;
  /**
   * Resolves once maxMissedHeartbeats heartbeats in a row were missed (IN-05).
   * Never rejects, and stays pending while the heartbeat is written.
   */
  readonly stalled: Promise<HeartbeatStall>;
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

/**
 * The first error in the cause chain that carries a string code, so a driver
 * error wrapped by drizzle ("Failed query: ...") is logged by its SQLSTATE or
 * socket code rather than the query text. Falls back to the error itself.
 */
function codedCause(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (typeof (current as { code?: unknown }).code === 'string') return current;
    current = current.cause;
  }
  return error;
}

/** Error fields safe to log. The message is included only after redaction. */
function summarizeError(raw: unknown, redact?: (text: string) => string): ErrorSummary {
  const error = codedCause(raw);
  const summary: ErrorSummary = { name: error instanceof Error ? error.name : typeof error };
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string') summary.code = code;
  if (redact !== undefined && error instanceof Error) summary.message = redact(error.message);
  return summary;
}

/**
 * The worker's scheduler (D-49..D-53). Each tick rereads the registry,
 * touches the heartbeat and starts every enabled mailbox that is due, each as
 * its own async task. The next tick runs when the next idle mailbox is due,
 * but at most tickMs later (D-52: the poll interval is kept exactly). Ticks
 * are chained with setTimeout, so a tick never overlaps the previous one. Mailboxes fail independently and back off
 * (D-51); disabled ones are stopped (D-45); stop() drains with a bound (D-53).
 * MAX_MISSED_HEARTBEATS ticks in a row without a heartbeat resolve `stalled`
 * (IN-05).
 */
export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const { log, pollIntervalMs } = deps;
  const tickMs = deps.tickMs ?? SUPERVISOR_TICK_MS;
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const maxMissed = deps.maxMissedHeartbeats ?? MAX_MISSED_HEARTBEATS;
  const describeError = (error: unknown) => summarizeError(error, deps.redact);

  const states = new Map<string, MailboxState>();
  /**
   * Disabled mailboxes whose stop this process has already recorded, so that
   * one disabled before the worker started is still recorded once (IN-06).
   */
  const recordedDisabled = new Set<string>();
  const running = new Map<string, Promise<void>>();
  /** Mailboxes nudged while running: one follow-up run after a success (D-28). */
  const nudged = new Set<string>();
  const inFlight = new Set<Promise<void>>();
  /** Aborted at the start of stop(); every runBatch gets its signal. */
  const shutdown = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerDue = Number.POSITIVE_INFINITY;
  let ticking = false;
  let currentTick: Promise<boolean> | undefined;
  let started = false;
  let stopped = false;

  /** The step the running tick is waiting on, for a tick that times out. */
  let tickStep: HeartbeatStep = 'registry_read';
  let overdueTimer: ReturnType<typeof setTimeout> | undefined;
  let missedHeartbeats = 0;
  let stallReported = false;
  const stall = Promise.withResolvers<HeartbeatStall>();

  /**
   * IN-05: a tick that should have written the heartbeat but did not. Misses
   * count in a row; a written heartbeat resets the count. Once maxMissed is
   * reached, `stalled` resolves (once) and the worker shuts down and exits.
   */
  function missHeartbeat(step: HeartbeatStep, reason: HeartbeatMissReason, error?: unknown): void {
    if (stopped || stallReported) return;
    missedHeartbeats += 1;
    if (missedHeartbeats < maxMissed) return;
    stallReported = true;
    const report: HeartbeatStall = { missedHeartbeats, step, reason };
    if (error !== undefined) report.error = describeError(error);
    stall.resolve(report);
  }

  /**
   * A tick still running tickMs after it started has missed the heartbeat it
   * owed: count one miss per tickMs until it settles. This covers a registry
   * read or heartbeat write that hangs instead of failing.
   */
  function armOverdue(): void {
    overdueTimer = setTimeout(() => {
      overdueTimer = undefined;
      if (stopped || !ticking) return;
      log.warn({ step: tickStep, overdueMs: tickMs }, 'supervisor tick is overdue');
      missHeartbeat(tickStep, 'timed_out');
      armOverdue();
    }, tickMs);
  }

  function clearOverdue(): void {
    if (overdueTimer !== undefined) clearTimeout(overdueTimer);
    overdueTimer = undefined;
  }

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
   * interval, measured from the run's start so ticks do not stretch it. A run
   * that outlasted the interval skips the slots it missed (D-50: skipped, not
   * stacked) instead of restarting at once. Failure backs off exponentially
   * (D-51). Nothing here can reject: one mailbox never takes down the
   * supervisor.
   */
  function runMailbox(entry: MailboxEntry, state: MailboxState): void {
    const task = (async () => {
      const startedAt = now();
      try {
        await deps.runBatch(entry, shutdown.signal);
        state.failures = 0;
        const slots = Math.max(1, Math.ceil((now() - startedAt) / pollIntervalMs));
        state.nextRunAt = startedAt + slots * pollIntervalMs;
        // A nudge during this run: run once more now, never concurrently (D-28).
        if (nudged.delete(entry.id)) state.nextRunAt = now();
        wakeAt(state.nextRunAt);
      } catch (error) {
        // A failed run drops a pending nudge, so it cannot cut the backoff (D-51).
        nudged.delete(entry.id);
        state.failures += 1;
        const retryInMs = computeBackoff(state.failures, pollIntervalMs, random);
        state.nextRunAt = now() + retryInMs;
        wakeAt(state.nextRunAt);
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
  function stopMailbox(entry: MailboxEntry, wasScheduled: boolean): void {
    log.info(
      { mailbox: entry.slug },
      wasScheduled ? 'mailbox disabled, stopping' : 'mailbox disabled',
    );
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
        // Disabled mailboxes are never started. Each disable is recorded once:
        // when a scheduled mailbox is disabled, and also when the worker first
        // sees a mailbox that was disabled while it was down, so its
        // mailbox_status.state does not stay stale.
        if (known !== undefined) states.delete(entry.id);
        if (known !== undefined || !recordedDisabled.has(entry.id)) {
          recordedDisabled.add(entry.id);
          stopMailbox(entry, known !== undefined);
        }
        continue;
      }
      recordedDisabled.delete(entry.id);

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

    for (const id of recordedDisabled) {
      if (!listed.has(id)) recordedDisabled.delete(id);
    }
    for (const id of states.keys()) {
      if (!listed.has(id)) {
        states.delete(id);
        log.info({ mailboxId: id }, 'mailbox left the registry, stopping');
      }
    }
  }

  /** True when the registry was read and due mailboxes were scheduled. */
  async function tick(): Promise<boolean> {
    let entries: MailboxEntry[];
    tickStep = 'registry_read';
    try {
      entries = await deps.readRegistry();
    } catch (error) {
      log.error({ error: describeError(error) }, 'reading the mailbox registry failed');
      missHeartbeat('registry_read', 'failed', error);
      return false;
    }
    tickStep = 'heartbeat_write';
    try {
      await deps.heartbeat();
      missedHeartbeats = 0;
    } catch (error) {
      log.error({ error: describeError(error) }, 'writing the heartbeat failed');
      missHeartbeat('heartbeat_write', 'failed', error);
    }
    if (!stopped) schedule(entries);
    return true;
  }

  /** Make sure a tick runs no later than `at`; an earlier pending timer stays. */
  function wakeAt(at: number): void {
    if (stopped || (timer !== undefined && timerDue <= at)) return;
    if (timer !== undefined) clearTimeout(timer);
    timerDue = at;
    timer = setTimeout(loop, Math.max(0, at - now()));
  }

  /**
   * When the next tick is due: when the earliest idle mailbox is due, at most
   * tickMs away. Running mailboxes are left out; they call wakeAt when they
   * finish. After a failed registry read the plain tick applies, so a broken
   * database is not hammered.
   */
  function nextTickAt(scheduled: boolean): number {
    let at = now() + tickMs;
    if (!scheduled) return at;
    for (const [id, state] of states) {
      if (!running.has(id)) at = Math.min(at, state.nextRunAt);
    }
    return at;
  }

  function loop(): void {
    timer = undefined;
    timerDue = Number.POSITIVE_INFINITY;
    // A wake-up during a tick is covered: the tick re-arms when it ends.
    if (stopped || ticking) return;
    ticking = true;
    armOverdue();
    const thisTick = tick();
    currentTick = thisTick;
    void thisTick
      .catch(() => false)
      .then((scheduled) => {
        clearOverdue();
        ticking = false;
        wakeAt(nextTickAt(scheduled));
      });
  }

  return {
    stalled: stall.promise,

    start(): void {
      if (started) throw new Error('Supervisor already started');
      started = true;
      loop();
    },

    nudge(mailboxId: string): boolean {
      if (stopped) return false;
      const state = states.get(mailboxId);
      if (state === undefined) return false;
      if (running.has(mailboxId)) {
        // D-50: never a second concurrent run; runMailbox reschedules on success.
        nudged.add(mailboxId);
        return true;
      }
      state.nextRunAt = now();
      wakeAt(state.nextRunAt);
      return true;
    },

    async stop(timeoutMs: number = SHUTDOWN_TIMEOUT_MS): Promise<{ drained: boolean }> {
      // First, so running batches see shutdown while the drain waits for them.
      shutdown.abort();
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      clearOverdue();
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
