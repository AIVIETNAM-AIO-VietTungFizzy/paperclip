# Gmail MCP Connector — Design Spec

**Issue:** TUN-90
**Date:** 2026-06-17
**Status:** Approved

## Overview

Create a Gmail MCP connector that can be registered in the Paperclip connector catalog. The connector exposes Gmail API tools (send, read, search, manage labels) via the MCP protocol, authenticated through per-tenant OAuth2 credentials.

## Architecture

Management Server
  Connector Gateway (connector-gateway.ts)
    Routes /api/runtime/mcp-sdk/*
    Proxies tool calls to connector MCP servers
  Connector Client Pool (connector-client-pool.ts)
    Manages MCP client connections

Gmail MCP Server (packages/gmail-mcp-server/)
  Standalone MCP server
  Exposes 5 Gmail tools via @modelcontextprotocol
  Authenticates via Google OAuth2 (per-tenant)
  Uses googleapis Node.js client

## Tools

| Tool | Description | Key Inputs |
|------|-------------|------------|
| gmail_send | Send an email | to, subject, body, cc?, bcc? |
| gmail_list | List inbox messages | maxResults?, labelIds?, query? |
| gmail_get | Get a single message by ID | id, format? |
| gmail_search | Search messages with Gmail query syntax | query, maxResults? |
| gmail_labels | List all labels | — |

## Credential Schema

Stored in connectors.credential_schema (JSONB):
  client_id: OAuth2 Client ID
  client_secret: OAuth2 Client Secret (secret)
  refresh_token: OAuth2 Refresh Token (secret)

## Connector Registration

A seed row in the connectors table with key gmail, name Gmail, auth type oauth2, allowed on starter/growth/enterprise packages.

## Implementation Phases

1. Gmail MCP Server Package (scaffold, auth, gmail API, tools, entry point)
2. Management Server Gateway (client pool, gateway routes, mount)
3. Internal API Routes (enabled-connectors, connector-by-namespace)
4. Real MCP Handshake (update handshake service with SDK Client)
5. Seed Data (register Gmail connector in catalog)
6. TypeScript fixes and validation
