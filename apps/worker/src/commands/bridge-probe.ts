import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { applyEnvOverrides, formatIssue, loadConfig } from '@sift/core/config';
import { redactText } from '@sift/core/log';
import type { CommandIO } from '../command.ts';
import { classifyImapError, closeImap, type ImapFlow, openImap } from '../imap/connect.ts';
import { type ProbeReport, preAuthCapabilities, runProbe } from '../spike/probe.ts';

const COMMAND = 'sift bridge probe';
export const USAGE =
  'Usage: sift bridge probe <slug> [--label-test] [--uid <n>] [--wait-new-seconds <n>] ' +
  '[--compare <file|->] [--sample <n>] [--scan-limit <n>]';

const DEFAULT_SAMPLE = 20;
const MAX_SAMPLE = 200;
const DEFAULT_SCAN_LIMIT = 500;
const MAX_SCAN_LIMIT = 10_000;
const MAX_UID = 0xffff_ffff;
const MAX_WAIT_SECONDS = 3_600;

interface ProbeArgs {
  slug: string;
  labelTest: boolean;
  uid: number | null;
  waitNewSeconds: number | null;
  compare: string | null;
  sample: number;
  scanLimit: number;
}

/** A whole number in [min, max] written in plain digits, or null. */
function wholeNumber(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined || !/^\d{1,10}$/.test(raw)) return null;
  const value = Number(raw);
  return value >= min && value <= max ? value : null;
}

class UsageError extends Error {}

const OPTIONS = {
  'label-test': { type: 'boolean' },
  uid: { type: 'string' },
  'wait-new-seconds': { type: 'string' },
  compare: { type: 'string' },
  sample: { type: 'string' },
  'scan-limit': { type: 'string' },
} as const;

function parseStrict(args: readonly string[]) {
  return parseArgs({ args: [...args], options: OPTIONS, strict: true, allowPositionals: true });
}

function parseProbeArgs(args: readonly string[]): ProbeArgs {
  let parsed: ReturnType<typeof parseStrict>;
  try {
    parsed = parseStrict(args);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  const { values, positionals } = parsed;
  const [slug] = positionals;
  if (positionals.length !== 1 || slug === undefined) throw new UsageError('expected one slug');

  const optional = (name: 'uid' | 'wait-new-seconds', max: number): number | null => {
    const raw = values[name];
    if (raw === undefined) return null;
    const value = wholeNumber(raw, 1, max);
    if (value === null) throw new UsageError(`--${name} must be a whole number from 1 to ${max}`);
    return value;
  };
  const bounded = (name: 'sample' | 'scan-limit', fallback: number, max: number): number => {
    const raw = values[name];
    if (raw === undefined) return fallback;
    const value = wholeNumber(raw, 0, max);
    if (value === null) throw new UsageError(`--${name} must be a whole number from 0 to ${max}`);
    return value;
  };

  return {
    slug,
    labelTest: values['label-test'] === true,
    uid: optional('uid', MAX_UID),
    waitNewSeconds: optional('wait-new-seconds', MAX_WAIT_SECONDS),
    compare: values.compare ?? null,
    sample: bounded('sample', DEFAULT_SAMPLE, MAX_SAMPLE),
    scanLimit: bounded('scan-limit', DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT),
  };
}

/**
 * `sift bridge probe <slug>` (SPK-01..04, D-43): measure the mailbox's IMAP
 * server over the same STARTTLS and pin path as the worker, and print one JSON
 * report of aggregates on stdout. Read-only. Progress on stderr holds counts only;
 * no mail content, address or personal folder name is ever printed (Pitfall 13).
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  let opts: ProbeArgs;
  try {
    opts = parseProbeArgs(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`${COMMAND}: ${error.message}`);
    io.stderr(USAGE);
    return 2;
  }

  const path = resolveConfigPath(io.env, io.cwd);
  const loaded = await loadConfig(path);
  if (!loaded.ok) {
    for (const issue of loaded.issues) io.stderr(formatIssue(issue, path));
    return 1;
  }
  const overridden = applyEnvOverrides(loaded.config, io.env);
  if (!overridden.ok) {
    for (const issue of overridden.issues) io.stderr(formatIssue(issue, overridden.source));
    return 1;
  }
  const mailbox = overridden.config.mailboxes.find((m) => m.slug === opts.slug);
  if (mailbox === undefined) {
    io.stderr(`${COMMAND}: no mailbox with slug "${opts.slug}" in ${path}`);
    return 1;
  }
  const { imap } = mailbox;
  const pass = io.env[imap.password_env];
  if (pass === undefined || pass.trim() === '') {
    io.stderr(
      `${COMMAND}: environment variable ${imap.password_env} (password_env of mailbox "${mailbox.slug}") is not set`,
    );
    return 1;
  }
  const secrets = [pass];

  let client: ImapFlow | undefined;
  try {
    // Plaintext pre-login capabilities exist only on a STARTTLS port; an
    // implicit-TLS port speaks TLS from the first byte.
    const pre =
      imap.tls.mode === 'starttls'
        ? await preAuthCapabilities(imap.host, imap.port)
        : { greeting: [], capability: [] };
    client = await openImap({
      host: imap.host,
      port: imap.port,
      user: imap.username,
      pass,
      tls: {
        mode: imap.tls.mode,
        ...(imap.tls.pin_sha256 === undefined ? {} : { pinSha256: imap.tls.pin_sha256 }),
      },
      // The probe must see the raw ENABLE result, not ImapFlow's own ENABLE.
      disableAutoEnable: true,
    });
    io.stderr(`${COMMAND}: connected; scanning at most ${opts.scanLimit} messages`);

    const report: ProbeReport = await runProbe(client, {
      folder: imap.folder,
      sample: opts.sample,
      scanLimit: opts.scanLimit,
    });
    report.capabilities.greeting = pre.greeting;
    report.capabilities.preAuth = pre.capability;
    io.stderr(
      `${COMMAND}: scanned ${report.identity.scanned} messages, sampled ${report.sample.length}`,
    );

    io.stdout(JSON.stringify(report, null, 2));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${COMMAND}: ${classifyImapError(error)}: ${redactText(message, secrets)}`);
    return 1;
  } finally {
    if (client !== undefined) await closeImap(client);
  }
}
