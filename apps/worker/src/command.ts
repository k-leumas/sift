/** Process boundary handed to every command, so commands stay testable. */
export interface CommandIO {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  stdout(line: string): void;
  stderr(line: string): void;
  /** Standard input, for the few commands that read it (bridge probe). Absent means empty. */
  stdin?: AsyncIterable<string | Buffer>;
}

/** A command module under ./commands/. `run` resolves to the process exit code. */
export interface CommandModule {
  run(args: readonly string[], io: CommandIO): Promise<number>;
}

export interface CommandSpec {
  /** Positional words that select the command, e.g. ['config', 'check']. */
  path: readonly string[];
  /** Module file name under ./commands/. */
  file: string;
  usage: string;
  summary: string;
}

/** Every Phase 1 command. Modules are loaded lazily so `--help` loads none of them. */
export const COMMANDS: readonly CommandSpec[] = [
  {
    path: ['setup'],
    file: 'setup.ts',
    usage: 'sift setup [--confirm]',
    summary: 'Bootstrap the database, run migrations and apply the config',
  },
  {
    path: ['migrate'],
    file: 'migrate.ts',
    usage: 'sift migrate',
    summary: 'Apply pending database migrations',
  },
  {
    path: ['config', 'check'],
    file: 'config-check.ts',
    usage: 'sift config check [--schema-only]',
    summary: 'Validate the config file',
  },
  {
    path: ['config', 'apply'],
    file: 'config-apply.ts',
    usage: 'sift config apply [--confirm]',
    summary: 'Sync mailboxes from the config file into the database',
  },
  {
    path: ['mailbox', 'list'],
    file: 'mailbox-list.ts',
    usage: 'sift mailbox list',
    summary: 'List registered mailboxes and their status',
  },
  {
    path: ['mailbox', 'rename'],
    file: 'mailbox-rename.ts',
    usage: 'sift mailbox rename <old-slug> <new-slug>',
    summary: 'Rename a mailbox slug, keeping its data',
  },
  {
    path: ['bridge', 'probe'],
    file: 'bridge-probe.ts',
    usage:
      'sift bridge probe <slug> [--label-test] [--uid <n>] [--wait-new-seconds <n>] ' +
      '[--compare <file|->] [--sample <n>] [--scan-limit <n>]',
    summary: 'Measure Proton Bridge IMAP behaviour (spike); prints aggregates only',
  },
  {
    path: ['worker'],
    file: 'worker.ts',
    usage: 'sift worker',
    summary: 'Run the long-lived worker process',
  },
];

/**
 * Import a command module by its spec. The specifier is computed, so tsc does
 * not require modules that later plans add, and unrelated commands (and their
 * dependencies, such as pg) are never loaded.
 */
export async function loadCommand(spec: CommandSpec): Promise<CommandModule> {
  const href = new URL(`./commands/${spec.file}`, import.meta.url).href;
  const mod: unknown = await import(href);
  if (
    typeof mod !== 'object' ||
    mod === null ||
    typeof (mod as { run?: unknown }).run !== 'function'
  ) {
    throw new Error(`Command module ${spec.file} does not export a run function`);
  }
  return mod as CommandModule;
}
