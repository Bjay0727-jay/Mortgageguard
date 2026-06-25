import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { createInviteToken, inviteExpiry } from "../lib/invites";

export const userRoutes = new Hono<{ Bindings: Env }>();

const ROLES = ["company_admin", "qualifying_individual", "loan_originator", "processor", "compliance_officer", "read_only"] as const;
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
  expiresInDays: z.number().int().min(1).max(30).optional().default(7),
});

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

function buildInviteUrl(env: Env, token: string): string {
  const path = `/invite/${token}`;
  const base = env.APP_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

function inviteExpiryDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function serializeInvite(invite: any) {
  const status = invite.accepted_at ? "accepted" : invite.revoked_at ? "revoked" : new Date(invite.expires_at).getTime() < Date.now() ? "expired" : "pending";
  return {
    id: invite.id,
    email: invite.email,
    role: invite.role,
    invitedBy: invite.invited_by_name || invite.invited_by || null,
    expiresAt: invite.expires_at,
    acceptedAt: invite.accepted_at,
    revokedAt: invite.revoked_at,
    createdAt: invite.created_at,
    status,
  };
}

userRoutes.get("/", requireCapability("manageUsers"), async (c) => {
  const admin = c.get("user");
  const sql = db(c.env);
  const users = await sql`
    SELECT id, name, email, role, nmls_id, is_active, must_change_password, created_at, last_login_at
    FROM users
    WHERE company_id = ${admin.companyId}
    ORDER BY created_at DESC`;
  return c.json({ users: users.map((user: any) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    nmlsId: user.nmls_id,
    status: user.is_active ? "active" : "inactive",
    mustChangePassword: !!user.must_change_password,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
  })) });
});

userRoutes.post("/invites", requireCapability("manageInvites"), zValidator("json", inviteSchema), async (c) => {
  const { email, role, expiresInDays } = c.req.valid("json");
  const admin = c.get("user");
  const sql = db(c.env);

  const [existingUser] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existingUser) return c.json({ error: "A user with this email already exists" }, 409);

  await sql`
    UPDATE user_invitations SET revoked_at = NOW(), updated_at = NOW()
    WHERE company_id = ${admin.companyId} AND lower(email) = lower(${email})
      AND accepted_at IS NULL AND revoked_at IS NULL`;

  const { token, tokenHash } = await createInviteToken();
  const expiresAt = expiresInDays === 7 ? inviteExpiry(Date.now()) : inviteExpiryDays(expiresInDays);
  const [invite] = await sql`
    INSERT INTO user_invitations (company_id, email, role, token_hash, invited_by, expires_at)
    VALUES (${admin.companyId}, ${email}, ${role}, ${tokenHash}, ${admin.userId}, ${expiresAt})
    RETURNING id, email, role, expires_at, accepted_at, revoked_at, created_at`;

  await c.env.AUDIT_QUEUE.send({ type: "invite.created", entityType: "user", entityId: invite.id, companyId: admin.companyId, userId: admin.userId, action: "create_invite", details: { email, role, expiresInDays }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });

  return c.json({ invite: serializeInvite(invite), token, inviteUrl: buildInviteUrl(c.env, token) }, 201);
});

userRoutes.get("/invites", requireCapability("manageInvites"), async (c) => {
  const admin = c.get("user");
  const sql = db(c.env);
  const invites = await sql`
    SELECT i.id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at, u.name AS invited_by_name
    FROM user_invitations i
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.company_id = ${admin.companyId}
    ORDER BY i.created_at DESC`;
  return c.json({ invites: invites.map(serializeInvite) });
});

userRoutes.post("/invites/:id/revoke", requireCapability("manageInvites"), async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [updated] = await sql`
    UPDATE user_invitations SET revoked_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${admin.companyId} AND accepted_at IS NULL AND revoked_at IS NULL
    RETURNING id, email, role, expires_at, accepted_at, revoked_at, created_at`;
  if (!updated) return c.json({ error: "Invitation not found or no longer pending" }, 404);
  await c.env.AUDIT_QUEUE.send({ type: "invite.revoked", entityType: "user", entityId: id, companyId: admin.companyId, userId: admin.userId, action: "revoke_invite", details: { email: updated.email, role: updated.role }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });
  return c.json({ invite: serializeInvite(updated) });
});

userRoutes.post("/invites/:id/resend", requireCapability("manageInvites"), async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const { token, tokenHash } = await createInviteToken();
  const expiresAt = inviteExpiry(Date.now());
  const [updated] = await sql`
    UPDATE user_invitations SET token_hash = ${tokenHash}, expires_at = ${expiresAt}, revoked_at = NULL, accepted_at = NULL, updated_at = NOW()
    WHERE id = ${id} AND company_id = ${admin.companyId}
    RETURNING id, email, role, expires_at, accepted_at, revoked_at, created_at`;
  if (!updated) return c.json({ error: "Invitation not found" }, 404);
  await c.env.AUDIT_QUEUE.send({ type: "invite.created", entityType: "user", entityId: id, companyId: admin.companyId, userId: admin.userId, action: "resend_invite", details: { email: updated.email, role: updated.role }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });
  return c.json({ invite: serializeInvite(updated), token, inviteUrl: buildInviteUrl(c.env, token) });
});

userRoutes.delete("/invites/:id", requireCapability("manageInvites"), async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [updated] = await sql`
    UPDATE user_invitations SET revoked_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${admin.companyId} AND accepted_at IS NULL AND revoked_at IS NULL
    RETURNING id`;
  if (!updated) return c.json({ error: "Invitation not found or no longer pending" }, 404);
  return c.json({ success: true });
});
