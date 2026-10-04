/** Mailbox slug shape (D-63): lowercase ASCII words joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Checked separately from the pattern so the owner gets a clear "slug too long". */
export const SLUG_MAX_LENGTH = 40;

/** Slugs that collide with fixed routes and CLI words. */
export const RESERVED_SLUGS: readonly string[] = ['all', 'new', 'settings', 'shared'];

/**
 * Validate a mailbox slug. Returns null when valid, otherwise the message shown
 * to the owner. Invalid values are rejected as they are and never auto-fixed.
 */
export function validateSlug(value: unknown): string | null {
  if (value === undefined) return 'slug is required';
  if (typeof value === 'number') {
    return `slug ${value} is a number; quote it: slug: "${value}"`;
  }
  if (typeof value !== 'string') return 'slug must be a string';
  if (value === '') return 'slug must not be empty';

  const length = [...value].length;
  if (length > SLUG_MAX_LENGTH) {
    return `slug too long (${length} characters, max ${SLUG_MAX_LENGTH})`;
  }
  if (/[A-Z]/.test(value)) return `slugs must be lowercase ("${value}")`;
  if (!SLUG_PATTERN.test(value)) {
    return 'slugs may contain only a-z, 0-9 and single hyphens, and cannot start or end with a hyphen';
  }
  if (RESERVED_SLUGS.includes(value)) return `slug "${value}" is reserved`;
  return null;
}
