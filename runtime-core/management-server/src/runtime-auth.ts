import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export class RuntimeAuthError extends Error {
  status: number;
  constructor(message = "runtime_service_token_required", status = 401) {
    super(message);
    this.status = status;
  }
}

export function requireRuntimeAuth(req: Request): void {
  const expectedToken = process.env.RUNTIME_SERVICE_TOKEN;
  if (!expectedToken) {
    throw new RuntimeAuthError();
  }

  const serviceToken = req.header("x-service-token");
  if (!serviceToken) {
    throw new RuntimeAuthError();
  }

  const expected = Buffer.from(expectedToken);
  const provided = Buffer.from(serviceToken);

  if (expected.length !== provided.length) {
    throw new RuntimeAuthError();
  }

  if (!timingSafeEqual(expected, provided)) {
    throw new RuntimeAuthError();
  }
}

export function handleRuntimeAuthError(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof RuntimeAuthError) {
    return { status: err.status, body: { error: err.message } };
  }
  const e = err as { status?: number; message?: string };
  if (e && (e.status === 401 || e.message === "runtime_service_token_required")) {
    return { status: e.status ?? 401, body: { error: e.message ?? "runtime_service_token_required" } };
  }
  return null;
}