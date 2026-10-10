import { type ChatMessage, REQUEST_FLAGS } from '@sift/core/classify';

/**
 * The LLM tier's transport (D-16, D-22..D-24, AI-SPEC section 4): one
 * `/api/chat` call over fetch, classified into a result union so a caller
 * cannot mistake an outage for a classification. The client never throws for
 * an expected failure and never logs: Ollama's error text can quote the
 * prompt, so it stays in the result's `detail` (T-03-25).
 *
 * The request is fixed: the caller's model, messages, format and options plus
 * REQUEST_FLAGS. It never carries a `tools` key, and nothing in a response
 * except `message.content` (validated later), `message.thinking` (recorded,
 * never parsed), `done_reason`, `model` and the metric counters is read
 * (CLS-05).
 */

export interface ModelOptions {
  temperature: number;
  seed: number;
  num_predict: number;
  num_ctx: number;
}

export interface LlmChatRequest {
  model: string;
  messages: readonly ChatMessage[];
  format: Record<string, unknown>;
  options: ModelOptions;
}

export interface LlmCallMetrics {
  totalDurationNs: number | null;
  loadDurationNs: number | null;
  promptEvalCount: number | null;
  promptEvalCachedCount: number | null;
  evalCount: number | null;
}

/** Infra failures (D-16): no decision, the message stays pending, the tick's LLM work stops. */
export type InfraCode =
  | 'unreachable' // fetch rejected: ECONNREFUSED, ENOTFOUND, ECONNRESET, ...
  | 'timeout' // our AbortSignal.timeout fired
  | 'model_missing' // HTTP 404, or the preflight found no local copy
  | 'busy' // HTTP 503 (OLLAMA_MAX_QUEUE) or 429
  | 'server_error' // HTTP 5xx, or a 200 whose body is not the expected response
  | 'rejected' // HTTP 400 other than context length: our request is wrong, not the email
  | 'remote_model' // preflight: the model runs off this machine (SEC-02)
  | 'model_unsuitable'; // preflight: the model cannot do plain completion

export type LlmCallResult =
  | {
      kind: 'ok';
      content: string;
      thinking: string | null;
      doneReason: string | null;
      /** The response's `model`; null when the server did not say. */
      model: string | null;
      metrics: LlmCallMetrics;
    }
  | { kind: 'infra'; code: InfraCode; status: number | null; detail: string }
  /** Deterministic for this message: retrying never helps, so it must not block the mailbox. */
  | { kind: 'input_too_long'; status: number; detail: string }
  /** Shutdown aborted the call: not an error, not a decision. */
  | { kind: 'aborted' };

/** The model-agnostic seam (the D-33 fake, later an OpenAI-compatible provider). */
export interface LlmClient {
  chat(request: LlmChatRequest, shutdown: AbortSignal): Promise<LlmCallResult>;
}

/** Per-call timeout: below undici's 300 s headersTimeout (AI-SPEC Pitfall 5). */
export const LLM_CALL_TIMEOUT_MS = 120_000;

/** Longest piece of Ollama error text kept in a result's detail. */
export const ERROR_TEXT_MAX_CHARS = 500;

/** Ollama's context-length 400 (0.18.2 and current main wordings). */
const CONTEXT_LENGTH_TEXT = /context (length|size)|longer than the context/i;

interface OllamaChatResponse {
  model?: unknown;
  message?: { content?: unknown; thinking?: unknown };
  done?: unknown;
  done_reason?: unknown;
  total_duration?: unknown;
  load_duration?: unknown;
  prompt_eval_count?: unknown;
  prompt_eval_cached_count?: unknown;
  eval_count?: unknown;
}

export interface OllamaHttpOptions {
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** A finite, non-negative counter, else null (the span schema rejects anything else). */
function counter(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** True for a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ollama's error text, capped. It always consumes the body (undici keeps the
 * socket busy otherwise). The text can quote our prompt: it belongs in a
 * result's detail, never in a log line.
 */
export async function errorText(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && typeof body.error === 'string') {
      return body.error.slice(0, ERROR_TEXT_MAX_CHARS);
    }
  } catch {}
  return text.slice(0, ERROR_TEXT_MAX_CHARS);
}

/** The system error code behind a rejected fetch (`ECONNREFUSED`, `ENOTFOUND`, ...), else the error name. */
export function causeCode(error: unknown): string {
  const cause = typeof error === 'object' && error !== null ? Reflect.get(error, 'cause') : null;
  const code = typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : null;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.name : 'Error';
}

/** Infra class of a non-OK status (everything but the context-length 400). */
export function statusCode(status: number): InfraCode {
  if (status === 404) return 'model_missing';
  if (status === 503 || status === 429) return 'busy';
  if (status === 400) return 'rejected';
  return 'server_error';
}

/** The class of a fetch that rejected: shutdown first, then our timeout, else unreachable. */
export function fetchFailure(
  error: unknown,
  shutdown: AbortSignal,
  timeoutMs: number,
): { kind: 'aborted' } | { kind: 'infra'; code: InfraCode; status: null; detail: string } {
  if (shutdown.aborted) return { kind: 'aborted' };
  if (error instanceof Error && error.name === 'TimeoutError') {
    return { kind: 'infra', code: 'timeout', status: null, detail: `no answer in ${timeoutMs} ms` };
  }
  return { kind: 'infra', code: 'unreachable', status: null, detail: causeCode(error) };
}

export function createOllamaClient(baseUrl: string, options: OllamaHttpOptions = {}): LlmClient {
  const timeoutMs = options.timeoutMs ?? LLM_CALL_TIMEOUT_MS;
  const fetchFn = options.fetch ?? globalThis.fetch;
  const url = new URL('/api/chat', baseUrl);
  return {
    async chat(request, shutdown) {
      let res: Response;
      try {
        res = await fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            format: request.format,
            options: request.options,
            ...REQUEST_FLAGS,
          }),
          signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), shutdown]),
        });
      } catch (error) {
        return fetchFailure(error, shutdown, timeoutMs);
      }

      if (!res.ok) {
        const detail = await errorText(res);
        if (shutdown.aborted) return { kind: 'aborted' };
        // Only a 400 is our request being refused; a 5xx that mentions context is still an outage.
        if (res.status === 400 && CONTEXT_LENGTH_TEXT.test(detail)) {
          return { kind: 'input_too_long', status: res.status, detail };
        }
        return { kind: 'infra', code: statusCode(res.status), status: res.status, detail };
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (error) {
        if (shutdown.aborted) return { kind: 'aborted' };
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        return {
          kind: 'infra',
          code: timedOut ? 'timeout' : 'server_error',
          status: res.status,
          detail: timedOut ? `no answer in ${timeoutMs} ms` : 'response body is not JSON',
        };
      }
      // A 200 without done:true and a string message.content is a broken server, not an answer.
      const chat = isRecord(body) ? (body as OllamaChatResponse) : null;
      const message = isRecord(chat?.message) ? chat.message : null;
      if (
        chat === null ||
        message === null ||
        typeof message.content !== 'string' ||
        chat.done !== true
      ) {
        return {
          kind: 'infra',
          code: 'server_error',
          status: res.status,
          detail: 'not a chat response',
        };
      }
      return {
        kind: 'ok',
        content: message.content,
        thinking:
          typeof message.thinking === 'string' && message.thinking !== '' ? message.thinking : null,
        doneReason: typeof chat.done_reason === 'string' ? chat.done_reason : null,
        model: typeof chat.model === 'string' ? chat.model : null,
        metrics: {
          totalDurationNs: counter(chat.total_duration),
          loadDurationNs: counter(chat.load_duration),
          promptEvalCount: counter(chat.prompt_eval_count),
          promptEvalCachedCount: counter(chat.prompt_eval_cached_count),
          evalCount: counter(chat.eval_count),
        },
      };
    },
  };
}
