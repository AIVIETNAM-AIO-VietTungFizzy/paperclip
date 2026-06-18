import { createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://paperclip:paperclip@127.0.0.1:43565/paperclip";
const db = createDb(DATABASE_URL);

async function deleteIssue(id: string): Promise<void> {
  const issueIdTables = [
    "issue_thread_interactions", "issue_work_products",
    "issue_tree_hold_members", "issue_inbox_archives",
    "issue_read_states", "issue_labels", "issue_approvals",
    "issue_execution_decisions", "issue_comments"
  ];
  for (const table of issueIdTables) {
    await db.execute(sql.raw(`DELETE FROM "${table}" WHERE issue_id = '${id}'`));
  }

  await db.execute(sql.raw(`DELETE FROM issue_plan_decompositions WHERE source_issue_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM issue_recovery_actions WHERE source_issue_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM issue_reference_mentions WHERE source_issue_id = '${id}' OR target_issue_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM issue_relations WHERE issue_id = '${id}' OR related_issue_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM issue_tree_holds WHERE root_issue_id = '${id}'`));
  await db.execute(sql.raw(`DELETE FROM activity_log WHERE entity_id = '${id}'`));

  const docRows = await db.execute(sql.raw(`SELECT document_id FROM issue_documents WHERE issue_id = '${id}'`));
  const docList = docRows as unknown as { document_id: string }[];
  const docIds = docList.map(r => r.document_id);
  if (docIds.length > 0) {
    await db.execute(sql.raw(`DELETE FROM issue_documents WHERE issue_id = '${id}'`));
    for (const docId of docIds) {
      await db.execute(sql.raw(`DELETE FROM document_revisions WHERE document_id = '${docId}'`));
    }
    const docIdList = docIds.map(d => `'${d}'`).join(",");
    await db.execute(sql.raw(`DELETE FROM documents WHERE id IN (${docIdList})`));
  }

  const attachRows = await db.execute(sql.raw(`SELECT id, asset_id FROM issue_attachments WHERE issue_id = '${id}'`));
  const attachList = attachRows as unknown as { id: string; asset_id: string }[];
  const assetIds = attachList.map(r => r.asset_id);
  if (assetIds.length > 0) {
    await db.execute(sql.raw(`DELETE FROM issue_attachments WHERE issue_id = '${id}'`));
    const assetIdList = assetIds.map(a => `'${a}'`).join(",");
    await db.execute(sql.raw(`DELETE FROM assets WHERE id IN (${assetIdList})`));
  }

  await db.execute(sql.raw(`DELETE FROM issues WHERE id = '${id}'`));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const staleRows = await db.execute(
    sql.raw(`SELECT id, identifier, title, parent_id FROM issues WHERE created_at < NOW() - INTERVAL '2 days' ORDER BY created_at`)
  );
  const staleIssues = staleRows as unknown as { id: string; identifier: string; title: string; parent_id: string | null }[];

  if (staleIssues.length === 0) {
    console.log("No stale issues found (older than 2 days).");
    process.exit(0);
  }

  console.log(`Found ${staleIssues.length} stale issues:\n`);
  for (const issue of staleIssues) {
    const indent = issue.parent_id ? "  └ " : "";
    console.log(`  ${indent}${issue.identifier} - ${issue.title} (${issue.id})`);
  }

  const staleIds = new Set(staleIssues.map(i => i.id));
  const childRows = await db.execute(
    sql.raw(`SELECT id, identifier FROM issues WHERE parent_id = ANY('{${[...staleIds].join(",")}}')`)
  );
  const children = childRows as unknown as { id: string; identifier: string }[];
  const allIds = [...staleIds, ...children.map(c => c.id)];

  if (children.length > 0) {
    console.log(`\nIncluding ${children.length} child issues for cascade cleanup.`);
  }

  console.log(`\nTotal issues to delete: ${allIds.length}\n`);

  if (dryRun) {
    console.log("DRY RUN — no deletions performed. Pass --dry-run to preview.");
    process.exit(0);
  }

  const prompt = process.env.PAPERCLIP_DELETE_CONFIRM || "";
  if (prompt !== "yes") {
    console.log("Set PAPERCLIP_DELETE_CONFIRM=yes to proceed with deletion.");
    process.exit(1);
  }

  let deleted = 0;
  for (const id of allIds) {
    console.log(`  Deleting ${id}...`);
    await deleteIssue(id);
    deleted++;
  }

  console.log(`\nDone! Deleted ${deleted} issues.`);
}

main().catch(err => { console.error(err); process.exit(1); });