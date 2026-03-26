import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import { SignJWT, jwtVerify } from "jose";
import type { Env } from "../env";

export const authRoutes = new Hono<{ Bindings: Env }>();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const registerSchema = z.object({
  email: z.string().email(), password: z.string().min(8), name: z.string().min(1).max(255),
  companyId: z.string().min(1), nmlsId: z.string().optional(),
  role: z.enum(["company_admin","qualifying_individual","loan_originator","processor","compliance_officer","read_only"]).default("loan_originator"),
});

async function createToken(payload: Record<string, unknown>, secret: string, expiresIn = "24h") {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(expiresIn).sign(new TextEncoder().encode(secret));
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  const hex = (arr: Uint8Array) => Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
  return `pbkdf2:${hex(salt)}:${hex(new Uint8Array(hash))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored.startsWith("pbkdf2:")) return false;
  const [, saltHex, hashHex] = stored.split(":");
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const hash = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("") === hashHex;
}

authRoutes.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [user] = await sql`SELECT u.*, c.name as company_name FROM users u JOIN companies c ON c.id = u.company_id WHERE u.email = ${email} AND u.is_active = true`;
  if (!user) return c.json({ error: "Invalid credentials" }, 401);
  if (!(await verifyPassword(password, user.password_hash))) return c.json({ error: "Invalid credentials" }, 401);
  await sql`UPDATE users SET last_login_at = NOW() WHERE id = ${user.id}`;
  const token = await createToken({ sub: user.id, companyId: user.company_id, email: user.email, role: user.role, nmlsId: user.nmls_id }, c.env.JWT_SECRET);
  const refreshToken = await createToken({ sub: user.id, type: "refresh" }, c.env.JWT_SECRET, "30d");
  await c.env.SESSIONS.put(`refresh:${user.id}`, refreshToken, { expirationTtl: 2592000 });
  return c.json({ token, refreshToken, user: { id: user.id, name: user.name, email: user.email, role: user.role, companyId: user.company_id, companyName: user.company_name, nmlsId: user.nmls_id } });
});

authRoutes.post("/register", zValidator("json", registerSchema), async (c) => {
  const body = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [existing] = await sql`SELECT id FROM users WHERE email = ${body.email}`;
  if (existing) return c.json({ error: "Email already registered" }, 409);
  const [company] = await sql`SELECT id, name FROM companies WHERE id = ${body.companyId}`;
  if (!company) return c.json({ error: "Company not found" }, 404);
  const passwordHash = await hashPassword(body.password);
  const [user] = await sql`INSERT INTO users (company_id, nmls_id, role, name, email, password_hash) VALUES (${body.companyId}, ${body.nmlsId || null}, ${body.role}, ${body.name}, ${body.email}, ${passwordHash}) RETURNING id, name, email, role, company_id, nmls_id`;
  const token = await createToken({ sub: user.id, companyId: user.company_id, email: user.email, role: user.role, nmlsId: user.nmls_id }, c.env.JWT_SECRET);
  return c.json({ token, user: { ...user, companyName: company.name } }, 201);
});

authRoutes.post("/refresh", async (c) => {
  const { refreshToken } = await c.req.json();
  if (!refreshToken) return c.json({ error: "Refresh token required" }, 400);
  try {
    const { payload } = await jwtVerify(refreshToken, new TextEncoder().encode(c.env.JWT_SECRET));
    if (payload.type !== "refresh") return c.json({ error: "Invalid token type" }, 401);
    const stored = await c.env.SESSIONS.get(`refresh:${payload.sub}`);
    if (stored !== refreshToken) return c.json({ error: "Session expired" }, 401);
    const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
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
