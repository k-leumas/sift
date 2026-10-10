import { readFile } from 'node:fs/promises';
import { LineCounter, parseDocument } from 'yaml';
import type { ConfigIssue } from '../config/errors.ts';
import { byPosition, requiredErrorMap, yamlSyntaxIssues, zodIssues } from '../yaml-issues.ts';
import { RULES_EXAMPLE_PATH } from './path.ts';
import { type RulesConfig, RulesFile } from './schema.ts';

export type RulesLoadResult =
  | { ok: true; rules: RulesConfig; source: string }
  | { ok: false; issues: ConfigIssue[]; source: string };

/** Size cap checked before parsing (T-03-01). A real rules file is a few KiB. */
export const RULES_FILE_MAX_BYTES = 262_144;

/** Alias expansion cap (T-03-01), as for config.yaml (T-01-14). */
const MAX_ALIAS_COUNT = 50;

function failure(message: string, source: string): RulesLoadResult {
  return { ok: false, issues: [{ path: [], message }], source };
}

/**
 * Parse and validate rules text. Every problem in the file is returned at once,
 * in file order. Invalid values are reported, never fixed.
 */
export function parseRulesText(text: string, source: string): RulesLoadResult {
  if (Buffer.byteLength(text, 'utf8') > RULES_FILE_MAX_BYTES) {
    return failure('rules file is larger than 256 KiB', source);
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  if (doc.errors.length > 0) {
    return { ok: false, issues: yamlSyntaxIssues(doc, lineCounter), source };
  }
  if (doc.contents === null) {
    return failure('rules file is empty: expected version: 1, categories and rules', source);
  }

  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch {
    return failure(`too many YAML aliases (max ${MAX_ALIAS_COUNT})`, source);
  }

  const result = RulesFile.safeParse(data, { error: requiredErrorMap });
  if (result.success) return { ok: true, rules: result.data, source };
  const issues = zodIssues(doc, lineCounter, result.error.issues, new Set()).sort(byPosition);
  return { ok: false, issues, source };
}

/**
 * Read and validate a rules file. File problems are issues, never thrown. The
 * owner's file is only read: Sift never writes, moves or rewrites it.
 */
export async function loadRules(path: string): Promise<RulesLoadResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return failure(
      code === 'ENOENT'
        ? `rules file not found: ${path}. Copy ${RULES_EXAMPLE_PATH} to that path and edit it`
        : `cannot read rules file ${path} (${code ?? 'unknown error'})`,
      path,
    );
  }
  return parseRulesText(text, path);
}
