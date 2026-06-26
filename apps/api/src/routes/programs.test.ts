import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { programRoutes } from "./programs";

interface State {
  programs: any[];
  versions: any[];
  sources: any[];
  links: any[];
  evidenceReqs: any[];
  docReqs: any[];
  evidence: any[];
  reviews: any[];
  allowsRemote: boolean | null;
}
const state: State = { programs: [], versions: [], sources: [], links: [], evidenceReqs: [], docReqs: [], evidence: [], reviews: [], allowsRemote: true };

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    // ── Catalog seeding (global) ──
    if (q.includes("INSERT INTO regulatory_sources")) {
      const [source_key, title, citation, jurisdiction, agency, source_type, source_url, rulemaking_citation, rulemaking_url, guidance_url, notes] = values;
      if (!state.sources.find((s) => s.source_key === source_key)) {
        state.sources.push({ source_key, title, citation, jurisdiction, agency, source_type, source_url, rulemaking_url, guidance_url, notes, verification_status: "unverified", last_verified_at: null, next_verification_due_at: null });
      }
      return [];
    }
    if (q.includes("INSERT INTO compliance_program_source_links")) {
      const [program_key, source_key, citation, applies_to] = values;
      if (!state.links.find((l) => l.program_key === program_key && l.source_key === source_key)) {
        state.links.push({ program_key, source_key, citation, applies_to });
      }
      return [];
    }
    if (q.includes("INSERT INTO compliance_program_evidence_requirements")) {
      const [program_key, evidence_key, display_name, description, required, source_key, cadence_months] = values;
      if (!state.evidenceReqs.find((e) => e.program_key === program_key && e.evidence_key === evidence_key)) {
        state.evidenceReqs.push({ program_key, evidence_key, display_name, description, required, source_key, cadence_months });
      }
      return [];
    }
    if (q.includes("INSERT INTO compliance_program_document_requirements")) {
      const [program_key, document_type, display_name, required] = values;
      if (!state.docReqs.find((d) => d.program_key === program_key && d.document_type === document_type)) {
        state.docReqs.push({ program_key, document_type, display_name, required });
      }
      return [];
    }

    if (q.includes("SELECT allows_remote_work FROM companies")) {
      return [{ allows_remote_work: state.allowsRemote }];
    }

    // ── ensureProgram (idempotent NOT EXISTS insert) ──
    if (q.includes("INSERT INTO compliance_programs") && q.includes("WHERE NOT EXISTS")) {
      const company_id = values[0];
      const program_key = values[3];
      if (state.programs.find((p) => p.company_id === company_id && p.program_key === program_key)) return [];
      const row = {
        id: `prog-${state.programs.length + 1}`,
        company_id,
        program_type: values[1],
        program_name: values[2],
        program_key,
        category: values[4],
        is_required: values[5],
        is_conditionally_required: values[6],
        applicable: values[7],
        required_by: values[8],
        required_document_type: values[9],
        required_document_name: values[10],
        review_frequency_months: values[11],
        status: values[12],
        file_path: null, document_status: null, owner: null, version: null,
        last_reviewed_at: null, next_review_due: null, archived: false,
      };
      state.programs.push(row);
      return [{ id: row.id }];
    }
    if (q.includes("INSERT INTO compliance_programs")) {
      const row = { id: `adhoc-${state.programs.length + 1}`, company_id: values[0], program_key: null, status: "missing" };
      state.programs.push(row);
      return [row];
    }

    // ── reads ──
    if (q.includes("SELECT id, status FROM compliance_programs")) {
      const [id, companyId] = values;
      return state.programs.filter((p) => p.id === id && p.company_id === companyId).map((p) => ({ id: p.id, status: p.status }));
    }
    if (q.includes("SELECT review_frequency_months FROM compliance_programs")) {
      const [id, companyId] = values;
      return state.programs.filter((p) => p.id === id && p.company_id === companyId).map((p) => ({ review_frequency_months: p.review_frequency_months ?? 12 }));
    }
    if (q.includes("SELECT file_path, program_name FROM compliance_programs")) {
      const [id, companyId] = values;
      return state.programs.filter((p) => p.id === id && p.company_id === companyId).map((p) => ({ file_path: p.file_path, program_name: p.program_name }));
    }
    if (q.includes("SELECT id FROM compliance_programs WHERE id = ?")) {
      const [id, companyId] = values;
      return state.programs.filter((p) => p.id === id && p.company_id === companyId).map((p) => ({ id: p.id }));
    }
    if (q.includes("SELECT * FROM compliance_programs WHERE id = ?")) {
      const [id] = values;
      return state.programs.filter((p) => p.id === id);
    }
    if (q.includes("SELECT * FROM compliance_programs WHERE company_id = ?")) {
      return state.programs.filter((p) => p.company_id === values[0]);
    }
    if (q.includes("SELECT * FROM compliance_program_evidence_requirements")) {
      return state.evidenceReqs;
    }
    if (q.includes("SELECT * FROM compliance_program_evidence WHERE company_id = ?")) {
      return state.evidence.filter((e) => e.company_id === values[0]);
    }
    if (q.includes("FROM compliance_program_source_links l JOIN regulatory_sources")) {
      return state.links.map((l) => {
        const s = state.sources.find((x) => x.source_key === l.source_key) || {};
        return { ...l, title: s.title, agency: s.agency, jurisdiction: s.jurisdiction, source_url: s.source_url, rulemaking_url: s.rulemaking_url, guidance_url: s.guidance_url, last_verified_at: s.last_verified_at, next_verification_due_at: s.next_verification_due_at, verification_status: s.verification_status };
      });
    }

    // ── mutations ──
    if (q.includes("INSERT INTO compliance_program_evidence")) {
      const [company_id, program_id, evidence_key, status, notes] = values;
      const existing = state.evidence.find((e) => e.program_id === program_id && e.evidence_key === evidence_key);
      if (existing) { existing.status = status; existing.notes = notes; }
      else state.evidence.push({ company_id, program_id, evidence_key, status, notes });
      return [];
    }
    if (q.includes("UPDATE compliance_programs SET status = ?")) {
      const [status, id] = values;
      const p = state.programs.find((x) => x.id === id);
      if (p) p.status = status;
      return [];
    }
    if (q.includes("UPDATE compliance_programs SET file_path = ?")) {
      const [file_path, version, id] = values;
      const p = state.programs.find((x) => x.id === id);
      if (p) { p.file_path = file_path; p.version = version; p.document_status = "current"; p.status = "current"; p.last_reviewed_at = "2026-01-01"; p.next_review_due = "2027-01-01"; }
      return p ? [p] : [];
    }
    if (q.includes("UPDATE compliance_programs SET last_reviewed_at = CURRENT_DATE")) {
      const [nextDue, , id] = values;
      const p = state.programs.find((x) => x.id === id);
      if (p) { p.last_reviewed_at = "2026-06-26"; p.next_review_due = nextDue || "2027-06-26"; }
      return [];
    }
    if (q.includes("UPDATE compliance_programs SET program_name = COALESCE")) {
      const p = state.programs.find((x) => x.id === values[values.length - 1]);
      return p ? [p] : [];
    }
    if (q.includes("SELECT COUNT(*) as count FROM compliance_program_versions")) {
      return [{ count: state.versions.filter((v) => v.program_id === values[0]).length }];
    }
    if (q.includes("UPDATE compliance_program_versions SET is_current = false")) {
      state.versions.forEach((v) => { if (v.program_id === values[0]) v.is_current = false; });
      return [];
    }
    if (q.includes("INSERT INTO compliance_program_versions")) {
      const [program_id, company_id, version, file_path, file_name] = values;
      const row = { id: `ver-${state.versions.length + 1}`, program_id, company_id, version, file_path, file_name, is_current: true, created_at: "2026-01-01" };
      state.versions.push(row);
      return [row];
    }
    if (q.includes("FROM compliance_program_versions WHERE program_id = ?")) {
      return state.versions.filter((v) => v.program_id === values[0]);
    }
    if (q.includes("INSERT INTO compliance_program_reviews")) {
      state.reviews.push({ id: `rev-${state.reviews.length + 1}`, program_id: values[1] });
      return [];
    }
    if (q.includes("FROM compliance_program_reviews WHERE program_id = ?")) {
      return state.reviews.filter((r) => r.program_id === values[0]);
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

function reset() {
  state.programs = []; state.versions = []; state.sources = []; state.links = [];
  state.evidenceReqs = []; state.docReqs = []; state.evidence = []; state.reviews = [];
  state.allowsRemote = true;
}

describe("setup required programs", () => {
  beforeEach(reset);

  it("seeds catalog + creates required program rows", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(5);
    expect(body.programs).toHaveLength(5);
    // Regulatory sources + evidence + links + doc requirements all seeded.
    expect(state.sources.length).toBeGreaterThanOrEqual(8);
    expect(state.evidenceReqs.length).toBeGreaterThan(20);
    expect(state.links.length).toBeGreaterThan(5);
    expect(state.docReqs.length).toBeGreaterThanOrEqual(5);
    // Audit event emitted.
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.action === "setup_required_programs")).toBe(true);
  });

  it("is idempotent (second run creates nothing, no duplicate rows)", async () => {
    const env = createMockEnv();
    await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, env);
    const res2 = await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, env);
    const body2 = await res2.json() as any;
    expect(body2.created).toBe(0);
    expect(state.programs).toHaveLength(5);
    expect(state.sources).toHaveLength(8);
  });

  it("uses the full Loan Originator and Lender Compensation Agreements name", async () => {
    await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    const names = state.programs.map((p) => p.program_name);
    expect(names).toContain("Loan Originator and Lender Compensation Agreements");
  });

  it("required programs start missing with their source-backed citations", async () => {
    const res = await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    const aml = body.programs.find((p: any) => p.programKey === "aml_program");
    expect(aml.status).toBe("missing");
    expect(aml.requiredBy).toBe("31 CFR 1029.210");
    expect(aml.sources.length).toBeGreaterThan(0);
    expect(aml.evidence.length).toBeGreaterThan(0);
  });

  it("read_only cannot run setup", async () => {
    const res = await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("remote work conditional requirement", () => {
  beforeEach(reset);

  it("is required (applicable) when remote work is enabled", async () => {
    state.allowsRemote = true;
    const res = await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    const rw = body.programs.find((p: any) => p.programKey === "remote_work_policy");
    expect(rw.applicable).toBe(true);
    expect(rw.status).toBe("missing");
  });

  it("is not applicable when remote work is disabled", async () => {
    state.allowsRemote = false;
    const res = await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    const rw = body.programs.find((p: any) => p.programKey === "remote_work_policy");
    expect(rw.applicable).toBe(false);
    expect(rw.status).toBe("not_applicable");
  });
});

describe("setup recommended programs", () => {
  beforeEach(reset);
  it("creates the optional recommended programs without blocking", async () => {
    const res = await app().request("/api/v1/programs/setup-recommended", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.created).toBe(5);
    expect(body.programs.every((p: any) => p.isRequired === false)).toBe(true);
  });
});

describe("program document upload", () => {
  beforeEach(() => {
    reset();
    state.programs = [{ id: "p1", company_id: "company-1", program_key: null, status: "missing", version: null, file_path: null }];
  });
  const uploadReq = (role: Promise<Record<string, string>>, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return role.then((headers) => app().request("/api/v1/programs/p1/documents", { method: "POST", headers, body: fd }, createMockEnv()));
  };

  it("rejects unsupported types (415) and oversized files (413)", async () => {
    expect((await uploadReq(auth("company_admin"), new File(["x"], "n.txt", { type: "text/plain" }))).status).toBe(415);
    const big = new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" });
    expect((await uploadReq(auth("company_admin"), big)).status).toBe(413);
  });

  it("accepts a valid PDF and records a version", async () => {
    const res = await uploadReq(auth("company_admin"), new File(["%PDF-1.4 hi"], "aml.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.version.version).toBe("v1");
    expect(body.program.filePath).toBeTruthy();
  });

  it("read_only cannot upload", async () => {
    expect((await uploadReq(auth("read_only"), new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }))).status).toBe(403);
  });

  it("cannot upload to another company's program", async () => {
    expect((await uploadReq(auth("company_admin", "company-2"), new File(["%PDF-1.4"], "x.pdf", { type: "application/pdf" }))).status).toBe(404);
  });
});

describe("evidence + status integration", () => {
  beforeEach(reset);

  it("uploading the document then all evidence drives the program to current", async () => {
    // Seed a verified source so the source check passes.
    state.allowsRemote = false; // skip remote work to simplify
    await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    // Mark all sources verified with a future due date.
    state.sources.forEach((s) => { s.verification_status = "verified"; s.next_verification_due_at = new Date(Date.now() + 365 * 86_400_000).toISOString(); });
    const aml = state.programs.find((p) => p.program_key === "aml_program");
    // Upload document.
    const fd = new FormData();
    fd.append("file", new File(["%PDF-1.4 hi"], "aml.pdf", { type: "application/pdf" }));
    await app().request(`/api/v1/programs/${aml.id}/documents`, { method: "POST", headers: await auth("company_admin"), body: fd }, createMockEnv());
    aml.owner = "Compliance Lead"; // owner assigned
    // Satisfy every AML evidence item.
    const env = createMockEnv();
    for (const r of state.evidenceReqs.filter((e) => e.program_key === "aml_program")) {
      await app().request(`/api/v1/programs/${aml.id}/evidence`, { method: "POST", headers: { ...(await auth("company_admin")), "Content-Type": "application/json" }, body: JSON.stringify({ evidenceKey: r.evidence_key, status: "accepted" }) }, env);
    }
    const res = await app().request("/api/v1/programs", { headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    const amlEnriched = body.programs.find((p: any) => p.programKey === "aml_program");
    expect(amlEnriched.status).toBe("current");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.action === "update_program_evidence")).toBe(true);
  });

  it("read_only cannot mutate evidence", async () => {
    state.programs = [{ id: "p1", company_id: "company-1", program_key: "aml_program" }];
    const res = await app().request("/api/v1/programs/p1/evidence", { method: "POST", headers: { ...(await auth("read_only")), "Content-Type": "application/json" }, body: JSON.stringify({ evidenceKey: "aml_policy_document" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });
});

describe("program summary", () => {
  beforeEach(reset);
  it("derives integrity status counts", async () => {
    await app().request("/api/v1/programs/setup-required", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    const res = await app().request("/api/v1/programs", { headers: await auth("company_admin") }, createMockEnv());
    const body = await res.json() as any;
    expect(body.summary.total).toBe(5);
    // All required docs missing on a fresh setup.
    expect(body.summary.missing).toBeGreaterThanOrEqual(4);
  });
});
