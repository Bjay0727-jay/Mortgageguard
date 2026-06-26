import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { companyRoutes } from "./company";

const state = { company: {} as any };

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    if (q.includes("SELECT id FROM companies WHERE id")) return [{ id: state.company.id }];
    if (q.includes("SELECT * FROM companies WHERE id")) return [state.company];
    if (q.includes("UPDATE companies SET allows_remote_work = ?")) {
      state.company.allows_remote_work = values[0];
      return [state.company];
    }
    if (q.includes("UPDATE companies SET name = COALESCE")) {
      // values order matches the COALESCE list
      const [name, nmls, entity, contact, email, phone, address, licenseStates] = values;
      if (name !== null) state.company.name = name;
      if (nmls !== null) state.company.nmls_id = nmls;
      if (entity !== null) state.company.entity_type = entity;
      if (contact !== null) state.company.primary_contact = contact;
      if (email !== null) state.company.primary_email = email;
      if (phone !== null) state.company.primary_phone = phone;
      if (address !== null) state.company.address = address;
      if (licenseStates !== null) state.company.license_states = licenseStates;
      return [state.company];
    }
    return [];
  }),
}));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";
async function token(role: string) {
  return new SignJWT({ companyId: "company-1", email: `${role}@x.com`, role, nmlsId: null })
    .setSubject(`${role}-user`).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}
const auth = async (role: string) => ({ Authorization: `Bearer ${await token(role)}` });
const jsonHeaders = async (role: string) => ({ ...(await auth(role)), "Content-Type": "application/json" });
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/company", companyRoutes);
  return a;
}

beforeEach(() => {
  state.company = { id: "company-1", name: "Demo", nmls_id: null, entity_type: null, primary_contact: null, primary_email: null, primary_phone: null, address: null, license_states: ["TX"], allows_remote_work: null, is_active: true };
});

describe("company settings", () => {
  it("returns the company profile", async () => {
    const res = await app().request("/api/v1/company/settings", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.company.licenseStates).toEqual(["TX"]);
    expect(body.company.allowsRemoteWork).toBeNull();
  });

  it("read_only can view but cannot update settings", async () => {
    expect((await app().request("/api/v1/company/settings", { headers: await auth("read_only") }, createMockEnv())).status).toBe(200);
    const res = await app().request("/api/v1/company/settings", { method: "PATCH", headers: await jsonHeaders("read_only"), body: JSON.stringify({ name: "Hacked" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("updates profile fields and emits an audit event", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/company/settings", { method: "PATCH", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ name: "Acme Mortgage", nmlsId: "654321", entityType: "broker", primaryContact: "Jane", primaryEmail: "jane@acme.com", licenseStates: ["TX", "CA"] }) }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.company.name).toBe("Acme Mortgage");
    expect(body.company.entityType).toBe("broker");
    expect(body.company.licenseStates).toEqual(["TX", "CA"]);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "company.settings_updated")).toBe(true);
  });

  it("explicitly sets allows_remote_work to false", async () => {
    const res = await app().request("/api/v1/company/settings", { method: "PATCH", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ allowsRemoteWork: false }) }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.company.allowsRemoteWork).toBe(false);
  });

  it("rejects an invalid entity type", async () => {
    const res = await app().request("/api/v1/company/settings", { method: "PATCH", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ entityType: "not_a_type" }) }, createMockEnv());
    expect(res.status).toBe(400);
  });
});
