import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { rateLimit } from "./rate-limit";
import { createMockEnv } from "../__tests__/helpers";
import type { Env } from "../env";

function createTestApp(maxRequests: number) {
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", rateLimit({ windowMs: 60_000, maxRequests, keyPrefix: "test" }));
  app.get("/test", (c) => c.json({ ok: true }));
  return app;
}

describe("rateLimit middleware", () => {
  it("allows requests under the limit", async () => {
    const app = createTestApp(5);
    const env = createMockEnv();

    const res = await app.request("/test", { headers: { "cf-connecting-ip": "1.2.3.4" } }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("5");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("4");
  });

  it("blocks requests over the limit", async () => {
    const app = createTestApp(2);
    const env = createMockEnv();
    const headers = { "cf-connecting-ip": "1.2.3.4" };

    await app.request("/test", { headers }, env);
    await app.request("/test", { headers }, env);
    const res = await app.request("/test", { headers }, env);

    expect(res.status).toBe(429);
    const body = await res.json() as any;
    expect(body.error).toBe("Too many requests");
  });

  it("tracks different IPs separately", async () => {
    const app = createTestApp(1);
    const env = createMockEnv();

    const res1 = await app.request("/test", { headers: { "cf-connecting-ip": "1.1.1.1" } }, env);
    const res2 = await app.request("/test", { headers: { "cf-connecting-ip": "2.2.2.2" } }, env);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  it("decrements remaining count with each request", async () => {
    const app = createTestApp(3);
    const env = createMockEnv();
    const headers = { "cf-connecting-ip": "5.5.5.5" };

    const r1 = await app.request("/test", { headers }, env);
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("2");

    const r2 = await app.request("/test", { headers }, env);
    expect(r2.headers.get("X-RateLimit-Remaining")).toBe("1");

    const r3 = await app.request("/test", { headers }, env);
    expect(r3.headers.get("X-RateLimit-Remaining")).toBe("0");
  });
});
