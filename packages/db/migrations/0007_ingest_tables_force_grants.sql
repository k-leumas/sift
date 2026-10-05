ALTER TABLE "message_location" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_body" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_location", "message_body" TO sift_app;--> statement-breakpoint
CREATE TRIGGER message_location_set_updated_at BEFORE UPDATE ON "message_location" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER message_body_set_updated_at BEFORE UPDATE ON "message_body" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
