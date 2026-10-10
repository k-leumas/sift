import type { LlmClient } from './ollama-client.ts';
import type { createPreflight } from './preflight.ts';

/**
 * One Ollama request at a time, worker-wide (D-19, AI-SPEC section 4b
 * Async-First Design). Requests queued inside Ollama still spend their own
 * timeout while they wait, which shows up as false `timeout` outages and
 * pushes other mailboxes into backoff; parallel requests also share llama.cpp
 * batches and break determinism. So every chat and preflight call goes
 * through one FIFO gate.
 *
 * The worker creates the gate once at startup and hands it to every mailbox
 * batch. Never create one at module scope: test files importing this module
 * would share it.
 */

export type SingleFlight = <T>(task: () => Promise<T>) => Promise<T>;

/** A FIFO gate: tasks run strictly one after another, in arrival order. */
export function createSingleFlight(): SingleFlight {
  let tail: Promise<void> = Promise.resolve();
  return async <T>(task: () => Promise<T>): Promise<T> => {
    const previous = tail;
    const { promise, resolve } = Promise.withResolvers<void>();
    tail = promise;
    await previous;
    try {
      return await task();
    } finally {
      resolve();
    }
  };
}

/** The same client with every chat call queued on `gate`. */
export function gateClient(client: LlmClient, gate: SingleFlight): LlmClient {
  return { chat: (request, shutdown) => gate(() => client.chat(request, shutdown)) };
}

/** The same preflight queued on `gate` as one task (its three requests stay together). */
export function gatePreflight(
  preflight: ReturnType<typeof createPreflight>,
  gate: SingleFlight,
): ReturnType<typeof createPreflight> {
  return (model, shutdown) => gate(() => preflight(model, shutdown));
}
