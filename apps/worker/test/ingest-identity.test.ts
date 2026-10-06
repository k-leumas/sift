import { describe, expect, it } from 'vitest';
import {
  HDR_HASH_INPUTS,
  HDR_KEY_VERSION,
  identityKey,
  MESSAGE_ID_MAX_BYTES,
  normaliseMessageId,
  stableHeaderHash,
  stripNul,
  truncateCodePoints,
} from '../src/ingest/identity.ts';
import {
  HEADER_VALUE_MAX_CHARS,
  HEADER_VALUES_MAX,
  parseHeaderBlock,
  parseMessage,
} from '../src/ingest/message.ts';
import type { HeaderRecord } from '../src/ingest/types.ts';

// Synthetic header blocks only; never real mail (PROJECT.md).
const HASH = 'a'.repeat(64);
const HDR_KEY = /^hdr:v1:[0-9a-f]{64}$/;

function block(...lines: string[]): Buffer {
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');
}

function record(rawHeaders: Buffer, overrides: Partial<HeaderRecord> = {}): HeaderRecord {
  return {
    uid: 7,
    internalDate: new Date('2026-10-01T12:00:00Z'),
    size: 1234,
    rawHeaders,
    ...overrides,
  };
}

const TRUSTED = { trustPmHeader: true };
const UNTRUSTED = { trustPmHeader: false };

describe('normaliseMessageId (D-13)', () => {
  it('strips angle brackets and whitespace and lowercases only the domain', () => {
    expect(normaliseMessageId('  <A.B@Example.TEST>  ')).toBe('A.B@example.test');
  });

  it('keeps the local part case-sensitive', () => {
    expect(normaliseMessageId('<A@x.test>')).not.toBe(normaliseMessageId('<a@x.test>'));
  });

  it('lowercases only after the last @', () => {
    expect(normaliseMessageId('<Odd@Local@Host.TEST>')).toBe('Odd@Local@host.test');
  });

  it('gives null for empty, whitespace-only and <> values', () => {
    expect(normaliseMessageId('')).toBeNull();
    expect(normaliseMessageId('   ')).toBeNull();
    expect(normaliseMessageId('<>')).toBeNull();
    expect(normaliseMessageId(' < > ')).toBeNull();
  });

  it('strips NUL', () => {
    expect(normaliseMessageId('<a\u0000b@x.test>')).toBe('ab@x.test');
  });

  it('keeps an id without @ as is', () => {
    expect(normaliseMessageId('<NoDomain>')).toBe('NoDomain');
  });

  it('gives null for an id longer than the RFC 5322 line limit', () => {
    const long = `<${'x'.repeat(MESSAGE_ID_MAX_BYTES)}@x.test>`;
    expect(normaliseMessageId(long)).toBeNull();
  });
});

describe('identityKey (D-12)', () => {
  it('prefers pm: when the mailbox is trusted and the id is well formed', () => {
    expect(
      identityKey(
        { pmInternalId: 'Abc_-12==', messageId: '<m@x.test>', stableHash: HASH },
        TRUSTED,
      ),
    ).toBe('pm:Abc_-12==');
  });

  it('ignores a sender-forged X-Pm-Internal-Id on an untrusted mailbox', () => {
    expect(
      identityKey({ pmInternalId: 'forged', messageId: '<m@x.test>', stableHash: HASH }, UNTRUSTED),
    ).toBe('mid:m@x.test');
  });

  it('falls back to mid: for a malformed pm id', () => {
    for (const bad of ['', '  ', 'has space', 'semi;colon', 'x'.repeat(201), '<id>']) {
      expect(
        identityKey({ pmInternalId: bad, messageId: '<m@X.test>', stableHash: HASH }, TRUSTED),
      ).toBe('mid:m@x.test');
    }
  });

  it('falls through empty Message-IDs to a versioned hdr: key', () => {
    for (const messageId of ['', '   ', '<>', null]) {
      const key = identityKey({ pmInternalId: null, messageId, stableHash: HASH }, TRUSTED);
      expect(key).toBe(`hdr:v1:${HASH}`);
      expect(key).toMatch(HDR_KEY);
    }
    expect(HDR_KEY_VERSION).toBe('v1');
  });
});

describe('stableHeaderHash (A6)', () => {
  const headers = {
    date: ['Thu, 01 Oct 2026 12:00:00 +0000'],
    from: ['Sender <s@example.test>'],
    to: ['r@example.test'],
    subject: ['Hello'],
  };

  it('hashes the documented inputs', () => {
    expect(HDR_HASH_INPUTS).toEqual(['date', 'from', 'to', 'cc', 'subject', 'in-reply-to']);
  });

  it('is stable for equal input and is 64 hex', () => {
    const a = stableHeaderHash(headers, 100);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(stableHeaderHash({ ...headers }, 100)).toBe(a);
  });

  it('ignores whitespace differences, NUL and headers outside the inputs', () => {
    const noisy = { ...headers, subject: ['  Hel\u0000lo  '], 'x-other': ['ignored'] };
    expect(stableHeaderHash(noisy, 100)).toBe(stableHeaderHash(headers, 100));
  });

  it('differs when the subject or the size differs', () => {
    const base = stableHeaderHash(headers, 100);
    expect(stableHeaderHash({ ...headers, subject: ['Hello!'] }, 100)).not.toBe(base);
    expect(stableHeaderHash(headers, 101)).not.toBe(base);
    expect(stableHeaderHash(headers, null)).not.toBe(base);
  });
});

describe('stripNul and truncateCodePoints', () => {
  it('removes every NUL', () => {
    expect(stripNul('\u0000a\u0000b\u0000')).toBe('ab');
  });

  it('counts code points and never splits a surrogate pair', () => {
    expect(truncateCodePoints('ab😀cd', 3)).toEqual({ text: 'ab😀', truncated: true });
    expect(truncateCodePoints('😀😀😀', 2)).toEqual({ text: '😀😀', truncated: true });
    expect(truncateCodePoints('😀😀', 2)).toEqual({ text: '😀😀', truncated: false });
    expect(truncateCodePoints('abc', 3)).toEqual({ text: 'abc', truncated: false });
  });
});

describe('parseMessage identity', () => {
  it('keys a trusted Bridge message by pm:, even with a synthesised Message-ID', () => {
    const parsed = parseMessage(
      record(block('Message-ID: <Zm9v@protonmail.internalid>', 'X-Pm-Internal-Id: Zm9vYmFy_-==')),
      TRUSTED,
    );
    expect(parsed.identityKey).toBe('pm:Zm9vYmFy_-==');
    expect(parsed.messageIdHeader).toBe('Zm9v@protonmail.internalid');
  });

  it('keys an untrusted mailbox by mid: even when X-Pm-Internal-Id is present', () => {
    const parsed = parseMessage(
      record(block('Message-ID: <A.B@Example.TEST>', 'X-Pm-Internal-Id: forged')),
      UNTRUSTED,
    );
    expect(parsed.identityKey).toBe('mid:A.B@example.test');
  });

  it('ignores X-Pm-Internal-Id unless exactly one is present (WR-04)', () => {
    const parsed = parseMessage(
      record(
        block(
          'Message-ID: <A.B@Example.TEST>',
          'X-Pm-Internal-Id: forged',
          'X-Pm-Internal-Id: Zm9vYmFy_-==',
        ),
      ),
      TRUSTED,
    );
    expect(parsed.identityKey).toBe('mid:A.B@example.test');
  });

  it('keys a message without a Message-ID by hdr:v1:', () => {
    const parsed = parseMessage(record(block('Subject: Hi', 'Message-ID: <>')), TRUSTED);
    expect(parsed.identityKey).toMatch(HDR_KEY);
    expect(parsed.messageIdHeader).toBeNull();
  });

  it('gives different hdr: keys when the subject or the size differs', () => {
    const a = parseMessage(record(block('Subject: One')), TRUSTED).identityKey;
    const b = parseMessage(record(block('Subject: Two')), TRUSTED).identityKey;
    const c = parseMessage(record(block('Subject: One'), { size: 99 }), TRUSTED).identityKey;
    expect(a).toMatch(HDR_KEY);
    expect(new Set([a, b, c]).size).toBe(3);
    expect(parseMessage(record(block('Subject: One')), TRUSTED).identityKey).toBe(a);
  });

  it('gives two different messages with the same Message-ID the same mid: key (D-14)', () => {
    const a = parseMessage(record(block('Message-ID: <same@x.test>', 'Subject: First')), UNTRUSTED);
    const b = parseMessage(
      record(block('Message-ID: <same@X.TEST>', 'Subject: Second'), { size: 5 }),
      UNTRUSTED,
    );
    expect(a.identityKey).toBe('mid:same@x.test');
    expect(b.identityKey).toBe(a.identityKey);
  });

  it('fills envelope fields with only the sender domain lowercased', () => {
    const sent = new Date('2026-09-30T08:00:00Z');
    const parsed = parseMessage(
      record(block('Message-ID: <m@x.test>', 'Subject: header subject'), {
        envelope: {
          date: sent,
          subject: 'Envelope subject',
          from: [{ address: 'Some.One@Example.TEST' }],
        },
      }),
      UNTRUSTED,
    );
    expect(parsed).toMatchObject({
      fromAddress: 'Some.One@example.test',
      fromDomain: 'example.test',
      subject: 'Envelope subject',
      sentAt: sent,
      sizeBytes: 1234,
      internalDate: new Date('2026-10-01T12:00:00Z'),
      attachments: [],
      textPart: null,
    });
  });

  it('falls back to the decoded Subject header and drops an invalid envelope date', () => {
    const parsed = parseMessage(
      record(block('Subject: =?utf-8?B?SGVsbG8=?='), { envelope: { date: new Date('nope') } }),
      UNTRUSTED,
    );
    expect(parsed.subject).toBe('Hello');
    expect(parsed.sentAt).toBeNull();
    expect(parsed.fromAddress).toBeNull();
    expect(parsed.fromDomain).toBeNull();
  });
});

describe('hostile header blocks', () => {
  it('strips NUL from Message-ID and Subject and from the mid: key', () => {
    const parsed = parseMessage(
      record(block('Message-ID: <a\u0000b@x.test>', 'Subject: Hi\u0000 there')),
      UNTRUSTED,
    );
    expect(parsed.identityKey).toBe('mid:ab@x.test');
    expect(parsed.headers.subject).toEqual(['Hi there']);
    expect(JSON.stringify(parsed)).not.toContain('\\u0000');
  });

  it('ignores a line without a colon without throwing', () => {
    const headers = parseHeaderBlock(
      block('Subject: ok', 'this line has no colon', 'To: r@example.test'),
    );
    expect(headers.subject).toEqual(['ok']);
    expect(headers.to).toEqual(['r@example.test']);
    expect(Object.keys(headers).sort()).toEqual(['subject', 'to']);
  });

  it('keeps the raw text of an invalid encoded word', () => {
    expect(parseHeaderBlock(block('Subject: =?utf-8?B?***?=')).subject).toEqual([
      '=?utf-8?B?***?=',
    ]);
  });

  it('decodes a raw 8-bit UTF-8 subject', () => {
    expect(parseHeaderBlock(block('Subject: Grüße aus Köln 😀')).subject).toEqual([
      'Grüße aus Köln 😀',
    ]);
  });

  it('decodes a subject split into two adjacent B-encoded words into one string', () => {
    const headers = parseHeaderBlock(
      block('Subject: =?utf-8?B?SGVs?=', ' =?utf-8?B?bG8gd29ybGQ=?='),
    );
    expect(headers.subject).toEqual(['Hello world']);
  });

  it('lowercases names, unfolds values and caps value length and count', () => {
    const many = Array.from({ length: HEADER_VALUES_MAX + 5 }, (_, i) => `Received: hop ${i}`);
    const headers = parseHeaderBlock(
      block(
        `X-Long: ${'y'.repeat(HEADER_VALUE_MAX_CHARS + 50)}`,
        'TO: a@example.test,',
        '\tb@example.test',
        ...many,
      ),
    );
    expect(headers['x-long']?.[0]).toHaveLength(HEADER_VALUE_MAX_CHARS);
    expect(headers.to).toEqual(['a@example.test, b@example.test']);
    expect(headers.received).toHaveLength(HEADER_VALUES_MAX);
  });

  it('survives prototype-like names and garbage bytes', () => {
    const raw = Buffer.concat([
      block('__proto__: x', 'constructor: y'),
      Buffer.from([0xff, 0xfe, 0x00, 0x3a, 0x0a]),
    ]);
    const headers = parseHeaderBlock(raw);
    expect(Object.getPrototypeOf(headers)).toBe(Object.prototype);
    expect(Object.hasOwn(headers, '__proto__')).toBe(true);
    expect(() =>
      parseMessage(record(Buffer.from([0xff, 0x00, 0x0d, 0x0a, 0x3a])), TRUSTED),
    ).not.toThrow();
  });
});
