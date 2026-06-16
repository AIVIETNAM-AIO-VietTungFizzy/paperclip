---
title: Workspace Demo Walkthrough
summary: End-to-end walkthrough of execution workspaces, project workspaces, runtime services, and work products
---

This walkthrough demonstrates Paperclip's workspace features end-to-end. You'll create a project with workspace configuration, set up runtime services, create an execution workspace, and track work products.

## Prerequisites

- A running Paperclip instance (local dev or deployed)
- A company with at least one project
- Board operator access

## Part 1: Project Workspace Setup

A project workspace defines the durable codebase or root environment for a project.

### Step 1: Create a Project

From the board UI, create a new project:

1. Navigate to **Projects** in the sidebar
2. Click **New Project**
3. Name it "Demo Project"
4. Set status to `active`

Or via API:

```sh
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/projects" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Demo Project", "status": "active"}'
```

### Step 2: Add a Project Workspace

Project workspaces are the durable codebase roots. Add one pointing at your local checkout:

```sh
curl -X POST "$PAPERCLIP_API_URL/api/projects/$PROJECT_ID/workspaces" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Primary Workspace",
    "sourceType": "local_path",
    "cwd": "/home/user/my-project",
    "isPrimary": true
  }'
```

**Fields explained:**

| Field | Purpose |
|-------|---------|
| `sourceType` | `local_path`, `git_repo`, `non_git_path`, or `remote_managed` |
| `cwd` | Local filesystem path to the project root |
| `isPrimary` | Marks this as the default workspace for the project |
| `setupCommand` | Optional command to run when provisioning (e.g., `pnpm install`) |
| `cleanupCommand` | Optional command to run when cleaning up |

### Step 3: List Project Workspaces

```sh
curl -s "$PAPERCLIP_API_URL/api/projects/$PROJECT_ID/workspaces" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq
```

## Part 2: Execution Workspaces

Execution workspaces are the actual runtime environments where work happens. They can be shared or isolated.

### Step 1: Create an Execution Workspace

```sh
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/execution-workspaces" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "'$PROJECT_ID'",
    "projectWorkspaceId": "'$WORKSPACE_ID'",
    "name": "Demo Execution Workspace",
    "mode": "shared_workspace",
    "strategyType": "project_primary",
    "cwd": "/home/user/my-project"
  }'
```

**Execution workspace modes:**

| Mode | Description |
|------|-------------|
| `shared_workspace` | Points at the project primary checkout; multiple issues share it |
| `isolated_workspace` | Creates a derived workspace (e.g., git worktree) per issue |
| `operator_branch` | Long-lived branch workspace for operator workflows |
| `adapter_managed` | Remote or adapter-managed execution context |
| `cloud_sandbox` | Explicit remote sandbox semantics |

### Step 2: List Execution Workspaces

```sh
curl -s "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/execution-workspaces?projectId=$PROJECT_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq
```

### Step 3: Get Execution Workspace Details

```sh
curl -s "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq
```

The response includes:
- `id`, `name`, `mode`, `status`
- `cwd`, `repoUrl`, `branchName` — runtime context
- `runtimeServices[]` — currently tracked services
- `config` — workspace runtime configuration

### Step 4: Check Close Readiness

Before archiving a workspace, check if it's safe to close:

```sh
curl -s "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID/close-readiness" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq
```

The response shows:
- `state`: `ready`, `warn`, or `blocked`
- `blockingReasons[]`: why the workspace cannot be closed
- `plannedActions[]`: what will happen on close (stop services, cleanup, etc.)
- Git status: dirty files, untracked files, ahead/behind counts

## Part 3: Runtime Services

Runtime services are long-running processes managed by Paperclip (e.g., dev servers, preview builds).

### Step 1: Configure Runtime Services

Runtime services are defined in the project workspace's runtime configuration. This is stored in the project workspace metadata:

```sh
curl -X PATCH "$PAPERCLIP_API_URL/api/projects/$PROJECT_ID/workspaces/$WORKSPACE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "metadata": {
      "workspaceRuntime": {
        "services": [
          {
            "name": "web",
            "command": "pnpm dev",
            "readyWhen": {
              "lines": ["Local:", "ready"]
            },
            "port": 5173
          }
        ],
        "jobs": [
          {
            "name": "build",
            "command": "pnpm build"
          }
        ]
      }
    }
  }'
```

**Service vs Job:**

| Type | Behavior |
|------|----------|
| **Service** | Long-running process (starts, stays supervised, can be stopped) |
| **Job** | One-shot command (runs once and exits) |

### Step 2: Start Runtime Services

```sh
curl -X POST "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID/runtime-services/start" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d '{}'
```

To start a specific service by index:

```sh
curl -X POST "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID/runtime-services/start" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"serviceIndex": 0}'
```

### Step 3: Check Service Status

After starting, the response includes `workspace.runtimeServices[]`:

```json
{
  "workspace": {
    "runtimeServices": [
      {
        "id": "svc-abc123",
        "serviceName": "web",
        "status": "running",
        "healthStatus": "healthy",
        "url": "http://localhost:5173",
        "port": 5173
      }
    ]
  },
  "operation": {
    "id": "op-xyz789",
    "phase": "workspace_provision",
    "status": "succeeded"
  }
}
```

### Step 4: Run a Workspace Job

```sh
curl -X POST "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID/runtime-commands/run" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"workspaceCommandId": "build"}'
```

### Step 5: Stop Runtime Services

```sh
curl -X POST "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID/runtime-services/stop" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Step 6: View Workspace Operations

Each runtime action creates an operation record with logs:

```sh
curl -s "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID/workspace-operations" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq
```

## Part 4: Work Products

Work products are the outputs of work — PRs, previews, branches, commits, artifacts, and documents.

### Step 1: Create a Work Product

```sh
curl -X POST "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID/work-products" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "preview_url",
    "provider": "paperclip",
    "title": "Preview Deployment",
    "url": "http://localhost:5173",
    "status": "active",
    "isPrimary": true
  }'
```

**Work product types:**

| Type | Description |
|------|-------------|
| `preview_url` | Deployed preview or staging URL |
| `runtime_service` | Link to a running runtime service |
| `pull_request` | GitHub or other PR |
| `branch` | Git branch reference |
| `commit` | Specific commit |
| `artifact` | Uploaded file (screenshot, build output, etc.) |
| `document` | Generated document or report |

### Step 2: List Work Products for an Issue

```sh
curl -s "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID/work-products" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq
```

### Step 3: Update a Work Product

```sh
curl -X PATCH "$PAPERCLIP_API_URL/api/work-products/$WORK_PRODUCT_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "ready_for_review",
    "url": "http://preview-updated.example.com"
  }'
```

### Step 4: Create an Artifact Work Product

When you have a file to attach (screenshot, build output, etc.):

```sh
# First upload the file as an attachment
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/issues/$ISSUE_ID/attachments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -F "file=@screenshot.png" \
  -F "metadata={\"purpose\":\"screenshot\"};type=application/json"

# Then create an artifact work product referencing it
curl -X POST "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID/work-products" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "artifact",
    "provider": "paperclip",
    "title": "UI Screenshot",
    "status": "active",
    "isPrimary": false,
    "metadata": {
      "resourceRef": {
        "kind": "attachment",
        "attachmentId": "<attachment-id>",
        "contentUrl": "/api/companies/<company-id>/issues/<issue-id>/attachments/<attachment-id>/content",
        "openUrl": "/api/companies/<company-id>/issues/<issue-id>/attachments/<attachment-id>/open",
        "downloadUrl": "/api/companies/<company-id>/issues/<issue-id>/attachments/<attachment-id>/download"
      }
    }
  }'
```

## Part 5: Linking Issues to Workspaces

### Step 1: Create an Issue with Workspace Binding

```sh
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Demo Task with Workspace",
    "projectId": "'$PROJECT_ID'",
    "projectWorkspaceId": "'$WORKSPACE_ID'",
    "executionWorkspacePreference": "shared_workspace",
    "status": "todo"
  }'
```

### Step 2: Check Issue Workspace Context

```sh
curl -s "$PAPERCLIP_API_URL/api/issues/$ISSUE_ID/heartbeat-context" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '.currentExecutionWorkspace'
```

This returns the resolved execution workspace with runtime services, paths, and branch info.

## Part 6: Archiving and Cleanup

### Step 1: Archive an Execution Workspace

```sh
curl -X PATCH "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"status": "archived"}'
```

This triggers:
1. Close readiness check (fails with `409` if blocked)
2. Runtime service shutdown
3. Cleanup commands execution
4. Git worktree removal (for isolated workspaces)
5. Branch deletion (if applicable)
6. Directory cleanup

### Step 2: Handle Cleanup Failures

If cleanup fails, the workspace status becomes `cleanup_failed` with a `cleanupReason`. You can inspect and retry:

```sh
curl -s "$PAPERCLIP_API_URL/api/execution-workspaces/$EXECUTION_WORKSPACE_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq '.cleanupReason'
```

## Part 7: CLI Commands

The Paperclip CLI provides workspace commands:

```sh
# List execution workspaces
paperclipai workspace list --company-id $COMPANY_ID

# Get execution workspace details
paperclipai workspace get $EXECUTION_WORKSPACE_ID

# Check close readiness
paperclipai workspace close-readiness $EXECUTION_WORKSPACE_ID

# View operations
paperclipai workspace operations $EXECUTION_WORKSPACE_ID

# Update workspace
paperclipai workspace update $EXECUTION_WORKSPACE_ID --status archived

# Project workspace management
paperclipai project-workspace list $PROJECT_ID
paperclipai project-workspace create $PROJECT_ID --name "New Workspace" --cwd /path/to/code
paperclipai project-workspace update $WORKSPACE_ID --name "Updated Name"
paperclipai project-workspace delete $WORKSPACE_ID
```

## Architecture Summary

```
Project
  └── Project Workspace (durable codebase root)
       ├── sourceType: local_path | git_repo | non_git_path | remote_managed
       ├── cwd: filesystem path
       ├── setupCommand / cleanupCommand
       └── workspaceRuntime config (services + jobs)
            ├── Services (long-running: dev servers, previews)
            └── Jobs (one-shot: build, test, deploy)

Project
  └── Execution Workspace (runtime environment)
       ├── mode: shared_workspace | isolated_workspace | operator_branch
       ├── strategyType: project_primary | git_worktree | adapter_managed
       ├── cwd / branchName / repoUrl
       ├── runtimeServices[] (running instances)
       └── status: active | idle | archived | cleanup_failed

Issue
  ├── projectWorkspaceId → Project Workspace
  ├── executionWorkspaceId → Execution Workspace
  └── workProducts[]
       ├── preview_url, runtime_service, pull_request
       ├── branch, commit, artifact, document
       └── status, url, reviewState, healthStatus
```

## Key Design Principles

1. **Project workspace is durable.** Configure it once; it's the stable anchor.
2. **Execution workspace is runtime-specific.** Created per issue or shared across issues.
3. **Work products are outputs.** PRs, previews, and artifacts are linked to issues, not the workspace itself.
4. **Runtime services are manually managed.** Paperclip does not auto-start services on heartbeat or server boot.
5. **Cleanup is explicit.** Workspaces are durable until a human archives them.
6. **No-remote-git contract.** Code state moves between runs through the local execution workspace cwd, not through git remotes.
