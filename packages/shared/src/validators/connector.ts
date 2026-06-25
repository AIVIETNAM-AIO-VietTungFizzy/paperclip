import { z } from "zod";

const credentialSchemaEntrySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  secret: z.boolean().optional(),
  required: z.boolean().optional(),
});

export const createConnectorSchema = z.object({
  connectorKey: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/, "Must be a lowercase slug (a-z, 0-9, _, -)"),
  connectorName: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  endpointUrl: z.string().url().optional().nullable(),
  hostingMode: z.enum(["remote", "provisioned"]).optional().default("remote"),
  authType: z.string().optional().nullable(),
  credentialSchema: z.array(credentialSchemaEntrySchema).optional().default([]),
  allowedPackages: z.array(z.string()).optional().default([]),
}).strict();
export type CreateConnector = z.infer<typeof createConnectorSchema>;

export const updateConnectorSchema = z.object({
  connectorName: z.string().min(1).max(255).optional(),
  description: z.string().optional().nullable(),
  endpointUrl: z.string().url().optional().nullable(),
  hostingMode: z.enum(["remote", "provisioned"]).optional(),
  authType: z.string().optional().nullable(),
  credentialSchema: z.array(credentialSchemaEntrySchema).optional(),
  allowedPackages: z.array(z.string()).optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).strict();
export type UpdateConnector = z.infer<typeof updateConnectorSchema>;

export const enableConnectorSchema = z.object({
  credentialValues: z.record(z.string(), z.string()).optional().default({}),
  namespace: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
}).strict();
export type EnableConnector = z.infer<typeof enableConnectorSchema>;

export const updateTenantConnectorSchema = z.object({
  credentialValues: z.record(z.string(), z.string()).optional(),
  namespace: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
}).strict();
export type UpdateTenantConnector = z.infer<typeof updateTenantConnectorSchema>;

export const setToolEnabledSchema = z.object({
  enabled: z.boolean(),
}).strict();
export type SetToolEnabled = z.infer<typeof setToolEnabledSchema>;
