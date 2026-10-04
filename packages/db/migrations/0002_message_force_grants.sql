ALTER TABLE "message" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "mailbox" TO sift_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message" TO sift_app;--> statement-breakpoint
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;--> statement-breakpoint
CREATE TRIGGER mailbox_set_updated_at BEFORE UPDATE ON "mailbox" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER message_set_updated_at BEFORE UPDATE ON "message" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
