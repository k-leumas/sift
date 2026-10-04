import type { ConfigIssue } from './errors.ts';
import type { LoadResult } from './load.ts';
import { HttpUrl, type SiftConfig } from './schema.ts';

type Env = Readonly<Record<string, string | undefined>>;

export type EnvCheck =
  | { ok: true }
  | { ok: false; missing: { name: string; slugs: string[] }[]; message: string };

/** Source label for issues that come from the process environment. */
const ENV_SOURCE = 'environment';

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

/** password_env names with the slugs that use them, in config order. */
function passwordVars(config: SiftConfig): Map<string, string[]> {
  const vars = new Map<string, string[]>();
  for (const mailbox of config.mailboxes) {
    const name = mailbox.imap.password_env;
    const slugs = vars.get(name);
    if (slugs) {
      slugs.push(mailbox.slug);
    } else {
      vars.set(name, [mailbox.slug]);
    }
  }
  return vars;
}

/**
 * D-35 presence check. Undefined, empty and whitespace-only values are missing.
 * The message names variables and slugs only, never a value (T-01-15).
 */
export function checkMailboxEnv(config: SiftConfig, env: Env): EnvCheck {
  const missing: { name: string; slugs: string[] }[] = [];
  for (const [name, slugs] of passwordVars(config)) {
    if (isBlank(env[name])) missing.push({ name, slugs });
  }
  if (missing.length === 0) return { ok: true };

  const parts = missing.map(({ name, slugs }) => {
    const quoted = slugs.map((slug) => `"${slug}"`).join(', ');
    return `${name} (${slugs.length === 1 ? 'mailbox' : 'mailboxes'} ${quoted})`;
  });
  return { ok: false, missing, message: `Missing env vars: ${parts.join(', ')}` };
}

/**
 * Environment overrides (D-60): a non-blank SIFT_MODELS_URL replaces models.url
 * after the same http(s) URL check. Returns a new config; the input is untouched.
 */
export function applyEnvOverrides(config: SiftConfig, env: Env): LoadResult {
  const override = env.SIFT_MODELS_URL?.trim();
  if (!override) return { ok: true, config, source: ENV_SOURCE };

  if (!HttpUrl.safeParse(override).success) {
    const issue: ConfigIssue = {
      path: ['env', 'SIFT_MODELS_URL'],
      message: 'SIFT_MODELS_URL must be an http:// or https:// URL',
    };
    return { ok: false, issues: [issue], source: ENV_SOURCE };
  }
  return {
    ok: true,
    config: { ...config, models: { ...config.models, url: override } },
    source: ENV_SOURCE,
  };
}

/** Non-blank values of every password_env variable, for redactText. */
export function secretValues(config: SiftConfig, env: Env): string[] {
  const values: string[] = [];
  for (const name of passwordVars(config).keys()) {
    const value = env[name];
    if (value !== undefined && !isBlank(value)) values.push(value);
  }
  return values;
}
