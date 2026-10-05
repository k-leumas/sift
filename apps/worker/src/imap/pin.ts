import { createHash, X509Certificate } from 'node:crypto';
import type { PeerCertificate } from 'node:tls';

/**
 * SPKI fingerprint of a PEM certificate: base64 of SHA-256 over the DER
 * SubjectPublicKeyInfo. This is the value of `imap.tls.pin_sha256` in
 * config.yaml and the one bridge/entrypoint.sh logs (D-40, D-73), equal to
 * `openssl x509 -pubkey -noout | openssl pkey -pubin -outform DER |
 * openssl dgst -sha256 -binary | openssl base64 -A`. 44 characters ending in '='.
 */
export function spkiSha256(pem: string): string {
  const spki = new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('base64');
}

/**
 * The same fingerprint for a certificate seen during a TLS handshake: Node's
 * `pubkey` is the DER SubjectPublicKeyInfo.
 */
export function peerSpkiSha256(cert: PeerCertificate): string {
  if (!cert || !Buffer.isBuffer(cert.pubkey) || cert.pubkey.length === 0) {
    throw new Error('peer certificate has no public key');
  }
  return createHash('sha256').update(cert.pubkey).digest('base64');
}

/** PEM text of a DER certificate (e.g. PeerCertificate.raw). Throws on a non-certificate. */
export function pemFromDer(der: Buffer): string {
  return new X509Certificate(der).toString();
}
