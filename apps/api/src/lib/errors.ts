// ─────────────────────────────────────────────────────
// MortgageGuard — Consistent Error Responses
// ─────────────────────────────────────────────────────
import type { Context } from "hono";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function notFound(resource = "Resource") {
  return new AppError(404, `${resource} not found`, "NOT_FOUND");
}

export function forbidden(message = "Insufficient permissions") {
  return new AppError(403, message, "FORBIDDEN");
}

export function badRequest(message: string) {
  return new AppError(400, message, "BAD_REQUEST");
}

export function conflict(message: string) {
  return new AppError(409, message, "CONFLICT");
}

export function errorResponse(c: Context, err: AppError) {
  return c.json(
    {
      error: err.message,
      code: err.code,
      requestId: c.req.header("cf-ray") || "unknown",
    },
    err.statusCode as any,
  );
}
