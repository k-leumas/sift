import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

/** A long-syntax volume entry (`type: bind`, `source`, `target`, ...). */
interface LongVolume {
  type?: string;
  source?: string;
  target?: string;
  read_only?: boolean;
  bind?: Record<string, unknown>;
}

/** Volume entries can be short strings or long-syntax objects. */
type VolumeEntry = string | LongVolume;

interface Service {
  build?: { context?: string; args?: Record<string, string> } | string;
  image?: string;
  command?: string[];
  profiles?: string[];
  environment?: Record<string, unknown> | string[];
  env_file?: string | string[];
  volumes?: VolumeEntry[];
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
  volumes?: Record<string, { name?: string; external?: boolean } | null>;
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

/** Source and target of a volume entry in either syntax. */
function mount(entry: VolumeEntry): { source: string; target: string } {
  if (typeof entry !== 'string') return { source: entry.source ?? '', target: entry.target ?? '' };
  const [source = '', target = ''] = entry.split(':');
  // `${VAR:-default}` holds a colon of its own: split after the closing brace.
  const close = entry.indexOf('}');
  if (entry.startsWith('${') && close !== -1) {
    const rest = entry.slice(close + 1).split(':');
    return { source: entry.slice(0, close + 1) + (rest[0] ?? ''), target: rest[1] ?? '' };
  }
  return { source, target };
}

/** Short-syntax volume strings of a service (long-syntax entries skipped). */
function shortVolumes(svc: Service): string[] {
  return (svc.volumes ?? []).filter((v): v is string => typeof v === 'string');
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
  it('defines db, setup, worker, bridge and bridge-init', () => {
    expect(Object.keys(compose.services ?? {}).sort()).toEqual([
      'bridge',
      'bridge-init',
      'db',
      'setup',
      'worker',
    ]);
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
      const mounts = shortVolumes(service(name)).filter((v) => v.includes(':/config'));
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

  it('tells the owner to create the copy at mode 600 (CR-02, D-39)', () => {
    expect(read('.env.mailboxes.example')).toContain(
      'cp .env.mailboxes.example .env.mailboxes && chmod 600 .env.mailboxes',
    );
  });
});

// biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
const BRIDGE_PORT = '127.0.0.1:${SIFT_BRIDGE_PORT:-1143}:1143';
const BRIDGE_PASSPHRASE = 'SIFT_BRIDGE_KEYCHAIN_PASSPHRASE';

describe('bridge service (D-29..D-38, D-73, D-79)', () => {
  const bridge = service('bridge');

  it('publishes IMAP on host loopback only', () => {
    expect(bridge.ports).toEqual([BRIDGE_PORT]);
  });

  it('mounts the vault volume and nothing else', () => {
    expect(bridge.volumes).toEqual(['sift-bridge:/data']);
    for (const entry of bridge.volumes ?? []) {
      const { source, target } = mount(entry);
      expect(target.startsWith('/run/sift')).toBe(false);
      expect(source).not.toContain('.env.mailboxes');
      expect(source).not.toContain('config');
    }
  });

  it('has no profile, so docker compose up starts it', () => {
    expect(bridge.profiles).toBeUndefined();
  });

  it('restarts unless stopped and has a healthcheck', () => {
    expect(bridge.restart).toBe('unless-stopped');
    expect(bridge.healthcheck?.test).toBeDefined();
  });

  it('builds the image from ./bridge', () => {
    // Only the smoke scripts set SIFT_BRIDGE_IMAGE.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
    expect(bridge.image).toBe('${SIFT_BRIDGE_IMAGE:-sift-bridge:local}');
    expect(bridge.build).toEqual({ context: './bridge' });
  });
});

describe('bridge-init service (D-39, D-72, D-79, D-81)', () => {
  const init = service('bridge-init');

  it('runs only on demand, in init mode', () => {
    expect(init.profiles).toEqual(['tools']);
    expect(init.command).toEqual(['init']);
  });

  it('uses the same build and image as bridge', () => {
    expect(init.build).toEqual(service('bridge').build);
    expect(init.image).toBe(service('bridge').image);
  });

  it('mounts the vault, the mailbox env file, config read-only and the backup file', () => {
    expect(init.volumes).toEqual([
      'sift-bridge:/data',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
      '${SIFT_MAILBOXES_ENV_FILE:-./.env.mailboxes}:/run/sift/.env.mailboxes',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
      '${SIFT_CONFIG_HOST_DIR:-./config}:/run/sift/config:ro',
      {
        type: 'bind',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
        source: '${SIFT_MAILBOXES_BAK_FILE:-./.env.mailboxes.bak}',
        target: '/run/sift/.env.mailboxes.bak',
      },
    ]);
    // No `bind` key, so no create_host_path: a missing backup file stops Compose.
    const long = (init.volumes ?? []).filter((v): v is LongVolume => typeof v !== 'string');
    expect(long).toHaveLength(1);
    expect(long[0]).not.toHaveProperty('bind');
  });

  it('publishes no ports and never restarts', () => {
    expect(init.ports).toBeUndefined();
    expect(init.restart).toBe('no');
  });
});

describe('Bridge vault, secrets and mounts across services (D-32, D-37, D-38, D-79)', () => {
  const services = compose.services ?? {};

  it('declares sift-bridge as an external volume with a name variable', () => {
    const volume = compose.volumes?.['sift-bridge'];
    expect(volume?.external).toBe(true);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
    expect(volume?.name).toBe('${SIFT_BRIDGE_VOLUME:-sift-bridge}');
  });

  it('mounts sift-bridge only in bridge and bridge-init', () => {
    const users = Object.entries(services)
      .filter(([, svc]) => (svc.volumes ?? []).some((v) => mount(v).source === 'sift-bridge'))
      .map(([name]) => name)
      .sort();
    expect(users).toEqual(['bridge', 'bridge-init']);
  });

  it('mounts anything under /run/sift only in bridge-init', () => {
    const users = Object.entries(services)
      .filter(([, svc]) => (svc.volumes ?? []).some((v) => mount(v).target.startsWith('/run/sift')))
      .map(([name]) => name);
    expect(users).toEqual(['bridge-init']);
    expect(service('bridge').volumes).toEqual(['sift-bridge:/data']);
  });

  it('gives the keychain passphrase to bridge and bridge-init only', () => {
    for (const [name, svc] of Object.entries(services)) {
      const holds = Object.keys(env(svc)).includes(BRIDGE_PASSPHRASE);
      const mentions = JSON.stringify(svc).includes(BRIDGE_PASSPHRASE);
      const expected = name === 'bridge' || name === 'bridge-init';
      expect(holds, `${name} environment`).toBe(expected);
      expect(mentions, `${name} definition`).toBe(expected);
    }
  });

  it('never makes the worker wait for Bridge', () => {
    const dependsOn = Object.keys(service('worker').depends_on ?? {});
    expect(dependsOn).not.toContain('bridge');
    expect(dependsOn).not.toContain('bridge-init');
  });

  it('leaves the worker and setup mounts as in Phase 1 (no certificate mount)', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
    const config = '${SIFT_CONFIG_HOST_DIR:-./config}:/config:ro';
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation, not JS
    const backups = '${SIFT_BACKUP_HOST_DIR:-./backups}:/backups';
    expect(service('worker').volumes).toEqual([config]);
    expect(service('setup').volumes).toEqual([config, backups]);
  });
});
