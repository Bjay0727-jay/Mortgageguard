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

// Mock postgres.js. Branches mirror the SQL evaluateGate / advance issue, so the
// integration tests exercise the real route logic against in-memory data.
vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();

    if (query.includes("SELECT * FROM loans WHERE id = ?")) {
      return state.loans.filter((loan) => loan.id === values[0] && loan.company_id === values[1]);
    }

    // Mandatory required documents gating the target stage.
    if (query.includes('rd.id as "requiredDocumentId"')) {
      const [loanId, targetStage] = values;
      const checkIds = new Set(state.complianceChecks.filter((check) => check.loan_id === loanId).map((check) => check.required_document_id));
      return state.requiredDocuments
        .filter((doc) => checkIds.has(doc.id) && doc.pipeline_stage === targetStage && doc.is_mandatory)
        .map((doc) => ({ requiredDocumentId: doc.id, documentType: doc.document_type, displayName: doc.display_name }));
    }

    // Waived / N/A compliance checks.
    if (query.includes("result IN ('waived', 'na')")) {
      const loanId = values[0];
      return state.complianceChecks
        .filter((check) => check.loan_id === loanId && ["waived", "na"].includes(check.result))
        .map((check) => ({ required_document_id: check.required_document_id }));
    }

    // All documents for the loan (gate picks latest valid per type).
    if (query.includes('uploaded_at as "uploadedAt"')) {
      const loanId = values[0];
      return state.loanDocuments
        .filter((doc) => doc.loan_id === loanId)
        .map((doc) => ({ documentType: doc.document_type, status: doc.status, uploadedAt: doc.uploaded_at }));
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

    if (query.includes("SELECT id FROM loans WHERE id = ?")) {
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

const json = (body: unknown, token: string) => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const validDoc = () => ({ loan_id: "loan-1", document_type: "initial_disclosure", status: "uploaded", uploaded_at: new Date().toISOString() });

describe("loan stage advancement", () => {
  beforeEach(() => {
    state.loans = [{ id: "loan-1", company_id: "company-1", status: "application" }];
    state.complianceChecks = [{ loan_id: "loan-1", required_document_id: "rd-processing", result: "pending" }];
    state.loanDocuments = [];
    state.timeline = [];
  });

  it("preview and advance agree when required documents are missing", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();

    const gateRes = await app.request("/api/v1/loans/loan-1/gate/processing", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(gateRes.status).toBe(200);
    const gate = await gateRes.json() as any;
    expect(gate.canAdvance).toBe(false);
    expect(gate.unsatisfied).toEqual([{ requiredDocumentId: "rd-processing", documentType: "initial_disclosure", displayName: "Initial Disclosure Package" }]);
    expect(gate.blockers.length).toBeGreaterThan(0);

    const advanceRes = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing" }, token), env);
    expect(advanceRes.status).toBe(400);
    const body = await advanceRes.json() as any;
    expect(body.code).toBe("GATE_UNSATISFIED");
    expect(body.gate.canAdvance).toBe(false);
  });

  it("preview and advance agree when required documents are satisfied", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();
    state.loanDocuments.push(validDoc());

    const gate = await (await app.request("/api/v1/loans/loan-1/gate/processing", { headers: { Authorization: `Bearer ${token}` } }, env)).json() as any;
    expect(gate.canAdvance).toBe(true);

    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing" }, token), env);
    expect(res.status).toBe(200);
    expect(state.loans[0].status).toBe("processing");
    expect(state.timeline[0].event_type).toBe("stage_advanced");
  });

  it("no mandatory requirements configured is non-blocking and warns", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();
    state.complianceChecks = []; // nothing configured for this loan

    const gate = await (await app.request("/api/v1/loans/loan-1/gate/processing", { headers: { Authorization: `Bearer ${token}` } }, env)).json() as any;
    expect(gate.canAdvance).toBe(true);
    expect(gate.warnings).toContain("No mandatory document requirements are configured for this stage.");

    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing" }, token), env);
    expect(res.status).toBe(200);
  });

  it("a rejected document does not satisfy the gate", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();
    state.loanDocuments.push({ ...validDoc(), status: "rejected" });

    const gate = await (await app.request("/api/v1/loans/loan-1/gate/processing", { headers: { Authorization: `Bearer ${token}` } }, env)).json() as any;
    expect(gate.canAdvance).toBe(false);

    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing" }, token), env);
    expect(res.status).toBe(400);
  });

  it("invalid transition is blocked in preview and advance (not overrideable)", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken("company_admin");

    const gate = await (await app.request("/api/v1/loans/loan-1/gate/closing", { headers: { Authorization: `Bearer ${token}` } }, env)).json() as any;
    expect(gate.canAdvance).toBe(false);
    expect(gate.transitionValid).toBe(false);

    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "closing", override: true, reason: "force" }, token), env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toBe("Invalid stage transition");
    expect(body.allowedTargets).toContain("processing");
  });

  it("terminal loan cannot advance", async () => {
    const app = createApp();
    const env = createMockEnv();
    state.loans[0].status = "denied";
    const token = await makeToken("company_admin");

    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing", override: true, reason: "x" }, token), env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("terminal");
    expect(body.allowedTargets).toEqual([]);
  });

  it("gate preview requires the advanceLoanStage capability", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await app.request("/api/v1/loans/loan-1/gate/processing", { headers: { Authorization: `Bearer ${await makeToken("read_only")}` } }, env);
    expect(res.status).toBe(403);
  });

  it("unauthorized role cannot advance", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing" }, await makeToken("read_only")), env);
    expect(res.status).toBe(403);
  });

  it("override requires the overrideCompliance capability", async () => {
    const app = createApp();
    const env = createMockEnv();
    // loan_originator has advanceLoanStage but NOT overrideCompliance.
    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing", override: true, reason: "please" }, await makeToken("loan_originator")), env);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.code).toBe("OVERRIDE_FORBIDDEN");
  });

  it("override requires reason", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing", override: true }, await makeToken("company_admin")), env);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("reason");
  });

  it("override writes audit metadata including blockers, warnings, and unsatisfied docs", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await app.request("/api/v1/loans/loan-1/advance", json({ targetStage: "processing", override: true, reason: "Compliance manager approved exception." }, await makeToken("company_admin")), env);
    expect(res.status).toBe(200);
    expect(state.loans[0].status).toBe("processing");
    expect(state.timeline[0].event_type).toBe("stage_override");

    const meta = JSON.parse(state.timeline[0].metadata);
    expect(meta).toMatchObject({ override: true, reason: "Compliance manager approved exception." });
    expect(meta.blockers.length).toBeGreaterThan(0);
    expect(meta.unsatisfied).toHaveLength(1);
    expect(Array.isArray(meta.warnings)).toBe(true);

    const audit = (env.AUDIT_QUEUE as any).messages[0];
    expect(audit).toMatchObject({ type: "stage.override", action: "override_stage_gate" });
    expect(audit.details.unsatisfied).toHaveLength(1);
  });
});
