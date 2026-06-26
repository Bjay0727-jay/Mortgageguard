import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_UPLOAD_BYTES,
  detectMimeType,
  sanitizeFilename,
  sanitizePathSegment,
} from "../lib/documents";
import {
  REQUIRED_COMPLIANCE_PROGRAMS,
  RECOMMENDED_COMPLIANCE_PROGRAMS,
  REGULATORY_SOURCES,
  PROGRAM_SOURCE_LINKS,
  PROGRAM_EVIDENCE_REQUIREMENTS,
  PROGRAM_DOCUMENT_REQUIREMENTS,
  getProgramDef,
  type RequiredProgramDef,
} from "../lib/compliance-catalog";
import { computeProgramStatus, type ComplianceProgramStatus } from "../lib/program-integrity";

export const programRoutes = new Hono<{ Bindings: Env }>();

function db(env: Env) {
  return postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
}

function audit(c: any, user: any, partial: Record<string, unknown>) {
  return c.env.AUDIT_QUEUE.send({
    entityType: "program",
    companyId: user.companyId,
    userId: user.userId,
    ipAddress: c.req.header("cf-connecting-ip") || "unknown",
    timestamp: new Date().toISOString(),
    ...partial,
  });
}

const VALID_EVIDENCE_STATUSES = ["uploaded", "accepted", "current"];

// ─── Seed the global compliance catalog (sources, links, evidence, doc reqs).
// Idempotent: safe to call on every setup. Company-independent. ───
async function seedCatalog(sql: any) {
  for (const s of REGULATORY_SOURCES) {
    await sql`
      INSERT INTO regulatory_sources (source_key, title, citation, jurisdiction, agency, source_type, source_url, rulemaking_citation, rulemaking_url, guidance_url, notes)
      VALUES (${s.sourceKey}, ${s.title}, ${s.citation}, ${s.jurisdiction}, ${s.agency ?? null}, ${s.sourceType}, ${s.sourceUrl}, ${s.rulemakingCitation ?? null}, ${s.rulemakingUrl ?? null}, ${s.guidanceUrl ?? null}, ${s.notes ?? null})
      ON CONFLICT (source_key) DO NOTHING`;
  }
  for (const l of PROGRAM_SOURCE_LINKS) {
    await sql`
      INSERT INTO compliance_program_source_links (program_key, source_key, citation, applies_to)
      VALUES (${l.programKey}, ${l.sourceKey}, ${l.citation}, ${l.appliesTo})
      ON CONFLICT (program_key, source_key) DO NOTHING`;
  }
  for (const e of PROGRAM_EVIDENCE_REQUIREMENTS) {
    await sql`
      INSERT INTO compliance_program_evidence_requirements (program_key, evidence_key, display_name, description, required, source_key, cadence_months)
      VALUES (${e.programKey}, ${e.evidenceKey}, ${e.displayName}, ${e.description ?? null}, ${e.required ?? true}, ${e.sourceKey ?? null}, ${e.cadenceMonths ?? null})
      ON CONFLICT (program_key, evidence_key) DO NOTHING`;
  }
  for (const d of PROGRAM_DOCUMENT_REQUIREMENTS) {
    await sql`
      INSERT INTO compliance_program_document_requirements (program_key, document_type, display_name, required)
      VALUES (${d.programKey}, ${d.documentType}, ${d.displayName}, ${d.required})
      ON CONFLICT (program_key, document_type) DO NOTHING`;
  }
}

// Create a company program row for a catalog definition (idempotent via NOT EXISTS).
async function ensureProgram(sql: any, companyId: string, def: RequiredProgramDef, applicable: boolean | null) {
  const inserted = await sql`
    INSERT INTO compliance_programs (company_id, program_type, program_name, program_key, category, is_required, is_conditionally_required, applicable, required_by, required_document_type, required_document_name, review_frequency_months, status)
    SELECT ${companyId}, ${def.requiredDocumentType}, ${def.name}, ${def.programKey}, ${def.category}, ${def.isRequired}, ${def.isConditionallyRequired}, ${applicable}, ${def.requiredBy}, ${def.requiredDocumentType}, ${def.requiredDocumentName}, ${def.reviewFrequencyMonths}, ${applicable === false ? "not_applicable" : "missing"}
    WHERE NOT EXISTS (SELECT 1 FROM compliance_programs WHERE company_id = ${companyId} AND program_key = ${def.programKey})
    RETURNING id`;
  return inserted.length > 0;
}

// ─── Enrichment: combine a program row with its evidence + sources and compute
// integrity status, blockers, warnings, and next action. ───
function enrich(program: any, evReqs: any[], evidenceRows: any[], links: any[]) {
  const programKey = program.program_key;
  const reqs = evReqs.filter((r) => r.program_key === programKey);
  const evByKey = new Map(evidenceRows.filter((e) => e.program_id === program.id).map((e) => [e.evidence_key, e]));
  const sources = links.filter((l) => l.program_key === programKey);

  const evidence = reqs.map((r) => {
    const row = evByKey.get(r.evidence_key);
    const status = row?.status ?? "missing";
    return {
      evidenceKey: r.evidence_key,
      displayName: r.display_name,
      description: r.description ?? null,
      required: r.required ?? true,
      sourceKey: r.source_key ?? null,
      status,
      fileName: row?.file_name ?? null,
      notApplicable: status === "not_applicable",
      satisfied: VALID_EVIDENCE_STATUSES.includes(status),
    };
  });

  const applicable = program.applicable !== false;
  const integrity = computeProgramStatus({
    isRequired: program.is_required,
    applicable,
    archived: program.archived === true,
    hasDocument: !!program.file_path,
    documentStatus: program.document_status ?? (program.file_path ? "current" : null),
    owner: program.owner,
    lastReviewedAt: program.last_reviewed_at,
    nextReviewDue: program.next_review_due,
    evidence: evidence.map((e) => ({ required: e.required, satisfied: e.satisfied, notApplicable: e.notApplicable })),
    sources: sources.map((s) => ({ verificationStatus: s.verification_status, nextVerificationDueAt: s.next_verification_due_at })),
  });

  return {
    id: program.id,
    programKey,
    name: program.program_name,
    category: program.category,
    requiredBy: program.required_by,
    isRequired: program.is_required,
    isConditionallyRequired: program.is_conditionally_required ?? false,
    applicable,
    owner: program.owner ?? null,
    version: program.version ?? null,
    filePath: program.file_path ?? null,
    documentName: program.required_document_name ?? null,
    documentType: program.required_document_type ?? null,
    documentStatus: program.document_status ?? (program.file_path ? "current" : null),
    reviewFrequencyMonths: program.review_frequency_months ?? 12,
    lastReviewedAt: program.last_reviewed_at ?? null,
    nextReviewDue: program.next_review_due ?? null,
    status: integrity.status,
    blockers: integrity.blockers,
    warnings: integrity.warnings,
    nextAction: integrity.nextAction,
    satisfiedEvidence: integrity.satisfiedEvidence,
    requiredEvidence: integrity.requiredEvidence,
    evidence,
    sources: sources.map((s) => ({
      id: s.source_id,
      sourceKey: s.source_key,
      citation: s.citation,
      appliesTo: s.applies_to,
      title: s.title,
      agency: s.agency,
      jurisdiction: s.jurisdiction,
      sourceUrl: s.source_url,
      rulemakingUrl: s.rulemaking_url ?? null,
      guidanceUrl: s.guidance_url ?? null,
      lastVerifiedAt: s.last_verified_at ?? null,
      nextVerificationDueAt: s.next_verification_due_at ?? null,
      verificationStatus: s.verification_status,
    })),
  };
}

async function loadContext(sql: any, companyId: string) {
  const evReqs = await sql`SELECT * FROM compliance_program_evidence_requirements`;
  const evidence = await sql`SELECT * FROM compliance_program_evidence WHERE company_id = ${companyId}`;
  const links = await sql`
    SELECT l.program_key, l.source_key, l.citation, l.applies_to,
           s.id as source_id, s.title, s.agency, s.jurisdiction, s.source_url, s.rulemaking_url, s.guidance_url,
           s.last_verified_at, s.next_verification_due_at, s.verification_status
    FROM compliance_program_source_links l JOIN regulatory_sources s ON s.source_key = l.source_key`;
  return { evReqs, evidence, links };
}

function summarize(programs: { status: ComplianceProgramStatus }[]) {
  const by = (s: string) => programs.filter((p) => p.status === s).length;
  return {
    total: programs.length,
    current: by("current"),
    missing: by("missing"),
    incomplete: by("incomplete"),
    overdue: by("overdue"),
    reviewDue: by("review_due"),
    sourceReviewDue: by("source_review_due"),
    notApplicable: by("not_applicable"),
    // Back-compat key used by the Programs page metric cards.
    overdueReview: by("overdue"),
  };
}

// Persist the derived status snapshot so dashboard GROUP BY status stays useful.
async function persistStatus(sql: any, programId: string, status: string) {
  await sql`UPDATE compliance_programs SET status = ${status}, updated_at = NOW() WHERE id = ${programId}`;
}

const programSchema = z.object({
  programType: z.string().min(1).max(100),
  programName: z.string().min(1).max(255),
  isRequired: z.boolean().default(false),
  requiredBy: z.string().max(255).optional(),
  version: z.string().max(50).optional(),
  status: z.string().max(40).optional(),
  owner: z.string().max(255).optional(),
  notes: z.string().max(5000).optional(),
  lastReviewedAt: z.string().optional(),
  nextReviewDue: z.string().optional(),
});

// ─── List programs + summary (source-backed integrity) ───
programRoutes.get("/", requireCapability("viewCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const programs = await sql`SELECT * FROM compliance_programs WHERE company_id = ${user.companyId} ORDER BY is_required DESC, program_name`;
  const ctx = await loadContext(sql, user.companyId);
  const enriched = programs.map((p: any) => enrich(p, ctx.evReqs, ctx.evidence, ctx.links));
  return c.json({ programs: enriched, summary: summarize(enriched) });
});

// ─── Set up the required source-backed programs (idempotent) ───
async function setupRequired(c: any) {
  const user = c.get("user");
  const sql = db(c.env);
  await seedCatalog(sql);
  const [company] = await sql`SELECT allows_remote_work FROM companies WHERE id = ${user.companyId}`;
  const allowsRemote = company?.allows_remote_work;
  let created = 0;
  for (const def of REQUIRED_COMPLIANCE_PROGRAMS) {
    let applicable: boolean | null = true;
    if (def.programKey === "remote_work_policy") {
      applicable = allowsRemote === false ? false : allowsRemote === true ? true : null;
    }
    if (await ensureProgram(sql, user.companyId, def, applicable)) created++;
  }
  if (created > 0) await audit(c, user, { type: "program.created", entityId: user.companyId, action: "setup_required_programs", details: { created } });
  const programs = await sql`SELECT * FROM compliance_programs WHERE company_id = ${user.companyId} ORDER BY is_required DESC, program_name`;
  const ctx = await loadContext(sql, user.companyId);
  const enriched = programs.map((p: any) => enrich(p, ctx.evReqs, ctx.evidence, ctx.links));
  return c.json({ created, programs: enriched, summary: summarize(enriched) });
}

programRoutes.post("/setup-required", requireCapability("manageCompliancePrograms"), setupRequired);
// Back-compat alias used by the existing UI.
programRoutes.post("/bootstrap", requireCapability("manageCompliancePrograms"), setupRequired);

// ─── Set up optional recommended programs (idempotent) ───
programRoutes.post("/setup-recommended", requireCapability("manageCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  await seedCatalog(sql);
  let created = 0;
  for (const def of RECOMMENDED_COMPLIANCE_PROGRAMS) {
    if (await ensureProgram(sql, user.companyId, def, true)) created++;
  }
  if (created > 0) await audit(c, user, { type: "program.created", entityId: user.companyId, action: "setup_recommended_programs", details: { created } });
  const programs = await sql`SELECT * FROM compliance_programs WHERE company_id = ${user.companyId} ORDER BY is_required DESC, program_name`;
  const ctx = await loadContext(sql, user.companyId);
  const enriched = programs.map((p: any) => enrich(p, ctx.evReqs, ctx.evidence, ctx.links));
  return c.json({ created, programs: enriched, summary: summarize(enriched) });
});

// ─── Create an ad-hoc program ───
programRoutes.post("/", requireCapability("manageCompliancePrograms"), zValidator("json", programSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const sql = db(c.env);
  const [program] = await sql`
    INSERT INTO compliance_programs (company_id, program_type, program_name, is_required, required_by, version, status, owner, notes, last_reviewed_at, next_review_due)
    VALUES (${user.companyId}, ${body.programType}, ${body.programName}, ${body.isRequired}, ${body.requiredBy || null}, ${body.version || null}, ${body.status || "missing"}, ${body.owner || null}, ${body.notes || null}, ${body.lastReviewedAt || null}, ${body.nextReviewDue || null})
    RETURNING *`;
  await audit(c, user, { type: "program.created", entityId: program.id, action: "create_program", details: { programType: body.programType, programName: body.programName } });
  return c.json({ program }, 201);
});

programRoutes.put("/:id", requireCapability("manageCompliancePrograms"), zValidator("json", programSchema.partial()), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const sql = db(c.env);
  const [existing] = await sql`SELECT id, status FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!existing) return c.json({ error: "Program not found" }, 404);

  const [updated] = await sql`
    UPDATE compliance_programs SET
      program_name = COALESCE(${body.programName || null}, program_name),
      required_by = COALESCE(${body.requiredBy || null}, required_by),
      owner = COALESCE(${body.owner ?? null}, owner),
      notes = COALESCE(${body.notes ?? null}, notes),
      version = COALESCE(${body.version || null}, version),
      status = COALESCE(${body.status || null}, status),
      last_reviewed_at = COALESCE(${body.lastReviewedAt || null}, last_reviewed_at),
      next_review_due = COALESCE(${body.nextReviewDue || null}, next_review_due),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`;
  await audit(c, user, { type: "program.updated", entityId: id, action: "update_program", details: { fields: Object.keys(body) } });
  return c.json({ program: updated });
});

// ─── Detail: program + evidence checklist + regulatory basis + history ───
programRoutes.get("/:id", requireCapability("viewCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [program] = await sql`SELECT * FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!program) return c.json({ error: "Program not found" }, 404);
  const ctx = await loadContext(sql, user.companyId);
  const enriched = enrich(program, ctx.evReqs, ctx.evidence, ctx.links);
  const versions = await sql`SELECT id, version, file_name, file_size, mime_type, uploaded_by, is_current, created_at FROM compliance_program_versions WHERE program_id = ${id} ORDER BY created_at DESC`;
  const reviews = await sql`SELECT id, reviewed_by, reviewed_at, next_review_due, notes FROM compliance_program_reviews WHERE program_id = ${id} ORDER BY reviewed_at DESC`;
  return c.json({ program: enriched, versions, reviews });
});

// ─── Upload a new program document version (validated) ───
async function uploadDocument(c: any) {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [program] = await sql`SELECT id FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!program) return c.json({ error: "Program not found" }, 404);

  const formData = await c.req.formData();
  const file = formData.get("file") as unknown as File;
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) return c.json({ error: "file required" }, 400);
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    return c.json({ error: `File exceeds ${Math.floor(MAX_DOCUMENT_UPLOAD_BYTES / 1024 / 1024)}MB upload limit` }, 413);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectMimeType(bytes, file.type);
  if (!mime || !ALLOWED_DOCUMENT_MIME_TYPES.includes(mime)) {
    return c.json({ error: "Unsupported file type. Upload PDF, DOCX, PNG, JPG, or JPEG." }, 415);
  }

  const safeName = sanitizeFilename(file.name);
  const key = `programs/${sanitizePathSegment(user.companyId)}/${sanitizePathSegment(id)}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  await c.env.DOCUMENTS.put(key, bytes, { httpMetadata: { contentType: mime } });

  const [{ count }] = await sql`SELECT COUNT(*) as count FROM compliance_program_versions WHERE program_id = ${id}`;
  const versionLabel = `v${Number(count) + 1}`;
  await sql`UPDATE compliance_program_versions SET is_current = false WHERE program_id = ${id}`;
  const [version] = await sql`
    INSERT INTO compliance_program_versions (program_id, company_id, version, file_path, file_name, file_size, mime_type, uploaded_by, is_current)
    VALUES (${id}, ${user.companyId}, ${versionLabel}, ${key}, ${safeName}, ${file.size}, ${mime}, ${user.userId}, true)
    RETURNING *`;

  await sql`
    UPDATE compliance_programs SET file_path = ${key}, document_status = 'current', version = ${versionLabel}, status = 'current', last_reviewed_at = CURRENT_DATE, next_review_due = CURRENT_DATE + INTERVAL '1 year', updated_at = NOW()
    WHERE id = ${id}`;

  // Recompute integrity now that a document exists (may still be incomplete).
  const [fresh] = await sql`SELECT * FROM compliance_programs WHERE id = ${id}`;
  const ctx = await loadContext(sql, user.companyId);
  const enriched = enrich(fresh, ctx.evReqs, ctx.evidence, ctx.links);
  await persistStatus(sql, id, enriched.status);

  await audit(c, user, { type: "program.document_uploaded", entityId: id, action: "upload_program_document", details: { version: versionLabel, fileName: safeName, fileSize: file.size, mimeType: mime } });
  return c.json({ program: enriched, version, filePath: key }, 201);
}

programRoutes.post("/:id/upload", requireCapability("uploadProgramDocument"), uploadDocument);
programRoutes.post("/:id/documents", requireCapability("uploadProgramDocument"), uploadDocument);

// ─── Attach / mark evidence ───
const evidenceSchema = z.object({
  evidenceKey: z.string().min(1).max(120),
  status: z.enum(["uploaded", "accepted", "not_applicable"]).default("uploaded"),
  notes: z.string().max(2000).optional(),
});
programRoutes.post("/:id/evidence", requireCapability("uploadProgramDocument"), zValidator("json", evidenceSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const sql = db(c.env);
  const [program] = await sql`SELECT id FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!program) return c.json({ error: "Program not found" }, 404);

  await sql`
    INSERT INTO compliance_program_evidence (company_id, program_id, evidence_key, status, notes, attested_by)
    VALUES (${user.companyId}, ${id}, ${body.evidenceKey}, ${body.status}, ${body.notes || null}, ${user.userId})
    ON CONFLICT (program_id, evidence_key) DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes, attested_by = EXCLUDED.attested_by, updated_at = NOW()`;

  const [fresh] = await sql`SELECT * FROM compliance_programs WHERE id = ${id}`;
  const ctx = await loadContext(sql, user.companyId);
  const enriched = enrich(fresh, ctx.evReqs, ctx.evidence, ctx.links);
  await persistStatus(sql, id, enriched.status);
  await audit(c, user, { type: "program.evidence_updated", entityId: id, action: "update_program_evidence", details: { evidenceKey: body.evidenceKey, status: body.status } });
  return c.json({ program: enriched });
});

// ─── Record a program review ───
const reviewSchema = z.object({
  notes: z.string().max(2000).optional(),
  nextReviewDue: z.string().optional(),
});
programRoutes.post("/:id/reviews", requireCapability("reviewCompliancePrograms"), zValidator("json", reviewSchema), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const sql = db(c.env);
  const [program] = await sql`SELECT review_frequency_months FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!program) return c.json({ error: "Program not found" }, 404);

  const months = Number(program.review_frequency_months) || 12;
  const nextDue = body.nextReviewDue || null;
  await sql`
    INSERT INTO compliance_program_reviews (company_id, program_id, reviewed_by, next_review_due, notes)
    VALUES (${user.companyId}, ${id}, ${user.userId}, ${nextDue}, ${body.notes || null})`;
  await sql`
    UPDATE compliance_programs SET last_reviewed_at = CURRENT_DATE,
      next_review_due = COALESCE(${nextDue}, CURRENT_DATE + (${months} || ' months')::interval), updated_at = NOW()
    WHERE id = ${id}`;

  const [fresh] = await sql`SELECT * FROM compliance_programs WHERE id = ${id}`;
  const ctx = await loadContext(sql, user.companyId);
  const enriched = enrich(fresh, ctx.evReqs, ctx.evidence, ctx.links);
  await persistStatus(sql, id, enriched.status);
  await audit(c, user, { type: "program.reviewed", entityId: id, action: "review_program", details: { nextReviewDue: nextDue } });
  return c.json({ program: enriched });
});

// ─── Version history ───
programRoutes.get("/:id/versions", requireCapability("viewCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [program] = await sql`SELECT id FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!program) return c.json({ error: "Program not found" }, 404);
  const versions = await sql`
    SELECT id, version, file_name, file_size, mime_type, uploaded_by, is_current, created_at
    FROM compliance_program_versions WHERE program_id = ${id} ORDER BY created_at DESC`;
  return c.json({ versions });
});

// ─── Download the current program document ───
programRoutes.get("/:id/download", requireCapability("viewCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = db(c.env);
  const [program] = await sql`SELECT file_path, program_name FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!program || !program.file_path) return c.json({ error: "No document uploaded for this program" }, 404);
  const obj = await c.env.DOCUMENTS.get(program.file_path);
  if (!obj) return c.json({ error: "File not found in storage" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": (obj as any).httpMetadata?.contentType || "application/octet-stream", "Content-Disposition": `attachment; filename="${sanitizeFilename(program.program_name)}"` } });
});

// ─── Download a specific version (company-scoped) ───
programRoutes.get("/:id/versions/:versionId/download", requireCapability("viewCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const versionId = c.req.param("versionId");
  const sql = db(c.env);
  const [version] = await sql`SELECT file_path, file_name, mime_type FROM compliance_program_versions WHERE id = ${versionId} AND program_id = ${id} AND company_id = ${user.companyId}`;
  if (!version) return c.json({ error: "Version not found" }, 404);
  const obj = await c.env.DOCUMENTS.get(version.file_path);
  if (!obj) return c.json({ error: "File not found in storage" }, 404);
  return new Response(obj.body, { headers: { "Content-Type": version.mime_type || "application/octet-stream", "Content-Disposition": `attachment; filename="${sanitizeFilename(version.file_name || "program")}"` } });
});

// Re-export catalog for the dashboard / other callers.
export { getProgramDef };
