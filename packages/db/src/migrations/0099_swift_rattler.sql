CREATE TABLE "connector_tool_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_connector_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"namespaced_name" text NOT NULL,
	"description" text,
	"input_schema" jsonb,
	"allowed_packages" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_key" text NOT NULL,
	"connector_name" text NOT NULL,
	"description" text,
	"endpoint_url" text,
	"hosting_mode" text DEFAULT 'remote' NOT NULL,
	"auth_type" text,
	"credential_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_packages" text[] DEFAULT '{}' NOT NULL,
	"provision_spec" jsonb,
	"capabilities" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connectors_connector_key_unique" UNIQUE("connector_key")
);
--> statement-breakpoint
CREATE TABLE "tenant_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_config' NOT NULL,
	"credential_refs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resolved_endpoint" text,
	"namespace" text NOT NULL,
	"last_handshake_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD COLUMN "issue_comment_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_trust" jsonb;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "deleted_by_type" text;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "deleted_by_agent_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "deleted_by_user_id" text;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "deleted_by_run_id" uuid;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD COLUMN "source_trust" jsonb;--> statement-breakpoint
ALTER TABLE "issue_work_products" ADD COLUMN "source_trust" jsonb;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "source_trust" jsonb;--> statement-breakpoint
ALTER TABLE "connector_tool_registry" ADD CONSTRAINT "connector_tool_registry_tenant_connector_id_tenant_connectors_id_fk" FOREIGN KEY ("tenant_connector_id") REFERENCES "public"."tenant_connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_connectors" ADD CONSTRAINT "tenant_connectors_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_tool_registry_tool_uq" ON "connector_tool_registry" USING btree ("tenant_connector_id","tool_name");--> statement-breakpoint
CREATE INDEX "connector_tool_registry_tc_idx" ON "connector_tool_registry" USING btree ("tenant_connector_id");--> statement-breakpoint
CREATE INDEX "connectors_status_idx" ON "connectors" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_connectors_tenant_connector_uq" ON "tenant_connectors" USING btree ("tenant_id","connector_id");--> statement-breakpoint
CREATE INDEX "tenant_connectors_tenant_idx" ON "tenant_connectors" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_connectors_status_idx" ON "tenant_connectors" USING btree ("status");--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_issue_comment_id_issue_comments_id_fk" FOREIGN KEY ("issue_comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_agent_id_agents_id_fk" FOREIGN KEY ("deleted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("deleted_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_annotation_comments_issue_comment_idx" ON "document_annotation_comments" USING btree ("issue_comment_id");