import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import type { TrustedPromptInput, UntrustedEmail } from '@sift/core/classify';
import { afterEach, describe, expect, it } from 'vitest';
import { runLlmTier } from '../src/classify/llm-tier.ts';
import { createOllamaClient } from '../src/classify/ollama-client.ts';
import { createPreflight, PREFLIGHT_TIMEOUT_MS } from '../src/classify/preflight.ts';
import { createSingleFlight, gateClient, gatePreflight } from '../src/classify/single-flight.ts';
import {
  FAKE_DIGEST,
  FAKE_VERSION,
  type FakeOllama,
  type FakeOllamaOptions,
  okAnswer,
  startFakeOllama,
} from './support/fake-ollama.ts';

/**
 * The per-tick local-model preflight (AI-SPEC section 4 Tool Use, section 6
 * "Preflight, local model only", SEC-02 Phase 3 part) and the process-wide
 * single-flight gate (D-19), against the fake Ollama.
 */

const MODEL = 'qwen3:1.7b';

const TRUSTED: TrustedPromptInput = {
  categories: [
    { name: 'Important', description: 'Real people.' },
    { name: 'Noise', description: 'Bulk mail.' },
  ],
  judgment: [],
};

const EMAIL: UntrustedEmail = {
  fromAddress: 'a@example.test',
  fromName: null,
  subject: 'Hello',
  attachmentNames: [],
  body: 'Hi there.',
};

let fake: FakeOllama | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function start(options: FakeOllamaOptions = {}): Promise<FakeOllama> {
  fake = await startFakeOllama(options);
  return fake;
}

function live(): AbortSignal {
  return new AbortController().signal;
}

function calls(f: FakeOllama): string[] {
  return f.requests().map((r) => `${r.method} ${r.path}`);
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('createPreflight (local model only, fail closed)', () => {
  it('has a short default timeout', () => {
    expect(PREFLIGHT_TIMEOUT_MS).toBe(10_000);
  });

  it('a healthy server gives the Ollama version and the model digest, with no chat call', async () => {
    const f = await start();
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result).toEqual({ kind: 'ok', ollamaVersion: FAKE_VERSION, modelDigest: FAKE_DIGEST });
    expect(calls(f)).toEqual(['GET /api/version', 'GET /api/tags', 'POST /api/show']);
    expect(f.requests()[2]?.body).toEqual({ model: MODEL });
    expect(f.chatBodies()).toHaveLength(0);
  });

  it('a model that is not pulled is infra model_missing', async () => {
    const f = await start({
      tags: {
        status: 200,
        json: { models: [{ name: 'llama3:8b', model: 'llama3:8b', digest: FAKE_DIGEST }] },
      },
    });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result.kind === 'infra' && result.code).toBe('model_missing');
    expect(result.kind === 'infra' && result.detail).toContain(MODEL);
    expect(f.chatBodies()).toHaveLength(0);
  });

  it('a tags entry with remote_host is infra remote_model (SEC-02)', async () => {
    const f = await start({
      tags: {
        status: 200,
        json: {
          models: [
            {
              name: MODEL,
              model: MODEL,
              remote_host: 'https://ollama.com:443',
              remote_model: 'qwen3:1.7b',
              digest: FAKE_DIGEST,
            },
          ],
        },
      },
    });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result.kind === 'infra' && result.code).toBe('remote_model');
    expect(calls(f)).toEqual(['GET /api/version', 'GET /api/tags']);
    expect(f.chatBodies()).toHaveLength(0);
  });

  it('a tags entry with only remote_model set is infra remote_model too', async () => {
    const f = await start({
      tags: { status: 200, json: { models: [{ name: MODEL, remote_model: 'qwen3-cloud' }] } },
    });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result.kind === 'infra' && result.code).toBe('remote_model');
    expect(f.chatBodies()).toHaveLength(0);
  });

  it('/api/show capabilities without completion is infra model_unsuitable', async () => {
    const f = await start({ show: { status: 200, json: { capabilities: ['embedding'] } } });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result.kind === 'infra' && result.code).toBe('model_unsuitable');
    expect(f.chatBodies()).toHaveLength(0);
  });

  it('/api/show without a capabilities list passes (older Ollama)', async () => {
    const f = await start({ show: { status: 200, json: { details: {} } } });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result.kind).toBe('ok');
  });

  it('a configured name without a tag matches the :latest entry', async () => {
    const f = await start({
      tags: {
        status: 200,
        json: { models: [{ name: 'qwen3:latest', model: 'qwen3:latest', digest: FAKE_DIGEST }] },
      },
    });
    const result = await createPreflight(f.url)('qwen3', live());
    expect(result).toEqual({ kind: 'ok', ollamaVersion: FAKE_VERSION, modelDigest: FAKE_DIGEST });
  });

  it('a missing version and digest are null, not invented', async () => {
    const f = await start({
      version: { status: 200, json: {} },
      tags: { status: 200, json: { models: [{ name: MODEL }] } },
    });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result).toEqual({ kind: 'ok', ollamaVersion: null, modelDigest: null });
  });

  it('a closed port is infra unreachable', async () => {
    const result = await createPreflight(`http://127.0.0.1:${await closedPort()}`)(MODEL, live());
    expect(result).toEqual({
      kind: 'infra',
      code: 'unreachable',
      status: null,
      detail: 'ECONNREFUSED',
    });
  });

  it('a 500 from /api/version is infra server_error and stops the preflight', async () => {
    const f = await start({ version: { status: 500, json: { error: 'boom' } } });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result).toEqual({ kind: 'infra', code: 'server_error', status: 500, detail: 'boom' });
    expect(calls(f)).toEqual(['GET /api/version']);
  });

  it('a /api/tags body that is not a model list is infra server_error', async () => {
    const f = await start({ tags: { status: 200, body: 'not json' } });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result.kind === 'infra' && result.code).toBe('server_error');
  });

  it('a 404 from /api/show is infra model_missing', async () => {
    const f = await start({ show: { status: 404, json: { error: 'model not found' } } });
    const result = await createPreflight(f.url)(MODEL, live());
    expect(result.kind === 'infra' && result.code).toBe('model_missing');
  });

  it('a hang past the timeout is infra timeout', async () => {
    const f = await start({ version: { hang: true } });
    const result = await createPreflight(f.url, { timeoutMs: 200 })(MODEL, live());
    expect(result).toEqual({
      kind: 'infra',
      code: 'timeout',
      status: null,
      detail: 'no answer in 200 ms',
    });
  });

  it('aborting the shutdown signal is aborted', async () => {
    const f = await start({ tags: { hang: true } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await createPreflight(f.url)(MODEL, controller.signal);
    expect(result).toEqual({ kind: 'aborted' });
    expect(f.chatBodies()).toHaveLength(0);
  });

  it('an already aborted shutdown makes no request', async () => {
    const f = await start();
    const controller = new AbortController();
    controller.abort();
    const result = await createPreflight(f.url)(MODEL, controller.signal);
    expect(result).toEqual({ kind: 'aborted' });
    expect(f.requests()).toHaveLength(0);
  });
});

describe('createSingleFlight (D-19)', () => {
  it('runs three tasks started together strictly one after another, in arrival order', async () => {
    const gate = createSingleFlight();
    const events: string[] = [];
    const task = (n: number) => async () => {
      events.push(`s${n}`);
      await new Promise((resolve) => setTimeout(resolve, 20 - n * 5));
      events.push(`e${n}`);
      return n;
    };
    const results = await Promise.all([gate(task(1)), gate(task(2)), gate(task(3))]);
    expect(results).toEqual([1, 2, 3]);
    expect(events).toEqual(['s1', 'e1', 's2', 'e2', 's3', 'e3']);
  });

  it('a failed task releases the gate for the next one', async () => {
    const gate = createSingleFlight();
    const failed = gate(async () => {
      throw new Error('boom');
    });
    const next = gate(async () => 'next');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
  });

  it('two gates do not share a queue', async () => {
    const a = createSingleFlight();
    const b = createSingleFlight();
    const events: string[] = [];
    const slow = a(async () => {
      events.push('a start');
      await new Promise((resolve) => setTimeout(resolve, 50));
      events.push('a end');
    });
    await b(async () => {
      events.push('b');
    });
    await slow;
    expect(events).toEqual(['a start', 'b', 'a end']);
  });
});

describe('gated Ollama calls never overlap at the fake (D-19, E6)', () => {
  const delayed = () => ({ ...okAnswer('Noise', 0.9), delayMs: 100 });

  it('an ungated client does overlap (positive control)', async () => {
    const f = await start({ chat: () => delayed() });
    const client = createOllamaClient(f.url);
    await Promise.all([1, 2, 3].map(() => runLlmTier(client, MODEL, TRUSTED, EMAIL, live())));
    expect(f.maxInFlight()).toBeGreaterThan(1);
  });

  it('three concurrent runLlmTier calls through gateClient leave maxInFlight at 1', async () => {
    const f = await start({ chat: () => delayed() });
    const client = gateClient(createOllamaClient(f.url), createSingleFlight());
    const results = await Promise.all(
      [1, 2, 3].map(() => runLlmTier(client, MODEL, TRUSTED, EMAIL, live())),
    );
    expect(results.map((r) => r.kind)).toEqual(['decided', 'decided', 'decided']);
    expect(f.chatBodies()).toHaveLength(3);
    expect(f.maxInFlight()).toBe(1);
  });

  it('preflights and chats sharing one gate never overlap', async () => {
    const f = await start({
      chat: () => delayed(),
      version: { status: 200, json: { version: FAKE_VERSION }, delayMs: 50 },
    });
    const gate = createSingleFlight();
    const client = gateClient(createOllamaClient(f.url), gate);
    const preflight = gatePreflight(createPreflight(f.url), gate);
    const results = await Promise.all([
      preflight(MODEL, live()),
      runLlmTier(client, MODEL, TRUSTED, EMAIL, live()),
      preflight(MODEL, live()),
      runLlmTier(client, MODEL, TRUSTED, EMAIL, live()),
    ]);
    expect(results.map((r) => r.kind)).toEqual(['ok', 'decided', 'ok', 'decided']);
    expect(f.maxInFlight()).toBe(1);
  });
});
