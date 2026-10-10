// RED stub (03-05 Task 2): replaced by the implementation in the GREEN commit.
import type { RetryCode, TrustedPromptInput, UntrustedEmail } from './prompt.ts';

export interface PromptMaterial {
  hash: string;
  template: string;
  schemaShape: Record<string, unknown>;
}

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

export const PROMPT_MATERIAL_PARTS: Readonly<PromptMaterialParts> = Object.freeze({
  renderSystem: () => '',
  renderUser: () => '',
  retryNotes: { not_json: '', truncated: '', out_of_category: '', schema_mismatch: '' },
  schemaShape: {},
  modelOptions: {},
  requestFlags: {},
  limits: { body_max_chars: 0, header_max_chars: 0, max_attachment_names: 0, reason_max_chars: 0 },
});

export function promptMaterialFrom(_parts: PromptMaterialParts): PromptMaterial {
  return { hash: '', template: '', schemaShape: {} };
}

export function promptMaterial(): PromptMaterial {
  return promptMaterialFrom(PROMPT_MATERIAL_PARTS);
}
