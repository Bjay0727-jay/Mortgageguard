import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import { authMiddleware, requireRole } from "./auth";
import { createMockEnv } from "../__tests__/helpers";
import type { Env } from "../env";

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";

async function makeToken(payload: Record<string, unknown>, expiresIn = "1h") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(SECRET));
}

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/protected/*", authMiddleware);
  app.get("/protected/info", (c) => {
    const user = c.get("user");
    return c.json({ userId: user.userId, role: user.role });
  });

  // Admin-only route
  app.use("/admin/*", authMiddleware);
  app.use("/admin/*", requireRole("company_admin"));
  app.get("/admin/panel", (c) => c.json({ admin: true }));

  return app;
}

describe("authMiddleware", () => {
  const env = createMockEnv();

  it("rejects request without Authorization header", async () => {
    const app = createTestApp();
    const res = await app.request("/protected/info", {}, env);
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error).toContain("authorization");
  });

  it("rejects request with invalid Bearer format", async () => {
    const app = createTestApp();
    const res = await app.request(
      "/protected/info",
      { headers: { Authorization: "Basic abc123" } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects expired token", async () => {
    const app = createTestApp();
    const token = await makeToken(
      { sub: "u1", companyId: "c1", email: "a@b.com", role: "loan_originator" },
      "0s",
    );
    // Wait a moment for the token to expire
    await new Promise((r) => setTimeout(r, 10));
    const res = await app.request(
      "/protected/info",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("accepts valid token and sets user context", async () => {
    const app = createTestApp();
    const token = await makeToken({
      sub: "user-123",
      companyId: "comp-456",
      email: "test@example.com",
      role: "compliance_officer",
      nmlsId: "NM-789",
    });

    const res = await app.request(
      "/protected/info",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.userId).toBe("user-123");
    expect(body.role).toBe("compliance_officer");
  });
});

describe("requireRole", () => {
  const env = createMockEnv();

  it("allows user with correct role", async () => {
    const app = createTestApp();
    const token = await makeToken({
      sub: "admin-1",
      companyId: "c1",
      email: "admin@co.com",
      role: "company_admin",
    });

    const res = await app.request(
      "/admin/panel",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(200);
  });

  it("rejects user with wrong role", async () => {
    const app = createTestApp();
    const token = await makeToken({
      sub: "user-1",
      companyId: "c1",
      email: "user@co.com",
      role: "read_only",
    });

    const res = await app.request(
      "/admin/panel",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toContain("permissions");
  });
});
