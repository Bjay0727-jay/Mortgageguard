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

  // Optional dashboard filters. All are no-ops when omitted, so the existing
  // response shape and unfiltered behavior are preserved.
  const state = c.req.query("state")?.toUpperCase() || null;
  const status = c.req.query("status") || null;
  const from = c.req.query("from") || null; // YYYY-MM-DD (application_date >=)
  const to = c.req.query("to") || null;     // YYYY-MM-DD (application_date <=)

  // Shared scope fragment applied to every loan query (company + soft-delete +
  // the optional filters). Status is applied separately because some queries
  // have their own status semantics.
  const scope = sql`
    company_id = ${user.companyId} AND is_deleted = false
    ${state ? sql`AND property_state = ${state}` : sql``}
    ${from ? sql`AND application_date >= ${from}` : sql``}
    ${to ? sql`AND application_date <= ${to}` : sql``}
  `;
  // When a specific status is requested it overrides the default "active loans"
  // filter used for exam-readiness metrics.
  const metricStatus = status ? sql`AND status = ${status}` : sql`AND status NOT IN ('denied','withdrawn')`;
  const attentionStatus = status ? sql`AND status = ${status}` : sql``;

  const [loanStats] = await sql`SELECT COUNT(*) as total, AVG(compliance_score) as avg_score, COUNT(CASE WHEN compliance_score < 50 THEN 1 END) as critical, COUNT(CASE WHEN compliance_score >= 80 THEN 1 END) as passing, SUM(CAST(loan_amount AS NUMERIC)) as total_volume FROM loans WHERE ${scope} ${metricStatus}`;
  const byStage = await sql`SELECT status, COUNT(*) as count FROM loans WHERE ${scope} GROUP BY status`;
  const byState = await sql`SELECT property_state, COUNT(*) as count, AVG(compliance_score) as avg_score FROM loans WHERE ${scope} GROUP BY property_state`;
  const programStats = await sql`SELECT status, COUNT(*) as count FROM compliance_programs WHERE company_id = ${user.companyId} GROUP BY status`;
  const upcomingDeadlines = await sql`SELECT * FROM reporting_deadlines WHERE company_id = ${user.companyId} ${state ? sql`AND (state_code = ${state} OR state_code IS NULL)` : sql``} AND status IN ('upcoming','in_progress') ORDER BY due_date LIMIT 5`;
  const attentionLoans = await sql`SELECT id, loan_number, borrower_last_name || ', ' || borrower_first_name as borrower, property_state, status, compliance_score, docs_complete, docs_required FROM loans WHERE ${scope} ${attentionStatus} AND compliance_score < 80 ORDER BY compliance_score LIMIT 5`;

  // Loan-processing operational counts for the dashboard top actions.
  const [overdueTasks] = await sql`SELECT COUNT(*)::int AS n FROM loan_tasks WHERE status IN ('open','in_progress','blocked') AND due_at IS NOT NULL AND due_at < NOW() AND loan_id IN (SELECT id FROM loans WHERE ${scope})`;
  const [upcomingClosings] = await sql`SELECT COUNT(*)::int AS n FROM loans WHERE ${scope} AND estimated_closing_date IS NOT NULL AND estimated_closing_date >= CURRENT_DATE AND estimated_closing_date <= CURRENT_DATE + INTERVAL '14 days' AND status NOT IN ('post_close','denied','withdrawn')`;
  const [txLogIssues] = await sql`SELECT COUNT(*)::int AS n FROM loans WHERE ${scope} AND transaction_log_status IN ('missing_fields','overdue')`;
  const loanOps = { overdueTasks: Number(overdueTasks?.n ?? 0), upcomingClosings: Number(upcomingClosings?.n ?? 0), txLogIssues: Number(txLogIssues?.n ?? 0) };

  // Reporting-deadline operational counts for the dashboard top actions.
  // overdue = not filed and past due; dueSoon = not filed and due within 30 days;
  // missingReceipts = marked filed but no receipt linked.
  const [overdueDeadlines] = await sql`SELECT COUNT(*)::int AS n FROM reporting_deadlines WHERE company_id = ${user.companyId} AND status <> 'filed' AND due_date < CURRENT_DATE`;
  const [dueSoonDeadlines] = await sql`SELECT COUNT(*)::int AS n FROM reporting_deadlines WHERE company_id = ${user.companyId} AND status <> 'filed' AND due_date >= CURRENT_DATE AND due_date <= CURRENT_DATE + INTERVAL '30 days'`;
  const [missingReceipts] = await sql`SELECT COUNT(*)::int AS n FROM reporting_deadlines WHERE company_id = ${user.companyId} AND status IN ('filed') AND evidence_file_path IS NULL`;
  const reportOps = { overdueDeadlines: Number(overdueDeadlines?.n ?? 0), dueSoonDeadlines: Number(dueSoonDeadlines?.n ?? 0), missingReceipts: Number(missingReceipts?.n ?? 0), transactionLogGaps: Number(txLogIssues?.n ?? 0) };

  return c.json({ examReadiness: { avgScore: Math.round(Number(loanStats.avg_score) || 0), totalLoans: Number(loanStats.total), criticalAlerts: Number(loanStats.critical), passingLoans: Number(loanStats.passing), totalVolume: Number(loanStats.total_volume) || 0 }, pipeline: byStage, stateBreakdown: byState, programs: programStats, upcomingDeadlines, attentionLoans, loanOps, reportOps, filters: { state, status, from, to } });
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
