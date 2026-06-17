import { createDb, issues } from '@paperclipai/db';
import { eq } from 'drizzle-orm';

const db = createDb('postgres://paperclip:paperclip@localhost:5433/paperclip');

async function main() {
  const issue = await db.select().from(issues).where(eq(issues.identifier, 'TUN-27')).then(r => r[0] ?? null);
  console.log('TUN-27:', JSON.stringify(issue, null, 2));

  if (issue) {
    const children = await db.select().from(issues).where(eq(issues.parentId, issue.id));
    console.log('Children count:', children.length);
    console.log('Children:', JSON.stringify(children.map(c => ({ id: c.id, identifier: c.identifier, title: c.title, status: c.status })), null, 2));
  }
}

main().catch(console.error);
