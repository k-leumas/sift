import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

function shim(name: string, body: string): void {
  const file = path.join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}

/**
 * Run the file-preparation half of compose-smoke.sh in a scratch copy of the
 * repository. `docker` is stubbed to fail, so the script stops at its first
 * docker call; `uname`, `id` and `sudo` are stubbed to emulate a Linux CI
 * runner whose uid is not 1000.
 */
function runSmoke(
  os: string,
  uid: string,
  sudo = `echo "$*" >> '${sudoLog}'`,
  env: Record<string, string> = { COMPOSE_PROJECT_NAME: 'smoketest' },
  args: string[] = [],
): { status: number | null; stderr: string } {
  shim('docker', `echo "$SIFT_PGDATA_VOLUME $*" >> '${dockerLog}'; exit 1`);
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

/** First docker invocation as "<SIFT_PGDATA_VOLUME> <args>", or undefined. */
function firstDockerCall(): string | undefined {
  if (!existsSync(dockerLog)) return undefined;
  return readFileSync(dockerLog, 'utf8').split('\n')[0];
}

beforeEach(() => {
  work = mkdtempSync(path.join(tmpdir(), 'sift-smoke-'));
  bin = path.join(work, 'bin');
  sudoLog = path.join(work, 'sudo.log');
  dockerLog = path.join(work, 'docker.log');
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
  it('creates config.yaml readable by the container user despite umask 077', () => {
    const { status } = runSmoke('Linux', '1001');
    expect(status).toBe(1); // stopped at the stubbed docker build
    const mode = statSync(path.join(work, 'config/config.yaml')).mode & 0o777;
    expect(mode & 0o004).toBe(0o004);
  });

  it('keeps the generated credential files private', () => {
    runSmoke('Linux', '1001');
    for (const file of ['.env', '.env.mailboxes']) {
      expect(statSync(path.join(work, file)).mode & 0o077, file).toBe(0);
    }
  });

  it.skipIf(process.getuid?.() === 1000)(
    'hands backups/ to uid 1000 on a Linux host whose uid is not 1000',
    () => {
      runSmoke('Linux', '1001');
      expect(readFileSync(sudoLog, 'utf8').trim()).toBe('-n chown 1000 backups');
    },
  );

  it('leaves backups/ alone on macOS and when the host uid is already 1000', () => {
    runSmoke('Darwin', '501');
    runSmoke('Linux', '1000');
    expect(existsSync(sudoLog)).toBe(false);
  });

  it('fails before starting the stack when backups/ cannot be handed to uid 1000', () => {
    const { status, stderr } = runSmoke('Linux', '1001', 'exit 1');
    expect(status).toBe(1);
    expect(stderr).toContain('sudo chown 1000 backups');
  });
});

describe('scripts/compose-smoke.sh never touches the owner database (WR-01)', () => {
  it('runs the stack on its own volume, named after the project', () => {
    const { status } = runSmoke('Darwin', '501');
    expect(status).toBe(1);
    expect(firstDockerCall()).toBe('smoketest-pgdata-smoke compose build');
  });

  it('refuses the default project outside CI, before creating any file', () => {
    const { status, stderr } = runSmoke('Darwin', '501', undefined, {});
    expect(status).toBe(2);
    expect(stderr).toContain('COMPOSE_PROJECT_NAME');
    expect(existsSync(path.join(work, 'config/config.yaml'))).toBe(false);
    expect(firstDockerCall()).toBeUndefined();
  });

  it('allows the default project in CI, still on a separate volume', () => {
    runSmoke('Darwin', '501', undefined, { CI: 'true' });
    const project = path.basename(work).toLowerCase();
    expect(firstDockerCall()).toBe(`${project}-pgdata-smoke compose build`);
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
