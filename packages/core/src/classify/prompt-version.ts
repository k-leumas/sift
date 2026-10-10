import { canonicalJson, sha256Hex } from './canonical.ts';
import { llmOutputSchema, ollamaFormat, REASON_MAX_CHARS } from './llm-output.ts';
import {
  BODY_MAX_CHARS,
  HEADER_MAX_CHARS,
  MAX_ATTACHMENT_NAMES,
  MODEL_OPTIONS,
  REQUEST_FLAGS,
  RETRY_NOTE,
  type RetryCode,
  renderSystem,
  renderUser,
  type TrustedPromptInput,
  type UntrustedEmail,
} from './prompt.ts';

/**
 * The material that keys the unscoped prompt_version table (D-29). It is
 * independent of every mailbox: the template is rendered from placeholders,
 * so a mailbox's categories and judgment lines never reach the hash (they are
 * the rule_set's business). The hash covers everything else that shapes a
 * request: the template text, the retry notes, the output schema shape, the
 * model options, the request flags and the limits.
 */
export interface PromptMaterial {
  /** SHA-256 hex of the canonical JSON of all parts. */
  hash: string;
  /** Placeholder render a human can read: system, user, retry notes. */
  template: string;
  /** The Ollama `format` for one placeholder category. */
  schemaShape: Record<string, unknown>;
}

/** The inputs of the hash; the real ones are PROMPT_MATERIAL_PARTS. Tests swap one part. */
export interface PromptMaterialParts {
  renderSystem: (input: TrustedPromptInput) => string;
  renderUser: (email: UntrustedEmail, nonce: string, retryNote?: string) => string;
  retryNotes: Readonly<Record<RetryCode, string>>;
  schemaShape: Record<string, unknown>;
  modelOptions: Readonly<Record<string, number>>;
  requestFlags: Readonly<Record<string, boolean | string>>;
  limits: Readonly<{
    body_max_chars: number;
    header_max_chars: number;
    max_attachment_names: number;
    reason_max_chars: number;
  }>;
}

const PLACEHOLDER_INPUT: TrustedPromptInput = {
  categories: [{ name: '<category>', description: '<description>' }],
  judgment: ['<rule>'],
};

const PLACEHOLDER_EMAIL: UntrustedEmail = {
  fromAddress: '<from_address>',
  fromName: '<from_name>',
  subject: '<subject>',
  attachmentNames: ['<attachment>'],
  body: '<body>',
};

const PLACEHOLDER_NONCE = 'NONCE';
const SEPARATOR = '\n----\n';
const RETRY_CODES: readonly RetryCode[] = [
  'not_json',
  'truncated',
  'out_of_category',
  'schema_mismatch',
];

export const PROMPT_MATERIAL_PARTS: Readonly<PromptMaterialParts> = Object.freeze({
  renderSystem,
  renderUser,
  retryNotes: RETRY_NOTE,
  schemaShape: ollamaFormat(llmOutputSchema(['<category>'])),
  modelOptions: MODEL_OPTIONS,
  requestFlags: REQUEST_FLAGS,
  limits: Object.freeze({
    body_max_chars: BODY_MAX_CHARS,
    header_max_chars: HEADER_MAX_CHARS,
    max_attachment_names: MAX_ATTACHMENT_NAMES,
    reason_max_chars: REASON_MAX_CHARS,
  }),
});

/** Prompt material from explicit parts; promptMaterial() passes the real ones. */
export function promptMaterialFrom(parts: PromptMaterialParts): PromptMaterial {
  const template = [
    parts.renderSystem(PLACEHOLDER_INPUT),
    parts.renderUser(PLACEHOLDER_EMAIL, PLACEHOLDER_NONCE),
    RETRY_CODES.map((code) => parts.retryNotes[code]).join('\n'),
  ].join(SEPARATOR);
  const hash = sha256Hex(
    canonicalJson({
      template,
      schema_shape: parts.schemaShape,
      model_options: parts.modelOptions,
      request_flags: parts.requestFlags,
      limits: parts.limits,
    }),
  );
  return { hash, template, schemaShape: structuredClone(parts.schemaShape) };
}

/** The current prompt's material; its hash keys prompt_version (D-29). */
export function promptMaterial(): PromptMaterial {
  return promptMaterialFrom(PROMPT_MATERIAL_PARTS);
}
