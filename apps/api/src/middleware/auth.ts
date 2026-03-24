// ─────────────────────────────────────────────────────
// MortgageGuard — Auth Middleware (JWT + RBAC)
// ─────────────────────────────────────────────────────
import { createMiddleware } from "hono/factory";
import { jwtVerify } from "jose";
import type { Env } from "../env";

export interface AuthUser {
  userId: string;
  companyId: string;
  email: string;
  role: string;
  nmlsId: string | null;
}

// Extend Hono context with auth user
declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

export const authMiddleware = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const secret = new TextEncoder().encode(c.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);

    c.set("user", {
      userId: payload.sub as string,
      companyId: payload.companyId as string,
      email: payload.email as string,
      role: payload.role as string,
      nmlsId: (payload.nmlsId as string) || null,
    });

    await next();
  } catch (err) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

// Role-based access control middleware
export function requireRole(...roles: string[]) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: "Insufficient permissions", requiredRoles: roles }, 403);
    }
    await next();
  });
}
