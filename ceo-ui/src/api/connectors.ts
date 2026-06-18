import type { CreateConnector, UpdateConnector } from "@paperclipai/shared";
import { api } from "./client";

export interface ConnectorRecord {
  id: string;
  connectorKey: string;
  connectorName: string;
  description: string | null;
  endpointUrl: string | null;
  hostingMode: string;
  authType: string | null;
  credentialSchema: Array<{ key: string; label: string; secret?: boolean; required?: boolean }>;
  allowedPackages: string[];
  provisionSpec: Record<string, unknown> | null;
  capabilities: Record<string, unknown> | null;
  status: string;
  lastTestedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TenantConnectorRecord {
  id: string;
  tenantId: string;
  connectorId: string;
  status: string;
  credentialRefs: Record<string, string>;
  resolvedEndpoint: string | null;
  namespace: string;
  lastHandshakeAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyConnectorRecord extends ConnectorRecord {
  enabled: boolean;
  tenantConnector: TenantConnectorRecord | null;
}

export const connectorsApi = {
  list: () => api.get<ConnectorRecord[]>("/connectors"),

  get: (id: string) => api.get<ConnectorRecord>(`/connectors/${id}`),

  create: (input: CreateConnector) =>
    api.post<ConnectorRecord>("/connectors", input),

  update: (id: string, input: UpdateConnector) =>
    api.patch<ConnectorRecord>(`/connectors/${id}`, input),

  delete: (id: string) => api.delete<{ ok: boolean }>(`/connectors/${id}`),

  testEndpoint: (id: string) =>
    api.post<{ ok: boolean }>(`/connectors/${id}/test`),

  listForCompany: (companyId: string) =>
    api.get<CompanyConnectorRecord[]>(`/companies/${companyId}/connectors`),

  enableForCompany: (
    companyId: string,
    connectorId: string,
    input?: { namespace?: string; credentialValues?: Record<string, string> },
  ) =>
    api.post<{ id: string; status: string; error?: string }>(
      `/companies/${companyId}/connectors/${connectorId}/enable`,
      input ?? {},
    ),

  updateTenantConnector: (
    companyId: string,
    connectorId: string,
    input: { namespace?: string },
  ) =>
    api.patch<TenantConnectorRecord>(
      `/companies/${companyId}/connectors/${connectorId}`,
      input,
    ),

  disableForCompany: (companyId: string, connectorId: string) =>
    api.post<{ status: string }>(
      `/companies/${companyId}/connectors/${connectorId}/disable`,
    ),
};
