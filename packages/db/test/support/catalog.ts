import type pg from 'pg';

/**
 * Relations exempt from the scoped-table invariants (D-38). "Exempt" means
 * checked differently, never unchecked: every key must exist and every reason
 * must be non-blank. Keys are schema-qualified.
 */
export const CATALOG_ALLOWLIST: Record<string, string> = {
  'public.mailbox': 'unscoped mailbox registry: configuration, not mail-derived (D-06)',
  'drizzle.__drizzle_migrations': 'migration bookkeeping owned by sift_owner (D-37)',
};

/** The D-41 policy expression as Postgres stores it (normalized by pg_get_expr). */
export const STANDARD_POLICY_EXPR =
  "(mailbox_id = (NULLIF(current_setting('app.mailbox_id'::text, true), ''::text))::uuid)";

const POLICY_ROLES = ['sift_app', 'sift_owner'];

interface RelationRow {
  oid: number;
  qualified: string;
  relkind: string;
  rls: boolean;
  force: boolean;
  /** null when the relation has no mailbox_id column. */
  mailbox_id_notnull: boolean | null;
  fk_to_mailbox: boolean;
}

interface PolicyRow {
  polrelid: number;
  polname: string;
  polcmd: string;
  polpermissive: boolean;
  roles: string[];
  qual: string | null;
  chk: string | null;
}

/**
 * Read pg_catalog and return every violation of the isolation rules
 * (ISO-01, ISO-02, D-37, D-38). Each entry reads "<schema>.<table>: <problem>",
 * "role <name>: <problem>" or "allowlist: <problem>". An empty list means the
 * schema is compliant.
 *
 * Run it as a superuser (or a role that can see every relation) on a migrated
 * database. `allowlist` is a test-only override.
 */
export async function collectCatalogViolations(
  client: pg.Client,
  allowlist: Record<string, string> = CATALOG_ALLOWLIST,
): Promise<string[]> {
  const violations: string[] = [];

  const { rows: relations } = await client.query<RelationRow>(`
    select c.oid::int as oid,
      n.nspname || '.' || c.relname as qualified,
      c.relkind::text as relkind,
      c.relrowsecurity as rls,
      c.relforcerowsecurity as force,
      (select a.attnotnull from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'mailbox_id' and not a.attisdropped
      ) as mailbox_id_notnull,
      exists (
        select 1 from pg_constraint k
          join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
        where k.conrelid = c.oid and k.contype = 'f'
          and k.confrelid = 'public.mailbox'::regclass
          and a.attname = 'mailbox_id' and array_length(k.conkey, 1) = 1
      ) as fk_to_mailbox
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'v', 'm', 'f')
      and n.nspname not in ('pg_catalog', 'information_schema')
      and n.nspname not like 'pg_toast%'
    order by 2`);

  const { rows: policies } = await client.query<PolicyRow>(`
    select p.polrelid::int as polrelid, p.polname, p.polcmd::text as polcmd, p.polpermissive,
      array(
        select case when o = 0 then 'public' else pg_get_userbyid(o)::text end
        from unnest(p.polroles) as o order by 1
      ) as roles,
      pg_get_expr(p.polqual, p.polrelid) as qual,
      pg_get_expr(p.polwithcheck, p.polrelid) as chk
    from pg_policy p
    order by p.polname`);

  const existing = new Set(relations.map((r) => r.qualified));
  for (const [key, reason] of Object.entries(allowlist)) {
    if (!existing.has(key)) {
      violations.push(`allowlist: ${key} does not exist (stale entry)`);
    }
    if (reason.trim() === '') {
      violations.push(`allowlist: ${key} has a blank reason`);
    }
  }

  for (const rel of relations) {
    if (Object.hasOwn(allowlist, rel.qualified)) {
      continue;
    }
    const name = rel.qualified;
    if (rel.mailbox_id_notnull === null) {
      violations.push(`${name}: has no mailbox_id column`);
    } else if (!rel.mailbox_id_notnull) {
      violations.push(`${name}: mailbox_id is not NOT NULL`);
    }
    if (!rel.fk_to_mailbox) {
      violations.push(`${name}: no single-column FK from mailbox_id to public.mailbox`);
    }
    if (!rel.rls) {
      violations.push(`${name}: row level security is not enabled`);
    }
    if (!rel.force) {
      violations.push(`${name}: row level security is not forced`);
    }
    const own = policies.filter((p) => p.polrelid === rel.oid);
    if (own.length !== 1) {
      violations.push(`${name}: has ${own.length} policies, expected exactly 1`);
    }
    for (const policy of own) {
      violations.push(...policyProblems(name, policy));
    }
  }

  return violations;
}

/** Differences between one policy and the standard D-41 policy. */
function policyProblems(name: string, policy: PolicyRow): string[] {
  const problems: string[] = [];
  const label = `${name}: policy ${policy.polname}`;
  if (policy.polcmd !== '*') {
    problems.push(`${label} is FOR ${policy.polcmd}, expected FOR ALL`);
  }
  if (!policy.polpermissive) {
    problems.push(`${label} is restrictive, expected permissive`);
  }
  if (policy.roles.join(',') !== POLICY_ROLES.join(',')) {
    problems.push(
      `${label} applies to {${policy.roles.join(',')}}, expected {sift_app,sift_owner}`,
    );
  }
  if (policy.qual !== STANDARD_POLICY_EXPR) {
    problems.push(`${label} USING is ${String(policy.qual)}, expected the standard expression`);
  }
  if (policy.chk !== STANDARD_POLICY_EXPR) {
    problems.push(`${label} WITH CHECK is ${String(policy.chk)}, expected the standard expression`);
  }
  return problems;
}
