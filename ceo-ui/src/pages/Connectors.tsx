import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cable,
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { connectorsApi, type Connector, type TestEndpointResult, type SyncResult } from "../api/connectors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "../components/EmptyState";
import { cn } from "../lib/utils";

type TestState = "idle" | "testing" | "done";

function ConnectorFormDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Connector | null;
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [testState, setTestState] = useState<TestState>("idle");
  const [testResult, setTestResult] = useState<TestEndpointResult | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => connectorsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      onOpenChange(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      connectorsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      onOpenChange(false);
    },
  });

  async function handleTest() {
    const form = formRef.current;
    if (!form) return;
    const elements = form.elements as any;
    const endpointUrl = (elements.namedItem("endpoint_url")?.value ?? "").trim();
    const authType = (elements.namedItem("auth_type")?.value ?? "").trim() || null;
    const configRaw = (elements.namedItem("configuration")?.value ?? "").trim() || null;

    let configuration: Record<string, unknown> | null = null;
    if (configRaw) {
      try {
        configuration = JSON.parse(configRaw);
      } catch {
        setTestResult({ ok: false, error: "Configuration must be valid JSON" });
        setTestState("done");
        return;
      }
    }

    setTestState("testing");
    setTestResult(null);
    const res = await connectorsApi.testEndpoint({ endpointUrl, authType, configuration });
    setTestResult(res);
    setTestState("done");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const form = formRef.current;
    if (!form) return;
    const elements = form.elements as any;
    const data: Record<string, unknown> = {
      connectorKey: (elements.namedItem("connector_key")?.value ?? "").trim(),
      connectorName: (elements.namedItem("connector_name")?.value ?? "").trim(),
      description: (elements.namedItem("description")?.value ?? "").trim() || null,
      endpointUrl: (elements.namedItem("endpoint_url")?.value ?? "").trim() || null,
      authType: (elements.namedItem("auth_type")?.value ?? "").trim() || null,
    };
    const configRaw = (elements.namedItem("configuration")?.value ?? "").trim();
    if (configRaw) {
      try { data.credentialSchema = JSON.parse(configRaw); } catch { /* ignore */ }
    }
    if (editing) {
      updateMutation.mutate({ id: editing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Connector" : "New Connector"}</DialogTitle>
          <DialogDescription>
            Configure an MCP connector endpoint and authentication.
          </DialogDescription>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium" htmlFor="connector_key">Key</label>
              <Input
                id="connector_key"
                name="connector_key"
                defaultValue={editing?.connectorKey ?? ""}
                placeholder="my_connector"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium" htmlFor="connector_name">Name</label>
              <Input
                id="connector_name"
                name="connector_name"
                defaultValue={editing?.connectorName ?? ""}
                placeholder="My Connector"
                required
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium" htmlFor="description">
              Description <span className="text-muted-foreground/70">(optional)</span>
            </label>
            <Input
              id="description"
              name="description"
              defaultValue={editing?.description ?? ""}
              placeholder="What does this connector do?"
            />
          </div>
          <div>
            <label className="text-xs font-medium" htmlFor="endpoint_url">Endpoint URL</label>
            <div className="flex items-center gap-2">
              <Input
                id="endpoint_url"
                name="endpoint_url"
                defaultValue={editing?.endpointUrl ?? ""}
                placeholder="https://example.com/mcp"
                className="flex-1"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={testState === "testing"}
                onClick={handleTest}
              >
                {testState === "testing" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    Testing…
                  </>
                ) : (
                  "Test Connection"
                )}
              </Button>
            </div>
            {testState === "testing" && (
              <p className="mt-1 text-[11px] text-muted-foreground">Connecting…</p>
            )}
            {testState === "done" && testResult && (
              <div
                className={cn(
                  "mt-2 rounded-md border p-2 text-xs",
                  testResult.ok
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
                    : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
                )}
              >
                {testResult.ok ? (
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-medium">Connected — {testResult.tools?.length ?? 0} tools</span>
                      {testResult.tools && testResult.tools.length > 0 && (
                        <div className="mt-1 max-h-24 overflow-y-auto space-y-0.5">
                          {testResult.tools.map((tool) => (
                            <div key={tool.name} className="font-mono text-[10px]">
                              {tool.name}
                              {tool.description ? <span className="text-muted-foreground ml-1">— {tool.description}</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{testResult.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-medium" htmlFor="auth_type">Auth Type</label>
            <select
              id="auth_type"
              name="auth_type"
              defaultValue={editing?.authType ?? "none"}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none"
            >
              <option value="none">None</option>
              <option value="apikey">API Key</option>
              <option value="bearer">Bearer Token</option>
              <option value="basic">Basic Auth</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium" htmlFor="configuration">
              Configuration (JSON) <span className="text-muted-foreground/70">(optional)</span>
            </label>
            <Textarea
              id="configuration"
              name="configuration"
              defaultValue={
                editing?.credentialSchema && editing.credentialSchema.length > 0
                  ? JSON.stringify(editing.credentialSchema, null, 2)
                  : ""
              }
              rows={3}
              className="min-w-0 overflow-x-hidden break-all font-mono text-xs"
              placeholder='{ "apiKey": "...", "headerName": "X-API-Key" }'
            />
          </div>
          {createMutation.isError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {(createMutation.error as Error).message}
            </p>
          )}
          {updateMutation.isError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {(updateMutation.error as Error).message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Connectors() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Connector | null>(null);

  const connectorsQuery = useQuery({
    queryKey: ["connectors"],
    queryFn: () => connectorsApi.list(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => connectorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      setDeleteConfirm(null);
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => connectorsApi.sync(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
    },
  });

  const connectors = connectorsQuery.data ?? [];

  function openNew() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(connector: Connector) {
    setEditing(connector);
    setDialogOpen(true);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Cable className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Connectors</h1>
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={openNew} size="sm">
          <Plus className="h-3.5 w-3.5 mr-1" /> New Connector
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {connectorsQuery.isError ? (
          <div className="text-sm text-destructive flex items-center gap-2 py-4">
            <AlertCircle className="h-4 w-4" /> Failed to load connectors:{" "}
            {(connectorsQuery.error as Error).message}
            <Button variant="ghost" size="sm" onClick={() => connectorsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : connectors.length === 0 && !connectorsQuery.isPending ? (
          <EmptyState
            icon={Cable}
            message="No connectors yet. Create your first MCP connector."
            action="New Connector"
            onAction={openNew}
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Key</th>
                <th className="px-2 py-2 text-left font-medium">Name</th>
                <th className="px-2 py-2 text-left font-medium">Endpoint</th>
                <th className="px-2 py-2 text-left font-medium">Auth</th>
                <th className="px-2 py-2 text-left font-medium">Status</th>
                <th className="px-2 py-2 text-left font-medium">Tested</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {connectors.map((connector) => (
                <tr
                  key={connector.id}
                  className="border-b border-border/60 hover:bg-accent/40 cursor-pointer"
                  onClick={() => openEdit(connector)}
                >
                  <td className="px-3 py-2.5 font-mono text-xs">{connector.connectorKey}</td>
                  <td className="px-2 py-2.5 font-medium">{connector.connectorName}</td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground max-w-[200px] truncate">
                    {connector.endpointUrl ?? "—"}
                  </td>
                  <td className="px-2 py-2.5 text-xs">{connector.authType ?? "none"}</td>
                  <td className="px-2 py-2.5">
                    <span
                      className={cn(
                        "text-xs font-medium",
                        connector.status === "active"
                          ? "text-emerald-700 dark:text-emerald-300"
                          : "text-muted-foreground",
                      )}
                    >
                      {connector.status}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 text-xs text-muted-foreground">
                    {connector.lastTestedAt
                      ? new Date(connector.lastTestedAt).toLocaleDateString()
                      : "never"}
                    {connector.lastError && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400" title={connector.lastError}>
                        <AlertCircle className="inline h-3 w-3" />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mr-1"
                      disabled={syncMutation.isPending && syncMutation.variables === connector.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        syncMutation.mutate(connector.id);
                      }}
                    >
                      {syncMutation.isPending && syncMutation.variables === connector.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(connector);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ConnectorFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
      />

      <Dialog
        open={Boolean(deleteConfirm)}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete connector</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteConfirm?.connectorName}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
