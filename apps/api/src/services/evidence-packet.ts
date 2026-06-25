// ─────────────────────────────────────────────────────
// MortgageGuard — Examiner Evidence Packet builder
// Assembles an exam-ready manifest for a single loan or a date range, scoped to
// the requesting company. Pure-ish: reads only, no writes/side effects.
// ─────────────────────────────────────────────────────
import postgres from "postgres";
import type { Env } from "../env";

export interface PacketScoreBreakdown {
  score: number;
  totalWeight: number;
  satisfiedWeight: number;
  satisfiedChecks: number;
  totalChecks: number;
}

export interface LoanEvidencePacket {
  type: "loan";
  generatedAt: string;
  companyId: string;
  loan: Record<string, unknown>;
  complianceChecklist: Record<string, unknown>[];
  documents: Record<string, unknown>[];
  scoreBreakdown: PacketScoreBreakdown;
  timeline: Record<string, unknown>[];
  exceptions: { waivers: Record<string, unknown>[]; overrides: Record<string, unknown>[] };
  ruleCitations: { rule: string; state: string; citation: string | null; sourceUrl: string | null }[];
}

export interface RangeEvidencePacket {
  type: "range";
  generatedAt: string;
  companyId: string;
  period: { from: string | null; to: string | null };
  loanCount: number;
  loans: Record<string, unknown>[];
  scoreBreakdown: PacketScoreBreakdown;
}

const SATISFIED = new Set(["pass", "na", "waived"]);

// Weighted compliance score from already-fetched check rows (no DB write).
function scoreFromChecks(checks: { result: string; weight: unknown }[]): PacketScoreBreakdown {
  let totalWeight = 0;
  let satisfiedWeight = 0;
  let satisfiedChecks = 0;
  for (const check of checks) {
    const w = Number(check.weight) || 0;
    totalWeight += w;
    if (SATISFIED.has(check.result)) {
      satisfiedWeight += w;
      satisfiedChecks++;
    }
  }
  return {
    score: totalWeight > 0 ? Math.round((satisfiedWeight / totalWeight) * 100) : 0,
    totalWeight,
    satisfiedWeight,
    satisfiedChecks,
    totalChecks: checks.length,
  };
}

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

// Build a full evidence packet for one loan. Returns null when the loan does not
// belong to the company (company scoping enforced here).
export async function buildLoanEvidencePacket(loanId: string, companyId: string, env: Env): Promise<LoanEvidencePacket | null> {
  const sql = db(env);

  const [loan] = await sql`
    SELECT l.*, u.name AS originator_name
    FROM loans l LEFT JOIN users u ON u.id = l.originator_id
    WHERE l.id = ${loanId} AND l.company_id = ${companyId} AND l.is_deleted = false`;
  if (!loan) return null;

  const checks = await sql`
    SELECT rd.document_type AS "documentType", rd.display_name AS "displayName", rd.is_mandatory AS "mandatory",
           rd.weight, rd.pipeline_stage AS "pipelineStage", cc.result, cc.notes,
           sr.rule_name AS "rule", sr.state_code AS "state", sr.citation, sr.source_url AS "sourceUrl"
    FROM compliance_checks cc
    JOIN required_documents rd ON rd.id = cc.required_document_id
    JOIN state_rules sr ON sr.id = cc.state_rule_id
    WHERE cc.loan_id = ${loanId}
    ORDER BY rd.weight DESC, rd.display_name`;

  const documents = await sql`
    SELECT id, document_type AS "documentType", file_name AS "fileName", status, mime_type AS "mimeType", file_size AS "fileSize", uploaded_at AS "uploadedAt"
    FROM loan_documents WHERE loan_id = ${loanId} ORDER BY uploaded_at DESC`;

  const timeline = await sql`
    SELECT event_type AS "eventType", stage_from AS "stageFrom", stage_to AS "stageTo", description, metadata, occurred_at AS "occurredAt"
    FROM loan_timeline WHERE loan_id = ${loanId} ORDER BY occurred_at`;

  const checklistRows = checks as unknown as Record<string, unknown>[];

  // Waivers / exceptions: explicitly waived or N/A checks, plus any stage overrides.
  const waivers = checklistRows.filter((c) => c.result === "waived" || c.result === "na");
  const overrides = (timeline as unknown as Record<string, unknown>[]).filter((t) => t.eventType === "stage_override");

  // De-duplicated rule citations / source URLs.
  const citationMap = new Map<string, { rule: string; state: string; citation: string | null; sourceUrl: string | null }>();
  for (const c of checklistRows) {
    if (c.citation || c.sourceUrl) {
      const key = `${c.rule}|${c.state}`;
      if (!citationMap.has(key)) {
        citationMap.set(key, { rule: String(c.rule), state: String(c.state), citation: (c.citation as string) ?? null, sourceUrl: (c.sourceUrl as string) ?? null });
      }
    }
  }

  return {
    type: "loan",
    generatedAt: new Date().toISOString(),
    companyId,
    loan: loan as unknown as Record<string, unknown>,
    complianceChecklist: checklistRows,
    documents: documents as unknown as Record<string, unknown>[],
    scoreBreakdown: scoreFromChecks(checks as unknown as { result: string; weight: unknown }[]),
    timeline: timeline as unknown as Record<string, unknown>[],
    exceptions: { waivers, overrides },
    ruleCitations: [...citationMap.values()],
  };
}

// Build a lighter packet covering all (non-deleted) loans for the company in a
// date range — a portfolio-level examiner summary.
export async function buildRangeEvidencePacket(from: string | null, to: string | null, companyId: string, env: Env): Promise<RangeEvidencePacket> {
  const sql = db(env);
  const loans = await sql`
    SELECT id, loan_number AS "loanNumber", borrower_last_name || ', ' || borrower_first_name AS borrower,
           property_state AS "state", status, compliance_score AS "complianceScore", application_date AS "applicationDate"
    FROM loans
    WHERE company_id = ${companyId} AND is_deleted = false
      ${from ? sql`AND application_date >= ${from}` : sql``}
      ${to ? sql`AND application_date <= ${to}` : sql``}
    ORDER BY application_date DESC`;

  const rows = loans as unknown as { complianceScore: unknown }[];
  const avg = rows.length ? Math.round(rows.reduce((s, r) => s + (Number(r.complianceScore) || 0), 0) / rows.length) : 0;

  return {
    type: "range",
    generatedAt: new Date().toISOString(),
    companyId,
    period: { from, to },
    loanCount: rows.length,
    loans: loans as unknown as Record<string, unknown>[],
    scoreBreakdown: { score: avg, totalWeight: 0, satisfiedWeight: 0, satisfiedChecks: 0, totalChecks: rows.length },
  };
}

// Company-scoped R2 key for a generated packet artifact.
export function evidencePacketKey(companyId: string, scope: string, timestamp: number, id: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `evidence-packets/${safe(companyId)}/${safe(scope)}-${timestamp}-${safe(id)}.json`;
}
