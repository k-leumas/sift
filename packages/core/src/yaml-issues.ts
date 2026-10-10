import { type Document, isMap, isNode, isScalar, type LineCounter } from 'yaml';
import type { z } from 'zod';
import { type ConfigIssue, formatPath } from './config/errors.ts';

/**
 * YAML position and Zod-issue mapping shared by the config.yaml and rules.yaml
 * loaders, so both report problems in the same `<file>:<line>:<col> <path>:`
 * form (P1 D-57). Input values are never copied into a message.
 */

export type Path = (string | number)[];

export interface Located {
  line: number;
  column: number;
}

export function position(
  lineCounter: LineCounter,
  offset: number | undefined,
): Located | undefined {
  if (offset === undefined) return undefined;
  const { line, col } = lineCounter.linePos(offset);
  return { line, column: col };
}

/** Position of the node at `path`, or of its nearest existing ancestor. */
export function locate(doc: Document, lineCounter: LineCounter, path: Path): Located | undefined {
  for (let depth = path.length; depth >= 0; depth--) {
    const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
    if (isNode(node) && node.range) return position(lineCounter, node.range[0]);
  }
  return undefined;
}

/** Position of the key `key` inside the mapping at `path`. */
export function locateKey(
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

export function toPath(path: readonly PropertyKey[]): Path {
  return path.map((segment) => (typeof segment === 'number' ? segment : String(segment)));
}

/** Per-parse fallback for a missing value; replaced with "<key> is required" in zodIssues. */
export const REQUIRED = '\u0000required';

/**
 * The per-parse `error` option for safeParse: a missing value gets the REQUIRED
 * sentinel; anything else falls through to the schema's own message.
 */
export function requiredErrorMap(issue: { code?: string; input?: unknown }): string | undefined {
  return issue.code === 'invalid_type' && issue.input === undefined ? REQUIRED : undefined;
}

/**
 * Map Zod issues to ConfigIssues with YAML positions. Input values are never
 * copied. Unrecognized keys whose formatted path is in `alreadyReported` are skipped.
 */
export function zodIssues(
  doc: Document,
  lineCounter: LineCounter,
  issues: readonly z.core.$ZodIssue[],
  alreadyReported: ReadonlySet<string>,
): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  for (const issue of issues) {
    const path = toPath(issue.path);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        const keyPath = [...path, key];
        if (alreadyReported.has(formatPath(keyPath))) continue;
        out.push({
          path: keyPath,
          message: `unrecognized key "${key}"`,
          ...locateKey(doc, lineCounter, path, key),
        });
      }
      continue;
    }
    let message = issue.message;
    if (message === REQUIRED) {
      const last = path.at(-1);
      message = last === undefined ? 'value is required' : `${String(last)} is required`;
    }
    out.push({ path, message, ...locate(doc, lineCounter, path) });
  }
  return out;
}

/** File order: by line, then column; issues without a position go last. */
export function byPosition(a: ConfigIssue, b: ConfigIssue): number {
  const line = (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
  return line !== 0 ? line : (a.column ?? 0) - (b.column ?? 0);
}

/**
 * One issue per YAML syntax error. Only the first line of each message is kept,
 * so messages never include the offending source text.
 */
export function yamlSyntaxIssues(doc: Document, lineCounter: LineCounter): ConfigIssue[] {
  return doc.errors.map(
    (error): ConfigIssue => ({
      path: [],
      message: `YAML syntax error: ${error.message.split('\n')[0]}`,
      ...position(lineCounter, error.pos[0]),
    }),
  );
}
