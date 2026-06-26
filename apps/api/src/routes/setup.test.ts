import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { setupRoutes } from "./setup";
import { TEXAS_STATE_RULES, TEXAS_REQUIRED_DOCUMENTS } from "../lib/texas-rules";

interface State {
  user: any;
  company: any;
  rules: any[];
  reqdocs: any[];
  deadlines: any[];
  loanCount: number;
  programs: any[];
  activeUsers: number;
  invites: any[];
  los: any[];
}
const state: State = {
  user: { name: "Administrator", email: "admin@demo.com", must_change_password: true },
  company: { id: "company-1", name: "Demo", nmls_id: null, entity_type: null, primary_contact: null, primary_email: null, address: null, license_states: ["TX"], allows_remote_work: null },
  rules: [], reqdocs: [], deadlines: [], loanCount: 0, programs: [], activeUsers: 1, invites: [], los: [],
};

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    // ── load-rules inserts ──
    if (q.includes("INSERT INTO state_rules")) {
      const [state_code, , rule_name] = values;
      if (!state.rules.find((r) => r.state_code === state_code && r.rule_name === rule_name)) {
        state.rules.push({ state_code, rule_name, is_active: true });
      }
      return [];
    }
    if (q.includes("INSERT INTO required_documents")) {
      const documentType = values[0];
      const ruleName = values[7];
      const stateCode = values[8];
      const ruleExists = state.rules.find((r) => r.rule_name === ruleName && r.state_code === stateCode);
      if (ruleExists && !state.reqdocs.find((d) => d.rule_name === ruleName && d.document_type === documentType)) {
        state.reqdocs.push({ rule_name: ruleName, document_type: documentType });
      }
      return [];
    }
    if (q.includes("INSERT INTO reporting_deadlines")) {
      const [companyId, reportType, , quarter] = values;
      if (!state.deadlines.find((d) => d.company_id === companyId && d.report_type === reportType && d.quarter === quarter)) {
        state.deadlines.push({ company_id: companyId, report_type: reportType, quarter });
      }
      return [];
    }

    // ── reads ──
    if (q.includes("SELECT name, email, must_change_password FROM users")) return [state.user];
    if (q.includes("SELECT * FROM companies WHERE id")) return [state.company];
    if (q.includes("FROM required_documents rd JOIN state_rules")) return [{ total: state.reqdocs.length }];
    if (q.includes("FILTER (WHERE is_active)")) return [{ total: state.rules.length, active: state.rules.filter((r) => r.is_active).length, last_loaded: null }];
    if (q.includes("FROM reporting_deadlines WHERE company_id")) return [{ total: state.deadlines.length }];
    if (q.includes("FROM loans WHERE company_id")) return [{ total: state.loanCount }];
    if (q.includes("status, is_required, applicable FROM compliance_programs")) return state.programs;
    if (q.includes("FROM users WHERE company_id = ? AND is_active = true")) return [{ total: state.activeUsers }];
    if (q.includes("FROM user_invitations WHERE company_id")) return state.invites;
    if (q.includes("FROM integrations WHERE company_id = ? AND system_type")) return state.los;
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
  a.route("/api/v1/setup", setupRoutes);
  return a;
}

beforeEach(() => {
  state.user = { name: "Administrator", email: "admin@demo.com", must_change_password: true };
  state.company = { id: "company-1", name: "Demo", nmls_id: null, entity_type: null, primary_contact: null, primary_email: null, address: null, license_states: ["TX"], allows_remote_work: null };
  state.rules = []; state.reqdocs = []; state.deadlines = []; state.loanCount = 0; state.programs = []; state.activeUsers = 1; state.invites = []; state.los = [];
});

describe("GET /setup/status", () => {
  it("returns all setup steps and a progress object", async () => {
    const res = await app().request("/api/v1/setup/status", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.steps).toHaveLength(7);
    expect(body.progress).toHaveProperty("percent");
    expect(body.setupComplete).toBe(false);
    // fresh seeded admin → critical warning + rules missing
    expect(body.warnings.map((w: any) => w.key)).toContain("default_admin_password");
  });

  it("read_only can view setup status", async () => {
    const res = await app().request("/api/v1/setup/status", { headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(200);
  });

  it("reflects completion once underlying state is satisfied", async () => {
    state.user = { name: "Jane", email: "jane@acme.com", must_change_password: false };
    state.company = { id: "company-1", name: "Acme", nmls_id: "123", entity_type: "broker", primary_contact: "Jane", primary_email: "jane@acme.com", address: "1 St", license_states: ["TX"], allows_remote_work: false };
    state.rules = TEXAS_STATE_RULES.map((r) => ({ state_code: r.stateCode, rule_name: r.ruleName, is_active: true }));
    state.reqdocs = TEXAS_REQUIRED_DOCUMENTS.map((d) => ({ rule_name: d.ruleName, document_type: d.documentType }));
    state.loanCount = 1;
    state.programs = [{ status: "current", is_required: true, applicable: true }];
    state.activeUsers = 2;
    const res = await app().request("/api/v1/setup/status", { headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    expect(body.coreSetupComplete).toBe(true);
    const profile = body.steps.find((s: any) => s.key === "confirm_company_profile");
    expect(profile.complete).toBe(true);
  });
});

describe("POST /setup/load-rules", () => {
  it("loads Texas + federal rules and is idempotent", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/setup/load-rules", { method: "POST", headers: { ...(await auth("company_admin")), "Content-Type": "application/json" }, body: JSON.stringify({ state: "TX" }) }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.loaded).toBe(true);
    expect(body.stateRulesCount).toBe(TEXAS_STATE_RULES.length);
    expect(body.requiredDocumentsCount).toBe(TEXAS_REQUIRED_DOCUMENTS.length);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "setup.rules_loaded")).toBe(true);

    // Re-run — no duplicates.
    await app().request("/api/v1/setup/load-rules", { method: "POST", headers: { ...(await auth("company_admin")), "Content-Type": "application/json" }, body: JSON.stringify({ state: "TX" }) }, createMockEnv());
    expect(state.rules).toHaveLength(TEXAS_STATE_RULES.length);
    expect(state.reqdocs).toHaveLength(TEXAS_REQUIRED_DOCUMENTS.length);
  });

  it("read_only cannot load rules", async () => {
    const res = await app().request("/api/v1/setup/load-rules", { method: "POST", headers: { ...(await auth("read_only")), "Content-Type": "application/json" }, body: JSON.stringify({ state: "TX" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("GET /setup/rules-status", () => {
  it("reports not-loaded when empty and loaded after load-rules", async () => {
    const empty = await (await app().request("/api/v1/setup/rules-status?state=TX", { headers: await auth("company_admin") }, createMockEnv())).json() as any;
    expect(empty.loaded).toBe(false);
    await app().request("/api/v1/setup/load-rules", { method: "POST", headers: { ...(await auth("company_admin")), "Content-Type": "application/json" }, body: JSON.stringify({ state: "TX" }) }, createMockEnv());
    const loaded = await (await app().request("/api/v1/setup/rules-status?state=TX", { headers: await auth("company_admin") }, createMockEnv())).json() as any;
    expect(loaded.loaded).toBe(true);
  });
});
