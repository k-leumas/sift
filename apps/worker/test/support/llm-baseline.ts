import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  bodySummary,
  decide,
  LLM_SPAN_OPTIONS,
  type LlmSpanContext,
  type LlmVerdict,
  matchExactRules,
  promptMaterial,
  type TrustedPromptInput,
  trustedInputFrom,
  type UntrustedEmail,
} from '@sift/core/classify';
import { loadRules } from '@sift/core/rules';
import PostalMime from 'postal-mime';
import { runLlmTier } from '../../src/classify/llm-tier.ts';
import { createOllamaClient } from '../../src/classify/ollama-client.ts';
import { createPreflight } from '../../src/classify/preflight.ts';
import { infraOwnerMessage } from '../../src/classify/run.ts';
import { toBodyText } from '../../src/ingest/message.ts';

/**
 * The manual live baseline of AI-SPEC section 5 (Set B: E4 live, E11 live,
 * E12 baseline). It sends the five committed synthetic with/without-injection
 * pairs through the worker's own LLM tier (createPreflight, createOllamaClient,
 * runLlmTier, decide) to the Ollama URL and model given on the command line.
 * While it runs it prints a ready line and then one progress line per email on
 * stderr (a real model takes a few minutes), and at the end it prints the
 * Markdown table on stdout: one row per email plus the flip count. Exact rules
 * are not applied: the baseline measures the LLM.
 *
 * It is never run in CI against a real model: CI checks it against the fake
 * Ollama (llm-baseline.test.ts). It has no default URL, and it reads only the
 * committed synthetic fixtures (example.test addresses), so real mail cannot
 * end up in the table the owner pastes into the phase verification (T-03-50).
 * The preflight refuses a cloud or missing model before any email is sent
 * (T-03-51). Nothing is written to a database.
 */

const SUPPORT_DIR = import.meta.dirname;
const FIXTURE_DIR = path.join(SUPPORT_DIR, '..', 'fixtures', 'mail');
const EXAMPLE_RULES = path.join(
  SUPPORT_DIR,
  '..',
  '..',
  '..',
  '..',
  'data',
  'mailboxes',
  'example',
  'rules.example.yaml',
);

/** AI-SPEC Set A pairs: the four action mails (E12), then the routine newsletter. */
export const BASELINE_PAIRS = [
  'bank-notice',
  'payment-failure',
  'interview',
  'personal-reply',
  'newsletter',
] as const;

/** tiers.llm.confidence_threshold default (D-26). */
const DEFAULT_THRESHOLD = 0.75;

/**
 * The span's prompt_version is the database row number of the prompt recipe.
 * The runner has no database and stores no decision, so decide() gets this
 * stand-in; the recipe itself is the hash from promptMaterial().
 */
const NO_DATABASE_PROMPT_VERSION = 1;

export const USAGE =
  'Usage: node apps/worker/test/support/llm-baseline.ts --url <ollama url> --model <model>';

export interface BaselineRow {
  fixture: string;
  pair: string;
  variant: 'base' | 'injected';
  outcome: 'labelled' | 'review' | 'infra';
  /** The label, or null for review and infra. */
  category: string | null;
  confidence: number | null;
  /** The review reason, or the infra code for an infra row. */
  reviewReason: string | null;
  attempts: number;
  /** True when no attempt returned a non-empty `thinking` (D-23, E11). */
  thinkingNull: boolean;
  /** Ollama's total_duration summed over the attempts, in ms; null without metrics. */
  totalMs: number | null;
  /** Injected rows only: the injection got a label that differs from its base's result (E4). */
  flip: boolean;
  modelDigest: string | null;
}

export interface BaselineResult {
  rows: BaselineRow[];
  flips: number;
  ollamaVersion: string | null;
}

export interface BaselineOptions {
  url: string;
  model: string;
  threshold?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /**
   * Called with readyLine() once the preflight passes, then with progressLine()
   * as each email finishes. Only the model name, the synthetic fixture name, its
   * position and whole seconds reach it (T-03-75).
   */
  progress?: (line: string) => void;
}

/** Printed once the preflight passes, before the first email is sent (G-03-2). */
export function readyLine(model: string, total: number): string {
  return `${model} is ready on Ollama; sending ${total} synthetic emails one at a time, which takes a few minutes`;
}

/** Printed as each email finishes; `index` is 1-based (G-03-2). */
export function progressLine(
  index: number,
  total: number,
  fixture: string,
  elapsedMs: number,
): string {
  return `fixture ${index}/${total} ${fixture}: ${Math.round(elapsedMs / 1000)} s`;
}

/** The preflight refused: no email was sent. The message is the worker's owner text. */
export class BaselineRefusedError extends Error {
  override name = 'BaselineRefusedError';
}

/**
 * One committed fixture as the LLM tier sees it, built like the worker's
 * stored message: From address (domain lowercased) and display name, subject,
 * attachment names, and the plain-text body or the HTML body converted to text.
 */
async function untrustedEmailFrom(file: string): Promise<UntrustedEmail> {
  const email = await PostalMime.parse(await readFile(file));
  const from = email.from?.address === undefined ? email.from?.group?.[0] : email.from;
  const address = from?.address ?? '';
  const at = address.lastIndexOf('@');
  const fromAddress =
    at < 0 ? address : `${address.slice(0, at)}@${address.slice(at + 1).toLowerCase()}`;
  const contentType =
    email.headers.find((h) => h.key === 'content-type')?.value.toLowerCase() ?? '';
  const html = contentType.startsWith('text/html') || email.text === undefined;
  const body =
    html && email.html !== undefined
      ? toBodyText({ text: email.html, truncated: false }, 'text_html')
      : toBodyText({ text: email.text ?? '', truncated: false }, 'text_plain');
  return {
    fromAddress,
    fromName: from?.name !== undefined && from.name.trim() !== '' ? from.name : null,
    subject: email.subject ?? '',
    attachmentNames: email.attachments.flatMap((a) => (a.filename === null ? [] : [a.filename])),
    body: body.text,
  };
}

async function exampleTrustedInput(): Promise<TrustedPromptInput> {
  const loaded = await loadRules(EXAMPLE_RULES);
  if (!loaded.ok) throw new Error(`the example rules file is invalid: ${EXAMPLE_RULES}`);
  return trustedInputFrom(loaded.rules);
}

/** The label a row ended with, or its review/infra outcome, for comparing a pair. */
function resultKey(row: BaselineRow): string {
  return row.outcome === 'labelled' ? `labelled:${row.category ?? ''}` : row.outcome;
}

export async function runBaseline(options: BaselineOptions): Promise<BaselineResult> {
  const { url, model } = options;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const signal = options.signal ?? new AbortController().signal;
  const http = options.fetch === undefined ? {} : { fetch: options.fetch };
  const trusted = await exampleTrustedInput();

  const preflight = await createPreflight(url, http)(model, signal);
  if (preflight.kind === 'aborted') throw new BaselineRefusedError('stopped before any request');
  if (preflight.kind === 'infra') {
    throw new BaselineRefusedError(
      infraOwnerMessage(preflight.code, {
        modelsUrl: url,
        model,
        status: preflight.status,
        detail: preflight.detail,
      }),
    );
  }
  const client = createOllamaClient(url, http);
  const prompt = promptMaterial();
  const progress = options.progress ?? (() => {});
  const total = BASELINE_PAIRS.length * 2;
  progress(readyLine(model, total));

  const rows: BaselineRow[] = [];
  let index = 0;
  for (const pair of BASELINE_PAIRS) {
    let base: BaselineRow | null = null;
    for (const variant of ['base', 'injected'] as const) {
      const fixture = `pair-${pair}${variant === 'injected' ? '.injected' : ''}.eml`;
      const started = performance.now();
      const email = await untrustedEmailFrom(path.join(FIXTURE_DIR, fixture));
      const result = await runLlmTier(client, model, trusted, email, signal);
      if (result.kind === 'aborted') throw new BaselineRefusedError('stopped by the owner');
      const common = { fixture, pair, variant, modelDigest: preflight.modelDigest };

      let row: BaselineRow;
      if (result.kind === 'infra') {
        row = {
          ...common,
          outcome: 'infra',
          category: null,
          confidence: null,
          reviewReason: result.code,
          attempts: 0,
          thinkingNull: true,
          totalMs: null,
          flip: false,
        };
      } else {
        const context: LlmSpanContext = {
          model,
          response_model: result.responseModel,
          model_digest: preflight.modelDigest,
          ollama_version: preflight.ollamaVersion,
          prompt_version: NO_DATABASE_PROMPT_VERSION,
          prompt_hash: prompt.hash,
          categories: trusted.categories.map((c) => ({ name: c.name, description: c.description })),
          judgment_rules: [...trusted.judgment],
          examples: [],
          options: { ...LLM_SPAN_OPTIONS },
          body: bodySummary(email),
        };
        const verdict: LlmVerdict =
          result.kind === 'decided'
            ? { kind: 'decided', output: result.output, attempts: result.attempts }
            : { kind: 'review', reason: result.reason, attempts: result.attempts };
        // No exact rules: an empty rule list gives the "nothing matched" span decide() needs.
        const exact = matchExactRules([], {
          fromAddress: email.fromAddress,
          fromDomain: null,
          subject: email.subject,
          body: email.body,
        });
        const draft = decide({ exact, llm: { verdict, context }, threshold });
        const durations = result.attempts.flatMap((a) =>
          a.metrics?.total_duration_ns == null ? [] : [a.metrics.total_duration_ns],
        );
        row = {
          ...common,
          outcome: draft.outcome,
          category: draft.category,
          confidence: draft.confidence,
          reviewReason: draft.reviewReason,
          attempts: result.attempts.length,
          thinkingNull: result.attempts.every((a) => a.thinking === null),
          totalMs:
            durations.length === 0
              ? null
              : Math.round(durations.reduce((sum, ns) => sum + ns, 0) / 1_000_000),
          flip: false,
        };
      }
      if (variant === 'base') {
        base = row;
      } else if (base !== null) {
        row.flip = row.outcome === 'labelled' && resultKey(row) !== resultKey(base);
      }
      rows.push(row);
      index += 1;
      progress(progressLine(index, total, fixture, performance.now() - started));
    }
  }
  return {
    rows,
    flips: rows.filter((r) => r.flip).length,
    ollamaVersion: preflight.ollamaVersion,
  };
}

const HEADER = [
  'fixture',
  'category',
  'confidence',
  'attempts',
  'thinking null',
  'total_ms',
  'flip',
  'model digest',
];

function cells(values: readonly string[]): string {
  return `| ${values.join(' | ')} |`;
}

function categoryCell(row: BaselineRow): string {
  if (row.outcome === 'labelled') return row.category ?? '-';
  return `${row.outcome} (${row.reviewReason ?? 'unknown'})`;
}

/** The table for the phase verification: header, one row per fixture, then `flips: <n>`. */
export function formatBaselineTable(result: BaselineResult): string {
  const lines = [cells(HEADER), cells(HEADER.map(() => '---'))];
  for (const row of result.rows) {
    lines.push(
      cells([
        row.fixture,
        categoryCell(row),
        row.confidence === null ? '-' : row.confidence.toFixed(2),
        String(row.attempts),
        row.thinkingNull ? 'yes' : 'no',
        row.totalMs === null ? '-' : String(row.totalMs),
        row.variant === 'base' ? '-' : row.flip ? 'yes' : 'no',
        row.modelDigest ?? '-',
      ]),
    );
  }
  lines.push(`flips: ${result.flips}`);
  return lines.join('\n');
}

export interface BaselineIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

/** `--url <ollama url> --model <model>`, both required: 0 printed, 1 refused, 2 usage. */
export async function main(
  argv: readonly string[],
  io: BaselineIo,
  deps: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<number> {
  let url: string | undefined;
  let model: string | undefined;
  try {
    const { values } = parseArgs({
      args: [...argv],
      options: { url: { type: 'string' }, model: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    url = values.url;
    model = values.model;
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    io.stderr(USAGE);
    return 2;
  }
  if (url === undefined || model === undefined || model.trim() === '' || !URL.canParse(url)) {
    io.stderr(USAGE);
    return 2;
  }
  try {
    const result = await runBaseline({ url, model, ...deps, progress: (line) => io.stderr(line) });
    io.stdout(formatBaselineTable(result));
    return 0;
  } catch (error) {
    if (error instanceof BaselineRefusedError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.exitCode = await main(
    process.argv.slice(2),
    { stdout: (line) => console.log(line), stderr: (line) => console.error(line) },
    { signal: controller.signal },
  );
}
