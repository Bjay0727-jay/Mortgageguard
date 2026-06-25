import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { programRoutes } from "./programs";

const state = {
  programs: [] as any[],
  versions: [] as any[],
};

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    if (q.includes("SELECT id, status FROM compliance_programs")) {
      const [id, companyId] = values;
      return state.programs.filter((p) => p.id === id && p.company_id === companyId).map((p) => ({ id: p.id, status: p.status }));
    }
    if (q.includes("SELECT id FROM compliance_programs WHERE id = ?")) {
      const [id, companyId] = values;
      return state.programs.filter((p) => p.id === id && p.company_id === companyId).map((p) => ({ id: p.id }));
    }
    if (q.includes("SELECT * FROM compliance_programs WHERE company_id = ?")) {
      return state.programs.filter((p) => p.company_id === values[0]);
    }
    if (q.includes("SELECT COUNT(*) as count FROM compliance_program_versions")) {
      const programId = values[0];
      return [{ count: state.versions.filter((v) => v.program_id === programId).length }];
    }
    if (q.includes("UPDATE compliance_program_versions SET is_current = false")) {
      const programId = values[0];
      state.versions.forEach((v) => { if (v.program_id === programId) v.is_current = false; });
      return [];
    }
    if (q.includes("INSERT INTO compliance_program_versions")) {
      const [programId, companyId, version, filePath, fileName] = values;
      const row = { id: `ver-${state.versions.length + 1}`, program_id: programId, company_id: companyId, version, file_path: filePath, file_name: fileName, is_current: true, created_at: new Date().toISOString() };
      state.versions.push(row);
      return [row];
    }
    if (q.includes("UPDATE compliance_programs SET file_path = ?")) {
      // SET file_path = $1, version = $2, status='current', ... WHERE id = $3
      const [filePath, version, programId] = values;
      const prog = state.programs.find((p) => p.id === programId);
      if (prog) { prog.status = "current"; prog.file_path = filePath; prog.version = version; }
      return prog ? [prog] : [];
    }
    if (q.includes("FROM compliance_program_versions WHERE program_id = ?")) {
      return state.versions.filter((v) => v.program_id === values[0]);
    }
    if (q.includes("INSERT INTO compliance_programs")) {
      return [{ id: "new-prog", company_id: values[0], status: "missing" }];
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
const auth = async (role: string, companyId = "company-1") => ({ Authorization: `Bearer ${await token(role, companyId)}` });
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/programs", programRoutes);
  return a;
}
function uploadReq(role: Promise<Record<string, string>>, file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return role.then((headers) => app().request("/api/v1/programs/p1/upload", { method: "POST", headers, body: fd }, createMockEnv()));
}

describe("program upload validation", () => {
  beforeEach(() => { state.programs = [{ id: "p1", company_id: "company-1", status: "missing", version: null, file_path: null }]; state.versions = []; });

  it("rejects an unsupported file type (415)", async () => {
    const res = await uploadReq(auth("company_admin"), new File(["just text"], "notes.txt", { type: "text/plain" }));
    expect(res.status).toBe(415);
  });

  it("rejects an oversized file (413)", async () => {
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    const res = await uploadReq(auth("company_admin"), big);
    expect(res.status).toBe(413);
  });

  it("accepts a valid PDF, marks the program current", async () => {
    const res = await uploadReq(auth("company_admin"), new File(["%PDF-1.4 hi"], "aml.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.program.status).toBe("current");
    expect(body.version.version).toBe("v1");
  });
});

describe("program version history", () => {
  beforeEach(() => { state.programs = [{ id: "p1", company_id: "company-1", status: "missing", version: null, file_path: null }]; state.versions = []; });

  it("retains old versions and flips is_current on each upload", async () => {
    const env = createMockEnv();
    const headers = await auth("company_admin");
    const send = (name: string) => {
      const fd = new FormData();
      fd.append("file", new File(["%PDF-1.4 x"], name, { type: "application/pdf" }));
      return app().request("/api/v1/programs/p1/upload", { method: "POST", headers, body: fd }, env);
    };
    await send("v1.pdf");
    await send("v2.pdf");

    expect(state.versions).toHaveLength(2);
    expect(state.versions.map((v) => v.version)).toEqual(["v1", "v2"]);
    const current = state.versions.filter((v) => v.is_current);
    expect(current).toHaveLength(1);
    expect(current[0].version).toBe("v2");
  });
});

describe("program RBAC", () => {
  beforeEach(() => { state.programs = [{ id: "p1", company_id: "company-1", status: "missing" }]; state.versions = []; });

  it("read_only cannot upload", async () => {
    const res = await uploadReq(auth("read_only"), new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(403);
  });

  it("read_only cannot create a program", async () => {
    const res = await app().request("/api/v1/programs", { method: "POST", headers: { ...(await auth("read_only")), "Content-Type": "application/json" }, body: JSON.stringify({ programType: "aml", programName: "AML" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("read_only cannot bootstrap", async () => {
    const res = await app().request("/api/v1/programs/bootstrap", { method: "POST", headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("cannot upload to another company's program", async () => {
    const res = await uploadReq(auth("company_admin", "company-2"), new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(404);
  });
});

describe("program summary counts", () => {
  it("reflects status counts and overdue reviews", async () => {
    state.programs = [
      { id: "a", company_id: "company-1", status: "current", next_review_due: "2020-01-01" }, // past review
      { id: "b", company_id: "company-1", status: "missing", next_review_due: null },
      { id: "c", company_id: "company-1", status: "overdue", next_review_due: null },
    ];
    const res = await app().request("/api/v1/programs", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.summary).toMatchObject({ total: 3, current: 1, overdue: 1, missing: 1 });
    expect(body.summary.overdueReview).toBe(1); // the "current" program past its review date
  });
});
