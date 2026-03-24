// ─────────────────────────────────────────────────────
// MortgageGuard — Shared Types & Constants
// Used by both @mortgageguard/api and @mortgageguard/web
// ─────────────────────────────────────────────────────

// ─── Loan Pipeline Stages ───
export const PIPELINE_STAGES = [
  "application",
  "processing",
  "underwriting",
  "closing",
  "post_close",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// ─── Loan Purpose ───
export const LOAN_PURPOSES = [
  "purchase",
  "refinance",
  "construction",
  "home_equity",
  "home_equity_50a6",
  "home_improvement",
  "land_lot",
  "wrap_mortgage",
  "reverse_mortgage",
] as const;
export type LoanPurpose = (typeof LOAN_PURPOSES)[number];

// ─── Loan Product ───
export const LOAN_PRODUCTS = [
  "conventional",
  "fha",
  "va",
  "usda",
  "reverse",
  "other",
] as const;
export type LoanProduct = (typeof LOAN_PRODUCTS)[number];

// ─── Loan Type ───
export const LOAN_TYPES = ["fixed", "arm", "balloon", "interest_only", "other"] as const;
export type LoanType = (typeof LOAN_TYPES)[number];

// ─── User Roles ───
export const USER_ROLES = [
  "company_admin",
  "qualifying_individual",
  "loan_originator",
  "processor",
  "compliance_officer",
  "read_only",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

// ─── Compliance Score Thresholds ───
export const SCORE_THRESHOLDS = {
  passing: 80,
  warning: 50,
  critical: 0,
} as const;

export function getScoreStatus(score: number): "passing" | "warning" | "critical" {
  if (score >= SCORE_THRESHOLDS.passing) return "passing";
  if (score >= SCORE_THRESHOLDS.warning) return "warning";
  return "critical";
}

// ─── Compliance Score Weights ───
export const DOC_WEIGHTS = {
  mandatory: 3,
  state_specific: 2,
  recommended: 1,
} as const;

// ─── TX-SML Transaction Log Fields ───
export const TX_LOG_FIELDS = [
  "loan_number",
  "borrower_name",
  "application_date",
  "property_address",
  "interest_rate",
  "loan_purpose",
  "loan_product",
  "loan_type",
  "loan_term",
  "lien_position",
  "occupancy_type",
  "status",
  "closing_date",
  "originator_name",
  "originator_nmls_id",
  "lender_name",
  "lender_nmls_id",
] as const;

// ─── Quarterly Reporting Deadlines ───
export const QUARTERLY_DEADLINES = {
  Q1: { period: "Jan 1 - Mar 31", due: "May 15" },
  Q2: { period: "Apr 1 - Jun 30", due: "Aug 14" },
  Q3: { period: "Jul 1 - Sep 30", due: "Nov 14" },
  Q4: { period: "Oct 1 - Dec 31", due: "Feb 14" },
} as const;

// ─── Required Compliance Programs ───
export const REQUIRED_PROGRAMS = [
  { name: "Anti-Money Laundering Program", requiredBy: "federal" },
  { name: "Identity Theft Prevention (Red Flags)", requiredBy: "federal" },
  { name: "Information Security Program", requiredBy: "federal" },
  { name: "Loan Originator & Lender Compensation Agreements", requiredBy: "federal" },
  { name: "Remote Work Policy", requiredBy: "state" },
] as const;

// ─── Design Tokens ───
export const BRAND = {
  royal: "#1B3A6B",
  royalLight: "#2B5298",
  royalPale: "#E8EEF7",
  green: "#0F7B46",
  greenLight: "#15A35E",
  greenPale: "#E6F5EE",
  white: "#FFFFFF",
} as const;
