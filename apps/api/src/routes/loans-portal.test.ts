import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { loanRoutes } from "./loans";

interface State {
  loans: any[];
  rulesDocs: any[]; // generateChecklist join result
  checks: any[];
  docs: any[]; // loan_documents
  tasks: any[];
  entityType: string;
  licenseStates: string[];
  rulesLoaded: boolean;
}
const state: State = { loans: [], rulesDocs: [], checks: [], docs: [], tasks: [], entityType: "broker", licenseStates: ["TX"], rulesLoaded: false };

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    // generateChecklist join
    if (q.includes("FROM required_documents rd JOIN state_rules sr ON sr.id = rd.state_rule_id")) return state.rulesDocs;
    if (q.includes("SELECT entity_type, license_states FROM companies")) return [{ entity_type: state.entityType, license_states: state.licenseStates }];
    if (q.includes("SELECT entity_type FROM companies")) return [{ entity_type: state.entityType }];
    if (q.includes("FROM state_rules WHERE state_code = ? AND is_active = true")) return [{ n: state.rulesLoaded ? 3 : 0 }];
    if (q.includes("SELECT id, name, role FROM users WHERE company_id")) return [{ id: "u-1", name: "Officer", role: "loan_originator" }];

    // loan_documents (DISTINCT ON ... checklist enrichment)
    if (q.includes("FROM loan_documents WHERE loan_id")) return state.docs;

    // loans
    if (q.includes("INSERT INTO loans")) {
      const row = {
        id: `loan-${state.loans.length + 1}`, company_id: values[0], status: "application",
        loan_number: values[2], borrower_last_name: values[3], borrower_first_name: values[4],
        property_state: "TX", loan_purpose: "purchase", loan_product: "conventional", loan_type: "fixed",
        lien_position: "first", occupancy_type: "primary", texas_cashout_type: "none",
        application_date: "2026-06-01", originator_nmls_id: "999", loan_originator_name: "Officer",
        compliance_score: 0, closing_date: null,
      };
      state.loans.push(row);
      return [row];
    }
    if (q.includes("UPDATE loans SET transaction_log_status")) return [];
    if (q.includes("UPDATE loans SET") && q.includes("loan_purpose = COALESCE")) {
      const loan = state.loans[0];
      // apply texas cashout / purpose changes passed positionally is complex; tests set directly.
      return [loan];
    }
    if (q.includes("UPDATE loans SET docs_required")) return [];
    if (q.includes("UPDATE loans SET compliance_score")) return [];
    if (q.includes("SELECT * FROM loans WHERE id = ? AND company_id = ? AND is_deleted = false")) {
      const [id, companyId] = values;
      return state.loans.filter((l) => l.id === id && l.company_id === companyId);
    }
    if (q.includes("SELECT * FROM loans WHERE id = ? AND company_id")) {
      const [id, companyId] = values;
      return state.loans.filter((l) => l.id === id && l.company_id === companyId);
    }
    if (q.includes("SELECT id FROM loans WHERE id = ? AND company_id")) {
      const [id, companyId] = values;
      return state.loans.filter((l) => l.id === id && l.company_id === companyId).map((l) => ({ id: l.id }));
    }

    // compliance_checks
    if (q.includes("SELECT id, required_document_id, result FROM compliance_checks")) return state.checks;
    if (q.includes("INSERT INTO compliance_checks")) { state.checks.push({ id: `c-${state.checks.length + 1}`, required_document_id: values[2], result: "pending" }); return []; }
    if (q.includes("UPDATE compliance_checks SET")) return [];

    // loan_tasks
    if (q.includes("INSERT INTO loan_tasks")) {
      // auto insert: (company_id, loan_id, title, task_type, 'open', priority, auto_key, created_by) → autoKey=values[5]
      const isAuto = q.includes("auto_key, created_by");
      const autoKey = isAuto ? values[5] : null;
      if (autoKey && state.tasks.find((t) => t.auto_key === autoKey)) return [];
      const row = { id: `t-${state.tasks.length + 1}`, loan_id: values[1], title: values[2], task_type: isAuto ? values[3] : values[4], status: "open", auto_key: autoKey, due_at: null };
      state.tasks.push(row);
      return [row];
    }
    if (q.includes("SELECT id, auto_key FROM loan_tasks")) return state.tasks.filter((t) => t.auto_key && !["complete", "canceled"].includes(t.status));
    if (q.includes("SELECT status, due_at FROM loan_tasks")) return state.tasks.map((t) => ({ status: t.status, due_at: t.due_at }));
    if (q.includes("SELECT id, status FROM loan_tasks WHERE id = ?")) {
      const [taskId] = values;
      return state.tasks.filter((t) => t.id === taskId).map((t) => ({ id: t.id, status: t.status }));
    }
    if (q.includes("FROM loan_tasks t LEFT JOIN users a")) return state.tasks;
    if (q.includes("UPDATE loan_tasks SET status = 'complete'")) return [];
    if (q.includes("UPDATE loan_tasks SET")) {
      const taskId = values[values.length - 1];
      const t = state.tasks.find((x) => x.id === taskId);
      if (t && q.includes("status = COALESCE")) t.status = "complete";
      return t ? [t] : [];
    }

    if (q.includes("INSERT INTO loan_timeline")) return [];
    return [];
  }),
}));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";
async function token(role: string, companyId = "company-1") {
  return new SignJWT({ companyId, email: `${role}@x.com`, role, nmlsId: "999" })
    .setSubject(`${role}-user`).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}
const auth = async (role: string) => ({ Authorization: `Bearer ${await token(role)}` });
const jsonHeaders = async (role: string) => ({ ...(await auth(role)), "Content-Type": "application/json" });
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/loans", loanRoutes);
  return a;
}

const validLoan = {
  loanNumber: "LN-1", borrowerFirstName: "Jane", borrowerLastName: "Doe",
  propertyAddress: "1 Main", propertyCity: "Austin", propertyState: "TX", propertyZip: "78701",
  loanPurpose: "purchase", loanProduct: "conventional", loanType: "fixed", lienPosition: "first", occupancyType: "primary",
};

beforeEach(() => {
  state.loans = []; state.rulesDocs = []; state.checks = []; state.docs = []; state.tasks = [];
  state.entityType = "broker"; state.licenseStates = ["TX"]; state.rulesLoaded = false;
});

describe("loan creation", () => {
  it("requires createLoan capability", async () => {
    const res = await app().request("/api/v1/loans", { method: "POST", headers: await jsonHeaders("read_only"), body: JSON.stringify(validLoan) }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("validates required fields", async () => {
    const res = await app().request("/api/v1/loans", { method: "POST", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ ...validLoan, borrowerFirstName: "" }) }, createMockEnv());
    expect(res.status).toBe(400);
  });

  it("creates a loan, captures tx-log status, and queues checklist generation", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/loans", { method: "POST", headers: await jsonHeaders("company_admin"), body: JSON.stringify(validLoan) }, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.loan.transaction_log_status).toBeTruthy();
    expect((env.COMPLIANCE_QUEUE as any).messages.some((m: any) => m.type === "loan.created")).toBe(true);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "loan.created")).toBe(true);
  });
});

describe("checklist conditional merge", () => {
  it("surfaces Texas 50(a)(6) conditional documents even when no rules are seeded", async () => {
    state.loans = [{ id: "loan-1", company_id: "company-1", property_state: "TX", loan_type: "fixed", loan_purpose: "refinance", loan_product: "conventional", lien_position: "first", texas_cashout_type: "tx_50a6" }];
    const res = await app().request("/api/v1/loans/loan-1/checklist", { headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    const types = body.checklist.map((i: any) => i.documentType);
    expect(types).toEqual(expect.arrayContaining(["tx_home_equity_disclosure", "tx_fair_market_value_ack", "tx_notice_penalties"]));
  });
});

describe("loan tasks", () => {
  beforeEach(() => {
    state.loans = [{ id: "loan-1", company_id: "company-1", property_state: "TX", loan_type: "fixed", loan_purpose: "purchase", loan_product: "conventional", lien_position: "first", texas_cashout_type: "none", application_date: "2026-06-01", status: "application", compliance_score: 0 }];
  });

  it("auto-generates tasks for missing documents and unloaded rules", async () => {
    const res = await app().request("/api/v1/loans/loan-1/tasks", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const keys = state.tasks.map((t) => t.auto_key);
    expect(keys).toContain("rules_not_loaded");
    expect(keys.some((k) => k?.startsWith("missing_document:"))).toBe(true);
  });

  it("read_only cannot create a task; admin can", async () => {
    expect((await app().request("/api/v1/loans/loan-1/tasks", { method: "POST", headers: await jsonHeaders("read_only"), body: JSON.stringify({ title: "x" }) }, createMockEnv())).status).toBe(403);
    const res = await app().request("/api/v1/loans/loan-1/tasks", { method: "POST", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ title: "Call borrower", taskType: "borrower_follow_up" }) }, createMockEnv());
    expect(res.status).toBe(201);
  });

  it("completes a task and emits the completed audit event", async () => {
    state.tasks = [{ id: "t-1", loan_id: "loan-1", status: "open", auto_key: null, due_at: null }];
    const env = createMockEnv();
    const res = await app().request("/api/v1/loans/loan-1/tasks/t-1", { method: "PATCH", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ status: "complete" }) }, env);
    expect(res.status).toBe(200);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "loan.task_completed")).toBe(true);
  });
});

describe("wizard context + integrity", () => {
  it("returns loan creation context with rule-load status + warnings", async () => {
    const res = await app().request("/api/v1/loans/new/context", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.licensedStates).toContain("TX");
    expect(body.ruleLoadStatus.TX).toBe(false);
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.loanPurposes).toContain("home_equity_50a6");
  });

  it("integrity reports blocked when rules are not loaded", async () => {
    state.loans = [{ id: "loan-1", company_id: "company-1", property_state: "TX", loan_type: "fixed", loan_purpose: "purchase", loan_product: "conventional", lien_position: "first", texas_cashout_type: "none", application_date: "2026-06-01", status: "application", compliance_score: 100, closing_date: null }];
    const res = await app().request("/api/v1/loans/loan-1/integrity", { headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    expect(["blocked", "critical", "needs_attention"]).toContain(body.integrity.status);
    expect(body.integrity.nextActions.some((a: any) => a.href === "/setup?step=rules")).toBe(true);
  });
});

describe("loan update re-resolves rules", () => {
  it("requires updateLoan capability", async () => {
    state.loans = [{ id: "loan-1", company_id: "company-1", property_state: "TX", loan_type: "fixed", loan_purpose: "purchase", loan_product: "conventional", lien_position: "first", texas_cashout_type: "none", application_date: "2026-06-01", status: "application" }];
    const res = await app().request("/api/v1/loans/loan-1", { method: "PATCH", headers: await jsonHeaders("read_only"), body: JSON.stringify({ loanType: "arm" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("emits rules_resolved + updated audit events when a rule-affecting field changes", async () => {
    state.loans = [{ id: "loan-1", company_id: "company-1", property_state: "TX", loan_type: "fixed", loan_purpose: "purchase", loan_product: "conventional", lien_position: "first", texas_cashout_type: "none", application_date: "2026-06-01", status: "application", compliance_score: 0 }];
    const env = createMockEnv();
    const res = await app().request("/api/v1/loans/loan-1", { method: "PATCH", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ loanType: "arm" }) }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ruleChanges).toContain("loanType");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "loan.rules_resolved")).toBe(true);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "loan.updated")).toBe(true);
  });
});
