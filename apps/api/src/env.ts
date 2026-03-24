// ─────────────────────────────────────────────────────
// MortgageGuard — Cloudflare Worker Environment Types
// ─────────────────────────────────────────────────────

export interface Env {
  // Hyperdrive (Neon PostgreSQL)
  HYPERDRIVE: Hyperdrive;

  // R2 Object Storage
  DOCUMENTS: R2Bucket;
  EXPORTS: R2Bucket;

  // KV Namespaces
  RULE_CACHE: KVNamespace;
  SESSIONS: KVNamespace;

  // Queues
  COMPLIANCE_QUEUE: Queue<ComplianceEvent>;
  AUDIT_QUEUE: Queue<AuditEvent>;

  // Environment variables
  ENVIRONMENT: string;
  APP_NAME: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
}

// ─── Queue Event Types ───
export interface ComplianceEvent {
  type: "loan.created" | "document.uploaded" | "stage.changed" | "score.recalculate" | "integration.webhook";
  loanId: string;
  companyId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface AuditEvent {
  type: string;
  entityType: "loan" | "document" | "program" | "user" | "company";
  entityId: string;
  companyId: string;
  userId: string | null;
  action: string;
  details: Record<string, unknown>;
  ipAddress: string;
  timestamp: string;
}
