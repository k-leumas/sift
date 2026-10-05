import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Supply-chain checks for the worker's npm dependencies (D-77): owner-approved
 * packages at exact pins, licenses from an allowlist over the whole production
 * tree, and no new install scripts.
 */

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const WORKER_PACKAGE_JSON = path.join(REPO_ROOT, 'apps/worker/package.json');

const APPROVED_DEPENDENCIES: Record<string, string> = {
  imapflow: '2.1.0',
  libmime: '5.4.4',
  'postal-mime': '4.0.0',
  'html-to-text': '10.0.1',
};

const APPROVED_DEV_DEPENDENCIES: Record<string, string> = {
  '@types/html-to-text': '9.0.4',
  '@types/libmime': '5.3.0',
};

const ALLOWED_LICENSES = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
]);

/**
 * Whether an SPDX license expression lets us use the package under allowlisted
 * terms: an `OR` needs one fully allowed alternative (we choose it), an `AND`
 * needs every part. Anything else, including nested parentheses, fails closed.
 */
function licenseAllowed(expression: string | undefined): boolean {
  if (expression === undefined) return false;
  let text = expression.trim();
  if (text.startsWith('(') && text.endsWith(')')) text = text.slice(1, -1).trim();
  if (text === '' || /[()]/.test(text)) return false;
  return text
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative.split(/\s+AND\s+/).every((term) => ALLOWED_LICENSES.has(term.trim())),
    );
}

/** A bare version: no range operator, tag, URL or workspace protocol. */
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface LicenseEntry {
  name: string;
  versions: string[];
  license?: string;
}

const pkg = JSON.parse(readFileSync(WORKER_PACKAGE_JSON, 'utf8')) as PackageJson;

describe('@sift/worker dependencies are approved and pinned exactly (D-77)', () => {
  it('has exactly the approved production dependencies besides the workspace packages', () => {
    const external = Object.fromEntries(
      Object.entries(pkg.dependencies ?? {}).filter(([, spec]) => !spec.startsWith('workspace:')),
    );
    expect(external).toEqual(APPROVED_DEPENDENCIES);
  });

  it('has the approved type packages as dev dependencies', () => {
    for (const [name, version] of Object.entries(APPROVED_DEV_DEPENDENCIES)) {
      expect(pkg.devDependencies?.[name], name).toBe(version);
    }
  });

  it('pins every external dependency to a bare version, never a range', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, spec] of Object.entries(all)) {
      if (spec.startsWith('workspace:')) continue;
      expect(spec, name).toMatch(EXACT_VERSION);
    }
  });
});

describe('licenses of the production tree', () => {
  let entries: LicenseEntry[];

  beforeAll(async () => {
    // `@sift/worker...` also walks @sift/core and @sift/db, whose packages the
    // worker runs too; a plain `--filter @sift/worker` stops at workspace links.
    const { stdout } = await execFileAsync(
      'pnpm',
      ['licenses', 'list', '--prod', '--json', '--filter', '@sift/worker...'],
      { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 },
    );
    const grouped = JSON.parse(stdout) as Record<string, LicenseEntry[]>;
    entries = Object.entries(grouped).flatMap(([license, list]) =>
      list.map((entry) => ({ ...entry, license: entry.license ?? license })),
    );
  }, 120_000);

  it('lists the approved packages (the command sees the worker tree)', () => {
    const names = new Set(entries.map((entry) => entry.name));
    for (const name of Object.keys(APPROVED_DEPENDENCIES)) expect(names, name).toContain(name);
  });

  it('has only allowlisted licenses', () => {
    const outside = entries
      .filter((entry) => !licenseAllowed(entry.license))
      .map((entry) => `${entry.name}@${entry.versions.join(',')}: ${entry.license ?? 'none'}`);
    expect(outside).toEqual([]);
  });

  it('reads SPDX expressions: one allowed OR alternative, every AND part, else fail', () => {
    expect(licenseAllowed('MIT')).toBe(true);
    expect(licenseAllowed('(MIT OR EUPL-1.1+)')).toBe(true);
    expect(licenseAllowed('(MIT AND ISC)')).toBe(true);
    expect(licenseAllowed('(MIT AND GPL-3.0)')).toBe(false);
    expect(licenseAllowed('GPL-3.0 OR EUPL-1.1+')).toBe(false);
    expect(licenseAllowed('((MIT OR ISC) AND GPL-3.0)')).toBe(false);
    expect(licenseAllowed('Unknown')).toBe(false);
    expect(licenseAllowed('')).toBe(false);
    expect(licenseAllowed(undefined)).toBe(false);
  });

  it('has one libmime version, the one imapflow pins', () => {
    const libmime = entries.filter((entry) => entry.name === 'libmime');
    expect(libmime.flatMap((entry) => entry.versions)).toEqual(['5.4.4']);
  });
});

describe('install scripts and resolution', () => {
  it('lets only esbuild and lefthook run install scripts', () => {
    const workspace = parse(readFileSync(path.join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')) as {
      allowBuilds?: Record<string, unknown>;
    };
    expect(Object.keys(workspace.allowBuilds ?? {}).sort()).toEqual(['esbuild', 'lefthook']);
  });

  it('resolves libmime 5.4.4 from the installed imapflow', () => {
    const fromWorker = createRequire(WORKER_PACKAGE_JSON);
    const imapflowPackageJson = fromWorker.resolve('imapflow/package.json');
    const imapflow = createRequire(imapflowPackageJson)('./package.json') as { version: string };
    expect(imapflow.version).toBe('2.1.0');
    const fromImapflow = createRequire(imapflowPackageJson);
    const libmime = fromImapflow('libmime/package.json') as { version: string };
    expect(libmime.version).toBe('5.4.4');
  });
});
