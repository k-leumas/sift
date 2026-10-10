import {
  type LlmAttemptSpan,
  type LlmOutput,
  llmOutputSchema,
  MODEL_OPTIONS,
  makeNonce,
  ollamaFormat,
  RETRY_NOTE,
  type RetryCode,
  renderMessages,
  type TrustedPromptInput,
  type UntrustedEmail,
  validateLlmOutput,
} from '@sift/core/classify';
import type { InfraCode, LlmCallMetrics, LlmClient } from './ollama-client.ts';

/**
 * The LLM tier for one message (D-22..D-24, AI-SPEC section 4): call,
 * re-validate, retry once, verdict. At most two attempts; a retry happens only
 * for invalid output, and the second attempt differs from the first only by a
 * fresh nonce and the closed-set retry note (Pitfall 4). The confidence
 * threshold is not applied here: decide() in @sift/core/classify does that.
 *
 * Only `message.content` can influence the verdict. Tool calls, extra response
 * keys and `thinking` are never read for meaning (CLS-05); a non-empty
 * `thinking` is recorded on the attempt as an anomaly.
 */

/** Same shape as decide()'s LlmVerdict, plus the response model, or a no-verdict outcome. */
export type LlmTierResult =
  | { kind: 'decided'; output: LlmOutput; attempts: LlmAttemptSpan[]; responseModel: string | null }
  | {
      kind: 'review';
      reason: 'invalid_output' | 'out_of_category' | 'input_too_long';
      attempts: LlmAttemptSpan[];
      responseModel: string | null;
    }
  /** Write NO decision (D-16): the message stays pending. */
  | { kind: 'infra'; code: InfraCode; status: number | null; detail: string }
  | { kind: 'aborted' };

/** Fixed attempt detail for Ollama's context-length 400: its error text can quote the prompt. */
const CONTEXT_400_DETAIL = 'Ollama refused the prompt as longer than the context';

const MAX_ATTEMPTS = 2;

/** Prompt tokens at which the answer's room (num_predict) is gone: treated as input_too_long. */
const CONTEXT_BUDGET = MODEL_OPTIONS.num_ctx - MODEL_OPTIONS.num_predict;

function metricsSpan(metrics: LlmCallMetrics): NonNullable<LlmAttemptSpan['metrics']> {
  return {
    total_duration_ns: metrics.totalDurationNs,
    load_duration_ns: metrics.loadDurationNs,
    prompt_eval_count: metrics.promptEvalCount,
    prompt_eval_cached_count: metrics.promptEvalCachedCount,
    eval_count: metrics.evalCount,
  };
}

export async function runLlmTier(
  client: LlmClient,
  model: string,
  trusted: TrustedPromptInput,
  email: UntrustedEmail,
  shutdown: AbortSignal,
): Promise<LlmTierResult> {
  const [first, ...rest] = trusted.categories.map((c) => c.name);
  if (first === undefined) throw new Error('runLlmTier: the rules snapshot has no categories');
  const schema = llmOutputSchema([first, ...rest]);
  const format = ollamaFormat(schema);

  const attempts: LlmAttemptSpan[] = [];
  let responseModel: string | null = null;
  let retryNote: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (shutdown.aborted) return { kind: 'aborted' };
    const nonce = makeNonce(); // fresh per call (D-21)
    const result = await client.chat(
      {
        model,
        messages: renderMessages(trusted, email, nonce, retryNote),
        format,
        options: { ...MODEL_OPTIONS },
      },
      shutdown,
    );
    if (result.kind === 'aborted') return result;
    if (result.kind === 'infra') {
      return { kind: 'infra', code: result.code, status: result.status, detail: result.detail };
    }
    if (result.kind === 'input_too_long') {
      // Same input next time: retrying is pointless and must not stall the mailbox.
      attempts.push({
        nonce,
        raw: null,
        thinking: null,
        done_reason: null,
        metrics: null,
        validation: { ok: false, code: 'input_too_long', detail: CONTEXT_400_DETAIL },
      });
      return { kind: 'review', reason: 'input_too_long', attempts, responseModel };
    }

    responseModel = result.model;
    const base = {
      nonce,
      raw: result.content,
      thinking: result.thinking,
      done_reason: result.doneReason,
      metrics: metricsSpan(result.metrics),
    };

    // E11: a prompt that filled the context left no room to be read whole, even if
    // Ollama did not refuse it. Same input next time, so no retry.
    const promptTokens = result.metrics.promptEvalCount;
    if (promptTokens !== null && promptTokens >= CONTEXT_BUDGET) {
      attempts.push({
        ...base,
        validation: {
          ok: false,
          code: 'input_too_long',
          detail: 'prompt_eval_count reached the context budget',
        },
      });
      return { kind: 'review', reason: 'input_too_long', attempts, responseModel };
    }

    const checked =
      result.doneReason === 'length'
        ? ({ ok: false, failure: { code: 'truncated', detail: 'num_predict reached' } } as const)
        : validateLlmOutput(schema, result.content);
    if (checked.ok) {
      attempts.push({ ...base, validation: { ok: true } });
      return { kind: 'decided', output: checked.value, attempts, responseModel };
    }
    const code: RetryCode = checked.failure.code;
    attempts.push({
      ...base,
      validation: { ok: false, code, detail: checked.failure.detail },
    });
    if (attempt === MAX_ATTEMPTS) {
      const reason = code === 'out_of_category' ? 'out_of_category' : 'invalid_output';
      return { kind: 'review', reason, attempts, responseModel };
    }
    retryNote = RETRY_NOTE[code];
  }
  throw new Error('runLlmTier: unreachable');
}
