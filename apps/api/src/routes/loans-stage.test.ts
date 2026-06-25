import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { loanRoutes } from "./loans";

const state = {
  loans: [{ id: "loan-1", company_id: "company-1", status: "application" }],
  requiredDocuments: [
    { id: "rd-processing", document_type: "initial_disclosure", display_name: "Initial Disclosure Package", pipeline_stage: "processing", is_mandatory: true },
  ],
  complianceChecks: [
    { loan_id: "loan-1", required_document_id: "rd-processing", result: "pending" },
  ],
  loanDocuments: [] as any[],
  timeline: [] as any[],
};

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();

    if (query.includes("SELECT * FROM loans WHERE id = ? AND company_id = ?")) {
      return state.loans.filter((loan) => loan.id === values[0] && loan.company_id === values[1]);
    }

    if (query.includes("rd.id as \"requiredDocumentId\"")) {
      const [loanId, targetStage] = values;
      const checkIds = new Set(state.complianceChecks.filter((check) => check.loan_id === loanId).map((check) => check.required_document_id));
      return state.requiredDocuments
        .filter((doc) => checkIds.has(doc.id) && doc.pipeline_stage === targetStage && doc.is_mandatory)
        .map((doc) => ({
          requiredDocumentId: doc.id,
          documentType: doc.document_type,
          displayName: doc.display_name,
          isMandatory: doc.is_mandatory,
        }));
    }

    if (query.includes("SELECT DISTINCT cc.required_document_id")) {
      const loanId = values[0];
      return state.complianceChecks
        .filter((check) => check.loan_id === loanId)
        .filter((check) => {
          if (["pass", "waived", "na"].includes(check.result)) return true;
          const doc = state.requiredDocuments.find((rd) => rd.id === check.required_document_id);
          return Boolean(doc && state.loanDocuments.some((loanDoc) => loanDoc.loan_id === loanId && loanDoc.document_type === doc.document_type));
        })
        .map((check) => ({ required_document_id: check.required_document_id }));
    }

    if (query.includes("UPDATE loans SET status = ?")) {
      const [targetStage, loanId] = values;
      const loan = state.loans.find((loan) => loan.id === loanId);
      if (loan) loan.status = targetStage;
      return [];
    }

    if (query.includes("INSERT INTO loan_timeline")) {
      const [loanId, eventType, stageFrom, stageTo, description, metadata, performedBy] = values;
      state.timeline.push({ loan_id: loanId, event_type: eventType, stage_from: stageFrom, stage_to: stageTo, description, metadata, performed_by: performedBy });
      return [];
    }

    if (query.includes("SELECT id FROM loans WHERE id = ? AND company_id = ?")) {
      return state.loans.filter((loan) => loan.id === values[0] && loan.company_id === values[1]).map((loan) => ({ id: loan.id }));
    }

    if (query.includes("SELECT lt.*, u.name as performed_by_name")) {
      return state.timeline.map((event, index) => ({ ...event, id: `tl-${index + 1}`, performed_by_name: "Test User", occurred_at: new Date().toISOString() }));
    }

    if (query.includes("SELECT COUNT(*) as total FROM loan_timeline")) return [{ total: state.timeline.length }];

    return [];
  }),
}));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";

async function makeToken(role = "processor") {
  return new SignJWT({ companyId: "company-1", email: `${role}@example.com`, role, nmlsId: null })
    .setSubject(`${role}-user`)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/api/v1/*", authMiddleware);
  app.route("/api/v1/loans", loanRoutes);
  return app;
}

describe("loan stage advancement", () => {
  beforeEach(() => {
    state.loans = [{ id: "loan-1", company_id: "company-1", status: "application" }];
    state.complianceChecks = [{ loan_id: "loan-1", required_document_id: "rd-processing", result: "pending" }];
    state.loanDocuments = [];
    state.timeline = [];
  });

  it("blocked stage advance shows missing docs", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();

    const gateRes = await app.request("/api/v1/loans/loan-1/gate/processing", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(gateRes.status).toBe(200);
    const gate = await gateRes.json() as any;
    expect(gate.canAdvance).toBe(false);
    expect(gate.unsatisfied).toEqual([{ requiredDocumentId: "rd-processing", documentType: "initial_disclosure", displayName: "Initial Disclosure Package" }]);

    const advanceRes = await app.request("/api/v1/loans/loan-1/advance", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ targetStage: "processing" }) }, env);
    expect(advanceRes.status).toBe(400);
  });

  it("successful advance updates status", async () => {
    const app = createApp();
    const env = createMockEnv();
    state.loanDocuments.push({ loan_id: "loan-1", document_type: "initial_disclosure" });

    const res = await app.request("/api/v1/loans/loan-1/advance", { method: "POST", headers: { Authorization: `Bearer ${await makeToken()}`, "Content-Type": "application/json" }, body: JSON.stringify({ targetStage: "processing" }) }, env);
    expect(res.status).toBe(200);
    expect(state.loans[0].status).toBe("processing");
    expect(state.timeline[0].event_type).toBe("stage_advanced");
  });

  it("unauthorized role cannot advance", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await app.request("/api/v1/loans/loan-1/advance", { method: "POST", headers: { Authorization: `Bearer ${await makeToken("read_only")}`, "Content-Type": "application/json" }, body: JSON.stringify({ targetStage: "processing" }) }, env);
    expect(res.status).toBe(403);
  });

  it("override requires reason", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await app.request("/api/v1/loans/loan-1/advance", { method: "POST", headers: { Authorization: `Bearer ${await makeToken("company_admin")}`, "Content-Type": "application/json" }, body: JSON.stringify({ targetStage: "processing", override: true }) }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("reason");
  });

  it("override writes audit timeline metadata", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await app.request("/api/v1/loans/loan-1/advance", { method: "POST", headers: { Authorization: `Bearer ${await makeToken("company_admin")}`, "Content-Type": "application/json" }, body: JSON.stringify({ targetStage: "processing", override: true, reason: "Compliance manager approved exception." }) }, env);
    expect(res.status).toBe(200);
    expect(state.loans[0].status).toBe("processing");
    expect(state.timeline[0].event_type).toBe("stage_override");
    expect(JSON.parse(state.timeline[0].metadata)).toMatchObject({ override: true, reason: "Compliance manager approved exception." });
    expect((env.AUDIT_QUEUE as any).messages[0]).toMatchObject({ type: "stage.override", action: "override_stage_gate" });
  });
});
