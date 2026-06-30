import { createHash } from "node:crypto";
import { authUsers, instanceUserRoles, boardApiKeys } from "@paperclipai/db/schema";
import { eq, and } from "drizzle-orm";

export async function autoSeed(dependencies: {
  db: any;
}) {
  const { db } = dependencies;

  const LOCAL_BOARD_USER_ID = "local-board";

  const existingUser = await db
    .select({ id: authUsers.id })
    .from(authUsers)
    .where(eq(authUsers.id, LOCAL_BOARD_USER_ID))
    .then((rows: any[]) => rows[0] ?? null);
  if (!existingUser) {
    await db.insert(authUsers).values({
      id: LOCAL_BOARD_USER_ID,
      name: "Board",
      email: "local@paperclip.local",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const existingRole = await db
    .select({ id: instanceUserRoles.id })
    .from(instanceUserRoles)
    .where(and(eq(instanceUserRoles.userId, LOCAL_BOARD_USER_ID), eq(instanceUserRoles.role, "instance_admin")))
    .then((rows: any[]) => rows[0] ?? null);
  if (!existingRole) {
    await db.insert(instanceUserRoles).values({ userId: LOCAL_BOARD_USER_ID, role: "instance_admin" });
  }

  const boardApiKeyToken = process.env.PAPERCLIP_BOARD_API_KEY?.trim();
  if (boardApiKeyToken) {
    const keyHash = createHash("sha256").update(boardApiKeyToken).digest("hex");
    const existingKey = await db
      .select({ id: boardApiKeys.id })
      .from(boardApiKeys)
      .where(eq(boardApiKeys.keyHash, keyHash))
      .then((rows: any[]) => rows[0] ?? null);
    if (!existingKey) {
      await db.insert(boardApiKeys).values({
        userId: LOCAL_BOARD_USER_ID,
        name: "Management Server",
        keyHash,
        expiresAt: null,
      });
    }
  }
}