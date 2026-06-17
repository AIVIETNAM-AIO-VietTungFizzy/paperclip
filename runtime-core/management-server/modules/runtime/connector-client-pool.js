import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT_TIMEOUT_MS = 10_000;
export const CONNECTOR_TIMEOUT_MS = 30_000;
const IDLE_CLEANUP_INTERVAL_MS = 60_000;
const CLIENT_TTL_MS = 5 * 60_000;

/**
 * Manages a pool of MCP client connections, one per (tenantId, connectorKey).
 * Lazily connects on first use, caches the client, and cleans up idle
 * connections after TTL expiry.
 */
export class ConnectorClientPool {
  constructor(opts = {}) {
    this._clients = new Map();
    this._timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._idleCleanupIntervalMs = opts.idleCleanupIntervalMs ?? IDLE_CLEANUP_INTERVAL_MS;
    this._clientTtlMs = opts.clientTtlMs ?? CLIENT_TTL_MS;
    this._cleanupTimer = null;
    this._startCleanupTimer();
  }

  _poolKey(tenantId, connectorKey) {
    return `${tenantId}::${connectorKey}`;
  }

  async getOrCreateClient(tenantId, connectorKey, endpointUrl, headers) {
    const key = this._poolKey(tenantId, connectorKey);
    const existing = this._clients.get(key);
    if (existing && !existing._closed) {
      existing._lastUsed = Date.now();
      return existing.client;
    }

    const transport = new StreamableHTTPClientTransport(new URL(endpointUrl), {
      requestInit: headers ? { headers } : undefined,
    });

    const client = new Client(
      { name: "paperclip-connector-pool", version: "1.0.0" },
      { capabilities: {} },
    );

    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this._timeoutMs);

    try {
      await client.connect(transport);
    } finally {
      clearTimeout(timeout);
    }

    const entry = { client, transport, _lastUsed: Date.now(), _closed: false };
    this._clients.set(key, entry);
    return client;
  }

  async releaseClient(tenantId, connectorKey) {
    const key = this._poolKey(tenantId, connectorKey);
    const entry = this._clients.get(key);
    if (!entry) return;

    entry._closed = true;
    this._clients.delete(key);
    try {
      await entry.client.close();
    } catch {
      // Ignore close errors
    }
  }

  async releaseAll() {
    const keys = Array.from(this._clients.keys());
    await Promise.all(keys.map((k) => this._releaseByKey(k)));
  }

  async _releaseByKey(key) {
    const entry = this._clients.get(key);
    if (!entry) return;
    entry._closed = true;
    this._clients.delete(key);
    try {
      await entry.client.close();
    } catch {
      // Ignore close errors
    }
  }

  _startCleanupTimer() {
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this._clients.entries()) {
        if (now - entry._lastUsed > this._clientTtlMs) {
          this._releaseByKey(key);
        }
      }
    }, this._idleCleanupIntervalMs);

    if (this._cleanupTimer.unref) {
      this._cleanupTimer.unref();
    }
  }

  teardown() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    return this.releaseAll();
  }
}
