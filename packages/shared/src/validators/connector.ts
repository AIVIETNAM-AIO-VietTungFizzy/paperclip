import { z } from "zod";

const credentialSchemaEntrySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  secret: z.boolean().optional(),
  required: z.boolean().optional(),
});

const SECRET_REF_RE = /^secret:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const credentialValueSchema = z
  .string()
  .min(1, "Credential value must be a non-empty string")
  .refine(
    (value) => {
      if (value.startsWith("secret:")) return SECRET_REF_RE.test(value);
      return true;
    },
    "secret: references must use the form secret:<uuid>",
  );

const credentialValuesRecordSchema = z.record(z.string(), credentialValueSchema);

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
  credentialValues: credentialValuesRecordSchema.optional().default({}),
  namespace: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
}).strict();
export type EnableConnector = z.infer<typeof enableConnectorSchema>;

export const updateTenantConnectorSchema = z.object({
  credentialValues: credentialValuesRecordSchema.optional(),
  namespace: z.string().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
}).strict();
export type UpdateTenantConnector = z.infer<typeof updateTenantConnectorSchema>;

export const toggleConnectorToolSchema = z.object({
  enabled: z.boolean(),
}).strict();
export type ToggleConnectorTool = z.infer<typeof toggleConnectorToolSchema>;
