CREATE TABLE "decision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_mailbox_id_id_key" UNIQUE("mailbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "decision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "folder_sync" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "folder_sync_mailbox_id_id_key" UNIQUE("mailbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "folder_sync" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "label" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_mailbox_id_id_key" UNIQUE("mailbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "label" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "label_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "label_event_mailbox_id_id_key" UNIQUE("mailbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "label_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mailbox_status" (
	"mailbox_id" uuid PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'ok' NOT NULL,
	"last_error" text,
	"last_sync_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_status_state_check" CHECK ("mailbox_status"."state" in ('ok', 'error', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "mailbox_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "rule_set" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_set_mailbox_id_id_key" UNIQUE("mailbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "rule_set" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_message_fk" FOREIGN KEY ("mailbox_id","message_id") REFERENCES "public"."message"("mailbox_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD CONSTRAINT "folder_sync_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_message_fk" FOREIGN KEY ("mailbox_id","message_id") REFERENCES "public"."message"("mailbox_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_event" ADD CONSTRAINT "label_event_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD CONSTRAINT "mailbox_status_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "decision" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "folder_sync" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "label" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "label_event" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "mailbox_status" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "rule_set" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);