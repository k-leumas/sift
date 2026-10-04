/** Longest wait between attempts for a failing mailbox: 15 minutes (D-51). */
export const BACKOFF_CAP_MS = 900_000;

/**
 * Delay before the next attempt after `failures` consecutive failures (D-51):
 * `intervalMs * 2^failures`, capped, then jittered by +/-20% (`random` is in
 * [0, 1]) and capped again so jitter never exceeds the cap.
 */
export function computeBackoff(failures: number, intervalMs: number, random: () => number): number {
  const base = Math.min(BACKOFF_CAP_MS, intervalMs * 2 ** failures);
  const jittered = base * (0.8 + 0.4 * random());
  return Math.min(BACKOFF_CAP_MS, Math.round(jittered));
}
