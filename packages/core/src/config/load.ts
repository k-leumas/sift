import { readFile } from 'node:fs/promises';
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import {
  byPosition,
  type Path,
  position,
  requiredErrorMap,
  yamlSyntaxIssues,
  zodIssues,
} from '../yaml-issues.ts';
import { type ConfigIssue, formatPath } from './errors.ts';
import { Config, type SiftConfig } from './schema.ts';

export type LoadResult =
  | { ok: true; config: SiftConfig; source: string }
  | { ok: false; issues: ConfigIssue[]; source: string };

/** Alias expansion cap (T-01-14). A real config never needs anchors at all. */
const MAX_ALIAS_COUNT = 50;

/** Keys that look like they hold a secret. `password_env` (a variable name) is the exception. */
const SECRET_KEY = /pass(word)?|secret|token|api[_-]?key|credential/i;

/** formatIssue already prints the full path, so the message names only the key. */
function secretMessage(key: string): string {
  return `key "${key}" looks like a secret; Sift never reads secrets from config.yaml. Use password_env: <ENV_VAR_NAME> and set the value in .env.mailboxes`;
}

/**
 * Pre-pass before Zod (D-57, T-01-13): every secret-looking key with a literal
 * scalar value is an issue located at the key. The value is never read into
 * the message.
 */
function literalSecrets(node: unknown, path: Path, lineCounter: LineCounter, out: ConfigIssue[]) {
  if (isSeq(node)) {
    node.items.forEach((item, index) => {
      literalSecrets(item, [...path, index], lineCounter, out);
    });
    return;
  }
  if (!isMap(node)) return;
  for (const pair of node.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const childPath = [...path, key];
    const literal = isScalar(pair.value) && pair.value.value !== null;
    if (key !== 'password_env' && SECRET_KEY.test(key) && literal) {
      out.push({
        path: childPath,
        message: secretMessage(key),
        ...position(lineCounter, pair.key.range?.[0]),
      });
    } else {
      literalSecrets(pair.value, childPath, lineCounter, out);
    }
  }
}

/** Parse and validate config text. Every problem in the file is returned at once. */
export function parseConfigText(text: string, source: string): LoadResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });

  if (doc.errors.length > 0) {
    return { ok: false, issues: yamlSyntaxIssues(doc, lineCounter), source };
  }

  if (doc.contents === null) {
    return {
      ok: false,
      issues: [
        { path: [], message: 'config file is empty: expected version: 1 and at least one mailbox' },
      ],
      source,
    };
  }

  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch {
    return {
      ok: false,
      issues: [{ path: [], message: `too many YAML aliases (max ${MAX_ALIAS_COUNT})` }],
      source,
    };
  }

  const secrets: ConfigIssue[] = [];
  literalSecrets(doc.contents, [], lineCounter, secrets);

  const result = Config.safeParse(data, { error: requiredErrorMap });
  if (result.success && secrets.length === 0) return { ok: true, config: result.data, source };

  const reported = new Set(secrets.map((issue) => formatPath(issue.path)));
  const issues = [
    ...secrets,
    ...(result.success ? [] : zodIssues(doc, lineCounter, result.error.issues, reported)),
  ].sort(byPosition);
  return { ok: false, issues, source };
}

/** Read and validate a config file. A missing file is reported as an issue, not thrown. */
export async function loadConfig(path: string): Promise<LoadResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const message =
      code === 'ENOENT'
        ? `config file not found: ${path}. Copy config/config.example.yaml to config/config.yaml`
        : `cannot read config file ${path} (${code ?? 'unknown error'})`;
    return { ok: false, issues: [{ path: [], message }], source: path };
  }
  return parseConfigText(text, path);
}
