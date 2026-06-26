import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { tryCreateOutboxEvent } from "../lib/outbox";

export const companyRoutes = new Hono<{ Bindings: Env }>();

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

function serialize(row: any) {
  return {
    id: row.id,
    name: row.name,
    nmlsId: row.nmls_id ?? null,
    entityType: row.entity_type ?? null,
    primaryContact: row.primary_contact ?? null,
    primaryEmail: row.primary_email ?? null,
    primaryPhone: row.primary_phone ?? null,
    address: row.address ?? null,
    licenseStates: row.license_states ?? [],
    allowsRemoteWork: row.allows_remote_work ?? null,
    isActive: row.is_active ?? true,
  };
}

companyRoutes.get("/settings", requireCapability("viewSetupStatus"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const [company] = await sql`SELECT * FROM companies WHERE id = ${user.companyId}`;
  if (!company) return c.json({ error: "Company not found" }, 404);
  return c.json({ company: serialize(company) });
});

const settingsSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  nmlsId: z.string().max(20).optional(),
  entityType: z.enum(["broker", "lender", "servicer", "broker_lender", "banker"]).optional(),
  primaryContact: z.string().max(255).optional(),
  primaryEmail: z.string().email().max(255).optional(),
  primaryPhone: z.string().max(40).optional(),
  address: z.string().max(2000).optional(),
  licenseStates: z.array(z.string().min(2).max(3)).optional(),
  allowsRemoteWork: z.boolean().optional(),
});

companyRoutes.patch("/settings", requireCapability("manageCompanySettings"), zValidator("json", settingsSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const sql = db(c.env);
  const [existing] = await sql`SELECT id FROM companies WHERE id = ${user.companyId}`;
  if (!existing) return c.json({ error: "Company not found" }, 404);

  // COALESCE keeps unset fields unchanged for the simple columns.
  let [row] = await sql`
    UPDATE companies SET
      name = COALESCE(${body.name ?? null}, name),
      nmls_id = COALESCE(${body.nmlsId ?? null}, nmls_id),
      entity_type = COALESCE(${body.entityType ?? null}, entity_type),
      primary_contact = COALESCE(${body.primaryContact ?? null}, primary_contact),
      primary_email = COALESCE(${body.primaryEmail ?? null}, primary_email),
      primary_phone = COALESCE(${body.primaryPhone ?? null}, primary_phone),
      address = COALESCE(${body.address ?? null}, address),
      license_states = COALESCE(${body.licenseStates ?? null}, license_states),
      updated_at = NOW()
    WHERE id = ${user.companyId} RETURNING *`;

  // allows_remote_work is explicitly settable to false, so apply it directly
  // (a separate update) only when the caller provided a value.
  if (body.allowsRemoteWork !== undefined) {
    [row] = await sql`UPDATE companies SET allows_remote_work = ${body.allowsRemoteWork}, updated_at = NOW() WHERE id = ${user.companyId} RETURNING *`;
  }

  await c.env.AUDIT_QUEUE.send({
    type: "company.settings_updated",
    entityType: "company",
    entityId: user.companyId,
    companyId: user.companyId,
    userId: user.userId,
    action: "update_company_settings",
    details: { fields: Object.keys(body) },
    ipAddress: c.req.header("cf-connecting-ip") || "unknown",
    timestamp: new Date().toISOString(),
  });
  await tryCreateOutboxEvent(sql, { companyId: user.companyId, eventType: "company.settings_updated", aggregateType: "company", aggregateId: user.companyId, idempotencyKey: `company:${user.companyId}:settings_updated:${Date.now()}`, payload: { fields: Object.keys(body), actorUserId: user.userId } });
  return c.json({ company: serialize(row) });
});
