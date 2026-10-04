import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** PostgreSQL's default scram_iterations. */
export const SCRAM_ITERATIONS = 4096;

const SALT_BYTES = 16;

/**
 * SASLprep mapping (RFC 4013) as node-postgres applies it before SCRAM: non-ASCII
 * spaces become U+0020, "commonly mapped to nothing" characters are removed,
 * then NFKC. Matching the client is what lets the worker log in with the same
 * password; for the hex passwords .env.example asks for it changes nothing.
 */
function saslprep(password: string): string {
  return password
    .replace(/[   -​  　]/g, ' ')
    .replace(/­|͏|᠆|[᠋-᠍]|‌|‍|⁠|[︀-️]|﻿/g, '')
    .normalize('NFKC');
}

/**
 * A SCRAM-SHA-256 verifier in PostgreSQL's stored format
 * (`SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`), built on the
 * client (IN-03). `CREATE/ALTER ROLE ... PASSWORD '<verifier>'` stores it as is,
 * so the plaintext password never appears in a statement the server could log.
 * The verifier still allows an offline guessing attack, so it is not public.
 */
export function scramSha256Verifier(
  password: string,
  salt: Buffer = randomBytes(SALT_BYTES),
  iterations: number = SCRAM_ITERATIONS,
): string {
  const salted = pbkdf2Sync(saslprep(password), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
