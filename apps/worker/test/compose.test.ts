import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

interface Service {
  image?: string;
  command?: string[];
  environment?: Record<string, unknown> | string[];
  env_file?: string | string[];
  volumes?: string[];
  ports?: string[];
  depends_on?: Record<string, { condition?: string }>;
  restart?: string;
  healthcheck?: { test?: string[] | string };
  stop_grace_period?: string;
  extra_hosts?: string[];
}

interface ComposeFile {
  name?: unknown;
  services?: Record<string, Service>;
  volumes?: Record<string, { name?: string } | null>;
}

const compose = parse(read('compose.yaml')) as ComposeFile;

function service(name: string): Service {
  const svc = compose.services?.[name];
  if (svc === undefined) throw new Error(`compose.yaml has no service "${name}"`);
  return svc;
}

/** Environment as a key -> value map, from either the map or the list form. */
function env(svc: Service): Record<string, string> {
  const raw = svc.environment ?? {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw.map((entry) => {
        const i = entry.indexOf('=');
        return i === -1 ? [entry, ''] : [entry.slice(0, i), entry.slice(i + 1)];
      }),
    );
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? '')]));
}

function envFiles(svc: Service): string[] | undefined {
  if (svc.env_file === undefined) return undefined;
  return Array.isArray(svc.env_file) ? svc.env_file : [svc.env_file];
}

/** Keys defined in a dotenv-style file (comments and blank lines skipped). */
function dotenvKeys(file: string): string[] {
  return read(file)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.slice(0, line.indexOf('=')));
}

const WORKER_ENV_ALLOWED = new Set([
  'SIFT_DATABASE_URL',
  'SIFT_CONFIG',
  'SIFT_HEARTBEAT_FILE',
  'SIFT_LOG_LEVEL',
  'SIFT_MODELS_URL',
]);

const PRIVILEGED = ['SIFT_DB_OWNER_PASSWORD', 'SIFT_DB_BACKUP_PASSWORD', 'POSTGRES_PASSWORD'];

describe('compose.yaml services', () => {
  it('defines db, setup and worker', () => {
    expect(Object.keys(compose.services ?? {}).sort()).toEqual(['bridge', 'db', 'setup', 'worker']);
  });

  it('runs setup and worker from the same locally built image', () => {
    // Only compose-smoke sets SIFT_IMAGE (IN-08); owners build sift:local.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
    const image = '${SIFT_IMAGE:-sift:local}';
    expect(service('setup').image).toBe(image);
    expect(service('worker').image).toBe(image);
    expect(service('setup').command).toEqual(['sift', 'setup']);
    expect(service('worker').command).toEqual(['sift', 'worker']);
  });

  it('avoids keys that Compose v2.2.3 does not support', () => {
    expect(compose.name).toBeUndefined();
    for (const svc of Object.values(compose.services ?? {})) {
      expect(svc.healthcheck ?? {}).not.toHaveProperty('start_interval');
    }
  });
});

describe('db service (T-01-52)', () => {
  it('publishes Postgres on loopback only', () => {
    const ports = service('db').ports ?? [];
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(port.startsWith('127.0.0.1:')).toBe(true);
  });

  it('keeps data in the named volume sift-pgdata at the PG18 path', () => {
    expect(service('db').volumes).toContain('sift-pgdata:/var/lib/postgresql');
    // Only the smoke script overrides the name (WR-01); owners get sift-pgdata.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
    expect(compose.volumes?.['sift-pgdata']?.name).toBe('${SIFT_PGDATA_VOLUME:-sift-pgdata}');
  });

  it('is the only service holding the superuser password', () => {
    expect(env(service('db'))).toHaveProperty('POSTGRES_PASSWORD');
    for (const name of ['setup', 'worker']) {
      expect(Object.keys(env(service(name)))).not.toContain('POSTGRES_PASSWORD');
      expect(JSON.stringify(service(name))).not.toContain('POSTGRES_PASSWORD');
    }
  });
});

describe('worker credentials (T-01-48, D-39, D-67)', () => {
  const worker = service('worker');
  const workerEnv = env(worker);

  it('receives only the allowed environment keys', () => {
    for (const key of Object.keys(workerEnv)) {
      expect(WORKER_ENV_ALLOWED.has(key), `unexpected worker env key ${key}`).toBe(true);
    }
  });

  it('connects as sift_app', () => {
    expect(workerEnv.SIFT_DATABASE_URL?.startsWith('postgres://sift_app:')).toBe(true);
  });

  it('never references owner, backup or superuser credentials', () => {
    const text = JSON.stringify(worker);
    for (const name of PRIVILEGED) expect(text).not.toContain(name);
    expect(text).not.toContain('sift_owner');
    expect(text).not.toContain('sift_backup');
  });

  it('reads mailbox passwords from .env.mailboxes and nothing else', () => {
    // Only compose-smoke sets SIFT_MAILBOXES_ENV_FILE (IN-08).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
    expect(envFiles(worker)).toEqual(['${SIFT_MAILBOXES_ENV_FILE:-.env.mailboxes}']);
  });
});

describe('setup backups (D-29, CR-02)', () => {
  it('writes dumps to ./backups unless compose-smoke points it elsewhere', () => {
    expect(service('setup').volumes).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
      '${SIFT_BACKUP_HOST_DIR:-./backups}:/backups',
    );
  });
});

describe('setup credentials (T-01-49, D-67)', () => {
  const setup = service('setup');
  const setupEnv = env(setup);

  it('has no env_file and no mailbox password variables', () => {
    expect(envFiles(setup)).toBeUndefined();
    for (const key of Object.keys(setupEnv)) expect(key.endsWith('_IMAP_PASSWORD')).toBe(false);
    expect(JSON.stringify(setup)).not.toContain('_IMAP_PASSWORD');
  });

  it('migrates as sift_owner and backs up as sift_backup', () => {
    expect(setupEnv.SIFT_OWNER_DATABASE_URL?.startsWith('postgres://sift_owner:')).toBe(true);
    expect(setupEnv.SIFT_BACKUP_DATABASE_URL?.startsWith('postgres://sift_backup:')).toBe(true);
    expect(setupEnv).toHaveProperty('SIFT_DB_APP_PASSWORD');
  });
});

describe('ordering and lifecycle (D-27, D-53, D-54, D-60)', () => {
  it('runs setup once db is healthy, and never restarts it', () => {
    const setup = service('setup');
    expect(setup.depends_on?.db?.condition).toBe('service_healthy');
    expect(setup.restart).toBe('no');
  });

  it('starts the worker only after db is healthy and setup completed', () => {
    const worker = service('worker');
    expect(worker.depends_on?.db?.condition).toBe('service_healthy');
    expect(worker.depends_on?.setup?.condition).toBe('service_completed_successfully');
  });

  it('restarts the worker only when it exits with an error (IN-05)', () => {
    // The worker exits 75 after missed heartbeats; SIGTERM still exits 0.
    expect(service('worker').restart).toBe('unless-stopped');
    const text = read('compose.yaml');
    const health = text.slice(text.indexOf('    healthcheck:', text.indexOf('  worker:')));
    expect(health).toContain('exits by itself (code 75) after 3 missed heartbeats');
    expect(health).not.toContain('docker compose restart worker');
  });

  it('checks worker health on a heartbeat younger than 120 s', () => {
    const worker = service('worker');
    expect(env(worker).SIFT_HEARTBEAT_FILE).toBe('/tmp/sift/heartbeat');
    const test = JSON.stringify(worker.healthcheck?.test ?? '');
    expect(test).toContain('/tmp/sift/heartbeat');
    expect(test).toContain('120000');
    expect(worker.stop_grace_period).toBe('30s');
    expect(worker.extra_hosts).toContain('host.docker.internal:host-gateway');
  });

  it('mounts the config directory read-only', () => {
    for (const name of ['setup', 'worker']) {
      const mounts = (service(name).volumes ?? []).filter((v) => v.includes(':/config'));
      // Only compose-smoke sets SIFT_CONFIG_HOST_DIR (IN-08); owners mount ./config.
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
      const expected = '${SIFT_CONFIG_HOST_DIR:-./config}:/config:ro';
      expect(mounts, `${name} config mount`).toEqual([expected]);
    }
  });
});

describe('.env.mailboxes.example', () => {
  it('lists exactly the password_env names of config/config.example.yaml', () => {
    const config = parse(read('config/config.example.yaml')) as {
      mailboxes: { imap: { password_env: string } }[];
    };
    const expected = config.mailboxes.map((m) => m.imap.password_env).sort();
    expect(dotenvKeys('.env.mailboxes.example').sort()).toEqual(expected);
  });
});
