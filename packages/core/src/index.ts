import { resolve } from 'node:path';

/** Highest `version:` value in config.yaml that this build understands. */
export const SUPPORTED_CONFIG_VERSION = 1;

/** Config file location, relative to the working directory, when SIFT_CONFIG is unset. */
export const DEFAULT_CONFIG_PATH = 'config/config.yaml';

/**
 * Resolve the config file path. A non-blank SIFT_CONFIG wins; otherwise
 * DEFAULT_CONFIG_PATH is used. Relative paths resolve against `cwd`.
 * Always returns an absolute path.
 */
export function resolveConfigPath(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string = process.cwd(),
): string {
  const override = env.SIFT_CONFIG?.trim();
  return resolve(cwd, override ? override : DEFAULT_CONFIG_PATH);
}
