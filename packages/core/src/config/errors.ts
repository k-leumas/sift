/** One config problem. Line and column are 1-based and present when the YAML node is known. */
export interface ConfigIssue {
  path: readonly (string | number)[];
  message: string;
  line?: number;
  column?: number;
}

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Render a path YAML-style: `mailboxes[0].imap.port`, or `(root)` when empty. */
export function formatPath(path: readonly (string | number)[]): string {
  if (path.length === 0) return '(root)';
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (PLAIN_KEY.test(segment)) {
      out += out === '' ? segment : `.${segment}`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}

/** `<source>:<line>:<col> <path>: <message>`; the position part is omitted when unknown. */
export function formatIssue(issue: ConfigIssue, source: string): string {
  const where =
    issue.line === undefined
      ? source
      : `${source}:${issue.line}${issue.column === undefined ? '' : `:${issue.column}`}`;
  return `${where} ${formatPath(issue.path)}: ${issue.message}`;
}
