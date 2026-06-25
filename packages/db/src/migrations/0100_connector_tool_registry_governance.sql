-- Migration: 0100_connector_tool_registry_governance
-- Adds per-tool governance columns so connector tools can be policy-matrix
-- governed (risk_class / approval_class / requires_approval) and tracked as
-- pending-approval (pending) when discovered but not yet explicitly enabled.

ALTER TABLE connector_tool_registry
  ADD COLUMN IF NOT EXISTS risk_class        varchar(20),
  ADD COLUMN IF NOT EXISTS approval_class   varchar(10),
  ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS enabled           boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pending           boolean NOT NULL DEFAULT false;
