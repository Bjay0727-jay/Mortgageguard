import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { reportRoutes } from "./reports";

// Mutable per-test state the postgres mock reads from.
const state = {
  loans: [] as any[],
  deadlines: [] as any[],
  company: { entity_type: "lender" } as { entity_type: string | null },
  existingDeadlines: [] as any[],
  inserts: [] as string[],
};

function resetState() {
  state.loans = [
    // Complete loan; borrower name carries a comma + quote, lender name is a
    // formula-injection probe.
    { id: "loan-1", company_id: "company-1", loan_number: "TX-1001", borrower_first_name: "Mary", borrower_last_name: 'O"Brien', application_date: "2026-01-15", property_address: "1 Main St", property_city: "Austin", property_state: "TX", property_zip: "78701", interest_rate: "6.5", loan_purpose: "purchase", texas_cashout_type: "none", loan_product: "conventional", loan_type: "fixed", loan_term: 360, lien_position: "first", occupancy_type: "primary", status: "processing", closing_date: null, originator_name: "Jane LO", originator_nmls_id: "12345", lender_name: "=cmd|' /C calc'!A0", lender_nmls_id: "999", transaction_log_entered_at: "2026-01-16" },
    // Incomplete loan — missing purpose + originator NMLS → drives warnings.
    { id: "loan-2", company_id: "company-1", loan_number: "TX-1002", borrower_first_name: "Sam", borrower_last_name: "Lee", application_date: "2026-02-01", property_address: "2 Oak Ave", property_city: "Dallas", property_state: "TX", property_zip: "75001", interest_rate: null, loan_purpose: null, texas_cashout_type: "50a6", loan_product: "conventional", loan_type: "fixed", loan_term: 360, lien_position: "first", occupancy_type: "primary", status: "application", closing_date: null, originator_name: "Jane LO", originator_nmls_id: null, lender_name: "Acme", lender_nmls_id: "999", transaction_log_entered_at: null },
  ];
  state.deadlines = [
    { id: "d1", company_id: "company-1", obligation_key: "rmla", jurisdiction: "TX", report_type: "RMLA", quarter: "Q1-2026", period_start: "2026-01-01", period_end: "2026-03-31", due_date: "2026-05-15", status: "upcoming", filed_at: null },
    { id: "d2", company_id: "company-1", obligation_key: "sssf", jurisdiction: "TX", report_type: "SSSF", quarter: "Q1-2026", period_start: "2026-01-01", period_end: "2026-03-31", due_date: "2026-05-15", status: "filed", filed_at: "2026-04-01" },
  ];
  state.company = { entity_type: "lender" };
  state.existingDeadlines = [];
  state.inserts = [];
}

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    // ── transaction-log ──
    if (q.includes("FROM loans l LEFT JOIN users u") && q.includes("l.id = ?")) {
      const [loanId, companyId] = values;
      return state.loans.filter((l) => l.id === loanId && l.company_id === companyId);
    }
    if (q.includes("FROM loans l LEFT JOIN users u")) {
      const companyId = values[0];
      return state.loans.filter((l) => l.company_id === companyId);
    }
    if (q.includes("FROM state_rules WHERE state_code = ?")) return [{ n: 1 }];
    if (q.startsWith("INSERT INTO report_exports")) { state.inserts.push("report_exports"); return []; }

    // ── setup-deadlines ──
    if (q.includes("SELECT entity_type FROM companies")) return [state.company];
    if (q.includes("SELECT obligation_key, period_start, period_end FROM reporting_deadlines")) return state.existingDeadlines;
    if (q.startsWith("INSERT INTO reporting_deadlines")) { state.inserts.push("reporting_deadlines"); return []; }

    // ── filing event ──
    if (q.startsWith("INSERT INTO report_filing_events")) { state.inserts.push("report_filing_events"); return []; }

    // ── deadlines list / existence / updates ──
    if (q.includes("SELECT * FROM reporting_deadlines")) {
      const companyId = values[0];
      return state.deadlines.filter((d) => d.company_id === companyId);
    }
    if (q.includes("SELECT id FROM reporting_deadlines")) {
      const [id, companyId] = values;
      return state.deadlines.filter((d) => d.id === id && d.company_id === companyId).map((d) => ({ id: d.id }));
    }
    if (q.includes("UPDATE reporting_deadlines SET status = 'filed'")) {
      return [{ id: "d1", status: "filed", confirmation_number: "NMLS-Q1-123", obligation_key: "rmla", jurisdiction: "TX" }];
    }
    if (q.includes("UPDATE reporting_deadlines SET evidence_file_path")) {
      return [{ id: "d1", evidence_file_path: "set", receipt_document_id: "rdoc" }];
    }

    // ── evidence packet sub-queries ──
    if (q.includes("FROM compliance_checks cc")) return [];
    if (q.includes("FROM loan_documents")) return [];
    if (q.includes("FROM loan_timeline")) return [];
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
const jsonAuth = async (role: string, companyId = "company-1") => ({ ...(await auth(role, companyId)), "Content-Type": "application/json" });
async function listKeys(env: Env) {
  const res = await (env.EXPORTS as any).list();
  return res.objects.map((o: any) => o.key);
}

beforeEach(resetState);

describe("reports — transaction log export", () => {
  it("JSON export returns rows + summary-style warnings for incomplete loans", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/reports/transaction-log?from=2026-01-01&to=2026-03-31", { headers: await auth("company_admin") }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.reportKey).toBe("tx_transaction_log");
    expect(body.jurisdiction).toBe("TX");
    expect(body.rowCount).toBe(2);
    expect(body.rows[0]).toHaveProperty("loanNumber", "TX-1001");
    // loan-2 is missing required fields → at least one warning + warningCount.
    expect(body.warningCount).toBeGreaterThan(0);
    expect(body.warnings.some((w: string) => w.includes("TX-1002"))).toBe(true);
    // Texas cash-out classification mapping.
    expect(body.rows[1].texasCashOut).toBe("50(a)(6)");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "report.transaction_log_exported")).toBe(true);
  });

  it("CSV export is escaped, formula-safe, BOM-prefixed, and named by period", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/reports/transaction-log?format=csv&from=2026-01-01&to=2026-03-31", { headers: await auth("company_admin") }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("mortgageguard-tx-transaction-log-2026-01-01-to-2026-03-31.csv");
    // UTF-8 BOM is emitted on the wire (TextDecoder strips it from .text()).
    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const body = await res.text();
    expect(body).toContain('"O""Brien, Mary"');           // RFC-4180 escaping
    expect(body.split("\r\n")[0]).toContain("Loan Number"); // header
    expect(body).toContain("'=cmd");                       // formula injection neutralized
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "report.transaction_log_exported")).toBe(true);
  });

  it("unauthorized role cannot export CSV", async () => {
    const res = await app().request("/api/v1/reports/transaction-log?format=csv", { headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("viewers can still read the JSON transaction log", async () => {
    const res = await app().request("/api/v1/reports/transaction-log", { headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(200);
  });
});

describe("reports — setup deadlines", () => {
  it("creates RMLA + SSSF + Financial Condition deadlines for a lender (quarterly)", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/reports/setup-deadlines", { method: "POST", headers: await jsonAuth("company_admin"), body: JSON.stringify({ jurisdiction: "TX", year: 2026 }) }, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    // 4 RMLA + 4 SSSF + 4 quarterly financial condition = 12.
    expect(body.total).toBe(12);
    expect(body.created).toBe(12);
    expect(body.entityType).toBe("lender");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "reports.deadlines_setup")).toBe(true);
  });

  it("uses company entity type — a broker files Financial Condition annually (9 total)", async () => {
    state.company = { entity_type: "broker" };
    const res = await app().request("/api/v1/reports/setup-deadlines", { method: "POST", headers: await jsonAuth("company_admin"), body: JSON.stringify({ jurisdiction: "TX", year: 2026 }) }, createMockEnv());
    const body = await res.json() as any;
    expect(body.total).toBe(9); // 4 + 4 + 1
  });

  it("is idempotent — already-present deadlines are skipped", async () => {
    state.existingDeadlines = [
      { obligation_key: "rmla", period_start: "2026-01-01", period_end: "2026-03-31" },
      { obligation_key: "rmla", period_start: "2026-04-01", period_end: "2026-06-30" },
    ];
    const res = await app().request("/api/v1/reports/setup-deadlines", { method: "POST", headers: await jsonAuth("company_admin"), body: JSON.stringify({ jurisdiction: "TX", year: 2026 }) }, createMockEnv());
    const body = await res.json() as any;
    expect(body.created).toBe(10);
    expect(body.skipped).toBe(2);
  });

  it("unauthorized role cannot set up deadlines", async () => {
    const res = await app().request("/api/v1/reports/setup-deadlines", { method: "POST", headers: await jsonAuth("read_only"), body: JSON.stringify({ jurisdiction: "TX" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("reports — deadlines list", () => {
  it("returns a derived summary alongside the deadlines", async () => {
    const res = await app().request("/api/v1/reports/deadlines", { headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.summary.total).toBe(2);
    expect(body.summary.filed).toBe(1);
    expect(body.deadlines).toHaveLength(2);
    expect(body.deadlines[0]).toHaveProperty("derived_status");
  });
});

describe("reports — filing evidence", () => {
  it("records a filing event, marks the deadline filed, and audits report.filed", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/reports/deadlines/d1/file", { method: "POST", headers: await jsonAuth("company_admin"), body: JSON.stringify({ confirmationNumber: "NMLS-Q1-123", filedAt: "2026-04-30" }) }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.deadline.status).toBe("filed");
    expect(state.inserts).toContain("report_filing_events");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "report.filed")).toBe(true);
  });

  it("rejects filing on another company's deadline", async () => {
    const res = await app().request("/api/v1/reports/deadlines/d1/file", { method: "POST", headers: await jsonAuth("company_admin", "company-2"), body: JSON.stringify({ confirmationNumber: "x" }) }, createMockEnv());
    expect(res.status).toBe(404);
  });

  it("non-filers cannot file", async () => {
    const res = await app().request("/api/v1/reports/deadlines/d1/file", { method: "POST", headers: await jsonAuth("loan_originator"), body: JSON.stringify({ confirmationNumber: "x" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("reports — receipt upload", () => {
  it("stores a company-scoped receipt, links it, and audits report.receipt_uploaded", async () => {
    const env = createMockEnv();
    const fd = new FormData();
    fd.append("file", new File(["%PDF-1.4 receipt"], "receipt.pdf", { type: "application/pdf" }));
    const res = await app().request("/api/v1/reports/deadlines/d1/receipt", { method: "POST", headers: await auth("company_admin"), body: fd }, env);
    expect(res.status).toBe(201);
    const keys = await listKeys(env);
    expect(keys.some((k: string) => k.startsWith("reporting-evidence/company-1/d1/"))).toBe(true);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "report.receipt_uploaded")).toBe(true);
  });

  it("non-uploaders cannot upload a receipt", async () => {
    const fd = new FormData();
    fd.append("file", new File(["%PDF-1.4"], "r.pdf", { type: "application/pdf" }));
    const res = await app().request("/api/v1/reports/deadlines/d1/receipt", { method: "POST", headers: await auth("loan_originator"), body: fd }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("reports — evidence packet", () => {
  it("generates a company-scoped packet artifact in EXPORTS", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/reports/evidence-packet", { method: "POST", headers: await jsonAuth("company_admin"), body: JSON.stringify({ loanId: "loan-1" }) }, env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.packet.type).toBe("loan");
    expect(body.packet.companyId).toBe("company-1");
    expect(body.artifactKey.startsWith("evidence-packets/company-1/")).toBe(true);
  });

  it("is company-scoped: another company cannot package this loan", async () => {
    const res = await app().request("/api/v1/reports/evidence-packet", { method: "POST", headers: await jsonAuth("company_admin", "company-2"), body: JSON.stringify({ loanId: "loan-1" }) }, createMockEnv());
    expect(res.status).toBe(404);
  });

  it("unauthorized role cannot generate a packet", async () => {
    const res = await app().request("/api/v1/reports/evidence-packet", { method: "POST", headers: await jsonAuth("read_only"), body: JSON.stringify({ loanId: "loan-1" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });
});
