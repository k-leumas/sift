-- Preflight for 0009 (Phase 3): decision and rule_set gain NOT NULL columns
-- (the trace and the rule-set snapshot) that no existing row can describe, so
-- refuse to migrate a database that already holds such rows. Phase 2 never
-- classified mail, so only manual SQL can have put them there. The owner is
-- subject to FORCE RLS, so each mailbox is checked under its own
-- app.mailbox_id. The exception stops the migrator's single transaction:
-- nothing from this run is applied.
DO $$
DECLARE
  box record;
BEGIN
  FOR box IN SELECT id, slug FROM mailbox ORDER BY slug LOOP
    PERFORM set_config('app.mailbox_id', box.id::text, true);
    IF EXISTS (SELECT 1 FROM decision) OR EXISTS (SELECT 1 FROM rule_set) THEN
      RAISE EXCEPTION 'Sift''s Phase 3 schema adds required columns to decision and rule_set, but mailbox % already has rows there that Sift did not write (Phase 2 never classified mail). sift migrate stopped and changed nothing; remove those rows or restore the pre-migration backup, then run sift migrate again.', box.slug;
    END IF;
  END LOOP;
  PERFORM set_config('app.mailbox_id', '', true);
END
$$;
