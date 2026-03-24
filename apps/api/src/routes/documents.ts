import { Hono } from "hono";
import postgres from "postgres";
import type { Env } from "../env";
export const documentRoutes = new Hono<{ Bindings: Env }>();

documentRoutes.post("/upload/:loanId", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`SELECT id FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  const documentType = formData.get("documentType") as string;
  if (!file || !documentType) return c.json({ error: "file and documentType required" }, 400);

  const key = `${user.companyId}/${loanId}/${documentType}/${Date.now()}-${file.name}`;
  await c.env.DOCUMENTS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });

  const [doc] = await sql`
    INSERT INTO loan_documents (loan_id, document_type, file_name, file_path, file_size, mime_type, uploaded_by)
    VALUES (${loanId}, ${documentType}, ${file.name}, ${key}, ${file.size}, ${file.type}, ${user.userId})
    RETURNING *`;

  await c.env.COMPLIANCE_QUEUE.send({ type: "document.uploaded", loanId, companyId: user.companyId, payload: { documentType, documentId: doc.id }, timestamp: new Date().toISOString() });
  await c.env.AUDIT_QUEUE.send({ type: "document.uploaded", entityType: "loan", entityId: loanId, companyId: user.companyId, userId: user.userId, action: "upload_document", details: { documentType, fileName: file.name }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });

  return c.json({ document: doc }, 201);
});

documentRoutes.get("/:loanId", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("loanId");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  // Verify loan belongs to user's company
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
  const docId = c.req.param("docId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [doc] = await sql`SELECT ld.* FROM loan_documents ld JOIN loans l ON l.id = ld.loan_id WHERE ld.id = ${docId} AND l.company_id = ${user.companyId}`;
  if (!doc) return c.json({ error: "Document not found" }, 404);

  const obj = await c.env.DOCUMENTS.get(doc.file_path);
  if (!obj) return c.json({ error: "File not found in storage" }, 404);

  return new Response(obj.body, { headers: { "Content-Type": doc.mime_type || "application/octet-stream", "Content-Disposition": `attachment; filename="${doc.file_name}"` } });
});

documentRoutes.delete("/:loanId/:docId", async (c) => {
  const user = c.get("user");
  const docId = c.req.param("docId");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [doc] = await sql`SELECT ld.* FROM loan_documents ld JOIN loans l ON l.id = ld.loan_id WHERE ld.id = ${docId} AND l.company_id = ${user.companyId}`;
  if (!doc) return c.json({ error: "Document not found" }, 404);
  await c.env.DOCUMENTS.delete(doc.file_path);
  await sql`DELETE FROM loan_documents WHERE id = ${docId}`;
  return c.json({ success: true });
});
