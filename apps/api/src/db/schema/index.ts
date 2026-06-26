// ─────────────────────────────────────────────────────
// MortgageGuard — Database Schema (Drizzle ORM)
// Maps 1:1 with the SDD Entity Relationship Diagram
// ─────────────────────────────────────────────────────
import {
  pgTable, uuid, varchar, text, boolean, decimal, integer,
  timestamp, date, pgEnum, index, uniqueIndex, jsonb
} from "drizzle-orm/pg-core";

// ─── ENUMS ───
export const entityTypeEnum = pgEnum("entity_type", ["broker", "lender", "servicer", "banker"]);
export const licenseStatusEnum = pgEnum("license_status", ["active", "inactive", "suspended", "expired", "pending"]);
export const loanStatusEnum = pgEnum("loan_status", ["application", "processing", "underwriting", "closing", "post_close", "denied", "withdrawn"]);
export const loanPurposeEnum = pgEnum("loan_purpose", ["purchase", "refinance", "construction", "home_equity", "home_equity_50a6", "home_improvement", "land_lot", "wrap_mortgage", "reverse_mortgage"]);
export const loanProductEnum = pgEnum("loan_product", ["conventional", "fha", "va", "usda", "reverse", "other"]);
export const loanTypeEnum = pgEnum("loan_type", ["fixed", "arm", "balloon", "interest_only", "other"]);
export const lienPositionEnum = pgEnum("lien_position", ["first", "second", "wrap"]);
export const occupancyTypeEnum = pgEnum("occupancy_type", ["primary", "secondary", "investment"]);
export const docStatusEnum = pgEnum("doc_status", ["pending", "uploaded", "signed", "delivered", "expired", "rejected"]);
export const checkResultEnum = pgEnum("check_result", ["pending", "pass", "fail", "na", "waived"]);
export const programStatusEnum = pgEnum("program_status", ["current", "overdue", "missing", "draft"]);
export const reportStatusEnum = pgEnum("report_status", ["upcoming", "in_progress", "filed", "overdue"]);
export const userRoleEnum = pgEnum("user_role", ["company_admin", "qualifying_individual", "loan_originator", "processor", "compliance_officer", "read_only"]);
export const ruleCategoryEnum = pgEnum("rule_category", ["disclosure", "documentation", "reporting", "program", "licensing"]);
export const ruleAppliesToEnum = pgEnum("rule_applies_to", ["broker", "lender", "both"]);

// ─── COMPANIES ───
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  nmlsId: varchar("nmls_id", { length: 20 }).notNull(),
  entityType: entityTypeEnum("entity_type").notNull(),
  primaryContact: varchar("primary_contact", { length: 255 }),
  primaryEmail: varchar("primary_email", { length: 255 }),
  primaryPhone: varchar("primary_phone", { length: 20 }),
  address: text("address"),
  isActive: boolean("is_active").default(true).notNull(),
  // Drives the conditional Remote Work Policy program requirement.
  allowsRemoteWork: boolean("allows_remote_work"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("companies_nmls_idx").on(t.nmlsId),
]);

// ─── LICENSES ───
export const licenses = pgTable("licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  stateCode: varchar("state_code", { length: 2 }).notNull(),
  licenseType: varchar("license_type", { length: 100 }).notNull(),
  nmlsId: varchar("nmls_id", { length: 20 }),
  status: licenseStatusEnum("status").default("active").notNull(),
  expirationDate: date("expiration_date"),
  issuedDate: date("issued_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("licenses_company_idx").on(t.companyId),
  index("licenses_state_idx").on(t.stateCode),
]);

// ─── USERS ───
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  nmlsId: varchar("nmls_id", { length: 20 }),
  role: userRoleEnum("role").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  mustChangePassword: boolean("must_change_password").default(false).notNull(),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
  index("users_company_idx").on(t.companyId),
]);

// ─── USER INVITATIONS ───
// Admin-issued invites; only the token hash is persisted.
export const userInvitations = pgTable("user_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  email: varchar("email", { length: 255 }).notNull(),
  role: userRoleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull(),
  invitedBy: uuid("invited_by").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("invitations_token_idx").on(t.tokenHash),
  index("invitations_company_idx").on(t.companyId),
  index("invitations_email_idx").on(t.email),
]);

// ─── LOANS ───
// Contains all 17 fields required by the TX-SML transaction log
export const loans = pgTable("loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  originatorId: uuid("originator_id").notNull().references(() => users.id),
  loanNumber: varchar("loan_number", { length: 50 }).notNull(),
  // Borrower info
  borrowerLastName: varchar("borrower_last_name", { length: 100 }).notNull(),
  borrowerFirstName: varchar("borrower_first_name", { length: 100 }).notNull(),
  // Property info
  propertyAddress: varchar("property_address", { length: 255 }).notNull(),
  propertyCity: varchar("property_city", { length: 100 }).notNull(),
  propertyState: varchar("property_state", { length: 2 }).notNull(),
  propertyZip: varchar("property_zip", { length: 10 }).notNull(),
  // Loan details (TX log fields)
  interestRate: decimal("interest_rate", { precision: 6, scale: 4 }),
  loanPurpose: loanPurposeEnum("loan_purpose").notNull(),
  loanProduct: loanProductEnum("loan_product").notNull(),
  loanType: loanTypeEnum("loan_type").notNull(),
  loanTerm: integer("loan_term"), // months
  loanAmount: decimal("loan_amount", { precision: 14, scale: 2 }),
  lienPosition: lienPositionEnum("lien_position").notNull(),
  occupancyType: occupancyTypeEnum("occupancy_type").notNull(),
  status: loanStatusEnum("status").default("application").notNull(),
  // Dates
  applicationDate: date("application_date").notNull(),
  closingDate: date("closing_date"),
  // Originator info (TX log fields)
  originatorNmlsId: varchar("originator_nmls_id", { length: 20 }),
  // Lender info (TX log fields)
  lenderName: varchar("lender_name", { length: 255 }),
  lenderNmlsId: varchar("lender_nmls_id", { length: 20 }),
  // Compliance
  complianceScore: integer("compliance_score").default(0),
  docsRequired: integer("docs_required").default(0),
  docsComplete: integer("docs_complete").default(0),
  // Loan creation portal (Prompt 21)
  applicantEmail: varchar("applicant_email", { length: 255 }),
  applicantPhone: varchar("applicant_phone", { length: 40 }),
  coBorrowerName: varchar("co_borrower_name", { length: 255 }),
  applicationMethod: varchar("application_method", { length: 40 }),
  propertyCounty: varchar("property_county", { length: 100 }),
  texasCashoutType: varchar("texas_cashout_type", { length: 20 }).default("none"),
  purchasePrice: decimal("purchase_price", { precision: 15, scale: 2 }),
  estimatedClosingDate: date("estimated_closing_date"),
  loanOriginatorName: varchar("loan_originator_name", { length: 255 }),
  processorUserId: uuid("processor_user_id").references(() => users.id),
  complianceOwnerUserId: uuid("compliance_owner_user_id").references(() => users.id),
  transactionLogEnteredAt: timestamp("transaction_log_entered_at"),
  transactionLogDueAt: timestamp("transaction_log_due_at"),
  transactionLogStatus: varchar("transaction_log_status", { length: 20 }),
  // Metadata
  isDeleted: boolean("is_deleted").default(false),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  txLogEntryDate: timestamp("tx_log_entry_date").defaultNow().notNull(), // 7-day rule tracking
}, (t) => [
  index("loans_company_idx").on(t.companyId),
  index("loans_state_idx").on(t.propertyState),
  index("loans_status_idx").on(t.status),
  index("loans_originator_idx").on(t.originatorId),
  uniqueIndex("loans_number_company_idx").on(t.loanNumber, t.companyId),
]);

// ─── LOAN TASKS (work queue) ───
export const loanTasks = pgTable("loan_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  title: text("title").notNull(),
  description: text("description"),
  taskType: text("task_type").notNull(),
  status: text("status").default("open").notNull(),
  priority: text("priority").default("normal").notNull(),
  autoKey: text("auto_key"),
  assignedTo: uuid("assigned_to").references(() => users.id),
  dueAt: timestamp("due_at"),
  completedAt: timestamp("completed_at"),
  completedBy: uuid("completed_by").references(() => users.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("loan_tasks_loan_idx").on(t.loanId),
  index("loan_tasks_company_idx").on(t.companyId),
]);

// ─── STATE RULES ───
// The core of the compliance engine — every state's requirements live here
export const stateRules = pgTable("state_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateCode: varchar("state_code", { length: 3 }).notNull(), // "TX", "CA", "FED" for federal
  ruleCategory: ruleCategoryEnum("rule_category").notNull(),
  ruleName: varchar("rule_name", { length: 255 }).notNull(),
  description: text("description"),
  appliesTo: ruleAppliesToEnum("applies_to").default("both").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  effectiveDate: date("effective_date").notNull(),
  version: integer("version").default(1).notNull(),
  sourceUrl: varchar("source_url", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("state_rules_state_idx").on(t.stateCode),
  index("state_rules_active_idx").on(t.stateCode, t.isActive),
]);

// ─── REQUIRED DOCUMENTS ───
// Documents mandated by each state rule, filterable by loan type and purpose
export const requiredDocuments = pgTable("required_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  stateRuleId: uuid("state_rule_id").notNull().references(() => stateRules.id),
  documentType: varchar("document_type", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  // Filters — null means "applies to all"
  loanTypeFilter: loanTypeEnum("loan_type_filter"),
  loanPurposeFilter: loanPurposeEnum("loan_purpose_filter"),
  loanProductFilter: loanProductEnum("loan_product_filter"),
  isMandatory: boolean("is_mandatory").default(true).notNull(),
  weight: integer("weight").default(1).notNull(), // 3=mandatory, 2=state-specific, 1=recommended
  pipelineStage: loanStatusEnum("pipeline_stage"), // which gate this doc is required for
  description: text("description"),
  sampleFormUrl: varchar("sample_form_url", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("req_docs_rule_idx").on(t.stateRuleId),
  index("req_docs_type_idx").on(t.documentType),
]);

// ─── LOAN DOCUMENTS ───
// Actual documents uploaded per loan, matched against required_documents
export const loanDocuments = pgTable("loan_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  documentType: varchar("document_type", { length: 255 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  filePath: varchar("file_path", { length: 500 }).notNull(), // R2 key
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  status: docStatusEnum("status").default("uploaded").notNull(),
  isSigned: boolean("is_signed").default(false),
  signedAt: timestamp("signed_at"),
  deliveredAt: timestamp("delivered_at"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  metadata: text("metadata"), // JSON string for OCR results, etc.
}, (t) => [
  index("loan_docs_loan_idx").on(t.loanId),
  index("loan_docs_type_idx").on(t.documentType),
]);

// ─── COMPLIANCE CHECKS ───
// Per-loan, per-rule validation results — the audit trail examiners review
export const complianceChecks = pgTable("compliance_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  stateRuleId: uuid("state_rule_id").notNull().references(() => stateRules.id),
  requiredDocumentId: uuid("required_document_id").references(() => requiredDocuments.id),
  checkType: varchar("check_type", { length: 50 }).notNull(), // "document_present", "signed", "delivered", "timely"
  result: checkResultEnum("result").default("pending").notNull(),
  notes: text("notes"),
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
  checkedBy: uuid("checked_by").references(() => users.id), // null = system auto-check
}, (t) => [
  index("checks_loan_idx").on(t.loanId),
  index("checks_result_idx").on(t.loanId, t.result),
]);

// ─── LOAN TIMELINE ───
// Immutable, append-only event log per loan
export const loanTimeline = pgTable("loan_timeline", {
  id: uuid("id").primaryKey().defaultRandom(),
  loanId: uuid("loan_id").notNull().references(() => loans.id),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  stageFrom: loanStatusEnum("stage_from"),
  stageTo: loanStatusEnum("stage_to"),
  description: text("description"),
  metadata: text("metadata"), // JSON string for additional context
  occurredAt: timestamp("occurred_at").defaultNow().notNull(),
  performedBy: uuid("performed_by").references(() => users.id),
}, (t) => [
  index("timeline_loan_idx").on(t.loanId),
  index("timeline_date_idx").on(t.occurredAt),
]);

// ─── COMPLIANCE PROGRAMS ───
// Company-level policies (AML, Red Flags, InfoSec, etc.)
export const compliancePrograms = pgTable("compliance_programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  programType: varchar("program_type", { length: 100 }).notNull(),
  programName: varchar("program_name", { length: 255 }).notNull(),
  // Stable catalog key (e.g. "aml_program") linking the row to the source-backed catalog.
  programKey: varchar("program_key", { length: 100 }),
  category: varchar("category", { length: 100 }),
  isRequired: boolean("is_required").default(false).notNull(),
  isConditionallyRequired: boolean("is_conditionally_required").default(false),
  // null = applicability unknown; true/false set explicitly (e.g. remote work).
  applicable: boolean("applicable"),
  archived: boolean("archived").default(false),
  requiredBy: varchar("required_by", { length: 255 }), // citation or "federal"/"state"
  requiredDocumentType: varchar("required_document_type", { length: 100 }),
  requiredDocumentName: varchar("required_document_name", { length: 255 }),
  reviewFrequencyMonths: integer("review_frequency_months").default(12),
  version: varchar("version", { length: 50 }),
  status: programStatusEnum("status").default("missing").notNull(),
  filePath: varchar("file_path", { length: 500 }), // R2 key
  documentStatus: varchar("document_status", { length: 50 }),
  owner: varchar("owner", { length: 255 }),
  notes: text("notes"),
  lastReviewedAt: date("last_reviewed_at"),
  nextReviewDue: date("next_review_due"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("programs_company_idx").on(t.companyId),
  uniqueIndex("programs_company_key_idx").on(t.companyId, t.programKey),
]);

// ─── REGULATORY SOURCE REGISTRY (global catalog) ───
export const regulatorySources = pgTable("regulatory_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().unique(),
  title: text("title").notNull(),
  citation: text("citation").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  agency: text("agency"),
  sourceType: text("source_type").notNull(),
  sourceUrl: text("source_url").notNull(),
  rulemakingCitation: text("rulemaking_citation"),
  rulemakingUrl: text("rulemaking_url"),
  guidanceUrl: text("guidance_url"),
  effectiveDate: date("effective_date"),
  lastVerifiedAt: timestamp("last_verified_at"),
  nextVerificationDueAt: timestamp("next_verification_due_at"),
  verificationStatus: text("verification_status").default("unverified").notNull(),
  sourceHash: text("source_hash"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── PROGRAM ⇄ SOURCE LINKS (global catalog) ───
export const complianceProgramSourceLinks = pgTable("compliance_program_source_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  programKey: text("program_key").notNull(),
  sourceKey: text("source_key").notNull().references(() => regulatorySources.sourceKey),
  citation: text("citation").notNull(),
  appliesTo: text("applies_to").default("program").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("program_source_link_idx").on(t.programKey, t.sourceKey),
]);

// ─── PROGRAM EVIDENCE REQUIREMENTS (global catalog) ───
export const complianceProgramEvidenceRequirements = pgTable("compliance_program_evidence_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  programKey: text("program_key").notNull(),
  evidenceKey: text("evidence_key").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  required: boolean("required").default(true).notNull(),
  sourceKey: text("source_key").references(() => regulatorySources.sourceKey),
  cadenceMonths: integer("cadence_months"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("program_evidence_req_idx").on(t.programKey, t.evidenceKey),
]);

// ─── PROGRAM EVIDENCE (company-uploaded/attested) ───
export const complianceProgramEvidence = pgTable("compliance_program_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  programId: uuid("program_id").notNull().references(() => compliancePrograms.id),
  evidenceKey: text("evidence_key").notNull(),
  status: text("status").default("uploaded").notNull(), // uploaded | accepted | not_applicable
  filePath: text("file_path"),
  fileName: varchar("file_name", { length: 255 }),
  notes: text("notes"),
  attestedBy: uuid("attested_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("program_evidence_idx").on(t.programId, t.evidenceKey),
]);

// ─── PROGRAM DOCUMENT REQUIREMENTS (global catalog) ───
export const complianceProgramDocumentRequirements = pgTable("compliance_program_document_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  programKey: text("program_key").notNull(),
  documentType: text("document_type").notNull(),
  displayName: text("display_name").notNull(),
  required: boolean("required").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("program_doc_req_idx").on(t.programKey, t.documentType),
]);

// ─── PROGRAM REVIEWS (review/attestation log) ───
export const complianceProgramReviews = pgTable("compliance_program_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  programId: uuid("program_id").notNull().references(() => compliancePrograms.id),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at").defaultNow(),
  nextReviewDue: date("next_review_due"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("program_reviews_program_idx").on(t.programId),
]);

// ─── COMPLIANCE PROGRAM VERSIONS (upload history) ───
export const complianceProgramVersions = pgTable("compliance_program_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  programId: uuid("program_id").notNull().references(() => compliancePrograms.id),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  version: varchar("version", { length: 50 }).notNull(),
  filePath: text("file_path").notNull(),
  fileName: varchar("file_name", { length: 255 }),
  fileSize: integer("file_size"),
  mimeType: varchar("mime_type", { length: 100 }),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  isCurrent: boolean("is_current").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("program_versions_program_idx").on(t.programId),
  index("program_versions_company_idx").on(t.companyId),
]);

// ─── VENDOR CONTRACTS ───
export const vendorContracts = pgTable("vendor_contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  vendorName: varchar("vendor_name", { length: 255 }).notNull(),
  serviceType: varchar("service_type", { length: 100 }).notNull(),
  contractFilePath: varchar("contract_file_path", { length: 500 }),
  startDate: date("start_date"),
  expirationDate: date("expiration_date"),
  status: varchar("status", { length: 50 }).default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("vendors_company_idx").on(t.companyId),
]);

// ─── REPORTING DEADLINES ───
export const reportingDeadlines = pgTable("reporting_deadlines", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  reportType: varchar("report_type", { length: 100 }).notNull(), // "RMLA", "SSSF", "financial_condition"
  stateCode: varchar("state_code", { length: 2 }),
  quarter: varchar("quarter", { length: 10 }), // "Q1-2026", "Annual-2025"
  dueDate: date("due_date").notNull(),
  status: reportStatusEnum("status").default("upcoming").notNull(),
  filedAt: timestamp("filed_at"),
  filedBy: uuid("filed_by").references(() => users.id),
  confirmationNumber: varchar("confirmation_number", { length: 100 }),
  evidenceFilePath: text("evidence_file_path"),
  // Obligation-based model (Prompt 13) — supersedes report_type/state_code/quarter.
  obligationKey: text("obligation_key"),
  jurisdiction: varchar("jurisdiction", { length: 3 }),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  receiptDocumentId: uuid("receipt_document_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("deadlines_company_idx").on(t.companyId),
  index("deadlines_due_idx").on(t.dueDate),
]);

// ─── REPORTING OBLIGATIONS (catalog of what must be filed, per jurisdiction) ───
export const reportingObligations = pgTable("reporting_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  obligationKey: text("obligation_key").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  frequency: text("frequency").notNull(),
  appliesToEntityTypes: text("applies_to_entity_types").array(),
  dueRule: text("due_rule").notNull(),
  sourceKey: text("source_key"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [uniqueIndex("obligations_key_jurisdiction_idx").on(t.obligationKey, t.jurisdiction)]);

// ─── REPORT EXPORTS (generated transaction-log/report file audit trail) ───
export const reportExports = pgTable("report_exports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  reportKey: text("report_key").notNull(),
  jurisdiction: text("jurisdiction").notNull(),
  format: text("format").notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  r2Key: text("r2_key"),
  generatedBy: uuid("generated_by").references(() => users.id),
  generatedAt: timestamp("generated_at").defaultNow(),
  rowCount: integer("row_count").default(0),
  warningCount: integer("warning_count").default(0),
  hash: text("hash"),
  metadata: jsonb("metadata"),
}, (t) => [index("report_exports_company_idx").on(t.companyId)]);

// ─── REPORT FILING EVENTS (immutable filing history against a deadline) ───
export const reportFilingEvents = pgTable("report_filing_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  reportingDeadlineId: uuid("reporting_deadline_id").notNull().references(() => reportingDeadlines.id),
  filedBy: uuid("filed_by").references(() => users.id),
  filedAt: timestamp("filed_at").defaultNow().notNull(),
  confirmationNumber: text("confirmation_number"),
  receiptDocumentId: uuid("receipt_document_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("filing_events_deadline_idx").on(t.reportingDeadlineId),
  index("filing_events_company_idx").on(t.companyId),
]);

// ─── INTEGRATIONS ───
export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  systemId: varchar("system_id", { length: 50 }).notNull(),
  systemName: varchar("system_name", { length: 100 }).notNull(),
  systemType: varchar("system_type", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).default("connected").notNull(),
  syncDirection: varchar("sync_direction", { length: 20 }),
  config: text("config"), // JSON sync options
  clientId: varchar("client_id", { length: 255 }),
  instanceUrl: text("instance_url"),
  clientSecretEnc: text("client_secret_enc"),
  apiKeyEnc: text("api_key_enc"),
  webhookEnabled: boolean("webhook_enabled").default(false).notNull(),
  webhookId: varchar("webhook_id", { length: 64 }),
  webhookSecretEnc: text("webhook_secret_enc"),
  lastSyncAt: timestamp("last_sync_at"),
  lastSuccessfulSyncAt: timestamp("last_successful_sync_at"),
  lastError: text("last_error"),
  connectedAt: timestamp("connected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("integrations_company_system_idx").on(t.companyId, t.systemId),
  uniqueIndex("integrations_webhook_idx").on(t.webhookId),
]);

// ─── INTEGRATION SYNC HISTORY ───
export const integrationSyncHistory = pgTable("integration_sync_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  integrationId: uuid("integration_id").references(() => integrations.id),
  systemId: varchar("system_id", { length: 50 }).notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  status: varchar("status", { length: 20 }).default("running").notNull(),
  recordsProcessed: integer("records_processed").default(0),
  errorMessage: text("error_message"),
}, (t) => [
  index("sync_history_company_idx").on(t.companyId),
  index("sync_history_system_idx").on(t.companyId, t.systemId),
]);
