import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { outboxRoutes } from "./outbox";

const state = { events: [] as any[] };

function reset() {
  state.events = [
    { id: "e1", company_id: "company-1", event_type: "loan.created", aggregate_type: "loan", aggregate_id: "L1", payload: { token: "abc", loanNumber: "TX-1" }, status: "pending", attempts: 0, max_attempts: 5, next_attempt_at: "2020-01-01T00:00:00Z", created_at: "2026-06-01" },
    { id: "e2", company_id: "company-1", event_type: "report.filed", aggregate_type: "reporting_deadline", aggregate_id: "d1", payload: {}, status: "failed", attempts: 1, max_attempts: 5, next_attempt_at: "2020-01-01T00:00:00Z", created_at: "2026-06-02" },
    { id: "e9", company_id: "company-2", event_type: "loan.created", aggregate_type: "loan", aggregate_id: "L9", payload: {}, status: "pending", attempts: 0, max_attempts: 5, next_attempt_at: "2020-01-01T00:00:00Z", created_at: "2026-06-03" },
  ];
}

vi.mock("postgres", () => ({
  default: vi.fn(() => {
    const fn = async (strings: TemplateStringsArray, ...values: any[]) => {
      const q = strings.join("?").replace(/\s+/g, " ").trim();
      if (q.startsWith("SELECT * FROM event_outbox WHERE company_id")) {
        return state.events.filter((e) => e.company_id === values[0]);
      }
      if (q.includes("SELECT status, COUNT(*)") && q.includes("FROM event_outbox")) {
        const company = values[0];
        const counts: Record<string, number> = {};
        state.events.filter((e) => e.company_id === company).forEach((e) => (counts[e.status] = (counts[e.status] || 0) + 1));
        return Object.entries(counts).map(([status, n]) => ({ status, n }));
      }
      if (q.startsWith("SELECT * FROM event_outbox WHERE id")) {
        const [id, company] = values;
        return state.events.filter((e) => e.id === id && e.company_id === company);
      }
      if (q.startsWith("SELECT id FROM event_outbox WHERE id")) {
        const [id, company] = values;
        return state.events.filter((e) => e.id === id && e.company_id === company).map((e) => ({ id: e.id }));
      }
      // claim for process
      if (q.startsWith("UPDATE event_outbox SET status = 'processing'")) {
        const claimed = state.events.filter((e) => ["pending", "failed"].includes(e.status));
        claimed.forEach((e) => (e.status = "processing"));
        return claimed;
      }
      if (q.startsWith("UPDATE event_outbox SET status = 'processed'")) {
        const e = state.events.find((x) => x.id === values[values.length - 1]);
        if (e) e.status = "processed";
        return [];
      }
      if (q.startsWith("UPDATE event_outbox SET status = 'pending'")) {
        // retry (scoped)
        const id = values[0];
        const company = values[1];
        const e = state.events.find((x) => x.id === id && x.company_id === company);
        if (!e) return [];
        e.status = "pending";
        return [e];
      }
      if (q.startsWith("UPDATE event_outbox SET status = 'dead_letter'")) {
        const e = state.events.find((x) => x.id === values[values.length - 1]);
        if (e) e.status = "dead_letter";
        return [];
      }
      return [];
    };
    (fn as any).json = (x: any) => x;
    return fn;
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
  a.route("/api/v1/outbox", outboxRoutes);
  return a;
}
const auth = async (role: string, companyId = "company-1") => ({ Authorization: `Bearer ${await token(role, companyId)}` });
const jsonAuth = async (role: string, companyId = "company-1") => ({ ...(await auth(role, companyId)), "Content-Type": "application/json" });

beforeEach(reset);

describe("outbox routes", () => {
  it("list requires viewOutbox capability", async () => {
    const res = await app().request("/api/v1/outbox", { headers: await auth("loan_originator") }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("list is company-scoped, summarized, and redacted", async () => {
    const res = await app().request("/api/v1/outbox", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.events).toHaveLength(2); // company-1 only
    expect(body.summary.pending).toBe(1);
    expect(body.summary.failed).toBe(1);
    // sensitive payload key redacted
    const created = body.events.find((e: any) => e.id === "e1");
    expect(created.payload.token).toBe("[REDACTED]");
    expect(created.payload.loanNumber).toBe("TX-1");
  });

  it("detail does not expose another company's event", async () => {
    const res = await app().request("/api/v1/outbox/e9", { headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(404);
  });

  it("process requires capability and returns a summary", async () => {
    const denied = await app().request("/api/v1/outbox/process", { method: "POST", headers: await jsonAuth("read_only"), body: "{}" }, createMockEnv());
    expect(denied.status).toBe(403);

    const res = await app().request("/api/v1/outbox/process", { method: "POST", headers: await jsonAuth("company_admin"), body: "{}" }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.summary.claimed).toBeGreaterThan(0);
    expect(body.summary.processed).toBeGreaterThan(0);
  });

  it("retry sets an event back to pending (company-scoped)", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/outbox/e2/retry", { method: "POST", headers: await jsonAuth("company_admin"), body: "{}" }, env);
    expect(res.status).toBe(200);
    expect(state.events.find((e) => e.id === "e2")?.status).toBe("pending");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "outbox.retried")).toBe(true);
  });

  it("dead-letter marks an event dead_letter", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/outbox/e1/dead-letter", { method: "POST", headers: await jsonAuth("company_admin"), body: "{}" }, env);
    expect(res.status).toBe(200);
    expect(state.events.find((e) => e.id === "e1")?.status).toBe("dead_letter");
    expect((env.AUDIT_QUEUE as any).messages.some((m: any) => m.type === "outbox.dead_lettered")).toBe(true);
  });

  it("retry on another company's event 404s", async () => {
    const res = await app().request("/api/v1/outbox/e9/retry", { method: "POST", headers: await jsonAuth("company_admin"), body: "{}" }, createMockEnv());
    expect(res.status).toBe(404);
  });
});
