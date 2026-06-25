import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { SignJWT } from "jose";
import type { Env } from "../env";
import { authMiddleware } from "../middleware/auth";
import { createMockEnv } from "../__tests__/helpers";
import { integrationRoutes, integrationWebhookRoutes } from "./integrations";
import { encryptSecret } from "../lib/secrets";

const MASTER = "test-secret-key-for-unit-tests-only-32chars!";
const state = { integrations: [] as any[], history: [] as any[] };

vi.mock("postgres", () => ({
  default: vi.fn(() => async (strings: TemplateStringsArray, ...values: any[]) => {
    const q = strings.join("?").replace(/\s+/g, " ").trim();

    if (q.includes("WHERE webhook_id = ?")) {
      return state.integrations.filter((i) => i.webhook_id === values[0]);
    }
    if (q.includes("SELECT * FROM integrations WHERE company_id = ?")) {
      return state.integrations.filter((i) => i.company_id === values[0]);
    }
    if (q.includes("SELECT id, webhook_id, webhook_secret_enc FROM integrations")) {
      const [companyId, systemId] = values;
      return state.integrations.filter((i) => i.company_id === companyId && i.system_id === systemId);
    }
    if (q.includes("INSERT INTO integrations")) {
      const v = values; // companyId, systemId, name, type, syncDir, clientId, instanceUrl, csEnc, akEnc, webhookEnabled, webhookId, whSecEnc, config
      const idx = state.integrations.findIndex((i) => i.company_id === v[0] && i.system_id === v[1]);
      const row = {
        id: idx >= 0 ? state.integrations[idx].id : `int-${state.integrations.length + 1}`,
        company_id: v[0], system_id: v[1], system_name: v[2], system_type: v[3], status: "connected",
        sync_direction: v[4], client_id: v[5], instance_url: v[6], client_secret_enc: v[7], api_key_enc: v[8],
        webhook_enabled: v[9], webhook_id: v[10], webhook_secret_enc: v[11], config: v[12],
        connected_at: new Date().toISOString(), last_sync_at: null, last_successful_sync_at: null, last_error: null,
      };
      if (idx >= 0) state.integrations[idx] = row; else state.integrations.push(row);
      return [row];
    }
    if (q.includes("SELECT id FROM integrations WHERE company_id = ? AND system_id = ?")) {
      const [companyId, systemId] = values;
      return state.integrations.filter((i) => i.company_id === companyId && i.system_id === systemId).map((i) => ({ id: i.id }));
    }
    if (q.includes("INSERT INTO integration_sync_history")) {
      const run = { id: `run-${state.history.length + 1}`, company_id: values[0], integration_id: values[1], system_id: values[2], status: "running", started_at: new Date().toISOString() };
      state.history.push(run);
      return [{ id: run.id, started_at: run.started_at }];
    }
    if (q.includes("UPDATE integration_sync_history SET finished_at")) {
      const run = state.history.find((r) => r.id === values[1]);
      if (run) { run.status = "completed"; run.records_processed = values[0]; run.finished_at = new Date().toISOString(); }
      return [];
    }
    if (q.includes("UPDATE integrations SET status = 'connected', last_sync_at")) return [];
    if (q.includes("FROM integration_sync_history WHERE company_id = ?")) {
      const [companyId, systemId] = values;
      return state.history.filter((r) => r.company_id === companyId && r.system_id === systemId);
    }
    if (q.includes("UPDATE integration_sync_history SET integration_id = NULL")) return [];
    if (q.includes("DELETE FROM integrations")) {
      state.integrations = state.integrations.filter((i) => i.id !== values[0]);
      return [];
    }
    return [];
  }),
}));

async function token(role: string, companyId = "company-1") {
  return new SignJWT({ companyId, email: `${role}@x.com`, role, nmlsId: null })
    .setSubject(`${role}-user`).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(MASTER));
}
const auth = async (role: string, companyId = "company-1") => ({ Authorization: `Bearer ${await token(role, companyId)}` });
function app() {
  const a = new Hono<{ Bindings: Env }>();
  a.route("/api/v1/integrations/webhook", integrationWebhookRoutes); // public, before auth
  a.use("/api/v1/*", authMiddleware);
  a.route("/api/v1/integrations", integrationRoutes);
  return a;
}
const jsonHeaders = async (role: string, companyId = "company-1") => ({ ...(await auth(role, companyId)), "Content-Type": "application/json" });
async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => { state.integrations = []; state.history = []; });

describe("integrations — connect & secrets", () => {
  it("requires manageIntegrations to connect", async () => {
    const res = await app().request("/api/v1/integrations/connect", { method: "POST", headers: await jsonHeaders("read_only"), body: JSON.stringify({ systemId: "encompass" }) }, createMockEnv());
    expect(res.status).toBe(403);
  });

  it("connects and never returns clientSecret/apiKey", async () => {
    const env = createMockEnv();
    const res = await app().request("/api/v1/integrations/connect", { method: "POST", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ systemId: "encompass", clientId: "cid", clientSecret: "topsecret", apiKey: "key123", instanceUrl: "https://x.encompass.com" }) }, env);
    expect(res.status).toBe(201);
    const text = await res.text();
    expect(text).not.toContain("topsecret");
    expect(text).not.toContain("key123");
    const body = JSON.parse(text);
    expect(body.integration).not.toHaveProperty("clientSecret");
    expect(body.integration).not.toHaveProperty("apiKey");
    expect(body.integration.hasClientSecret).toBe(true);
    expect(body.integration.hasApiKey).toBe(true);

    // GET /connected also omits secrets.
    const list = await (await app().request("/api/v1/integrations/connected", { headers: await auth("company_admin") }, env)).json() as any;
    expect(JSON.stringify(list)).not.toContain("topsecret");
    expect(list.integrations[0].hasClientSecret).toBe(true);
  });

  it("test endpoint validates config without persisting", async () => {
    const ok = await app().request("/api/v1/integrations/test", { method: "POST", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ systemId: "floify", apiKey: "k" }) }, createMockEnv());
    expect(ok.status).toBe(200);
    const bad = await app().request("/api/v1/integrations/test", { method: "POST", headers: await jsonHeaders("company_admin"), body: JSON.stringify({ systemId: "encompass" }) }, createMockEnv());
    expect(bad.status).toBe(400);
    expect(state.integrations).toHaveLength(0);
  });
});

describe("integrations — sync & RBAC", () => {
  it("creates a sync history record", async () => {
    state.integrations = [{ id: "int-1", company_id: "company-1", system_id: "encompass" }];
    const res = await app().request("/api/v1/integrations/sync/encompass", { method: "POST", headers: await auth("company_admin") }, createMockEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].status).toBe("completed");
    expect(state.history[0].records_processed).toBeGreaterThan(0);
  });

  it("read_only cannot disconnect", async () => {
    state.integrations = [{ id: "int-1", company_id: "company-1", system_id: "encompass" }];
    const res = await app().request("/api/v1/integrations/encompass", { method: "DELETE", headers: await auth("read_only") }, createMockEnv());
    expect(res.status).toBe(403);
    expect(state.integrations).toHaveLength(1);
  });
});

describe("integrations — webhook (HMAC, direct lookup)", () => {
  it("accepts a valid signature and rejects a bad one", async () => {
    const secret = "webhook-shared-secret";
    state.integrations = [{ id: "int-1", company_id: "company-1", system_id: "encompass", webhook_id: "wh-abc", webhook_enabled: true, webhook_secret_enc: await encryptSecret(secret, MASTER) }];
    const env = createMockEnv();
    const body = JSON.stringify({ loanId: "loan-1", event: "milestone" });

    const good = await app().request("/api/v1/integrations/webhook/wh-abc", { method: "POST", headers: { "X-Webhook-Signature": await hmacHex(secret, body) }, body }, env);
    expect(good.status).toBe(200);
    expect((env.COMPLIANCE_QUEUE as any).messages.some((m: any) => m.type === "integration.webhook")).toBe(true);

    const bad = await app().request("/api/v1/integrations/webhook/wh-abc", { method: "POST", headers: { "X-Webhook-Signature": "deadbeef" }, body }, createMockEnv());
    expect(bad.status).toBe(401);

    const missing = await app().request("/api/v1/integrations/webhook/wh-abc", { method: "POST", body }, createMockEnv());
    expect(missing.status).toBe(401);
  });

  it("rejects an unknown webhook id", async () => {
    const res = await app().request("/api/v1/integrations/webhook/nope", { method: "POST", headers: { "X-Webhook-Signature": "ab" }, body: "{}" }, createMockEnv());
    expect(res.status).toBe(401);
  });
});
