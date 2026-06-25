import { Hono } from "hono";
import postgres from "postgres";
import type { Env } from "../env";
import { requireCapability } from "../middleware/auth";
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  buildDocumentKey,
  detectMimeType,
  MAX_DOCUMENT_UPLOAD_BYTES,
  sanitizeFilename,
} from "../lib/documents";

export const documentRoutes = new Hono<{ Bindings: Env }>();

function auditBase(c: any, user: any, loanId: string) {
  return {
    entityType: "loan" as const,
    entityId: loanId,
    companyId: user.companyId,
    userId: user.userId,
    ipAddress: c.req.header("cf-connecting-ip") || "unknown",
    timestamp: new Date().toISOString(),
  };
}

documentRoutes.post("/upload/:loanId", requireCapability("uploadLoanDocument"), async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`SELECT id FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  const formData = await c.req.formData();
  const file = formData.get("file") as unknown as File;
  const documentType = formData.get("documentType") as unknown as string;
  if (!file || !documentType) return c.json({ error: "file and documentType required" }, 400);
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    return c.json({ error: `File exceeds ${Math.floor(MAX_DOCUMENT_UPLOAD_BYTES / 1024 / 1024)}MB upload limit` }, 413);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const detectedMimeType = detectMimeType(bytes, file.type);
  if (!detectedMimeType || !ALLOWED_DOCUMENT_MIME_TYPES.includes(detectedMimeType)) {
    return c.json({ error: "Unsupported file type. Upload PDF, DOCX, PNG, JPG, or JPEG." }, 415);
  }

  const safeFileName = sanitizeFilename(file.name);
  const [existing] = await sql`
    SELECT id, file_path FROM loan_documents
    WHERE loan_id = ${loanId} AND document_type = ${documentType}
    ORDER BY uploaded_at DESC
    LIMIT 1`;

  const key = buildDocumentKey({
    companyId: user.companyId,
    loanId,
    documentType,
    filename: safeFileName,
    mimeType: detectedMimeType,
  });
  await c.env.DOCUMENTS.put(key, bytes, { httpMetadata: { contentType: detectedMimeType } });

  const [doc] = await sql`
    INSERT INTO loan_documents (loan_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
    VALUES (${loanId}, ${documentType}, ${safeFileName}, ${key}, ${file.size}, ${detectedMimeType}, ${user.userId})
    RETURNING *`;

  const auditType = existing ? "document.replaced" : "document.uploaded";
  await c.env.COMPLIANCE_QUEUE.send({ type: auditType, loanId, companyId: user.companyId, payload: { documentType, documentId: doc.id, replacedDocumentId: existing?.id || null }, timestamp: new Date().toISOString() });
  await c.env.AUDIT_QUEUE.send({
    type: auditType,
    ...auditBase(c, user, loanId),
    action: existing ? "replace_document" : "upload_document",
    details: { documentType, documentId: doc.id, replacedDocumentId: existing?.id || null, fileName: safeFileName, fileSize: file.size, mimeType: detectedMimeType },
  });

  return c.json({ document: doc, replacedDocumentId: existing?.id || null }, existing ? 200 : 201);
});

documentRoutes.get("/:loanId", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const [loan] = await sql`SELECT id FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  const docs = await sql`
    SELECT * FROM loan_documents
    WHERE loan_id = ${loanId}
    ORDER BY uploaded_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const [{ total }] = await sql`SELECT COUNT(*) as total FROM loan_documents WHERE loan_id = ${loanId}`;

  return c.json({ documents: docs, pagination: { total: Number(total), limit, offset } });
});

documentRoutes.get("/:loanId/:docId/download", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const docId = c.req.param("docId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [doc] = await sql`SELECT ld.* FROM loan_documents ld JOIN loans l ON l.id = ld.loan_id WHERE ld.id = ${docId} AND ld.loan_id = ${loanId} AND l.company_id = ${user.companyId}`;
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const obj = await c.env.DOCUMENTS.get(doc.file_path);
  if (!obj) return c.json({ error: "File not found in storage" }, 404);

  await c.env.AUDIT_QUEUE.send({
    type: "document.downloaded",
    ...auditBase(c, user, loanId),
    action: "download_document",
    details: { documentId: doc.id, documentType: doc.document_type, fileName: doc.file_name },
  });

  return new Response(obj.body, { headers: { "Content-Type": doc.mime_type || "application/octet-stream", "Content-Disposition": `attachment; filename="${sanitizeFilename(doc.file_name)}"` } });
});

documentRoutes.delete("/:loanId/:docId", requireCapability("deleteLoanDocument"), async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const docId = c.req.param("docId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [doc] = await sql`SELECT ld.* FROM loan_documents ld JOIN loans l ON l.id = ld.loan_id WHERE ld.id = ${docId} AND ld.loan_id = ${loanId} AND l.company_id = ${user.companyId}`;
  if (!doc) return c.json({ error: "Document not found" }, 404);
  await c.env.DOCUMENTS.delete(doc.file_path);
  await sql`DELETE FROM loan_documents WHERE id = ${docId}`;
  await c.env.AUDIT_QUEUE.send({
    type: "document.deleted",
    ...auditBase(c, user, loanId),
    action: "delete_document",
    details: { documentId: doc.id, documentType: doc.document_type, fileName: doc.file_name },
  });
  return c.json({ success: true });
});
