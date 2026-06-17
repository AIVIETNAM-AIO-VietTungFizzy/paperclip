# MCP Connector Catalog — Tracer Bullet Completion Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the tracer-bullet demo of the MCP Connector Catalog feature — a Super Admin can create a connector, a tenant admin can enable it, and the runtime gateway aggregates its tools behind `/api/runtime/mcp-sdk`.

**Architecture:** The server-side infrastructure (DB schemas, validators, services, routes, runtime gateway, client pool, CP delegation) is already built. Three pieces remain: (1) the CP enforce endpoint that the runtime proxies to, (2) a Super Admin connectors management page in the Vite UI, and (3) a Tenant Admin connectors enable/disable page in the Vite UI.

**Tech Stack:** Next.js 16 (CP API routes), Vite + React 19 (UI), Drizzle ORM, Express 5, `@modelcontextprotocol/sdk`

**Spec:** `/home/achau/workspace/AIautomation/specs/2026-06-16-mcp-connector-catalog-gateway-design.md`

---

## File Structure

### New files to create:
| File | Responsibility |
|---|---|
| `control-plane/src/app/api/core/enforce/route.ts` | CP enforce endpoint — validates package tier, returns 200/403 |
| `ui/src/api/connectors.ts` | API client for connector CRUD + tenant enable/disable |
| `ui/src/pages/Connectors.tsx` | Super Admin connectors management page (list, create, edit) |
| `ui/src/pages/CompanyConnectors.tsx` | Tenant Admin connectors page (enable/disable for their company) |

### Files to modify:
| File | Change |
|---|---|
| `ui/src/api/index.ts` | Add `connectorsApi` export |
| `ui/src/App.tsx` | Add routes for `/connectors` and `/:companyPrefix/company/connectors` |

---

## Task 1: CP Enforce Endpoint

**Files:**
- Create: `control-plane/src/app/api/core/enforce/route.ts`

The runtime enforcement proxy (`runtime-core/management-server/src/enforcement-proxy.ts`) proxies `POST /api/core/enforce` to `CP_BASE_URL/api/core/enforce`. This endpoint doesn't exist yet. It needs to validate the `package_tier` field and return 200 if allowed, 403 if denied.

- [ ] **Step 1: Create `control-plane/src/app/api/core/enforce/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { tenant_id, user_id, tool, risk_class, package_tier } = body as Record<string, unknown>;

  if (!tenant_id || !tool) {
    return NextResponse.json({ error: "tenant_id and tool are required" }, { status: 400 });
  }

  // Package tier enforcement
  if (package_tier === "denied") {
    return NextResponse.json(
      { error: "package_not_allowed_for_tool", allowed: false },
      { status: 403 },
    );
  }

  // All other cases: allow (future: risk_class-based policy, user-level overrides)
  return NextResponse.json({ allowed: true, package_tier });
}
```

- [ ] **Step 2: Verify the file exists and has correct structure**

Run: `ls control-plane/src/app/api/core/enforce/route.ts`
Expected: file exists

- [ ] **Step 3: Commit**

```bash
git add control-plane/src/app/api/core/enforce/route.ts
git commit -m "feat(cp): add enforce endpoint for connector tool package gating"
```

---

## Task 2: Connectors API Client (UI)

**Files:**
- Create: `ui/src/api/connectors.ts`
- Modify: `ui/src/api/index.ts`

- [ ] **Step 1: Create `ui/src/api/connectors.ts`**

```typescript
import { api } from "./client";

export interface Connector {
  id: string;
  connectorKey: string;
  connectorName: string;
  description: string | null;
  endpointUrl: string | null;
  hostingMode: "remote" | "provisioned";
  authType: string | null;
  credentialSchema: CredentialSchemaEntry[];
  allowedPackages: string[];
  provisionSpec: Record<string, unknown> | null;
  capabilities: Record<string, unknown> | null;
  status: "active" | "inactive";
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialSchemaEntry {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
}

export interface TenantConnector {
  id: string;
  tenantId: string;
  connectorId: string;
  status: "pending_config" | "enabled" | "disabled" | "failed";
  credentialRefs: Record<string, string>;
  resolvedEndpoint: string | null;
  namespace: string;
  lastHandshakeAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectorWithStatus extends Connector {
  enabled: boolean;
  tenantConnector: TenantConnector | null;
}

export const connectorsApi = {
  list: () => api.get<Connector[]>("/connectors"),

  get: (id: string) => api.get<Connector>(`/connectors/${id}`),

  create: (data: {
    connectorKey: string;
    connectorName: string;
    description?: string | null;
    endpointUrl?: string | null;
    hostingMode?: "remote" | "provisioned";
    credentialSchema?: CredentialSchemaEntry[];
    allowedPackages?: string[];
  }) => api.post<Connector>("/connectors", data),

  update: (id: string, data: Partial<Connector>) =>
    api.patch<Connector>(`/connectors/${id}`, data),

  delete: (id: string) => api.delete<void>(`/connectors/${id}`),

  listForCompany: (companyId: string) =>
    api.get<ConnectorWithStatus[]>(`/companies/${companyId}/connectors`),

  enable: (companyId: string, connectorId: string, data?: { credentialValues?: Record<string, string>; namespace?: string }) =>
    api.post<{ id: string; status: string; error?: string }>(
      `/companies/${companyId}/connectors/${connectorId}/enable`,
      data ?? {},
    ),

  disable: (companyId: string, connectorId: string) =>
    api.post<{ status: string }>(`/companies/${companyId}/connectors/${connectorId}/disable`, {}),
};
```

- [ ] **Step 2: Add export to `ui/src/api/index.ts`**

Add after existing exports:
```typescript
export { connectorsApi } from "./connectors";
export type { Connector, ConnectorWithStatus, TenantConnector, CredentialSchemaEntry } from "./connectors";
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/api/connectors.ts ui/src/api/index.ts
git commit -m "feat(ui): add connectors API client"
```

---

## Task 3: Super Admin Connectors Management Page

**Files:**
- Create: `ui/src/pages/Connectors.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Create `ui/src/pages/Connectors.tsx`**

```typescript
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Edit3, ExternalLink, Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { connectorsApi, type Connector, type CredentialSchemaEntry } from "../api/connectors";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { EmptyState } from "../components/EmptyState";

const PACKAGE_OPTIONS = ["free", "L0", "L1", "L2", "L3"];

const emptyForm = {
  connectorKey: "",
  connectorName: "",
  description: "",
  endpointUrl: "",
  hostingMode: "remote" as const,
  allowedPackages: [] as string[],
  credentialSchema: [] as CredentialSchemaEntry[],
};

export function Connectors() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { addToast } = useToastActions();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [credFieldKey, setCredFieldKey] = useState("");
  const [credFieldLabel, setCredFieldLabel] = useState("");
  const [credFieldSecret, setCredFieldSecret] = useState(false);

  const { data: connectors, isLoading } = useQuery({
    queryKey: queryKeys.connectors.all,
    queryFn: () => connectorsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: () => connectorsApi.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors.all });
      setShowCreate(false);
      setForm(emptyForm);
      addToast({ variant: "success", title: "Connector created" });
    },
    onError: (err) => addToast({ variant: "error", title: String(err) }),
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("no connector selected");
      return connectorsApi.update(editing.id, form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors.all });
      setEditing(null);
      setForm(emptyForm);
      addToast({ variant: "success", title: "Connector updated" });
    },
    onError: (err) => addToast({ variant: "error", title: String(err) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => connectorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors.all });
      addToast({ variant: "success", title: "Connector deleted" });
    },
    onError: (err) => addToast({ variant: "error", title: String(err) }),
  });

  function openCreate() {
    setForm(emptyForm);
    setEditing(null);
    setShowCreate(true);
  }

  function openEdit(c: Connector) {
    setEditing(c);
    setForm({
      connectorKey: c.connectorKey,
      connectorName: c.connectorName,
      description: c.description ?? "",
      endpointUrl: c.endpointUrl ?? "",
      hostingMode: c.hostingMode,
      allowedPackages: c.allowedPackages,
      credentialSchema: c.credentialSchema,
    });
    setShowCreate(true);
  }

  function togglePackage(pkg: string) {
    setForm((f) => ({
      ...f,
      allowedPackages: f.allowedPackages.includes(pkg)
        ? f.allowedPackages.filter((p) => p !== pkg)
        : [...f.allowedPackages, pkg],
    }));
  }

  function addCredentialField() {
    if (!credFieldKey || !credFieldLabel) return;
    setForm((f) => ({
      ...f,
      credentialSchema: [
        ...f.credentialSchema,
        { key: credFieldKey, label: credFieldLabel, secret: credFieldSecret, required: true },
      ],
    }));
    setCredFieldKey("");
    setCredFieldLabel("");
    setCredFieldSecret(false);
  }

  function removeCredentialField(key: string) {
    setForm((f) => ({
      ...f,
      credentialSchema: f.credentialSchema.filter((e) => e.key !== key),
    }));
  }

  return (
    <div className="mx-auto max-w-4xl py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Connectors</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage MCP connector catalog entries. These define what external services tenants can connect.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          New Connector
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !connectors?.length ? (
        <EmptyState
          title="No connectors yet"
          description="Create your first MCP connector to let tenants connect external services."
          action={{ label: "New Connector", onClick: openCreate }}
        />
      ) : (
        <div className="space-y-3">
          {connectors.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{c.connectorName}</h3>
                    <Badge variant={c.status === "active" ? "default" : "secondary"}>
                      {c.status}
                    </Badge>
                    <Badge variant="outline">{c.hostingMode}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">{c.connectorKey}</code>
                    {c.description ? ` — ${c.description}` : ""}
                  </p>
                  {c.endpointUrl && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono truncate">{c.endpointUrl}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">Packages:</span>
                    {c.allowedPackages.length === 0 ? (
                      <Badge variant="outline" className="text-xs">All</Badge>
                    ) : (
                      c.allowedPackages.map((p) => (
                        <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-4 shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(c.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={showCreate} onOpenChange={(open) => { if (!open) { setShowCreate(false); setEditing(null); } }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit Connector" : "New Connector"}</SheetTitle>
            <SheetDescription>
              {editing ? "Update the connector definition." : "Define a new MCP connector for the catalog."}
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 mt-6">
            <div>
              <label className="text-sm font-medium">Connector Key</label>
              <Input
                value={form.connectorKey}
                onChange={(e) => setForm((f) => ({ ...f, connectorKey: e.target.value }))}
                placeholder="deerflow"
                disabled={!!editing}
              />
              <p className="text-xs text-muted-foreground mt-1">Lowercase slug (a-z, 0-9, _, -)</p>
            </div>

            <div>
              <label className="text-sm font-medium">Display Name</label>
              <Input
                value={form.connectorName}
                onChange={(e) => setForm((f) => ({ ...f, connectorName: e.target.value }))}
                placeholder="DeerFlow"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Description</label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="DeerFlow MCP server providing search and data tools..."
              />
            </div>

            <div>
              <label className="text-sm font-medium">Endpoint URL</label>
              <Input
                value={form.endpointUrl}
                onChange={(e) => setForm((f) => ({ ...f, endpointUrl: e.target.value }))}
                placeholder="https://deerflow.example.com/mcp"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Hosting Mode</label>
              <div className="flex gap-2 mt-1">
                <Button
                  variant={form.hostingMode === "remote" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, hostingMode: "remote" }))}
                >
                  Remote
                </Button>
                <Button
                  variant={form.hostingMode === "provisioned" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setForm((f) => ({ ...f, hostingMode: "provisioned" }))}
                >
                  Provisioned
                </Button>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Allowed Packages</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {PACKAGE_OPTIONS.map((pkg) => (
                  <Button
                    key={pkg}
                    variant={form.allowedPackages.includes(pkg) ? "default" : "outline"}
                    size="sm"
                    onClick={() => togglePackage(pkg)}
                  >
                    {pkg}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Empty = all packages allowed</p>
            </div>

            <div>
              <label className="text-sm font-medium">Credential Schema</label>
              <div className="space-y-2 mt-1">
                {form.credentialSchema.map((entry) => (
                  <div key={entry.key} className="flex items-center gap-2 text-sm bg-muted rounded px-3 py-2">
                    <span className="font-medium">{entry.key}</span>
                    <span className="text-muted-foreground">— {entry.label}</span>
                    {entry.secret && <Badge variant="outline" className="text-xs">secret</Badge>}
                    <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => removeCredentialField(entry.key)}>
                      <XCircle className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Key"
                    value={credFieldKey}
                    onChange={(e) => setCredFieldKey(e.target.value)}
                    className="w-28"
                  />
                  <Input
                    placeholder="Label"
                    value={credFieldLabel}
                    onChange={(e) => setCredFieldLabel(e.target.value)}
                    className="flex-1"
                  />
                  <label className="flex items-center gap-1 text-xs shrink-0">
                    <input type="checkbox" checked={credFieldSecret} onChange={(e) => setCredFieldSecret(e.target.checked)} />
                    Secret
                  </label>
                  <Button variant="outline" size="sm" onClick={addCredentialField}>Add</Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditing(null); }}>
              Cancel
            </Button>
            <Button
              onClick={() => (editing ? updateMutation.mutate() : createMutation.mutate())}
              disabled={!form.connectorKey || !form.connectorName || createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {editing ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
```

- [ ] **Step 2: Add route to `ui/src/App.tsx`**

In the `boardRoutes()` function, add after the existing routes (e.g., after the `activity` route):
```typescript
<Route path="connectors" element={<Connectors />} />
```

And add the import at the top:
```typescript
import { Connectors } from "./pages/Connectors";
```

- [ ] **Step 3: Add query key for connectors**

In `ui/src/lib/queryKeys.ts`, add a `connectors` key. Find the file and add:
```typescript
connectors: {
  all: ["connectors"] as const,
  forCompany: (companyId: string) => ["connectors", "company", companyId] as const,
},
```

- [ ] **Step 4: Commit**

```bash
git add ui/src/pages/Connectors.tsx ui/src/App.tsx ui/src/lib/queryKeys.ts
git commit -m "feat(ui): add Super Admin connectors management page"
```

---

## Task 4: Tenant Admin Connectors Enable/Disable Page

**Files:**
- Create: `ui/src/pages/CompanyConnectors.tsx`
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Create `ui/src/pages/CompanyConnectors.tsx`**

```typescript
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, CheckCircle2, XCircle, AlertCircle, Power, PowerOff, ExternalLink } from "lucide-react";
import { connectorsApi, type ConnectorWithStatus, type CredentialSchemaEntry } from "../api/connectors";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "../components/EmptyState";

export function CompanyConnectors() {
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { addToast } = useToastActions();
  const [enableTarget, setEnableTarget] = useState<ConnectorWithStatus | null>(null);
  const [credValues, setCredValues] = useState<Record<string, string>>({});

  const companyId = selectedCompany?.id;

  const { data: connectors, isLoading } = useQuery({
    queryKey: queryKeys.connectors.forCompany(companyId ?? ""),
    queryFn: () => connectorsApi.listForCompany(companyId!),
    enabled: !!companyId,
  });

  const enableMutation = useMutation({
    mutationFn: async () => {
      if (!companyId || !enableTarget) return;
      return connectorsApi.enable(companyId, enableTarget.id, {
        credentialValues: credValues,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors.forCompany(companyId ?? "") });
      setEnableTarget(null);
      setCredValues({});
      addToast({ variant: "success", title: "Connector enabled" });
    },
    onError: (err) => addToast({ variant: "error", title: String(err) }),
  });

  const disableMutation = useMutation({
    mutationFn: (connectorId: string) => {
      if (!companyId) throw new Error("no company");
      return connectorsApi.disable(companyId, connectorId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors.forCompany(companyId ?? "") });
      addToast({ variant: "success", title: "Connector disabled" });
    },
    onError: (err) => addToast({ variant: "error", title: String(err) }),
  });

  function openEnable(c: ConnectorWithStatus) {
    setEnableTarget(c);
    setCredValues({});
  }

  if (!companyId) {
    return (
      <div className="mx-auto max-w-4xl py-6 px-4">
        <EmptyState title="No company selected" description="Select a company to manage its connectors." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl py-6 px-4">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Connectors</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Enable MCP connectors to give your agents access to external tools and services.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !connectors?.length ? (
        <EmptyState
          title="No connectors available"
          description="Your instance admin hasn't configured any connectors yet."
        />
      ) : (
        <div className="space-y-3">
          {connectors.map((c) => (
            <div key={c.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{c.connectorName}</h3>
                    {c.enabled ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Enabled
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Available</Badge>
                    )}
                    {c.tenantConnector?.status === "failed" && (
                      <Badge variant="destructive">
                        <AlertCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    )}
                  </div>
                  {c.description && (
                    <p className="text-sm text-muted-foreground mt-1">{c.description}</p>
                  )}
                  {c.tenantConnector?.lastError && (
                    <p className="text-xs text-destructive mt-1">{c.tenantConnector.lastError}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-muted-foreground">Requires:</span>
                    {c.allowedPackages.length === 0 ? (
                      <Badge variant="outline" className="text-xs">All packages</Badge>
                    ) : (
                      c.allowedPackages.map((p) => (
                        <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>
                      ))
                    )}
                  </div>
                </div>
                <div className="ml-4 shrink-0">
                  {c.enabled ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => disableMutation.mutate(c.id)}
                      disabled={disableMutation.isPending}
                    >
                      <PowerOff className="h-4 w-4 mr-2" />
                      Disable
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => openEnable(c)}>
                      <Power className="h-4 w-4 mr-2" />
                      Enable
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!enableTarget} onOpenChange={(open) => { if (!open) setEnableTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enable {enableTarget?.connectorName}</DialogTitle>
            <DialogDescription>
              Provide the required credentials to connect to this service.
            </DialogDescription>
          </DialogHeader>

          {enableTarget && (
            <div className="space-y-4">
              {enableTarget.credentialSchema.length === 0 && (
                <p className="text-sm text-muted-foreground">No credentials required.</p>
              )}
              {enableTarget.credentialSchema.map((field) => (
                <div key={field.key}>
                  <label className="text-sm font-medium">
                    {field.label}
                    {field.required && <span className="text-destructive ml-1">*</span>}
                  </label>
                  <Input
                    type={field.secret ? "password" : "text"}
                    value={credValues[field.key] ?? ""}
                    onChange={(e) => setCredValues((v) => ({ ...v, [field.key]: e.target.value }))}
                    placeholder={field.label}
                  />
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEnableTarget(null)}>Cancel</Button>
            <Button
              onClick={() => enableMutation.mutate()}
              disabled={enableMutation.isPending}
            >
              {enableMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Enable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Add route to `ui/src/App.tsx`**

In the `boardRoutes()` function, add:
```typescript
<Route path="company/connectors" element={<CompanyConnectors />} />
```

And add the import at the top:
```typescript
import { CompanyConnectors } from "./pages/CompanyConnectors";
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/pages/CompanyConnectors.tsx ui/src/App.tsx ui/src/lib/queryKeys.ts
git commit -m "feat(ui): add tenant admin connectors enable/disable page"
```

---

## Task 5: Add Connectors Link to Instance Sidebar

**Files:**
- Modify: `ui/src/components/InstanceSidebar.tsx`

- [ ] **Step 1: Add connectors link to the InstanceSidebar**

In `ui/src/components/InstanceSidebar.tsx`, add a `Cable` icon import and a sidebar nav item for connectors. Add after the Adapters entry:

```typescript
import { Cable, Clock3, Cpu, FlaskConical, Puzzle, Settings, Shield, SlidersHorizontal, UserRoundPen } from "lucide-react";
```

Then add after the Adapters nav item:
```typescript
<SidebarNavItem to="/connectors" label="Connectors" icon={Cable} />
```

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/InstanceSidebar.tsx
git commit -m "feat(ui): add connectors link to instance sidebar"
```

---

## Task 6: Add Connectors Link to Company Settings Sidebar

**Files:**
- Modify: `ui/src/components/CompanySettingsSidebar.tsx`

- [ ] **Step 1: Find and modify the CompanySettingsSidebar**

Read the file first, then add a connectors link. The sidebar should have a link to `company/connectors`.

- [ ] **Step 2: Commit**

```bash
git add ui/src/components/CompanySettingsSidebar.tsx
git commit -m "feat(ui): add connectors link to company settings sidebar"
```

---

## Validation Checklist

Before marking done, verify:

- [ ] `control-plane` build succeeds: `cd control-plane && pnpm build`
- [ ] `ui` build succeeds: `cd ui && pnpm build` (or `tsc --noEmit`)
- [ ] CP enforce endpoint returns 200 for valid package_tier, 403 for "denied"
- [ ] Super Admin can create a connector via the UI
- [ ] Super Admin can edit and delete connectors via the UI
- [ ] Tenant Admin sees available connectors on the company connectors page
- [ ] Tenant Admin can enable a connector (supplying credentials if schema requires)
- [ ] Tenant Admin can disable a connector
- [ ] Failed handshake shows error state in the UI
- [ ] Sidebar links navigate to the correct pages
