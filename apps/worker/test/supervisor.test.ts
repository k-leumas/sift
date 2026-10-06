import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { BACKOFF_CAP_MS, computeBackoff } from '../src/runtime/backoff.ts';
import {
  createSupervisor,
  type HeartbeatStall,
  MAX_MISSED_HEARTBEATS,
  type MailboxEntry,
  type Supervisor,
  type SupervisorDeps,
} from '../src/runtime/supervisor.ts';

const POLL_MS = 60_000;
const TICK_MS = 15_000;
const SKIPPED = 'skipped: previous run still in progress';

type LogFn = (obj: object, msg?: string) => void;

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';

function entry(id: string, slug: string, disabled = false): MailboxEntry {
  return { id, slug, disabledAt: disabled ? new Date(0) : null };
}

/** A promise that never settles: a hung batch. */
const never = () => new Promise<void>(() => {});

interface Harness {
  deps: SupervisorDeps;
  supervisor: Supervisor;
  /** What readRegistry returns on the next tick. */
  registry: MailboxEntry[];
  /** Per-slug batch body; default resolves at once. Gets the shutdown signal. */
  batch: Map<string, (signal: AbortSignal) => Promise<void>>;
  /** The signal the latest runBatch call received, per slug. */
  signals: Map<string, AbortSignal>;
  /** Fake-clock times of each runBatch call, per slug. */
  runs: Map<string, number[]>;
  errors: { slug: string; error: unknown }[];
  stopped: string[];
  heartbeats: number[];
  log: { [K in 'info' | 'warn' | 'error' | 'debug']: Mock<LogFn> };
  registryFailures: number;
}

function harness(initial: MailboxEntry[], overrides: Partial<SupervisorDeps> = {}): Harness {
  const h = {
    registry: initial,
    batch: new Map<string, (signal: AbortSignal) => Promise<void>>(),
    signals: new Map<string, AbortSignal>(),
    runs: new Map<string, number[]>(),
    errors: [] as { slug: string; error: unknown }[],
    stopped: [] as string[],
    heartbeats: [] as number[],
    log: {
      info: vi.fn<LogFn>(),
      warn: vi.fn<LogFn>(),
      error: vi.fn<LogFn>(),
      debug: vi.fn<LogFn>(),
    },
    registryFailures: 0,
  } as Harness;
  h.deps = {
    async readRegistry() {
      if (h.registryFailures > 0) {
        h.registryFailures -= 1;
        throw new Error('registry unavailable');
      }
      return h.registry.map((e) => ({ ...e }));
    },
    async runBatch(m, signal) {
      const times = h.runs.get(m.slug) ?? [];
      times.push(Date.now());
      h.runs.set(m.slug, times);
      h.signals.set(m.slug, signal);
      await (h.batch.get(m.slug) ?? (async () => {}))(signal);
    },
    async onBatchError(m, error) {
      h.errors.push({ slug: m.slug, error });
    },
    async onMailboxStopped(m) {
      h.stopped.push(m.slug);
    },
    async heartbeat() {
      h.heartbeats.push(Date.now());
    },
    log: h.log,
    pollIntervalMs: POLL_MS,
    tickMs: TICK_MS,
    now: () => Date.now(),
    random: () => 0.5,
    ...overrides,
  };
  h.supervisor = createSupervisor(h.deps);
  return h;
}

const runCount = (h: Harness, slug: string) => h.runs.get(slug)?.length ?? 0;

/** Read the supervisor's stall report as it settles; undefined while pending. */
function watchStall(h: Harness): () => HeartbeatStall | undefined {
  let stall: HeartbeatStall | undefined;
  void h.supervisor.stalled.then((s) => {
    stall = s;
  });
  return () => stall;
}

/** Stop with fake time advanced past the drain timeout. */
async function stopAll(h: Harness, timeoutMs = 1_000) {
  const result = h.supervisor.stop(timeoutMs);
  await vi.advanceTimersByTimeAsync(timeoutMs);
  return result;
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('computeBackoff', () => {
  it('backoff doubles per failure with jitter and is capped at 15 minutes', () => {
    expect(BACKOFF_CAP_MS).toBe(900_000);
    expect(computeBackoff(1, 60_000, () => 0.5)).toBe(120_000);
    expect(computeBackoff(2, 60_000, () => 0.5)).toBe(240_000);
    expect(computeBackoff(1, 60_000, () => 0)).toBe(96_000);
    expect(computeBackoff(1, 60_000, () => 1)).toBe(144_000);
    expect(computeBackoff(20, 60_000, () => 1)).toBe(900_000);
    expect(computeBackoff(20, 60_000, () => 0)).toBe(720_000);
    expect(computeBackoff(5000, 60_000, () => 0.5)).toBe(900_000);
  });
});

describe('createSupervisor', () => {
  it('start runs each enabled mailbox once on the first tick and never a disabled one', async () => {
    const h = harness([entry(A, 'a'), entry(B, 'b'), entry(D, 'd', true)]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runCount(h, 'a')).toBe(1);
    expect(runCount(h, 'b')).toBe(1);
    expect(runCount(h, 'd')).toBe(0);
    expect(h.heartbeats).toEqual([0]);

    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(runCount(h, 'd')).toBe(0);
    // Disabled before the worker started: its status is recorded once (IN-06).
    expect(h.stopped).toEqual(['d']);
    await stopAll(h);
  });

  it('records a mailbox disabled while the worker was down once, and again after a re-enable (IN-06)', async () => {
    const h = harness([entry(A, 'a', true), entry(B, 'b')]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.stopped).toEqual(['a']);
    expect(h.log.info).toHaveBeenCalledWith({ mailbox: 'a' }, 'mailbox disabled');

    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(h.stopped).toEqual(['a']);
    expect(runCount(h, 'a')).toBe(0);

    // Re-enabled, it runs; disabled again, the new disable is recorded too.
    h.registry = [entry(A, 'a'), entry(B, 'b')];
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(runCount(h, 'a')).toBe(1);
    h.registry = [entry(A, 'a', true), entry(B, 'b')];
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(h.stopped).toEqual(['a', 'a']);
    await stopAll(h);
  });

  it('ticks every 15 s and runs each mailbox every poll interval', async () => {
    const h = harness([entry(A, 'a')]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(h.heartbeats).toEqual([
      0, 15_000, 30_000, 45_000, 60_000, 75_000, 90_000, 105_000, 120_000,
    ]);
    expect(h.runs.get('a')).toEqual([0, 60_000, 120_000]);
    await stopAll(h);
  });

  it('no overlap: a run still in progress is skipped, not queued', async () => {
    const h = harness([entry(A, 'a'), entry(B, 'b')]);
    h.batch.set('a', never);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);

    expect(runCount(h, 'a')).toBe(1);
    expect(h.runs.get('b')).toEqual([0, 60_000, 120_000, 180_000, 240_000, 300_000]);
    const skips = h.log.debug.mock.calls.filter(([, msg]) => msg === SKIPPED);
    // Every tick after the first finds A due and still running.
    expect(skips).toHaveLength((5 * POLL_MS) / TICK_MS);
    expect(skips.every(([obj]) => (obj as { mailbox?: string }).mailbox === 'a')).toBe(true);
    await stopAll(h);
  });

  it('independent failure: a failing mailbox backs off while others keep their schedule', async () => {
    const h = harness([entry(A, 'a'), entry(B, 'b')]);
    const boom = new Error('imap down');
    let failNext = true;
    h.batch.set('a', async () => {
      if (failNext) {
        failNext = false;
        throw boom;
      }
    });
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.errors).toEqual([{ slug: 'a', error: boom }]);

    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(h.runs.get('b')).toEqual([0, 60_000, 120_000, 180_000]);
    // First retry no earlier than computeBackoff(1) after the failure, then the plain interval.
    const retryAt = computeBackoff(1, POLL_MS, () => 0.5);
    expect(h.runs.get('a')).toEqual([0, retryAt, retryAt + POLL_MS]);
    expect(h.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ mailbox: 'a', failures: 1, retryInMs: retryAt }),
      'mailbox run failed',
    );
    await stopAll(h);
  });

  it('backoff grows with consecutive failures and resets after a success', async () => {
    const h = harness([entry(A, 'a')]);
    let failures = 2;
    h.batch.set('a', async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('still down');
      }
    });
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    const first = computeBackoff(1, POLL_MS, () => 0.5);
    const second = first + computeBackoff(2, POLL_MS, () => 0.5);
    expect(h.runs.get('a')?.slice(0, 4)).toEqual([0, first, second, second + POLL_MS]);
    expect(h.errors).toHaveLength(2);
    await stopAll(h);
  });

  it('an error thrown while recording a failure is logged and swallowed', async () => {
    const h = harness([entry(A, 'a'), entry(B, 'b')], {
      async onBatchError() {
        throw new Error('status write failed');
      },
    });
    h.batch.set('a', async () => {
      throw new Error('imap down');
    });
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ mailbox: 'a' }),
      'recording mailbox error failed',
    );
    expect(h.runs.get('b')).toEqual([0, 60_000, 120_000]);
    await stopAll(h);
  });

  it('disable: a mailbox disabled while running is stopped once and never run again', async () => {
    const h = harness([entry(A, 'a'), entry(B, 'b')]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runCount(h, 'a')).toBe(1);

    h.registry = [entry(A, 'a', true), entry(B, 'b')];
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(h.stopped).toEqual(['a']);
    expect(runCount(h, 'a')).toBe(1);
    expect(runCount(h, 'b')).toBe(6);

    // Re-enabled: it runs again on the next tick.
    h.registry = [entry(A, 'a'), entry(B, 'b')];
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(runCount(h, 'a')).toBe(2);
    expect(h.stopped).toEqual(['a']);
    await stopAll(h);
  });

  it('a mailbox removed from the registry is dropped without a disable', async () => {
    const h = harness([entry(A, 'a'), entry(B, 'b')]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    h.registry = [entry(B, 'b')];
    await vi.advanceTimersByTimeAsync(2 * POLL_MS);
    expect(runCount(h, 'a')).toBe(1);
    expect(h.stopped).toEqual([]);
    await stopAll(h);
  });

  it('a new mailbox appearing in the registry starts on the next tick', async () => {
    const h = harness([entry(A, 'a')]);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(TICK_MS + 1);
    expect(runCount(h, 'c')).toBe(0);

    h.registry = [entry(A, 'a'), entry(C, 'c')];
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(h.runs.get('c')).toEqual([2 * TICK_MS]);
    await stopAll(h);
  });

  it('a failed registry read logs an error, skips the heartbeat and keeps ticking', async () => {
    const h = harness([entry(A, 'a')]);
    h.registryFailures = 1;
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.heartbeats).toEqual([]);
    expect(runCount(h, 'a')).toBe(0);
    expect(h.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ name: 'Error' }) }),
      'reading the mailbox registry failed',
    );

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(h.heartbeats).toEqual([TICK_MS]);
    expect(h.runs.get('a')).toEqual([TICK_MS]);
    await stopAll(h);
  });

  it('logs error messages only through redact', async () => {
    const plain = harness([entry(A, 'a')]);
    plain.batch.set('a', async () => {
      throw new Error('login failed for hunter2');
    });
    plain.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const [plainObj] = plain.log.warn.mock.calls[0] ?? [];
    expect(JSON.stringify(plainObj)).not.toContain('hunter2');
    await stopAll(plain);

    const redacted = harness([entry(A, 'a')], {
      redact: (text) => text.replace('hunter2', '[REDACTED]'),
    });
    redacted.batch.set('a', async () => {
      throw new Error('login failed for hunter2');
    });
    redacted.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    const [obj] = redacted.log.warn.mock.calls[0] ?? [];
    expect(obj).toMatchObject({ error: { message: 'login failed for [REDACTED]' } });
    await stopAll(redacted);
  });

  it('drain: stop waits for in-flight batches and resolves drained true', async () => {
    const h = harness([entry(A, 'a'), entry(B, 'b')]);
    h.batch.set('a', () => new Promise((resolve) => setTimeout(resolve, 5_000)));
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);

    let result: { drained: boolean } | undefined;
    const stopping = h.supervisor.stop(20_000).then((r) => {
      result = r;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await stopping;
    expect(result).toEqual({ drained: true });

    // Nothing is scheduled after stop.
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(runCount(h, 'a')).toBe(1);
    expect(runCount(h, 'b')).toBe(1);
    expect(h.heartbeats).toEqual([0]);
  });

  it('drain: stop gives up after the timeout and resolves drained false', async () => {
    const h = harness([entry(A, 'a')]);
    h.batch.set('a', never);
    h.supervisor.start();
    await vi.advanceTimersByTimeAsync(0);
    await expect(stopAll(h, 20_000)).resolves.toEqual({ drained: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  describe('poll intervals that are not multiples of the 15 s tick (WR-08, D-52)', () => {
    it.each([
      [10_000, [0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]],
      [20_000, [0, 20_000, 40_000, 60_000]],
      [61_000, [0, 61_000, 122_000]],
    ])('runs every %i ms exactly', async (pollIntervalMs, expected) => {
      const h = harness([entry(A, 'a')], { pollIntervalMs });
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(expected.at(-1) ?? 0);
      expect(h.runs.get('a')).toEqual(expected);
      await stopAll(h);
    });

    it('still touches the heartbeat at least every 15 s', async () => {
      const h = harness([entry(A, 'a')], { pollIntervalMs: 20_000 });
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(60_000);
      const gaps = h.heartbeats.slice(1).map((t, i) => t - (h.heartbeats[i] ?? 0));
      expect(h.heartbeats[0]).toBe(0);
      expect(Math.max(...gaps)).toBeLessThanOrEqual(TICK_MS);
      expect(h.heartbeats.at(-1)).toBeGreaterThanOrEqual(45_000);
      await stopAll(h);
    });

    it('keeps the interval measured from the run start when a batch takes a while', async () => {
      const h = harness([entry(A, 'a')], { pollIntervalMs: 10_000 });
      h.batch.set('a', () => new Promise<void>((resolve) => setTimeout(resolve, 4_000)));
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.runs.get('a')).toEqual([0, 10_000, 20_000, 30_000]);
      await stopAll(h, 5_000);
    });

    it.each([
      // A 25 s run misses the 10 s and 20 s slots and resumes at 30 s.
      [25_000, [0, 30_000, 60_000]],
      // A run shorter than the interval misses nothing.
      [9_000, [0, 10_000, 20_000, 30_000, 40_000, 50_000, 60_000]],
    ])(
      'skips the slots a %i ms run missed instead of rerunning at once (IN-13, D-50)',
      async (batchMs, expected) => {
        const h = harness([entry(A, 'a')], { pollIntervalMs: 10_000 });
        h.batch.set('a', () => new Promise<void>((resolve) => setTimeout(resolve, batchMs)));
        h.supervisor.start();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(h.runs.get('a')).toEqual(expected);
        await stopAll(h, batchMs + 1_000);
      },
    );

    it('does not spin when the registry read keeps failing', async () => {
      const h = harness([entry(A, 'a')], { pollIntervalMs: 10_000 });
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(0);
      h.registryFailures = 1_000;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(1_000 - h.registryFailures).toBeLessThanOrEqual(6);
      await stopAll(h);
    });
  });

  describe('missed heartbeats (IN-05)', () => {
    it('reports a stall after 3 failed registry reads in a row, never writing the heartbeat', async () => {
      expect(MAX_MISSED_HEARTBEATS).toBe(3);
      const h = harness([entry(A, 'a')]);
      h.registryFailures = 1_000;
      const stall = watchStall(h);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(stall()).toBeUndefined();

      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(stall()).toEqual({
        missedHeartbeats: 3,
        step: 'registry_read',
        reason: 'failed',
        error: { name: 'Error' },
      });
      expect(h.heartbeats).toEqual([]);
      expect(runCount(h, 'a')).toBe(0);
      await stopAll(h);
    });

    it('a written heartbeat resets the count', async () => {
      const h = harness([entry(A, 'a')]);
      const stall = watchStall(h);
      h.registryFailures = 2;
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(h.heartbeats).toEqual([]);

      // Third tick succeeds, then two more failures: still 2 in a row.
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(h.heartbeats).toEqual([2 * TICK_MS]);
      h.registryFailures = 2;
      await vi.advanceTimersByTimeAsync(2 * TICK_MS);
      expect(h.registryFailures).toBe(0);
      expect(stall()).toBeUndefined();

      h.registryFailures = 1;
      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(stall()).toMatchObject({ missedHeartbeats: 3, step: 'registry_read' });
      await stopAll(h);
    });

    it('counts failed heartbeat writes and logs the coded cause, redacted', async () => {
      const url = 'postgres://sift_app:hunter2@db:5432/sift';
      let writes = 0;
      const h = harness([entry(A, 'a')], {
        async heartbeat() {
          writes += 1;
          const cause = Object.assign(new Error(`connect failed for ${url}`), { code: 'ENOSPC' });
          throw new Error('Failed query: select 1', { cause });
        },
        redact: (text) => text.replace(url, '[REDACTED]'),
      });
      const stall = watchStall(h);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(2 * TICK_MS);
      expect(writes).toBe(3);
      expect(stall()).toEqual({
        missedHeartbeats: 3,
        step: 'heartbeat_write',
        reason: 'failed',
        error: { name: 'Error', code: 'ENOSPC', message: 'connect failed for [REDACTED]' },
      });
      expect(JSON.stringify(stall())).not.toContain('hunter2');
      // Mailboxes keep running while the heartbeat cannot be written.
      expect(runCount(h, 'a')).toBe(1);
      await stopAll(h);
    });

    it("logs fixed text, never Drizzle's params, when the cause has no code (WR-01)", async () => {
      const h = harness([entry(A, 'a')], {
        async heartbeat() {
          throw new Error('Failed query: update x\nparams: Secret subject', {
            cause: new TypeError('bad value'),
          });
        },
        redact: (text) => text,
      });
      const stall = watchStall(h);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(2 * TICK_MS);
      expect(stall()).toMatchObject({
        error: {
          name: 'QueryFailedError',
          message: 'database query failed without an error code (TypeError)',
        },
      });
      expect(JSON.stringify(stall())).not.toContain('Secret');
      await stopAll(h);
    });

    it('counts a hung tick once per tick interval', async () => {
      const h = harness([entry(A, 'a')], { readRegistry: () => new Promise(() => {}) });
      const stall = watchStall(h);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(2 * TICK_MS);
      expect(stall()).toBeUndefined();
      expect(h.log.warn).toHaveBeenCalledWith(
        { step: 'registry_read', overdueMs: TICK_MS },
        'supervisor tick is overdue',
      );

      await vi.advanceTimersByTimeAsync(TICK_MS);
      expect(stall()).toEqual({ missedHeartbeats: 3, step: 'registry_read', reason: 'timed_out' });
      expect(h.heartbeats).toEqual([]);
      await expect(stopAll(h)).resolves.toEqual({ drained: false });
      expect(vi.getTimerCount()).toBe(0);
    });

    it('a hung heartbeat write is reported as that step', async () => {
      const h = harness([entry(A, 'a')], { heartbeat: () => new Promise(() => {}) });
      const stall = watchStall(h);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(3 * TICK_MS);
      expect(stall()).toEqual({
        missedHeartbeats: 3,
        step: 'heartbeat_write',
        reason: 'timed_out',
      });
      await stopAll(h);
    });

    it('honours maxMissedHeartbeats and counts nothing after stop', async () => {
      const h = harness([entry(A, 'a')], { maxMissedHeartbeats: 1 });
      h.registryFailures = 1_000;
      const stall = watchStall(h);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(stall()).toMatchObject({ missedHeartbeats: 1 });

      const stopped = harness([entry(A, 'a')], { readRegistry: () => new Promise(() => {}) });
      const stoppedStall = watchStall(stopped);
      stopped.supervisor.start();
      await stopAll(stopped);
      await vi.advanceTimersByTimeAsync(10 * TICK_MS);
      expect(stoppedStall()).toBeUndefined();
      await stopAll(h);
    });
  });

  describe('nudge (D-28)', () => {
    it('runs an idle mailbox now, then returns to the interval measured from that run', async () => {
      const h = harness([entry(A, 'a'), entry(B, 'b')]);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(h.runs.get('a')).toEqual([0]);

      expect(h.supervisor.nudge(A)).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.runs.get('a')).toEqual([0, 5_000]);
      // Only the nudged mailbox runs early.
      expect(h.runs.get('b')).toEqual([0]);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.runs.get('a')).toEqual([0, 5_000, 65_000]);
      expect(h.runs.get('b')).toEqual([0, 60_000]);
      await stopAll(h);
    });

    it('a nudge while running never overlaps; one more run starts right after a success', async () => {
      const h = harness([entry(A, 'a')]);
      let calls = 0;
      h.batch.set('a', () => {
        calls += 1;
        return calls === 1
          ? new Promise<void>((resolve) => setTimeout(resolve, 20_000))
          : Promise.resolve();
      });
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(h.supervisor.nudge(A)).toBe(true);
      expect(h.supervisor.nudge(A)).toBe(true);

      await vi.advanceTimersByTimeAsync(14_999);
      expect(h.runs.get('a')).toEqual([0]);

      // The run ends at 20 s; the follow-up starts at once (a 0 ms timer set
      // inside a timer callback fires 1 ms later).
      await vi.advanceTimersByTimeAsync(2);
      const followUp = h.runs.get('a')?.[1] ?? Number.NaN;
      expect(runCount(h, 'a')).toBe(2);
      expect(followUp - 20_000).toBeLessThanOrEqual(1);
      expect(followUp).toBeGreaterThanOrEqual(20_000);
      // Exactly one follow-up, however many nudges: then the plain interval.
      await vi.advanceTimersByTimeAsync(followUp + POLL_MS - 1 - Date.now());
      expect(runCount(h, 'a')).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.runs.get('a')).toEqual([0, followUp, followUp + POLL_MS]);
      await stopAll(h);
    });

    it('a failed run drops a pending nudge and keeps its backoff (D-51)', async () => {
      const h = harness([entry(A, 'a')]);
      let calls = 0;
      h.batch.set('a', () => {
        calls += 1;
        return calls === 1
          ? new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('bridge down')), 20_000),
            )
          : Promise.resolve();
      });
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(h.supervisor.nudge(A)).toBe(true);

      const retryAt = 20_000 + computeBackoff(1, POLL_MS, () => 0.5);
      await vi.advanceTimersByTimeAsync(retryAt - 1 - 5_000);
      expect(h.errors).toHaveLength(1);
      expect(h.runs.get('a')).toEqual([0]);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.runs.get('a')).toEqual([0, retryAt]);
      await stopAll(h);
    });

    it('returns false and runs nothing for an unknown or disabled mailbox, or after stop', async () => {
      const h = harness([entry(A, 'a'), entry(D, 'd', true)]);
      expect(h.supervisor.nudge(A)).toBe(false);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(h.supervisor.nudge(C)).toBe(false);
      expect(h.supervisor.nudge(D)).toBe(false);
      await vi.advanceTimersByTimeAsync(0);
      expect(runCount(h, 'd')).toBe(0);
      expect(h.runs.get('a')).toEqual([0]);

      await stopAll(h);
      expect(h.supervisor.nudge(A)).toBe(false);
      await vi.advanceTimersByTimeAsync(2 * POLL_MS);
      expect(h.runs.get('a')).toEqual([0]);
    });
  });

  describe('shutdown signal (D-04, P1 D-53)', () => {
    it('runBatch gets a signal that aborts as soon as stop() is called, before the drain', async () => {
      const h = harness([entry(A, 'a')]);
      h.batch.set('a', never);
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(POLL_MS);
      const signal = h.signals.get('a');
      expect(signal?.aborted).toBe(false);

      let result: { drained: boolean } | undefined;
      const stopping = h.supervisor.stop(20_000).then((r) => {
        result = r;
      });
      expect(signal?.aborted).toBe(true);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(20_000);
      await stopping;
      expect(result).toEqual({ drained: false });
    });

    it('a batch that stops on abort lets stop() drain', async () => {
      const h = harness([entry(A, 'a')]);
      let endedByAbort = false;
      h.batch.set(
        'a',
        (signal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener(
              'abort',
              () => {
                endedByAbort = true;
                resolve();
              },
              { once: true },
            );
          }),
      );
      h.supervisor.start();
      await vi.advanceTimersByTimeAsync(0);
      const stopping = h.supervisor.stop(20_000);
      await vi.advanceTimersByTimeAsync(0);
      await expect(stopping).resolves.toEqual({ drained: true });
      expect(endedByAbort).toBe(true);
      expect(h.errors).toEqual([]);
    });
  });
});
