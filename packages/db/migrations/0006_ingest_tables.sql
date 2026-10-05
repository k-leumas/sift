CREATE TABLE "message_body" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"body_text" text NOT NULL,
	"source" text NOT NULL,
	"truncated" boolean NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_body_mailbox_id_id_key" UNIQUE("mailbox_id","id"),
	CONSTRAINT "message_body_mailbox_id_message_id_key" UNIQUE("mailbox_id","message_id"),
	CONSTRAINT "message_body_source_check" CHECK ("message_body"."source" in ('text_plain', 'text_html', 'none'))
);
--> statement-breakpoint
ALTER TABLE "message_body" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_location" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"folder" text NOT NULL,
	"uidvalidity" bigint NOT NULL,
	"uid" bigint NOT NULL,
	"generation" integer NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_location_mailbox_id_id_key" UNIQUE("mailbox_id","id"),
	CONSTRAINT "message_location_mailbox_id_folder_uidvalidity_uid_key" UNIQUE("mailbox_id","folder","uidvalidity","uid"),
	CONSTRAINT "message_location_removed_check" CHECK (("message_location"."removed_at" is null and "message_location"."removed_reason" is null) or ("message_location"."removed_at" is not null and "message_location"."removed_reason" is not null and "message_location"."removed_reason" in ('vanished', 'superseded')))
);
--> statement-breakpoint
ALTER TABLE "message_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mailbox_status" DROP CONSTRAINT "mailbox_status_state_check";--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "folder" text NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "uidvalidity" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "last_uid" bigint NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "internal_date_watermark" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "state" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "pending_uidvalidity" bigint;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "pending_generation" integer;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "last_resync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "last_resync_summary" jsonb;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "backfill_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "backfill_cursor_uid" bigint;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "backfill_until_uid" bigint;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD COLUMN "backfill_total" integer;--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD COLUMN "held_new_count" integer;--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD COLUMN "approved_new_count" integer;--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD COLUMN "backfill_done" integer;--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD COLUMN "backfill_total" integer;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "identity_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "message_id_header" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "internal_date" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "from_address" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "from_domain" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "headers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "eligible_for_classification" boolean NOT NULL;--> statement-breakpoint
ALTER TABLE "message_body" ADD CONSTRAINT "message_body_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_body" ADD CONSTRAINT "message_body_message_fk" FOREIGN KEY ("mailbox_id","message_id") REFERENCES "public"."message"("mailbox_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_location" ADD CONSTRAINT "message_location_mailbox_id_mailbox_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_location" ADD CONSTRAINT "message_location_message_fk" FOREIGN KEY ("mailbox_id","message_id") REFERENCES "public"."message"("mailbox_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_body_expires_at_idx" ON "message_body" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "message_location_message_idx" ON "message_location" USING btree ("mailbox_id","message_id");--> statement-breakpoint
CREATE INDEX "message_location_live_idx" ON "message_location" USING btree ("mailbox_id","folder") WHERE removed_at is null;--> statement-breakpoint
ALTER TABLE "folder_sync" ADD CONSTRAINT "folder_sync_mailbox_id_folder_key" UNIQUE("mailbox_id","folder");--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_mailbox_id_identity_key_key" UNIQUE("mailbox_id","identity_key");--> statement-breakpoint
ALTER TABLE "folder_sync" ADD CONSTRAINT "folder_sync_state_check" CHECK ("folder_sync"."state" in ('ok', 'resyncing'));--> statement-breakpoint
ALTER TABLE "folder_sync" ADD CONSTRAINT "folder_sync_pending_check" CHECK (("folder_sync"."state" = 'resyncing') = ("folder_sync"."pending_uidvalidity" is not null and "folder_sync"."pending_generation" is not null));--> statement-breakpoint
ALTER TABLE "folder_sync" ADD CONSTRAINT "folder_sync_backfill_check" CHECK (num_nonnulls("folder_sync"."backfill_since", "folder_sync"."backfill_cursor_uid", "folder_sync"."backfill_until_uid", "folder_sync"."backfill_total") in (0, 4));--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD CONSTRAINT "mailbox_status_held_check" CHECK ("mailbox_status"."state" <> 'needs_attention' or "mailbox_status"."held_new_count" is not null);--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD CONSTRAINT "mailbox_status_backfill_check" CHECK (("mailbox_status"."backfill_done" is null) = ("mailbox_status"."backfill_total" is null));--> statement-breakpoint
ALTER TABLE "mailbox_status" ADD CONSTRAINT "mailbox_status_state_check" CHECK ("mailbox_status"."state" in ('ok', 'error', 'disabled', 'connecting', 'needs_attention'));--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_identity_key_check" CHECK ("message"."identity_key" ~ '^(pm:.+|mid:.+|hdr:v[0-9]+:[0-9a-f]{64})$');--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "message_body" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "mailbox_isolation" ON "message_location" AS PERMISSIVE FOR ALL TO "sift_app", "sift_owner" USING (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid) WITH CHECK (mailbox_id = nullif(current_setting('app.mailbox_id', true), '')::uuid);