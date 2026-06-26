import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { objectsToCsv } from "../lib/csv";
import { deriveTransactionLogCompleteness, type TxLogLoan } from "../lib/transaction-log-integrity";
import {
  generateQuarterlyDeadlines,
  generateFinancialConditionDeadlines,
  deriveDeadlineStatus,
  deriveReportingSummary,
  type GeneratedDeadline,
} from "../lib/reporting-deadlines";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  detectMimeType,
  sanitizeFilename,
  sanitizePathSegment,
} from "../lib/documents";
import { buildLoanEvidencePacket, buildRangeEvidencePacket, evidencePacketKey } from "../services/evidence-packet";
import { tryCreateOutboxEvent } from "../lib/outbox";

export const reportRoutes = new Hono<{ Bindings: Env }>();

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

// Map a stored texas_cashout_type to the guide's home-equity classification.
function texasCashOutLabel(raw: unknown): string {
  const v = String(raw ?? "").toLowerCase().replace(/[()\s]/g, "");
  if (v === "none" || v === "") return "";
  if (v.includes("a6") || v.includes("50a6") || v.includes("homeequity50a6")) return "50(a)(6)";
  if (v.includes("f2") || v.includes("50f2")) return "50(f)(2)";
  return String(raw);
}

// The 23 required Texas transaction-log fields (TX-SML guide). `value` reads the
// raw loan row; `txlog` is the derived completeness for the same row.
const TX_LOG_COLUMNS: { key: string; header: string; value: (l: any, tx: ReturnType<typeof deriveTransactionLogCompleteness>) => unknown }[] = [
  { key: "loanNumber", header: "Loan Number", value: (l) => l.loan_number },
  { key: "applicantName", header: "Applicant Name", value: (l) => [l.borrower_last_name, l.borrower_first_name].filter(Boolean).join(", ") },
  { key: "applicationDate", header: "Application Date", value: (l) => l.application_date },
  { key: "propertyStreet", header: "Property Street", value: (l) => l.property_address },
  { key: "propertyCity", header: "Property City", value: (l) => l.property_city },
  { key: "propertyState", header: "Property State", value: (l) => l.property_state },
  { key: "propertyZip", header: "Property ZIP", value: (l) => l.property_zip },
  { key: "interestRate", header: "Interest Rate", value: (l) => l.interest_rate },
  { key: "loanPurpose", header: "Loan Purpose", value: (l) => l.loan_purpose },
  { key: "texasCashOut", header: "Texas Cash-Out Classification", value: (l) => texasCashOutLabel(l.texas_cashout_type) },
  { key: "loanProduct", header: "Loan Product", value: (l) => l.loan_product },
  { key: "loanType", header: "Loan Type", value: (l) => l.loan_type },
  { key: "loanTerm", header: "Loan Term", value: (l) => l.loan_term },
  { key: "lienPosition", header: "Lien Position", value: (l) => l.lien_position },
  { key: "occupancyType", header: "Occupancy Type", value: (l) => l.occupancy_type },
  { key: "status", header: "Status", value: (l) => l.status },
  { key: "closingDate", header: "Closing Date", value: (l) => l.closing_date },
  { key: "originatorName", header: "Loan Originator Name", value: (l) => l.originator_name },
  { key: "originatorNmls", header: "Loan Originator NMLS ID", value: (l) => l.originator_nmls_id },
  { key: "lender", header: "Lender", value: (l) => l.lender_name },
  { key: "lenderNmls", header: "Lender NMLS ID", value: (l) => l.lender_nmls_id },
  { key: "completeness", header: "Transaction Log Completeness", value: (_l, tx) => tx.status },
  { key: "missingFields", header: "Missing Transaction Log Fields", value: (_l, tx) => tx.missingFields.join("; ") },
];

// ─── Texas mortgage transaction log export (CSV/JSON). CSV is export-gated. ───
reportRoutes.get("/transaction-log", async (c, next) => {
  if ((c.req.query("format") || "json") === "csv") return requireCapability("exportReports")(c, next);
  return requireCapability("viewReports")(c, next);
}, async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const format = c.req.query("format") || "json";
  const jurisdiction = (c.req.query("jurisdiction") || "TX").toUpperCase();
  const from = c.req.query("from") || null; // YYYY-MM-DD application_date >=
  const to = c.req.query("to") || null;     // YYYY-MM-DD application_date <=
  const now = new Date();

  const loans = await sql`
    SELECT l.loan_number, l.borrower_first_name, l.borrower_last_name, l.application_date,
      l.property_address, l.property_city, l.property_state, l.property_zip, l.interest_rate,
      l.loan_purpose, l.texas_cashout_type, l.loan_product, l.loan_type, l.loan_term,
      l.lien_position, l.occupancy_type, l.status, l.closing_date,
      COALESCE(l.loan_originator_name, u.name) AS originator_name, l.originator_nmls_id,
      l.lender_name, l.lender_nmls_id, l.transaction_log_entered_at
    FROM loans l LEFT JOIN users u ON u.id = l.originator_id
    WHERE l.company_id = ${user.companyId} AND l.is_deleted = false AND l.property_state = ${jurisdiction}
      ${from ? sql`AND l.application_date >= ${from}` : sql``}
      ${to ? sql`AND l.application_date <= ${to}` : sql``}
    ORDER BY l.application_date DESC`;

  // Is the jurisdiction's rule set loaded? (Surface a warning when not.)
  const [ruleCount] = await sql`SELECT COUNT(*)::int AS n FROM state_rules WHERE state_code = ${jurisdiction} AND is_active = true`;
  const rulesLoaded = Number(ruleCount?.n ?? 0) > 0;

  // Build rows + per-loan completeness.
  const warnings: string[] = [];
  const rows = (loans as any[]).map((l) => {
    const txInput: TxLogLoan = { ...l };
    const tx = deriveTransactionLogCompleteness(txInput, now);
    if (tx.missingFields.length > 0) {
      warnings.push(`Loan ${l.loan_number || "(unnumbered)"} is missing ${tx.missingFields.length} transaction-log field(s): ${tx.missingFields.join(", ")}.`);
    }
    const row: Record<string, unknown> = {};
    for (const col of TX_LOG_COLUMNS) row[col.key] = col.value(l, tx);
    return row;
  });
  if (rows.length === 0) warnings.push(`No ${jurisdiction} loans found for the selected period.`);
  if (!rulesLoaded) warnings.push(`${jurisdiction} compliance rules are not loaded; transaction-log completeness may be inaccurate.`);

  const periodStart = from;
  const periodEnd = to;

  // Record the export attempt (best-effort; never blocks the response).
  async function recordExport(fmt: string, r2Key: string | null) {
    try {
      await sql`INSERT INTO report_exports (company_id, report_key, jurisdiction, format, period_start, period_end, r2_key, generated_by, row_count, warning_count)
        VALUES (${user.companyId}, 'tx_transaction_log', ${jurisdiction}, ${fmt}, ${periodStart}, ${periodEnd}, ${r2Key}, ${user.userId}::uuid, ${rows.length}, ${warnings.length})`;
    } catch { /* report_exports is an audit convenience; ignore failures */ }
  }

  if (format === "csv") {
    // Formula-injection-safe, BOM-prefixed CSV for Excel.
    const csv = objectsToCsv<any>(
      TX_LOG_COLUMNS.map((col) => ({ header: col.header, value: (l: any) => l[col.key] })),
      rows,
      { formulaSafe: true, bom: true },
    );
    const label = `${periodStart || "all"}-to-${periodEnd || "all"}`;
    const filename = `mortgageguard-${jurisdiction.toLowerCase()}-transaction-log-${label}.csv`;
    await recordExport("csv", null);
    await audit(c, user, { type: "report.transaction_log_exported", entityId: user.companyId, action: "export_transaction_log", details: { format: "csv", jurisdiction, periodStart, periodEnd, rowCount: rows.length, warningCount: warnings.length } });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` } });
  }

  await recordExport("json", null);
  await audit(c, user, { type: "report.transaction_log_exported", entityId: user.companyId, action: "export_transaction_log", details: { format: "json", jurisdiction, periodStart, periodEnd, rowCount: rows.length, warningCount: warnings.length } });
  return c.json({ reportKey: "tx_transaction_log", jurisdiction, periodStart, periodEnd, rowCount: rows.length, warningCount: warnings.length, rulesLoaded, rows, warnings });
});

reportRoutes.get("/rmla/:quarter", async (c) => {
  const user = c.get("user");
  const quarter = c.req.param("quarter");
  const sql = db(c.env);
  const [q, year] = quarter.split("-");
  const qNum = parseInt(q.replace("Q", ""));
  const startMonth = (qNum - 1) * 3 + 1;
  const startDate = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = qNum * 3;
  const endDate = `${year}-${String(endMonth).padStart(2, "0")}-${endMonth === 2 ? 28 : [4,6,9,11].includes(endMonth) ? 30 : 31}`;
  const loans = await sql`SELECT COUNT(*) as total_loans, SUM(CAST(loan_amount AS NUMERIC)) as total_volume, COUNT(CASE WHEN status = 'post_close' THEN 1 END) as closed_loans, COUNT(CASE WHEN status = 'denied' THEN 1 END) as denied_loans FROM loans WHERE company_id = ${user.companyId} AND application_date BETWEEN ${startDate} AND ${endDate} AND is_deleted = false`;
  const byProduct = await sql`SELECT loan_product, COUNT(*) as count, SUM(CAST(loan_amount AS NUMERIC)) as volume FROM loans WHERE company_id = ${user.companyId} AND application_date BETWEEN ${startDate} AND ${endDate} AND is_deleted = false GROUP BY loan_product`;
  return c.json({ quarter, period: { start: startDate, end: endDate }, summary: loans[0], byProduct });
});

// Friendly names for the legacy report_type column, keyed by obligation.
const OBLIGATION_NAMES: Record<string, string> = {
  rmla: "Residential Mortgage Loan Activity (RMLA)",
  sssf: "State-Specific Supplemental Form (SSSF)",
  financial_condition: "Financial Condition",
};

// ─── Idempotently provision a company's reporting deadlines for a year ───
reportRoutes.post("/setup-deadlines", requireCapability("setupReportingDeadlines"),
  zValidator("json", z.object({ jurisdiction: z.string().default("TX"), year: z.number().int().min(2000).max(2100).optional() })),
  async (c) => {
    const user = c.get("user");
    const sql = db(c.env);
    const { jurisdiction: rawJur, year: rawYear } = c.req.valid("json");
    const jurisdiction = (rawJur || "TX").toUpperCase();
    const year = rawYear ?? new Date().getUTCFullYear();

    const [company] = await sql`SELECT entity_type FROM companies WHERE id = ${user.companyId}`;
    const entityType = company?.entity_type ?? null;

    // What we WANT to exist for this company/year.
    const desired: GeneratedDeadline[] = [
      ...generateQuarterlyDeadlines(year, "rmla", jurisdiction),
      ...generateQuarterlyDeadlines(year, "sssf", jurisdiction),
      ...generateFinancialConditionDeadlines(entityType, year, jurisdiction),
    ];

    // What already exists (idempotency key: obligation_key + period).
    const existing = await sql`SELECT obligation_key, period_start, period_end FROM reporting_deadlines WHERE company_id = ${user.companyId} AND jurisdiction = ${jurisdiction}`;
    const seen = new Set((existing as any[]).map((r) => `${r.obligation_key}|${String(r.period_start).slice(0, 10)}|${String(r.period_end).slice(0, 10)}`));

    let created = 0;
    for (const d of desired) {
      const key = `${d.obligationKey}|${d.periodStart}|${d.periodEnd}`;
      if (seen.has(key)) continue;
      await sql`
        INSERT INTO reporting_deadlines (company_id, report_type, state_code, quarter, due_date, status, obligation_key, jurisdiction, period_start, period_end)
        VALUES (${user.companyId}, ${OBLIGATION_NAMES[d.obligationKey] ?? d.obligationKey}, ${jurisdiction}, ${d.quarter}, ${d.dueDate}, 'upcoming', ${d.obligationKey}, ${jurisdiction}, ${d.periodStart}, ${d.periodEnd})`;
      created++;
    }

    await audit(c, user, { type: "reports.deadlines_setup", entityId: user.companyId, action: "setup_reporting_deadlines", details: { jurisdiction, year, entityType, desired: desired.length, created, skipped: desired.length - created } });
    return c.json({ jurisdiction, year, entityType, created, skipped: desired.length - created, total: desired.length }, 201);
  });

// ─── Reporting deadlines with summary + optional filtering ───
reportRoutes.get("/deadlines", async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const status = c.req.query("status") || null;
  const jurisdiction = (c.req.query("jurisdiction") || c.req.query("state"))?.toUpperCase() || null;
  const quarter = c.req.query("quarter") || null;
  const from = c.req.query("from") || null; // due_date >=
  const to = c.req.query("to") || null;     // due_date <=
  const dueSoon = c.req.query("dueSoon"); // "true" => due within 30 days and not filed

  const rows = await sql`
    SELECT * FROM reporting_deadlines
    WHERE company_id = ${user.companyId}
      ${status ? sql`AND status = ${status}` : sql``}
      ${jurisdiction ? sql`AND (jurisdiction = ${jurisdiction} OR state_code = ${jurisdiction})` : sql``}
      ${quarter ? sql`AND quarter = ${quarter}` : sql``}
      ${from ? sql`AND due_date >= ${from}` : sql``}
      ${to ? sql`AND due_date <= ${to}` : sql``}
      ${dueSoon === "true" ? sql`AND status <> 'filed' AND due_date <= (CURRENT_DATE + INTERVAL '30 days')` : sql``}
    ORDER BY due_date`;

  const now = new Date();
  // Decorate each deadline with its live (derived) status without mutating the
  // stored status; the summary uses the same derivation.
  const deadlines = (rows as any[]).map((d) => ({ ...d, derived_status: deriveDeadlineStatus(d, now) }));
  const summary = deriveReportingSummary(rows as any[], now);
  return c.json({ summary, deadlines, filters: { status, jurisdiction, quarter, from, to, dueSoon: dueSoon === "true" } });
});

reportRoutes.put("/deadlines/:id", requireCapability("manageReportDeadlines"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { status, notes } = await c.req.json();
  const sql = db(c.env);
  const [updated] = await sql`UPDATE reporting_deadlines SET status = COALESCE(${status || null}, status), notes = COALESCE(${notes || null}, notes), filed_at = CASE WHEN ${status} = 'filed' THEN NOW() ELSE filed_at END, filed_by = CASE WHEN ${status} = 'filed' THEN ${user.userId}::uuid ELSE filed_by END, updated_at = NOW() WHERE id = ${id} AND company_id = ${user.companyId} RETURNING *`;
  if (!updated) return c.json({ error: "Deadline not found" }, 404);
  return c.json({ deadline: updated });
});

// ─── Record a filing event (marks the deadline filed + immutable history) ───
reportRoutes.post("/deadlines/:id/file", requireCapability("fileReports"),
  zValidator("json", z.object({ filedAt: z.string().optional(), confirmationNumber: z.string().optional(), notes: z.string().optional() })),
  async (c) => {
    const user = c.get("user");
    const id = c.req.param("id");
    const sql = db(c.env);

    const [deadline] = await sql`SELECT id FROM reporting_deadlines WHERE id = ${id} AND company_id = ${user.companyId}`;
    if (!deadline) return c.json({ error: "Deadline not found" }, 404);

    const { filedAt, confirmationNumber, notes } = c.req.valid("json");
    const filedAtVal = filedAt || null;
    const confirmation = confirmationNumber || null;
    const noteVal = notes || null;

    // Immutable filing history row.
    await sql`INSERT INTO report_filing_events (company_id, reporting_deadline_id, filed_by, filed_at, confirmation_number, notes)
      VALUES (${user.companyId}, ${id}, ${user.userId}::uuid, ${filedAtVal ? sql`${filedAtVal}::timestamptz` : sql`NOW()`}, ${confirmation}, ${noteVal})`;

    const [updated] = await sql`
      UPDATE reporting_deadlines SET
        status = 'filed',
        filed_at = ${filedAtVal ? sql`${filedAtVal}::timestamptz` : sql`NOW()`},
        filed_by = ${user.userId}::uuid,
        confirmation_number = COALESCE(${confirmation}, confirmation_number),
        notes = COALESCE(${noteVal}, notes),
        updated_at = NOW()
      WHERE id = ${id} AND company_id = ${user.companyId}
      RETURNING *`;

    await audit(c, user, { type: "report.filed", entityId: id, action: "file_report", details: { confirmationNumber: confirmation, filedAt: filedAtVal, obligationKey: updated?.obligation_key, jurisdiction: updated?.jurisdiction } });
    await tryCreateOutboxEvent(sql, { companyId: user.companyId, eventType: "report.filed", aggregateType: "reporting_deadline", aggregateId: id, idempotencyKey: `report:${id}:filed:${confirmation ?? "noconf"}`, payload: { obligationKey: updated?.obligation_key, jurisdiction: updated?.jurisdiction, confirmationNumber: confirmation, filedAt: filedAtVal, actorUserId: user.userId } });
    return c.json({ deadline: updated });
  });

// ─── Upload a filing receipt for a deadline (document-hardened, company-scoped) ───
reportRoutes.post("/deadlines/:id/receipt", requireCapability("uploadReportReceipts"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);

  const [deadline] = await sql`SELECT id FROM reporting_deadlines WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!deadline) return c.json({ error: "Deadline not found" }, 404);

  const form = await c.req.formData();
  const file = form.get("file") as unknown as File | null;
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
    return c.json({ error: "A receipt file is required" }, 400);
  }
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    return c.json({ error: `File exceeds ${Math.floor(MAX_DOCUMENT_UPLOAD_BYTES / 1024 / 1024)}MB upload limit` }, 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMimeType(bytes, file.type);
  if (!mime || !ALLOWED_DOCUMENT_MIME_TYPES.includes(mime)) {
    return c.json({ error: "Unsupported file type. Upload PDF, DOCX, PNG, JPG, or JPEG." }, 415);
  }
  const receiptDocumentId = crypto.randomUUID();
  const receiptKey = `reporting-evidence/${sanitizePathSegment(user.companyId)}/${sanitizePathSegment(id)}/${Date.now()}-${sanitizeFilename(file.name)}`;
  await c.env.EXPORTS.put(receiptKey, bytes, { httpMetadata: { contentType: mime } });

  const [updated] = await sql`
    UPDATE reporting_deadlines SET
      evidence_file_path = ${receiptKey},
      receipt_document_id = ${receiptDocumentId}::uuid,
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${user.companyId}
    RETURNING *`;

  await audit(c, user, { type: "report.receipt_uploaded", entityId: id, action: "upload_report_receipt", details: { receiptDocumentId, r2Key: receiptKey, contentType: mime } });
  return c.json({ deadline: updated, receiptDocumentId, receiptKey }, 201);
});

// ─── Download a filing receipt (company-scoped) ───
reportRoutes.get("/deadlines/:id/evidence", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [deadline] = await sql`SELECT evidence_file_path FROM reporting_deadlines WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!deadline || !deadline.evidence_file_path) return c.json({ error: "No filing evidence found" }, 404);
  const obj = await c.env.EXPORTS.get(deadline.evidence_file_path);
  if (!obj) return c.json({ error: "Evidence file not found in storage" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": (obj as any).httpMetadata?.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename="filing-receipt-${id}"` } });
});

// ─── Examiner evidence packet ───
reportRoutes.post("/evidence-packet", requireCapability("exportReports"), async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const loanId = body.loanId as string | undefined;
  const from = (body.from as string) || null;
  const to = (body.to as string) || null;

  const packet = loanId
    ? await buildLoanEvidencePacket(loanId, user.companyId, c.env)
    : await buildRangeEvidencePacket(from, to, user.companyId, c.env);

  if (!packet) return c.json({ error: "Loan not found" }, 404);

  // Persist the artifact to EXPORTS under a company-scoped key.
  const scope = loanId ? `loan-${loanId}` : `range`;
  const key = evidencePacketKey(user.companyId, scope, Date.now(), crypto.randomUUID());
  await c.env.EXPORTS.put(key, JSON.stringify(packet, null, 2), { httpMetadata: { contentType: "application/json" } });

  await audit(c, user, { type: "evidence_packet.generated", entityId: loanId || user.companyId, action: "generate_evidence_packet", details: { scope, artifactKey: key } });

  return c.json({ packet, artifactKey: key, generatedAt: packet.generatedAt }, 201);
});

// ─── Download a previously generated packet artifact (company-scoped) ───
reportRoutes.get("/evidence-packet/download", requireCapability("exportReports"), async (c) => {
  const user = c.get("user");
  const key = c.req.query("key") || "";
  // Enforce company scoping on the key prefix so one company can't read another's.
  if (!key.startsWith(`evidence-packets/${sanitizePathSegment(user.companyId)}/`)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const obj = await c.env.EXPORTS.get(key);
  if (!obj) return c.json({ error: "Packet not found" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="evidence-packet.json"` } });
});
