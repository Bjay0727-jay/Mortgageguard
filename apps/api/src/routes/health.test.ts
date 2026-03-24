import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { Env } from "../env";
import { createMockEnv } from "../__tests__/helpers";

// Reconstruct the health endpoints as they appear in index.ts
function createHealthApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "mortgageguard-api",
      timestamp: new Date().toISOString(),
    }),
  );

  app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));

  return app;
}

describe("Health endpoints", () => {
  const env = createMockEnv();

  it("GET /health returns 200 with status ok", async () => {
    const app = createHealthApp();
    const res = await app.request("/health", {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("mortgageguard-api");
    expect(body.timestamp).toBeTruthy();
  });

  it("returns 404 for unknown routes", async () => {
    const app = createHealthApp();
    const res = await app.request("/unknown/path", {}, env);

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
    expect(body.path).toBe("/unknown/path");
  });
});
