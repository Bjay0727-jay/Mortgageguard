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
import { REQUIRED_PROGRAMS } from "../lib/programs";

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

const programSchema = z.object({
  programType: z.string().min(1).max(100),
  programName: z.string().min(1).max(255),
  isRequired: z.boolean().default(false),
  requiredBy: z.string().max(50).optional(),
  version: z.string().max(50).optional(),
  status: z.enum(["current", "overdue", "missing", "draft"]).default("missing"),
  owner: z.string().max(255).optional(),
  notes: z.string().max(5000).optional(),
  lastReviewedAt: z.string().optional(),
  nextReviewDue: z.string().optional(),
});

// ─── List programs + summary (counts + overdue-review detection) ───
programRoutes.get("/", requireCapability("viewCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  const programs = await sql`SELECT * FROM compliance_programs WHERE company_id = ${user.companyId} ORDER BY is_required DESC, program_name`;
  const today = new Date().toISOString().slice(0, 10);
  const overdueReview = programs.filter((p: any) => p.next_review_due && String(p.next_review_due).slice(0, 10) < today && p.status !== "missing").length;
  const summary = {
    total: programs.length,
    current: programs.filter((p: any) => p.status === "current").length,
    overdue: programs.filter((p: any) => p.status === "overdue").length,
    missing: programs.filter((p: any) => p.status === "missing").length,
    overdueReview,
  };
  return c.json({ programs, summary });
});

// ─── Bootstrap the required program set (idempotent) ───
programRoutes.post("/bootstrap", requireCapability("manageCompliancePrograms"), async (c) => {
  const user = c.get("user");
  const sql = db(c.env);
  let created = 0;
  for (const p of REQUIRED_PROGRAMS) {
    const inserted = await sql`
      INSERT INTO compliance_programs (company_id, program_type, program_name, is_required, required_by, status)
      SELECT ${user.companyId}, ${p.programType}, ${p.programName}, true, ${p.requiredBy}, 'missing'
      WHERE NOT EXISTS (SELECT 1 FROM compliance_programs WHERE company_id = ${user.companyId} AND program_type = ${p.programType})
      RETURNING id`;
    if (inserted.length) created++;
  }
  if (created > 0) await audit(c, user, { type: "program.created", entityId: user.companyId, action: "bootstrap_required_programs", details: { created } });
  const programs = await sql`SELECT * FROM compliance_programs WHERE company_id = ${user.companyId} ORDER BY is_required DESC, program_name`;
  return c.json({ created, programs });
});

programRoutes.post("/", requireCapability("manageCompliancePrograms"), zValidator("json", programSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const sql = db(c.env);
  const [program] = await sql`
    INSERT INTO compliance_programs (company_id, program_type, program_name, is_required, required_by, version, status, owner, notes, last_reviewed_at, next_review_due)
    VALUES (${user.companyId}, ${body.programType}, ${body.programName}, ${body.isRequired}, ${body.requiredBy || null}, ${body.version || null}, ${body.status}, ${body.owner || null}, ${body.notes || null}, ${body.lastReviewedAt || null}, ${body.nextReviewDue || null})
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
      program_type = COALESCE(${body.programType || null}, program_type),
      program_name = COALESCE(${body.programName || null}, program_name),
      required_by = COALESCE(${body.requiredBy || null}, required_by),
      owner = COALESCE(${body.owner ?? null}, owner),
      notes = COALESCE(${body.notes ?? null}, notes),
      version = COALESCE(${body.version || null}, version),
      status = COALESCE(${body.status || null}, status),
      last_reviewed_at = COALESCE(${body.lastReviewedAt || null}, CASE WHEN ${body.status || null} = 'current' THEN CURRENT_DATE ELSE last_reviewed_at END),
      next_review_due = COALESCE(${body.nextReviewDue || null}, CASE WHEN ${body.status || null} = 'current' THEN CURRENT_DATE + INTERVAL '1 year' ELSE next_review_due END),
      updated_at = NOW()
    WHERE id = ${id} RETURNING *`;

  await audit(c, user, { type: "program.updated", entityId: id, action: "update_program", details: { fields: Object.keys(body) } });
  if (body.status && body.status !== existing.status) {
    await audit(c, user, { type: "program.status_changed", entityId: id, action: "program_status_changed", details: { from: existing.status, to: body.status } });
  }
  return c.json({ program: updated });
});

// ─── Upload a new program document version (validated) ───
programRoutes.post("/:id/upload", requireCapability("uploadProgramDocument"), async (c) => {
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

  // Version history: prior versions are retained but marked non-current.
  const [{ count }] = await sql`SELECT COUNT(*) as count FROM compliance_program_versions WHERE program_id = ${id}`;
  const versionLabel = `v${Number(count) + 1}`;
  await sql`UPDATE compliance_program_versions SET is_current = false WHERE program_id = ${id}`;
  const [version] = await sql`
    INSERT INTO compliance_program_versions (program_id, company_id, version, file_path, file_name, file_size, mime_type, uploaded_by, is_current)
    VALUES (${id}, ${user.companyId}, ${versionLabel}, ${key}, ${safeName}, ${file.size}, ${mime}, ${user.userId}, true)
    RETURNING *`;

  const [updated] = await sql`
    UPDATE compliance_programs SET file_path = ${key}, version = ${versionLabel}, status = 'current', last_reviewed_at = CURRENT_DATE, next_review_due = CURRENT_DATE + INTERVAL '1 year', updated_at = NOW()
    WHERE id = ${id} RETURNING *`;

  await audit(c, user, { type: "program.document_uploaded", entityId: id, action: "upload_program_document", details: { version: versionLabel, fileName: safeName, fileSize: file.size, mimeType: mime } });
  return c.json({ program: updated, version, filePath: key }, 201);
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
