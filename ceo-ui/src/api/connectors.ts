import { api } from "./client";

export interface Connector {
  id: string;
  connectorKey: string;
  connectorName: string;
  description: string | null;
  endpointUrl: string | null;
  hostingMode: string;
  authType: string | null;
  credentialSchema: unknown[];
  allowedPackages: string[];
  capabilities: Record<string, unknown> | null;
  status: string;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncResult {
  ok: boolean;
  added?: string[];
  removed?: string[];
  tools?: { name: string; description?: string }[];
  error?: string;
}

export interface TestEndpointResult {
  ok: boolean;
  tools?: { name: string; description?: string }[];
  error?: string;
}

export interface ConnectorTool {
  name: string;
  description?: string;
}

export interface ConnectorRegistryTool {
  id: string;
  tenantConnectorId: string;
  toolName: string;
  namespacedName: string;
  description: string | null;
  enabled: boolean;
  pending: boolean;
  riskClass: string | null;
  approvalClass: string | null;
  requiresApproval: boolean;
}

export interface CompanyConnector extends Connector {
  enabled: boolean;
  tenantConnector: { id: string; tenantId: string; connectorId: string; status: string; namespace: string } | null;
  tools: ConnectorRegistryTool[];
}

export const connectorsApi = {
  list: () => api.get<Connector[]>("/admin/connectors"),
  listForCompany: (companyId: string) =>
    api.get<CompanyConnector[]>(`/admin/companies/${companyId}/connectors`),
  get: (id: string) => api.get<Connector>(`/admin/connectors/${id}`),
  create: (data: Record<string, unknown>) =>
    api.post<Connector>("/admin/connectors", data),
  update: (id: string, data: Record<string, unknown>) =>
    api.patch<Connector>(`/admin/connectors/${id}`, data),
  delete: (id: string) => api.delete<void>(`/admin/connectors/${id}`),
  testEndpoint: (params: {
    endpointUrl: string;
    authType: string | null;
    configuration: Record<string, unknown> | null;
  }) => api.post<TestEndpointResult>("/admin/connectors/test-endpoint", params),
  sync: (id: string) => api.post<SyncResult>(`/admin/connectors/${id}/sync`, {}),
  setToolEnabled: (
    tenantId: string,
    connectorId: string,
    toolId: string,
    enabled: boolean,
  ) =>
    api.patch<{ ok: boolean; tool: { id: string; enabled: boolean } }>(
      `/admin/companies/${tenantId}/connectors/${connectorId}/tools/${toolId}`,
      { enabled },
    ),
};
