import {
  errorText,
  fetchFailure,
  type InfraCode,
  isRecord,
  type OllamaHttpOptions,
  statusCode,
} from './ollama-client.ts';

/**
 * The per-tick local-model preflight (AI-SPEC section 4 Tool Use and section
 * 6 "Preflight, local model only"; D-16, SEC-02 Phase 3 part). Before any
 * email text is sent, it confirms the server answers, the configured model is
 * pulled locally, it is not a cloud model (a `remote_host`/`remote_model`
 * tags entry would send the prompt, and so the email, off this machine) and
 * it can do plain completion. It never calls /api/chat.
 *
 * Failures use the client's infra classification; on success it returns the
 * Ollama version and the model digest for the LLM span (replay context).
 */

export const PREFLIGHT_TIMEOUT_MS = 10_000;

export type PreflightResult =
  | { kind: 'ok'; ollamaVersion: string | null; modelDigest: string | null }
  | { kind: 'infra'; code: InfraCode; status: number | null; detail: string }
  | { kind: 'aborted' };

type Failure = Exclude<PreflightResult, { kind: 'ok' }>;

/** Names a configured model may appear under in /api/tags (`qwen3` is `qwen3:latest`). */
function tagNames(model: string): string[] {
  const last = model.split('/').at(-1) ?? model;
  return last.includes(':') ? [model] : [model, `${model}:latest`];
}

/** Anything but absent, null or empty counts as set: a remote marker fails closed. */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function createPreflight(
  baseUrl: string,
  options: OllamaHttpOptions = {},
): (model: string, shutdown: AbortSignal) => Promise<PreflightResult> {
  const timeoutMs = options.timeoutMs ?? PREFLIGHT_TIMEOUT_MS;
  const fetchFn = options.fetch ?? globalThis.fetch;

  async function getJson(
    path: string,
    shutdown: AbortSignal,
    body?: unknown,
  ): Promise<{ kind: 'ok'; body: unknown } | Failure> {
    let res: Response;
    try {
      res = await fetchFn(new URL(path, baseUrl), {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined
          ? {}
          : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
        signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), shutdown]),
      });
    } catch (error) {
      return fetchFailure(error, shutdown, timeoutMs);
    }
    if (!res.ok) {
      const detail = await errorText(res);
      if (shutdown.aborted) return { kind: 'aborted' };
      return { kind: 'infra', code: statusCode(res.status), status: res.status, detail };
    }
    try {
      return { kind: 'ok', body: await res.json() };
    } catch (error) {
      if (shutdown.aborted) return { kind: 'aborted' };
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return {
        kind: 'infra',
        code: timedOut ? 'timeout' : 'server_error',
        status: res.status,
        detail: timedOut ? `no answer in ${timeoutMs} ms` : `${path} body is not JSON`,
      };
    }
  }

  return async (model, shutdown) => {
    if (shutdown.aborted) return { kind: 'aborted' };

    const version = await getJson('/api/version', shutdown);
    if (version.kind !== 'ok') return version;
    const ollamaVersion =
      isRecord(version.body) && typeof version.body.version === 'string'
        ? version.body.version
        : null;

    const tags = await getJson('/api/tags', shutdown);
    if (tags.kind !== 'ok') return tags;
    const models = isRecord(tags.body) ? tags.body.models : undefined;
    if (!Array.isArray(models)) {
      return { kind: 'infra', code: 'server_error', status: 200, detail: 'not a model list' };
    }
    const names = tagNames(model);
    const named = (value: unknown) => typeof value === 'string' && names.includes(value);
    const entry = models.find(
      (m): m is Record<string, unknown> => isRecord(m) && (named(m.name) || named(m.model)),
    );
    if (entry === undefined) {
      return {
        kind: 'infra',
        code: 'model_missing',
        status: null,
        detail: `model ${model} is not pulled (ollama pull ${model})`,
      };
    }
    if (isSet(entry.remote_host) || isSet(entry.remote_model)) {
      return {
        kind: 'infra',
        code: 'remote_model',
        status: null,
        detail: `model ${model} runs on a remote host, not on this machine`,
      };
    }
    const modelDigest = typeof entry.digest === 'string' ? entry.digest : null;

    const show = await getJson('/api/show', shutdown, { model });
    if (show.kind !== 'ok') return show;
    const capabilities = isRecord(show.body) ? show.body.capabilities : undefined;
    if (Array.isArray(capabilities) && !capabilities.includes('completion')) {
      return {
        kind: 'infra',
        code: 'model_unsuitable',
        status: null,
        detail: `model ${model} does not support completion`,
      };
    }
    return { kind: 'ok', ollamaVersion, modelDigest };
  };
}
