import {
  llmOutputSchema,
  ollamaFormat,
  type TrustedPromptInput,
  type UntrustedEmail,
} from '@sift/core/classify';
import { afterEach, describe, expect, it } from 'vitest';
import { runLlmTier } from '../src/classify/llm-tier.ts';
import { createOllamaClient } from '../src/classify/ollama-client.ts';
import { type FakeOllama, okAnswer, startFakeOllama } from './support/fake-ollama.ts';

/**
 * The LLM tier over the real HTTP path against the scripted fake Ollama
 * (D-21..D-24, D-33; AI-SPEC section 5 E1, E2, E5, E11). Never a real model.
 */

const MODEL = 'qwen3:1.7b';

const TRUSTED: TrustedPromptInput = {
  categories: [
    {
      name: 'Important',
      description: 'Mail from a real person or about money, accounts or dates.',
    },
    { name: 'Noise', description: 'Newsletters, promotions and notifications.' },
  ],
  judgment: ['A security notice from my bank is Important.'],
};

const EMAIL: UntrustedEmail = {
  fromAddress: 'news@shop.example.test',
  fromName: 'Shop News',
  subject: 'Autumn sale',
  attachmentNames: [],
  body: 'Everything is 20% off this week.',
};

const FORMAT = ollamaFormat(llmOutputSchema(['Important', 'Noise']));

let fake: FakeOllama | undefined;

afterEach(async () => {
  await fake?.close();
  fake = undefined;
});

async function start(options: Parameters<typeof startFakeOllama>[0] = {}): Promise<FakeOllama> {
  fake = await startFakeOllama(options);
  return fake;
}

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('runLlmTier tracer (D-21..D-24, E11)', () => {
  it('sends the exact request over HTTP and returns a validated verdict with its attempt', async () => {
    const answer = okAnswer('Noise', 0.92, 'A shop promotion.');
    const f = await start({ chat: [answer] });
    const client = createOllamaClient(f.url);

    const result = await runLlmTier(client, MODEL, TRUSTED, EMAIL, liveSignal());

    expect(result.kind).toBe('decided');
    if (result.kind !== 'decided') return;
    expect(result.output).toEqual({
      reason: 'A shop promotion.',
      category: 'Noise',
      confidence: 0.92,
    });
    expect(result.responseModel).toBe(MODEL);
    expect(result.attempts).toHaveLength(1);
    const [attempt] = result.attempts;
    const sent = (answer.json as { message: { content: string } }).message.content;
    expect(attempt?.raw).toBe(sent);
    expect(attempt?.validation).toEqual({ ok: true });
    expect(attempt?.thinking).toBeNull();
    expect(attempt?.done_reason).toBe('stop');
    expect(attempt?.metrics).toEqual({
      total_duration_ns: 1_200_000_000,
      load_duration_ns: 20_000_000,
      prompt_eval_count: 900,
      prompt_eval_cached_count: 600,
      eval_count: 40,
    });

    const bodies = f.chatBodies();
    expect(bodies).toHaveLength(1);
    const body = bodies[0] ?? {};
    expect(Object.keys(body).sort()).toEqual(
      [
        'format',
        'keep_alive',
        'messages',
        'model',
        'options',
        'shift',
        'stream',
        'think',
        'truncate',
      ].sort(),
    );
    expect(body).not.toHaveProperty('tools');
    expect(body.model).toBe(MODEL);
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.truncate).toBe(false);
    expect(body.shift).toBe(false);
    expect(body.keep_alive).toBe('30m');
    expect(body.options).toStrictEqual({
      temperature: 0,
      seed: 42,
      num_predict: 256,
      num_ctx: 8192,
    });
    expect(body.format).toStrictEqual(FORMAT);
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1]?.content).toContain(`<<<EMAIL ${attempt?.nonce}>>>`);
    expect(messages[1]?.content).toContain(`<<<END EMAIL ${attempt?.nonce}>>>`);
    expect(messages[0]?.content).not.toContain(EMAIL.subject);
  });
});
