import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { regulatorySourceRoutes } from "./regulatory-sources";

const state = { sources: [] as any[] };

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    if (q.includes("UPDATE regulatory_sources")) {
      const id = values[values.length - 1];
      const nextDue = values[0];
      const s = state.sources.find((x) => x.id === id);
      if (!s) return [];
      s.last_verified_at = new Date().toISOString();
      s.verification_status = "verified";
      s.next_verification_due_at = nextDue;
      return [s];
    }
    if (q.includes("SELECT id FROM regulatory_sources WHERE id = ?")) {
      return state.sources.filter((s) => s.id === values[0]).map((s) => ({ id: s.id }));
    }
    if (q.includes("SELECT * FROM regulatory_sources WHERE id = ?")) {
      return state.sources.filter((s) => s.id === values[0]);
    }
    if (q.includes("SELECT * FROM regulatory_sources")) {
      return state.sources;
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
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/regulatory-sources", regulatorySourceRoutes);
  return a;
}

beforeEach(() => {
  state.sources = [
    { id: "src-1", source_key: "aml_program_31_cfr_1029_210", citation: "31 CFR 1029.210", jurisdiction: "FED", verification_status: "unverified", next_verification_due_at: null, last_verified_at: null },
    { id: "src-2", source_key: "red_flags_16_cfr_681_1", citation: "16 CFR 681.1", jurisdiction: "FED", verification_status: "verified", next_verification_due_at: "2020-01-01", last_verified_at: "2019-01-01" },
  ];
});

describe("regulatory sources", () => {
  it("lists sources and derives review_due for past-due verified sources", async () => {
    const res = await app().request("/api/v1/regulatory-sources", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.sources).toHaveLength(2);
    const stale = body.sources.find((s: any) => s.source_key === "red_flags_16_cfr_681_1");
    expect(stale.verificationStatus).toBe("review_due");
  });

  it("read_only can view the registry", async () => {
    const res = await app().request("/api/v1/regulatory-sources", { headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(200);
  });

  it("mark-verified updates verification metadata and emits audit", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/regulatory-sources/src-1/mark-verified", { method: "POST", headers: { ...(await auth("company_admin")), "Content-Type": "application/json" }, body: JSON.stringify({ notes: "Checked eCFR" }) }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.source.verification_status).toBe("verified");
    expect(body.source.last_verified_at).toBeTruthy();
    expect(body.source.next_verification_due_at).toBeTruthy();
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "regulatory_source.verified")).toBe(true);
  });

  it("read_only cannot mark a source verified", async () => {
    const res = await app().request("/api/v1/regulatory-sources/src-1/mark-verified", { method: "POST", headers: { ...(await auth("read_only")), "Content-Type": "application/json" }, body: JSON.stringify({}) }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("loan_originator cannot view or verify sources", async () => {
    expect((await app().request("/api/v1/regulatory-sources", { headers: await auth("loan_originator") }, createMockEnv())).status).toBe(403);
  });
});
