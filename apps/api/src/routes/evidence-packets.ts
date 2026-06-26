import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import { sanitizePathSegment } from "../lib/documents";
import { deriveTransactionLogCompleteness, type TxLogLoan } from "../lib/transaction-log-integrity";
import { deriveDeadlineStatus } from "../lib/reporting-deadlines";
import {
  buildLoanEvidencePacket,
  buildProgramEvidencePacket,
  buildReportingEvidencePacket,
  buildExaminationReadinessPacket,
  type EvidencePacketPayload,
  type PacketMeta,
  type LoanPacketChecklistItem,
} from "../lib/evidence-packets";
import { renderEvidencePacketHtml, renderEvidencePacketJson } from "../lib/evidence-packet-renderer";

export const evidencePacketRoutes = new Hono<{ Bindings: Env }>();

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

function packetMeta(c: any, user: any, scope: Record<string, unknown>, company: any): PacketMeta {
  return {
    packetId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    generatedBy: { id: user.userId, name: company?.primary_contact ?? null, email: user.email ?? null },
    company: {
      id: user.companyId,
      name: company?.name ?? "Company",
      nmlsId: company?.nmls_id ?? null,
      entityType: company?.entity_type ?? null,
      licensedStates: company?.license_states ?? null,
    },
    scope,
  };
}

// Persist a generated packet to R2 (JSON + HTML) + the evidence_packets row.
async function persistPacket(c: any, user: any, sql: any, payload: EvidencePacketPayload, packetType: string): Promise<Record<string, unknown>> {
  const base = `exports/${sanitizePathSegment(user.companyId)}/evidence-packets/${sanitizePathSegment(packetType)}/${payload.packetId}`;
  const r2KeyJson = `${base}.json`;
  const r2KeyHtml = `${base}.html`;
  await c.env.EXPORTS.put(r2KeyJson, renderEvidencePacketJson(payload), { httpMetadata: { contentType: "application/json" } });
  await c.env.EXPORTS.put(r2KeyHtml, renderEvidencePacketHtml(payload), { httpMetadata: { contentType: "text/html" } });

  const [row] = await sql`
    INSERT INTO evidence_packets (id, company_id, packet_key, packet_type, title, status, scope, r2_key_json, r2_key_html, generated_by, row_count, warning_count, blocker_count, hash, metadata)
    VALUES (${payload.packetId}::uuid, ${user.companyId}, ${payload.packetKey}, ${packetType}, ${payload.title}, 'generated', ${sql.json(payload.scope)}, ${r2KeyJson}, ${r2KeyHtml}, ${user.userId}::uuid, ${payload.summary.totalItems}, ${payload.summary.warningCount}, ${payload.summary.blockerCount}, ${payload.hash ?? null}, ${sql.json({ summaryStatus: payload.summary.status })})
    RETURNING id, packet_key, packet_type, title, status, generated_at, warning_count, blocker_count`;
  await audit(c, user, { type: "evidence_packet.generated", entityId: payload.packetId, action: "generate_evidence_packet", details: { packetKey: payload.packetKey, packetType, scope: payload.scope, hash: payload.hash, rowCount: payload.summary.totalItems, warningCount: payload.summary.warningCount, blockerCount: payload.summary.blockerCount, r2Key: r2KeyJson } });
  return { ...row, formats: ["json", "html"] };
}

// On a generation failure, record a failed packet row so the history is honest.
async function recordFailure(c: any, user: any, sql: any, packetKey: string, packetType: string, scope: Record<string, unknown>, message: string) {
  try {
    const id = crypto.randomUUID();
    await sql`INSERT INTO evidence_packets (id, company_id, packet_key, packet_type, title, status, scope, generated_by, metadata)
      VALUES (${id}::uuid, ${user.companyId}, ${packetKey}, ${packetType}, ${`Failed ${packetType} packet`}, 'failed', ${sql.json(scope)}, ${user.userId}::uuid, ${sql.json({ error: message })})`;
    await audit(c, user, { type: "evidence_packet.failed", entityId: id, action: "generate_evidence_packet", details: { packetKey, packetType, error: message } });
  } catch { /* best effort */ }
}

async function companyRow(sql: any, companyId: string) {
  const [company] = await sql`SELECT name, nmls_id, entity_type, license_states, primary_contact, primary_email, allows_remote_work FROM companies WHERE id = ${companyId}`;
  return company ?? null;
}

const VALID_DOC = new Set(["uploaded", "signed", "delivered"]);
const INVALID_DOC = new Set(["rejected", "expired", "deleted", "superseded", "failed", "quarantined"]);

// ─── List packet history ───
evidencePacketRoutes.get("/", requireCapability("viewEvidencePackets"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const rows = await sql`
    SELECT id, packet_key, packet_type, title, status, generated_at, generated_by, warning_count, blocker_count, hash
    FROM evidence_packets WHERE company_id = ${user.companyId} AND status <> 'deleted' ORDER BY generated_at DESC LIMIT 200`;
  const packets = (rows as any[]).map((r) => ({ ...r, formats: r.status === "generated" ? ["json", "html"] : [] }));
  return c.json({ packets });
});

// ─── Packet metadata ───
evidencePacketRoutes.get("/:id", requireCapability("viewEvidencePackets"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const [packet] = await sql`SELECT * FROM evidence_packets WHERE id = ${c.req.param("id")} AND company_id = ${user.companyId} AND status <> 'deleted'`;
  if (!packet) return c.json({ error: "Packet not found" }, 404);
  return c.json({ packet });
});

// ─── Generate: loan evidence packet ───
evidencePacketRoutes.post("/loan/:loanId", requireCapability("generateEvidencePackets"),
  zValidator("json", z.object({ includeDocuments: z.boolean().optional(), includeAuditTrail: z.boolean().optional(), includeRegulatorySources: z.boolean().optional() }).optional()),
  async (c) => {
    const user = c.get("user");
    const sql = db(c.env);
    const loanId = c.req.param("loanId");
    const body = c.req.valid("json") ?? {};
    const scope = { loanId, includeDocuments: body.includeDocuments !== false, includeAuditTrail: body.includeAuditTrail !== false, includeRegulatorySources: body.includeRegulatorySources !== false };

    const [loan] = await sql`SELECT l.*, u.name AS originator_name FROM loans l LEFT JOIN users u ON u.id = l.originator_id WHERE l.id = ${loanId} AND l.company_id = ${user.companyId} AND l.is_deleted = false`;
    if (!loan) return c.json({ error: "Loan not found" }, 404);

    try {
      const company = await companyRow(sql, user.companyId);
      const [ruleCount] = await sql`SELECT COUNT(*)::int AS n FROM state_rules WHERE state_code = ${(loan.property_state || "TX")} AND is_active = true`;
      const rulesLoaded = Number(ruleCount?.n ?? 0) > 0;

      const checks = await sql`
        SELECT rd.document_type AS "documentType", rd.display_name AS "displayName", rd.is_mandatory AS "isMandatory", rd.pipeline_stage AS "pipelineStage",
               cc.result, sr.rule_name AS "rule", sr.citation, sr.source_url AS "sourceUrl"
        FROM compliance_checks cc
        JOIN required_documents rd ON rd.id = cc.required_document_id
        JOIN state_rules sr ON sr.id = cc.state_rule_id
        WHERE cc.loan_id = ${loanId} ORDER BY rd.weight DESC, rd.display_name`;
      const documents = body.includeDocuments === false ? [] : await sql`SELECT id, document_type AS "documentType", file_name AS "fileName", status, uploaded_by AS "uploadedBy", uploaded_at AS "uploadedAt", version FROM loan_documents WHERE loan_id = ${loanId} ORDER BY uploaded_at DESC`;
      const tasks = await sql`SELECT id, title, task_type AS "type", status, due_at AS "dueAt" FROM loan_tasks WHERE loan_id = ${loanId} ORDER BY due_at NULLS LAST`;
      const timeline = body.includeAuditTrail === false ? [] : await sql`SELECT event_type AS "eventType", description, occurred_at AS "occurredAt", metadata FROM loan_timeline WHERE loan_id = ${loanId} ORDER BY occurred_at`;

      // Map checks → checklist statuses. Treat documents with an invalid status as invalid evidence.
      const docByType = new Map<string, any>();
      for (const d of documents as any[]) if (!docByType.has(d.documentType)) docByType.set(d.documentType, d);
      const checklist: LoanPacketChecklistItem[] = (checks as any[]).map((ck) => {
        const doc = docByType.get(ck.documentType);
        let status: LoanPacketChecklistItem["status"];
        if (doc && INVALID_DOC.has(doc.status)) status = "invalid";
        else if (ck.result === "pass" || (doc && VALID_DOC.has(doc.status))) status = "satisfied";
        else if (ck.result === "na" || ck.result === "waived") status = "not_applicable";
        else status = "missing";
        return { documentType: ck.documentType, displayName: ck.displayName, isMandatory: !!ck.isMandatory, status, pipelineStage: ck.pipelineStage };
      });

      // Conditional flags from loan attributes.
      const flags: { code: string; label: string; reason?: string }[] = [];
      const cashout = String(loan.texas_cashout_type || "").toLowerCase();
      if (cashout.includes("50a6") || loan.loan_purpose === "home_equity_50a6") flags.push({ code: "tx_50a6", label: "Texas 50(a)(6) home equity" });
      if (cashout.includes("50f2")) flags.push({ code: "tx_50f2", label: "Texas 50(f)(2) refinance" });
      if (loan.loan_product === "reverse" || String(loan.loan_purpose).includes("reverse")) flags.push({ code: "reverse", label: "Reverse mortgage" });
      if (loan.loan_purpose === "wrap_mortgage" || loan.lien_position === "wrap") flags.push({ code: "wrap", label: "Wrap mortgage" });
      if (loan.loan_type === "arm") flags.push({ code: "arm", label: "Adjustable-rate mortgage" });
      if (company?.entity_type) flags.push({ code: "company_disclosure", label: `Texas Mortgage ${company.entity_type === "banker" ? "Banker" : "Company"} disclosure` });

      // Gate proxy: blocked when a mandatory checklist item is missing/invalid.
      const unsatisfied = checklist.filter((i) => i.isMandatory && (i.status === "missing" || i.status === "invalid")).map((i) => i.displayName);
      const gate = { canAdvance: unsatisfied.length === 0, unsatisfied };

      const txInput: TxLogLoan = { ...loan };
      const tx = deriveTransactionLogCompleteness(txInput);

      const citationMap = new Map<string, any>();
      for (const ck of checks as any[]) if (ck.citation || ck.sourceUrl) { const k = `${ck.rule}`; if (!citationMap.has(k)) citationMap.set(k, { rule: ck.rule, citation: ck.citation ?? null, sourceUrl: ck.sourceUrl ?? null }); }

      const payload = buildLoanEvidencePacket({
        meta: packetMeta(c, user, scope, company),
        loan: {
          id: loan.id, loanNumber: loan.loan_number, applicantName: `${loan.borrower_last_name ?? ""}, ${loan.borrower_first_name ?? ""}`.replace(/^, |, $/g, ""),
          propertyAddress: loan.property_address, propertyState: loan.property_state, loanPurpose: loan.loan_purpose, texasCashout: loan.texas_cashout_type,
          loanProduct: loan.loan_product, loanType: loan.loan_type, lienPosition: loan.lien_position, occupancy: loan.occupancy_type,
          applicationDate: loan.application_date, closingDate: loan.closing_date, stage: loan.status, originatorName: loan.loan_originator_name || loan.originator_name,
          originatorNmls: loan.originator_nmls_id, lenderName: loan.lender_name, lenderNmls: loan.lender_nmls_id, complianceScore: loan.compliance_score,
        },
        txLog: { complete: tx.complete, missingFields: tx.missingFields, status: tx.status },
        checklist,
        documents: documents as any[],
        conditionalFlags: flags,
        gate,
        tasks: tasks as any[],
        citations: [...citationMap.values()],
        auditTrail: timeline as any[],
        rulesLoaded,
      });

      const record = await persistPacket(c, user, sql, payload, "loan");
      return c.json({ packet: payload, record }, 201);
    } catch (e: any) {
      await recordFailure(c, user, sql, "loan_evidence_packet", "loan", scope, e?.message || "generation failed");
      return c.json({ error: "Packet generation failed" }, 500);
    }
  });

// ─── Generate: program evidence packet ───
evidencePacketRoutes.post("/programs", requireCapability("generateEvidencePackets"),
  zValidator("json", z.object({ includeRecommendedPrograms: z.boolean().optional(), includeEvidence: z.boolean().optional(), includeRegulatorySources: z.boolean().optional(), includeSourceVerification: z.boolean().optional() }).optional()),
  async (c) => {
    const user = c.get("user");
    const sql = db(c.env);
    const body = c.req.valid("json") ?? {};
    const scope = { includeRecommendedPrograms: !!body.includeRecommendedPrograms, includeEvidence: body.includeEvidence !== false, includeRegulatorySources: body.includeRegulatorySources !== false, includeSourceVerification: body.includeSourceVerification !== false };

    try {
      const company = await companyRow(sql, user.companyId);
      const programRows = await sql`SELECT program_key AS "programKey", program_name AS "name", status, owner, is_required AS "isRequired", applicable, file_path AS "filePath", document_version AS "documentVersion", document_status AS "documentStatus", last_reviewed_at AS "lastReviewedAt", next_review_due_at AS "nextReviewDueAt" FROM compliance_programs WHERE company_id = ${user.companyId} ORDER BY is_required DESC, program_name`;

      const now = Date.now();
      const programs = (programRows as any[]).map((p) => ({
        programKey: p.programKey || p.name,
        name: p.name,
        status: p.status,
        owner: p.owner,
        isRequired: !!p.isRequired,
        applicable: p.applicable,
        currentDocument: p.filePath ? { fileName: p.filePath, version: p.documentVersion, status: p.documentStatus } : null,
        missingEvidence: p.status === "missing" || p.status === "incomplete" ? ["program document"] : [],
        lastReviewedAt: p.lastReviewedAt,
        nextReviewDueAt: p.nextReviewDueAt,
        reviewOverdue: p.nextReviewDueAt ? new Date(p.nextReviewDueAt).getTime() < now : false,
        sources: [] as any[],
      }));

      const payload = buildProgramEvidencePacket({
        meta: packetMeta(c, user, scope, company),
        programs,
        includeRecommendedPrograms: scope.includeRecommendedPrograms,
        includeRegulatorySources: scope.includeRegulatorySources,
        includeSourceVerification: scope.includeSourceVerification,
        auditTrail: [],
      });
      const record = await persistPacket(c, user, sql, payload, "programs");
      return c.json({ packet: payload, record }, 201);
    } catch (e: any) {
      await recordFailure(c, user, sql, "program_evidence_packet", "programs", scope, e?.message || "generation failed");
      return c.json({ error: "Packet generation failed" }, 500);
    }
  });

// ─── Generate: reporting evidence packet ───
evidencePacketRoutes.post("/reporting", requireCapability("generateEvidencePackets"),
  zValidator("json", z.object({ jurisdiction: z.string().optional(), periodStart: z.string().optional(), periodEnd: z.string().optional(), includeReceipts: z.boolean().optional(), includeTransactionLogExports: z.boolean().optional() }).optional()),
  async (c) => {
    const user = c.get("user");
    const sql = db(c.env);
    const body = c.req.valid("json") ?? {};
    const jurisdiction = (body.jurisdiction || "TX").toUpperCase();
    const scope = { jurisdiction, periodStart: body.periodStart ?? null, periodEnd: body.periodEnd ?? null, includeReceipts: body.includeReceipts !== false, includeTransactionLogExports: body.includeTransactionLogExports !== false };

    try {
      const company = await companyRow(sql, user.companyId);
      const now = new Date();
      const deadlineRows = await sql`SELECT * FROM reporting_deadlines WHERE company_id = ${user.companyId} ORDER BY due_date`;
      const deadlines = (deadlineRows as any[]).map((d) => ({
        obligationKey: d.obligation_key, reportType: d.report_type, jurisdiction: d.jurisdiction || d.state_code, period: d.quarter, dueDate: d.due_date,
        status: deriveDeadlineStatus(d, now), filedAt: d.filed_at, filedBy: d.filed_by, confirmationNumber: d.confirmation_number, hasReceipt: !!d.evidence_file_path,
      }));
      const exports = await sql`SELECT report_key AS "reportKey", format, period_start AS "periodStart", period_end AS "periodEnd", row_count AS "rowCount", warning_count AS "warningCount", generated_at AS "generatedAt" FROM report_exports WHERE company_id = ${user.companyId} ORDER BY generated_at DESC LIMIT 50`;
      const [txTotal] = await sql`SELECT COUNT(*)::int AS n FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false AND property_state = ${jurisdiction}`;
      const [txGaps] = await sql`SELECT COUNT(*)::int AS n FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false AND property_state = ${jurisdiction} AND transaction_log_status IN ('missing_fields','overdue')`;

      const payload = buildReportingEvidencePacket({
        meta: packetMeta(c, user, scope, company),
        deadlines,
        exports: exports as any[],
        txLogSummary: { rowCount: Number(txTotal?.n ?? 0), missingFieldLoans: Number(txGaps?.n ?? 0) },
        includeReceipts: scope.includeReceipts,
        includeTransactionLogExports: scope.includeTransactionLogExports,
        auditTrail: [],
      });
      const record = await persistPacket(c, user, sql, payload, "reporting");
      return c.json({ packet: payload, record }, 201);
    } catch (e: any) {
      await recordFailure(c, user, sql, "reporting_evidence_packet", "reporting", scope, e?.message || "generation failed");
      return c.json({ error: "Packet generation failed" }, 500);
    }
  });

// ─── Generate: full examination readiness packet ───
evidencePacketRoutes.post("/examination", requireCapability("generateEvidencePackets"),
  zValidator("json", z.object({ jurisdiction: z.string().optional(), periodStart: z.string().optional(), periodEnd: z.string().optional(), includeLoans: z.boolean().optional(), loanIds: z.array(z.string()).optional(), includePrograms: z.boolean().optional(), includeReports: z.boolean().optional(), includeAuditTrail: z.boolean().optional(), includeRegulatorySources: z.boolean().optional() }).optional()),
  async (c) => {
    const user = c.get("user");
    const sql = db(c.env);
    const body = c.req.valid("json") ?? {};
    const jurisdiction = (body.jurisdiction || "TX").toUpperCase();
    const scope = { jurisdiction, periodStart: body.periodStart ?? null, periodEnd: body.periodEnd ?? null, includeLoans: body.includeLoans !== false, loanIds: body.loanIds ?? null, includePrograms: body.includePrograms !== false, includeReports: body.includeReports !== false, includeAuditTrail: body.includeAuditTrail !== false, includeRegulatorySources: body.includeRegulatorySources !== false };

    try {
      const company = await companyRow(sql, user.companyId);
      const [ruleCount] = await sql`SELECT COUNT(*)::int AS n FROM state_rules WHERE state_code = ${jurisdiction} AND is_active = true`;
      const rulesLoaded = Number(ruleCount?.n ?? 0) > 0;
      const profileComplete = !!(company?.name && company?.nmls_id && company?.entity_type && company?.primary_contact && company?.primary_email && (company?.license_states?.length ?? 0) > 0);

      const programRows = await sql`SELECT status, is_required AS "isRequired", applicable FROM compliance_programs WHERE company_id = ${user.companyId}`;
      const reqApplicable = (programRows as any[]).filter((p) => p.isRequired && p.applicable !== false);
      const NEEDS_WORK = ["missing", "incomplete", "overdue", "source_review_due", "review_due"];
      const programs = { requiredTotal: reqApplicable.length, requiredCurrent: reqApplicable.filter((p) => p.status === "current").length, requiredNeedsWork: reqApplicable.filter((p) => NEEDS_WORK.includes(p.status)).length, overdue: reqApplicable.filter((p) => p.status === "overdue").length };

      const now = new Date();
      const deadlineRows = await sql`SELECT due_date, status, filed_at, evidence_file_path FROM reporting_deadlines WHERE company_id = ${user.companyId}`;
      let overdueDeadlines = 0, dueSoonDeadlines = 0, missingReceipts = 0, filed = 0;
      for (const d of deadlineRows as any[]) {
        const st = deriveDeadlineStatus(d, now);
        if (st === "overdue") overdueDeadlines++;
        else if (st === "due_soon" || st === "due") dueSoonDeadlines++;
        if (st === "filed") { filed++; if (!d.evidence_file_path) missingReceipts++; }
      }

      const [txTotal] = await sql`SELECT COUNT(*)::int AS n FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false`;
      const [txGaps] = await sql`SELECT COUNT(*)::int AS n FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false AND transaction_log_status IN ('missing_fields','overdue')`;
      const [attention] = await sql`SELECT COUNT(*)::int AS n FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false AND compliance_score < 80`;

      const loanRows = scope.includeLoans === false ? [] : await sql`
        SELECT id, loan_number AS "loanNumber", compliance_score AS "complianceScore", status, docs_required AS "docsRequired", docs_complete AS "docsComplete"
        FROM loans WHERE company_id = ${user.companyId} AND is_deleted = false
          ${body.loanIds && body.loanIds.length ? sql`AND id = ANY(${body.loanIds})` : sql``}
          ${body.periodStart ? sql`AND application_date >= ${body.periodStart}` : sql``}
          ${body.periodEnd ? sql`AND application_date <= ${body.periodEnd}` : sql``}
        ORDER BY compliance_score ASC LIMIT 100`;
      const loanSummaries = (loanRows as any[]).map((l) => ({ loanId: l.id, loanNumber: l.loanNumber, complianceScore: l.complianceScore, status: l.status, blockers: Number(l.docsRequired ?? 0) > Number(l.docsComplete ?? 0) ? 1 : 0, warnings: 0 }));

      const payload = buildExaminationReadinessPacket({
        meta: packetMeta(c, user, scope, company),
        setup: { coreSetupComplete: profileComplete && rulesLoaded && programs.requiredNeedsWork === 0, profileComplete, rulesLoaded, licensedStates: company?.license_states ?? [], warnings: [] },
        programs,
        sourceVerification: { total: 0, verified: 0, due: 0 },
        reporting: { overdueDeadlines, dueSoonDeadlines, missingReceipts, filed },
        txLogSummary: { rowCount: Number(txTotal?.n ?? 0), missingFieldLoans: Number(txGaps?.n ?? 0) },
        loans: { total: Number(txTotal?.n ?? 0), attention: Number(attention?.n ?? 0) },
        loanSummaries,
        auditSummary: [],
      });
      const record = await persistPacket(c, user, sql, payload, "examination");
      return c.json({ packet: payload, record }, 201);
    } catch (e: any) {
      await recordFailure(c, user, sql, "examination_readiness_packet", "examination", scope, e?.message || "generation failed");
      return c.json({ error: "Packet generation failed" }, 500);
    }
  });

// ─── Download a packet (JSON or HTML), company-scoped + audited ───
evidencePacketRoutes.get("/:id/download", requireCapability("downloadEvidencePackets"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const format = (c.req.query("format") || "json").toLowerCase();
  const [packet] = await sql`SELECT id, packet_type, status, r2_key_json, r2_key_html FROM evidence_packets WHERE id = ${c.req.param("id")} AND company_id = ${user.companyId}`;
  if (!packet || packet.status === "deleted") return c.json({ error: "Packet not found" }, 404);

  const key = format === "html" ? packet.r2_key_html : packet.r2_key_json;
  if (!key) return c.json({ error: "Format not available" }, 404);
  const obj = await c.env.EXPORTS.get(key);
  if (!obj) return c.json({ error: "Packet artifact not found in storage" }, 404);

  await audit(c, user, { type: "evidence_packet.downloaded", entityId: packet.id, action: "download_evidence_packet", details: { format, packetType: packet.packet_type, r2Key: key } });
  const contentType = format === "html" ? "text/html; charset=utf-8" : "application/json";
  return new Response(obj.body, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="evidence-packet-${packet.id}.${format === "html" ? "html" : "json"}"` } });
});

// ─── Soft-delete a packet ───
evidencePacketRoutes.delete("/:id", requireCapability("deleteEvidencePackets"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const [updated] = await sql`UPDATE evidence_packets SET status = 'deleted', updated_at = NOW() WHERE id = ${c.req.param("id")} AND company_id = ${user.companyId} AND status <> 'deleted' RETURNING id`;
  if (!updated) return c.json({ error: "Packet not found" }, 404);
  await audit(c, user, { type: "evidence_packet.deleted", entityId: updated.id, action: "delete_evidence_packet", details: {} });
  return c.json({ deleted: true, id: updated.id });
});
