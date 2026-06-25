import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { documentRoutes } from "./documents";
import { loanRoutes } from "./loans";

vi.mock("../services/compliance-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/compliance-engine")>();
  return {
    ...actual,
    generateChecklist: vi.fn(async () => [
      {
        documentType: "initial_disclosure",
        displayName: "Initial Disclosure Package",
        isMandatory: true,
        weight: 3,
        pipelineStage: "application",
        source: "federal",
      },
    ]),
  };
});

const state = {
  loans: [{ id: "loan-1", company_id: "company-1", property_state: "TX", loan_type: "fixed", loan_purpose: "purchase", loan_product: "conventional" }],
  documents: [] as any[],
};

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();

    if (query.includes("SELECT id FROM loans WHERE id = ? AND company_id = ?")) {
      return state.loans.filter((loan) => loan.id === values[0] && loan.company_id === values[1]).map((loan) => ({ id: loan.id }));
    }

    if (query.includes("SELECT * FROM loans WHERE id = ? AND company_id = ?")) {
      return state.loans.filter((loan) => loan.id === values[0] && loan.company_id === values[1]);
    }

    if (query.includes("SELECT id, file_path FROM loan_documents")) {
      const [loanId, documentType] = values;
      return state.documents
        .filter((doc) => doc.loan_id === loanId && doc.document_type === documentType)
        .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
        .slice(0, 1)
        .map((doc) => ({ id: doc.id, file_path: doc.file_path }));
    }

    if (query.includes("INSERT INTO loan_documents")) {
      const doc = {
        id: `doc-${state.documents.length + 1}`,
        loan_id: values[0],
        document_type: values[1],
        file_name: values[2],
        file_path: values[3],
        file_size: values[4],
        mime_type: values[5],
        uploaded_by: values[6],
        status: "uploaded",
        is_signed: false,
        uploaded_at: new Date(Date.now() + state.documents.length).toISOString(),
      };
      state.documents.push(doc);
      return [doc];
    }

    if (query.includes("SELECT DISTINCT ON (document_type)")) {
      const loanId = values[0];
      const latest = new Map<string, any>();
      for (const doc of state.documents.filter((doc) => doc.loan_id === loanId)) latest.set(doc.document_type, doc);
      return [...latest.values()].map((doc) => ({
        id: doc.id,
        document_type: doc.document_type,
        file_name: doc.file_name,
        file_size: doc.file_size,
        mime_type: doc.mime_type,
        uploaded_by: doc.uploaded_by,
        status: doc.status,
        is_signed: doc.is_signed,
        uploaded_at: doc.uploaded_at,
      }));
    }

    if (query.includes("SELECT ld.* FROM loan_documents")) {
      const docId = values[0];
      const loanId = values[1];
      const companyId = values[2];
      const loan = state.loans.find((loan) => loan.id === loanId && loan.company_id === companyId);
      if (!loan) return [];
      return state.documents.filter((doc) => doc.id === docId && doc.loan_id === loanId);
    }

    if (query.includes("DELETE FROM loan_documents")) {
      const docId = values[0];
      state.documents = state.documents.filter((doc) => doc.id !== docId);
      return [];
    }

    return [];
  }),
}));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";

async function makeToken(role = "processor", companyId = "company-1") {
  return new SignJWT({ companyId, email: `${role}@example.com`, role, nmlsId: null })
    .setSubject(`${role}-user`)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

function createApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/api/v1/*", authMiddleware);
  app.route("/api/v1/documents", documentRoutes);
  app.route("/api/v1/loans", loanRoutes);
  return app;
}

function pdfFile(name = "Unsafe Name!.pdf", sizePadding = "") {
  return new File([`%PDF-1.4\n${sizePadding}`], name, { type: "application/pdf" });
}

async function upload(app: Hono<{ Bindings: Env }>, env: Env, token: string, file: File, documentType = "initial_disclosure") {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("documentType", documentType);
  return app.request("/api/v1/documents/upload/loan-1", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd }, env);
}

describe("document routes", () => {
  beforeEach(() => {
    state.loans = [{ id: "loan-1", company_id: "company-1", property_state: "TX", loan_type: "fixed", loan_purpose: "purchase", loan_product: "conventional" }];
    state.documents = [];
  });

  it("upload valid file succeeds", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await upload(app, env, await makeToken(), pdfFile());
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.document.file_name).toBe("Unsafe-Name-.pdf");
    expect(body.document.mime_type).toBe("application/pdf");
    expect(state.documents).toHaveLength(1);
  });

  it("invalid MIME fails", async () => {
    const app = createApp();
    const env = createMockEnv();
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    const res = await upload(app, env, await makeToken(), file);
    expect(res.status).toBe(415);
  });

  it("oversized file fails", async () => {
    const app = createApp();
    const env = createMockEnv();
    const file = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" });
    const res = await upload(app, env, await makeToken(), file);
    expect(res.status).toBe(413);
  });

  it("checklist row updates after upload", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();
    await upload(app, env, token, pdfFile("initial.pdf"));

    const res = await app.request("/api/v1/loans/loan-1/checklist", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.checklist[0]).toMatchObject({
      uploaded: true,
      documentId: "doc-1",
      fileName: "initial.pdf",
      mimeType: "application/pdf",
      uploadedBy: "processor-user",
      status: "uploaded",
    });
  });

  it("unauthorized role cannot upload", async () => {
    const app = createApp();
    const env = createMockEnv();
    const res = await upload(app, env, await makeToken("read_only"), pdfFile());
    expect(res.status).toBe(403);
  });

  it("document download is company-scoped", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();
    await upload(app, env, token, pdfFile("download.pdf"));

    const otherCompanyToken = await makeToken("processor", "company-2");
    const denied = await app.request("/api/v1/documents/loan-1/doc-1/download", { headers: { Authorization: `Bearer ${otherCompanyToken}` } }, env);
    expect(denied.status).toBe(404);

    const allowed = await app.request("/api/v1/documents/loan-1/doc-1/download", { headers: { Authorization: `Bearer ${token}` } }, env);
    expect(allowed.status).toBe(200);
  });

  it("replacing a document supersedes the prior one for the checklist (latest valid wins)", async () => {
    const app = createApp();
    const env = createMockEnv();
    const token = await makeToken();

    const first = await upload(app, env, token, pdfFile("first.pdf"));
    expect(first.status).toBe(201);

    const second = await upload(app, env, token, pdfFile("second.pdf"));
    expect(second.status).toBe(200); // replacement, not a new create
    const body = await second.json() as any;
    expect(body.replacedDocumentId).toBe("doc-1");
    expect(state.documents).toHaveLength(2);

    // Checklist reflects the latest document; the new upload carries a valid status.
    const checklist = await (await app.request("/api/v1/loans/loan-1/checklist", { headers: { Authorization: `Bearer ${token}` } }, env)).json() as any;
    expect(checklist.checklist[0].documentId).toBe("doc-2");
    expect(checklist.checklist[0].fileName).toBe("second.pdf");
    expect(checklist.checklist[0].status).toBe("uploaded");
  });
});
