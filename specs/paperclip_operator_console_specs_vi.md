# SPEC v1 - Paperclip Company Operator Console

> Mục tiêu: tổng hợp specs UI cho **Company Operator / CEO / Manager user** trên Paperclip, theo hướng **dùng lại UI Paperclip hiện có**, chỉ ẩn/bỏ các phần không cần thiết.

---

## 1. Product boundary

### 1.1 Mục tiêu

Xây một giao diện vận hành công ty cho 3 nhóm user:

| Role | Mục đích |
|---|---|
| **Company Operator** | Điều hành toàn bộ company trong Paperclip: goals, org, agents, work, approvals, costs, activity. |
| **CEO user** | Đặt mục tiêu, duyệt strategy, theo dõi công ty, xử lý blocker cấp cao. |
| **Manager user** | Quản lý team/phòng ban/project: giao việc, review output, xử lý blocker, theo dõi workload/cost trong scope. |

### 1.2 Boundary quan trọng

Paperclip trong hệ thống là **Company OS / Layer 4B**, không phải **Admin Tenant chung**.

- **OpenClaw**: session orchestration cho từng nhân viên.
- **Paperclip**: company operating orchestration / Layer 4B.
- **Mission Control**: ops dashboard, không phải source of truth business state.
- **Control Plane / Admin Tenant chung**: tenant registry, package capability, tool registry, runtime policy, budget, audit, approval.

Paperclip Operator Console chỉ quản lý **company-level work state**, gồm:

- Goal tree
- Work ledger
- Blockers
- Dependencies
- Escalation
- Ready-work
- Heartbeat
- Portfolio state
- Agent/task/cost/activity trong phạm vi company

Không đưa các tính năng sau vào Paperclip Operator Console:

- Tenant registry
- Package registry
- Instance settings
- Plugin marketplace/config
- Adapter/runtime registry
- Raw secrets
- Full Admin Tenant billing
- SIEM/audit dashboard kỹ thuật

---

## 2. UI reuse strategy

### 2.1 Nguyên tắc triển khai

| Nguyên tắc | Spec |
|---|---|
| **Reuse first** | Không build UI mới từ đầu. Dùng lại Paperclip UI pages/component hiện có. |
| **Route filtering** | Tạo route registry mới cho Operator Console, lọc route theo role/capability. |
| **Permission-first** | Không chỉ hide bằng CSS. Direct URL vào route không có quyền phải bị 403/redirect. |
| **Company-scoped** | Mỗi màn hình phải có `companyId`; không cho cross-company nếu user không có membership. |
| **No Admin Tenant leakage** | Không đưa Instance Settings, Plugin Manager, Adapter Manager, Secrets raw vào Operator UI. |
| **Business language** | Đổi naming cho user kinh doanh: `Issues` hiển thị là `Work / Tasks`. |
| **Minimal MVP** | MVP chỉ giữ Dashboard, Goals, Work, Agents & Org, Approvals, Costs, Activity, Company Settings. |

### 2.2 Chiến lược kỹ thuật

```text
Paperclip UI hiện có
  -> OperatorLayout
  -> route registry + role/capability filtering
  -> company-scoped route/API guard
  -> ẩn instance/plugin/adapter/secrets/dev pages
  -> ship 8 màn P0
```

Không nên fork UI quá sâu. Nên tạo một lớp **Operator Console shell + permission-filtered navigation**, sau đó reuse các page hiện có của Paperclip và chỉnh copy/visibility/action gating cho đúng role.

---

## 3. Final navigation spec

### 3.1 Sidebar cho Operator Console

```text
Company
├── Dashboard
├── Goals
├── Work
│   ├── Tasks / Issues
│   ├── Projects
│   └── Inbox / Follow-ups
├── Agents & Org
│   ├── Agents
│   └── Org Chart
├── Approvals
├── Costs
├── Activity
└── Company Settings
```

### 3.2 Mapping với Paperclip UI hiện có

| Menu mới | Page dùng lại | Ghi chú |
|---|---|---|
| Dashboard | `Dashboard.tsx`, `DashboardLive.tsx` | Giữ real-time company health. |
| Goals | `Goals.tsx`, `GoalDetail.tsx` | Company mission, project goal, linked work. |
| Work | `Issues.tsx`, `IssueDetail.tsx`, `Projects.tsx`, `ProjectDetail.tsx`, `Inbox.tsx`, `MyIssues.tsx` | Rename “Issues” thành “Work / Tasks”. |
| Agents & Org | `Agents.tsx`, `AgentDetail.tsx`, `NewAgent.tsx`, `Org.tsx`, `OrgChart.tsx` | Gộp agent list + org chart. |
| Approvals | `Approvals.tsx`, `ApprovalDetail.tsx` | P0, không bỏ. |
| Costs | `Costs.tsx` | Company / agent / project cost. |
| Activity | `Activity.tsx` | Business-level activity. |
| Company Settings | `CompanySettings.tsx`, một phần `CompanyAccess.tsx`, `CompanyInvites.tsx` | Chỉ company-level, không instance-level. |

---

## 4. Page keep / hide / defer spec

### 4.1 Giữ trong MVP P0

| Page | Action | Lý do |
|---|---|---|
| `Dashboard.tsx` / `DashboardLive.tsx` | Keep | Dashboard hiển thị agent status, task breakdown, stale tasks, cost summary, recent activity. |
| `Goals.tsx`, `GoalDetail.tsx` | Keep | Cần goal alignment; task phải trace về company mission/project goal. |
| `Issues.tsx`, `IssueDetail.tsx` | Keep, rename UI thành Work/Tasks | Work ledger chính. |
| `Projects.tsx`, `ProjectDetail.tsx` | Keep | Gộp task theo initiative/project. |
| `Inbox.tsx`, `MyIssues.tsx` | Keep | Actionable items, việc cần user can thiệp. |
| `Agents.tsx`, `AgentDetail.tsx`, `NewAgent.tsx` | Keep with permission gate | Quản agent, status, budget, current work. |
| `Org.tsx`, `OrgChart.tsx` | Keep | Quản hierarchy, reporting line, escalation. |
| `Approvals.tsx`, `ApprovalDetail.tsx` | Keep | Human operator duyệt hire, budget override, CEO strategy. |
| `Costs.tsx` | Keep | Cost tracking theo company, agent, project, goal, issue, provider, model. |
| `Activity.tsx` | Keep | Durable business activity: mutating actions, heartbeat state, cost events, approvals, comments, work products. |

### 4.2 Giữ nhưng đưa vào Advanced / P1-P2

| Page | Action | Ghi chú |
|---|---|---|
| `Routines.tsx`, `RoutineDetail.tsx` | P1 | Dùng cho recurring work/heartbeat schedule. |
| `CompanySkills.tsx` | P1, read-only trước | Chỉ hiển thị skill packs đang bật; không cho cài skill nếu capability do Admin Tenant quản. |
| `Workspaces.tsx`, `ExecutionWorkspaceDetail.tsx`, `ProjectWorkspaceDetail.tsx` | P1/P2, deep-link only | Không để sidebar; mở từ task/agent detail khi cần debug execution. |
| `CompanyImport.tsx`, `CompanyExport.tsx` | P2 | Chỉ Operator advanced; import/export cần policy và secret scrubbing. |
| `CompanyEnvironments.tsx` | P2 | Chỉ technical operator hoặc Admin Tenant delegated permission. |

### 4.3 Ẩn khỏi Operator Console

| Page | Action | Lý do |
|---|---|---|
| `InstanceSettings.tsx` | Hide | Thuộc instance/admin-level, không phải company operator. |
| `InstanceAccess.tsx` | Hide | Access instance thuộc Admin Tenant chung. |
| `InstanceGeneralSettings.tsx` | Hide | Không cho CEO/Manager chỉnh instance config. |
| `InstanceExperimentalSettings.tsx` | Hide | Không expose experimental flags. |
| `AdapterManager.tsx` | Hide | Runtime/adapter registry thuộc Admin Tenant/technical admin. |
| `PluginManager.tsx`, `PluginPage.tsx`, `PluginSettings.tsx` | Hide | Plugin là platform/instance capability. |
| `Secrets.tsx`, `pages/secrets/*` | Hide | Không expose raw secrets. Operator chỉ request/use connector qua policy. |
| `DesignGuide.tsx`, `InviteUxLab.tsx`, `IssueChatUxLab.tsx`, `RunTranscriptUxLab.tsx`, perf/test pages | Hide | Dev-only. |
| `Auth.tsx`, `CliAuth.tsx`, `BoardClaim.tsx`, `InviteLanding.tsx` | Not sidebar | Chỉ dùng trong auth/onboarding flow. |

---

## 5. Role & permission spec

### 5.1 Role model

```ts
type CompanyRole =
  | "company_operator"
  | "ceo_user"
  | "manager_user";
```

### 5.2 Permission model

```ts
type CompanyPermission =
  | "company.dashboard.view"
  | "company.goals.view"
  | "company.goals.manage"
  | "company.work.view"
  | "company.work.manage"
  | "company.work.assign"
  | "company.work.review"
  | "company.agents.view"
  | "company.agents.manage"
  | "company.agents.hire"
  | "company.agents.pause_resume"
  | "company.agents.terminate"
  | "company.org.view"
  | "company.org.manage"
  | "company.approvals.view"
  | "company.approvals.resolve"
  | "company.costs.view"
  | "company.costs.override"
  | "company.activity.view"
  | "company.settings.view"
  | "company.settings.manage"
  | "company.import_export.manage";
```

### 5.3 Permission matrix

| Capability | Company Operator | CEO user | Manager user |
|---|---:|---:|---:|
| View dashboard | Yes | Yes | Yes, scoped |
| Create/edit company goal | Yes | Yes | Department/project scope |
| Create/edit project | Yes | Yes | Team/project scope |
| Create task | Yes | Yes | Yes |
| Assign/reassign task | Yes | Yes | Team/reports scope |
| Review/close task | Yes | Yes | Team/reports scope |
| View all agents | Yes | Yes | Scoped to subtree/team |
| Hire/create agent | Yes | Conditional | No by default |
| Pause/resume agent | Yes | Conditional | Conditional |
| Terminate agent | Yes | No by default | No |
| View org chart | Yes | Yes | Scoped or full read-only |
| Edit org chart | Yes | Conditional | No by default |
| View approvals | Yes | Yes | Conditional |
| Resolve approvals | Yes | Strategy approvals only if allowed | No by default |
| View costs | Yes | Yes | Team/project scope |
| Override budget | Yes | Conditional | No |
| View activity | Yes | Yes | Team/project scope |
| Company settings | Yes | View mostly | No/limited |
| Instance/plugin/adapter/secrets | No | No | No |

---

## 6. Functional specs by module

## 6.1 Dashboard

### User goal

Operator/CEO/Manager mở Paperclip và biết ngay: công ty có đang chạy ổn không, việc gì đang blocked, approval nào cần xử lý, agent nào lỗi/quá ngân sách.

### Required cards

| Card | Fields |
|---|---|
| Company Health | Total agents, active, idle, running, error, paused. |
| Work Status | Task counts: todo, in progress, blocked, in review, done. |
| Attention Required | Pending approvals, blocked tasks, stale tasks, agent errors. |
| Budget Summary | Month spend, budget remaining, burn rate, agents near 80%, agents paused at 100%. |
| Recent Activity | Latest task updates, approvals, heartbeats, comments, cost events. |
| CEO Focus | Strategy pending approval, company-level blockers, budget risks. |

### API

```http
GET /api/companies/{companyId}/dashboard
```

### Acceptance criteria

| Case | Expected |
|---|---|
| User có quyền dashboard | Thấy dashboard theo company scope. |
| Manager scoped | Chỉ thấy team/subtree metrics nếu policy bật scope. |
| Có blocked task | Hiển thị ở Attention Required. |
| Có agent gần 80% budget | Hiện budget warning. |
| Có agent 100% budget | Hiện paused/hard stop warning. |
| Realtime update | Task/approval/cost thay đổi thì dashboard refresh hoặc live update. |

---

## 6.2 Goals

### User goal

CEO/Operator tạo mục tiêu công ty, yêu cầu CEO agent lập strategy, theo dõi task/project đang phục vụ goal nào.

### Main UI

| Section | Nội dung |
|---|---|
| Goal tree | Company mission -> project goal -> task/agent goal. |
| Goal detail | Title, description, owner, status, priority, deadline, success criteria. |
| Linked work | Projects/tasks/issues liên quan. |
| Strategy panel | No strategy / pending approval / revision requested / approved / executing. |
| Actions | Create goal, edit goal, request strategy, review strategy, archive goal. |

### Data model tối thiểu

```ts
type Goal = {
  id: string;
  companyId: string;
  parentGoalId?: string;
  ownerId?: string;
  title: string;
  description?: string;
  status: "draft" | "active" | "blocked" | "achieved" | "archived";
  priority: "low" | "medium" | "high" | "critical";
  successCriteria?: string;
  dueDate?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
```

### Acceptance criteria

| Case | Expected |
|---|---|
| Create goal | Goal xuất hiện trong tree. |
| Goal có linked tasks | Task detail hiển thị goal ancestry. |
| CEO agent submit strategy | Tạo approval `approve_ceo_strategy`. |
| Strategy approved | Goal chuyển sang executing/active và work được tạo/giao. |

---

## 6.3 Work / Tasks

### User goal

CEO/Manager/Operator quản lý toàn bộ việc: tạo task, giao việc, theo dõi status, comment blocker, review output.

### Views

| View | Spec |
|---|---|
| Board | Columns: backlog/todo/in_progress/in_review/blocked/done/cancelled. |
| List | Sort/filter theo assignee, project, goal, priority, due date, blocked, stale. |
| Inbox | Actionable items: approvals, mentions, blocked work, review needed. |
| My Follow-ups | Việc user cần quyết định/cho follow-up. |
| Task detail | Full context + thread + output + audit/activity. |

### Task lifecycle

```text
backlog -> todo -> in_progress -> in_review -> done
                    |
                    v
                 blocked
                    |
                    v
              todo / in_progress

cancelled = terminal
done = terminal
```

### Task detail fields

```ts
type WorkItem = {
  id: string;
  companyId: string;
  projectId?: string;
  goalId?: string;
  parentIssueId?: string;
  title: string;
  description?: string;
  status: "backlog" | "todo" | "in_progress" | "in_review" | "blocked" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "critical";
  assigneeAgentId?: string;
  assigneeEmployeeId?: string;
  managerId?: string;
  dueDate?: string;
  blockerReason?: string;
  acceptanceCriteria?: string;
  workProducts?: WorkProduct[];
  commentsCount: number;
  lastActivityAt: string;
};
```

### Actions

| Action | Permission |
|---|---|
| Create task | `company.work.manage` |
| Edit task | `company.work.manage` |
| Assign/reassign | `company.work.assign` |
| Move status | `company.work.manage` |
| Mark blocked | `company.work.manage` |
| Request review | Assignee/manager |
| Approve output / close | `company.work.review` |
| Cancel task | Operator/CEO/manager scope |

### Acceptance criteria

| Case | Expected |
|---|---|
| Task blocked | Required blocker comment. |
| Task done | Must have work product or review confirmation. |
| Manager scope | Manager cannot edit task outside scope. |
| Cross-company URL | 403/redirect. |
| Task assigned to agent | Agent heartbeat/event trigger có thể wake agent. |

---

## 6.4 Projects

### User goal

Group related work into initiatives/projects.

### Main UI

| Section | Nội dung |
|---|---|
| Project list | Name, owner, status, linked goal, progress, due date. |
| Project detail | Goal, tasks, blockers, agents involved, budget/cost summary. |
| Project health | On track / at risk / blocked / complete. |

### Data model

```ts
type Project = {
  id: string;
  companyId: string;
  goalId?: string;
  ownerId?: string;
  name: string;
  description?: string;
  status: "planning" | "active" | "blocked" | "completed" | "archived";
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Acceptance criteria

| Case | Expected |
|---|---|
| Project linked to goal | Goal detail hiển thị project. |
| Project has blocked tasks | Project health = at risk/blocked. |
| Project complete | All required tasks done or manually accepted. |

---

## 6.5 Agents & Org

### User goal

Quản AI workforce trong company: ai làm gì, báo cáo cho ai, đang chạy hay lỗi, ngân sách còn bao nhiêu.

### Agents list

| Column | Spec |
|---|---|
| Name | Agent display name. |
| Role/title | CEO, CTO, Sales, Researcher, Engineer... |
| Manager | Reports-to. |
| Status | active, idle, running, error, paused, terminated. |
| Current work | Current task/project. |
| Budget used | Spend vs budget. |
| Last heartbeat | Last run time/status. |
| Actions | View, pause, resume, request hire, reassign work. |

### Agent detail

| Section | Nội dung |
|---|---|
| Profile | Name, title, role, job description. |
| Org position | Manager, reports, department/team. |
| Capability | Runtime/adapter summary, skill pack summary, allowed work types. |
| Work | Current tasks, recent completed tasks, blockers. |
| Cost | Monthly budget, spend, warning state. |
| Heartbeat | Schedule, last run, next run, run history. |
| Controls | Pause, resume, reassign, terminate, edit role, request budget. |

### Org chart

| Spec |
|---|
| CEO/root node ở trên cùng. |
| Manager thấy subtree/team nếu RBAC scope bật. |
| Mỗi node có status badge. |
| Click node mở AgentDetail side panel. |
| Blocker/escalation đi theo reporting line. |

### Acceptance criteria

| Case | Expected |
|---|---|
| Agent error | Dashboard và Agent list đều hiển thị warning. |
| Pause agent | Agent không nhận task mới/heartbeat mới. |
| Resume agent | Agent hoạt động lại nếu budget/policy cho phép. |
| Hire agent | Nếu policy yêu cầu, tạo approval trước khi active. |
| Manager scope | Manager không terminate agent ngoài quyền. |

---

## 6.6 Approvals

### User goal

Giữ human-in-the-loop cho quyết định rủi ro: hire agent, approve CEO strategy, budget override, board intervention.

### Approval types P0

| Type | Trigger | Effect if approved |
|---|---|---|
| `hire_agent` | Agent/user muốn tạo subordinate mới | Agent chuyển từ `pending_approval` sang `active`. |
| `approve_ceo_strategy` | CEO agent submit strategic plan | CEO agent được phép triển khai strategy. |
| `budget_override_required` | Agent vượt cost limit | Agent được unblock/resume theo limit mới. |
| `request_board_approval` | Generic board-level decision | Requester nhận quyết định. |

### Tabs

```text
Pending
Revision requested
Approved
Rejected
All
```

### Approval detail

| Field | Spec |
|---|---|
| Requester | Agent/user tạo request. |
| Type | Approval type. |
| Status | pending, approved, rejected, revision_requested, resubmitted. |
| Linked resource | Goal/task/agent/budget/project. |
| Payload summary | Strategy/hire/budget detail. |
| Risk note | Tác động nếu approve. |
| Discussion | Comment thread. |
| Actions | Approve, reject, request revision. |

### Acceptance criteria

| Case | Expected |
|---|---|
| Pending approval | Hiển thị badge ở sidebar/dashboard. |
| Approve | Status đổi approved, linked action execute. |
| Reject | Status rejected, requester được notify. |
| Request revision | Status revision_requested, vẫn actionable. |
| Direct URL no permission | 403/redirect. |

---

## 6.7 Costs

### User goal

CEO/Operator biết company/agent/project đang tiêu bao nhiêu, agent nào gần vượt ngân sách, cần pause hay reprioritize.

### Required views

| View | Fields |
|---|---|
| Company cost | Month spend, budget, remaining, burn rate. |
| Agent cost | Agent, monthly budget, used, %, warning, status. |
| Project cost | Project/goal spend. |
| Cost alerts | 80% warning, 100% hard stop, spike. |
| Actions | Request increase, override, pause, resume, reprioritize. |

### Acceptance criteria

| Case | Expected |
|---|---|
| Agent reaches 80% | Warning visible. |
| Agent reaches 100% | Auto-paused, new work blocked. |
| Override budget | Requires permission/approval. |
| Manager scope | Manager chỉ thấy team/project cost. |

---

## 6.8 Activity

### User goal

Xem lịch sử business-level: ai đã làm gì, task/agent/approval/cost thay đổi ra sao.

### Activity event types

```ts
type ActivityType =
  | "task.created"
  | "task.updated"
  | "task.status_changed"
  | "task.commented"
  | "task.blocked"
  | "task.completed"
  | "agent.created"
  | "agent.status_changed"
  | "agent.heartbeat_started"
  | "agent.heartbeat_completed"
  | "approval.created"
  | "approval.resolved"
  | "cost.recorded"
  | "budget.warning"
  | "work_product.submitted";
```

### Filters

| Filter | Options |
|---|---|
| Actor | Human, agent, system. |
| Resource | Task, goal, project, agent, approval, cost. |
| Outcome | success, failed, blocked, pending approval. |
| Time | Today, 7 days, 30 days, custom. |
| Scope | Company, team, project, agent. |

### Acceptance criteria

| Case | Expected |
|---|---|
| Mutating action happens | Activity row created. |
| Approval resolved | Activity shows decision. |
| Agent heartbeat | Activity shows run started/completed/failed. |
| Manager scope | Activity filtered to scope. |

---

## 6.9 Company Settings

### User goal

Cho Operator chỉnh các setting company-level an toàn, không đụng Admin Tenant/instance-level.

### Keep

| Setting | Permission |
|---|---|
| Company name / description | Operator |
| Default goal / mission | Operator/CEO |
| Company members read-only | Operator/CEO |
| Invite flow | Operator, nếu Admin Tenant cho phép |
| Enabled skill packs read-only | Operator/CEO |
| Basic notification preferences | Operator/CEO |

### Hide

| Setting | Lý do |
|---|---|
| Instance config | Admin Tenant. |
| Plugin install/config | Admin Tenant / technical admin. |
| Adapter registry | Admin Tenant / runtime admin. |
| Raw secrets | Vault/policy only. |
| Experimental flags | Platform admin only. |

---

## 7. Route registry spec

```ts
type OperatorRoute = {
  path: string;
  label: string;
  page: React.ComponentType;
  section:
    | "dashboard"
    | "goals"
    | "work"
    | "agents_org"
    | "governance"
    | "costs"
    | "activity"
    | "settings";
  requiredPermissions: CompanyPermission[];
  sidebar: boolean;
  phase: "P0" | "P1" | "P2";
  scope: "company" | "team" | "project" | "self";
};
```

### 7.1 Route examples

```ts
const operatorRoutes: OperatorRoute[] = [
  {
    path: "/companies/:companyId/dashboard",
    label: "Dashboard",
    page: Dashboard,
    section: "dashboard",
    requiredPermissions: ["company.dashboard.view"],
    sidebar: true,
    phase: "P0",
    scope: "company",
  },
  {
    path: "/companies/:companyId/goals",
    label: "Goals",
    page: Goals,
    section: "goals",
    requiredPermissions: ["company.goals.view"],
    sidebar: true,
    phase: "P0",
    scope: "company",
  },
  {
    path: "/companies/:companyId/work",
    label: "Work",
    page: Issues,
    section: "work",
    requiredPermissions: ["company.work.view"],
    sidebar: true,
    phase: "P0",
    scope: "company",
  },
  {
    path: "/companies/:companyId/approvals",
    label: "Approvals",
    page: Approvals,
    section: "governance",
    requiredPermissions: ["company.approvals.view"],
    sidebar: true,
    phase: "P0",
    scope: "company",
  },
];
```

### 7.2 Guard spec

```ts
function canAccessRoute(
  route: OperatorRoute,
  ctx: {
    companyId: string;
    userId: string;
    role: CompanyRole;
    permissions: CompanyPermission[];
    scope: {
      teamIds: string[];
      projectIds: string[];
      agentSubtreeIds: string[];
    };
  }
): boolean {
  return route.requiredPermissions.every((p) =>
    ctx.permissions.includes(p)
  );
}
```

---

## 8. API/data contract spec

### 8.1 Required common request context

Mỗi request từ Operator UI cần có:

```ts
type RequestContext = {
  tenantId: string;
  companyId: string;
  employeeId: string;
  sessionId?: string;
  traceId: string;
  role: CompanyRole;
};
```

### 8.2 Minimum APIs needed

| Module | API |
|---|---|
| Dashboard | `GET /api/companies/{companyId}/dashboard` |
| Goals | `GET/POST/PATCH /api/companies/{companyId}/goals` |
| Work | `GET/POST/PATCH /api/companies/{companyId}/issues` |
| Projects | `GET/POST/PATCH /api/companies/{companyId}/projects` |
| Agents | `GET/POST/PATCH /api/companies/{companyId}/agents` |
| Org | `GET /api/companies/{companyId}/org`, `PATCH /org` |
| Approvals | `GET /api/companies/{companyId}/approvals`, `POST /approvals/{id}/approve`, `POST /reject`, `POST /request-revision` |
| Costs | `GET /api/companies/{companyId}/costs` |
| Activity | `GET /api/companies/{companyId}/activity` |
| Settings | `GET/PATCH /api/companies/{companyId}/settings` |

---

## 9. UX copy/spec naming

| Existing Paperclip label | Operator Console label |
|---|---|
| Issues | Work / Tasks |
| My Issues | My Follow-ups |
| Board | Approvals / Board Approvals |
| Agents | Agents |
| Org | Org Chart |
| Costs | Costs |
| Activity | Activity |
| Company Settings | Company Settings |
| Instance Settings | Hidden |
| Plugins | Hidden |
| Secrets | Hidden |
| Adapters | Hidden |

---

## 10. Empty states

| Screen | Empty state |
|---|---|
| Dashboard | “No work is running yet. Create a goal or hire your first agent.” |
| Goals | “Create your first company goal.” |
| Work | “No tasks yet. Create a task or ask CEO agent to plan.” |
| Agents | “No agents yet. Hire your first agent.” |
| Approvals | “No pending approvals.” |
| Costs | “No cost data yet. Costs appear after agent runs.” |
| Activity | “No activity yet.” |

---

## 11. Non-functional specs

| Area | Spec |
|---|---|
| Performance | Dashboard first load < 2s on normal data. |
| Realtime | Dashboard/Approvals/Activity should refresh automatically or via live updates. |
| Mobile | P0 screens usable on mobile: Dashboard, Work detail, Approvals, Agents. |
| Security | Route guard + API guard; no front-end-only security. |
| Isolation | All data company-scoped. |
| Audit | Mutating actions emit activity/audit envelope. |
| Accessibility | Keyboard navigation for approvals and task actions. |
| Observability | UI errors logged with `traceId`, `companyId`, `employeeId`. |

---

## 12. Implementation backlog

| ID | Module | Task | Priority |
|---|---|---|---|
| PC-OPUI-01 | Routing | Build `operatorRoutes` registry | P0 |
| PC-OPUI-02 | Layout | Create `OperatorLayout` reusing Paperclip shell | P0 |
| PC-OPUI-03 | Sidebar | Implement filtered sidebar | P0 |
| PC-OPUI-04 | RBAC | Implement `useCompanyPermissions(companyId)` | P0 |
| PC-OPUI-05 | Guards | Route guard + API 403 handling | P0 |
| PC-OPUI-06 | Cleanup | Hide Instance/Plugin/Adapter/Secrets/Dev pages from Operator UI | P0 |
| PC-OPUI-07 | Dashboard | Put Attention Required at top | P0 |
| PC-OPUI-08 | Goals | Add linked work + strategy status | P0 |
| PC-OPUI-09 | Work IA | Group Issues/Projects/Inbox under Work | P0 |
| PC-OPUI-10 | Issue Detail | Add blocker panel + goal ancestry + work product area | P0 |
| PC-OPUI-11 | Agents & Org | Group Agents/Org/OrgChart | P0 |
| PC-OPUI-12 | Approvals | Standardize approval tabs and detail view | P0 |
| PC-OPUI-13 | Costs | Company/agent/project tabs + warning states | P0 |
| PC-OPUI-14 | Activity | Add filters by actor/type/resource/time | P1 |
| PC-OPUI-15 | Settings | Minimal Company Settings only | P1 |
| PC-OPUI-16 | Routines | Add recurring work UI behind flag | P1 |
| PC-OPUI-17 | Skills | CompanySkills read-only | P1 |
| PC-OPUI-18 | Import/export | Advanced only, behind permission | P2 |
| PC-OPUI-19 | Mobile | Responsive pass for P0 screens | P0 |
| PC-OPUI-20 | Tests | Playwright smoke tests for Operator/CEO/Manager | P0 |

---

## 13. Test cases

### 13.1 Role visibility tests

| Test | Expected |
|---|---|
| Company Operator login | Sees Dashboard, Goals, Work, Agents & Org, Approvals, Costs, Activity, Settings. |
| CEO login | Sees Dashboard, Goals, Work, Agents & Org, Approvals, Costs, Activity; Settings limited. |
| Manager login | Sees Dashboard, Goals/Work scoped, Agents & Org scoped, Costs scoped, Activity scoped. |
| Manager direct URL to Instance Settings | 403/redirect. |
| CEO direct URL to Secrets | 403/redirect. |
| Operator direct URL to PluginManager | 403/redirect unless separate Admin Tenant permission exists. |

### 13.2 Functional smoke tests

| Test | Expected |
|---|---|
| Create goal | Goal appears in Goals and Dashboard activity. |
| Create task under goal | Task shows goal ancestry. |
| Assign task to agent | Agent detail shows current work. |
| Mark task blocked | Dashboard Attention Required updates. |
| Submit CEO strategy | Approval appears. |
| Approve strategy | Approval status changes and activity event created. |
| Agent hits 80% budget | Costs warning visible. |
| Agent hits 100% budget | Agent auto-paused/blocked state visible. |
| Manager scoped user opens other team task | 403/hidden depending route. |

---

## 14. Acceptance criteria tổng

| Area | Done khi |
|---|---|
| Reuse UI | Không rewrite UI core; dùng lại page/component Paperclip hiện có. |
| Navigation | Operator Console có sidebar mới, chỉ 8 mục chính. |
| Hidden admin features | Không thấy Instance, Plugin, Adapter, Secrets, Dev/UxLab trong Operator UI. |
| RBAC | Role-based route guard hoạt động cả sidebar và direct URL. |
| Company scope | Không xem/sửa được data ngoài company/scope. |
| Dashboard | Có agent status, task breakdown, stale work, cost summary, recent activity. |
| Goals | Có goal tree/detail/linked work/strategy status. |
| Work | Có board/list/detail/blocker/work product. |
| Agents & Org | Có agent list/detail/org chart/status/actions theo quyền. |
| Approvals | Có pending/revision/approved/rejected; approve/reject/request revision chạy được. |
| Costs | Có company/agent/project cost và 80%/100% warning. |
| Activity | Có business-level activity filter được. |
| Mobile | P0 screens usable trên mobile. |
| Tests | Có Playwright smoke test cho 3 role. |

---

## 15. Scope không làm ở MVP

| Không làm trong MVP | Lý do |
|---|---|
| Admin Tenant UI | Đây là app/layer khác, không phải Paperclip Operator Console. |
| Plugin marketplace/config | Thuộc platform/admin. |
| Adapter/runtime registry | Thuộc Admin Tenant/technical admin. |
| Raw secret management | Thuộc vault/policy. |
| Full audit/SIEM dashboard | Activity business-level là đủ cho Operator; audit kỹ thuật để Admin/Mission Control. |
| Full import/export org templates | Để P2. |
| Workflow builder drag/drop | Paperclip không phải workflow builder; no model công ty bằng org chart, goals, budgets, governance. |

---

## 16. Milestone rollout

### Sprint 0 - UI inventory & permission map

| Task | Việc cụ thể | Output |
|---|---|---|
| UI-00-01 | Audit toàn bộ routes trong `ui/src/pages` | Danh sách keep/hide/defer |
| UI-00-02 | Tạo role matrix: Operator, CEO, Manager | Permission JSON |
| UI-00-03 | Tạo route registry | `routes.ts` có `requiredPermission`, `scope`, `visibleInSidebar` |
| UI-00-04 | Xác định company context | Chuẩn `companyId`, selected company, current membership |
| UI-00-05 | Chốt nav label mới | Dashboard, Goals, Work, Agents & Org, Approvals, Costs, Activity, Settings |

### Sprint 1 - Shell, routing, sidebar

| Task | Việc cụ thể | Output |
|---|---|---|
| UI-01-01 | Tạo `OperatorLayout` dùng lại layout hiện có | Sidebar + header + company switcher |
| UI-01-02 | Filter sidebar theo role/capability | Manager không thấy màn không có quyền |
| UI-01-03 | Route guard | Direct URL vào route cấm trả 403/redirect |
| UI-01-04 | Ẩn instance/dev pages | Không còn `InstanceSettings`, `PluginManager`, `AdapterManager`, `Secrets` trong nav |
| UI-01-05 | Add role badge | Header hiển thị role: Operator/CEO/Manager |
| UI-01-06 | Smoke test routes | Không vỡ link chính |

### Sprint 2 - Core business pages

| Task | Việc cụ thể | Output |
|---|---|---|
| UI-02-01 | Dashboard cleanup | Chỉ giữ health, work, approval, cost, activity |
| UI-02-02 | Goals polish | Goal tree + linked work + strategy status |
| UI-02-03 | Work IA | Gộp Issues/Projects/MyIssues/Inbox dưới menu Work |
| UI-02-04 | Issue detail polish | Thêm goal ancestry, blocker panel, work product area |
| UI-02-05 | Agents & Org IA | Gộp Agents/Org/OrgChart, status badge, action gating |
| UI-02-06 | Manager scope | Manager chỉ thấy subtree/team nếu permission yêu cầu |

### Sprint 3 - Approvals, costs, activity

| Task | Việc cụ thể | Output |
|---|---|---|
| UI-03-01 | Approvals queue | Pending/revision/approved/rejected tabs |
| UI-03-02 | Approval detail | Payload summary + linked issue + risk note + actions |
| UI-03-03 | Costs page cleanup | Company/agent/project spend + 80/100% alerts |
| UI-03-04 | Activity filters | Type, actor, resource, time, outcome |
| UI-03-05 | Empty states | Không có goal/task/agent thì hướng dẫn bước tiếp theo |
| UI-03-06 | Realtime refresh | Dashboard/approvals/activity refresh hoặc live updates |

### Sprint 4 - Advanced / optional

| Task | Việc cụ thể | Output |
|---|---|---|
| UI-04-01 | Routines P1 | Recurring work nếu cần |
| UI-04-02 | CompanySkills read-only | Hiển thị skill packs đang bật |
| UI-04-03 | CompanySettings minimal | Name, description, default goal, basic policy summary |
| UI-04-04 | Import/export behind flag | Chỉ Operator advanced |
| UI-04-05 | Workspace detail deep link | Chỉ mở từ issue/agent khi debug |
| UI-04-06 | Mobile pass | Dashboard, approvals, issue detail, agent detail responsive |

---

## 17. Conclusion

Bạn cần triển khai là:

```text
Paperclip UI hiện có
-> OperatorLayout
-> route registry + role/capability filtering
-> company-scoped route/API guard
-> ẩn instance/plugin/adapter/secrets/dev pages
-> ship 8 màn P0:
   Dashboard, Goals, Work, Agents & Org,
   Approvals, Costs, Activity, Company Settings
```

MVP nên ưu tiên: **navigation đúng**, **permission guard đúng**, **không lộ admin-level pages**, và **giúp CEO/Manager/Operator điều hành company work state thật sự**.
