import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { userRoutes } from "./users";

const state = { users: [] as any[], invites: [] as any[] };

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    if (query.includes("SELECT id FROM users WHERE email")) return state.users.filter((u) => u.email === values[0]).map((u) => ({ id: u.id }));
    if (query.includes("UPDATE user_invitations SET revoked_at")) {
      const [companyId, email] = values;
      state.invites = state.invites.map((invite) => invite.company_id === companyId && invite.email.toLowerCase() === String(email).toLowerCase() && !invite.accepted_at && !invite.revoked_at ? { ...invite, revoked_at: new Date().toISOString() } : invite);
      return [];
    }
    if (query.includes("INSERT INTO user_invitations")) {
      const invite = { id: `invite-${state.invites.length + 1}`, company_id: values[0], email: values[1], role: values[2], token_hash: values[3], invited_by: values[4], expires_at: values[5], accepted_at: null, revoked_at: null, created_at: new Date().toISOString() };
      state.invites.push(invite);
      return [invite];
    }
    if (query.includes("FROM user_invitations i")) return state.invites.map(({ token_hash, company_id, ...invite }) => invite);
    return [];
  }),
}));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";
async function token(role: string) {
  return new SignJWT({ companyId: "company-1", email: `${role}@example.com`, role, mustChangePassword: false })
    .setSubject(`${role}-user`).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}
function app() { const app = new Hono<{ Bindings: Env }>(); app.use("/api/v1/*", authMiddleware); app.route("/api/v1/users", userRoutes); return app; }

describe("user invite routes", () => {
  beforeEach(() => { state.users = []; state.invites = []; });

  it("company admin can create invite without exposing token_hash", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/users/invites", { method: "POST", headers: { Authorization: `Bearer ${await token("company_admin")}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: "new@example.com", role: "processor" }) }, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.token).toBeTruthy();
    expect(body.inviteUrl).toContain("/invite/");
    expect(JSON.stringify(body)).not.toContain("token_hash");
    expect(state.invites[0].token_hash).toBeTruthy();
  });

  it("read_only cannot create invite", async () => {
    const res = await app().request("/api/v1/users/invites", { method: "POST", headers: { Authorization: `Bearer ${await token("read_only")}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: "new@example.com", role: "processor" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });
});
