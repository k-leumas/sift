import { createHash } from 'node:crypto';

/**
 * Canonical JSON for content hashes (the prompt_version hash here, the
 * rule-set hash in 03-04): object keys sorted recursively by UTF-16 code unit,
 * arrays kept in order, no whitespace. Values JSON cannot represent exactly
 * (undefined, functions, symbols, bigints, NaN, Infinity) throw a TypeError
 * instead of being dropped or turned into null, so two different inputs can
 * never hash alike by accident.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: cannot encode a value of type ${typeof value}`);
  }
}

/** SHA-256 of the UTF-8 encoding of `text`, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
