// ─────────────────────────────────────────────────────
// MortgageGuard API — Hono on Cloudflare Workers
// Entry point for all API routes + queue consumers
// ─────────────────────────────────────────────────────
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { prettyJSON } from "hono/pretty-json";

import type { Env, ComplianceEvent, AuditEvent } from "./env";
import { authMiddleware } from "./middleware/auth";
import { rateLimit } from "./middleware/rate-limit";
import { loanRoutes } from "./routes/loans";
import { complianceRoutes } from "./routes/compliance";
import { documentRoutes } from "./routes/documents";
import { programRoutes } from "./routes/programs";
import { reportRoutes } from "./routes/reports";
import { integrationRoutes } from "./routes/integrations";
import { authRoutes } from "./routes/auth";
import { processComplianceEvent } from "./services/compliance-engine";
import { processAuditEvent } from "./services/audit-trail";
import { AppError } from "./lib/errors";

// ─── App Setup ───
const app = new Hono<{ Bindings: Env }>();

// ─── Global Middleware ───
app.use("*", cors({
  origin: (origin, c) => {
    const allowed = [
      "https://mortgageguard.com",
      "https://app.mortgageguard.com",
      "https://mortgageguard-web.stanley-riley.workers.dev",
    ];
    if (c.env.ENVIRONMENT !== "production") {
      allowed.push("http://localhost:3000");
    }
    return allowed.includes(origin) ? origin : null;
  },
  credentials: true,
}));
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", prettyJSON());

// ─── Health Check ───
app.get("/health", (c) => c.json({ status: "ok", service: "mortgageguard-api", timestamp: new Date().toISOString() }));

app.get("/ready", async (c) => {
  try {
    // Verify Hyperdrive connection
    const sql = await import("postgres").then(m => m.default(c.env.HYPERDRIVE.connectionString, { max: 1 }));
    await sql`SELECT 1`;
    return c.json({ status: "ready", database: "connected" });
  } catch (err) {
    return c.json({ status: "not_ready", database: "disconnected" }, 503);
  }
});

// ─── Public Routes (no auth, rate-limited) ───
app.use("/api/v1/auth/*", rateLimit({ windowMs: 60_000, maxRequests: 20, keyPrefix: "rl:auth" }));
app.route("/api/v1/auth", authRoutes);

// ─── Protected Routes ───
app.use("/api/v1/*", authMiddleware);
app.route("/api/v1/loans", loanRoutes);
app.route("/api/v1/compliance", complianceRoutes);
app.route("/api/v1/documents", documentRoutes);
app.route("/api/v1/programs", programRoutes);
app.route("/api/v1/reports", reportRoutes);
app.route("/api/v1/integrations", integrationRoutes);

// ─── 404 Handler ───
app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

// ─── Error Handler ───
app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json({
      error: err.message,
      code: err.code,
      requestId: c.req.header("cf-ray") || "unknown",
    }, err.statusCode as any);
  }

  console.error(`[ERROR] ${err.message}`, err.stack);
  return c.json({
    error: c.env.ENVIRONMENT === "production" ? "Internal server error" : err.message,
    requestId: c.req.header("cf-ray") || "unknown",
  }, 500);
});

// ─── Export for Workers ───
export default {
  // HTTP handler
  fetch: app.fetch,

  // Queue consumer: compliance events
  async queue(batch: MessageBatch<ComplianceEvent | AuditEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (batch.queue === "compliance-events") {
          await processComplianceEvent(message.body as ComplianceEvent, env);
        } else if (batch.queue === "audit-events") {
          await processAuditEvent(message.body as AuditEvent, env);
        }
        message.ack();
      } catch (err) {
        console.error(`[QUEUE ERROR] ${err}`);
        message.retry();
      }
    }
  },
};
