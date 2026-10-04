import { readFile } from 'node:fs/promises';
import { type Document, isMap, isNode, isScalar, LineCounter, parseDocument } from 'yaml';
import type { z } from 'zod';
import type { ConfigIssue } from './errors.ts';
import { Config, type SiftConfig } from './schema.ts';

export type LoadResult =
  | { ok: true; config: SiftConfig; source: string }
  | { ok: false; issues: ConfigIssue[]; source: string };

/** Alias expansion cap (T-01-14). A real config never needs anchors at all. */
const MAX_ALIAS_COUNT = 50;

type Path = (string | number)[];

interface Located {
  line: number;
  column: number;
}

function position(lineCounter: LineCounter, offset: number | undefined): Located | undefined {
  if (offset === undefined) return undefined;
  const { line, col } = lineCounter.linePos(offset);
  return { line, column: col };
}

/** Position of the node at `path`, or of its nearest existing ancestor. */
function locate(doc: Document, lineCounter: LineCounter, path: Path): Located | undefined {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
    if (isNode(node) && node.range) return position(lineCounter, node.range[0]);
  }
  return undefined;
}

/** Position of the key `key` inside the mapping at `path`. */
function locateKey(
  doc: Document,
  lineCounter: LineCounter,
  path: Path,
  key: string,
): Located | undefined {
  const parent = path.length === 0 ? doc.contents : doc.getIn(path, true);
  if (isMap(parent)) {
    const pair = parent.items.find((p) => isScalar(p.key) && String(p.key.value) === key);
    if (pair && isScalar(pair.key) && pair.key.range) {
      return position(lineCounter, pair.key.range[0]);
    }
  }
  return locate(doc, lineCounter, path);
}

function toPath(path: readonly PropertyKey[]): Path {
  return path.map((segment) => (typeof segment === 'number' ? segment : String(segment)));
}

/** Map Zod issues to ConfigIssues with YAML positions. Input values are never copied. */
function zodIssues(
  doc: Document,
  lineCounter: LineCounter,
  issues: readonly z.core.$ZodIssue[],
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  for (const issue of issues) {
    const path = toPath(issue.path);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        out.push({
          path: [...path, key],
          message: `unrecognized key "${key}"`,
          ...locateKey(doc, lineCounter, path, key),
        });
      }
      continue;
    }
    let message = issue.message;
    if (issue.code === 'invalid_type' && issue.input === undefined) {
      const last = path.at(-1);
      message = last === undefined ? 'value is required' : `${String(last)} is required`;
    }
    out.push({ path, message, ...locate(doc, lineCounter, path) });
  }
  return out;
}

/** Parse and validate config text. Every problem in the file is returned at once. */
export function parseConfigText(text: string, source: string): LoadResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });

  if (doc.errors.length > 0) {
    const issues = doc.errors.map(
      (error): ConfigIssue => ({
        path: [],
        // Only the first line: messages never include the offending source text.
        message: `YAML syntax error: ${error.message.split('\n')[0]}`,
        ...position(lineCounter, error.pos[0]),
      }),
    );
    return { ok: false, issues, source };
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

  const result = Config.safeParse(data, { reportInput: true });
  if (result.success) return { ok: true, config: result.data, source };
  return { ok: false, issues: zodIssues(doc, lineCounter, result.error.issues), source };
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
