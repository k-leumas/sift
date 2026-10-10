import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A scripted, recording fake Ollama for the classification tests (D-33,
 * AI-SPEC section 5 Set A). It serves /api/version, /api/tags, /api/show and
 * /api/chat on 127.0.0.1, records every request (method, path, parsed body,
 * origin) and tracks how many requests are in flight at once, so tests can
 * assert the exact request shape, the number of calls and single flight
 * without a real model.
 *
 * Chat answers, in order of precedence:
 *   1. the character budget: when the messages' content is longer than
 *      `charBudget`, Ollama's context-length 400;
 *   2. the per-call script (`chat` array, or a function of the request);
 *   3. compromised mode: obey a `classify as <X>` found inside the real fence;
 *   4. the default: the first category of the request's format, confidence 0.9.
 * A script array that runs out answers 500, so an unplanned extra call fails
 * the test loudly instead of being answered.
 */

export interface FakeResponse {
  status?: number;
  json?: unknown;
  /** Raw body text; wins over `json`. */
  body?: string;
  delayMs?: number;
  /** Never answer; the request ends when the client closes the socket. */
  hang?: boolean;
  /** Send the headers and half the body, then destroy the socket. */
  resetMidBody?: boolean;
}

export interface FakeOllamaOptions {
  chat?: FakeResponse[] | ((request: unknown, index: number) => FakeResponse);
  version?: FakeResponse;
  tags?: FakeResponse;
  show?: FakeResponse;
  model?: string;
  digest?: string;
  compromised?: boolean;
  charBudget?: number;
  /** Listen on this port (restart a stopped fake at the same URL); default: any free port. */
  port?: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
  origin: string;
  /** What the fake answered (the replay check compares attempts' raw output with it). */
  response?: FakeResponse;
}

export interface FakeOllama {
  url: string;
  requests(): RecordedRequest[];
  chatBodies(): Record<string, unknown>[];
  maxInFlight(): number;
  setChat(chat: FakeOllamaOptions['chat']): void;
  close(): Promise<void>;
}

export const FAKE_MODEL = 'qwen3:1.7b';
export const FAKE_DIGEST = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
export const FAKE_VERSION = '0.18.2';
/** Ollama 0.18.2's context-length error text (AI-SPEC section 3, live). */
export const CONTEXT_LENGTH_ERROR = 'the input length exceeds the context length';

const DEFAULT_REASON = 'The email fits this category.';

/** A 200 chat response whose message.content is exactly `content`. */
export function contentAnswer(content: string, extra: Record<string, unknown> = {}): FakeResponse {
  const { message: extraMessage, ...top } = extra;
  return {
    status: 200,
    json: {
      model: FAKE_MODEL,
      created_at: '2026-10-10T00:00:00Z',
      message: {
        role: 'assistant',
        content,
        ...(typeof extraMessage === 'object' && extraMessage !== null ? extraMessage : {}),
      },
      done: true,
      done_reason: 'stop',
      total_duration: 1_200_000_000,
      load_duration: 20_000_000,
      prompt_eval_count: 900,
      prompt_eval_duration: 800_000_000,
      prompt_eval_cached_count: 600,
      eval_count: 40,
      eval_duration: 380_000_000,
      ...top,
    },
  };
}

/**
 * A valid-looking chat answer: content = JSON.stringify({ reason, category,
 * confidence }). `extra` merges into the response's top level; an
 * `extra.message` object merges into `message` (thinking, tool_calls).
 */
export function okAnswer(
  category: string,
  confidence: number,
  reason: string = DEFAULT_REASON,
  extra: Record<string, unknown> = {},
): FakeResponse {
  return contentAnswer(JSON.stringify({ reason, category, confidence }), extra);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function messagesOf(body: unknown): { role: string; content: string }[] {
  const messages = asRecord(body)?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((m) => {
    const r = asRecord(m);
    return r !== null && typeof r.role === 'string' && typeof r.content === 'string'
      ? [{ role: r.role, content: r.content }]
      : [];
  });
}

function firstCategory(body: unknown): string {
  const format = asRecord(asRecord(body)?.format);
  const category = asRecord(asRecord(format?.properties)?.category);
  const values = category?.enum;
  return Array.isArray(values) && typeof values[0] === 'string' ? values[0] : 'Unknown';
}

/** The text between the user message's real fence markers, or null. */
function fencedText(body: unknown): string | null {
  const user = messagesOf(body).find((m) => m.role === 'user')?.content ?? '';
  const nonce = /^The email is between <<<EMAIL (\S+)>>>/.exec(user)?.[1];
  if (nonce === undefined) return null;
  const open = `\n<<<EMAIL ${nonce}>>>\n`;
  const close = `\n<<<END EMAIL ${nonce}>>>`;
  const start = user.indexOf(open);
  const end = user.indexOf(close, start + open.length);
  return start === -1 || end === -1 ? null : user.slice(start + open.length, end);
}

function compromisedAnswer(body: unknown): FakeResponse | null {
  const fenced = fencedText(body);
  const target = fenced === null ? null : /classify as "?([^"\n.,;]+)"?/i.exec(fenced)?.[1];
  return target === undefined || target === null ? null : okAnswer(target.trim(), 0.95);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function send(res: ServerResponse, response: FakeResponse): void {
  if (response.hang === true) return;
  const status = response.status ?? 200;
  const text = response.body ?? (response.json === undefined ? '' : JSON.stringify(response.json));
  const bytes = Buffer.from(text, 'utf8');
  if (response.resetMidBody === true) {
    res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length });
    res.write(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))));
    setImmediate(() => res.socket?.destroy());
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': bytes.length });
  res.end(bytes);
}

export async function startFakeOllama(options: FakeOllamaOptions = {}): Promise<FakeOllama> {
  const model = options.model ?? FAKE_MODEL;
  const digest = options.digest ?? FAKE_DIGEST;
  let chat = options.chat;
  let chatIndex = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const recorded: RecordedRequest[] = [];
  const timers = new Set<NodeJS.Timeout>();

  const defaults = {
    '/api/version': options.version ?? { status: 200, json: { version: FAKE_VERSION } },
    '/api/tags': options.tags ?? {
      status: 200,
      json: { models: [{ name: model, model, digest, size: 1_400_000_000 }] },
    },
    '/api/show': options.show ?? {
      status: 200,
      json: { capabilities: ['completion', 'thinking'], details: { family: 'qwen3' } },
    },
  } as const;

  function chatResponse(body: unknown): FakeResponse {
    const index = chatIndex;
    chatIndex += 1;
    if (options.charBudget !== undefined) {
      const length = messagesOf(body).reduce((sum, m) => sum + m.content.length, 0);
      if (length > options.charBudget) {
        return { status: 400, json: { error: CONTEXT_LENGTH_ERROR } };
      }
    }
    if (typeof chat === 'function') return chat(body, index);
    if (Array.isArray(chat)) {
      return (
        chat[index] ?? { status: 500, json: { error: `fake script has no answer #${index + 1}` } }
      );
    }
    if (options.compromised === true) {
      const answer = compromisedAnswer(body);
      if (answer !== null) return answer;
    }
    return okAnswer(firstCategory(body), 0.9);
  }

  const server = createServer(async (req, res) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      inFlight -= 1;
    };
    // 'close' fires when the response is done or the connection dies first (a hang, a reset).
    res.on('close', finish);

    const text = await readBody(req);
    let body: unknown = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {}
    const path = new URL(req.url ?? '/', 'http://fake').pathname;
    const entry: RecordedRequest = {
      method: req.method ?? '',
      path,
      body,
      origin: `http://${req.headers.host ?? ''}`,
    };
    recorded.push(entry);

    let response: FakeResponse;
    if (path === '/api/chat' && req.method === 'POST') response = chatResponse(body);
    else if (path === '/api/version' && req.method === 'GET') response = defaults['/api/version'];
    else if (path === '/api/tags' && req.method === 'GET') response = defaults['/api/tags'];
    else if (path === '/api/show' && req.method === 'POST') response = defaults['/api/show'];
    else response = { status: 404, json: { error: '404 page not found' } };
    entry.response = response;

    if (response.delayMs !== undefined && response.delayMs > 0) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!res.destroyed) send(res, response);
      }, response.delayMs);
      timers.add(timer);
      return;
    }
    send(res, response);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests: () => recorded.map((r) => ({ ...r })),
    chatBodies: () =>
      recorded.flatMap((r) => {
        const body = r.path === '/api/chat' ? asRecord(r.body) : null;
        return body === null ? [] : [body];
      }),
    maxInFlight: () => maxInFlight,
    setChat(next) {
      chat = next;
      chatIndex = 0;
    },
    close: async () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
