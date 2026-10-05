import { beforeAll, describe, expect, it } from 'vitest';
import { closeImap, openImap } from '../src/imap/connect.ts';
import { freshImapUser, requireTestImap, TEST_IMAP, testImapPin } from './support/test-imap.ts';

describe('openImap against the Dovecot test server', () => {
  let pin: string;

  beforeAll(async () => {
    await requireTestImap();
    pin = await testImapPin();
  });

  it('logs in over STARTTLS through the capture, the pin and a doubly verified connection', async () => {
    const client = await openImap({
      host: TEST_IMAP.host,
      port: TEST_IMAP.port,
      user: freshImapUser('connect-tracer'),
      pass: TEST_IMAP.password,
      tls: { mode: 'starttls', pinSha256: pin },
    });
    try {
      const mailbox = await client.mailboxOpen('INBOX', { readOnly: true });
      expect(Number(mailbox.uidValidity)).toBeGreaterThan(0);
    } finally {
      await expect(closeImap(client)).resolves.toBeUndefined();
    }
  });
});
