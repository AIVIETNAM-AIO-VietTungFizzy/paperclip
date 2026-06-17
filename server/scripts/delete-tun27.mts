import { createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL || "postgres://paperclip:paperclip@127.0.0.1:43565/paperclip";
const db = createDb(DATABASE_URL);

const TUN27_ID = "28074e89-f3a8-4e62-89c9-ee6ec6605e9e";

async function main() {
  const children = await db.execute(sql.raw(`SELECT id, identifier FROM issues WHERE parent_id = '${TUN27_ID}'`));
  const childRows = children as unknown as { id: string; identifier: string }[];
  const childIds = childRows.map(c => c.id);
  console.log(`Found ${childRows.length} children of TUN-27:`);
  childRows.forEach(c => console.log(`  ${c.identifier} (${c.id})`));

  const allIds = [TUN27_ID, ...childIds];
  console.log(`\nTotal issues to delete: ${allIds.length}`);

  for (const id of allIds) {
    console.log(`\nDeleting issue ${id}...`);

    // Tables with issue_id column
    const issueIdTables = [
      "issue_thread_interactions", "issue_work_products",
      "issue_tree_hold_members", "issue_inbox_archives",
      "issue_read_states", "issue_labels", "issue_approvals",
      "issue_execution_decisions", "issue_comments"
    ];
    for (const table of issueIdTables) {
      await db.execute(sql.raw(`DELETE FROM "${table}" WHERE issue_id = '${id}'`));
    }

    // Tables with source_issue_id
    await db.execute(sql.raw(`DELETE FROM issue_plan_decompositions WHERE source_issue_id = '${id}'`));
    await db.execute(sql.raw(`DELETE FROM issue_recovery_actions WHERE source_issue_id = '${id}'`));

    // Tables with source_issue_id OR target_issue_id
    await db.execute(sql.raw(`DELETE FROM issue_reference_mentions WHERE source_issue_id = '${id}' OR target_issue_id = '${id}'`));

    // Tables with issue_id OR related_issue_id
    await db.execute(sql.raw(`DELETE FROM issue_relations WHERE issue_id = '${id}' OR related_issue_id = '${id}'`));

    // Tree holds use root_issue_id
    await db.execute(sql.raw(`DELETE FROM issue_tree_holds WHERE root_issue_id = '${id}'`));

    // Activity log (entity_id is text)
    await db.execute(sql.raw(`DELETE FROM activity_log WHERE entity_id = '${id}'`));

    // Documents
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

    // Attachments
    const attachRows = await db.execute(sql.raw(`SELECT id, asset_id FROM issue_attachments WHERE issue_id = '${id}'`));
    const attachList = attachRows as unknown as { id: string; asset_id: string }[];
    const assetIds = attachList.map(r => r.asset_id);
    if (assetIds.length > 0) {
      await db.execute(sql.raw(`DELETE FROM issue_attachments WHERE issue_id = '${id}'`));
      const assetIdList = assetIds.map(a => `'${a}'`).join(",");
      await db.execute(sql.raw(`DELETE FROM assets WHERE id IN (${assetIdList})`));
    }

    // Finally delete the issue
    await db.execute(sql.raw(`DELETE FROM issues WHERE id = '${id}'`));
    console.log(`  Deleted successfully`);
  }

  console.log("\nAll done!");
}

main().catch(err => { console.error(err); process.exit(1); });
