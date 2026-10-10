import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import {
  llmOutputSchema,
  MODEL_OPTIONS,
  makeNonce,
  ollamaFormat,
  renderMessages,
} from '@sift/core/classify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOllamaClient,
  ERROR_TEXT_MAX_CHARS,
  type LlmCallResult,
  type LlmChatRequest,
} from '../src/classify/ollama-client.ts';
import {
  CONTEXT_LENGTH_ERROR,
  contentAnswer,
  type FakeOllama,
  type FakeResponse,
  okAnswer,
  startFakeOllama,
} from './support/fake-ollama.ts';

/**
 * The client half of D-16/E5: every transport outcome is classified at the
 * wire against the fake Ollama (or a closed port / unresolvable host), and the
 * client never throws for an expected failure.
 */

const REQUEST: LlmChatRequest = {
  model: 'qwen3:1.7b',
  messages: renderMessages(
    {
      categories: [
        { name: 'Important', description: 'Real people.' },
        { name: 'Noise', description: 'Bulk mail.' },
      ],
      judgment: [],
    },
    {
      fromAddress: 'a@example.test',
      fromName: null,
      subject: 'Hi',
      attachmentNames: [],
      body: 'Hello.',
    },
    makeNonce(),
  ),
  format: ollamaFormat(llmOutputSchema(['Important', 'Noise'])),
  options: { ...MODEL_OPTIONS },
};

let fake: FakeOllama | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function chatOnce(
  response: FakeResponse,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ result: LlmCallResult; f: FakeOllama }> {
  fake = await startFakeOllama({ chat: [response] });
  const client = createOllamaClient(fake.url, { timeoutMs: options.timeoutMs ?? 5_000 });
  const result = await client.chat(REQUEST, options.signal ?? new AbortController().signal);
  return { result, f: fake };
}

async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe('transport failures (E5 client half)', () => {
  it('a closed port is infra unreachable with the ECONNREFUSED code', async () => {
    const client = createOllamaClient(`http://127.0.0.1:${await closedPort()}`);
    const result = await client.chat(REQUEST, new AbortController().signal);
    expect(result).toEqual({
      kind: 'infra',
      code: 'unreachable',
      status: null,
      detail: 'ECONNREFUSED',
    });
  });

  it('an unresolvable host is infra unreachable with a DNS code', async () => {
    const client = createOllamaClient('http://ollama.invalid:11434', { timeoutMs: 10_000 });
    const result = await client.chat(REQUEST, new AbortController().signal);
    expect(result.kind === 'infra' && result.code).toBe('unreachable');
    expect(result.kind === 'infra' && result.detail).toMatch(/^(ENOTFOUND|EAI_AGAIN)$/);
  });

  it('a hang past our timeout is infra timeout', async () => {
    const { result, f } = await chatOnce({ hang: true }, { timeoutMs: 200 });
    expect(f.chatBodies()).toHaveLength(1);
    expect(result).toEqual({
      kind: 'infra',
      code: 'timeout',
      status: null,
      detail: 'no answer in 200 ms',
    });
  });

  it('a reset mid-body is infra, never a verdict', async () => {
    const { result, f } = await chatOnce({ ...okAnswer('Noise', 0.9), resetMidBody: true });
    expect(f.chatBodies()).toHaveLength(1);
    expect(result.kind).toBe('infra');
    expect(result.kind === 'infra' && result.code).toMatch(/^(server_error|unreachable)$/);
  });

  it('aborting the shutdown signal during a hang is aborted, not an error', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const { result, f } = await chatOnce({ hang: true }, { signal: controller.signal });
    expect(f.chatBodies()).toHaveLength(1);
    expect(result).toEqual({ kind: 'aborted' });
  });
});

describe('HTTP status classification (D-16 vs D-24)', () => {
  const cases: [string, FakeResponse, LlmCallResult][] = [
    [
      '404 is model_missing',
      { status: 404, json: { error: "model 'qwen3:1.7b' not found" } },
      { kind: 'infra', code: 'model_missing', status: 404, detail: "model 'qwen3:1.7b' not found" },
    ],
    [
      '429 is busy',
      { status: 429, json: { error: 'too many requests' } },
      { kind: 'infra', code: 'busy', status: 429, detail: 'too many requests' },
    ],
    [
      '503 is busy',
      { status: 503, json: { error: 'server busy, please try again' } },
      { kind: 'infra', code: 'busy', status: 503, detail: 'server busy, please try again' },
    ],
    [
      '500 is server_error',
      { status: 500, json: { error: 'llama runner process has terminated' } },
      {
        kind: 'infra',
        code: 'server_error',
        status: 500,
        detail: 'llama runner process has terminated',
      },
    ],
    [
      'a 500 that mentions the context is still server_error',
      { status: 500, json: { error: 'failed to grow the context length buffer' } },
      {
        kind: 'infra',
        code: 'server_error',
        status: 500,
        detail: 'failed to grow the context length buffer',
      },
    ],
    [
      'another 400 is rejected',
      { status: 400, json: { error: '"qwen3:1.7b" does not support tools' } },
      {
        kind: 'infra',
        code: 'rejected',
        status: 400,
        detail: '"qwen3:1.7b" does not support tools',
      },
    ],
    [
      'the context-length 400 is input_too_long',
      { status: 400, json: { error: CONTEXT_LENGTH_ERROR } },
      { kind: 'input_too_long', status: 400, detail: CONTEXT_LENGTH_ERROR },
    ],
    [
      'a 400 with a plain-text body keeps the text',
      { status: 400, body: 'bad request' },
      { kind: 'infra', code: 'rejected', status: 400, detail: 'bad request' },
    ],
    [
      'a 200 {} is server_error',
      { status: 200, json: {} },
      { kind: 'infra', code: 'server_error', status: 200, detail: 'not a chat response' },
    ],
    [
      'a 200 with done false is server_error',
      { ...okAnswer('Noise', 0.9), json: { message: { content: '{}' }, done: false } },
      { kind: 'infra', code: 'server_error', status: 200, detail: 'not a chat response' },
    ],
    [
      'a 200 JSON array is server_error',
      { status: 200, json: [1, 2] },
      { kind: 'infra', code: 'server_error', status: 200, detail: 'not a chat response' },
    ],
    [
      'a 200 non-JSON body is server_error',
      { status: 200, body: '<html>proxy login</html>' },
      { kind: 'infra', code: 'server_error', status: 200, detail: 'response body is not JSON' },
    ],
  ];
  for (const [name, response, expected] of cases) {
    it(name, async () => {
      const { result, f } = await chatOnce(response);
      expect(f.chatBodies()).toHaveLength(1);
      expect(result).toEqual(expected);
    });
  }

  it(`caps Ollama's error text at ${ERROR_TEXT_MAX_CHARS} characters`, async () => {
    const { result } = await chatOnce({ status: 500, json: { error: 'x'.repeat(2000) } });
    expect(result.kind === 'infra' && result.detail).toBe('x'.repeat(ERROR_TEXT_MAX_CHARS));
  });
});

describe('an ok answer', () => {
  it('maps content, thinking, done_reason, model and metrics', async () => {
    const answer = contentAnswer('{"a":1}', {
      message: { thinking: 'hmm' },
      done_reason: 'length',
      eval_count: -1,
      load_duration: 'slow',
    });
    const { result } = await chatOnce(answer);
    expect(result).toEqual({
      kind: 'ok',
      content: '{"a":1}',
      thinking: 'hmm',
      doneReason: 'length',
      model: 'qwen3:1.7b',
      metrics: {
        totalDurationNs: 1_200_000_000,
        loadDurationNs: null,
        promptEvalCount: 900,
        promptEvalCachedCount: 600,
        evalCount: null,
      },
    });
  });

  it('reports a missing response model as null and an empty thinking as null', async () => {
    const { result } = await chatOnce(
      contentAnswer('{}', { model: undefined, message: { thinking: '' } }),
    );
    expect(result.kind === 'ok' && result.model).toBeNull();
    expect(result.kind === 'ok' && result.thinking).toBeNull();
  });
});
