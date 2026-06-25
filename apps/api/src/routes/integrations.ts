import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { SUPPORTED_SYSTEMS, getSystem, simulateConnectionTest } from "../lib/integrations";
import { encryptOptional, encryptSecret, decryptSecret } from "../lib/secrets";

export const integrationRoutes = new Hono<{ Bindings: Env }>();

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

function audit(c: any, user: any, partial: Record<string, unknown>) {
  return c.env.AUDIT_QUEUE.send({
    entityType: "company",
    companyId: user.companyId,
    userId: user.userId,
    ipAddress: c.req.header("cf-connecting-ip") || "unknown",
    timestamp: new Date().toISOString(),
    ...partial,
  });
}

const hex = (arr: Uint8Array) => Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
function randomToken(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// Public serialization — NEVER includes clientSecret / apiKey / webhook secret.
function serialize(row: any, origin: string) {
  let config: unknown = null;
  try { config = row.config ? JSON.parse(row.config) : null; } catch { config = null; }
  return {
    id: row.id,
    systemId: row.system_id,
    name: row.system_name,
    type: row.system_type,
    status: row.status,
    syncDirection: row.sync_direction,
    clientId: row.client_id || null,
    instanceUrl: row.instance_url || null,
    hasClientSecret: !!row.client_secret_enc,
    hasApiKey: !!row.api_key_enc,
    webhookEnabled: !!row.webhook_enabled,
    webhookUrl: row.webhook_enabled && row.webhook_id ? `${origin}/api/v1/integrations/webhook/${row.webhook_id}` : null,
    config,
    connectedAt: row.connected_at,
    lastSyncAt: row.last_sync_at,
    lastSuccessfulSyncAt: row.last_successful_sync_at,
    lastError: row.last_error,
  };
}

const connectSchema = z.object({
  systemId: z.string(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  apiKey: z.string().optional(),
  instanceUrl: z.string().url().optional(),
  syncDirection: z.string().max(20).optional(),
  config: z.record(z.any()).optional(),
  webhookEnabled: z.boolean().default(false),
});

integrationRoutes.get("/available", async (c) => c.json({ systems: SUPPORTED_SYSTEMS }));

integrationRoutes.get("/connected", requireCapability("viewIntegrations"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const rows = await sql`SELECT * FROM integrations WHERE company_id = ${user.companyId} ORDER BY connected_at DESC`;
  const origin = new URL(c.req.url).origin;
  return c.json({ integrations: rows.map((r) => serialize(r, origin)) });
});

// ─── Test a connection config (no persistence, no secrets stored) ───
integrationRoutes.post("/test", requireCapability("manageIntegrations"), zValidator("json", connectSchema), async (c) => {
  const body = c.req.valid("json");
  const result = simulateConnectionTest(body.systemId, body);
  return c.json(result, result.success ? 200 : 400);
});

// ─── Connect / update credentials ───
integrationRoutes.post("/connect", requireCapability("manageIntegrations"), zValidator("json", connectSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const system = getSystem(body.systemId);
  if (!system) return c.json({ error: "Unsupported system" }, 400);

  const sql = db(c.env);
  const [existing] = await sql`SELECT id, webhook_id, webhook_secret_enc FROM integrations WHERE company_id = ${user.companyId} AND system_id = ${system.id}`;

  const clientSecretEnc = await encryptOptional(body.clientSecret, c.env.JWT_SECRET);
  const apiKeyEnc = await encryptOptional(body.apiKey, c.env.JWT_SECRET);

  // Webhook: reuse an existing id/secret, otherwise mint a new pair when enabling.
  let webhookId: string | null = null;
  let webhookSecretEnc: string | null = null;
  let revealSecret: string | null = null;
  if (body.webhookEnabled) {
    if (existing?.webhook_id) {
      webhookId = existing.webhook_id;
      webhookSecretEnc = existing.webhook_secret_enc;
    } else {
      webhookId = randomToken(16);
      revealSecret = randomToken(32);
      webhookSecretEnc = await encryptSecret(revealSecret, c.env.JWT_SECRET);
    }
  }

  const configJson = JSON.stringify(body.config || {});
  const [row] = await sql`
    INSERT INTO integrations (company_id, system_id, system_name, system_type, status, sync_direction, client_id, instance_url, client_secret_enc, api_key_enc, webhook_enabled, webhook_id, webhook_secret_enc, config, connected_at, updated_at)
    VALUES (${user.companyId}, ${system.id}, ${system.name}, ${system.type}, 'connected', ${body.syncDirection || system.syncDirection}, ${body.clientId || null}, ${body.instanceUrl || null}, ${clientSecretEnc}, ${apiKeyEnc}, ${body.webhookEnabled}, ${webhookId}, ${webhookSecretEnc}, ${configJson}, NOW(), NOW())
    ON CONFLICT (company_id, system_id) DO UPDATE SET
      system_name = EXCLUDED.system_name,
      system_type = EXCLUDED.system_type,
      status = 'connected',
      sync_direction = EXCLUDED.sync_direction,
      client_id = COALESCE(EXCLUDED.client_id, integrations.client_id),
      instance_url = COALESCE(EXCLUDED.instance_url, integrations.instance_url),
      client_secret_enc = COALESCE(EXCLUDED.client_secret_enc, integrations.client_secret_enc),
      api_key_enc = COALESCE(EXCLUDED.api_key_enc, integrations.api_key_enc),
      webhook_enabled = EXCLUDED.webhook_enabled,
      webhook_id = EXCLUDED.webhook_id,
      webhook_secret_enc = EXCLUDED.webhook_secret_enc,
      config = EXCLUDED.config,
      updated_at = NOW()
    RETURNING *`;

  await audit(c, user, { type: existing ? "integration.credentials_updated" : "integration.connected", entityId: row.id, action: existing ? "update_integration" : "connect_integration", details: { systemId: system.id, webhookEnabled: body.webhookEnabled } });

  const origin = new URL(c.req.url).origin;
  // revealSecret (webhook signing secret) is returned ONCE on creation so the LOS
  // can be configured; client secret / API key are never returned.
  return c.json({ integration: serialize(row, origin), webhookSecret: revealSecret }, existing ? 200 : 201);
});

// ─── Trigger a sync (records history + health) ───
integrationRoutes.post("/sync/:systemId", requireCapability("syncIntegrations"), async (c) => {
  const user = c.get("user");
  const systemId = c.req.param("systemId");
  const sql = db(c.env);
  const [integration] = await sql`SELECT id FROM integrations WHERE company_id = ${user.companyId} AND system_id = ${systemId}`;
  if (!integration) return c.json({ error: "Integration not connected" }, 404);

  const [run] = await sql`
    INSERT INTO integration_sync_history (company_id, integration_id, system_id, status)
    VALUES (${user.companyId}, ${integration.id}, ${systemId}, 'running') RETURNING id, started_at`;
  await audit(c, user, { type: "integration.sync_started", entityId: integration.id, action: "sync_started", details: { systemId, runId: run.id } });

  // MVP: simulate a successful pull. A real implementation would call the vendor API.
  const recordsProcessed = (crypto.getRandomValues(new Uint8Array(1))[0] % 40) + 1;
  await sql`UPDATE integration_sync_history SET finished_at = NOW(), status = 'completed', records_processed = ${recordsProcessed} WHERE id = ${run.id}`;
  await sql`UPDATE integrations SET status = 'connected', last_sync_at = NOW(), last_successful_sync_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = ${integration.id}`;
  await audit(c, user, { type: "integration.sync_completed", entityId: integration.id, action: "sync_completed", details: { systemId, runId: run.id, recordsProcessed } });

  return c.json({ success: true, runId: run.id, recordsProcessed });
});

// ─── Sync history ───
integrationRoutes.get("/:systemId/history", requireCapability("viewIntegrations"), async (c) => {
  const user = c.get("user");
  const systemId = c.req.param("systemId");
  const sql = db(c.env);
  const history = await sql`
    SELECT id, system_id, started_at, finished_at, status, records_processed, error_message
    FROM integration_sync_history
    WHERE company_id = ${user.companyId} AND system_id = ${systemId}
    ORDER BY started_at DESC LIMIT 50`;
  return c.json({ history });
});

// ─── Disconnect ───
integrationRoutes.delete("/:systemId", requireCapability("manageIntegrations"), async (c) => {
  const user = c.get("user");
  const systemId = c.req.param("systemId");
  const sql = db(c.env);
  const [integration] = await sql`SELECT id FROM integrations WHERE company_id = ${user.companyId} AND system_id = ${systemId}`;
  if (!integration) return c.json({ error: "Integration not connected" }, 404);
  // Preserve sync history but detach the FK before deleting the integration.
  await sql`UPDATE integration_sync_history SET integration_id = NULL WHERE integration_id = ${integration.id}`;
  await sql`DELETE FROM integrations WHERE id = ${integration.id}`;
  await audit(c, user, { type: "integration.disconnected", entityId: integration.id, action: "disconnect_integration", details: { systemId } });
  return c.json({ success: true });
});

// ─── Webhook (PUBLIC — HMAC-authenticated, no JWT). Mounted before
// authMiddleware in index.ts so external LOS callbacks can reach it. Direct
// lookup by webhook id — no KV scanning. ───
export const integrationWebhookRoutes = new Hono<{ Bindings: Env }>();

integrationWebhookRoutes.post("/:webhookId", async (c) => {
  const webhookId = c.req.param("webhookId");
  const signature = c.req.header("X-Webhook-Signature");
  if (!signature) return c.json({ error: "Missing X-Webhook-Signature header" }, 401);

  const sql = db(c.env);
  const [integration] = await sql`SELECT id, company_id, system_id, webhook_secret_enc, webhook_enabled FROM integrations WHERE webhook_id = ${webhookId}`;
  if (!integration || !integration.webhook_enabled || !integration.webhook_secret_enc) {
    return c.json({ error: "Unknown webhook" }, 401);
  }
  const secret = await decryptSecret(integration.webhook_secret_enc, c.env.JWT_SECRET);
  if (!secret) return c.json({ error: "Webhook not configured" }, 401);

  const rawBody = await c.req.text();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let valid = false;
  try {
    const sigBytes = new Uint8Array((signature.match(/.{2}/g) || []).map((b) => parseInt(b, 16)));
    valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(rawBody));
  } catch {
    valid = false;
  }
  if (!valid) return c.json({ error: "Invalid webhook signature" }, 401);

  let payload: any = {};
  try { payload = JSON.parse(rawBody); } catch { payload = {}; }
  await c.env.COMPLIANCE_QUEUE.send({ type: "integration.webhook", loanId: payload.loanId || "unknown", companyId: integration.company_id, payload: { systemId: integration.system_id, ...payload }, timestamp: new Date().toISOString() });
  return c.json({ received: true });
});
