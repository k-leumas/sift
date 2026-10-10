import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Hermeticity guard (RESEARCH Pitfall 2, E7): the classification tests and
 * their helpers never name the real Ollama port, so CI and a developer
 * machine with Ollama running can never reach a real model by accident.
 * Other tests may name that port as a config value; they never send a
 * request, so the guard covers only the files that do. The needle is built
 * from two parts so this file does not contain it either.
 */

const PORT = ['114', '34'].join('');
const TEST_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');

/** The classification test files and test helpers the guard scans. */
function scannedFiles(): string[] {
  const classifyTests = readdirSync(TEST_DIR)
    .filter((name) => /^classify-.+\.test\.ts$/.test(name))
    .map((name) => path.join(TEST_DIR, name));
  return [
    ...classifyTests,
    path.join(TEST_DIR, 'worker-classify.test.ts'),
    ...['fake-ollama', 'classify-harness', 'mailbox-harness'].map((name) =>
      path.join(TEST_DIR, 'support', `${name}.ts`),
    ),
  ];
}

function namesPort(file: string): boolean {
  return readFileSync(file, 'utf8').includes(PORT);
}

describe('the classification tests cannot reach a real Ollama', () => {
  it('scans every classification test and helper', () => {
    const files = scannedFiles().map((file) => path.relative(TEST_DIR, file));
    for (const expected of [
      'classify-hermetic.test.ts',
      'classify-injection.test.ts',
      'classify-leak.test.ts',
      'classify-run.test.ts',
      'classify-batch.test.ts',
      'classify-ollama-client.test.ts',
      'worker-classify.test.ts',
      path.join('support', 'fake-ollama.ts'),
      path.join('support', 'classify-harness.ts'),
      path.join('support', 'mailbox-harness.ts'),
    ]) {
      expect(files).toContain(expected);
    }
    for (const file of scannedFiles()) expect(existsSync(file), file).toBe(true);
  });

  it('no scanned file names the real Ollama port', () => {
    const offenders = scannedFiles().filter(namesPort);
    expect(offenders.map((file) => path.relative(REPO_ROOT, file))).toEqual([]);
  });

  it('positive control: the scan finds the port where it is a config value', () => {
    expect(namesPort(path.join(REPO_ROOT, 'config', 'config.example.yaml'))).toBe(true);
  });
});
