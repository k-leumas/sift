import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@sift/core/config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

/** Repository files the smoke script reads before it first calls docker. */
const INPUTS = [
  'scripts/compose-smoke.sh',
  '.env.example',
  '.env.mailboxes.example',
  'config/config.example.yaml',
  'backups/.gitkeep',
];

let work: string;
let bin: string;
let sudoLog: string;
let dockerLog: string;
let envLog: string;
let psLog: string;
let bridgeEnvLog: string;

function shim(name: string, body: string): void {
  const file = path.join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Run the file-preparation half of compose-smoke.sh in a scratch copy of the
 * repository. `docker` is stubbed: `docker volume ...` succeeds, every compose
 * call fails (unless SHIM_BUILD_OK lets `compose ... build` pass), so the
 * script stops at its first compose call; `uname`, `id` and `sudo` are stubbed
 * to emulate a Linux CI runner whose uid is not 1000.
 */
function runSmoke(
  os: string,
  uid: string,
  sudo = `echo "$*" >> '${sudoLog}'`,
  env: Record<string, string> = { COMPOSE_PROJECT_NAME: 'smoketest' },
  args: string[] = [],
): { status: number | null; stderr: string } {
  // `docker ps` answers from SHIM_PS_PROJECT (containers of the project) and
  // SHIM_PS_SMOKE (those mounting the smoke volume); any other call fails.
  shim(
    'docker',
    [
      'if [ "$1" = ps ]; then',
      `  echo "$*" >> '${psLog}'`,
      '  [ -z "$SHIM_PS_FAIL" ] || exit 1',
      '  case "$*" in *volume=*) printf "%s" "$SHIM_PS_SMOKE" ;; *) printf "%s" "$SHIM_PS_PROJECT" ;; esac',
      '  exit 0',
      'fi',
      `echo "$SIFT_PGDATA_VOLUME $*" >> '${dockerLog}'`,
      `echo "$SIFT_BACKUP_HOST_DIR|$SIFT_CONFIG_HOST_DIR|$SIFT_MAILBOXES_ENV_FILE|$SIFT_IMAGE" >> '${envLog}'`,
      `echo "$SIFT_BRIDGE_VOLUME|$SIFT_MAILBOXES_BAK_FILE" >> '${bridgeEnvLog}'`,
      '[ "$1" != volume ] || exit 0',
      'case "$*" in *" build "*) [ -z "$SHIM_BUILD_OK" ] || exit 0 ;; esac',
      'exit 1',
    ].join('\n'),
  );
  shim('uname', `echo ${os}`);
  shim('id', `if [ "$1" = -u ]; then echo ${uid}; else exit 1; fi`);
  shim('sudo', sudo);
  const result = spawnSync('bash', ['scripts/compose-smoke.sh', ...args], {
    cwd: work,
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH ?? ''}`, HOME: work, ...env },
    timeout: 30_000,
  });
  return { status: result.status, stderr: result.stderr };
}

/** The smoke stack's own directory for a project (physical path). */
function smokeDir(project = 'smoketest'): string {
  return path.join(realpathSync(work), '.smoke', project);
}

/** The smoke stack's own backup dir for a project (physical path). */
function smokeBackups(project = 'smoketest'): string {
  return path.join(smokeDir(project), 'backups');
}

/** The first `docker compose build` call the script makes for a project. */
function composeBuild(project = 'smoketest'): string {
  return `${project}-pgdata-smoke compose --env-file ${smokeDir(project)}/.env build setup worker`;
}

interface ExportedEnv {
  backupDir: string;
  configDir: string;
  mailboxesEnvFile: string;
  image: string;
}

/** Smoke variables as seen by the first docker invocation, or undefined. */
function exportedEnv(): ExportedEnv | undefined {
  if (!existsSync(envLog)) return undefined;
  const [backupDir = '', configDir = '', mailboxesEnvFile = '', image = ''] =
    readFileSync(envLog, 'utf8').split('\n')[0]?.split('|') ?? [];
  return { backupDir, configDir, mailboxesEnvFile, image };
}

/** SIFT_BACKUP_HOST_DIR as seen by the first docker invocation, or undefined. */
function exportedBackupDir(): string | undefined {
  return exportedEnv()?.backupDir;
}

/** Docker invocations other than `docker ps`, as "<SIFT_PGDATA_VOLUME> <args>". */
function dockerCalls(): string[] {
  if (!existsSync(dockerLog)) return [];
  return readFileSync(dockerLog, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

/** First docker invocation other than `docker ps`, or undefined. */
function firstDockerCall(): string | undefined {
  return dockerCalls()[0];
}

/** First `docker compose` invocation, or undefined. */
function firstComposeCall(): string | undefined {
  return dockerCalls().find((line) => line.includes(' compose '));
}

/** SIFT_BRIDGE_VOLUME and SIFT_MAILBOXES_BAK_FILE as seen by the first docker call. */
function exportedBridgeEnv(): { volume: string; bakFile: string } | undefined {
  if (!existsSync(bridgeEnvLog)) return undefined;
  const [volume = '', bakFile = ''] =
    readFileSync(bridgeEnvLog, 'utf8').split('\n')[0]?.split('|') ?? [];
  return { volume, bakFile };
}

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), 'sift-smoke-'));
  bin = path.join(work, 'bin');
  sudoLog = path.join(work, 'sudo.log');
  dockerLog = path.join(work, 'docker.log');
  envLog = path.join(work, 'env.log');
  psLog = path.join(work, 'ps.log');
  bridgeEnvLog = path.join(work, 'bridge-env.log');
  mkdirSync(bin);
  for (const file of INPUTS) {
    mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
    cpSync(path.join(REPO_ROOT, file), path.join(work, file));
  }
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('scripts/compose-smoke.sh file preparation (CR-01)', () => {
  it('creates config.yaml and its dir readable by the container user despite umask 077', () => {
    const { status } = runSmoke('Linux', '1001');
    expect(status).toBe(1); // stopped at the stubbed docker build
    const file = statSync(path.join(smokeDir(), 'config/config.yaml')).mode & 0o777;
    expect(file & 0o004).toBe(0o004);
    const dir = statSync(path.join(smokeDir(), 'config')).mode & 0o777;
    expect(dir & 0o005).toBe(0o005);
  });

  it('keeps the generated credential files private', () => {
    runSmoke('Linux', '1001');
    for (const file of ['.env', '.env.mailboxes']) {
      expect(statSync(path.join(smokeDir(), file)).mode & 0o077, file).toBe(0);
    }
  });

  it.skipIf(process.getuid?.() === 1000)(
    'hands the smoke backup dir to uid 1000 on a Linux host whose uid is not 1000',
    () => {
      runSmoke('Linux', '1001');
      expect(readFileSync(sudoLog, 'utf8').trim()).toBe(`-n chown 1000 ${smokeBackups()}`);
    },
  );

  it('leaves the backup dir alone on macOS and when the host uid is already 1000', () => {
    runSmoke('Darwin', '501');
    runSmoke('Linux', '1000');
    expect(existsSync(sudoLog)).toBe(false);
  });

  it('fails before starting the stack when the backup dir cannot be handed to uid 1000', () => {
    const { status, stderr } = runSmoke('Linux', '1001', 'exit 1');
    expect(status).toBe(1);
    expect(stderr).toContain(`sudo chown 1000 ${smokeBackups()}`);
    expect(firstDockerCall()).toBeUndefined();
  });
});

describe('scripts/compose-smoke.sh never touches the owner database (WR-01)', () => {
  it('runs the stack on its own volume, named after the project', () => {
    const { status } = runSmoke('Darwin', '501');
    expect(status).toBe(1);
    expect(firstComposeCall()).toBe(composeBuild());
  });

  it('refuses the default project outside CI, before creating any file', () => {
    const { status, stderr } = runSmoke('Darwin', '501', undefined, {});
    expect(status).toBe(2);
    expect(stderr).toContain('COMPOSE_PROJECT_NAME');
    expect(existsSync(path.join(work, '.smoke'))).toBe(false);
    expect(firstDockerCall()).toBeUndefined();
  });

  it('allows the default project in CI, still on a separate volume', () => {
    runSmoke('Darwin', '501', undefined, { CI: 'true' });
    const project = path.basename(work).toLowerCase();
    expect(firstComposeCall()).toBe(composeBuild(project));
  });

  it('refuses to run on sift-pgdata, even in CI', () => {
    const { status, stderr } = runSmoke('Darwin', '501', undefined, {
      CI: 'true',
      SIFT_PGDATA_VOLUME: 'sift-pgdata',
    });
    expect(status).toBe(2);
    expect(stderr).toContain('sift-pgdata');
    expect(firstDockerCall()).toBeUndefined();
  });

  it('still asks for confirmation before --down outside CI', () => {
    const { status, stderr } = runSmoke(
      'Darwin',
      '501',
      undefined,
      { COMPOSE_PROJECT_NAME: 'smoketest' },
      ['--down'],
    );
    expect(status).toBe(2);
    expect(stderr).toContain('smoketest-pgdata-smoke');
    expect(firstDockerCall()).toBeUndefined();
  });
});

describe('scripts/compose-smoke.sh never touches the owner backups (CR-02)', () => {
  it('sends the smoke dumps to .smoke/<project>/backups and leaves ./backups alone', () => {
    const { status } = runSmoke('Linux', '1001');
    expect(status).toBe(1); // stopped at the stubbed docker build
    expect(exportedBackupDir()).toBe(smokeBackups());
    expect(exportedBackupDir()).not.toBe(realpathSync(path.join(work, 'backups')));
    expect(statSync(smokeBackups()).isDirectory()).toBe(true);
    expect(readdirSync(path.join(work, 'backups'))).toEqual(['.gitkeep']);
    expect(readFileSync(sudoLog, 'utf8')).not.toMatch(/chown 1000 backups$/m);
  });

  it.each([
    ['./backups', 'backups'],
    ['the absolute ./backups path', 'ABS'],
    ['a symlink to ./backups', 'LINK'],
  ])('refuses SIFT_BACKUP_HOST_DIR = %s, before any docker call', (_label, value) => {
    let dir = value;
    if (value === 'ABS') dir = path.join(work, 'backups');
    if (value === 'LINK') {
      dir = path.join(work, 'elsewhere');
      symlinkSync(path.join(work, 'backups'), dir);
    }
    const { status, stderr } = runSmoke('Linux', '1001', undefined, {
      COMPOSE_PROJECT_NAME: 'smoketest',
      SIFT_BACKUP_HOST_DIR: dir,
    });
    expect(status).toBe(2);
    expect(stderr).toContain('./backups');
    expect(firstDockerCall()).toBeUndefined();
    expect(existsSync(sudoLog)).toBe(false);
    expect(existsSync(path.join(smokeDir(), '.env'))).toBe(false);
  });

  it('honours an explicit SIFT_BACKUP_HOST_DIR elsewhere', () => {
    runSmoke('Darwin', '501', undefined, {
      COMPOSE_PROJECT_NAME: 'smoketest',
      SIFT_BACKUP_HOST_DIR: 'custom/dumps',
    });
    expect(exportedBackupDir()).toBe(path.join(realpathSync(work), 'custom', 'dumps'));
  });
});

describe('scripts/compose-smoke.sh checks Docker state, not only env vars (WR-09)', () => {
  const ownerStack = { SHIM_PS_PROJECT: 'aaa\nbbb\nccc', SHIM_PS_SMOKE: '' };

  it.each([
    ['CI=true with the default project', { CI: 'true', ...ownerStack }],
    [
      "an explicit COMPOSE_PROJECT_NAME naming the owner's project",
      { COMPOSE_PROJECT_NAME: 'sift', SMOKE_ALLOW_VOLUME_REMOVAL: 'yes', ...ownerStack },
    ],
  ])('refuses %s when that project already runs non-smoke containers', (_label, env) => {
    const { status, stderr } = runSmoke('Darwin', '501', undefined, env, ['--down']);
    expect(status).toBe(2);
    expect(stderr).toContain('not a smoke stack');
    // Neither `up` nor the --down cleanup ran, and no file was created.
    expect(firstDockerCall()).toBeUndefined();
    expect(existsSync(path.join(work, '.smoke'))).toBe(false);
  });

  it('asks Docker about the project and the smoke volume', () => {
    runSmoke('Darwin', '501', undefined, { COMPOSE_PROJECT_NAME: 'sift', ...ownerStack });
    const calls = readFileSync(psLog, 'utf8');
    expect(calls).toContain('label=com.docker.compose.project=sift');
    expect(calls).toContain('volume=sift-pgdata-smoke');
  });

  it('accepts a rerun on an earlier smoke stack of the same project', () => {
    const { status } = runSmoke('Darwin', '501', undefined, {
      COMPOSE_PROJECT_NAME: 'smoketest',
      SHIM_PS_PROJECT: 'aaa\nbbb',
      SHIM_PS_SMOKE: 'aaa',
    });
    expect(status).toBe(1); // stopped at the stubbed docker build
    expect(firstComposeCall()).toBe(composeBuild());
  });

  it('accepts a project with no containers, as on a fresh CI runner', () => {
    runSmoke('Darwin', '501', undefined, { CI: 'true' });
    expect(firstComposeCall()).toBe(composeBuild(path.basename(work).toLowerCase()));
  });

  it('refuses when docker ps fails', () => {
    const { status, stderr } = runSmoke('Darwin', '501', undefined, {
      COMPOSE_PROJECT_NAME: 'smoketest',
      SHIM_PS_FAIL: '1',
    });
    expect(status).toBe(2);
    expect(stderr).toContain('docker ps failed');
    expect(firstDockerCall()).toBeUndefined();
  });
});

describe('scripts/compose-smoke.sh shares no files or image with the owner stack (IN-08)', () => {
  const OWNER_FILES = {
    '.env': 'POSTGRES_PASSWORD=OWNER-SENTINEL\n',
    '.env.mailboxes': 'SIFT_PERSONAL_IMAP_PASSWORD=OWNER-SENTINEL\n',
    'config/config.yaml': 'version: 1 # OWNER-SENTINEL\n',
  };

  function writeOwnerFiles(): void {
    for (const [file, text] of Object.entries(OWNER_FILES)) {
      writeFileSync(path.join(work, file), text, { mode: 0o600 });
    }
  }

  it('never reads or rewrites the owner .env, .env.mailboxes or config.yaml', () => {
    writeOwnerFiles();
    const { status } = runSmoke('Darwin', '501');
    expect(status).toBe(1); // stopped at the stubbed docker build
    for (const [file, text] of Object.entries(OWNER_FILES)) {
      expect(readFileSync(path.join(work, file), 'utf8'), file).toBe(text);
    }
    expect(firstComposeCall()).toBe(composeBuild());
    expect(exportedEnv()).toEqual({
      backupDir: smokeBackups(),
      configDir: path.join(smokeDir(), 'config'),
      mailboxesEnvFile: path.join(smokeDir(), '.env.mailboxes'),
      image: 'sift-smoke:local',
    });
    for (const file of ['.env', '.env.mailboxes', 'config/config.yaml']) {
      expect(readFileSync(path.join(smokeDir(), file), 'utf8'), file).not.toContain(
        'OWNER-SENTINEL',
      );
    }
  });

  it('does not create owner files when they are missing', () => {
    runSmoke('Darwin', '501');
    for (const file of Object.keys(OWNER_FILES)) {
      expect(existsSync(path.join(work, file)), file).toBe(false);
    }
  });

  it('points every mailbox at an unroutable host, and the config still validates', async () => {
    runSmoke('Darwin', '501');
    const file = path.join(smokeDir(), 'config/config.yaml');
    const loaded = await loadConfig(file);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.issues));
    expect(loaded.config.mailboxes.length).toBeGreaterThan(0);
    for (const mailbox of loaded.config.mailboxes) {
      expect(mailbox.imap.host).toBe('imap.smoke.invalid');
    }
  });

  it('fills .env.mailboxes with placeholders only', () => {
    runSmoke('Darwin', '501');
    const lines = readFileSync(path.join(smokeDir(), '.env.mailboxes'), 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_][A-Z0-9_]*=/.test(line));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/=smoke-placeholder$/);
  });

  it('keeps the smoke .env across runs, since the smoke volume stores its passwords', () => {
    runSmoke('Darwin', '501');
    const first = readFileSync(path.join(smokeDir(), '.env'), 'utf8');
    runSmoke('Darwin', '501');
    expect(readFileSync(path.join(smokeDir(), '.env'), 'utf8')).toBe(first);
  });
});

describe('scripts/compose-smoke.sh keeps Bridge out of the smoke stack (D-79, D-81)', () => {
  it('creates its own Bridge volume before the first compose call', () => {
    runSmoke('Darwin', '501', undefined, {
      COMPOSE_PROJECT_NAME: 'smoketest',
      SHIM_BUILD_OK: '1',
    });
    const calls = dockerCalls();
    const create = calls.indexOf('smoketest-pgdata-smoke volume create smoketest-bridge-smoke');
    const firstCompose = calls.findIndex((line) => line.includes(' compose '));
    const firstUp = calls.findIndex((line) => / compose .* up /.test(line));
    expect(create).toBeGreaterThanOrEqual(0);
    expect(firstCompose).toBeGreaterThan(create);
    expect(firstUp).toBeGreaterThan(create);
    expect(exportedBridgeEnv()?.volume).toBe('smoketest-bridge-smoke');
  });

  it('builds and starts only db, setup and worker, never bridge', () => {
    runSmoke('Darwin', '501', undefined, {
      COMPOSE_PROJECT_NAME: 'smoketest',
      SHIM_BUILD_OK: '1',
    });
    const env = `--env-file ${smokeDir()}/.env`;
    const composeArgs = dockerCalls()
      .filter((line) => line.includes(' compose '))
      .map((line) => line.slice(line.indexOf(env) + env.length).trim());
    const build = composeArgs.filter((args) => args.startsWith('build'));
    const up = composeArgs.filter((args) => args.startsWith('up'));
    expect(build).toEqual(['build setup worker']);
    expect(up).toEqual(['up -d db setup worker']);
    for (const args of [...build, ...up]) expect(args).not.toContain('bridge');
  });

  it('refuses to run on sift-bridge, even in CI', () => {
    const { status, stderr } = runSmoke('Darwin', '501', undefined, {
      CI: 'true',
      SIFT_BRIDGE_VOLUME: 'sift-bridge',
    });
    expect(status).toBe(2);
    expect(stderr).toContain('sift-bridge');
    expect(firstDockerCall()).toBeUndefined();
  });

  it('fills a throwaway Bridge keychain passphrase in the generated smoke .env', () => {
    runSmoke('Darwin', '501');
    const text = readFileSync(path.join(smokeDir(), '.env'), 'utf8');
    expect(text).toMatch(/^SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=[0-9a-f]{48}$/m);
  });

  it('appends the passphrase to an older smoke .env and keeps its other lines', () => {
    mkdirSync(smokeDir(), { recursive: true });
    const old = 'POSTGRES_PASSWORD=kept-value\nSIFT_DB_PORT=55433\n';
    writeFileSync(path.join(smokeDir(), '.env'), old, { mode: 0o600 });
    runSmoke('Darwin', '501');
    const text = readFileSync(path.join(smokeDir(), '.env'), 'utf8');
    expect(text.startsWith(old)).toBe(true);
    expect(text).toMatch(/^SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=[0-9a-f]{48}$/m);
    expect(text.match(/^SIFT_BRIDGE_KEYCHAIN_PASSPHRASE=/gm)).toHaveLength(1);
  });

  it('points the bridge-init backup source at a missing path under .smoke/<project>/', () => {
    const { status } = runSmoke('Darwin', '501');
    expect(status).toBe(1); // stopped at the stubbed docker build
    const bakFile = exportedBridgeEnv()?.bakFile ?? '';
    expect(bakFile.startsWith(`${smokeDir()}/`)).toBe(true);
    expect(existsSync(bakFile)).toBe(false);
    expect(firstComposeCall()).toBe(composeBuild());
  });

  it('refuses a run where that backup path exists', () => {
    mkdirSync(smokeDir(), { recursive: true });
    writeFileSync(path.join(smokeDir(), 'no-such-backup'), '');
    const { status, stderr } = runSmoke('Darwin', '501');
    expect(status).toBe(2);
    expect(stderr).toContain('no-such-backup');
    expect(firstDockerCall()).toBeUndefined();
  });
});

/** SQL the emulated stack received through `dc exec -T db psql`, one per line. */
function sqlLog(): string {
  return path.join(work, 'sql.log');
}

/**
 * Run the whole of compose-smoke.sh against an emulated healthy smoke stack on
 * a fresh runner (macOS, uid 501, so no chown branch runs). The docker shim:
 * - `docker ps`: nothing for the WR-09 project checks; a fixed id per service
 *   for the container lookups;
 * - `docker volume ...`: succeeds;
 * - `docker inspect`: setup exited 0, worker healthy and running, never restarted;
 * - `docker compose`: build, up, logs and down succeed; `exec -T db psql ... -Atc
 *   <sql>` logs the SQL and prints a count chosen by the SQL. No smoke mailbox
 *   can sync, so a count of ok rows is 0; the missing-status query prints
 *   SHIM_STATUS_MISSING (default 0).
 */
function runStack(env: Record<string, string> = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  shim(
    'docker',
    [
      'last=""',
      '[ -n "$SHIM_STATUS_MISSING" ] || SHIM_STATUS_MISSING=0',
      'for arg in "$@"; do last=$arg; done',
      'case "$1" in',
      '  ps)',
      '    for arg in "$@"; do',
      '      case "$arg" in label=com.docker.compose.service=*) echo "id-$(echo "$arg" | cut -d= -f3)" ;; esac',
      '    done',
      '    exit 0 ;;',
      '  volume) exit 0 ;;',
      '  inspect)',
      '    case "$*" in',
      '      *ExitCode*) echo "exited 0" ;;',
      '      *Health*) echo healthy ;;',
      '      *RestartCount*) echo "running 0" ;;',
      '      *) exit 1 ;;',
      '    esac',
      '    exit 0 ;;',
      '  compose)',
      '    case "$*" in *" exec "*) ;; *) exit 0 ;; esac',
      `    printf '%s\\n' "$last" | tr '\\n' ' ' >> '${sqlLog()}'`,
      `    echo >> '${sqlLog()}'`,
      '    case "$last" in',
      '      *__drizzle_migrations*) echo 7 ;;',
      `      *"'ok'"*) echo 0 ;;`,
      '      *"not exists"*) echo "$SHIM_STATUS_MISSING" ;;',
      '      *mailbox_status*) echo 2 ;;',
      '      *mailbox*) echo 2 ;;',
      '      *) exit 1 ;;',
      '    esac',
      '    exit 0 ;;',
      'esac',
      'exit 1',
    ].join('\n'),
  );
  shim('uname', 'echo Darwin');
  shim('id', 'if [ "$1" = -u ]; then echo 501; else exit 1; fi');
  const result = spawnSync('bash', ['scripts/compose-smoke.sh'], {
    cwd: work,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH ?? ''}`,
      HOME: work,
      COMPOSE_PROJECT_NAME: 'smoketest',
      ...env,
    },
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Every SQL statement the script sent, in order. */
function sentSql(): string[] {
  if (!existsSync(sqlLog())) return [];
  return readFileSync(sqlLog(), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

describe('scripts/compose-smoke.sh checks the worker status reachable without IMAP (G-02-14)', () => {
  it('passes when every enabled mailbox reports connecting or error and none is ok', () => {
    const { status, stdout, stderr } = runStack();
    expect(stderr).not.toContain('FAILED');
    expect(status).toBe(0);
    expect(stdout).toContain('compose-smoke: mailboxes enabled = 2');
    expect(stdout).toContain('compose-smoke: mailbox status connecting or error = 2');
    expect(stdout.trimEnd().split('\n').at(-1)).toBe('compose smoke OK');
  });

  it('fails within SMOKE_TIMEOUT when an enabled mailbox has no connecting or error row', () => {
    const started = Date.now();
    const { status, stdout, stderr } = runStack({ SHIM_STATUS_MISSING: '1', SMOKE_TIMEOUT: '3' });
    expect(status).toBe(1);
    expect(stderr).toContain(
      'mailbox status: 1 enabled mailboxes have no connecting or error status row after 3s',
    );
    expect(stdout).not.toContain('compose smoke OK');
    expect(Date.now() - started).toBeLessThan(20_000);
    // It polled more than once before giving up, rather than failing at once.
    expect(sentSql().filter((sql) => sql.includes('not exists')).length).toBeGreaterThan(1);
  });

  it('keeps the migrations and registry checks and never asks for an ok count', () => {
    runStack();
    const sql = sentSql();
    expect(sql.some((line) => line.includes('drizzle.__drizzle_migrations'))).toBe(true);
    expect(sql).toContain('select count(*) from mailbox');
    expect(sql.some((line) => /disabled_at is null/.test(line))).toBe(true);
    for (const line of sql) expect(line).not.toMatch(/'ok'/);
  });
});
