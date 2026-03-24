import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireRole } from "../middleware/auth";
export const integrationRoutes = new Hono<{ Bindings: Env }>();

const SUPPORTED_SYSTEMS = [
  { id: "encompass", name: "Encompass", vendor: "ICE Mortgage Technology", type: "LOS", syncDirection: "bi-directional", features: ["Loan data sync","Document push/pull","Milestone updates","Compliance triggers","Disclosure tracking"] },
  { id: "calyx", name: "Calyx Point", vendor: "Calyx Technology", type: "LOS", syncDirection: "bi-directional", features: ["Loan file import","Document sync","Pipeline status","Fee worksheets","1003 form data"] },
  { id: "lendingpad", name: "LendingPad", vendor: "LendingPad Corp", type: "LOS", syncDirection: "bi-directional", features: ["Real-time loan sync","Task assignments","Condition tracking","Lender submission","eSign status"] },
  { id: "bytepro", name: "Byte Pro", vendor: "Byte Software", type: "LOS", syncDirection: "bi-directional", features: ["Workflow automation","Credit decisioning","Doc management"] },
  { id: "floify", name: "Floify", vendor: "Floify LLC", type: "POS", syncDirection: "inbound", features: ["Borrower portal","Document intake","eConsent","Status updates"] },
  { id: "blend", name: "Blend", vendor: "Blend Labs", type: "POS", syncDirection: "inbound", features: ["Digital application","Income verification","Asset verification"] },
  { id: "arive", name: "ARIVE", vendor: "ARIVE Inc", type: "LOS", syncDirection: "bi-directional", features: ["Pricing engine","Wholesale connectivity","Loan origination"] },
  { id: "docmagic", name: "DocMagic", vendor: "DocMagic Inc", type: "DOC", syncDirection: "outbound", features: ["State disclosure gen","eSign/eNotary","TRID compliance","Doc audit trail"] },
  { id: "meridianlink", name: "MeridianLink / CBC", vendor: "MeridianLink", type: "CREDIT", syncDirection: "inbound", features: ["Tri-merge credit","AUS integration","VOE/VOI","Flood cert","OFAC screening"] },
];

const connectSchema = z.object({
  systemId: z.string(), clientId: z.string().optional(), clientSecret: z.string().optional(),
  apiKey: z.string().optional(), instanceUrl: z.string().url().optional(),
  webhookEnabled: z.boolean().default(false),
});

integrationRoutes.get("/available", async (c) => c.json({ systems: SUPPORTED_SYSTEMS }));

integrationRoutes.get("/connected", requireRole("company_admin", "compliance_officer"), async (c) => {
  const user = c.get("user");
  const configs = await c.env.RULE_CACHE.get(`integrations:${user.companyId}`, "json") as any[] || [];
  return c.json({ integrations: configs.map((cfg: any) => ({ ...cfg, clientSecret: undefined, apiKey: undefined })) });
});

integrationRoutes.post("/connect", requireRole("company_admin"), zValidator("json", connectSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const system = SUPPORTED_SYSTEMS.find(s => s.id === body.systemId);
  if (!system) return c.json({ error: "Unsupported system" }, 400);

  const configs = await c.env.RULE_CACHE.get(`integrations:${user.companyId}`, "json") as any[] || [];
  const existing = configs.findIndex((c: any) => c.systemId === body.systemId);
  const config = { systemId: body.systemId, name: system.name, type: system.type, connectedAt: new Date().toISOString(), status: "connected", lastSync: null, clientId: body.clientId, clientSecret: body.clientSecret, apiKey: body.apiKey, instanceUrl: body.instanceUrl, webhookEnabled: body.webhookEnabled };
  if (existing >= 0) configs[existing] = config; else configs.push(config);
  await c.env.RULE_CACHE.put(`integrations:${user.companyId}`, JSON.stringify(configs));
  return c.json({ success: true, integration: { ...config, clientSecret: undefined, apiKey: undefined } }, 201);
});

integrationRoutes.post("/sync/:systemId", requireRole("company_admin", "compliance_officer"), async (c) => {
  const user = c.get("user");
  const systemId = c.req.param("systemId");
  const configs = await c.env.RULE_CACHE.get(`integrations:${user.companyId}`, "json") as any[] || [];
  const config = configs.find((c: any) => c.systemId === systemId);
  if (!config) return c.json({ error: "Integration not connected" }, 404);
  // In production: call the LOS API to pull/push loan data
  config.lastSync = new Date().toISOString();
  await c.env.RULE_CACHE.put(`integrations:${user.companyId}`, JSON.stringify(configs));
  return c.json({ success: true, lastSync: config.lastSync, message: `Sync initiated for ${config.name}` });
});

integrationRoutes.delete("/:systemId", requireRole("company_admin"), async (c) => {
  const user = c.get("user");
  const systemId = c.req.param("systemId");
  const configs = await c.env.RULE_CACHE.get(`integrations:${user.companyId}`, "json") as any[] || [];
  const filtered = configs.filter((c: any) => c.systemId !== systemId);
  await c.env.RULE_CACHE.put(`integrations:${user.companyId}`, JSON.stringify(filtered));
  return c.json({ success: true });
});

// Webhook endpoint for LOS callbacks
integrationRoutes.post("/webhook/:systemId", async (c) => {
  const systemId = c.req.param("systemId");
  const payload = await c.req.json();
  // In production: validate webhook signature, map LOS events to compliance events
  console.log(`[WEBHOOK] ${systemId}:`, JSON.stringify(payload).substring(0, 200));
  // Queue for async processing
  await c.env.COMPLIANCE_QUEUE.send({ type: "integration.webhook", loanId: payload.loanId || "unknown", companyId: payload.companyId || "unknown", payload: { systemId, ...payload }, timestamp: new Date().toISOString() });
  return c.json({ received: true });
});
