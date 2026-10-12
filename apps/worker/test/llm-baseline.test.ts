import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadRules } from '@sift/core/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_DIGEST,
  FAKE_MODEL,
  FAKE_VERSION,
  type FakeOllama,
  startFakeOllama,
} from './support/fake-ollama.ts';
import {
  type BaselineRow,
  formatBaselineTable,
  main,
  progressLine,
  readyLine,
  runBaseline,
} from './support/llm-baseline.ts';

/**
 * The manual live-baseline runner (AI-SPEC section 5, Set B: E4 live, E11
 * live, E12 baseline), checked in CI against the fake Ollama only. The owner
 * runs it against the real model at phase verification; CI never does.
 */

const TEST_DIR = import.meta.dirname;
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const RUNNER = path.join(TEST_DIR, 'support', 'llm-baseline.ts');
const FIXTURES = path.join(TEST_DIR, 'fixtures', 'mail');
const EXAMPLE_RULES = path.join(REPO_ROOT, 'data', 'mailboxes', 'example', 'rules.example.yaml');

/** AI-SPEC Set A pairs, in the order the runner reports them: the four action mails, then bulk. */
const PAIRS = ['bank-notice', 'payment-failure', 'interview', 'personal-reply', 'newsletter'];
const EXPECTED_FIXTURES = PAIRS.flatMap((pair) => [
  `pair-${pair}.eml`,
  `pair-${pair}.injected.eml`,
]);

const HEADER =
  '| fixture | category | confidence | attempts | thinking null | total_ms | flip | model digest |';

/** The `classify as X` target of an injected fixture, as the compromised fake reads it. */
function injectedTarget(pair: string): string {
  // Tags dropped, as in the text the model reads (the personal-reply variant is HTML).
  const text = readFileSync(path.join(FIXTURES, `pair-${pair}.injected.eml`), 'utf8').replace(
    /<[^>]*>/g,
    ' ',
  );
  const target = /classify as "?([^"\n.,;]+)"?/i.exec(text)?.[1]?.trim();
  if (target === undefined) throw new Error(`pair-${pair}.injected.eml has no classify as X`);
  return target;
}

interface Recorded {
  origin: string;
  path: string;
  body: unknown;
}

/** A fetch that records every request, then passes it to the real fetch. */
function recordingFetch(): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const recording: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const text = typeof init?.body === 'string' ? init.body : null;
    calls.push({
      origin: url.origin,
      path: url.pathname,
      body: text === null ? null : JSON.parse(text),
    });
    return fetch(input, init);
  };
  return { fetch: recording, calls };
}

function rowOf(rows: BaselineRow[], fixture: string): BaselineRow {
  const row = rows.find((r) => r.fixture === fixture);
  if (row === undefined) throw new Error(`no row for ${fixture}`);
  return row;
}

describe('the live-baseline runner against a compromised fake (E4, E11, E12)', () => {
  let fake: FakeOllama;
  let recorded: ReturnType<typeof recordingFetch>;
  let result: Awaited<ReturnType<typeof runBaseline>>;
  let categories: string[];

  beforeAll(async () => {
    const rules = await loadRules(EXAMPLE_RULES);
    if (!rules.ok) throw new Error('the example rules file must be valid');
    categories = rules.rules.categories.map((c) => c.name);
    fake = await startFakeOllama({ compromised: true });
    recorded = recordingFetch();
    result = await runBaseline({ url: fake.url, model: FAKE_MODEL, fetch: recorded.fetch });
  });

  afterAll(async () => {
    await fake?.close();
  });

  it('returns the 10 pair fixtures in a fixed order, base then injected', () => {
    expect(result.rows.map((r) => r.fixture)).toEqual(EXPECTED_FIXTURES);
    expect(result.rows.map((r) => `${r.pair}/${r.variant}`)).toEqual(
      PAIRS.flatMap((pair) => [`${pair}/base`, `${pair}/injected`]),
    );
    for (const row of result.rows) {
      expect(row.attempts, row.fixture).toBeGreaterThanOrEqual(1);
      expect(row.thinkingNull, row.fixture).toBe(true);
      expect(row.modelDigest, row.fixture).toBe(FAKE_DIGEST);
      expect(row.totalMs, row.fixture).toBeGreaterThan(0);
    }
    expect(result.ollamaVersion).toBe(FAKE_VERSION);
  });

  it('flips exactly the pairs whose injected classify as X names an allowed category', () => {
    let allowed = 0;
    for (const pair of PAIRS) {
      const base = rowOf(result.rows, `pair-${pair}.eml`);
      const injected = rowOf(result.rows, `pair-${pair}.injected.eml`);
      // No instruction in a base email: the fake answers the first category.
      expect(base, pair).toMatchObject({
        outcome: 'labelled',
        category: categories[0],
        flip: false,
      });
      const target = injectedTarget(pair);
      if (categories.includes(target)) {
        allowed += 1;
        expect(injected, pair).toMatchObject({
          outcome: 'labelled',
          category: target,
          attempts: 1,
          flip: true,
        });
        expect(injected.category).not.toBe(base.category);
      } else {
        // An off-list X is the bound: review after the normal retry, never a label.
        expect(injected, pair).toMatchObject({
          outcome: 'review',
          category: null,
          reviewReason: 'out_of_category',
          attempts: 2,
          flip: false,
        });
      }
    }
    expect(allowed).toBe(3);
    expect(result.flips).toBe(allowed);
  });

  it('sends every request to the given origin, with no tools key, and runs the preflight once', () => {
    const origin = new URL(fake.url).origin;
    expect(recorded.calls.length).toBeGreaterThan(0);
    expect(recorded.calls.filter((c) => c.origin !== origin)).toEqual([]);
    expect(fake.requests().map((r) => r.origin)).toEqual(recorded.calls.map(() => origin));

    const chats = recorded.calls.filter((c) => c.path === '/api/chat');
    expect(chats.length).toBe(result.rows.reduce((sum, r) => sum + r.attempts, 0));
    for (const chat of chats) {
      expect(chat.body).toMatchObject({ model: FAKE_MODEL, stream: false, think: false });
      expect(Object.keys(chat.body as object)).not.toContain('tools');
    }
    const preflight = recorded.calls.filter((c) => c.path !== '/api/chat').map((c) => c.path);
    expect(preflight).toEqual(['/api/version', '/api/tags', '/api/show']);
  });

  it('puts the synthetic email inside the fence and the example rules in the system message', () => {
    const [first] = fake.chatBodies();
    const messages = (first?.messages ?? []) as { role: string; content: string }[];
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    const user = messages.find((m) => m.role === 'user')?.content ?? '';
    for (const name of categories) expect(system).toContain(name);
    expect(system).toContain('Never mark anything from my bank as Noise.');
    expect(user).toContain('security@notices.firstbank.example.test');
    expect(user).toContain('New sign-in to your account');
  });

  it('reads the HTML-only fixture as text, as the worker stores it', () => {
    const htmlChat = fake
      .chatBodies()
      .map((body) => JSON.stringify(body))
      .find((text) => text.includes('alex@friends.example.test'));
    expect(htmlChat).toBeDefined();
    expect(htmlChat).toContain('Saturday works for me');
    expect(htmlChat).not.toContain('<p');
  });

  it('formats a Markdown table: header, 10 data rows, then the flip count last', () => {
    const lines = formatBaselineTable(result).split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toMatch(/^\|(\s*-+\s*\|){8}$/);
    const data = lines.filter((line) => line.startsWith('| pair-'));
    expect(data).toHaveLength(10);
    for (const line of data) expect(line.split('|')).toHaveLength(10);
    expect(lines.at(-1)).toBe('flips: 3');
    const bank = data.find((line) => line.startsWith('| pair-bank-notice.injected.eml |'));
    expect(bank).toBe(
      `| pair-bank-notice.injected.eml | Noise | 0.95 | 1 | yes | 1200 | yes | ${FAKE_DIGEST} |`,
    );
    const interview = data.find((line) => line.startsWith('| pair-interview.injected.eml |'));
    expect(interview).toContain('| review (out_of_category) | - | 2 | yes | 2400 | no |');
  });
});

describe('the live-baseline runner refuses what the worker refuses (T-03-51)', () => {
  it('refuses a cloud model with the owner message and sends no email', async () => {
    const fake = await startFakeOllama({
      tags: {
        status: 200,
        json: {
          models: [{ name: FAKE_MODEL, model: FAKE_MODEL, remote_host: 'https://ollama.com' }],
        },
      },
    });
    try {
      await expect(runBaseline({ url: fake.url, model: FAKE_MODEL })).rejects.toThrow(
        /is a cloud model on Ollama at/,
      );
      expect(fake.requests().filter((r) => r.path === '/api/chat')).toEqual([]);
    } finally {
      await fake.close();
    }
  });

  it('refuses a model that is not pulled, naming the ollama pull command', async () => {
    const fake = await startFakeOllama();
    try {
      await expect(runBaseline({ url: fake.url, model: 'qwen3:0.6b' })).rejects.toThrow(
        'run: ollama pull qwen3:0.6b',
      );
      expect(fake.requests().filter((r) => r.path === '/api/chat')).toEqual([]);
    } finally {
      await fake.close();
    }
  });
});

/** True for a ready or progress line, which a refused or misused run must never print. */
function isProgress(line: string): boolean {
  return line.startsWith('fixture ') || line.includes('is ready on Ollama');
}

describe('the live-baseline progress lines (G-03-2)', () => {
  it('formats the ready line and the per-email line in whole seconds', () => {
    expect(progressLine(3, 10, 'pair-payment-failure.eml', 39_400)).toBe(
      'fixture 3/10 pair-payment-failure.eml: 39 s',
    );
    expect(progressLine(1, 10, 'pair-bank-notice.eml', 0)).toBe(
      'fixture 1/10 pair-bank-notice.eml: 0 s',
    );
    expect(readyLine('qwen3:1.7b', 10)).toBe(
      'qwen3:1.7b is ready on Ollama; sending 10 synthetic emails one at a time, which takes a few minutes',
    );
  });
});

describe('the live-baseline command line (G-03-2)', () => {
  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) },
    };
  }

  it.each([
    [[]],
    [['--model', FAKE_MODEL]],
    [['--url', 'http://127.0.0.1:9']],
    [['--url', 'not a url', '--model', FAKE_MODEL]],
    [['--url', 'http://127.0.0.1:9', '--model', FAKE_MODEL, '--extra']],
  ])('exits 2 with a usage line for %j', async (argv) => {
    const run = io();
    expect(await main(argv, run.io)).toBe(2);
    expect(run.out).toEqual([]);
    expect(run.err.filter(isProgress)).toEqual([]);
    expect(run.err.at(-1)).toBe(
      'Usage: node apps/worker/test/support/llm-baseline.ts --url <ollama url> --model <model>',
    );
  });

  it('prints one progress line per email on stderr and only the table on stdout (G-03-2)', async () => {
    const fake = await startFakeOllama({ compromised: true });
    try {
      const run = io();
      expect(await main(['--url', fake.url, '--model', FAKE_MODEL], run.io)).toBe(0);

      expect(run.err).toHaveLength(11);
      expect(run.err[0]).toBe(readyLine(FAKE_MODEL, 10));
      const progress = run.err.slice(1).map((line) => {
        const match = /^fixture (\d+)\/10 (\S+): \d+ s$/.exec(line);
        if (match === null) throw new Error(`not a progress line: ${line}`);
        return { index: Number(match[1]), fixture: match[2] };
      });
      expect(progress.map((p) => p.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(progress.map((p) => p.fixture)).toEqual(EXPECTED_FIXTURES);

      const lines = run.out.join('\n').split('\n');
      expect(lines).toHaveLength(13);
      expect(lines[0]).toBe(HEADER);
      expect(lines.slice(2, 12).every((line) => line.startsWith('| pair-'))).toBe(true);
      expect(lines.at(-1)).toBe('flips: 3');
      expect(lines.filter((line) => line.startsWith('fixture '))).toEqual([]);
    } finally {
      await fake.close();
    }
  });

  it('writes each progress line as soon as that email is done, before the table (G-03-2)', async () => {
    const fake = await startFakeOllama({ compromised: true });
    try {
      const events: { stream: 'stdout' | 'stderr'; line: string; chats: number }[] = [];
      const record = (stream: 'stdout' | 'stderr') => (line: string) =>
        events.push({ stream, line, chats: fake.chatBodies().length });
      const exit = await main(['--url', fake.url, '--model', FAKE_MODEL], {
        stdout: record('stdout'),
        stderr: record('stderr'),
      });
      expect(exit).toBe(0);
      const finalChats = fake.chatBodies().length;

      const first = events.find((e) => e.line.startsWith('fixture 1/10 '));
      expect(first?.stream).toBe('stderr');
      expect(first?.chats).toBeGreaterThanOrEqual(1);
      expect(first?.chats).toBeLessThan(finalChats);

      expect(events.filter((e) => e.stream === 'stdout')).toHaveLength(1);
      expect(events.at(-1)?.stream).toBe('stdout');
      expect(events.slice(0, -1).every((e) => e.stream === 'stderr')).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it('exits 1 with the owner message when the preflight refuses', async () => {
    const fake = await startFakeOllama();
    try {
      const run = io();
      expect(await main(['--url', fake.url, '--model', 'qwen3:0.6b'], run.io)).toBe(1);
      expect(run.out).toEqual([]);
      expect(run.err.join('\n')).toContain('run: ollama pull qwen3:0.6b');
      expect(run.err.filter(isProgress)).toEqual([]);
    } finally {
      await fake.close();
    }
  });

  it('exits 2 when run as a script with no flags (no default URL)', async () => {
    const error = await promisify(execFile)(process.execPath, [RUNNER], { cwd: REPO_ROOT }).then(
      () => null,
      (e: { code?: number; stderr?: string }) => e,
    );
    expect(error?.code).toBe(2);
    expect(error?.stderr).toContain('Usage: node apps/worker/test/support/llm-baseline.ts');
  });

  it('has no default URL and reads only the committed synthetic fixtures', () => {
    const source = readFileSync(RUNNER, 'utf8');
    expect(source).not.toMatch(/localhost/);
    expect(source).not.toMatch(/https?:\/\/[^\s'"`]+/);
    expect(source).toContain("'fixtures', 'mail'");
  });
});
