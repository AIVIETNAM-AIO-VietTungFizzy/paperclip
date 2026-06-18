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
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestEndpointResult {
  ok: boolean;
  tools?: { name: string; description?: string }[];
  error?: string;
}

export const connectorsApi = {
  list: () => api.get<Connector[]>("/admin/connectors"),
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
};
