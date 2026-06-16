# WS6 Demo Glue Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a repeatable end-to-end demo walkthrough proving the 5 vision pillars (file management, policy & package, skill management, agent management, MCP standard).

**Architecture:** Three deliverables: (1) a demo seed script that populates control-plane + Paperclip with demo-specific data, (2) a step-by-step walkthrough document any dev can follow, (3) an automated e2e smoke test (stretch). No production code changes.

**Tech Stack:** Node.js (seed script), Markdown (walkthrough), Vitest + supertest (smoke test)

---

### Task 1: Demo Seed Script

**Files:**
- Create: `runtime-core/management-server/scripts/demo-seed.js`
- Modify: `runtime-core/management-server/.env.example`

The script already exists in the `tun-13-demo-seed` worktree at `.worktrees/tun-13-demo-seed/runtime-core/management-server/scripts/demo-seed.js`. Copy it into the main branch.

- [ ] **Step 1: Copy demo-seed.js from worktree to main branch**

```bash
cp /home/achau/workspace/paperclip/.worktrees/tun-13-demo-seed/runtime-core/management-server/scripts/demo-seed.js \
   /home/achau/workspace/paperclip/runtime-core/management-server/scripts/demo-seed.js
```

- [ ] **Step 2: Update .env.example with demo-seed env vars**

Add to `runtime-core/management-server/.env.example`:
```
# Demo seed (WS6)
# CP_DATABASE_URL=postgres://...
# PAPERCLIP_API_URL=http://localhost:3100
# PAPERCLIP_API_KEY=...
# PAPERCLIP_COMPANY_ID=...
# TENANT_ID=11111111-0000-0000-0000-000000000001
# MANAGEMENT_SERVER_URL=http://localhost:3004
```

- [ ] **Step 3: Verify the script parses correctly**

Run: `node -c /home/achau/workspace/paperclip/runtime-core/management-server/scripts/demo-seed.js`
Expected: no syntax errors

---

### Task 2: Demo Walkthrough Document

**Files:**
- Create: `specs/2026-06-15-demo-walkthrough.md`

Based on the spec at `AIautomation/specs/2026-06-15-ws6-demo-e2e-spec.md`, expand the step-by-step into a full runbook.

- [ ] **Step 1: Create the walkthrough document**

Write `specs/2026-06-15-demo-walkthrough.md` with:
- Pre-conditions (services running, seeded DB, env vars)
- Step 1: Verify tool registry is seeded
- Step 2: Verify Bob's plugin config
- Step 3: Bob tries `exec` (L1 → deny)
- Step 4: Bob tries `gateway` (A3 → board approval)
- Step 5: Shared workspace — personal vs company files
- Step 6: Standard MCP connection (requires WS1)
- Step 7: Skill management via Tenant Admin UI
- Troubleshooting section
- Verification checklist

---

### Task 3: CI Smoke Test (Stretch)

**Files:**
- Create: `runtime-core/management-server/tests/e2e/policy-loop.test.js`

Automated version of steps 3–5 from the spec using Vitest + supertest against the management-server with a mock CP.

- [ ] **Step 1: Create the e2e test directory and test file**

```bash
mkdir -p /home/achau/workspace/paperclip/runtime-core/management-server/tests/e2e
```

- [ ] **Step 2: Write the smoke test**

Test file at `runtime-core/management-server/tests/e2e/policy-loop.test.js`:
- Test: Bob's `exec` call → deny from enforce
- Test: Bob's `gateway` call → board approval submitted
- Test: Alice approves → resume callback → action completes
- Test: Personal vs shared file isolation

---

### Verification

- [ ] Run `node -c runtime-core/management-server/scripts/demo-seed.js` — no syntax errors
- [ ] Walkthrough document reads correctly as a step-by-step runbook
- [ ] Smoke test passes (if stretch task completed)
