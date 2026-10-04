import type pg from 'pg';
import { APPEND_ONLY_TABLE_NAMES, MAILBOX_COLUMNS } from '../../src/schema/index.ts';

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
const SIFT_ROLES = ['sift_app', 'sift_backup', 'sift_owner'] as const;
const APPEND_ONLY = new Set<string>(APPEND_ONLY_TABLE_NAMES.map((t) => `public.${t}`));
/** mailbox_status is keyed by mailbox_id alone (D-07), so it has no (mailbox_id, id). */
const STATUS_TABLE = 'public.mailbox_status';

type Privilege = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
const DML: readonly Privilege[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

interface RelationRow {
  oid: number;
  qualified: string;
  relkind: string;
  rls: boolean;
  force: boolean;
  /** null when the relation has no mailbox_id column. */
  mailbox_id_notnull: boolean | null;
  fk_to_mailbox: boolean;
  unique_mailbox_id_id: boolean;
  pk_columns: string[] | null;
  has_updated_at: boolean;
  updated_at_trigger: boolean;
  // sift_app privileges. UPDATE uses has_any_column_privilege, so a
  // column-level grant counts.
  app_select: boolean;
  app_insert: boolean;
  app_update: boolean;
  app_delete: boolean;
  app_truncate: boolean;
  app_references: boolean;
  app_trigger: boolean;
  // sift_backup write privileges (D-66: it must stay read-only).
  backup_insert: boolean;
  backup_update: boolean;
  backup_delete: boolean;
  backup_truncate: boolean;
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

interface ForeignKeyRow {
  conname: string;
  child: string;
  parent: string;
  mailbox_aligned: boolean;
}

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
  rolcreatedb: boolean;
}

const RELATIONS_SQL = `
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
    ) as fk_to_mailbox,
    exists (
      select 1 from pg_constraint k
      where k.conrelid = c.oid and k.contype in ('u', 'p')
        and array(
          select a.attname::text
          from unnest(k.conkey) with ordinality as u(attnum, ord)
            join pg_attribute a on a.attrelid = c.oid and a.attnum = u.attnum
          order by u.ord
        ) = array['mailbox_id', 'id']
    ) as unique_mailbox_id_id,
    (select array(
        select a.attname::text
        from unnest(k.conkey) with ordinality as u(attnum, ord)
          join pg_attribute a on a.attrelid = c.oid and a.attnum = u.attnum
        order by u.ord)
      from pg_constraint k where k.conrelid = c.oid and k.contype = 'p'
    ) as pk_columns,
    exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
    ) as has_updated_at,
    exists (
      select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
      where t.tgrelid = c.oid and not t.tgisinternal and t.tgenabled <> 'D'
        and (t.tgtype::int & 1) = 1    -- FOR EACH ROW
        and (t.tgtype::int & 2) = 2    -- BEFORE
        and (t.tgtype::int & 16) = 16  -- UPDATE
        and f.proname = 'set_updated_at'
    ) as updated_at_trigger,
    -- has_any_column_privilege: true for a table-level grant and for a grant on
    -- any single column, which has_table_privilege does not see.
    has_any_column_privilege('sift_app', c.oid, 'SELECT') as app_select,
    has_any_column_privilege('sift_app', c.oid, 'INSERT') as app_insert,
    has_any_column_privilege('sift_app', c.oid, 'UPDATE') as app_update,
    has_table_privilege('sift_app', c.oid, 'DELETE') as app_delete,
    has_table_privilege('sift_app', c.oid, 'TRUNCATE') as app_truncate,
    has_table_privilege('sift_app', c.oid, 'REFERENCES') as app_references,
    has_table_privilege('sift_app', c.oid, 'TRIGGER') as app_trigger,
    has_any_column_privilege('sift_backup', c.oid, 'INSERT') as backup_insert,
    has_any_column_privilege('sift_backup', c.oid, 'UPDATE') as backup_update,
    has_table_privilege('sift_backup', c.oid, 'DELETE') as backup_delete,
    has_table_privilege('sift_backup', c.oid, 'TRUNCATE') as backup_truncate
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg_toast%'
  order by 2`;

const POLICIES_SQL = `
  select p.polrelid::int as polrelid, p.polname, p.polcmd::text as polcmd, p.polpermissive,
    array(
      select case when o = 0 then 'public' else pg_get_userbyid(o)::text end
      from unnest(p.polroles) as o order by 1
    ) as roles,
    pg_get_expr(p.polqual, p.polrelid) as qual,
    pg_get_expr(p.polwithcheck, p.polrelid) as chk
  from pg_policy p
  order by p.polname`;

/** Every FK, with whether some position pairs mailbox_id with mailbox_id (D-04). */
const FOREIGN_KEYS_SQL = `
  select k.conname,
    cn.nspname || '.' || cc.relname as child,
    pn.nspname || '.' || pc.relname as parent,
    exists (
      select 1 from generate_subscripts(k.conkey, 1) as i
        join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = k.conkey[i]
        join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[i]
      where ca.attname = 'mailbox_id' and pa.attname = 'mailbox_id'
    ) as mailbox_aligned
  from pg_constraint k
    join pg_class cc on cc.oid = k.conrelid
    join pg_namespace cn on cn.oid = cc.relnamespace
    join pg_class pc on pc.oid = k.confrelid
    join pg_namespace pn on pn.oid = pc.relnamespace
  where k.contype = 'f'
  order by 2, 1`;

/**
 * Read pg_catalog and return every violation of the isolation rules
 * (ISO-01, ISO-02, D-04, D-06, D-07, D-37, D-38, D-40, D-41, D-66). Each entry
 * reads "<schema>.<table>: <problem>", "role <name>: <problem>" or
 * "allowlist: <problem>". An empty list means the schema is compliant.
 *
 * Run it as a superuser on a migrated database so every relation and role is
 * visible. `allowlist` is a test-only override.
 */
export async function collectCatalogViolations(
  client: pg.Client,
  allowlist: Record<string, string> = CATALOG_ALLOWLIST,
): Promise<string[]> {
  const violations: string[] = [];

  const { rows: siftRoles } = await client.query<RoleRow>(
    `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
     from pg_roles where rolname = any($1::text[]) order by 1`,
    [SIFT_ROLES],
  );
  const missing = SIFT_ROLES.filter((r) => !siftRoles.some((row) => row.rolname === r));
  if (missing.length > 0) {
    // The privilege functions below raise on an unknown role.
    return missing.map((r) => `role ${r}: does not exist`);
  }

  const { rows: relations } = await client.query<RelationRow>(RELATIONS_SQL);
  const { rows: policies } = await client.query<PolicyRow>(POLICIES_SQL);
  const { rows: foreignKeys } = await client.query<ForeignKeyRow>(FOREIGN_KEYS_SQL);
  const isScoped = (qualified: string) => !Object.hasOwn(allowlist, qualified);

  violations.push(...allowlistProblems(allowlist, relations));

  for (const rel of relations) {
    const scoped = isScoped(rel.qualified);
    if (scoped) {
      violations.push(...scopedTableProblems(rel, policies));
    }
    violations.push(...privilegeProblems(rel, scoped));
    if (rel.has_updated_at && (rel.relkind === 'r' || rel.relkind === 'p')) {
      if (!rel.updated_at_trigger) {
        violations.push(`${rel.qualified}: no BEFORE UPDATE row trigger calling set_updated_at()`);
      }
    }
  }

  for (const fk of foreignKeys) {
    if (isScoped(fk.child) && isScoped(fk.parent) && !fk.mailbox_aligned) {
      violations.push(
        `${fk.child}: foreign key ${fk.conname} to ${fk.parent} does not pair mailbox_id on both sides`,
      );
    }
  }

  violations.push(...(await registryProblems(client)));
  violations.push(...(await roleProblems(client, siftRoles)));
  return violations;
}

function allowlistProblems(allowlist: Record<string, string>, relations: RelationRow[]): string[] {
  const problems: string[] = [];
  const existing = new Set(relations.map((r) => r.qualified));
  for (const [key, reason] of Object.entries(allowlist)) {
    if (!existing.has(key)) {
      problems.push(`allowlist: ${key} does not exist (stale entry)`);
    }
    if (reason.trim() === '') {
      problems.push(`allowlist: ${key} has a blank reason`);
    }
  }
  return problems;
}

/** mailbox_id, FK, forced RLS, exactly one standard policy, composite key. */
function scopedTableProblems(rel: RelationRow, policies: PolicyRow[]): string[] {
  const problems: string[] = [];
  const name = rel.qualified;
  if (rel.mailbox_id_notnull === null) {
    problems.push(`${name}: has no mailbox_id column`);
  } else if (!rel.mailbox_id_notnull) {
    problems.push(`${name}: mailbox_id is not NOT NULL`);
  }
  if (!rel.fk_to_mailbox) {
    problems.push(`${name}: no single-column FK from mailbox_id to public.mailbox`);
  }
  if (!rel.rls) {
    problems.push(`${name}: row level security is not enabled`);
  }
  if (!rel.force) {
    problems.push(`${name}: row level security is not forced`);
  }
  const own = policies.filter((p) => p.polrelid === rel.oid);
  if (own.length !== 1) {
    problems.push(`${name}: has ${own.length} policies, expected exactly 1`);
  }
  for (const policy of own) {
    problems.push(...policyProblems(name, policy));
  }
  if (name === STATUS_TABLE) {
    const pk = rel.pk_columns ?? [];
    if (pk.join(',') !== 'mailbox_id') {
      problems.push(`${name}: primary key is (${pk.join(', ')}), expected (mailbox_id)`);
    }
  } else if (!rel.unique_mailbox_id_id) {
    problems.push(`${name}: no UNIQUE (mailbox_id, id)`);
  }
  return problems;
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

/** The DML privileges sift_app must hold on a relation (D-37, D-40); null = not prescribed. */
function expectedAppDml(qualified: string, scoped: boolean): Set<Privilege> | null {
  if (qualified === 'public.mailbox') {
    return new Set(['SELECT']);
  }
  if (qualified === 'drizzle.__drizzle_migrations') {
    return new Set();
  }
  if (!scoped) {
    return null;
  }
  if (APPEND_ONLY.has(qualified)) {
    return new Set(['SELECT', 'INSERT']);
  }
  return new Set(DML);
}

function privilegeProblems(rel: RelationRow, scoped: boolean): string[] {
  const problems: string[] = [];
  const name = rel.qualified;
  const held: Record<Privilege, boolean> = {
    SELECT: rel.app_select,
    INSERT: rel.app_insert,
    UPDATE: rel.app_update,
    DELETE: rel.app_delete,
  };
  const expected = expectedAppDml(name, scoped);
  if (expected !== null) {
    for (const privilege of DML) {
      if (expected.has(privilege) && !held[privilege]) {
        problems.push(`${name}: sift_app lacks ${privilege}`);
      }
      if (!expected.has(privilege) && held[privilege]) {
        problems.push(`${name}: sift_app has ${privilege}, expected none`);
      }
    }
  }
  const never: [string, boolean][] = [
    ['TRUNCATE', rel.app_truncate],
    ['REFERENCES', rel.app_references],
    ['TRIGGER', rel.app_trigger],
  ];
  for (const [privilege, has] of never) {
    if (has) {
      problems.push(`${name}: sift_app has ${privilege}, expected none`);
    }
  }
  const backupWrites: [string, boolean][] = [
    ['INSERT', rel.backup_insert],
    ['UPDATE', rel.backup_update],
    ['DELETE', rel.backup_delete],
    ['TRUNCATE', rel.backup_truncate],
  ];
  for (const [privilege, has] of backupWrites) {
    if (has) {
      problems.push(`${name}: sift_backup has ${privilege}, expected none`);
    }
  }
  return problems;
}

/** public.mailbox columns equal MAILBOX_COLUMNS in order (D-06). */
async function registryProblems(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ attname: string }>(
    `select attname from pg_attribute
     where attrelid = to_regclass('public.mailbox') and attnum > 0 and not attisdropped
     order by attnum`,
  );
  const actual = rows.map((r) => r.attname);
  if (actual.length === 0 || actual.join(',') === MAILBOX_COLUMNS.join(',')) {
    // A missing mailbox table is already reported as a stale allowlist entry.
    return [];
  }
  return [`public.mailbox: columns are (${actual.join(', ')}), expected MAILBOX_COLUMNS`];
}

/**
 * `role` must be a member of no other role, directly or indirectly. sift_app is
 * NOINHERIT, so has_table_privilege never sees what a membership brings, yet
 * `SET ROLE sift_backup` (BYPASSRLS + pg_read_all_data), pg_write_all_data or
 * sift_owner would each break isolation or append-only. Exported so tests can
 * point it at a throwaway role instead of changing the shared sift_app.
 */
export async function membershipProblems(client: pg.Client, role: string): Promise<string[]> {
  const { rows } = await client.query<{ rolname: string }>(
    `select b.rolname::text as rolname from pg_roles b
      where b.oid <> $1::regrole and pg_has_role($1::regrole, b.oid, 'MEMBER')
      order by 1`,
    [role],
  );
  return rows.map(({ rolname }) => `role ${role}: is a member of ${rolname}, expected none`);
}

/**
 * `role` must have none of the attributes that bypass or widen access:
 * SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, or REPLICATION (logical decoding
 * reads every row change past RLS, IN-11). Exported so tests can point it at a
 * throwaway role instead of changing the shared sift_app.
 */
export async function attributeProblems(client: pg.Client, role: string): Promise<string[]> {
  const { rows } = await client.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolreplication: boolean;
  }>(
    `select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication
       from pg_roles where oid = $1::regrole`,
    [role],
  );
  const attrs = rows[0];
  if (attrs === undefined) return [`role ${role}: does not exist`];
  const flags: [string, boolean][] = [
    ['SUPERUSER', attrs.rolsuper],
    ['BYPASSRLS', attrs.rolbypassrls],
    ['CREATEROLE', attrs.rolcreaterole],
    ['CREATEDB', attrs.rolcreatedb],
    ['REPLICATION', attrs.rolreplication],
  ];
  return flags.filter(([, has]) => has).map(([flag]) => `role ${role}: has ${flag}`);
}

/** D-37, D-41 and D-66 role assertions. */
async function roleProblems(client: pg.Client, siftRoles: RoleRow[]): Promise<string[]> {
  const problems: string[] = [];
  const role = (name: string) => siftRoles.find((r) => r.rolname === name);

  problems.push(...(await attributeProblems(client, 'sift_app')));

  // FORCE RLS must bind the owner (D-41).
  const owner = role('sift_owner');
  if (owner?.rolsuper) {
    problems.push('role sift_owner: has SUPERUSER');
  }
  if (owner?.rolbypassrls) {
    problems.push('role sift_owner: has BYPASSRLS');
  }

  const { rows: access } = await client.query<{
    public_create: boolean;
    drizzle_usage: boolean;
  }>(`
    select has_schema_privilege('sift_app', 'public', 'CREATE') as public_create,
      case when to_regnamespace('drizzle') is null then false
        else has_schema_privilege('sift_app', 'drizzle', 'USAGE') end as drizzle_usage`);
  const schemaAccess = access[0];
  if (schemaAccess?.public_create) {
    problems.push('role sift_app: has CREATE on schema public');
  }
  if (schemaAccess?.drizzle_usage) {
    problems.push('role sift_app: has USAGE on schema drizzle');
  }
  problems.push(...(await membershipProblems(client, 'sift_app')));

  for (const name of ['sift_app', 'sift_backup']) {
    const { rows } = await client.query<{ relations: number; functions: number; schemas: number }>(
      `select
         (select count(*)::int from pg_class where relowner = $1::regrole) as relations,
         (select count(*)::int from pg_proc where proowner = $1::regrole) as functions,
         (select count(*)::int from pg_namespace where nspowner = $1::regrole) as schemas`,
      [name],
    );
    const owned = rows[0];
    if (owned !== undefined && owned.relations + owned.functions + owned.schemas > 0) {
      problems.push(
        `role ${name}: owns ${owned.relations} relations, ${owned.functions} functions, ${owned.schemas} schemas; expected none`,
      );
    }
  }

  // D-66: sift_backup is the only non-superuser allowed to bypass RLS.
  const { rows: bypass } = await client.query<{ rolname: string }>(
    'select rolname from pg_roles where rolbypassrls and not rolsuper order by 1',
  );
  for (const { rolname } of bypass) {
    if (rolname !== 'sift_backup' && rolname !== 'sift_app' && rolname !== 'sift_owner') {
      problems.push(`role ${rolname}: has BYPASSRLS; only sift_backup may bypass RLS`);
    }
  }
  if (!bypass.some((r) => r.rolname === 'sift_backup')) {
    problems.push('role sift_backup: lacks BYPASSRLS, so pg_dump cannot read forced-RLS tables');
  }
  return problems;
}
