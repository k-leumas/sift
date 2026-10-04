import { parseArgs } from 'node:util';
import { SUPPORTED_CONFIG_VERSION } from '@sift/core';
import { COMMANDS, type CommandIO, type CommandSpec, loadCommand } from './command.ts';

/** Exit code for usage errors (no command, unknown command). */
const EXIT_USAGE = 2;

export function usage(): string {
  const width = Math.max(...COMMANDS.map((c) => c.usage.length));
  const lines = COMMANDS.map((c) => `  ${c.usage.padEnd(width)}  ${c.summary}`);
  return [
    'Usage: sift <command> [options]',
    '',
    'Commands:',
    ...lines,
    '',
    `Config file: config/config.yaml (override with SIFT_CONFIG). Supported config version: ${SUPPORTED_CONFIG_VERSION}`,
  ].join('\n');
}

/** Pick the command whose path is the longest prefix of the leading positionals. */
function matchCommand(positionals: readonly string[]): CommandSpec | undefined {
  let best: CommandSpec | undefined;
  for (const spec of COMMANDS) {
    const fits =
      spec.path.length <= positionals.length && spec.path.every((w, i) => positionals[i] === w);
    if (fits && (best === undefined || spec.path.length > best.path.length)) {
      best = spec;
    }
  }
  return best;
}

export async function main(argv: readonly string[], io: CommandIO): Promise<number> {
  const { values, tokens } = parseArgs({
    args: [...argv],
    options: { help: { type: 'boolean', short: 'h' } },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  // Leading positionals select the command; everything after them belongs to it.
  const leading: string[] = [];
  for (const token of tokens) {
    if (token.kind !== 'positional') break;
    leading.push(token.value);
  }

  if (values.help === true || leading[0] === 'help') {
    io.stdout(usage());
    return 0;
  }

  if (argv.length === 0) {
    io.stderr(usage());
    return EXIT_USAGE;
  }

  const spec = matchCommand(leading);
  if (spec === undefined) {
    const words = leading.length > 0 ? leading.join(' ') : argv.join(' ');
    io.stderr(`Unknown command: ${words}. Run "sift --help".`);
    return EXIT_USAGE;
  }

  try {
    const command = await loadCommand(spec);
    return await command.run(argv.slice(spec.path.length), io);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`sift: ${message}`);
    return 1;
  }
}

if (import.meta.main) {
  const io: CommandIO = {
    env: process.env,
    cwd: process.cwd(),
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  };
  // Set exitCode instead of calling process.exit so buffered output is flushed.
  process.exitCode = await main(process.argv.slice(2), io);
}
