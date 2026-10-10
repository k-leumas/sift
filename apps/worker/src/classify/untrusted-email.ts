import type { MatchableMessage, UntrustedEmail } from '@sift/core/classify';
import type { ClassifyCandidate } from '@sift/db';
import { addressParser } from 'postal-mime';

/**
 * The tiers' views of a stored message (D-08, D-21, RESEARCH Pattern 6),
 * built from the database rows alone, without IMAP. Every field here is
 * mail-derived and untrusted: the exact rules compare it as text, and the
 * LLM tier puts it inside the fence. Only From goes into the prompt; Sender
 * and Reply-To are stored but never read here (D-21).
 */

/** The display name of a decoded From header, or null when it has none. */
function displayName(header: string | undefined): string | null {
  if (header === undefined) return null;
  let parsed: ReturnType<typeof addressParser>;
  try {
    parsed = addressParser(header);
  } catch {
    return null;
  }
  const name = parsed[0]?.name;
  return typeof name === 'string' && name.trim() !== '' ? name : null;
}

/** The LLM tier's input for one stored message. */
export function untrustedEmailOf(candidate: ClassifyCandidate): UntrustedEmail {
  return {
    fromAddress: candidate.fromAddress ?? '',
    fromName: displayName(candidate.headers.from?.[0]),
    subject: candidate.subject ?? '',
    attachmentNames: candidate.attachments.flatMap((a) => (a.name === null ? [] : [a.name])),
    body: candidate.body?.text ?? '',
  };
}

/** The exact-rules tier's input: the stored From address and domain, subject and body text. */
export function matchableOf(candidate: ClassifyCandidate): MatchableMessage {
  return {
    fromAddress: candidate.fromAddress,
    fromDomain: candidate.fromDomain,
    subject: candidate.subject,
    body: candidate.body?.text ?? null,
  };
}
