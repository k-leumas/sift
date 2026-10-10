import { canonicalJson, sha256Hex } from '../classify/canonical.ts';
import { RULES_FORMAT_VERSION, type RulesConfig } from './schema.ts';

/**
 * Rule-set identity (D-03, TRC-04): the worker hashes the validated rules and
 * inserts a rule_set row when the hash is new, so editing rules.yaml needs no
 * setup step.
 *
 * The hash covers the validated, normalised object (the 03-01 schema already
 * lowercases from/domain entries, drops a trailing dot, collapses phrase
 * spacing and fills in `in: any`), encoded as canonical JSON. YAML comments,
 * blank lines, key order and quoting therefore never create a new version,
 * while any change to a name, description, judgment line, rule order,
 * condition or label does. The hash is computed in code, never over jsonb
 * text, because Postgres reorders jsonb keys.
 */
export interface RuleSetVersion {
  /** sha256 hex of canonicalJson({ format_version, rules: snapshot }). */
  hash: string;
  formatVersion: number;
  /** The validated rules as plain JSON, stored in rule_set.snapshot for replay. */
  snapshot: RulesConfig;
}

export function ruleSetVersionOf(rules: RulesConfig): RuleSetVersion {
  const material = canonicalJson({ format_version: RULES_FORMAT_VERSION, rules });
  // A copy made from the hashed text: plain JSON, shares nothing with the
  // caller, and hashes back to the same value.
  const { rules: snapshot } = JSON.parse(material) as { rules: RulesConfig };
  return { hash: sha256Hex(material), formatVersion: RULES_FORMAT_VERSION, snapshot };
}
