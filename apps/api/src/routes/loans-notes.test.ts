import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { loanRoutes } from "./loans";

const state = {
  loans: [{ id: "loan-1", company_id: "company-1" }],
  notes: [] as any[],
  timeline: [
    { event_type: "loan_updated" },
    { event_type: "document_uploaded" },
    { event_type: "task_created" },
    { event_type: "note_created" },
    { event_type: "stage_advanced" },
  ],
  inserts: [] as string[],
};

function reset() {
  state.loans = [{ id: "loan-1", company_id: "company-1" }];
  state.notes = [{ id: "n1", company_id: "company-1", loan_id: "loan-1", note_type: "general", body: "Existing", visibility: "internal", is_deleted: false }];
  state.inserts = [];
}

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    if (q.includes("FROM loans WHERE id = ? AND company_id = ? AND is_deleted = false")) {
      const [id, companyId] = values;
      return state.loans.filter((l) => l.id === id && l.company_id === companyId).map((l) => ({ id: l.id }));
    }
    if (q.includes("SELECT id FROM loans WHERE id = ? AND company_id")) {
      const [id, companyId] = values;
      return state.loans.filter((l) => l.id === id && l.company_id === companyId).map((l) => ({ id: l.id }));
    }
    // Notes list
    if (q.includes("FROM loan_notes n LEFT JOIN users u")) {
      const [loanId, companyId] = values;
      return state.notes.filter((n) => n.loan_id === loanId && n.company_id === companyId && !n.is_deleted);
    }
    if (q.startsWith("INSERT INTO loan_notes")) {
      const [company_id, loan_id, note_type, body, visibility] = values;
      const note = { id: `n${state.notes.length + 1}`, company_id, loan_id, note_type, body, visibility, is_deleted: false, created_by: "u", created_at: "now", updated_at: "now" };
      state.notes.push(note);
      return [note];
    }
    if (q.startsWith("UPDATE loan_notes SET body")) {
      const noteId = values[3];
      const n = state.notes.find((x) => x.id === noteId && !x.is_deleted);
      if (!n) return [];
      if (values[0] != null) n.body = values[0];
      return [n];
    }
    if (q.startsWith("UPDATE loan_notes SET is_deleted")) {
      const noteId = values[0];
      const n = state.notes.find((x) => x.id === noteId && !x.is_deleted);
      if (!n) return [];
      n.is_deleted = true;
      return [{ id: n.id }];
    }
    if (q.startsWith("INSERT INTO loan_timeline")) { state.inserts.push("timeline"); return []; }

    // Timeline list with optional ILIKE ANY filter (patterns passed as a value)
    if (q.includes("FROM loan_timeline lt")) {
      const patterns: string[] | undefined = values.find((v) => Array.isArray(v));
      if (!patterns) return state.timeline;
      const rx = patterns.map((p) => new RegExp("^" + p.replace(/%/g, ".*") + "$"));
      return state.timeline.filter((e) => rx.some((r) => r.test(e.event_type)));
    }
    if (q.includes("COUNT(*) as total FROM loan_timeline")) {
      const patterns: string[] | undefined = values.find((v) => Array.isArray(v));
      if (!patterns) return [{ total: state.timeline.length }];
      const rx = patterns.map((p) => new RegExp("^" + p.replace(/%/g, ".*") + "$"));
      return [{ total: state.timeline.filter((e) => rx.some((r) => r.test(e.event_type))).length }];
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
  a.route("/api/v1/loans", loanRoutes);
  return a;
}
const json = async (role: string, companyId = "company-1") => ({ Authorization: `Bearer ${await token(role, companyId)}`, "Content-Type": "application/json" });

beforeEach(reset);

describe("loan notes", () => {
  it("lists company-scoped notes", async () => {
    const res = await app().request("/api/v1/loans/loan-1/notes", { headers: await json("read_only") }, createMockEnv());
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).notes).toHaveLength(1);
  });

  it("is company-scoped — another company gets 404", async () => {
    const res = await app().request("/api/v1/loans/loan-1/notes", { method: "POST", headers: await json("company_admin", "company-2"), body: JSON.stringify({ body: "hi" }) }, createMockEnv());
    expect(res.status).toBe(404);
  });

  it("a capable user can create a note (audited + timelined)", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/loans/loan-1/notes", { method: "POST", headers: await json("processor"), body: JSON.stringify({ body: "Called borrower", noteType: "borrower_follow_up" }) }, env);
    expect(res.status).toBe(201);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "loan.note_created")).toBe(true);
    expect(state.inserts).toContain("timeline");
  });

  it("rejects an empty note body", async () => {
    const res = await app().request("/api/v1/loans/loan-1/notes", { method: "POST", headers: await json("processor"), body: JSON.stringify({ body: "   " }) }, createMockEnv());
    expect(res.status).toBe(400);
  });

  it("read-only cannot create a note", async () => {
    const res = await app().request("/api/v1/loans/loan-1/notes", { method: "POST", headers: await json("read_only"), body: JSON.stringify({ body: "x" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("updates a note + audits", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/loans/loan-1/notes/n1", { method: "PATCH", headers: await json("company_admin"), body: JSON.stringify({ body: "Edited" }) }, env);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).note.body).toBe("Edited");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "loan.note_updated")).toBe(true);
  });

  it("soft-deletes a note + audits", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/loans/loan-1/notes/n1", { method: "DELETE", headers: await json("company_admin") }, env);
    expect(res.status).toBe(200);
    expect(state.notes.find((n) => n.id === "n1")?.is_deleted).toBe(true);
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "loan.note_deleted")).toBe(true);
  });
});

describe("loan timeline filter", () => {
  it("returns all events unfiltered", async () => {
    const res = await app().request("/api/v1/loans/loan-1/timeline", { headers: await json("read_only") }, createMockEnv());
    expect(((await res.json()) as any).events).toHaveLength(5);
  });

  it("filters by event category", async () => {
    const res = await app().request("/api/v1/loans/loan-1/timeline?type=notes", { headers: await json("read_only") }, createMockEnv());
    const body = await res.json() as any;
    expect(body.events.every((e: any) => e.event_type.includes("note"))).toBe(true);
    expect(body.events).toHaveLength(1);
  });
});
