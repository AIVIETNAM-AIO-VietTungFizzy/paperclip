import { Router } from "express";
import zlib from "node:zlib";
import type { Db } from "@paperclipai/db";
import { companySkillService } from "../services/company-skills.js";
import { assertAuthenticated } from "./authz.js";

const RC_FETCH_TIMEOUT = 30_000;

export function skillInstallerRoutes(db: Db) {
  const router = Router();
  const svc = companySkillService(db);

  async function downloadFromRc(downloadUrl: string, downloadToken: string) {
    const url = new URL(downloadUrl);
    url.searchParams.set("token", downloadToken);
    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(RC_FETCH_TIMEOUT) });
    if (!resp.ok) throw new Error(`RC download failed: ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    return JSON.parse(zlib.gunzipSync(buf).toString("utf-8"));
  }

  async function callbackRc(callbackUrl: string, callbackToken: string | undefined, body: Record<string, unknown>) {
    const url = new URL(callbackUrl);
    if (callbackToken) url.searchParams.set("token", callbackToken);
    try {
      await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {}
  }

  async function findExistingSkill(companyId: string, slug: string) {
    const skills = await svc.list(companyId);
    return skills.find((s: { slug: string }) => s.slug === slug);
  }

  router.post("/skill-installer/install", async (req, res) => {
    try {
      assertAuthenticated(req);
      const { skillId, slug, companyId, companyName, downloadUrl, downloadToken, callbackUrl } = req.body;
      if (!slug || !companyId || !downloadUrl || !downloadToken || !callbackUrl) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      res.json({ accepted: true, message: "Installation started" });

      try {
        const pkg = await downloadFromRc(downloadUrl, downloadToken);

        const existing = await findExistingSkill(companyId, slug);
        let skill;
        if (existing) {
          skill = existing;
          if (pkg.files && typeof pkg.files === "object") {
            for (const [filePath, content] of Object.entries(pkg.files)) {
              try {
                await svc.updateFile(companyId, existing.id, filePath, content as string);
              } catch {}
            }
          }
        } else {
          skill = await svc.createLocalSkill(companyId, {
            name: pkg.name || slug,
            slug,
            description: pkg.description || "",
            markdown: pkg.markdown || "",
          });
          if (pkg.files && typeof pkg.files === "object") {
            for (const [filePath, content] of Object.entries(pkg.files)) {
              if (filePath !== "SKILL.md") {
                try {
                  await svc.updateFile(companyId, skill.id, filePath, content as string);
                } catch {}
              }
            }
          }
        }

        await callbackRc(callbackUrl, downloadToken, {
          agentId: "paperclip",
          status: "installed",
          skillId: skill.id,
          companyId,
          companyName: companyName || companyId,
          content_hash: pkg.content_hash || null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await callbackRc(callbackUrl, downloadToken, {
          agentId: "paperclip",
          status: "failed",
          error: msg,
        }).catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post("/skill-installer/uninstall", async (req, res) => {
    try {
      assertAuthenticated(req);
      const { slug, companyId, callbackUrl, callbackToken } = req.body;
      if (!slug || !companyId || !callbackUrl) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      res.json({ accepted: true, message: "Uninstall started" });

      try {
        const existing = await findExistingSkill(companyId, slug);
        if (existing) {
          await svc.deleteSkill(companyId, existing.id);
        }

        await callbackRc(callbackUrl, callbackToken, {
          agentId: "paperclip",
          status: "uninstalled",
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await callbackRc(callbackUrl, callbackToken, {
          agentId: "paperclip",
          status: "failed",
          error: msg,
        }).catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post("/skill-installer/update", async (req, res) => {
    try {
      assertAuthenticated(req);
      const { slug, companyId, downloadUrl, downloadToken, callbackUrl } = req.body;
      if (!slug || !companyId || !downloadUrl || !downloadToken || !callbackUrl) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      res.json({ accepted: true, message: "Update started" });

      try {
        const pkg = await downloadFromRc(downloadUrl, downloadToken);

        const existing = await findExistingSkill(companyId, slug);
        if (existing) {
          if (pkg.files && typeof pkg.files === "object") {
            for (const [filePath, content] of Object.entries(pkg.files)) {
              try {
                await svc.updateFile(companyId, existing.id, filePath, content as string);
              } catch {}
            }
          }
        }

        await callbackRc(callbackUrl, downloadToken, {
          agentId: "paperclip",
          status: "installed",
          content_hash: pkg.content_hash || null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        await callbackRc(callbackUrl, downloadToken, {
          agentId: "paperclip",
          status: "failed",
          error: msg,
        }).catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
