import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_NAME_MAX_CHARS,
  ATTACHMENTS_MAX,
  attachmentsOf,
  BODY_DOWNLOAD_MAX_BYTES,
  BODY_TEXT_MAX_CHARS,
  parseMessage,
  selectTextPart,
  toBodyText,
} from '../src/ingest/message.ts';
import type { BodyNode, HeaderRecord } from '../src/ingest/types.ts';

// Synthetic BODYSTRUCTURE trees and strings only; never real mail (PROJECT.md).

function leaf(part: string, type: string, extra: Partial<BodyNode> = {}): BodyNode {
  return { part, type, size: 100, ...extra };
}

function multipart(type: string, childNodes: BodyNode[], part?: string): BodyNode {
  return { ...(part === undefined ? {} : { part }), type, childNodes };
}

const alternative = multipart('multipart/alternative', [
  leaf('1', 'text/plain'),
  leaf('2', 'text/html'),
]);

describe('size caps (D-06)', () => {
  it('match the decided values', () => {
    expect(BODY_TEXT_MAX_CHARS).toBe(32_768);
    expect(BODY_DOWNLOAD_MAX_BYTES).toBe(262_144);
    expect(ATTACHMENTS_MAX).toBe(100);
    expect(ATTACHMENT_NAME_MAX_CHARS).toBe(255);
  });
});

describe('selectTextPart', () => {
  it('prefers text/plain in multipart/alternative', () => {
    expect(selectTextPart(alternative)).toEqual({ part: '1', kind: 'text_plain' });
  });

  it('uses text/html when there is no text/plain part', () => {
    const htmlOnly = multipart('multipart/mixed', [leaf('1', 'text/html'), leaf('2', 'image/png')]);
    expect(selectTextPart(htmlOnly)).toEqual({ part: '1', kind: 'text_html' });
  });

  it('finds the text part depth-first in nested multiparts', () => {
    const mixed = multipart('multipart/mixed', [
      multipart(
        'multipart/alternative',
        [leaf('1.1', 'text/plain'), leaf('1.2', 'text/html')],
        '1',
      ),
      leaf('2', 'application/pdf', { disposition: 'attachment' }),
    ]);
    expect(selectTextPart(mixed)).toEqual({ part: '1.1', kind: 'text_plain' });
  });

  it('gives null for an image-only message and for no structure', () => {
    expect(selectTextPart(leaf('1', 'image/jpeg'))).toBeNull();
    expect(selectTextPart(undefined)).toBeNull();
  });

  it('never chooses a text/plain part with attachment disposition', () => {
    const tree = multipart('multipart/mixed', [
      leaf('1', 'text/plain', {
        disposition: 'attachment',
        dispositionParameters: { filename: 'notes.txt' },
      }),
      leaf('2', 'text/html'),
    ]);
    expect(selectTextPart(tree)).toEqual({ part: '2', kind: 'text_html' });
  });

  it('uses part 1 for a single-part text message without a part number', () => {
    expect(selectTextPart({ type: 'text/plain', size: 10 })).toEqual({
      part: '1',
      kind: 'text_plain',
    });
  });

  it('does not take the body of an attached message', () => {
    const tree = multipart('multipart/mixed', [
      leaf('1', 'image/png'),
      {
        part: '2',
        type: 'message/rfc822',
        childNodes: [leaf('2.1', 'text/plain')],
      },
    ]);
    expect(selectTextPart(tree)).toBeNull();
  });
});

describe('toBodyText', () => {
  it('gives source none and empty text when there is no text part', () => {
    expect(toBodyText(null, null)).toEqual({ text: '', source: 'none', truncated: false });
  });

  it('keeps plain text as is', () => {
    expect(toBodyText({ text: 'Hello plain', truncated: false }, 'text_plain')).toEqual({
      text: 'Hello plain',
      source: 'text_plain',
      truncated: false,
    });
  });

  it('converts HTML to text without script content', () => {
    const body = toBodyText(
      { text: '<p>Hello <b>there</b></p><script>x</script>', truncated: false },
      'text_html',
    );
    expect(body.source).toBe('text_html');
    expect(body.text).toContain('Hello there');
    expect(body.text).not.toContain('x');
  });

  it('drops style, images and link targets', () => {
    const body = toBodyText(
      {
        text: '<style>p{color:red}</style><p>Visit <a href="https://example.test/track">our site</a></p><img src="https://example.test/pixel.gif" alt="pixel">',
        truncated: false,
      },
      'text_html',
    );
    expect(body.text).toContain('Visit our site');
    expect(body.text).not.toContain('p{');
    expect(body.text).not.toContain('color');
    expect(body.text).not.toContain('example.test');
    expect(body.text).not.toContain('pixel');
  });

  it('caps the text at exactly BODY_TEXT_MAX_CHARS code points', () => {
    const body = toBodyText({ text: 'a'.repeat(40_000), truncated: false }, 'text_plain');
    expect([...body.text]).toHaveLength(BODY_TEXT_MAX_CHARS);
    expect(body.truncated).toBe(true);
  });

  it('never ends in a lone surrogate when an emoji sits at the boundary', () => {
    const text = `${'a'.repeat(BODY_TEXT_MAX_CHARS - 1)}${'😀'.repeat(10)}`;
    const body = toBodyText({ text, truncated: false }, 'text_plain');
    expect([...body.text]).toHaveLength(BODY_TEXT_MAX_CHARS);
    expect(body.text.endsWith('😀')).toBe(true);
    expect(body.text.isWellFormed()).toBe(true);
    expect(body.truncated).toBe(true);
  });

  it('keeps truncated true for a download that was already cut', () => {
    expect(toBodyText({ text: 'short', truncated: true }, 'text_plain')).toEqual({
      text: 'short',
      source: 'text_plain',
      truncated: true,
    });
  });

  it('removes NUL from body text', () => {
    expect(toBodyText({ text: 'a\u0000b', truncated: false }, 'text_plain').text).toBe('ab');
    expect(toBodyText({ text: '<p>c\u0000d</p>', truncated: false }, 'text_html').text).toBe('cd');
  });
});

describe('attachmentsOf', () => {
  it('records name, MIME type and size of attachment parts only', () => {
    const tree = multipart('multipart/mixed', [
      alternative,
      leaf('2', 'application/pdf', {
        disposition: 'attachment',
        dispositionParameters: { filename: 'report.pdf' },
        parameters: { name: 'ignored.pdf' },
        size: 2048,
      }),
      leaf('3', 'image/png', { parameters: { name: 'logo.png' }, size: 512 }),
      { part: '4', type: 'application/octet-stream', disposition: 'attachment' },
    ]);
    expect(attachmentsOf(tree)).toEqual([
      { name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
      { name: 'logo.png', mimeType: 'image/png', sizeBytes: 512 },
      { name: null, mimeType: 'application/octet-stream', sizeBytes: null },
    ]);
  });

  it('gives an empty list without structure or attachments', () => {
    expect(attachmentsOf(undefined)).toEqual([]);
    expect(attachmentsOf(alternative)).toEqual([]);
  });

  it('caps the list at ATTACHMENTS_MAX entries', () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      leaf(String(i + 1), 'application/pdf', {
        disposition: 'attachment',
        dispositionParameters: { filename: `f${i}.pdf` },
      }),
    );
    const list = attachmentsOf(multipart('multipart/mixed', many));
    expect(list).toHaveLength(ATTACHMENTS_MAX);
    expect(list[0]?.name).toBe('f0.pdf');
  });

  it('caps names at ATTACHMENT_NAME_MAX_CHARS and strips NUL', () => {
    const tree = multipart('multipart/mixed', [
      leaf('1', 'text/plain'),
      leaf('2', 'application/pdf', {
        disposition: 'attachment',
        dispositionParameters: { filename: 'n'.repeat(300) },
      }),
      leaf('3', 'application/pdf', {
        disposition: 'attachment',
        dispositionParameters: { filename: 'a\u0000b.pdf' },
      }),
    ]);
    const [long, nul] = attachmentsOf(tree);
    expect(long?.name).toHaveLength(ATTACHMENT_NAME_MAX_CHARS);
    expect(nul?.name).toBe('ab.pdf');
  });
});

describe('parseMessage body structure', () => {
  it('fills textPart and attachments from bodyStructure', () => {
    const rec: HeaderRecord = {
      uid: 1,
      internalDate: new Date('2026-10-01T12:00:00Z'),
      size: 4096,
      rawHeaders: Buffer.from('Message-ID: <m@example.test>\r\n\r\n'),
      bodyStructure: multipart('multipart/mixed', [
        alternative,
        leaf('2', 'application/pdf', {
          disposition: 'attachment',
          dispositionParameters: { filename: 'r.pdf' },
        }),
      ]),
    };
    const parsed = parseMessage(rec, { trustPmHeader: false });
    expect(parsed.textPart).toEqual({ part: '1', kind: 'text_plain' });
    expect(parsed.attachments).toEqual([
      { name: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 100 },
    ]);
  });
});
