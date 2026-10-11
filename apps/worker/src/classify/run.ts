import {
  bodySummary,
  type DecisionDraft,
  decide,
  LLM_SPAN_OPTIONS,
  type LlmSpanContext,
  type LlmVerdict,
  llmOutputSchema,
  MODEL_OPTIONS,
  matchExactRules,
  ollamaFormat,
  promptMaterial,
  type TrustedPromptInput,
  trustedInputFrom,
} from '@sift/core/classify';
import { type ConfigIssue, formatPath } from '@sift/core/config';
import { codedCause } from '@sift/core/log';
import {
  loadRules,
  type RuleSetVersion,
  type RulesConfig,
  ruleSetVersionOf,
  rulesPathFor,
} from '@sift/core/rules';
import {
  type AppDb,
  type ClassifyCandidate,
  ensurePromptVersion,
  ensureRuleSet,
  type IngestSession,
  recordDecision,
  withIngestLock,
} from '@sift/db';
import { runLlmTier } from './llm-tier.ts';
import {
  createOllamaClient,
  type InfraCode,
  LLM_CALL_TIMEOUT_MS,
  type LlmCallResult,
  type LlmClient,
  type OllamaHttpOptions,
} from './ollama-client.ts';
import { createPreflight } from './preflight.ts';
import { gateClient, gatePreflight, type SingleFlight } from './single-flight.ts';
import { matchableOf, untrustedEmailOf } from './untrusted-email.ts';

/**
 * The per-mailbox classification pass (D-14..D-18, CLS-01, CLS-02, CLS-06):
 * read the owner's rules file, scan pending mail newest first in small locked
 * chunks, decide each message by an exact rule or by the local LLM, and store
 * every decision through recordDecision, the single write path.
 *
 * - Messages are handled one after another, never fanned out in parallel
 *   (AI-SPEC section 4b): Ollama sees one request at a time and a failure
 *   stays inside its own message.
 * - An Ollama outage is never a decision (D-16): the LLM-bound messages stay
 *   pending, no further Ollama call is made in the pass, and exact-rule
 *   decisions keep being written.
 * - A chat 5xx or timeout is first checked with the mail-free preflight: if
 *   Ollama answers it, only that message is skipped for the pass (no
 *   decision, it stays pending), up to OLLAMA_MESSAGE_FAILURES_PER_PASS;
 *   otherwise it is an outage (D-16, CR-01).
 * - A done pass reports the ids it could not classify; the batch stores them
 *   as a non-error owner notice (unclassifiedNotice, WR-03).
 * - Logs carry the mailbox slug, message ids, counts and codes only, never
 *   email text, model output or Ollama's error text (SEC-01, T-03-26).
 */

/** Messages read per ingest-lock acquisition (RESEARCH A5: sift classify waits one chunk at most). */
export const CLASSIFY_CHUNK_SIZE = 5;
/** /api/chat calls per pass (D-18); a message is started only while fewer were made. */
export const LLM_CALLS_PER_TICK = 25;
/** Messages examined per pass, exact-rule ones included, so a backlog never reads every body. */
export const MAX_EXAMINED_PER_TICK = 500;
/** Per-message failures in a row that stop the pass (the last error is thrown). */
export const MAX_CONSECUTIVE_MESSAGE_FAILURES = 5;
/** Rules-file problems listed in the owner message (mailbox_status.last_error is capped). */
export const RULES_PROBLEMS_IN_STATUS = 5;

/**
 * Chat failures one input can cause on its own: a runner crash on that prompt
 * (HTTP 5xx) or a prompt too slow to evaluate on CPU (timeout). Such a result
 * is checked with a fresh preflight before it counts as an outage; every
 * other code is an outage at once (D-16, CR-01).
 */
export const MESSAGE_FAILURE_CODES: readonly InfraCode[] = ['server_error', 'timeout'];
/**
 * Messages per pass Ollama may fail on alone (healthy re-probe). The next
 * such failure in the pass is treated as an outage, so a runner that crashes
 * on every prompt while /api/tags still answers is caught.
 */
export const OLLAMA_MESSAGE_FAILURES_PER_PASS = 2;
/** The warn line for a message skipped because Ollama failed on it alone. */
export const OLLAMA_MESSAGE_FAILURE_LOG =
  'classify: Ollama failed on this message only; skipped this pass';
/** Message ids named in the owner notice for unclassified messages; the rest are counted. */
export const NOTICE_MAX_IDS = 3;
/**
 * Passes, in one worker process, in which Ollama failed on a message alone
 * before this process stops sending it to Ollama (WR-03, T-03-65). The count
 * is in memory, so a worker restart tries the message again.
 */
export const MESSAGE_FAILURE_PASSES = 3;
/** The warn line for a message this process no longer sends to Ollama. */
export const MESSAGE_HELD_BACK_LOG =
  'classify: Ollama failed on this message in every pass; not sent again until the worker restarts';
/** The fixed system text of the mail-free canary chat (not prompt material). */
export const CANARY_SYSTEM =
  'You check that the model can answer. Reply with the JSON object the format asks for.';
/** The fixed user text of the mail-free canary chat: no email, ever. */
export const CANARY_USER = 'This is a fixed test request from Sift. It contains no email.';

/**
 * The owner notice for messages a pass could not classify (WR-03): Ollama
 * failed on them alone, they threw, or they had no body. It is stored in
 * mailbox_status.last_error while the state stays ok, and null clears it.
 *
 * It holds message ids, counts and fixed text only, never mail text or
 * Ollama's error text (T-03-31). The ids let the owner find the message: in
 * the worker log, with SQL, or with sift classify --message. At most
 * NOTICE_MAX_IDS ids are listed, in the order the pass met them.
 */
export function unclassifiedNotice(ids: readonly string[]): string | null {
  const n = ids.length;
  if (n === 0) return null;
  const shown = ids.slice(0, NOTICE_MAX_IDS).join(', ');
  const more = n > NOTICE_MAX_IDS ? `; and ${n - NOTICE_MAX_IDS} more` : '';
  return `${plural(n, 'message')} could not be classified (ids: ${shown}${more}); see docker compose logs worker`;
}

/** The command that prints every rules-file problem. */
const CONFIG_CHECK_COMMAND = 'docker compose run --rm --no-deps worker sift config check';

export type Preflight = ReturnType<typeof createPreflight>;

/** What a classification pass needs besides the database; one per worker process. */
export interface ClassifyRuntime {
  dataDir: string;
  modelsUrl: string;
  llm: LlmClient;
  preflight: Preflight;
  /** prompt_version rows by material hash, resolved once per process. */
  promptVersions: Map<string, { id: string; version: number }>;
  /** Passes in which Ollama failed on a message alone, by message id; per worker process (WR-03). */
  messageFailures: Map<string, number>;
}

/**
 * The runtime for one worker process. The client and preflight always go
 * through `gate` (D-19); the overrides exist for tests and are gated too.
 */
export function createClassifyRuntime(options: {
  dataDir: string;
  modelsUrl: string;
  gate: SingleFlight;
  timeoutMs?: number;
  fetch?: typeof fetch;
  llm?: LlmClient;
  preflight?: Preflight;
}): ClassifyRuntime {
  const http: OllamaHttpOptions = {};
  if (options.fetch !== undefined) http.fetch = options.fetch;
  const llm =
    options.llm ??
    createOllamaClient(options.modelsUrl, {
      ...http,
      timeoutMs: options.timeoutMs ?? LLM_CALL_TIMEOUT_MS,
    });
  const preflight = options.preflight ?? createPreflight(options.modelsUrl, http);
  return {
    dataDir: options.dataDir,
    modelsUrl: options.modelsUrl,
    llm: gateClient(llm, options.gate),
    preflight: gatePreflight(preflight, options.gate),
    promptVersions: new Map(),
    messageFailures: new Map(),
  };
}

export type MailboxRules =
  | {
      ok: true;
      path: string;
      rules: RulesConfig;
      version: RuleSetVersion;
      trusted: TrustedPromptInput;
    }
  | { ok: false; path: string; issues: ConfigIssue[]; message: string };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * The owner message for an unusable rules file (D-05): the file, the first
 * RULES_PROBLEMS_IN_STATUS problems with their line and YAML path, how many
 * more there are and the command that lists them all. A single file-level
 * problem that already names the file (not found, unreadable) is used as is.
 */
export function rulesProblemMessage(path: string, issues: readonly ConfigIssue[]): string {
  const [only] = issues;
  if (issues.length === 1 && only !== undefined && only.message.includes(path)) {
    return only.message;
  }
  const shown = issues.slice(0, RULES_PROBLEMS_IN_STATUS).map((issue) => {
    const where = formatPath(issue.path);
    return issue.line === undefined
      ? `${where}: ${issue.message}`
      : `line ${issue.line} ${where}: ${issue.message}`;
  });
  const more =
    issues.length > RULES_PROBLEMS_IN_STATUS
      ? `; and ${issues.length - RULES_PROBLEMS_IN_STATUS} more`
      : '';
  return `rules file ${path} has ${plural(issues.length, 'problem')}: ${shown.join('; ')}${more}. See them all with: ${CONFIG_CHECK_COMMAND}`;
}

/** Read and version the mailbox's rules file; read on every pass, so an edit needs no restart. */
export async function loadMailboxRules(dataDir: string, slug: string): Promise<MailboxRules> {
  const path = rulesPathFor(dataDir, slug);
  const loaded = await loadRules(path);
  if (!loaded.ok) {
    return {
      ok: false,
      path,
      issues: loaded.issues,
      message: rulesProblemMessage(path, loaded.issues),
    };
  }
  return {
    ok: true,
    path,
    rules: loaded.rules,
    version: ruleSetVersionOf(loaded.rules),
    trusted: trustedInputFrom(loaded.rules),
  };
}

/** A bare code such as ECONNREFUSED: the only part of a result's detail an owner message may show. */
const BARE_CODE = /^[A-Z0-9_]+$/;
/** The client's and preflight's own timeout detail (code-generated, never Ollama's text). */
const TIMEOUT_DETAIL = /^no answer in (\d+) ms$/;

/**
 * The owner-facing text for an Ollama outage (D-16, RESEARCH Pattern 7). It
 * names the server by origin only (no userinfo) and never includes the
 * result's detail, which can hold Ollama's error text and so quote the
 * prompt (T-03-25), except a bare error code.
 */
export function infraOwnerMessage(
  code: InfraCode,
  ctx: { modelsUrl: string; model: string; status: number | null; detail: string },
): string {
  const origin = new URL(ctx.modelsUrl).origin;
  const { model, status } = ctx;
  switch (code) {
    case 'unreachable':
      return `Ollama unreachable at ${origin} (${BARE_CODE.test(ctx.detail) ? ctx.detail : 'unreachable'})`;
    case 'timeout': {
      const ms = TIMEOUT_DETAIL.exec(ctx.detail)?.[1];
      const seconds = ms === undefined ? LLM_CALL_TIMEOUT_MS / 1000 : Number(ms) / 1000;
      return `Ollama unreachable at ${origin} (timeout after ${seconds} s)`;
    }
    case 'model_missing':
      return `Ollama at ${origin} has no model ${model}; run: ollama pull ${model}`;
    case 'remote_model':
      return `models.llm ${model} is a cloud model on Ollama at ${origin}; Sift never sends mail off this machine, so classification is paused. Set models.llm to a local model`;
    case 'model_unsuitable':
      return `Ollama model ${model} cannot classify (no completion capability); set models.llm to an instruct model`;
    case 'busy':
      return `Ollama at ${origin} is busy (HTTP ${status ?? 'unknown'}); Sift retries with backoff`;
    case 'server_error':
      return status !== null && status !== 200
        ? `Ollama at ${origin} failed (HTTP ${status}); see the Ollama log`
        : `Ollama at ${origin} failed (invalid response); see the Ollama log`;
    case 'rejected':
      return `Ollama at ${origin} rejected Sift's request (HTTP 400); this is a Sift or config problem, see the worker log`;
    default: {
      // A new InfraCode without a message fails typecheck here.
      const unhandled: never = code;
      throw new Error(`no owner message for ${String(unhandled)}`);
    }
  }
}

export type ClassifyOutcome =
  | {
      kind: 'done';
      labelled: number;
      review: number;
      llmCalls: number;
      examined: number;
      failures: number;
      /** Messages skipped this pass because Ollama failed on them alone (CR-01). */
      ollamaFailed: string[];
      /** Every message this pass could not classify, in the order it met them (WR-03). */
      unclassified: string[];
    }
  | { kind: 'rules_invalid'; message: string }
  | { kind: 'infra'; code: InfraCode; message: string; labelled: number; review: number }
  | { kind: 'busy' }
  | { kind: 'aborted' };

export interface ClassifyLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

/** What one pass has learned and done so far; shared by its chunks. */
export interface PassState {
  /** Set by the first LLM-bound message of the pass (one preflight per pass). */
  preflight: { ollamaVersion: string | null; modelDigest: string | null } | null;
  /** Set by an outage: no further Ollama call in this pass (D-16). */
  llmBlocked: { code: InfraCode; status: number | null; detail: string } | null;
  /** /api/chat calls left in this pass; null = no cap (the CLI re-run). */
  llmCallsLeft: number | null;
  /** The rule_set row of this pass's rules, once a decision has needed it. */
  ruleSetId: string | null;
  labelled: number;
  review: number;
  failures: number;
  consecutiveFailures: number;
  /** Messages Ollama failed on alone in this pass (healthy re-probe), in order (CR-01). */
  ollamaFailed: { id: string; code: InfraCode; status: number | null }[];
  /**
   * Messages this pass could not classify (Ollama failed on them alone, they
   * threw or had no body), each once, in the order the pass met them (WR-03).
   */
  unclassified: string[];
}

/** Note a message the pass could not classify, once. */
function markUnclassified(state: PassState, id: string): void {
  if (!state.unclassified.includes(id)) state.unclassified.push(id);
}

/** A pass state with nothing done yet. */
export function newPassState(llmCallsLeft: number | null): PassState {
  return {
    preflight: null,
    llmBlocked: null,
    llmCallsLeft,
    ruleSetId: null,
    labelled: 0,
    review: 0,
    failures: 0,
    consecutiveFailures: 0,
    ollamaFailed: [],
    unclassified: [],
  };
}

/** A log-safe code for a failure: a SQLSTATE or socket code, else the error's class name. */
function errorCode(error: unknown): string {
  const coded = codedCause(error);
  if (coded instanceof Error) {
    const { code } = coded as { code?: unknown };
    return typeof code === 'string' ? code : coded.name;
  }
  return 'non_error_thrown';
}

export interface ClassifyContext {
  db: AppDb;
  slug: string;
  rules: MailboxRules & { ok: true };
  model: string;
  threshold: number;
  runtime: ClassifyRuntime;
  signal: AbortSignal;
  log: ClassifyLog;
  decidedBy: 'worker' | 'rerun';
  state: PassState;
  now: () => Date;
}

/** The decision draft for one message, or why it gets none in this pass. */
type Drafted =
  | { kind: 'draft'; draft: DecisionDraft; promptVersionId: string | null }
  | { kind: 'skip' }
  | { kind: 'aborted' };

async function promptVersionFor(
  ctx: ClassifyContext,
): Promise<{ id: string; version: number; hash: string }> {
  const material = promptMaterial();
  let known = ctx.runtime.promptVersions.get(material.hash);
  if (known === undefined) {
    const row = await ensurePromptVersion(ctx.db, material);
    known = { id: row.id, version: row.version };
    ctx.runtime.promptVersions.set(material.hash, known);
  }
  return { ...known, hash: material.hash };
}

/**
 * One mail-free chat through the gated client (D-19): fixed CANARY_SYSTEM and
 * CANARY_USER text and a format whose only category is Probe. Success is
 * result.kind 'ok'; the content is not validated or stored.
 *
 * The cheap preflight re-probe (CR-01) cannot see a runner that crashes on
 * every prompt while /api/tags still answers; this chat can. It runs only
 * when a message is about to be held back, so at most once per message per
 * process, and takes one call off llmCallsLeft. The canary text is not
 * prompt material (no decision is rendered from it), so the prompt hash does
 * not change.
 */
export async function canaryChat(ctx: ClassifyContext): Promise<LlmCallResult> {
  if (ctx.state.llmCallsLeft !== null) ctx.state.llmCallsLeft -= 1;
  return ctx.runtime.llm.chat(
    {
      model: ctx.model,
      messages: [
        { role: 'system', content: CANARY_SYSTEM },
        { role: 'user', content: CANARY_USER },
      ],
      format: ollamaFormat(llmOutputSchema(['Probe'])),
      options: { ...MODEL_OPTIONS },
    },
    ctx.signal,
  );
}

async function draftFor(candidate: ClassifyCandidate, ctx: ClassifyContext): Promise<Drafted> {
  const { rules, state, threshold } = ctx;
  const exact = matchExactRules(rules.rules.rules, matchableOf(candidate));
  // An exact rule decides with no Ollama request at all (CLS-01, E9).
  if (exact.winner !== null) {
    return { kind: 'draft', draft: decide({ exact, threshold }), promptVersionId: null };
  }
  // Held back (WR-03): Ollama failed on it alone in MESSAGE_FAILURE_PASSES
  // passes of this process. No preflight, chat or budget is spent on it; it
  // stays pending and named in the notice until a restart or an exact rule.
  if ((ctx.runtime.messageFailures.get(candidate.id) ?? 0) >= MESSAGE_FAILURE_PASSES) {
    markUnclassified(state, candidate.id);
    return { kind: 'skip' };
  }
  if (state.llmBlocked !== null) return { kind: 'skip' };
  if (state.llmCallsLeft !== null && state.llmCallsLeft <= 0) return { kind: 'skip' };

  let preflight = state.preflight;
  if (preflight === null) {
    const checked = await ctx.runtime.preflight(ctx.model, ctx.signal);
    if (checked.kind === 'aborted') return { kind: 'aborted' };
    if (checked.kind === 'infra') {
      state.llmBlocked = { code: checked.code, status: checked.status, detail: checked.detail };
      return { kind: 'skip' };
    }
    preflight = { ollamaVersion: checked.ollamaVersion, modelDigest: checked.modelDigest };
    state.preflight = preflight;
  }

  const prompt = await promptVersionFor(ctx);
  const email = untrustedEmailOf(candidate);
  const result = await runLlmTier(ctx.runtime.llm, ctx.model, rules.trusted, email, ctx.signal);
  if (result.kind === 'aborted') return { kind: 'aborted' };
  if (result.kind === 'infra') {
    // Never a decision (D-16): the message stays pending either way. A 5xx
    // or timeout confined to this message (Ollama still answers the mail-free
    // preflight) skips only it, within the per-pass budget (CR-01).
    if (
      MESSAGE_FAILURE_CODES.includes(result.code) &&
      state.ollamaFailed.length < OLLAMA_MESSAGE_FAILURES_PER_PASS
    ) {
      const probe = await ctx.runtime.preflight(ctx.model, ctx.signal);
      if (probe.kind === 'aborted') return { kind: 'aborted' };
      if (probe.kind === 'ok') {
        const passes = (ctx.runtime.messageFailures.get(candidate.id) ?? 0) + 1;
        if (passes >= MESSAGE_FAILURE_PASSES) {
          // Hold it back only if Ollama answers a mail-free chat: a runner that
          // fails every prompt is an outage, not this message (T-03-67).
          const canary = await canaryChat(ctx);
          if (canary.kind === 'aborted') return { kind: 'aborted' };
          if (canary.kind !== 'ok') {
            state.llmBlocked =
              canary.kind === 'infra'
                ? { code: canary.code, status: canary.status, detail: canary.detail }
                : { code: 'rejected', status: canary.status, detail: '' };
            return { kind: 'skip' };
          }
          ctx.log.warn(
            { mailbox: ctx.slug, message: candidate.id, passes: MESSAGE_FAILURE_PASSES },
            MESSAGE_HELD_BACK_LOG,
          );
        }
        ctx.runtime.messageFailures.set(candidate.id, passes);
        state.ollamaFailed.push({ id: candidate.id, code: result.code, status: result.status });
        markUnclassified(state, candidate.id);
        if (state.llmCallsLeft !== null) state.llmCallsLeft -= 1;
        // Never result.detail: it can hold Ollama's text, which can quote the prompt (T-03-25).
        ctx.log.warn(
          { mailbox: ctx.slug, message: candidate.id, code: result.code, status: result.status },
          OLLAMA_MESSAGE_FAILURE_LOG,
        );
        return { kind: 'skip' };
      }
    }
    state.llmBlocked = { code: result.code, status: result.status, detail: result.detail };
    return { kind: 'skip' };
  }
  if (state.llmCallsLeft !== null) state.llmCallsLeft -= result.attempts.length;

  const context: LlmSpanContext = {
    model: ctx.model,
    response_model: result.responseModel,
    model_digest: preflight.modelDigest,
    ollama_version: preflight.ollamaVersion,
    prompt_version: prompt.version,
    prompt_hash: prompt.hash,
    categories: rules.trusted.categories.map((c) => ({ name: c.name, description: c.description })),
    judgment_rules: [...rules.trusted.judgment],
    examples: [],
    options: { ...LLM_SPAN_OPTIONS },
    body: bodySummary(email),
  };
  const verdict: LlmVerdict =
    result.kind === 'decided'
      ? { kind: 'decided', output: result.output, attempts: result.attempts }
      : { kind: 'review', reason: result.reason, attempts: result.attempts };
  return {
    kind: 'draft',
    draft: decide({ exact, llm: { verdict, context }, threshold }),
    promptVersionId: prompt.id,
  };
}

/**
 * Decide and record each candidate in turn (CLS-06), under the caller's
 * ingest lock. Shared by the worker pass and the sift classify re-run
 * (03-12, decidedBy 'rerun').
 *
 * A message that throws is logged with its id and an error code only and
 * counted; the others are still decided. MAX_CONSECUTIVE_MESSAGE_FAILURES in
 * a row rethrow the last error. No transaction is held open across an LLM
 * call: each decision is one short session.run.
 */
export async function classifyCandidates(
  session: IngestSession,
  candidates: readonly ClassifyCandidate[],
  ctx: ClassifyContext,
): Promise<'continue' | 'aborted'> {
  const { state } = ctx;
  for (const candidate of candidates) {
    if (ctx.signal.aborted) return 'aborted';
    try {
      if (candidate.body === null) {
        // Should not happen: eligible messages get a body and lose it only after a decision.
        ctx.log.warn({ mailbox: ctx.slug, message: candidate.id, code: 'body_missing' });
        markUnclassified(state, candidate.id);
        continue;
      }
      const drafted = await draftFor(candidate, ctx);
      if (drafted.kind === 'aborted') return 'aborted';
      if (drafted.kind === 'skip') continue;

      const known = state.ruleSetId;
      const ruleSetId = await session.run(async (scope) => {
        const id = known ?? (await ensureRuleSet(scope, ctx.rules.version)).id;
        await recordDecision(scope, {
          ...drafted.draft,
          messageId: candidate.id,
          ruleSetId: id,
          promptVersionId: drafted.promptVersionId,
          decidedBy: ctx.decidedBy,
          at: ctx.now(),
        });
        return id;
      });
      // Only after the commit: a rolled-back rule_set row must not be reused.
      state.ruleSetId = ruleSetId;
      // Decided: forget any Ollama failures it had (WR-03).
      ctx.runtime.messageFailures.delete(candidate.id);
      if (drafted.draft.outcome === 'labelled') state.labelled += 1;
      else state.review += 1;
      state.consecutiveFailures = 0;
    } catch (error) {
      ctx.log.warn(
        { mailbox: ctx.slug, message: candidate.id, code: errorCode(error) },
        'classify: message failed',
      );
      state.failures += 1;
      state.consecutiveFailures += 1;
      markUnclassified(state, candidate.id);
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_MESSAGE_FAILURES) throw error;
    }
  }
  return 'continue';
}

/**
 * One classification pass over a mailbox's pending mail (D-14..D-18).
 *
 * The rules file is read first; an unusable one returns rules_invalid and
 * nothing is classified or sent to Ollama (D-05). Pending messages are then
 * read newest INTERNALDATE first with an (internal_date, id) keyset cursor,
 * CLASSIFY_CHUNK_SIZE per ingest-lock acquisition, at most
 * MAX_EXAMINED_PER_TICK per pass. LLM work stops for the pass after
 * LLM_CALLS_PER_TICK calls or an outage; exact-rule decisions continue.
 *
 * Returns busy when another process (sift classify) holds the lock at the
 * start, aborted when the signal fired, infra after an outage, else done.
 */
export async function classifyMailbox(input: {
  db: AppDb;
  mailbox: { id: string; slug: string };
  model: string;
  threshold: number;
  runtime: ClassifyRuntime;
  signal: AbortSignal;
  log: ClassifyLog;
  now?: () => Date;
}): Promise<ClassifyOutcome> {
  const { db, mailbox, log, signal } = input;
  const rules = await loadMailboxRules(input.runtime.dataDir, mailbox.slug);
  if (!rules.ok) {
    log.warn({ mailbox: mailbox.slug, code: 'rules_invalid', problems: rules.issues.length });
    return { kind: 'rules_invalid', message: rules.message };
  }

  const state = newPassState(LLM_CALLS_PER_TICK);
  const ctx: ClassifyContext = {
    db,
    slug: mailbox.slug,
    rules,
    model: input.model,
    threshold: input.threshold,
    runtime: input.runtime,
    signal,
    log,
    decidedBy: 'worker',
    state,
    now: input.now ?? (() => new Date()),
  };

  let cursor: { internalDate: Date; id: string } | undefined;
  let examined = 0;
  let firstChunk = true;
  for (;;) {
    if (signal.aborted) return { kind: 'aborted' };
    const limit = Math.min(CLASSIFY_CHUNK_SIZE, MAX_EXAMINED_PER_TICK - examined);
    const before = cursor;
    const locked = await withIngestLock(db, mailbox.id, async (session) => {
      const page = await session.run(
        (s) =>
          s.classification.candidates({
            pendingOnly: true,
            limit,
            ...(before === undefined ? {} : { before }),
          }),
        { requireActive: true },
      );
      const step = page.length === 0 ? 'continue' : await classifyCandidates(session, page, ctx);
      return { page, step };
    });
    if (!locked.acquired) {
      if (firstChunk) return { kind: 'busy' };
      break;
    }
    firstChunk = false;
    const { page, step } = locked.value;
    examined += page.length;
    if (step === 'aborted') return { kind: 'aborted' };
    const last = page.at(-1);
    if (last !== undefined) cursor = { internalDate: last.internalDate, id: last.id };
    if (page.length < limit || examined >= MAX_EXAMINED_PER_TICK) break;
  }

  const llmCalls = LLM_CALLS_PER_TICK - (state.llmCallsLeft ?? LLM_CALLS_PER_TICK);
  log.info(
    {
      mailbox: mailbox.slug,
      labelled: state.labelled,
      review: state.review,
      llmCalls,
      examined,
      failures: state.failures,
      ollamaFailed: state.ollamaFailed.length,
    },
    'classify: pass finished',
  );
  if (state.llmBlocked !== null) {
    const { code, status, detail } = state.llmBlocked;
    log.warn({ mailbox: mailbox.slug, code, status }, 'classify: Ollama unavailable');
    return {
      kind: 'infra',
      code,
      message: infraOwnerMessage(code, {
        modelsUrl: input.runtime.modelsUrl,
        model: input.model,
        status,
        detail,
      }),
      labelled: state.labelled,
      review: state.review,
    };
  }
  return {
    kind: 'done',
    labelled: state.labelled,
    review: state.review,
    llmCalls,
    examined,
    failures: state.failures,
    ollamaFailed: state.ollamaFailed.map((f) => f.id),
    unclassified: [...state.unclassified],
  };
}
