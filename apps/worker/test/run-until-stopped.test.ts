import { createLogger, redactText } from '@sift/core/log';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  EXIT_HEARTBEAT_STALLED,
  HEARTBEAT_STALLED_MESSAGE,
  runUntilStopped,
} from '../src/runtime/run-until-stopped.ts';
import { waitForShutdownSignal } from '../src/runtime/shutdown.ts';
import { createSupervisor, type SupervisorDeps } from '../src/runtime/supervisor.ts';

const TICK_MS = 15_000;
const URL = 'postgres://sift_app:hunter2@db:5432/sift';

type LogFn = (obj: object, msg?: string) => void;

function mockLog() {
  return {
    info: vi.fn<LogFn>(),
    warn: vi.fn<LogFn>(),
    error: vi.fn<LogFn>(),
    debug: vi.fn<LogFn>(),
  };
}

/** A supervisor whose registry read always fails with a coded, URL-quoting error. */
function failingSupervisor(log: SupervisorDeps['log'], heartbeat: Mock<() => Promise<void>>) {
  return createSupervisor({
    async readRegistry() {
      const cause = Object.assign(new Error(`connect ECONNREFUSED for ${URL}`), {
        code: 'ECONNREFUSED',
      });
      throw new Error('Failed query: select id, slug from mailbox', { cause });
    },
    async runBatch() {},
    async onBatchError() {},
    async onMailboxStopped() {},
    heartbeat,
    log,
    pollIntervalMs: 60_000,
    tickMs: TICK_MS,
    redact: (text) => redactText(text, [URL]),
  });
}

/** A signal wait that never fires, recording the abort it was given. */
function noSignal() {
  const seen: AbortSignal[] = [];
  const wait = (abort: AbortSignal) => {
    seen.push(abort);
    return new Promise<NodeJS.Signals>(() => {});
  };
  return { wait, seen };
}

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runUntilStopped (IN-05, D-53)', () => {
  it('exits with EXIT_HEARTBEAT_STALLED after 3 missed heartbeats and logs why', async () => {
    expect(EXIT_HEARTBEAT_STALLED).toBe(75);
    const log = mockLog();
    const heartbeat = vi.fn<() => Promise<void>>(async () => {});
    const supervisor = failingSupervisor(log, heartbeat);
    const signal = noSignal();
    supervisor.start();

    let code: number | undefined;
    const done = runUntilStopped(supervisor, log, signal.wait, 1_000).then((c) => {
      code = c;
    });
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(code).toBeUndefined();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await done;

    expect(code).toBe(EXIT_HEARTBEAT_STALLED);
    expect(heartbeat).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenLastCalledWith(
      {
        missedHeartbeats: 3,
        step: 'registry_read',
        reason: 'failed',
        error: {
          name: 'Error',
          code: 'ECONNREFUSED',
          message: 'connect ECONNREFUSED for [REDACTED]',
        },
        exitCode: EXIT_HEARTBEAT_STALLED,
      },
      HEARTBEAT_STALLED_MESSAGE,
    );
    expect(log.info).not.toHaveBeenCalledWith(expect.anything(), 'shutting down');
    // The signal listeners are released: a signal now force-exits.
    expect(signal.seen[0]?.aborted).toBe(true);
    // Stopped: no more ticks, no timers left.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('writes the stall as one pino JSON line without the database URL', async () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'error', destination: { write: (l) => lines.push(l) } });
    const supervisor = failingSupervisor(
      log,
      vi.fn<() => Promise<void>>(async () => {}),
    );
    supervisor.start();
    const done = runUntilStopped(supervisor, log, noSignal().wait, 1_000);
    await vi.advanceTimersByTimeAsync(2 * TICK_MS);
    await expect(done).resolves.toBe(EXIT_HEARTBEAT_STALLED);

    const stallLines = lines.filter((l) => l.includes(HEARTBEAT_STALLED_MESSAGE));
    expect(stallLines).toHaveLength(1);
    expect(JSON.parse(stallLines[0] ?? '')).toMatchObject({
      level: 50,
      service: 'sift',
      missedHeartbeats: 3,
      step: 'registry_read',
      reason: 'failed',
      error: { code: 'ECONNREFUSED' },
      exitCode: 75,
      msg: HEARTBEAT_STALLED_MESSAGE,
    });
    expect(lines.join('\n')).not.toContain('hunter2');
    expect(lines.join('\n')).not.toContain(URL);
  });

  it('a signal still shuts down with exit code 0', async () => {
    const log = mockLog();
    const supervisor = createSupervisor({
      async readRegistry() {
        return [];
      },
      async runBatch() {},
      async onBatchError() {},
      async onMailboxStopped() {},
      async heartbeat() {},
      log,
      pollIntervalMs: 60_000,
      tickMs: TICK_MS,
    });
    supervisor.start();
    const code = await runUntilStopped(supervisor, log, async () => 'SIGTERM', 1_000);
    expect(code).toBe(0);
    expect(log.info).toHaveBeenCalledWith({ signal: 'SIGTERM' }, 'shutting down');
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe('waitForShutdownSignal', () => {
  it('removes its listeners when aborted', () => {
    const before = process.listenerCount('SIGTERM');
    const abort = new AbortController();
    void waitForShutdownSignal(abort.signal);
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    expect(process.listenerCount('SIGINT')).toBeGreaterThan(0);
    abort.abort();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('adds no listeners for an already aborted signal', () => {
    const before = process.listenerCount('SIGTERM');
    void waitForShutdownSignal(AbortSignal.abort());
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });
});
