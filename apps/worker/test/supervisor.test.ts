import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { BACKOFF_CAP_MS, computeBackoff } from '../src/runtime/backoff.ts';
import {
  createSupervisor,
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
  /** Per-slug batch body; default resolves at once. */
  batch: Map<string, () => Promise<void>>;
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
    batch: new Map<string, () => Promise<void>>(),
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
    async runBatch(m) {
      const times = h.runs.get(m.slug) ?? [];
      times.push(Date.now());
      h.runs.set(m.slug, times);
      await (h.batch.get(m.slug) ?? (async () => {}))();
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
    expect(h.stopped).toEqual([]);
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
});
