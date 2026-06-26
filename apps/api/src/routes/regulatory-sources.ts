import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { tryCreateOutboxEvent } from "../lib/outbox";

export const regulatorySourceRoutes = new Hono<{ Bindings: Env }>();

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

const DEFAULT_VERIFICATION_DAYS = 180;

function audit(c: any, user: any, partial: Record<string, unknown>) {
  return c.env.AUDIT_QUEUE.send({
    entityType: "regulatory_source",
    companyId: user.companyId,
    userId: user.userId,
    ipAddress: c.req.header("cf-connecting-ip") || "unknown",
    timestamp: new Date().toISOString(),
    ...partial,
  });
}

// Derive a display verification status: a source past its next-verification date
// is treated as review_due regardless of its stored status.
function withDerivedStatus(row: any) {
  let verificationStatus = row.verification_status;
  if (row.next_verification_due_at && new Date(row.next_verification_due_at).getTime() < Date.now() && verificationStatus === "verified") {
    verificationStatus = "review_due";
  }
  return { ...row, verificationStatus, sourceKey: row.source_key };
}

// ─── List all registry sources ───
regulatorySourceRoutes.get("/", requireCapability("viewRegulatorySources"), async (c) => {
  const sql = db(c.env);
  const sources = await sql`SELECT * FROM regulatory_sources ORDER BY jurisdiction, citation`;
  return c.json({ sources: sources.map(withDerivedStatus) });
});

// ─── Single source ───
regulatorySourceRoutes.get("/:id", requireCapability("viewRegulatorySources"), async (c) => {
  const sql = db(c.env);
  const id = c.req.param("id");
  const [source] = await sql`SELECT * FROM regulatory_sources WHERE id = ${id}`;
  if (!source) return c.json({ error: "Source not found" }, 404);
  return c.json({ source: withDerivedStatus(source) });
});

// ─── Manually mark a source verified ───
const markVerifiedSchema = z.object({
  notes: z.string().max(2000).optional(),
  nextVerificationDueAt: z.string().optional(),
});
regulatorySourceRoutes.post("/:id/mark-verified", requireCapability("verifyRegulatorySources"), zValidator("json", markVerifiedSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const sql = db(c.env);
  const [existing] = await sql`SELECT id FROM regulatory_sources WHERE id = ${id}`;
  if (!existing) return c.json({ error: "Source not found" }, 404);

  const nextDue = body.nextVerificationDueAt
    ? new Date(body.nextVerificationDueAt).toISOString()
    : new Date(Date.now() + DEFAULT_VERIFICATION_DAYS * 86_400_000).toISOString();

  const [source] = await sql`
    UPDATE regulatory_sources
    SET last_verified_at = NOW(), verification_status = 'verified', next_verification_due_at = ${nextDue},
        notes = COALESCE(${body.notes || null}, notes), updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  await audit(c, user, { type: "regulatory_source.verified", entityId: id, action: "verify_regulatory_source", details: { sourceKey: source.source_key, nextVerificationDueAt: nextDue } });
  await tryCreateOutboxEvent(sql, { companyId: user.companyId, eventType: "regulatory_source.verified", aggregateType: "regulatory_source", aggregateId: id, idempotencyKey: `source:${id}:verified:${nextDue}`, payload: { sourceKey: source.source_key, nextVerificationDueAt: nextDue, actorUserId: user.userId } });
  return c.json({ source: withDerivedStatus(source) });
});
