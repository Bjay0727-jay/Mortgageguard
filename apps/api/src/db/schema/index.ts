// ─────────────────────────────────────────────────────
// MortgageGuard — Database Schema (Drizzle ORM)
// Maps 1:1 with the SDD Entity Relationship Diagram
// ─────────────────────────────────────────────────────
import {
  pgTable, uuid, varchar, text, boolean, decimal, integer,
  timestamp, date, pgEnum, index, uniqueIndex
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
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("users_email_idx").on(t.email),
  index("users_company_idx").on(t.companyId),
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
  isRequired: boolean("is_required").default(false).notNull(),
  requiredBy: varchar("required_by", { length: 50 }), // "federal", "state"
  version: varchar("version", { length: 50 }),
  status: programStatusEnum("status").default("missing").notNull(),
  filePath: varchar("file_path", { length: 500 }), // R2 key
  lastReviewedAt: date("last_reviewed_at"),
  nextReviewDue: date("next_review_due"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("programs_company_idx").on(t.companyId),
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
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("deadlines_company_idx").on(t.companyId),
  index("deadlines_due_idx").on(t.dueDate),
]);
