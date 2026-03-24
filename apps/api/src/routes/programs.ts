import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
export const programRoutes = new Hono<{ Bindings: Env }>();

const programSchema = z.object({
  programType: z.string().min(1), programName: z.string().min(1),
  isRequired: z.boolean().default(false), requiredBy: z.string().optional(),
  version: z.string().optional(), status: z.enum(["current","overdue","missing","draft"]).default("missing"),
});

programRoutes.get("/", async (c) => {
  const user = c.get("user");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const programs = await sql`SELECT * FROM compliance_programs WHERE company_id = ${user.companyId} ORDER BY is_required DESC, program_name`;
  const summary = { total: programs.length, current: programs.filter((p: any) => p.status === "current").length, overdue: programs.filter((p: any) => p.status === "overdue").length, missing: programs.filter((p: any) => p.status === "missing").length };
  return c.json({ programs, summary });
});

programRoutes.post("/", zValidator("json", programSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [program] = await sql`INSERT INTO compliance_programs (company_id, program_type, program_name, is_required, required_by, version, status) VALUES (${user.companyId}, ${body.programType}, ${body.programName}, ${body.isRequired}, ${body.requiredBy || null}, ${body.version || null}, ${body.status}) RETURNING *`;
  return c.json({ program }, 201);
});

programRoutes.put("/:id", zValidator("json", programSchema.partial()), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [existing] = await sql`SELECT id FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!existing) return c.json({ error: "Program not found" }, 404);
  const [updated] = await sql`UPDATE compliance_programs SET program_name = COALESCE(${body.programName || null}, program_name), status = COALESCE(${body.status || null}, status), version = COALESCE(${body.version || null}, version), last_reviewed_at = CASE WHEN ${body.status || null} = 'current' THEN CURRENT_DATE ELSE last_reviewed_at END, next_review_due = CASE WHEN ${body.status || null} = 'current' THEN CURRENT_DATE + INTERVAL '1 year' ELSE next_review_due END, updated_at = NOW() WHERE id = ${id} RETURNING *`;
  return c.json({ program: updated });
});

programRoutes.post("/:id/upload", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [program] = await sql`SELECT id FROM compliance_programs WHERE id = ${id} AND company_id = ${user.companyId}`;
  if (!program) return c.json({ error: "Program not found" }, 404);
  const formData = await c.req.formData();
  const file = formData.get("file") as unknown as File;
  if (!file) return c.json({ error: "file required" }, 400);
  const key = `${user.companyId}/programs/${id}/${Date.now()}-${file.name}`;
  await c.env.DOCUMENTS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  await sql`UPDATE compliance_programs SET file_path = ${key}, status = 'current', last_reviewed_at = CURRENT_DATE, next_review_due = CURRENT_DATE + INTERVAL '1 year', updated_at = NOW() WHERE id = ${id}`;
  return c.json({ success: true, filePath: key });
});
