import { join, resolve } from 'node:path';
import { validateSlug } from '../config/slug.ts';

/** Data directory, relative to the working directory, when SIFT_DATA is unset. */
export const DEFAULT_DATA_PATH = 'data';

/** Repo-relative example rules file the owner copies (D-04); named in owner messages. */
export const RULES_EXAMPLE_PATH = 'data/mailboxes/example/rules.example.yaml';

/**
 * Resolve the data directory. A non-blank SIFT_DATA wins; otherwise
 * DEFAULT_DATA_PATH is used. Relative paths resolve against `cwd`.
 * Always returns an absolute path.
 */
export function resolveDataPath(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): string {
  const override = env.SIFT_DATA?.trim();
  return resolve(cwd, override ? override : DEFAULT_DATA_PATH);
}

/**
 * Path of a mailbox's rules file: <dataDir>/mailboxes/<slug>/rules.yaml. The
 * slug is validated first (T-03-03): the slug pattern has no `/` or `.`, so no
 * slug can reach outside <dataDir>/mailboxes/.
 */
export function rulesPathFor(dataDir: string, slug: string): string {
  const message = validateSlug(slug);
  if (message !== null) throw new TypeError(`invalid mailbox slug: ${message}`);
  return join(dataDir, 'mailboxes', slug, 'rules.yaml');
}
