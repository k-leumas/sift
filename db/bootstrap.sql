-- db/bootstrap.sql
--
-- Superuser-only, idempotent cluster bootstrap for Sift (D-39, D-66).
--
-- Runs through psql as the image superuser with ON_ERROR_STOP:
--   * Compose: mounted at /docker-entrypoint-initdb.d/10-sift-bootstrap.sql and
--     run once on first volume init (environment comes from the db service).
--   * CI / tests / reruns:
--       docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres \
--         -f /docker-entrypoint-initdb.d/10-sift-bootstrap.sql
--
-- What it does:
--   * roles sift_owner (owns the schema, creates sift_app) and sift_backup
--     (dump-only, BYPASSRLS + pg_read_all_data, owns nothing)
--   * database sift owned by sift_owner
--   * extension vector in template1 (inherited by every later database,
--     including sift_test_*) and in sift
--
-- It deliberately does NOT create the application role sift_app: a role made
-- by the superuser cannot be altered by sift_owner, so `sift migrate` creates
-- it as sift_owner.
--
-- A rerun changes nothing except rotating the two role passwords to the
-- current environment values. Passwords are only ever embedded via
-- format('%L'), never concatenated into SQL.

\getenv owner_pw SIFT_DB_OWNER_PASSWORD
\getenv backup_pw SIFT_DB_BACKUP_PASSWORD

-- Fail loudly when a password is missing or empty instead of creating a role
-- with an unusable password.
\if :{?owner_pw}
\else
\set owner_pw ''
\endif
\if :{?backup_pw}
\else
\set backup_pw ''
\endif
SELECT (:'owner_pw' = '' OR :'backup_pw' = '') AS sift_pw_missing \gset
\if :sift_pw_missing
DO $$
BEGIN
  RAISE EXCEPTION 'db/bootstrap.sql: SIFT_DB_OWNER_PASSWORD and SIFT_DB_BACKUP_PASSWORD must be set and non-empty';
END
$$;
\endif

-- The role statements below carry the passwords in plain text (psql cannot
-- build a SCRAM verifier). initdb runs with log_statement = none; never rerun
-- this file on a server whose log_statement is 'ddl' or 'all'.

-- sift_owner: owns database sift and its schema; CREATEROLE so `sift migrate`
-- can create and later ALTER sift_app (PG16+: only roles it created).
SELECT format(
  'CREATE ROLE sift_owner LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOCREATEDB PASSWORD %L',
  :'owner_pw'
)
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sift_owner') \gexec

-- sift_backup: pg_dump only (D-66). BYPASSRLS so FORCE RLS tables dump fully.
SELECT format(
  'CREATE ROLE sift_backup LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'backup_pw'
)
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sift_backup') \gexec

-- Always re-assert attributes and rotate passwords to the env values.
SELECT format(
  'ALTER ROLE sift_owner LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOCREATEDB PASSWORD %L',
  :'owner_pw'
) \gexec
SELECT format(
  'ALTER ROLE sift_backup LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD %L',
  :'backup_pw'
) \gexec

GRANT pg_read_all_data TO sift_backup;

-- pgvector is not a trusted extension, so only a superuser can create it.
-- Creating it in template1 means every later CREATE DATABASE inherits it.
\connect template1
CREATE EXTENSION IF NOT EXISTS vector;

\connect postgres
SELECT 'CREATE DATABASE sift OWNER sift_owner'
WHERE NOT EXISTS (SELECT FROM pg_catalog.pg_database WHERE datname = 'sift') \gexec

\connect sift
CREATE EXTENSION IF NOT EXISTS vector;
