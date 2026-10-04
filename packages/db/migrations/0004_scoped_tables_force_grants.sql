ALTER TABLE "mailbox_status" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "label" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "folder_sync" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "label_event" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rule_set" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "mailbox_status", "label", "folder_sync", "rule_set" TO sift_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "decision", "label_event" TO sift_app;--> statement-breakpoint
CREATE TRIGGER mailbox_status_set_updated_at BEFORE UPDATE ON "mailbox_status" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER label_set_updated_at BEFORE UPDATE ON "label" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER decision_set_updated_at BEFORE UPDATE ON "decision" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER folder_sync_set_updated_at BEFORE UPDATE ON "folder_sync" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER label_event_set_updated_at BEFORE UPDATE ON "label_event" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER rule_set_set_updated_at BEFORE UPDATE ON "rule_set" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
