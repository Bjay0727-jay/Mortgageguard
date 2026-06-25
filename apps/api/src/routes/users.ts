import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { createInviteToken, inviteExpiry } from "../lib/invites";

// Mounted under /api/v1/users — authMiddleware already applied upstream.
export const userRoutes = new Hono<{ Bindings: Env }>();

const ROLES = ["company_admin", "qualifying_individual", "loan_originator", "processor", "compliance_officer", "read_only"] as const;
const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(ROLES),
});

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

function buildInviteUrl(env: Env, token: string): string {
  const path = `/invite/${token}`;
  const base = env.APP_BASE_URL?.replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

// ─── Create an invite (company_admin only) ───
userRoutes.post("/invites", requireCapability("manageInvites"), zValidator("json", inviteSchema), async (c) => {
  const { email, role } = c.req.valid("json");
  const admin = c.get("user");
  const sql = db(c.env);

  // Don't invite someone who already has an account.
  const [existingUser] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existingUser) return c.json({ error: "A user with this email already exists" }, 409);

  // Supersede any prior pending invite for the same email in this company so a
  // single email only ever has one live token.
  await sql`
    UPDATE user_invitations SET revoked_at = NOW()
    WHERE company_id = ${admin.companyId} AND email = ${email}
      AND accepted_at IS NULL AND revoked_at IS NULL`;

  const { token, tokenHash } = await createInviteToken();
  const expiresAt = inviteExpiry(Date.now());
  const [invite] = await sql`
    INSERT INTO user_invitations (company_id, email, role, token_hash, invited_by, expires_at)
    VALUES (${admin.companyId}, ${email}, ${role}, ${tokenHash}, ${admin.userId}, ${expiresAt})
    RETURNING id, email, role, expires_at, created_at`;

  // token / inviteUrl are returned ONCE here; token_hash is never exposed.
  return c.json({
    invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expires_at, createdAt: invite.created_at },
    token,
    inviteUrl: buildInviteUrl(c.env, token),
  }, 201);
});

// ─── List pending invites for the admin's company ───
userRoutes.get("/invites", requireCapability("manageInvites"), async (c) => {
  const admin = c.get("user");
  const sql = db(c.env);
  const invites = await sql`
    SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at
    FROM user_invitations
    WHERE company_id = ${admin.companyId}
    ORDER BY created_at DESC`;
  // token_hash deliberately omitted.
  return c.json({ invites });
});

// ─── Revoke an invite ───
userRoutes.delete("/invites/:id", requireCapability("manageInvites"), async (c) => {
  const admin = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [updated] = await sql`
    UPDATE user_invitations SET revoked_at = NOW()
    WHERE id = ${id} AND company_id = ${admin.companyId} AND accepted_at IS NULL AND revoked_at IS NULL
    RETURNING id`;
  if (!updated) return c.json({ error: "Invitation not found or no longer pending" }, 404);
  return c.json({ success: true });
});
