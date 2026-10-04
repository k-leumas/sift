import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), 'utf8');
}

/** .nvmrc without the leading "v" and surrounding whitespace, e.g. 26.10.0. */
const NVMRC = read('.nvmrc').trim().replace(/^v/, '');

describe('Node version pins follow .nvmrc (D-68)', () => {
  it('.nvmrc holds a full version', () => {
    expect(NVMRC).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the Dockerfile ARG NODE_VERSION default equals .nvmrc', () => {
    const defaults = [...read('Dockerfile').matchAll(/^ARG NODE_VERSION=(\S+)\s*$/gm)].map(
      (m) => m[1],
    );
    expect(defaults).toEqual([NVMRC]);
  });

  it('every ${NODE_VERSION:-...} default in compose.yaml equals .nvmrc', () => {
    const defaults = [...read('compose.yaml').matchAll(/\$\{NODE_VERSION:-([^}]*)\}/g)].map(
      (m) => m[1],
    );
    expect(defaults.length).toBeGreaterThan(0);
    for (const value of defaults) expect(value).toBe(NVMRC);
  });
});
