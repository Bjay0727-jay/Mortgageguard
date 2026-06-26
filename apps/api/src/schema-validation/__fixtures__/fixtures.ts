// Fixtures for the schema-drift validator tests. Small, hand-written snippets
// that exercise each check in isolation.

export const VALID_DRIZZLE = `
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  allowsRemoteWork: boolean("allows_remote_work"),
});
export const loans = pgTable("loans", {
  id: uuid("id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  lenderName: varchar("lender_name", { length: 255 }),
  status: loanStatusEnum("status").notNull(),
}, (t) => [index("loans_company_idx").on(t.companyId)]);
`;

export const VALID_SETUP = `
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  allows_remote_work BOOLEAN
);
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  status VARCHAR(20) NOT NULL
);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS lender_name VARCHAR(255);
`;

// Missing the loans table entirely.
export const MISSING_TABLE_SETUP = `
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  allows_remote_work BOOLEAN
);
`;

// loans table present but lender_name column missing.
export const MISSING_COLUMN_SETUP = `
CREATE TABLE IF NOT EXISTS companies (id UUID PRIMARY KEY, name VARCHAR(255), allows_remote_work BOOLEAN);
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY,
  company_id UUID NOT NULL,
  status VARCHAR(20) NOT NULL
);
`;

// Non-idempotent variants.
export const NON_IDEMPOTENT_CREATE = `CREATE TABLE loans (id UUID PRIMARY KEY);`;
export const NON_IDEMPOTENT_ALTER = `ALTER TABLE loans ADD COLUMN lender_name VARCHAR(255);`;
export const NON_IDEMPOTENT_INDEX = `CREATE UNIQUE INDEX idx_x ON loans(loan_number);`;
export const NON_IDEMPOTENT_INSERT = `INSERT INTO reporting_obligations (obligation_key) VALUES ('rmla');`;
export const IDEMPOTENT_INSERT = `INSERT INTO reporting_obligations (obligation_key) VALUES ('rmla') ON CONFLICT DO NOTHING;`;

// All 8 required index/constraint patterns, for the happy path.
export const REQUIRED_INDEXES_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_tasks_auto ON loan_tasks(loan_id, auto_key) WHERE auto_key IS NOT NULL;
source_key TEXT NOT NULL UNIQUE,
UNIQUE(program_key, source_key)
UNIQUE(program_key, evidence_key)
CREATE UNIQUE INDEX IF NOT EXISTS uq ON reporting_deadlines(company_id, obligation_key, jurisdiction, period_start, period_end) WHERE obligation_key IS NOT NULL;
UNIQUE(obligation_key, jurisdiction)
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_outbox_idempotency_key ON event_outbox(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_event_outbox_status_next_attempt ON event_outbox(status, next_attempt_at);
`;

export const CAPABILITIES_SRC = `
export const CAPABILITIES = [
  "viewLoans",
  "manageLoanNotes",
  "viewOutbox",
] as const;
`;

export const COMPLIANCE_CATALOG = `
aml_program red_flags_program information_security_program lo_lender_compensation_agreements remote_work_policy
aml_program_31_cfr_1029_210 aml_sar_31_cfr_1029_320 red_flags_16_cfr_681_1 safeguards_16_cfr_part_314
safeguards_16_cfr_314_4 lo_comp_12_cfr_1026_36 lo_recordkeeping_12_cfr_1026_25_c_2 remote_work_state_specific
"Loan Originator and Lender Compensation Agreements"
`;
export const REPORTING_CATALOG = `rmla sssf financial_condition`;
export const PACKETS_CATALOG = `loan_evidence_packet program_evidence_packet reporting_evidence_packet examination_readiness_packet`;
export const OUTBOX_CATALOG = `"pending" | "processing" | "processed" | "failed" | "dead_letter"`;

export const PBKDF2_OK = `const PBKDF2_ITERATIONS = 100000;`;
export const PBKDF2_TOO_HIGH = `const PBKDF2_ITERATIONS = 600000;`;
