import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SCRAM_ITERATIONS, scramSha256Verifier } from '../src/owner/scram.ts';
import { connect, requireTestDb } from './support/db.ts';

const VERIFIER = /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/;

/**
 * The verifier PostgreSQL itself stores for `password`, read back from a
 * throwaway role (roles are cluster-wide, so the name is random and the role
 * is dropped again).
 */
async function serverVerifier(password: string): Promise<string> {
  const admin = await connect(requireTestDb().adminUrl);
  const role = `sift_test_scram_${randomBytes(6).toString('hex')}`;
  try {
    await admin.query("set password_encryption = 'scram-sha-256'");
    await admin.query(`create role ${role} nologin password ${admin.escapeLiteral(password)}`);
    const { rows } = await admin.query<{ rolpassword: string }>(
      'select rolpassword from pg_authid where rolname = $1',
      [role],
    );
    const verifier = rows[0]?.rolpassword;
    if (verifier === undefined) throw new Error(`${role} has no stored password`);
    return verifier;
  } finally {
    await admin.query(`drop role if exists ${role}`);
    await admin.end();
  }
}

describe('scramSha256Verifier (IN-03)', () => {
  it('has the stored format with a random 16-byte salt and the default iterations', () => {
    const a = scramSha256Verifier('secret');
    const b = scramSha256Verifier('secret');
    const match = VERIFIER.exec(a);
    expect(match?.[1]).toBe(String(SCRAM_ITERATIONS));
    expect(Buffer.from(match?.[2] ?? '', 'base64')).toHaveLength(16);
    expect(a).not.toBe(b);
    expect(a).not.toContain('secret');
  });

  it.each([
    ['a hex password', randomBytes(24).toString('hex')],
    ['a password SASLprep changes', 'päss wördﬁ­'],
  ])('matches the verifier PostgreSQL computes for %s', async (_label, password) => {
    const stored = await serverVerifier(password);
    const [, iterations, salt] = VERIFIER.exec(stored) ?? [];
    expect(iterations).toBeDefined();
    expect(
      scramSha256Verifier(password, Buffer.from(salt ?? '', 'base64'), Number(iterations)),
    ).toBe(stored);
  });

  it('lets a role created with it log in with the password over TCP', async () => {
    const { adminUrl } = requireTestDb();
    const admin = await connect(adminUrl);
    const role = `sift_test_scram_${randomBytes(6).toString('hex')}`;
    const password = randomBytes(24).toString('hex');
    try {
      const verifier = admin.escapeLiteral(scramSha256Verifier(password));
      await admin.query(`create role ${role} login password ${verifier}`);
      // The admin URL's own database: never the template, which other test
      // files clone and which must therefore have no sessions.
      const url = new URL(adminUrl);
      url.username = role;
      url.password = password;
      const client = await connect(url.toString());
      try {
        const { rows } = await client.query<{ me: string }>('select current_user as me');
        expect(rows).toEqual([{ me: role }]);
      } finally {
        await client.end();
      }
      // The server really checks the password on this connection.
      url.password = `${password}x`;
      await expect(connect(url.toString())).rejects.toMatchObject({ code: '28P01' });
    } finally {
      await admin.query(`drop role if exists ${role}`);
      await admin.end();
    }
  });
});
