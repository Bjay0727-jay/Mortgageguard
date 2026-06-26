import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { evidencePacketRoutes } from "./evidence-packets";

const state = {
  loans: [] as any[],
  company: { name: "Acme", nmls_id: "111", entity_type: "lender", license_states: ["TX"], primary_contact: "Casey", primary_email: "casey@x.com" } as any,
  packets: [] as any[],
  failedInserts: [] as any[],
  failRules: false,
};

function reset() {
  state.loans = [{ id: "loan-1", company_id: "company-1", loan_number: "TX-1", borrower_first_name: "Sam", borrower_last_name: "Lee", property_state: "TX", loan_purpose: "purchase", loan_product: "conventional", loan_type: "fixed", lien_position: "first", occupancy_type: "primary", status: "processing", application_date: "2026-01-15", texas_cashout_type: "none", originator_nmls_id: "123", lender_name: "BankCo", lender_nmls_id: "999", compliance_score: 82 }];
  state.company = { name: "Acme", nmls_id: "111", entity_type: "lender", license_states: ["TX"], primary_contact: "Casey", primary_email: "casey@x.com" };
  state.packets = [];
  state.failedInserts = [];
  state.failRules = false;
}

function makeSql() {
  const fn = async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    if (state.failRules && q.includes("FROM state_rules")) throw new Error("boom");

    // Loan lookup
    if (q.includes("FROM loans l LEFT JOIN users u")) {
      const [loanId, companyId] = values;
      return state.loans.filter((l) => l.id === loanId && l.company_id === companyId);
    }
    if (q.includes("FROM companies WHERE id = ?")) return [state.company];
    if (q.includes("FROM state_rules")) return [{ n: 1 }];
    if (q.includes("FROM compliance_checks cc")) return [];
    if (q.includes("FROM loan_documents")) return [];
    if (q.includes("FROM loan_tasks")) return [];
    if (q.includes("FROM loan_timeline")) return [];
    if (q.includes("FROM compliance_programs")) return [];
    if (q.includes("FROM reporting_deadlines")) return [];
    if (q.includes("FROM report_exports")) return [];
    if (q.includes("FROM loans WHERE company_id")) return [{ n: 0 }];

    // INSERT failed packet
    if (q.includes("INSERT INTO evidence_packets") && q.includes("'failed'")) {
      state.failedInserts.push(values);
      return [];
    }
    // INSERT generated packet
    if (q.includes("INSERT INTO evidence_packets")) {
      const [id, company_id, packet_key, packet_type, title, , r2_key_json, r2_key_html] = values;
      const row = { id, company_id, packet_key, packet_type, title, status: "generated", generated_at: "2026-06-26T00:00:00Z", generated_by: "u", warning_count: 0, blocker_count: 0, hash: "h", r2_key_json, r2_key_html };
      state.packets.push(row);
      return [{ id, packet_key, packet_type, title, status: "generated", generated_at: row.generated_at, warning_count: 0, blocker_count: 0 }];
    }
    // List
    if (q.includes("FROM evidence_packets WHERE company_id = ? AND status <> 'deleted'")) {
      const companyId = values[0];
      return state.packets.filter((p) => p.company_id === companyId && p.status !== "deleted");
    }
    // Get by id
    if (q.includes("SELECT * FROM evidence_packets WHERE id = ?")) {
      const [id, companyId] = values;
      return state.packets.filter((p) => p.id === id && p.company_id === companyId && p.status !== "deleted");
    }
    // Download lookup
    if (q.includes("SELECT id, packet_type, status, r2_key_json, r2_key_html FROM evidence_packets")) {
      const [id, companyId] = values;
      return state.packets.filter((p) => p.id === id && p.company_id === companyId);
    }
    // Delete
    if (q.includes("UPDATE evidence_packets SET status = 'deleted'")) {
      const [id, companyId] = values;
      const p = state.packets.find((x) => x.id === id && x.company_id === companyId && x.status !== "deleted");
      if (!p) return [];
      p.status = "deleted";
      return [{ id: p.id }];
    }
    return [];
  };
  (fn as any).json = (x: any) => x;
  return fn;
}

vi.mock("postgres", () => ({ default: vi.fn(() => makeSql()) }));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";
async function token(role: string, companyId = "company-1") {
  return new SignJWT({ companyId, email: `${role}@x.com`, role, nmlsId: null })
    .setSubject(`${role}-user`).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/evidence-packets", evidencePacketRoutes);
  return a;
}
const json = async (role: string, companyId = "company-1") => ({ Authorization: `Bearer ${await token(role, companyId)}`, "Content-Type": "application/json" });
async function listKeys(env: Env) { const res = await (env.EXPORTS as any).list(); return res.objects.map((o: any) => o.key); }

beforeEach(reset);

async function generateLoan(env: Env, role = "company_admin", companyId = "company-1") {
  return app().request("/api/v1/evidence-packets/loan/loan-1", { method: "POST", headers: await json(role, companyId), body: "{}" }, env);
}

describe("evidence-packets — generation capability + scoping", () => {
  it("loan packet requires generate capability", async () => {
    const res = await generateLoan(createMockEnv(), "read_only");
    expect(res.status).toBe(403);
  });
  it("loan packet is company-scoped (other company → 404)", async () => {
    const res = await generateLoan(createMockEnv(), "company_admin", "company-2");
    expect(res.status).toBe(404);
  });
  it("program packet requires generate capability", async () => {
    const res = await app().request("/api/v1/evidence-packets/programs", { method: "POST", headers: await json("read_only"), body: "{}" }, createMockEnv());
    expect(res.status).toBe(403);
  });
  it("reporting packet requires generate capability", async () => {
    const res = await app().request("/api/v1/evidence-packets/reporting", { method: "POST", headers: await json("read_only"), body: "{}" }, createMockEnv());
    expect(res.status).toBe(403);
  });
  it("examination packet requires generate capability", async () => {
    const res = await app().request("/api/v1/evidence-packets/examination", { method: "POST", headers: await json("read_only"), body: "{}" }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("evidence-packets — generate + storage", () => {
  it("generates a loan packet and stores JSON + HTML at the expected R2 key", async () => {
    const env = createMockEnv();
    const res = await generateLoan(env);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.packet.packetKey).toBe("loan_evidence_packet");
    const keys = await listKeys(env);
    expect(keys.some((k: string) => k.startsWith("exports/company-1/evidence-packets/loan/") && k.endsWith(".json"))).toBe(true);
    expect(keys.some((k: string) => k.endsWith(".html"))).toBe(true);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "evidence_packet.generated")).toBe(true);
  });

  it("records a failed packet + audit when generation throws", async () => {
    state.failRules = true;
    const env = createMockEnv();
    const res = await generateLoan(env);
    expect(res.status).toBe(500);
    expect(state.failedInserts.length).toBe(1);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "evidence_packet.failed")).toBe(true);
  });
});

describe("evidence-packets — history / download / delete", () => {
  it("history only returns the current company's non-deleted packets", async () => {
    const env = createMockEnv();
    await generateLoan(env);
    const res = await app().request("/api/v1/evidence-packets", { headers: await json("read_only") }, env);
    const body = await res.json() as any;
    expect(body.packets).toHaveLength(1);
    // a different company sees none
    const res2 = await app().request("/api/v1/evidence-packets", { headers: await json("read_only", "company-2") }, env);
    expect(((await res2.json()) as any).packets).toHaveLength(0);
  });

  it("downloads JSON and HTML and emits a download audit event", async () => {
    const env = createMockEnv();
    const gen = await (await generateLoan(env)).json() as any;
    const id = gen.record.id;

    const jres = await app().request(`/api/v1/evidence-packets/${id}/download?format=json`, { headers: await json("read_only") }, env);
    expect(jres.status).toBe(200);
    expect(jres.headers.get("content-type")).toContain("application/json");

    const hres = await app().request(`/api/v1/evidence-packets/${id}/download?format=html`, { headers: await json("read_only") }, env);
    expect(hres.status).toBe(200);
    expect(hres.headers.get("content-type")).toContain("text/html");

    expect((env.AUDIT_QUEUE as any).messages.filter((m: any) => m.type === "evidence_packet.downloaded").length).toBe(2);
  });

  it("soft-deletes a packet and then refuses to download it", async () => {
    const env = createMockEnv();
    const gen = await (await generateLoan(env)).json() as any;
    const id = gen.record.id;

    const del = await app().request(`/api/v1/evidence-packets/${id}`, { method: "DELETE", headers: await json("company_admin") }, env);
    expect(del.status).toBe(200);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "evidence_packet.deleted")).toBe(true);

    const dl = await app().request(`/api/v1/evidence-packets/${id}/download?format=json`, { headers: await json("read_only") }, env);
    expect(dl.status).toBe(404);
  });
});
