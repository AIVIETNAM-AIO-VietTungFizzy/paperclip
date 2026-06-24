import {
  createDb,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type Db,
  type EmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestSupport,
} from "@paperclipai/db";

export {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestSupport,
};

export type TestDb = EmbeddedPostgresTestDatabase & { db: Db };

const ALL_TABLES = [
  "account",
  "activity_log",
  "agent_api_keys",
  "agent_config_revisions",
  "agent_memberships",
  "agent_runtime_state",
  "agent_task_sessions",
  "agent_wakeup_requests",
  "agents",
  "approval_comments",
  "approvals",
  "assets",
  "board_api_keys",
  "budget_incidents",
  "budget_policies",
  "cli_auth_challenges",
  "cloud_upstream_connections",
  "cloud_upstream_runs",
  "companies",
  "company_logos",
  "company_memberships",
  "company_secret_bindings",
  "company_secret_provider_configs",
  "company_secret_versions",
  "company_secrets",
  "company_skills",
  "company_user_sidebar_preferences",
  "connector_tool_registry",
  "connectors",
  "cost_events",
  "document_annotation_anchor_snapshots",
  "document_annotation_comments",
  "document_annotation_threads",
  "document_revisions",
  "documents",
  "environment_leases",
  "environments",
  "execution_workspaces",
  "feedback_exports",
  "feedback_votes",
  "finance_events",
  "goals",
  "heartbeat_run_events",
  "heartbeat_run_watchdog_decisions",
  "heartbeat_runs",
  "inbox_dismissals",
  "instance_settings",
  "instance_user_roles",
  "invites",
  "issue_approvals",
  "issue_attachments",
  "issue_comments",
  "issue_documents",
  "issue_execution_decisions",
  "issue_inbox_archives",
  "issue_labels",
  "issue_plan_decompositions",
  "issue_read_states",
  "issue_recovery_actions",
  "issue_reference_mentions",
  "issue_relations",
  "issue_thread_interactions",
  "issue_tree_hold_members",
  "issue_tree_holds",
  "issue_work_products",
  "issues",
  "join_requests",
  "labels",
  "plugin_company_settings",
  "plugin_config",
  "plugin_database_namespaces",
  "plugin_entities",
  "plugin_job_runs",
  "plugin_jobs",
  "plugin_logs",
  "plugin_managed_resources",
  "plugin_migrations",
  "plugin_state",
  "plugin_webhook_deliveries",
  "plugins",
  "principal_permission_grants",
  "project_goals",
  "project_memberships",
  "project_workspaces",
  "projects",
  "routine_revisions",
  "routine_runs",
  "routine_triggers",
  "routines",
  "secret_access_events",
  "session",
  "tenant_connectors",
  "user",
  "user_sidebar_preferences",
  "verification",
  "workspace_operations",
  "workspace_runtime_services",
];

export async function startTestDb(prefix = "paperclip-test-"): Promise<TestDb> {
  const tempDb = await startEmbeddedPostgresTestDatabase(prefix);
  const db = createDb(tempDb.connectionString);
  return { ...tempDb, db };
}

export async function withTestDb<T>(
  prefix: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const testDb = await startTestDb(prefix);
  try {
    return await fn(testDb.db);
  } finally {
    await testDb.cleanup();
  }
}

export async function truncateAll(db: Db): Promise<void> {
  const list = ALL_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(`TRUNCATE ${list} RESTART IDENTITY CASCADE;`);
}