import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { complianceRoutes } from "./compliance";

// Record every SQL fragment the route evaluates. Because the endpoint composes
// filters as nested sql`` fragments, a state/status/date filter shows up as an
// extra fragment containing its WHERE clause — which lets us assert push-down.
let queries: string[] = [];

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ..._values: any[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push(query);
    if (query.includes("total_volume")) return [{ total: 0, avg_score: null, critical: 0, passing: 0, total_volume: null }];
    return [];
  }),
}));

const SECRET = "test-secret-key-for-unit-tests-only-32chars!";
async function token(role = "company_admin") {
  return new SignJWT({ companyId: "company-1", email: `${role}@x.com`, role, nmlsId: null })
    .setSubject(`${role}-user`).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/compliance", complianceRoutes);
  return a;
}
const has = (needle: string) => queries.some((q) => q.includes(needle));

describe("GET /compliance/dashboard filters", () => {
  beforeEach(() => { queries = []; });

  it("works unfiltered, echoes null filters, pushes no filter clauses", async () => {
    const res = await app().request("/api/v1/compliance/dashboard", { headers: { Authorization: `Bearer ${await token()}` } }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.filters).toEqual({ state: null, status: null, from: null, to: null });
    expect(body.examReadiness.totalLoans).toBe(0);
    // No optional filter clauses; metrics fall back to the active-loans default.
    expect(has("AND property_state =")).toBe(false);
    expect(has("AND application_date")).toBe(false);
    expect(has("AND status =")).toBe(false);
    expect(has("status NOT IN ('denied','withdrawn')")).toBe(true);
  });

  it("normalizes and pushes state, status, and date range into SQL", async () => {
    const res = await app().request(
      "/api/v1/compliance/dashboard?state=tx&status=processing&from=2026-01-01&to=2026-03-31",
      { headers: { Authorization: `Bearer ${await token()}` } },
      createMockEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.filters).toEqual({ state: "TX", status: "processing", from: "2026-01-01", to: "2026-03-31" });
    expect(has("AND property_state =")).toBe(true);   // state pushed down
    expect(has("AND application_date >=")).toBe(true); // from
    expect(has("AND application_date <=")).toBe(true); // to
    expect(has("AND status =")).toBe(true);            // explicit status overrides the default
    expect(has("status NOT IN ('denied','withdrawn')")).toBe(false);
  });
});
