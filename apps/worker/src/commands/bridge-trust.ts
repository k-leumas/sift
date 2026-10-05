import { parseArgs } from 'node:util';
import { resolveConfigPath } from '@sift/core';
import { applyEnvOverrides, formatIssue, loadConfig } from '@sift/core/config';
import type { CommandIO } from '../command.ts';
import { type CapturedCertificate, capturePeerCertificate } from '../imap/capture.ts';
import { classifyImapError } from '../imap/connect.ts';

const COMMAND = 'sift bridge trust';
export const USAGE = 'Usage: sift bridge trust <slug>';

/**
 * The owner's other, independent reading of the fingerprint (D-73, D-79). The
 * same text as BRIDGE_INIT_COMMAND in runtime/mailbox-batch.ts, repeated here
 * so this command does not load the database modules.
 */
const BRIDGE_INIT_COMMAND = 'docker compose run --rm bridge-init';
const RESTART_COMMAND = 'docker compose restart worker';

/** X509Certificate.validTo as an ISO timestamp, or as given when it does not parse. */
function isoDate(validTo: string): string {
  const parsed = new Date(validTo);
  return Number.isNaN(parsed.getTime()) ? validTo : parsed.toISOString();
}

/** A fixed message per error class: never a server reply or a driver message. */
function failureMessage(error: unknown, host: string, port: number): string {
  switch (classifyImapError(error)) {
    case 'unreachable':
    case 'timeout':
      return `IMAP server unreachable at ${host}:${port}`;
    case 'no_starttls':
      return `IMAP server at ${host}:${port} does not offer STARTTLS; Sift never logs in without TLS`;
    default:
      return `IMAP server at ${host}:${port} gave an unexpected response during the TLS handshake`;
  }
}

/**
 * `sift bridge trust <slug>` (D-73): connect to the mailbox's IMAP server the
 * way the worker does (same host, port and TLS mode), read the certificate it
 * presents, print its SPKI SHA-256 fingerprint and compare it with
 * `imap.tls.pin_sha256`.
 *
 * Exit 0 when the fingerprint matches the pin. Exit 1 when no pin is set or the
 * pin differs, with the `pin_sha256:` line to paste; the owner first compares
 * it with the fingerprint `docker compose run --rm bridge-init` printed inside
 * the Bridge container. Nothing is trusted automatically: this command writes
 * no file and changes no config, so a regenerated Bridge certificate keeps
 * failing closed until the owner edits config.yaml (D-40).
 *
 * It uses only capturePeerCertificate (D-80): that connection carries the
 * greeting, one `<tag> STARTTLS` line and the TLS handshake, nothing else. The
 * mailbox's password is never read and no login is ever attempted. The
 * captured certificate stays in memory.
 *
 * It runs where the config and the Bridge network are, in the worker container:
 * `docker compose run --rm --no-deps worker sift bridge trust <slug>`.
 */
export async function run(args: readonly string[], io: CommandIO): Promise<number> {
  let positionals: string[];
  try {
    ({ positionals } = parseArgs({
      args: [...args],
      options: {},
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    io.stderr(`${COMMAND}: ${error instanceof Error ? error.message : String(error)}`);
    io.stderr(USAGE);
    return 2;
  }
  const [slug] = positionals;
  if (positionals.length !== 1 || slug === undefined) {
    io.stderr(`${COMMAND}: expected one slug`);
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
  const mailbox = overridden.config.mailboxes.find((m) => m.slug === slug);
  if (mailbox === undefined) {
    io.stderr(`${COMMAND}: no mailbox with slug "${slug}" in ${path}`);
    return 1;
  }
  const { host, port, tls } = mailbox.imap;

  let captured: CapturedCertificate;
  try {
    captured = await capturePeerCertificate({ host, port, mode: tls.mode });
  } catch (error) {
    io.stderr(`${COMMAND}: ${failureMessage(error, host, port)}`);
    return 1;
  }

  const fingerprint = captured.spkiSha256;
  io.stdout(
    `Certificate the worker sees for ${slug} (${host}:${port}): ${fingerprint} ` +
      `(valid until ${isoDate(captured.validTo)})`,
  );

  const configured = tls.pin_sha256;
  if (configured === fingerprint) {
    io.stdout('It matches imap.tls.pin_sha256.');
    return 0;
  }
  if (configured === undefined) {
    io.stdout(
      `No pin is configured for ${slug}. Compare this fingerprint with the one ` +
        `${BRIDGE_INIT_COMMAND} printed; if they are the same, add under ` +
        `mailboxes[${slug}].imap.tls in config/config.yaml:`,
    );
  } else {
    io.stdout(
      `It differs from imap.tls.pin_sha256 (${configured}). If you reinstalled Bridge, ` +
        `compare it with the one ${BRIDGE_INIT_COMMAND} printed; if they are the same, ` +
        'replace the pin in config/config.yaml:',
    );
  }
  io.stdout(`  pin_sha256: ${fingerprint}`);
  io.stdout(`Then restart the worker: ${RESTART_COMMAND}`);
  return 1;
}
