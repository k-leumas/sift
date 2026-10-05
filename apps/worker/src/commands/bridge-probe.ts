import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { applyEnvOverrides, formatIssue, loadConfig } from '@sift/core/config';
import { redactText } from '@sift/core/log';
import type { CommandIO } from '../command.ts';
import { classifyImapError, closeImap, type ImapFlow, openImap } from '../imap/connect.ts';
import {
  compareReports,
  isLabelConfirmation,
  labelTest,
  labelTestPlan,
  type ProbeReport,
  parseProbeReport,
  preAuthCapabilities,
  runProbe,
  SPIKE_LABEL_NAME,
  spikeLabelPath,
  waitForNew,
} from '../spike/probe.ts';

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
/** Largest earlier report --compare reads (a 200-entry sample is far smaller). */
const MAX_REPORT_BYTES = 4 * 1024 * 1024;
/** Longest confirmation line read from stdin. */
const MAX_LINE_CHARS = 1_024;

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

function text(chunk: string | Buffer): string {
  return typeof chunk === 'string' ? chunk : chunk.toString('utf8');
}

/** One line from stdin without its line ending, or null on empty input or an over-long line. */
async function readLine(stdin: CommandIO['stdin']): Promise<string | null> {
  if (stdin === undefined) return null;
  let buffered = '';
  for await (const chunk of stdin) {
    buffered += text(chunk);
    const end = buffered.indexOf('\n');
    if (end >= 0) return buffered.slice(0, end).replace(/\r$/, '');
    if (buffered.length > MAX_LINE_CHARS) return null;
  }
  return buffered === '' ? null : buffered.replace(/\r$/, '');
}

/** All of stdin, or null past MAX_REPORT_BYTES. */
async function readAll(stdin: CommandIO['stdin']): Promise<string | null> {
  if (stdin === undefined) return '';
  let buffered = '';
  for await (const chunk of stdin) {
    buffered += text(chunk);
    if (buffered.length > MAX_REPORT_BYTES) return null;
  }
  return buffered;
}

/** The earlier report named by --compare, or null. Its content is never printed. */
async function readPreviousReport(source: string, io: CommandIO): Promise<ProbeReport | null> {
  let raw: string | null;
  try {
    if (source === '-') {
      raw = await readAll(io.stdin);
    } else {
      const bytes = await readFile(source);
      raw = bytes.length > MAX_REPORT_BYTES ? null : bytes.toString('utf8');
    }
  } catch {
    return null;
  }
  return raw === null ? null : parseProbeReport(raw);
}

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

  const labelTest = values['label-test'] === true;
  const uid = optional('uid', MAX_UID);
  // The label test needs an explicit target; the wait never chooses one (T-02-68).
  if (labelTest && uid === null) throw new UsageError('--label-test needs --uid <n>');
  if (!labelTest && uid !== null) throw new UsageError('--uid is only used with --label-test');
  if (labelTest && values.compare === '-') {
    throw new UsageError('--compare - and --label-test both read stdin; pass --compare <file>');
  }

  return {
    slug,
    labelTest,
    uid,
    waitNewSeconds: optional('wait-new-seconds', MAX_WAIT_SECONDS),
    compare: values.compare ?? null,
    sample: bounded('sample', DEFAULT_SAMPLE, MAX_SAMPLE),
    scanLimit: bounded('scan-limit', DEFAULT_SCAN_LIMIT, MAX_SCAN_LIMIT),
  };
}

/**
 * `sift bridge probe <slug>` (SPK-01..04, D-43): measure the mailbox's IMAP
 * server over the same STARTTLS and pin path as the worker, and print one JSON
 * report of aggregates on stdout. Read-only unless --label-test is given with an
 * explicit --uid and the owner types LABEL (D-11). Progress on stderr holds counts only;
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

  // Read the earlier report before connecting, so bad input changes nothing.
  let previous: ProbeReport | null = null;
  if (opts.compare !== null) {
    previous = await readPreviousReport(opts.compare, io);
    if (previous === null) {
      const source = opts.compare === '-' ? 'stdin' : opts.compare;
      io.stderr(`${COMMAND}: could not read a probe report from ${source}`);
      return 1;
    }
  }

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

    // Order: probe, wait, label test, compare.
    if (opts.waitNewSeconds !== null) {
      io.stderr(`${COMMAND}: waiting up to ${opts.waitNewSeconds} s for new mail (IDLE)`);
      report.idle = (await waitForNew(client, imap.folder, opts.waitNewSeconds)).report;
    }
    if (opts.labelTest && opts.uid !== null) {
      const delimiter = report.folders.delimiter ?? '/';
      const labelPath = spikeLabelPath(delimiter);
      io.stderr(labelTestPlan(imap.folder, opts.uid, labelPath));
      const confirmed = isLabelConfirmation(await readLine(io.stdin));
      report.labelTest = await labelTest(client, {
        folder: imap.folder,
        uid: opts.uid,
        delimiter,
        confirmed,
      });
      if (report.labelTest.labelCopyMayRemain === true) {
        io.stderr(
          `${COMMAND}: a copy may remain in ${labelPath}; remove the ${SPIKE_LABEL_NAME} label ` +
            'from that message in the Proton client',
        );
      }
    }
    if (previous !== null) report.compare = compareReports(previous, report);

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
