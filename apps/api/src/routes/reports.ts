import { Hono } from "hono";
import postgres from "postgres";
import type { Env } from "../env";
export const reportRoutes = new Hono<{ Bindings: Env }>();

reportRoutes.get("/transaction-log", async (c) => {
  const user = c.get("user");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const format = c.req.query("format") || "json";
  const loans = await sql`
    SELECT l.loan_number, l.borrower_last_name || ', ' || l.borrower_first_name as borrower, l.application_date, l.property_address || ', ' || l.property_city || ', ' || l.property_state || ' ' || l.property_zip as property, l.interest_rate, l.loan_purpose, l.loan_product, l.loan_type, l.loan_term, l.lien_position, l.occupancy_type, l.status, l.closing_date, u.name as originator, l.originator_nmls_id, l.lender_name, l.lender_nmls_id, l.tx_log_entry_date
    FROM loans l LEFT JOIN users u ON u.id = l.originator_id
    WHERE l.company_id = ${user.companyId} AND l.is_deleted = false ORDER BY l.application_date DESC`;
  if (format === "csv") {
    const headers = "Loan #,Borrower,App Date,Property,Rate,Purpose,Product,Type,Term,Lien,Occupancy,Status,Close Date,Originator,NMLS,Lender,Lender NMLS\n";
    const rows = loans.map((l: any) => `"${l.loan_number}","${l.borrower}","${l.application_date}","${l.property}",${l.interest_rate || ""},"${l.loan_purpose}","${l.loan_product}","${l.loan_type}",${l.loan_term || ""},"${l.lien_position}","${l.occupancy_type}","${l.status}","${l.closing_date || ""}","${l.originator}","${l.originator_nmls_id || ""}","${l.lender_name || ""}","${l.lender_nmls_id || ""}"`).join("\n");
    return new Response(headers + rows, { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="tx_transaction_log.csv"' } });
  }
  return c.json({ transactionLog: loans, count: loans.length });
});

reportRoutes.get("/rmla/:quarter", async (c) => {
  const user = c.get("user");
  const quarter = c.req.param("quarter");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  // Parse quarter like "Q1-2026" into date range
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

reportRoutes.get("/deadlines", async (c) => {
  const user = c.get("user");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const deadlines = await sql`SELECT * FROM reporting_deadlines WHERE company_id = ${user.companyId} ORDER BY due_date`;
  return c.json({ deadlines });
});

reportRoutes.put("/deadlines/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const { status, notes } = await c.req.json();
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [updated] = await sql`UPDATE reporting_deadlines SET status = COALESCE(${status || null}, status), notes = COALESCE(${notes || null}, notes), filed_at = CASE WHEN ${status} = 'filed' THEN NOW() ELSE filed_at END WHERE id = ${id} AND company_id = ${user.companyId} RETURNING *`;
  if (!updated) return c.json({ error: "Deadline not found" }, 404);
  return c.json({ deadline: updated });
});
