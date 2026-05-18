# Kế hoạch triển khai Paperclip Operator Console MVP

## 1. Mục tiêu MVP

Xây dựng **Paperclip Operator Console** bằng cách dùng lại UI Paperclip hiện có, bổ sung lớp vận hành riêng cho Company Operator / CEO / Manager.

MVP cần đạt các mục tiêu chính:

- Tạo `OperatorLayout` riêng cho Operator Console.
- Tạo `operatorRoutes` để quản lý route theo role/capability.
- Lọc sidebar theo quyền người dùng.
- Bắt buộc route guard và API guard, không chỉ ẩn bằng CSS.
- Mọi màn hình phải chạy theo `companyId`.
- Ẩn toàn bộ màn admin-level khỏi Operator Console.
- Ship 8 màn chính:
  - Dashboard
  - Goals
  - Work
  - Agents & Org
  - Approvals
  - Costs
  - Activity
  - Company Settings

---

## 2. Nguyên tắc triển khai

| Nguyên tắc | Cách áp dụng |
|---|---|
| Reuse first | Dùng lại page/component Paperclip hiện có, không build UI mới từ đầu. |
| Permission-first | Sidebar có thể ẩn menu, nhưng direct URL vẫn phải bị chặn bằng 403/redirect. |
| Company-scoped | Mọi route/API đều phải có `companyId` và kiểm tra membership. |
| No Admin Tenant leakage | Không lộ Instance Settings, Plugin Manager, Adapter Manager, Secrets, Dev/UxLab. |
| Business language | Đổi `Issues` thành `Work / Tasks`, `My Issues` thành `My Follow-ups`. |
| Minimal MVP | Ưu tiên navigation, permission guard, company scope và 8 màn P0. |

---

## 3. Phạm vi MVP

### 3.1 Màn hình giữ lại trong MVP

| Màn | Mục đích |
|---|---|
| Dashboard | Xem tình trạng công ty, agent, task, blocker, approval, cost. |
| Goals | Quản lý mục tiêu công ty/project, linked work và strategy status. |
| Work | Quản lý task, project, inbox, follow-up và work product. |
| Agents & Org | Quản lý agent, org chart, reporting line, heartbeat, budget. |
| Approvals | Duyệt hire agent, CEO strategy, budget override, board decision. |
| Costs | Theo dõi chi phí theo company, agent, project. |
| Activity | Xem business-level activity. |
| Company Settings | Chỉnh các setting an toàn ở cấp company. |

### 3.2 Màn hình phải ẩn khỏi Operator Console

| Màn/phần | Lý do |
|---|---|
| Instance Settings | Thuộc Admin Tenant/platform level. |
| Instance Access | Không thuộc company operator scope. |
| Plugin Manager / Plugin Settings | Thuộc capability/platform config. |
| Adapter Manager | Thuộc runtime/technical admin. |
| Secrets | Không expose raw secrets. |
| Dev / UX Lab pages | Chỉ dành cho dev/test. |
| Full billing admin | Thuộc Admin Tenant chung. |
| SIEM/audit kỹ thuật | Thuộc Security/Mission Control/Admin. |

---

## 4. Role và permission

### 4.1 Role MVP

```ts
type CompanyRole =
  | "company_operator"
  | "ceo_user"
  | "manager_user";
```

### 4.2 Permission summary

| Capability | Company Operator | CEO user | Manager user |
|---|---:|---:|---:|
| View dashboard | Full | Full | Scoped |
| Manage goals | Full | Full | Team/project scope |
| Manage work/tasks | Full | Full | Team/project scope |
| Assign/reassign task | Full | Full | Team/report scope |
| View agents | Full | Full | Scoped |
| Hire agent | Full | Conditional | No by default |
| Pause/resume agent | Full | Conditional | Conditional |
| Terminate agent | Full | No by default | No |
| View costs | Full | Full | Scoped |
| Override budget | Full | Conditional | No |
| Company settings | Full | Limited | No/limited |
| Instance/plugin/adapter/secrets | No | No | No |

### 4.3 Quyết định cần chốt trước khi code

| Câu hỏi | Đề xuất |
|---|---|
| CEO có được hire agent không? | Có, nhưng conditional hoặc cần approval nếu vượt policy. |
| CEO có được override budget không? | Có, nhưng cần approval hoặc limit rõ ràng. |
| Manager có được pause/resume agent trong team không? | Pause được nếu agent thuộc scope; resume cần policy/budget check. |
| Operator terminate agent có cần approval không? | Nên cần confirmation hoặc approval nếu agent đang có active work. |
| Unauthorized route nên redirect hay hiện 403? | Business route hiện 403; admin-level route redirect về Dashboard kèm toast. |

---

## 5. Route structure đề xuất

```text
/companies/:companyId/dashboard
/companies/:companyId/goals
/companies/:companyId/work
/companies/:companyId/work/tasks
/companies/:companyId/work/projects
/companies/:companyId/work/inbox
/companies/:companyId/agents
/companies/:companyId/org
/companies/:companyId/approvals
/companies/:companyId/costs
/companies/:companyId/activity
/companies/:companyId/settings
```

### 5.1 Route model

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

### 5.2 Guard flow

```text
1. Check authenticated user.
2. Load company membership.
3. Load role + permissions + scope.
4. Check route.requiredPermissions.
5. Check companyId membership.
6. Check team/project/agent scope nếu route cần scoped data.
7. Nếu fail:
   - Route business-level: show 403.
   - Route admin-level: redirect về Dashboard hoặc show 403.
```

---

## 6. Kế hoạch triển khai theo sprint

## Sprint 0 — Chuẩn bị nền tảng

### Mục tiêu

Chốt route inventory, role, permission, route registry và company context trước khi triển khai UI lớn.

### Việc cần làm

| Task | Owner đề xuất | Output |
|---|---|---|
| Audit toàn bộ `ui/src/pages` | Frontend lead | Danh sách keep / hide / defer |
| Chốt 3 role: Operator, CEO, Manager | PM + Security | Permission matrix |
| Tạo `CompanyPermission` enum | Backend + Frontend | Shared permission contract |
| Thiết kế `operatorRoutes` | Frontend | `routes/operatorRoutes.ts` |
| Xác định company context | Backend + Frontend | `companyId`, selected company, membership |
| Chốt 8 màn MVP | PM/Product | Navigation final |

### Output cuối sprint

```text
operatorRoutes.ts
companyPermissions.ts
route keep/hide/defer list
role-permission matrix
company context contract
```

### Điều kiện pass

- Biết chính xác page nào giữ, page nào ẩn, page nào P1/P2.
- Biết mỗi role thấy màn nào.
- Có data shape tối thiểu cho `companyId`, `employeeId`, `role`, `permissions`, `scope`.
- Chốt cách xử lý unauthorized route.

---

## Sprint 1 — Shell, routing, sidebar, guard

### Mục tiêu

Tạo được Operator Console shell chạy được, sidebar đúng, route guard đúng.

### Việc cần làm

| Task | Output |
|---|---|
| Tạo `OperatorLayout` | Sidebar + header + content area |
| Thêm company switcher | Header hiển thị company hiện tại |
| Thêm role badge | Operator / CEO / Manager |
| Implement filtered sidebar | Menu lọc theo permission |
| Implement route guard | Direct URL không có quyền trả 403/redirect |
| Implement API 403 handling | UI hiển thị unauthorized state |
| Ẩn admin/dev pages khỏi Operator nav | Không thấy Instance/Plugin/Adapter/Secrets/Dev |

### Điều kiện pass

- Operator thấy đủ 8 màn.
- CEO thấy các màn chính, Settings giới hạn.
- Manager chỉ thấy dữ liệu scoped.
- Vào trực tiếp `/instance-settings`, `/secrets`, `/plugins` từ Operator role bị chặn.
- Sidebar không hiện page không có quyền.

---

## Sprint 2 — Core business pages

### Mục tiêu

Làm các màn vận hành chính đủ dùng: Dashboard, Goals, Work, Agents & Org.

### 2.1 Dashboard

Cards cần có:

| Card | Nội dung |
|---|---|
| Company Health | Total agents, active, idle, running, error, paused |
| Work Status | Todo, in progress, blocked, in review, done |
| Attention Required | Pending approvals, blocked tasks, stale tasks, agent errors |
| Budget Summary | Month spend, remaining budget, burn rate, 80%/100% warning |
| Recent Activity | Task updates, approvals, heartbeats, comments, cost events |
| CEO Focus | Strategy pending approval, company blockers, budget risks |

API:

```http
GET /api/companies/{companyId}/dashboard
```

### 2.2 Goals

MVP cần có:

```text
Goal tree
Goal detail
Linked work
Strategy status
Create/edit/archive goal
Request/review strategy
```

### 2.3 Work

Naming cần đổi:

```text
Issues -> Work / Tasks
My Issues -> My Follow-ups
```

Work gồm:

```text
Tasks / Issues
Projects
Inbox / Follow-ups
```

Task detail cần thêm:

```text
goal ancestry
blocker panel
work product area
comments/activity
review/close action
```

### 2.4 Agents & Org

Gộp các page:

```text
Agents
Agent Detail
New Agent
Org
Org Chart
```

Agent list cần có:

```text
name
role/title
manager
status
current work
budget used
last heartbeat
actions
```

Org chart cần click node mở Agent Detail side panel.

### Điều kiện pass Sprint 2

- Dashboard có blocked tasks, budget warning, agent status.
- Goal tạo mới xuất hiện trong tree.
- Task under goal hiển thị goal ancestry.
- Work menu gom Tasks / Projects / Inbox.
- Agent detail hiển thị current work, budget, heartbeat.
- Manager chỉ thấy subtree/team nếu bị scope.

---

## Sprint 3 — Governance, Costs, Activity, Settings

### Mục tiêu

Hoàn thiện phần human-in-the-loop và quan sát vận hành.

### 3.1 Approvals

MVP approval types:

```text
hire_agent
approve_ceo_strategy
budget_override_required
request_board_approval
```

Tabs:

```text
Pending
Revision requested
Approved
Rejected
All
```

Approval detail cần có:

```text
requester
type
status
linked resource
payload summary
risk note
discussion
approve / reject / request revision
```

### 3.2 Costs

Views cần có:

```text
Company cost
Agent cost
Project cost
Cost alerts
```

Logic cần có:

```text
80% budget -> warning
100% budget -> auto-pause / hard stop
override budget -> permission hoặc approval
```

### 3.3 Activity

Activity là **business-level activity**, không phải SIEM/audit kỹ thuật.

Event types MVP:

```text
task.created
task.updated
task.status_changed
task.blocked
task.completed
agent.created
agent.status_changed
agent.heartbeat_started
agent.heartbeat_completed
approval.created
approval.resolved
cost.recorded
budget.warning
work_product.submitted
```

Filters:

```text
Actor
Resource
Outcome
Time
Scope
```

### 3.4 Company Settings

Chỉ giữ company-level settings:

```text
Company name / description
Default goal / mission
Company members read-only
Invite flow nếu policy cho phép
Enabled skill packs read-only
Basic notification preferences
```

Không đưa:

```text
Instance config
Plugin install/config
Adapter registry
Raw secrets
Experimental flags
```

### Điều kiện pass Sprint 3

- Pending approval hiện badge ở sidebar/dashboard.
- Approve/reject/request revision chạy được.
- Agent 80% budget hiện warning.
- Agent 100% budget bị paused/blocked.
- Activity ghi lại mutating actions.
- Settings không lộ instance/plugin/secret/adapter.

---

## Sprint 4 — Test, mobile, hardening, pilot

### Mục tiêu

Đóng MVP đủ an toàn để pilot.

### Test bắt buộc

| Nhóm test | Test |
|---|---|
| Role visibility | Operator thấy đủ 8 màn |
| Role visibility | CEO thấy màn chính, Settings limited |
| Role visibility | Manager chỉ thấy scoped data |
| Security | Manager direct URL vào Instance Settings bị 403/redirect |
| Security | CEO direct URL vào Secrets bị 403/redirect |
| Security | Cross-company URL bị 403/redirect |
| Functional | Create goal tạo activity |
| Functional | Create task under goal hiển thị ancestry |
| Functional | Assign task to agent hiện trong Agent Detail |
| Functional | Mark blocked update Dashboard |
| Functional | Submit CEO strategy tạo approval |
| Functional | Approve strategy đổi status và tạo activity |
| Cost | 80% budget warning |
| Cost | 100% budget auto-pause |
| Mobile | Dashboard, Work detail, Approvals, Agents usable |

### Hardening checklist

```text
No admin pages in Operator nav
No CSS-only hide
Route guard works
API guard works
companyId enforced
traceId logged
activity emitted for mutating actions
dashboard first load < 2s on normal data
mobile pass for P0 screens
```

### Pilot scope đề xuất

```text
1 company
1 Operator
1 CEO
2 Managers
5–10 agents
20–50 tasks
3–5 goals
budget warning sample data
approval sample data
```

---

## 7. Backend/API workstream song song

Frontend có thể bắt đầu bằng mock data, nhưng MVP thật cần backend/API tối thiểu sau:

| Module | API |
|---|---|
| Dashboard | `GET /api/companies/{companyId}/dashboard` |
| Goals | `GET/POST/PATCH /api/companies/{companyId}/goals` |
| Work | `GET/POST/PATCH /api/companies/{companyId}/issues` |
| Projects | `GET/POST/PATCH /api/companies/{companyId}/projects` |
| Agents | `GET/POST/PATCH /api/companies/{companyId}/agents` |
| Org | `GET /api/companies/{companyId}/org`, `PATCH /org` |
| Approvals | `GET /api/companies/{companyId}/approvals`, `POST approve/reject/request-revision` |
| Costs | `GET /api/companies/{companyId}/costs` |
| Activity | `GET /api/companies/{companyId}/activity` |
| Settings | `GET/PATCH /api/companies/{companyId}/settings` |

### Request context tối thiểu

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

---

## 8. Thứ tự ưu tiên nếu thiếu thời gian

### Must-have

```text
1. OperatorLayout
2. operatorRoutes
3. useCompanyPermissions(companyId)
4. Sidebar filtering
5. Route/API guard
6. Hide admin/dev pages
7. Dashboard
8. Work / Tasks
9. Approvals
10. Playwright role visibility tests
```

### Should-have

```text
Goals
Agents & Org
Costs
Activity
Company Settings minimal
Mobile pass
Realtime refresh
```

### Could-have / P1

```text
Routines
CompanySkills read-only
Workspace detail deep-link
Advanced import/export
CompanyEnvironments for technical operator
```

---

## 9. RACI đề xuất

| Vai trò | Trách nhiệm |
|---|---|
| Product/PM | Chốt role, scope, MVP screens, acceptance. |
| Frontend lead | OperatorLayout, route registry, sidebar, page reuse. |
| Backend lead | Company context, permissions, API guard, data contracts. |
| Security/IAM | RBAC, cross-company isolation, approval policy. |
| QA | Playwright tests, unauthorized route tests, mobile smoke. |
| DevOps/SRE | Env config, logging, traceId, staging deploy. |
| Architecture lead | Đảm bảo không lệch boundary V24. |

---

## 10. Definition of Done cho MVP

MVP được xem là xong khi đạt đủ các điểm sau:

```text
Operator Console có sidebar mới với 8 màn chính.
Reuse Paperclip pages/components, không rewrite core UI.
Không thấy Instance, Plugin, Adapter, Secrets, Dev/UxLab trong Operator UI.
Route guard hoạt động cả sidebar và direct URL.
API guard chặn cross-company/cross-scope.
Dashboard có agent status, task breakdown, blocked/stale work, cost summary, recent activity.
Goals có tree/detail/linked work/strategy status.
Work có board/list/detail/blocker/work product.
Agents & Org có list/detail/org chart/status/actions theo quyền.
Approvals có pending/revision/approved/rejected và action approve/reject/request revision.
Costs có company/agent/project cost và cảnh báo 80%/100%.
Activity ghi business-level events.
Mobile dùng được cho Dashboard, Work detail, Approvals, Agents.
Có Playwright smoke tests cho Operator/CEO/Manager.
```

---

## 11. Ghi chú architecture alignment

Paperclip Operator Console phải giữ đúng vai trò **Company OS / Layer 4B**:

- Quản lý goals.
- Quản lý work ledger.
- Theo dõi blockers/dependencies.
- Kích hoạt escalation.
- Theo dõi ready-work.
- Hiển thị portfolio/company state.

Không được biến Paperclip Operator Console thành:

- Admin Tenant UI.
- Plugin marketplace.
- Adapter/runtime registry.
- Raw secrets manager.
- Full billing admin.
- SIEM/audit dashboard kỹ thuật.
- Generic workflow builder.

