CREATE TABLE "prompt_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version" integer NOT NULL,
	"hash" text NOT NULL,
	"template" text NOT NULL,
	"schema_shape" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_version_version_unique" UNIQUE("version"),
	CONSTRAINT "prompt_version_hash_unique" UNIQUE("hash"),
	CONSTRAINT "prompt_version_version_check" CHECK ("prompt_version"."version" >= 1),
	CONSTRAINT "prompt_version_hash_check" CHECK ("prompt_version"."hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "prompt_version_schema_shape_check" CHECK (jsonb_typeof("prompt_version"."schema_shape") = 'object')
);
--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "outcome" text NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "confidence" double precision;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "tier" text NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "review_reason" text;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "rule_set_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "prompt_version_id" uuid;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "decided_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "trace_format_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD COLUMN "spans" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_set" ADD COLUMN "version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_set" ADD COLUMN "hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_set" ADD COLUMN "format_version" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_set" ADD COLUMN "snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_rule_set_fk" FOREIGN KEY ("mailbox_id","rule_set_id") REFERENCES "public"."rule_set"("mailbox_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_prompt_version_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_message_idx" ON "decision" USING btree ("mailbox_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_one_worker_per_message" ON "decision" USING btree ("mailbox_id","message_id") WHERE decided_by = 'worker';--> statement-breakpoint
CREATE INDEX "message_pending_idx" ON "message" USING btree ("mailbox_id","internal_date" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE eligible_for_classification;--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_mailbox_id_hash_key" UNIQUE("mailbox_id","hash");--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_mailbox_id_version_key" UNIQUE("mailbox_id","version");--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_outcome_check" CHECK ("decision"."outcome" in ('labelled', 'review'));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_category_check" CHECK (("decision"."outcome" = 'labelled') = ("decision"."category" is not null));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_tier_check" CHECK ("decision"."tier" in ('exact_rules', 'llm'));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_review_reason_check" CHECK ((("decision"."outcome" = 'review') = ("decision"."review_reason" is not null)) and ("decision"."review_reason" is null or "decision"."review_reason" in ('low_confidence', 'invalid_output', 'out_of_category', 'input_too_long')));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_exact_rules_check" CHECK ("decision"."tier" <> 'exact_rules' or ("decision"."outcome" = 'labelled' and "decision"."confidence" is null and "decision"."prompt_version_id" is null and "decision"."model" is null));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_llm_check" CHECK ("decision"."tier" <> 'llm' or ("decision"."prompt_version_id" is not null and "decision"."model" is not null));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_confidence_check" CHECK (("decision"."confidence" is null or ("decision"."confidence" >= 0 and "decision"."confidence" <= 1)) and (("decision"."tier" = 'llm' and ("decision"."outcome" = 'labelled' or "decision"."review_reason" is not distinct from 'low_confidence')) = ("decision"."confidence" is not null)));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_decided_by_check" CHECK ("decision"."decided_by" in ('worker', 'rerun'));--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_trace_format_check" CHECK ("decision"."trace_format_version" >= 1);--> statement-breakpoint
ALTER TABLE "decision" ADD CONSTRAINT "decision_spans_check" CHECK (jsonb_typeof("decision"."spans") = 'array');--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_version_check" CHECK ("rule_set"."version" >= 1 and "rule_set"."format_version" >= 1);--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_hash_check" CHECK ("rule_set"."hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "rule_set" ADD CONSTRAINT "rule_set_snapshot_check" CHECK (jsonb_typeof("rule_set"."snapshot") = 'object');