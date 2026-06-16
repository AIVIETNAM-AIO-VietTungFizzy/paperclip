#!/usr/bin/env node

/**
 * Demo seed script — seeds demo-specific data for the WS6 end-to-end demo.
 *
 * Seeds:
 * 1. A demo Paperclip company skill (via Paperclip API)
 * 2. A demo policy matrix rule: "demo.high_risk_task" → paperclip_board
 * 3. A demo tenant_runtime_instance pointing at the current runtime
 *
 * Usage:
 *   CP_DATABASE_URL=postgres://... node scripts/demo-seed.js
 *
 * Optional:
 *   PAPERCLIP_API_URL=http://localhost:3100    — Paperclip API base URL (default: http://localhost:3100)
 *   PAPERCLIP_API_KEY=...                      — Paperclip API key for company skill creation
 *   PAPERCLIP_COMPANY_ID=...                   — Paperclip company ID (default: auto-detect)
 *   TENANT_ID=...                              — Control-plane tenant ID (default: Acme Corp UUID)
 */

import pg from "pg";
import crypto from "node:crypto";

const { Pool } = pg;

// ── Configuration ────────────────────────────────────────────────────────────

const CP_DATABASE_URL = process.env.CP_DATABASE_URL || process.env.DATABASE_URL;
const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
const PAPERCLIP_API_KEY = process.env.PAPERCLIP_API_KEY;
const PAPERCLIP_COMPANY_ID = process.env.PAPERCLIP_COMPANY_ID;
const TENANT_ID = process.env.TENANT_ID || "11111111-0000-0000-0000-000000000001";

// Fixed UUIDs for idempotent seeding
const DEMO_SKILL_ID = "dddddddd-1000-0000-0000-000000000001";
const DEMO_MATRIX_RULE_ID = "dddddddd-2000-0000-0000-000000000001";
const DEMO_RUNTIME_INSTANCE_ID = "dddddddd-3000-0000-0000-000000000001";

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(label, status, detail) {
  const icon = status === "insert" ? "+" : status === "skip" ? "·" : "!";
  console.log(`  ${icon} ${label.padEnd(30)} ${detail}`);
}

async function ensureCpPool() {
  if (!CP_DATABASE_URL) {
    throw new Error("CP_DATABASE_URL or DATABASE_URL must be set");
  }
  const pool = new Pool({ connectionString: CP_DATABASE_URL });
  // Verify connection
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
  return pool;
}

// ── 1. Demo Paperclip company skill ──────────────────────────────────────────

async function seedCompanySkill() {
  const companyId = PAPERCLIP_COMPANY_ID;
  if (!companyId) {
    log("company_skill", "skip", "PAPERCLIP_COMPANY_ID not set — skipping");
    return;
  }

  if (!PAPERCLIP_API_KEY) {
    log("company_skill", "skip", "PAPERCLIP_API_KEY not set — skipping");
    return;
  }

  // Check if skill already exists
  const checkUrl = `${PAPERCLIP_API_URL}/api/companies/${companyId}/skills`;
  const checkRes = await fetch(checkUrl, {
    headers: { Authorization: `Bearer ${PAPERCLIP_API_KEY}` },
  });

  if (!checkRes.ok) {
    log("company_skill", "skip", `Paperclip API unreachable (${checkRes.status}) — skipping`);
    return;
  }

  const existingSkills = await checkRes.json();
  const alreadyExists = Array.isArray(existingSkills)
    && existingSkills.some((s) => s.key === "demo.high_risk_task");

  if (alreadyExists) {
    log("company_skill", "skip", "demo.high_risk_task already exists");
    return;
  }

  // Create the skill via Paperclip API
  const createRes = await fetch(`${PAPERCLIP_API_URL}/api/companies/${companyId}/skills`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAPERCLIP_API_KEY}`,
    },
    body: JSON.stringify({
      key: "demo.high_risk_task",
      name: "Demo High-Risk Task",
      description: "A demo skill that requires board approval for high-risk operations",
      markdown: [
        "# Demo High-Risk Task Skill",
        "",
        "This skill demonstrates the Paperclip board approval flow.",
        "When an agent attempts a high-risk task, the policy matrix routes",
        "the approval request to the Paperclip board for human review.",
        "",
        "## Capabilities",
        "",
        "- Triggers board approval for high-risk operations",
        "- Demonstrates the A3 → paperclip_board policy routing",
        "- Works with the demo policy matrix rule",
      ].join("\n"),
      sourceType: "inline",
      trustLevel: "markdown_only",
      compatibility: "compatible",
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Failed to create company skill: ${createRes.status} ${body}`);
  }

  log("company_skill", "insert", `demo.high_risk_task in company ${companyId}`);
}

// ── 2. Demo policy matrix rule ───────────────────────────────────────────────

async function seedPolicyMatrix(pool) {
  const existing = await pool.query(
    `SELECT rule_id FROM policy_matrix WHERE rule_id = $1`,
    [DEMO_MATRIX_RULE_ID],
  );

  if (existing.rows.length > 0) {
    log("policy_matrix", "skip", "demo.high_risk_task → paperclip_board already exists");
    return;
  }

  await pool.query(
    `INSERT INTO policy_matrix (rule_id, tool_key, risk_class, responder_surface, params, priority, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (COALESCE(package,'*'), COALESCE(tool_key,'*'), COALESCE(risk_class,'*'), COALESCE(approval_class,'*'))
     DO NOTHING`,
    [
      DEMO_MATRIX_RULE_ID,
      "demo.high_risk_task",
      "high",
      "paperclip_board",
      JSON.stringify({ paperclip_approval_type: "request_board_approval" }),
      5,
      "Demo: high-risk tasks route to Paperclip board approval",
    ],
  );

  log("policy_matrix", "insert", "demo.high_risk_task (high risk) → paperclip_board");
}

// ── 3. Demo tenant_runtime_instance ──────────────────────────────────────────

async function seedTenantRuntimeInstance(pool) {
  const existing = await pool.query(
    `SELECT tenant_id FROM tenant_runtime_instances WHERE tenant_id = $1`,
    [TENANT_ID],
  );

  if (existing.rows.length > 0) {
    log("tenant_runtime_instance", "skip", `tenant ${TENANT_ID} already has a runtime instance`);
    return;
  }

  const managementServerUrl = process.env.MANAGEMENT_SERVER_URL
    || process.env.BASE_URL
    || "http://localhost:3004";

  await pool.query(
    `INSERT INTO tenant_runtime_instances (tenant_id, container_name, status, management_server_url)
     VALUES ($1, $2, $3, $4)`,
    [
      TENANT_ID,
      `demo-${TENANT_ID.slice(0, 8)}`,
      "running",
      managementServerUrl,
    ],
  );

  log("tenant_runtime_instance", "insert", `tenant ${TENANT_ID} → ${managementServerUrl}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\nSeeding demo data…\n");

  let pool;
  try {
    // 1. Seed Paperclip company skill (via API)
    await seedCompanySkill();

    // 2. Seed control-plane data (via direct DB)
    pool = await ensureCpPool();

    await seedPolicyMatrix(pool);
    await seedTenantRuntimeInstance(pool);

    console.log("\nDemo seed complete.\n");
  } catch (err) {
    console.error("\nDemo seed failed:", err.message);
    process.exit(1);
  } finally {
    if (pool) await pool.end();
  }
}

main();
