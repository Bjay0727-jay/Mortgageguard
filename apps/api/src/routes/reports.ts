import { Hono } from "hono";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { objectsToCsv } from "../lib/csv";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  detectMimeType,
  sanitizeFilename,
  sanitizePathSegment,
} from "../lib/documents";
import { buildLoanEvidencePacket, buildRangeEvidencePacket, evidencePacketKey } from "../services/evidence-packet";

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

// ─── Transaction log (TX-SML 17 fields). CSV export is capability-gated. ───
reportRoutes.get("/transaction-log", async (c, next) => {
  if ((c.req.query("format") || "json") === "csv") return requireCapability("exportReports")(c, next);
  return requireCapability("viewReports")(c, next);
}, async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const format = c.req.query("format") || "json";
  const loans = await sql`
    SELECT l.loan_number, l.borrower_last_name || ', ' || l.borrower_first_name as borrower, l.application_date, l.property_address || ', ' || l.property_city || ', ' || l.property_state || ' ' || l.property_zip as property, l.interest_rate, l.loan_purpose, l.loan_product, l.loan_type, l.loan_term, l.lien_position, l.occupancy_type, l.status, l.closing_date, u.name as originator, l.originator_nmls_id, l.lender_name, l.lender_nmls_id, l.tx_log_entry_date
    FROM loans l LEFT JOIN users u ON u.id = l.originator_id
    WHERE l.company_id = ${user.companyId} AND l.is_deleted = false ORDER BY l.application_date DESC`;

  if (format === "csv") {
    // RFC 4180-safe serialization (preserves all TX transaction-log fields).
    const csv = objectsToCsv<any>([
      { header: "Loan #", value: (l) => l.loan_number },
      { header: "Borrower", value: (l) => l.borrower },
      { header: "App Date", value: (l) => l.application_date },
      { header: "Property", value: (l) => l.property },
      { header: "Rate", value: (l) => l.interest_rate },
      { header: "Purpose", value: (l) => l.loan_purpose },
      { header: "Product", value: (l) => l.loan_product },
      { header: "Type", value: (l) => l.loan_type },
      { header: "Term", value: (l) => l.loan_term },
      { header: "Lien", value: (l) => l.lien_position },
      { header: "Occupancy", value: (l) => l.occupancy_type },
      { header: "Status", value: (l) => l.status },
      { header: "Close Date", value: (l) => l.closing_date },
      { header: "Originator", value: (l) => l.originator },
      { header: "NMLS", value: (l) => l.originator_nmls_id },
      { header: "Lender", value: (l) => l.lender_name },
      { header: "Lender NMLS", value: (l) => l.lender_nmls_id },
    ], loans as any[]);

    await audit(c, user, { type: "report.exported", entityId: user.companyId, action: "export_transaction_log", details: { format: "csv", count: loans.length } });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="tx_transaction_log.csv"' } });
  }
  return c.json({ transactionLog: loans, count: loans.length });
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

// ─── Reporting deadlines with optional filtering ───
reportRoutes.get("/deadlines", async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const status = c.req.query("status") || null;
  const state = c.req.query("state")?.toUpperCase() || null;
  const quarter = c.req.query("quarter") || null;
  const dueSoon = c.req.query("dueSoon"); // "true" => due within 30 days and not filed

  const deadlines = await sql`
    SELECT * FROM reporting_deadlines
    WHERE company_id = ${user.companyId}
      ${status ? sql`AND status = ${status}` : sql``}
      ${state ? sql`AND state_code = ${state}` : sql``}
      ${quarter ? sql`AND quarter = ${quarter}` : sql``}
      ${dueSoon === "true" ? sql`AND status <> 'filed' AND due_date <= (CURRENT_DATE + INTERVAL '30 days')` : sql``}
    ORDER BY due_date`;
  return c.json({ deadlines, filters: { status, state, quarter, dueSoon: dueSoon === "true" } });
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

// ─── File a report with evidence (status + filed date + confirmation # + notes + receipt) ───
reportRoutes.post("/deadlines/:id/file", requireCapability("manageReportDeadlines"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);

  const [deadline] = await sql`SELECT id FROM reporting_deadlines WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!deadline) return c.json({ error: "Deadline not found" }, 404);

  const form = await c.req.formData();
  const status = (form.get("status") as string) || "filed";
  const filedDate = (form.get("filedDate") as string) || null; // YYYY-MM-DD
  const confirmationNumber = (form.get("confirmationNumber") as string) || null;
  const notes = (form.get("notes") as string) || null;
  const file = form.get("file") as unknown as File | null;

  // Optional filing receipt → company-scoped EXPORTS key.
  let evidenceKey: string | null = null;
  if (file && typeof file === "object" && "arrayBuffer" in file) {
    if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
      return c.json({ error: `File exceeds ${Math.floor(MAX_DOCUMENT_UPLOAD_BYTES / 1024 / 1024)}MB upload limit` }, 413);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectMimeType(bytes, file.type);
    if (!mime || !ALLOWED_DOCUMENT_MIME_TYPES.includes(mime)) {
      return c.json({ error: "Unsupported file type. Upload PDF, DOCX, PNG, JPG, or JPEG." }, 415);
    }
    evidenceKey = `reporting-evidence/${sanitizePathSegment(user.companyId)}/${sanitizePathSegment(id)}/${Date.now()}-${sanitizeFilename(file.name)}`;
    await c.env.EXPORTS.put(evidenceKey, bytes, { httpMetadata: { contentType: mime } });
  }

  const [updated] = await sql`
    UPDATE reporting_deadlines SET
      status = ${status},
      filed_at = ${filedDate ? sql`${filedDate}::timestamptz` : sql`NOW()`},
      filed_by = ${user.userId}::uuid,
      confirmation_number = COALESCE(${confirmationNumber}, confirmation_number),
      notes = COALESCE(${notes}, notes),
      evidence_file_path = COALESCE(${evidenceKey}, evidence_file_path),
      updated_at = NOW()
    WHERE id = ${id} AND company_id = ${user.companyId}
    RETURNING *`;

  await audit(c, user, { type: "deadline.filed", entityId: id, action: "file_report", details: { status, confirmationNumber, filedDate, hasEvidence: Boolean(evidenceKey) } });
  return c.json({ deadline: updated });
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
