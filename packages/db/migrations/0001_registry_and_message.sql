CREATE TABLE "mailbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text,
	"imap_host" text NOT NULL,
	"imap_port" integer NOT NULL,
	"imap_username" text NOT NULL,
	"imap_folder" text NOT NULL,
	"password_env" text NOT NULL,
	"labels_apply_as" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailbox_slug_unique" UNIQUE("slug"),
	CONSTRAINT "mailbox_slug_format" CHECK ("mailbox"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("mailbox"."slug") <= 40),
	CONSTRAINT "mailbox_imap_port_range" CHECK ("mailbox"."imap_port" BETWEEN 1 AND 65535)
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_mailbox_id_id_key" UNIQUE("mailbox_id","id")
);
--> statement-breakpoint
ALTER TABLE "message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "message" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);