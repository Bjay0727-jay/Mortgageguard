// ─────────────────────────────────────────────────────
// MortgageGuard — Audit Trail Service
// Immutable, append-only event logging for examiner review
// ─────────────────────────────────────────────────────
import postgres from "postgres";
import type { Env, AuditEvent } from "../env";

export async function processAuditEvent(event: AuditEvent, env: Env): Promise<void> {
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  // Insert into loan_timeline if entity is a loan
  if (event.entityType === "loan") {
    await sql`
      INSERT INTO loan_timeline (loan_id, event_type, description, metadata, performed_by)
      VALUES (
        ${event.entityId},
        ${event.type},
        ${event.action},
        ${JSON.stringify({ ...event.details, ipAddress: event.ipAddress })},
        ${event.userId}
      )
    `;
  }

  // Always log to a general audit table (future: Elasticsearch)
  // For now, we append to a lightweight audit log
  console.log(`[AUDIT] ${event.timestamp} | ${event.type} | ${event.entityType}:${event.entityId} | user:${event.userId} | ${event.action}`);
}
