# WS6 End-to-End Demo Walkthrough

> **Date:** 2026-06-15
> **Status:** Ready
> **Depends on:** WS4 (required), WS1 (optional for MCP step)

---

## Pre-conditions

Before starting, ensure:

1. **WS4 complete** — `CONTROL_PLANE_URL` and `CONTROL_PLANE_SERVICE_TOKEN` set in agent-server env
2. **CP database seeded** — `cd control-plane && pnpm db:seed`
3. **Demo data seeded** — `cd runtime-core/management-server && node scripts/demo-seed.js`
4. **At least one OpenClaw agent container** running for Bob (tenant Acme, user Bob)
5. **Paperclip running** for Acme tenant (for board approval surface)
6. **WS1 complete** (optional, needed only for MCP inspector step)

### Environment Variables

```bash
export CP_TOKEN="<control-plane-service-token>"
export CP_URL="http://localhost:3001"
export PAPERCLIP_API_URL="http://localhost:3100"
export PAPERCLIP_API_KEY="<paperclip-api-key>"
export TENANT_ID="11111111-0000-0000-0000-000000000001"
export ALICE_USER_ID="<alice-user-uuid>"
export BOB_USER_ID="<bob-user-uuid>"
```

---

## Step 1: Verify Tool Registry Is Seeded

Check that the `exec` tool exists with the correct risk/approval configuration:

```bash
curl -s -H "Authorization: Bearer $CP_TOKEN" \
  "$CP_URL/api/admin/tool-registry" | python3 -m json.tool | grep -A 10 '"exec"'
```

**Expected output:**
```json
{
  "name": "exec",
  "risk_class": "high",
  "approval_class": "A2",
  "allowed_packages": ["L3"]
}
```

**Troubleshooting:**
- If empty: run `cd control-plane && pnpm db:seed` to re-seed
- If 401: check `CP_TOKEN` is correct

---

## Step 2: Verify Bob's Plugin Config

Check that Bob's OpenClaw plugin has the `paperclip-contract` populated:

```bash
# Find Bob's data directory
ls /opt/ocmt/data/$TENANT_ID/
# Look for Bob's user directory (usually the second UUID)

cat /opt/ocmt/data/$TENANT_ID/<bob-user-id>/openclaw.json | \
  python3 -m json.tool | grep -A 20 '"paperclip-contract"'
```

**Expected fields:**
- `policyGuardUrl` — points to CP enforce endpoint
- `tenantId` — matches `$TENANT_ID`
- `employeeId` — Bob's user UUID
- `companyId` — Acme Corp company UUID

**Troubleshooting:**
- If file doesn't exist: Bob's agent hasn't started yet. Start it via Tenant Admin UI.
- If `companyId` missing: WS4 not complete — check `CONTROL_PLANE_URL` env var

---

## Step 3: Bob Tries `exec` (L1 Package → Deny)

In Bob's OpenClaw agent session, trigger an exec call:

```
run the command: echo hello world
```

**Expected result:**
- Enforce returns `deny: package_not_allowed_for_tool`
- Agent displays: "This action is not permitted for your current package."

**Why:** The `exec` tool requires package L3. Bob is assigned package L1 (Assist). The policy matrix denies the action.

**Troubleshooting:**
- If the action succeeds: check Bob's package assignment in CP admin
- If agent crashes: check CP logs for `[POST /api/core/enforce]` entries

---

## Step 4: Bob Tries `gateway` (A3 → Board Approval)

The `gateway` tool has `approval_class: A3` and maps to `paperclip_board` in the policy matrix.

In Bob's agent session, trigger a gateway operation:

```
use the gateway tool to check status
```

**Expected flow:**

1. Enforce returns `require_approval` + `responder_surface: paperclip_board`
2. Plugin submits approval request to Paperclip board
3. Agent displays: "Submitted to Paperclip board. Will run once approved."
4. Alice logs into Paperclip and sees a pending approval in the board UI
5. Alice approves the request
6. Paperclip POSTs to `/api/core/approvals/resume` with `{ trace_id, decision: "approved" }`
7. Bob's agent retries (reusing session_id) → enforce replays `allow`
8. Gateway operation runs

**Verify step 6 — check CP logs:**

```bash
# Check CP logs for the resume callback
curl -s -H "Authorization: Bearer $CP_TOKEN" \
  "$CP_URL/api/admin/logs?query=approvals/resume" | python3 -m json.tool
```

**Expected log entry:**
```
[POST /api/core/approvals/resume] trace_id=... decision=approved
```

**Troubleshooting:**
- If Paperclip doesn't show pending approval: check `companyId` in plugin config
- If resume callback fails: check CP service token matches between Paperclip and CP
- If agent doesn't retry: check session_id is being reused

---

## Step 5: Shared Workspace — Personal vs Company Files

### 5a: Bob writes files

In Bob's agent session:

```
Write a file called "my-notes.txt" with content "private" to my personal workspace.
Write a file called "team-update.txt" with content "public" to the shared workspace.
```

### 5b: Verify file isolation

```bash
# Personal — only Bob's container
ls /opt/ocmt/data/$TENANT_ID/<bob-user-id>/workspace/
# Should show: my-notes.txt

# Shared — visible to all containers in tenant
ls /opt/ocmt/data/$TENANT_ID/shared-workspace/
# Should show: team-update.txt
```

### 5c: Alice checks shared workspace

In Alice's agent session:

```
List files in the shared workspace.
```

**Expected:** Alice sees `team-update.txt` but NOT `my-notes.txt`.

**Troubleshooting:**
- If personal files appear in shared: check workspace path configuration
- If Alice can't see shared files: check Alice is in the same tenant

---

## Step 6: Standard MCP Connection (Requires WS1)

```bash
npx @modelcontextprotocol/inspector http://localhost:3000/api/runtime/mcp-sdk \
  --header "Authorization: Bearer <bob-gateway-token>" \
  --header "X-User-Id: $BOB_USER_ID"
```

**Expected:** Inspector lists 16 OCMT tools. Can call `ocmt_vault_status`.

**Troubleshooting:**
- If connection fails: ensure WS1 MCP endpoint is running
- If 401: check Bob's gateway token is valid
- If tools don't appear: check MCP SDK version compatibility

---

## Step 7: Skill Management

Via Tenant Admin UI at `/admin/skills`:

1. **Install a skill** from the catalog
2. **Enable it** for Bob's agent
3. **Restart** Bob's agent
4. In Bob's session, confirm the skill is available

**Expected:** Bob's agent can use the installed skill after restart.

**Troubleshooting:**
- If catalog is empty: check skill registry is seeded
- If enable doesn't persist: check API logs for errors
- If skill not available after restart: check agent startup logs

---

## Agent Management

Via Tenant Admin UI at `/admin/instances`:

1. **View running agents** — should see Bob's agent
2. **Stop Bob's agent** — confirm it stops
3. **Start Bob's agent** — confirm it starts and is healthy

**Troubleshooting:**
- If agent doesn't stop: check runtime service logs
- If agent doesn't start: check container/image availability

---

## Verification Checklist

- [ ] CP seed runs without errors: `pnpm db:seed`
- [ ] Demo seed runs without errors: `node scripts/demo-seed.js`
- [ ] Bob's `exec` call → deny from enforce (package not allowed)
- [ ] Bob's `gateway` call → board approval submitted to Paperclip
- [ ] Alice approves in Paperclip → resume callback hits CP → agent action completes
- [ ] Personal file visible only in Bob's container
- [ ] Shared file visible in all tenant containers
- [ ] MCP inspector connects to `/api/runtime/mcp-sdk` and lists 16 tools (requires WS1)
- [ ] Tenant Admin can install/enable a skill from `/admin/skills`
- [ ] Tenant Admin can start/stop an agent from `/admin/instances`

---

## Service Start Commands

```bash
# Terminal 1: Control Plane
cd control-plane && pnpm dev

# Terminal 2: Paperclip
cd server && pnpm dev

# Terminal 3: Management Server
cd runtime-core/management-server && pnpm dev

# Terminal 4: OpenClaw agent (Bob)
# (container-specific start command)
```

---

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| 401 on CP API | Wrong/missing `CP_TOKEN` | Check env vars |
| `companyId` missing in plugin | WS4 not complete | Set `CONTROL_PLANE_URL` |
| Board approval not showing | Wrong `companyId` in plugin config | Re-check plugin config |
| MCP inspector fails | WS1 not deployed | Skip step 6 or complete WS1 |
| Demo seed fails | Missing `CP_DATABASE_URL` | Set env var |
| Agent not starting | Container/image issue | Check Docker logs |
