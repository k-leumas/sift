-- Preflight for 0006 (T-02-63): message and folder_sync gain NOT NULL and
-- UNIQUE columns that no existing row can describe, so refuse to migrate a
-- database that already holds such rows. Phase 1 never stored mail, so only
-- manual SQL can have put them there. The owner is subject to FORCE RLS, so
-- each mailbox is checked under its own app.mailbox_id. The exception stops
-- the migrator's single transaction: nothing from this run is applied.
DO $$
DECLARE
  box record;
BEGIN
  FOR box IN SELECT id, slug FROM mailbox ORDER BY slug LOOP
    PERFORM set_config('app.mailbox_id', box.id::text, true);
    IF EXISTS (SELECT 1 FROM message) OR EXISTS (SELECT 1 FROM folder_sync) THEN
      RAISE EXCEPTION 'Sift''s Phase 2 schema needs empty message and folder_sync tables, but mailbox % already has rows that Sift did not write (Phase 1 never stored mail). sift migrate stopped and changed nothing; remove those rows or restore the pre-migration backup, then run sift migrate again.', box.slug;
    END IF;
  END LOOP;
  PERFORM set_config('app.mailbox_id', '', true);
END
$$;
