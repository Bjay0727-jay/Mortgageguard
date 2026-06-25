import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import { SignJWT, jwtVerify } from "jose";
import type { Env } from "../env";
import { AppError } from "../lib/errors";
import { authMiddleware } from "../middleware/auth";
import { hashPassword, verifyPassword, resolveChangePassword } from "../lib/passwords";
import { sha256Hex, validateInvite } from "../lib/invites";

export const authRoutes = new Hono<{ Bindings: Env }>();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

// Public self-registration creates a NEW company and makes the registrant its
// company_admin. It intentionally does NOT accept companyId or role from the
// client — joining an existing company or choosing a privileged role is only
// possible via an admin-issued invite (see /register-invite).
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(255),
  companyName: z.string().min(1).max(255),
  nmlsId: z.string().max(20).optional(),
});

// Invite-based registration. Role/company/email all come from the invite — the
// client only proves possession of the token and sets their own credentials.
export const registerInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(255),
  password: z.string().min(8),
  nmlsId: z.string().max(20).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8),
});

async function createToken(payload: Record<string, unknown>, secret: string, expiresIn = "24h") {
  // The Workers runtime (workerd) rejects zero-length HMAC keys with a DataError,
  // unlike Node which silently accepts them. An unset/empty JWT_SECRET would surface
  // as an opaque 500; fail with a clear, diagnosable error instead.
  if (!secret) {
    console.error("[AUTH] JWT_SECRET is not configured — cannot sign tokens. Set the JWT_SECRET worker secret.");
    throw new AppError(503, "Authentication is not configured", "AUTH_NOT_CONFIGURED");
  }
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expiresIn).sign(new TextEncoder().encode(secret));
}

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const sql = db(c.env);
  const [user] = await sql`SELECT u.*, c.name as company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = ${email} AND u.is_active = true`;
  if (!user) return c.json({ error: "Invalid credentials" }, 401);
  if (!(await verifyPassword(password, user.password_hash))) return c.json({ error: "Invalid credentials" }, 401);
  await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`;
  const token = await createToken({ sub: user.id, companyId: user.company_id, email: user.email, role: user.role, nmlsId: user.nmls_id }, c.env.JWT_SECRET);
  const refreshToken = await createToken({ sub: user.id, type: "refresh" }, c.env.JWT_SECRET, "30d");
  try {
    await c.env.SESSIONS.put(`refresh:${user.id}`, refreshToken, { expirationTtl: 2592000 });
  } catch (err) {
    // Don't fail the login if the refresh token can't be cached (e.g. KV daily
    // write limit exceeded). The access token is still valid; only token
    // refresh is unavailable until KV writes recover.
    console.error(`[AUTH] Could not persist refresh token (KV unavailable): ${err instanceof Error ? err.message : err}`);
  }
  return c.json({ token, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.company_id, companyName: user.company_name, nmlsId: user.nmls_id, mustChangePassword: !!user.must_change_password } });
});

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const { email, password, name, companyName, nmlsId } = c.req.valid("json");
  const sql = db(c.env);
  const [existing] = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existing) return c.json({ error: "Email already registered" }, 409);
  const passwordHash = await hashPassword(password);
  // New company + its first admin. Role is fixed server-side.
  const [company] = await sql`INSERT INTO companies (name) VALUES (${companyName}) RETURNING id, name`;
  const [user] = await sql`INSERT INTO users (company_id, nmls_id, role, name, email, password_hash) VALUES (${company.id}, ${nmlsId || null}, 'company_admin', ${name}, ${email}, ${passwordHash}) RETURNING id, name, email, role, company_id, nmls_id`;
  const token = await createToken({ sub: user.id, companyId: user.company_id, email: user.email, role: user.role, nmlsId: user.nmls_id }, c.env.JWT_SECRET);
  return c.json({ token, user: { ...user, companyName: company.name, mustChangePassword: false } }, 201);
});

// ─── Invite lookup (public): validate a token and surface who it's for ───
authRoutes.get("/invite/:token", async (c) => {
  const token = c.req.param("token");
  const tokenHash = await sha256Hex(token);
  const sql = db(c.env);
  const [invite] = await sql`
    SELECT i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, c.name AS company_name
    FROM user_invitations i JOIN companies c ON c.id = i.company_id
    WHERE i.token_hash = ${tokenHash}`;
  const check = validateInvite(invite, Date.now());
  if (!check.ok) return c.json({ error: check.error, code: check.code }, check.status as 404);
  return c.json({ email: invite.email, role: invite.role, companyName: invite.company_name, expiresAt: invite.expires_at });
});

// ─── Invite-based registration (public): role/company/email come from invite ───
authRoutes.post("/register-invite", zValidator("json", registerInviteSchema), async (c) => {
  const { token, name, password, nmlsId } = c.req.valid("json");
  const tokenHash = await sha256Hex(token);
  const sql = db(c.env);
  const [invite] = await sql`
    SELECT i.id, i.company_id, i.email, i.role, i.expires_at, i.accepted_at, i.revoked_at, c.name AS company_name
    FROM user_invitations i JOIN companies c ON c.id = i.company_id
    WHERE i.token_hash = ${tokenHash}`;
  const check = validateInvite(invite, Date.now());
  if (!check.ok) return c.json({ error: check.error, code: check.code }, check.status as 404);

  const [existing] = await sql`SELECT id FROM users WHERE email = ${invite.email}`;
  if (existing) return c.json({ error: "An account with this email already exists. Please sign in." }, 409);

  const passwordHash = await hashPassword(password);
  // company_id, role and email are taken from the invite ONLY — never the client.
  const [user] = await sql`
    INSERT INTO users (company_id, nmls_id, role, name, email, password_hash)
    VALUES (${invite.company_id}, ${nmlsId || null}, ${invite.role}, ${name}, ${invite.email}, ${passwordHash})
    RETURNING id, name, email, role, company_id, nmls_id`;
  // Mark accepted; the accepted_at IS NULL guard prevents a double redemption race.
  await sql`UPDATE user_invitations SET accepted_at = NOW() WHERE id = ${invite.id} AND accepted_at IS NULL`;

  const jwt = await createToken({ sub: user.id, companyId: user.company_id, email: user.email, role: user.role, nmlsId: user.nmls_id }, c.env.JWT_SECRET);
  return c.json({ token: jwt, user: { ...user, companyName: invite.company_name, mustChangePassword: false } }, 201);
});

// ─── Change password (authenticated) ───
authRoutes.post("/change-password", authMiddleware, zValidator("json", changePasswordSchema), async (c) => {
  const { currentPassword, newPassword } = c.req.valid("json");
  const authUser = c.get("user");
  const sql = db(c.env);
  const [user] = await sql`SELECT id, password_hash, must_change_password FROM users WHERE id = ${authUser.userId} AND is_active = true`;
  if (!user) return c.json({ error: "User not found" }, 404);

  const check = await resolveChangePassword({
    mustChangePassword: !!user.must_change_password,
    currentPassword,
    storedHash: user.password_hash,
    verify: verifyPassword,
  });
  if (!check.ok) return c.json({ error: check.error, code: check.code }, check.status as 400);

  const passwordHash = await hashPassword(newPassword);
  await sql`UPDATE users SET password_hash = ${passwordHash}, must_change_password = false, updated_at = NOW() WHERE id = ${user.id}`;
  return c.json({ success: true });
});

authRoutes.post("/refresh", async (c) => {
  const { refreshToken } = await c.req.json();
  if (!refreshToken) return c.json({ error: "Refresh token required" }, 400);
  try {
    const { payload } = await jwtVerify(refreshToken, new TextEncoder().encode(c.env.JWT_SECRET));
    if (payload.type !== "refresh") return c.json({ error: "Invalid token type" }, 401);
    const stored = await c.env.SESSIONS.get(`refresh:${payload.sub}`);
    if (stored !== refreshToken) return c.json({ error: "Session expired" }, 401);
    const sql = db(c.env);
    const [user] = await sql`SELECT * FROM users WHERE id = ${payload.sub as string} AND is_active = true`;
    if (!user) return c.json({ error: "User not found" }, 401);
    const token = await createToken({ sub: user.id, companyId: user.company_id, email: user.email, role: user.role, nmlsId: user.nmls_id }, c.env.JWT_SECRET);
    return c.json({ token });
  } catch { return c.json({ error: "Invalid refresh token" }, 401); }
});

authRoutes.post("/logout", async (c) => {
  const h = c.req.header("Authorization");
  if (h?.startsWith("Bearer ")) { try { const { payload } = await jwtVerify(h.slice(7), new TextEncoder().encode(c.env.JWT_SECRET)); await c.env.SESSIONS.delete(`refresh:${payload.sub}`); } catch {} }
  return c.json({ success: true });
});
