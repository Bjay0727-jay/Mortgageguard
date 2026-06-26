import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { redactPayload, markOutboxDeadLetter, retryOutboxEvent } from "../lib/outbox";
import { processPendingOutboxEvents } from "../lib/outbox-processor";
import { buildDefaultHandlers } from "../lib/outbox-handlers";

export const outboxRoutes = new Hono<{ Bindings: Env }>();

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

function audit(c: any, user: any, partial: Record<string, unknown>) {
  return c.env.AUDIT_QUEUE.send({ entityType: "company", companyId: user.companyId, userId: user.userId, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString(), ...partial });
}

const redactEvent = (e: any) => ({ ...e, payload: redactPayload(e.payload) });

// ─── GET /api/v1/outbox — list + status summary (company-scoped) ───
outboxRoutes.get("/", requireCapability("viewOutbox"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const status = c.req.query("status") || null;
  const eventType = c.req.query("eventType") || null;
  const from = c.req.query("from") || null;
  const to = c.req.query("to") || null;
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);

  const events = await sql`
    SELECT * FROM event_outbox
    WHERE company_id = ${user.companyId}
      ${status ? sql`AND status = ${status}` : sql``}
      ${eventType ? sql`AND event_type = ${eventType}` : sql``}
      ${from ? sql`AND created_at >= ${from}` : sql``}
      ${to ? sql`AND created_at <= ${to}` : sql``}
    ORDER BY created_at DESC
    LIMIT ${limit}`;

  const counts = await sql`SELECT status, COUNT(*)::int AS n FROM event_outbox WHERE company_id = ${user.companyId} GROUP BY status`;
  const byStatus: Record<string, number> = {};
  for (const r of counts as any[]) byStatus[r.status] = Number(r.n);
  const summary = {
    pending: byStatus.pending ?? 0,
    processing: byStatus.processing ?? 0,
    processed: byStatus.processed ?? 0,
    failed: byStatus.failed ?? 0,
    deadLetter: byStatus.dead_letter ?? 0,
  };

  return c.json({ summary, events: (events as any[]).map(redactEvent) });
});

// ─── GET /api/v1/outbox/:id — single event (company-scoped, redacted) ───
outboxRoutes.get("/:id", requireCapability("viewOutbox"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const [event] = await sql`SELECT * FROM event_outbox WHERE id = ${c.req.param("id")} AND company_id = ${user.companyId}`;
  if (!event) return c.json({ error: "Outbox event not found" }, 404);
  return c.json({ event: redactEvent(event) });
});

// ─── POST /api/v1/outbox/process — run the processor (admin) ───
outboxRoutes.post("/process", requireCapability("processOutbox"),
  zValidator("json", z.object({ limit: z.number().int().min(1).max(200).optional(), eventTypes: z.array(z.string()).optional() }).optional()),
  async (c) => {
    const user = c.get("user");
    const sql = db(c.env);
    const body = c.req.valid("json") ?? {};
    const summary = await processPendingOutboxEvents(sql, buildDefaultHandlers(c.env), { limit: body.limit, eventTypes: body.eventTypes });
    await audit(c, user, { type: "outbox.processed", entityId: user.companyId, action: "process_outbox", details: summary });
    return c.json({ summary });
  });

// ─── POST /api/v1/outbox/:id/retry — reset an event to pending ───
outboxRoutes.post("/:id/retry", requireCapability("retryOutboxEvents"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const id = c.req.param("id");
  const event = await retryOutboxEvent(sql, id, user.companyId);
  if (!event) return c.json({ error: "Outbox event not found" }, 404);
  await audit(c, user, { type: "outbox.retried", entityId: id, action: "retry_outbox_event", details: { eventType: event.event_type } });
  return c.json({ event: redactEvent(event) });
});

// ─── POST /api/v1/outbox/:id/dead-letter — force dead-letter ───
outboxRoutes.post("/:id/dead-letter", requireCapability("deadLetterOutboxEvents"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const id = c.req.param("id");
  const [existing] = await sql`SELECT id FROM event_outbox WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!existing) return c.json({ error: "Outbox event not found" }, 404);
  await markOutboxDeadLetter(sql, id, "Manually dead-lettered");
  await audit(c, user, { type: "outbox.dead_lettered", entityId: id, action: "dead_letter_outbox_event", details: {} });
  return c.json({ deadLettered: true, id });
});
