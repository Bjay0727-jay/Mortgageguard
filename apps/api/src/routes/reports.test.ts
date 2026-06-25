import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { reportRoutes } from "./reports";

const state = {
  loans: [
    // Borrower name contains a comma and quotes to exercise CSV escaping.
    { id: "loan-1", company_id: "company-1", loan_number: "TX-1001", borrower: 'O"Brien, Mary', application_date: "2026-01-15", property: "1 Main St, Austin, TX 78701", interest_rate: "6.5", loan_purpose: "purchase", loan_product: "conventional", loan_type: "fixed", loan_term: 360, lien_position: "first", occupancy_type: "primary", status: "processing", closing_date: null, originator: "Jane LO", originator_nmls_id: "12345", lender_name: "Acme", lender_nmls_id: "999", tx_log_entry_date: "2026-01-15" },
  ],
  deadlines: [{ id: "d1", company_id: "company-1" }],
};

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();
    // Evidence-packet single-loan lookup (company scoped).
    if (q.includes("FROM loans l LEFT JOIN users u") && q.includes("l.id = ?")) {
      const [loanId, companyId] = values;
      return state.loans.filter((l) => l.id === loanId && l.company_id === companyId);
    }
    // Transaction-log loans.
    if (q.includes("FROM loans l LEFT JOIN users u")) {
      const companyId = values[0];
      return state.loans.filter((l) => l.company_id === companyId);
    }
    // Evidence-packet sub-queries.
    if (q.includes("FROM compliance_checks cc")) return [];
    if (q.includes("FROM loan_documents")) return [];
    if (q.includes("FROM loan_timeline")) return [];
    // Filing: existence check + update.
    if (q.includes("SELECT id FROM reporting_deadlines")) {
      const [id, companyId] = values;
      return state.deadlines.filter((d) => d.id === id && d.company_id === companyId).map((d) => ({ id: d.id }));
    }
    if (q.includes("UPDATE reporting_deadlines SET status = ?")) {
      return [{ id: "d1", status: "filed", confirmation_number: "NMLS-Q1-123", evidence_file_path: "set", filed_by: "company_admin-user" }];
    }
    return [];
  }),
}));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";
async function token(role: string, companyId = "company-1") {
  return new SignJWT({ companyId, email: `${role}@x.com`, role, nmlsId: null })
    .setSubject(`${role}-user`).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/reports", reportRoutes);
  return a;
}
const auth = async (role: string, companyId = "company-1") => ({ Authorization: `Bearer ${await token(role, companyId)}` });
async function listKeys(env: Env) {
  const res = await (env.EXPORTS as any).list();
  return res.objects.map((o: any) => o.key);
}

describe("reports — CSV export", () => {
  it("authenticated CSV export works for an exporter and escapes safely", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/reports/transaction-log?format=csv", { headers: await auth("company_admin") }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    // Comma/quote-laden borrower stays inside one quoted field.
    expect(body).toContain('"O""Brien, Mary"');
    expect(body.split("\r\n")[0]).toContain("Loan #");
    // Export is audited.
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "report.exported")).toBe(true);
  });

  it("unauthorized role cannot export CSV", async () => {
    const res = await app().request("/api/v1/reports/transaction-log?format=csv", { headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("viewers can still read JSON transaction log", async () => {
    const res = await app().request("/api/v1/reports/transaction-log", { headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(200);
  });
});

describe("reports — filing evidence", () => {
  beforeEach(() => { state.deadlines = [{ id: "d1", company_id: "company-1" }]; });

  it("saves filing evidence, stores a company-scoped receipt, and audits", async () => {
    const env = createMockEnv();
    const fd = new FormData();
    fd.append("status", "filed");
    fd.append("confirmationNumber", "NMLS-Q1-123");
    fd.append("file", new File(["%PDF-1.4 receipt"], "receipt.pdf", { type: "application/pdf" }));
    const res = await app().request("/api/v1/reports/deadlines/d1/file", { method: "POST", headers: await auth("company_admin"), body: fd }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deadline.confirmation_number).toBe("NMLS-Q1-123");

    const keys = await listKeys(env);
    expect(keys.some((k: string) => k.startsWith("reporting-evidence/company-1/d1/"))).toBe(true);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "deadline.filed")).toBe(true);
  });

  it("rejects filing on another company's deadline", async () => {
    const fd = new FormData();
    fd.append("status", "filed");
    const res = await app().request("/api/v1/reports/deadlines/d1/file", { method: "POST", headers: await auth("company_admin", "company-2"), body: fd }, createMockEnv());
    expect(res.status).toBe(404);
  });

  it("non-managers cannot file", async () => {
    const fd = new FormData();
    fd.append("status", "filed");
    const res = await app().request("/api/v1/reports/deadlines/d1/file", { method: "POST", headers: await auth("loan_originator"), body: fd }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("reports — evidence packet", () => {
  it("generates a company-scoped packet artifact in EXPORTS", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/reports/evidence-packet", { method: "POST", headers: { ...(await auth("company_admin")), "Content-Type": "application/json" }, body: JSON.stringify({ loanId: "loan-1" }) }, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.packet.type).toBe("loan");
    expect(body.packet.companyId).toBe("company-1");
    expect(body.artifactKey.startsWith("evidence-packets/company-1/")).toBe(true);
    const keys = await listKeys(env);
    expect(keys.some((k: string) => k.startsWith("evidence-packets/company-1/"))).toBe(true);
  });

  it("is company-scoped: another company cannot package this loan", async () => {
    const res = await app().request("/api/v1/reports/evidence-packet", { method: "POST", headers: { ...(await auth("company_admin", "company-2")), "Content-Type": "application/json" }, body: JSON.stringify({ loanId: "loan-1" }) }, createMockEnv());
    expect(res.status).toBe(404);
  });

  it("unauthorized role cannot generate a packet", async () => {
    const res = await app().request("/api/v1/reports/evidence-packet", { method: "POST", headers: { ...(await auth("read_only")), "Content-Type": "application/json" }, body: JSON.stringify({ loanId: "loan-1" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });
});
