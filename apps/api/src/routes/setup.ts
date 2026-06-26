import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { computeRulesStatus, type RulesStatus } from "../lib/rules-status";
import { buildSetupStatus } from "../lib/setup-status";
import { TEXAS_STATE_RULES, TEXAS_REQUIRED_DOCUMENTS, TEXAS_REPORTING_DEADLINES, TEXAS_REPORTING_OBLIGATIONS } from "../lib/texas-rules";
import { tryCreateOutboxEvent } from "../lib/outbox";

export const setupRoutes = new Hono<{ Bindings: Env }>();

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

const PROGRAM_NEEDS_WORK = ["missing", "incomplete", "overdue", "source_review_due", "review_due"];

function isSeededAdmin(u: any): boolean {
  const name = (u?.name || "").toLowerCase();
  const email = (u?.email || "").toLowerCase();
  return !!u?.must_change_password || name === "administrator" || email.includes("admin@");
}

// ── Gather Texas + federal rule counts ──
async function gatherRulesStatus(sql: any, companyId: string, state = "TX"): Promise<RulesStatus> {
  const [rules] = await sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active, MAX(created_at) AS last_loaded FROM state_rules WHERE state_code IN (${state}, 'FED')`;
  const [docs] = await sql`SELECT COUNT(*)::int AS total FROM required_documents rd JOIN state_rules sr ON sr.id = rd.state_rule_id WHERE sr.state_code IN (${state}, 'FED')`;
  // State-specific subset — federal rows alone must not mark the state loaded.
  const [stateRules] = await sql`SELECT COUNT(*) FILTER (WHERE is_active)::int AS active FROM state_rules WHERE state_code = ${state}`;
  const [stateDocs] = await sql`SELECT COUNT(*)::int AS total FROM required_documents rd JOIN state_rules sr ON sr.id = rd.state_rule_id WHERE sr.state_code = ${state}`;
  const [deadlines] = await sql`SELECT COUNT(*)::int AS total FROM reporting_deadlines WHERE company_id = ${companyId}`;
  // Best-effort: tolerate older deployments where reporting_obligations (Prompt 13) is absent.
  let obligations: any;
  try { [obligations] = await sql`SELECT COUNT(*)::int AS total FROM reporting_obligations WHERE jurisdiction = ${state} AND is_active = true`; } catch { obligations = { total: 0 }; }
  return computeRulesStatus({
    state,
    stateRulesCount: Number(rules?.total ?? 0),
    activeRulesCount: Number(rules?.active ?? 0),
    requiredDocumentsCount: Number(docs?.total ?? 0),
    stateSpecificActiveRulesCount: Number(stateRules?.active ?? 0),
    stateSpecificRequiredDocumentsCount: Number(stateDocs?.total ?? 0),
    reportingDeadlinesCount: Number(deadlines?.total ?? 0),
    reportingObligationsCount: Number(obligations?.total ?? 0),
    lastLoadedAt: rules?.last_loaded ?? null,
  });
}

// ── Idempotent rule loader (NOT EXISTS guards; never duplicates) ──
async function loadRules(sql: any, companyId: string, state = "TX") {
  for (const r of TEXAS_STATE_RULES) {
    await sql`
      INSERT INTO state_rules (state_code, rule_category, rule_name, description, applies_to, effective_date, is_active)
      SELECT ${r.stateCode}, ${r.ruleCategory}, ${r.ruleName}, ${r.description}, ${r.appliesTo}, ${r.effectiveDate}, true
      WHERE NOT EXISTS (SELECT 1 FROM state_rules WHERE state_code = ${r.stateCode} AND rule_name = ${r.ruleName})`;
  }
  for (const d of TEXAS_REQUIRED_DOCUMENTS) {
    await sql`
      INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, description, loan_purpose_filter)
      SELECT sr.id, ${d.documentType}, ${d.displayName}, ${d.isMandatory}, ${d.weight}, ${d.pipelineStage}, ${d.description ?? null}, ${d.loanPurposeFilter ?? null}
      FROM state_rules sr
      WHERE sr.rule_name = ${d.ruleName} AND sr.state_code = ${d.stateCode}
        AND NOT EXISTS (SELECT 1 FROM required_documents rd WHERE rd.state_rule_id = sr.id AND rd.document_type = ${d.documentType})`;
  }
  for (const dl of TEXAS_REPORTING_DEADLINES) {
    // Store the real regulatory due date (45 days after quarter end), not a date
    // derived from when load-rules happens to run.
    await sql`
      INSERT INTO reporting_deadlines (company_id, report_type, state_code, quarter, due_date, status)
      SELECT ${companyId}, ${dl.reportType}, ${dl.stateCode}, ${dl.quarter}, ${dl.dueDate}, 'upcoming'
      WHERE NOT EXISTS (SELECT 1 FROM reporting_deadlines WHERE company_id = ${companyId} AND report_type = ${dl.reportType} AND quarter = ${dl.quarter})`;
  }
  // Ensure the jurisdiction-level reporting obligation catalog (rmla/sssf/
  // financial_condition) exists. Idempotent on (obligation_key, jurisdiction).
  // Best-effort so rule loading never fails on an older deployment missing the
  // Prompt 13 reporting_obligations table.
  try {
    for (const ob of TEXAS_REPORTING_OBLIGATIONS) {
      await sql`
        INSERT INTO reporting_obligations (obligation_key, jurisdiction, name, description, frequency, due_rule, source_key, is_active)
        VALUES (${ob.obligationKey}, ${ob.jurisdiction}, ${ob.name}, ${ob.description}, ${ob.frequency}, ${ob.dueRule}, ${ob.sourceKey}, true)
        ON CONFLICT (obligation_key, jurisdiction) DO NOTHING`;
    }
  } catch { /* reporting_obligations not deployed yet — non-fatal */ }
  return gatherRulesStatus(sql, companyId, state);
}

// ── Gather all setup inputs and compute the status ──
async function gatherSetupStatus(c: any) {
  const user = c.get("user");
  const sql = db(c.env);

  const [u] = await sql`SELECT name, email, must_change_password FROM users WHERE id = ${user.userId}`;
  const [company] = await sql`SELECT * FROM companies WHERE id = ${user.companyId}`;
  const rules = await gatherRulesStatus(sql, user.companyId);
  const [loans] = await sql`SELECT COUNT(*)::int AS total FROM loans WHERE company_id = ${user.companyId}`;

  const programRows = await sql`SELECT status, is_required, applicable FROM compliance_programs WHERE company_id = ${user.companyId}`;
  const programsAvailable = programRows.length > 0;
  const requiredApplicable = programRows.filter((p: any) => p.is_required && p.applicable !== false);
  const programs = {
    requiredTotal: requiredApplicable.length,
    requiredCurrent: requiredApplicable.filter((p: any) => p.status === "current").length,
    requiredNeedsWork: requiredApplicable.filter((p: any) => PROGRAM_NEEDS_WORK.includes(p.status)).length,
    overdue: requiredApplicable.filter((p: any) => p.status === "overdue").length,
  };

  const [activeUsers] = await sql`SELECT COUNT(*)::int AS total FROM users WHERE company_id = ${user.companyId} AND is_active = true`;
  const inviteRows = await sql`SELECT accepted_at, revoked_at, expires_at FROM user_invitations WHERE company_id = ${user.companyId}`;
  const now = Date.now();
  const invites = {
    activeUsersCount: Number(activeUsers?.total ?? 0),
    pendingInvitesCount: inviteRows.filter((i: any) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at).getTime() >= now).length,
    acceptedInvitesCount: inviteRows.filter((i: any) => !!i.accepted_at).length,
    expiredInvitesCount: inviteRows.filter((i: any) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at).getTime() < now).length,
  };

  const losRows = await sql`SELECT status FROM integrations WHERE company_id = ${user.companyId} AND system_type = 'LOS'`;
  const los = {
    connectedLosCount: losRows.filter((r: any) => r.status === "connected").length,
    healthyLosCount: losRows.filter((r: any) => ["connected", "healthy"].includes(r.status)).length,
  };

  return buildSetupStatus({
    companyId: user.companyId,
    user: { mustChangePassword: !!u?.must_change_password, isSeededAdmin: isSeededAdmin(u) },
    company: {
      name: company?.name, nmlsId: company?.nmls_id, entityType: company?.entity_type,
      primaryContact: company?.primary_contact, primaryEmail: company?.primary_email,
      address: company?.address, licenseStates: company?.license_states, allowsRemoteWork: company?.allows_remote_work ?? null,
    },
    rules,
    loanCount: Number(loans?.total ?? 0),
    programsAvailable,
    programs,
    invites,
    los,
  });
}

// ─── GET /api/v1/setup/status ───
setupRoutes.get("/status", requireCapability("viewSetupStatus"), async (c) => {
  return c.json(await gatherSetupStatus(c));
});

// ─── GET /api/v1/setup/rules-status?state=TX ───
setupRoutes.get("/rules-status", requireCapability("viewSetupStatus"), async (c) => {
  const user = c.get("user");
  const state = (c.req.query("state") || "TX").toUpperCase();
  const sql = db(c.env);
  return c.json(await gatherRulesStatus(sql, user.companyId, state));
});

// Only Texas has a rules catalog today; other states would seed nothing.
const SUPPORTED_RULE_STATES = ["TX"];

// ─── POST /api/v1/setup/load-rules ───
setupRoutes.post("/load-rules", requireCapability("loadComplianceRules"), zValidator("json", z.object({ state: z.string().default("TX") })), async (c) => {
  const user = c.get("user");
  const state = (c.req.valid("json").state || "TX").toUpperCase();
  // Unsupported state is a client error, never a 500.
  if (!SUPPORTED_RULE_STATES.includes(state)) {
    return c.json({ error: `Unsupported state '${state}'. Supported states: ${SUPPORTED_RULE_STATES.join(", ")}.` }, 400);
  }

  const sql = db(c.env);

  // Core rule seeding. If this genuinely fails (schema problem) we log the exact
  // error server-side (visible in `wrangler tail`) and return a safe payload.
  let status;
  try {
    status = await loadRules(sql, user.companyId, state);
  } catch (e: any) {
    console.error("[load-rules] rule seeding failed", { message: e?.message, state, companyId: user.companyId });
    return c.json({ error: "Failed to load compliance rules. See server logs for details.", state }, 500);
  }

  // Audit + outbox are best-effort — a queue/binding failure must NOT fail the
  // request now that the rules are persisted.
  try {
    await c.env.AUDIT_QUEUE?.send({
      type: "setup.rules_loaded",
      entityType: "company",
      entityId: user.companyId,
      companyId: user.companyId,
      userId: user.userId,
      action: "load_compliance_rules",
      details: { state, stateRulesCount: status.stateRulesCount, requiredDocumentsCount: status.requiredDocumentsCount },
      ipAddress: c.req.header("cf-connecting-ip") || "unknown",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("[load-rules] audit emit failed (non-fatal)", e?.message);
  }
  try {
    await tryCreateOutboxEvent(sql, { companyId: user.companyId, eventType: "setup.rules_loaded", aggregateType: "company", aggregateId: user.companyId, idempotencyKey: `company:${user.companyId}:setup.rules_loaded:${state}:${status.stateRulesCount}`, payload: { state, stateRulesCount: status.stateRulesCount, requiredDocumentsCount: status.requiredDocumentsCount, actorUserId: user.userId } });
  } catch (e: any) {
    console.error("[load-rules] outbox emit failed (non-fatal)", e?.message);
  }

  // Spread `status` for backwards compatibility, plus a debug-friendly summary.
  return c.json({
    ...status,
    state,
    loaded: status.loaded,
    counts: {
      stateRules: status.stateRulesCount,
      requiredDocuments: status.requiredDocumentsCount,
      reportingObligations: status.reportingObligationsCount,
    },
    missing: status.blockers,
  });
});
