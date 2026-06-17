CREATE TABLE "connector_tool_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_connector_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"tool_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"config_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_type" text DEFAULT 'none' NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"display_name" text,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"auth_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
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
ALTER TABLE "connector_tool_registry" ADD CONSTRAINT "connector_tool_registry_tenant_connector_id_tenant_connectors_id_fk" FOREIGN KEY ("tenant_connector_id") REFERENCES "public"."tenant_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_connectors" ADD CONSTRAINT "tenant_connectors_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_connectors" ADD CONSTRAINT "tenant_connectors_connector_id_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_tool_registry_tenant_connector_idx" ON "connector_tool_registry" USING btree ("tenant_connector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connectors_name_idx" ON "connectors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "tenant_connectors_company_idx" ON "tenant_connectors" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "tenant_connectors_connector_idx" ON "tenant_connectors" USING btree ("connector_id");--> statement-breakpoint
ALTER TABLE "document_annotation_comments" ADD CONSTRAINT "document_annotation_comments_issue_comment_id_issue_comments_id_fk" FOREIGN KEY ("issue_comment_id") REFERENCES "public"."issue_comments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_agent_id_agents_id_fk" FOREIGN KEY ("deleted_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comments" ADD CONSTRAINT "issue_comments_deleted_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("deleted_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_annotation_comments_issue_comment_idx" ON "document_annotation_comments" USING btree ("issue_comment_id");