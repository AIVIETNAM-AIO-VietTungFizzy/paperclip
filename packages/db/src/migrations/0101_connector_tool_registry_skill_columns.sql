-- Migration: 0101_connector_tool_registry_skill_columns
-- LLG-4.3: Promote card.skills -> structured connector_tool_registry.
-- Adds skill-discriminator and structured skill metadata columns so A2A Agent
-- Card skills and MCP-agent tools (where tools already are the skills) share one
-- registry table. `tool_type` discriminates a plain MCP tool ("tool") from a
-- promoted A2A skill ("skill"); the skill_* columns carry the structured skill
-- object (id/name/description/IO modes/tags) sourced from the Agent Card's
-- skills[], replacing the earlier free-form card.skills:[strings].

ALTER TABLE connector_tool_registry
  ADD COLUMN IF NOT EXISTS tool_type         varchar(16) NOT NULL DEFAULT 'tool',
  ADD COLUMN IF NOT EXISTS skill_id          text,
  ADD COLUMN IF NOT EXISTS skill_name        text,
  ADD COLUMN IF NOT EXISTS skill_description text,
  ADD COLUMN IF NOT EXISTS input_modes       text[],
  ADD COLUMN IF NOT EXISTS output_modes      text[],
  ADD COLUMN IF NOT EXISTS tags              text[];