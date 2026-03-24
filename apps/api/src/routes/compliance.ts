import { Hono } from "hono";
import postgres from "postgres";
import type { Env } from "../env";
import { resolveStateRules, calculateScore } from "../services/compliance-engine";
export const complianceRoutes = new Hono<{ Bindings: Env }>();

complianceRoutes.get("/rules/:state", async (c) => {
  const state = c.req.param("state").toUpperCase();
  const rules = await resolveStateRules(state, c.env);
  return c.json({ state, rules, count: rules.length });
});

complianceRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loanStats] = await sql`SELECT COUNT(*) as total, AVG(compliance_score) as avg_score, COUNT(CASE WHEN compliance_score < 50 THEN 1 END) as critical, COUNT(CASE WHEN compliance_score >= 80 THEN 1 END) as passing, SUM(CAST(loan_amount AS NUMERIC)) as total_volume FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false AND status NOT IN ('denied','withdrawn')`;
  const byStage = await sql`SELECT status, COUNT(*) as count FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false GROUP BY status`;
  const byState = await sql`SELECT property_state, COUNT(*) as count, AVG(compliance_score) as avg_score FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false GROUP BY property_state`;
  const programStats = await sql`SELECT status, COUNT(*) as count FROM compliance_programs WHERE company_id = ${user.companyId} GROUP BY status`;
  const upcomingDeadlines = await sql`SELECT * FROM reporting_deadlines WHERE company_id = ${user.companyId} AND status IN ('upcoming','in_progress') ORDER BY due_date LIMIT 5`;
  const attentionLoans = await sql`SELECT id, loan_number, borrower_last_name || ', ' || borrower_first_name as borrower, property_state, status, compliance_score, docs_complete, docs_required FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false AND compliance_score < 80 ORDER BY compliance_score LIMIT 5`;
  return c.json({ examReadiness: { avgScore: Math.round(Number(loanStats.avg_score) || 0), totalLoans: Number(loanStats.total), criticalAlerts: Number(loanStats.critical), passingLoans: Number(loanStats.passing), totalVolume: Number(loanStats.total_volume) || 0 }, pipeline: byStage, stateBreakdown: byState, programs: programStats, upcomingDeadlines, attentionLoans });
});

complianceRoutes.post("/recalculate/:loanId", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`SELECT id FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);
  const score = await calculateScore(loanId, c.env);
  return c.json({ score });
});

import { getDocumentsByCategory, getRequiredDocuments } from "../services/tx-documents";

complianceRoutes.get("/tx-documents", async (c) => {
  const categories = getDocumentsByCategory();
  const totalDocs = categories.reduce((sum, cat) => sum + cat.docs.length, 0);
  const required = categories.reduce((sum, cat) => sum + cat.docs.filter(d => d.required).length, 0);
  return c.json({ state: "TX", source: "TX-SML Compliance Guide v12 (Jan 2026)", categories, summary: { total: totalDocs, required, categories: categories.length } });
});

complianceRoutes.get("/tx-documents/:loanId", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`SELECT loan_purpose, loan_type FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);
  const docs = getRequiredDocuments(loan.loan_purpose, loan.loan_type);
  return c.json({ loanId, loanPurpose: loan.loan_purpose, loanType: loan.loan_type, requiredDocuments: docs, count: docs.length });
});
