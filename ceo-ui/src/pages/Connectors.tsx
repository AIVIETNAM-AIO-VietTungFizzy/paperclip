import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Plug, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { connectorsApi, type Connector, type TestEndpointResult } from "../api/connectors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "../lib/utils";

export function Connectors() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingConnector, setEditingConnector] = useState<Connector | null>(null);

  const { data: connectors, isLoading } = useQuery({
    queryKey: ["connectors"],
    queryFn: () => connectorsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => connectorsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      setDialogOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      connectorsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
      setDialogOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => connectorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] });
    },
  });

  function openCreate() {
    setEditingConnector(null);
    setDialogOpen(true);
  }

  function openEdit(connector: Connector) {
    setEditingConnector(connector);
    setDialogOpen(true);
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Connectors</h1>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          New Connector
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : connectors && connectors.length > 0 ? (
        <div className="space-y-2">
          {connectors.map((connector) => (
            <div
              key={connector.id}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-center gap-3">
                <Plug className="h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="font-medium">{connector.connectorName}</div>
                  <div className="text-sm text-muted-foreground">{connector.connectorKey}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => openEdit(connector)}>
                  Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => deleteMutation.mutate(connector.id)}
                >
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No connectors yet. Create one to get started.
        </div>
      )}

      {dialogOpen && (
        <ConnectorFormDialog
          connector={editingConnector}
          onSave={(data) => {
            if (editingConnector) {
              updateMutation.mutate({ id: editingConnector.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          onClose={() => setDialogOpen(false)}
          saving={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
}

function ConnectorFormDialog({
  connector,
  onSave,
  onClose,
  saving,
}: {
  connector: Connector | null;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [testState, setTestState] = useState<"idle" | "testing" | "done">("idle");
  const [testResult, setTestResult] = useState<TestEndpointResult | null>(null);

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
      try {
        data.credentialSchema = JSON.parse(configRaw);
      } catch {
        return;
      }
    }
    onSave(data);
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{connector ? "Edit Connector" : "New Connector"}</DialogTitle>
        </DialogHeader>
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Connector Key</label>
            <Input
              name="connector_key"
              defaultValue={connector?.connectorKey ?? ""}
              placeholder="e.g. my-connector"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Connector Name</label>
            <Input
              name="connector_name"
              defaultValue={connector?.connectorName ?? ""}
              placeholder="e.g. My Connector"
              required
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Textarea
              name="description"
              defaultValue={connector?.description ?? ""}
              placeholder="Optional description"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Endpoint URL</label>
            <Input
              name="endpoint_url"
              defaultValue={connector?.endpointUrl ?? ""}
              placeholder="https://example.com/mcp"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={testState === "testing"}
              onClick={handleTest}
            >
              {testState === "testing" ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {testState === "testing"
                ? "Connecting..."
                : "probes this endpoint with current auth"}
            </span>
          </div>

          {testResult && (
            <div
              className={cn(
                "rounded-md border p-3 text-sm",
                testResult.ok
                  ? "border-green-500/50 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                  : "border-red-500/50 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
              )}
            >
              {testResult.ok ? (
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">
                      Connected &mdash; {testResult.tools?.length ?? 0} tools
                    </p>
                    {testResult.tools && testResult.tools.length > 0 && (
                      <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-xs">
                        {testResult.tools.map((t) => (
                          <li key={t.name}>
                            <code className="font-mono">{t.name}</code>
                            {t.description && (
                              <span className="ml-1 text-muted-foreground">
                                &mdash; {t.description}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-medium">Connection failed</p>
                    <p className="mt-0.5 text-xs">{testResult.error}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Auth Type</label>
            <Select name="auth_type" defaultValue={connector?.authType ?? "none"}>
              <SelectTrigger>
                <SelectValue placeholder="Select auth type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="apikey">API Key</SelectItem>
                <SelectItem value="bearer">Bearer Token</SelectItem>
                <SelectItem value="basic">Basic Auth</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Configuration (JSON)</label>
            <Textarea
              name="configuration"
              defaultValue={
                connector?.credentialSchema
                  ? JSON.stringify(connector.credentialSchema, null, 2)
                  : ""
              }
              placeholder='{"apiKey": "xxx", "headerName": "X-API-Key"}'
              className="font-mono text-xs"
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : connector ? (
                "Update"
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
