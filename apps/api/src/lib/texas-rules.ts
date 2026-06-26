// ─────────────────────────────────────────────────────────────
// MortgageGuard — Texas (+ federal) compliance rule set
//
// TS mirror of db/seeds/texas-rules.sql so the setup "Load Texas rules" action
// can verify/load rules idempotently from the running app (the SQL seed is only
// run by the seed script, not by CI's db-setup.sql). Loaders insert with
// NOT EXISTS guards — re-running never duplicates rows.
// ─────────────────────────────────────────────────────────────

export interface StateRuleDef {
  stateCode: string;
  ruleCategory: string;
  ruleName: string;
  description: string;
  appliesTo: string;
  effectiveDate: string;
}

export interface RequiredDocumentDef {
  ruleName: string;
  stateCode: string;
  documentType: string;
  displayName: string;
  isMandatory: boolean;
  weight: number;
  pipelineStage: string;
  description?: string;
  loanPurposeFilter?: string;
}

export const TEXAS_STATE_RULES: readonly StateRuleDef[] = [
  // Federal (apply to all states)
  { stateCode: "FED", ruleCategory: "documentation", ruleName: "TRID - Initial Disclosures", description: "Truth-in-Lending/RESPA Integrated Disclosure requirements", appliesTo: "both", effectiveDate: "2015-10-03" },
  { stateCode: "FED", ruleCategory: "documentation", ruleName: "TRID - Closing Disclosures", description: "Final closing disclosure requirements", appliesTo: "both", effectiveDate: "2015-10-03" },
  { stateCode: "FED", ruleCategory: "documentation", ruleName: "Ability-to-Repay", description: "ATR documentation and qualification requirements", appliesTo: "both", effectiveDate: "2014-01-10" },
  { stateCode: "FED", ruleCategory: "documentation", ruleName: "ECOA Credit Disclosures", description: "Equal Credit Opportunity Act disclosure requirements", appliesTo: "both", effectiveDate: "1974-10-28" },
  { stateCode: "FED", ruleCategory: "documentation", ruleName: "RESPA Disclosures", description: "Settlement procedures and provider list requirements", appliesTo: "both", effectiveDate: "1975-06-20" },
  { stateCode: "FED", ruleCategory: "program", ruleName: "Anti-Money Laundering", description: "BSA/AML compliance program required by federal law", appliesTo: "both", effectiveDate: "2002-10-26" },
  { stateCode: "FED", ruleCategory: "program", ruleName: "Identity Theft Prevention", description: "Red Flags Rule - identity theft prevention program", appliesTo: "both", effectiveDate: "2008-11-01" },
  { stateCode: "FED", ruleCategory: "program", ruleName: "Information Security", description: "Gramm-Leach-Bliley Act information security program", appliesTo: "both", effectiveDate: "2003-05-23" },
  { stateCode: "FED", ruleCategory: "program", ruleName: "Compensation Agreements", description: "Loan originator and lender compensation agreements", appliesTo: "both", effectiveDate: "2011-04-06" },
  // Texas
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Mortgage Company Disclosure", description: "Required for mortgage company licensees - signed/dated by applicant(s)", appliesTo: "broker", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Mortgage Banker Disclosure", description: "Required for mortgage banker registrants - signed/dated by applicant(s)", appliesTo: "lender", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Notice of Penalties", description: "Notice of penalties for making false or misleading statements - signed at closing", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Home Equity Disclosure 50(a)(6)", description: "Required for Texas cash-out home equity loans under Section 50(a)(6)", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Acknowledgement Fair Market Value", description: "Required for 50(a)(6) home equity loans", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Discount Point Acknowledgement", description: "Required for 50(a)(6) to demonstrate bona fide discount points", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Refinance Home Equity Notice 50(f)(2)", description: "Notice concerning refinance of existing home equity loan to non-home equity", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Wrap Mortgage Disclosure", description: "Required for wrap mortgage loans", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "disclosure", ruleName: "TX Prop Code 5.016 Notice", description: "Notice to pre-existing lienholder for wrap mortgages", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "documentation", ruleName: "TX Transaction Log", description: "Mortgage transaction log maintained within 7 days with all required fields", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "documentation", ruleName: "TX Loan File Completeness", description: "Complete loan files with all applicable documents", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "program", ruleName: "TX Remote Work Policy", description: "Required by state law if company allows remote work", appliesTo: "both", effectiveDate: "2023-01-01" },
  { stateCode: "TX", ruleCategory: "reporting", ruleName: "TX RMLA Quarterly", description: "Residential Mortgage Loan Activity report - due within 45 days of quarter end", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "reporting", ruleName: "TX SSSF Quarterly", description: "State-Specific Supplemental Form - due within 45 days of quarter end", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "reporting", ruleName: "TX Financial Condition", description: "Financial condition report - quarterly for lenders, annually for brokers", appliesTo: "both", effectiveDate: "2020-01-01" },
  { stateCode: "TX", ruleCategory: "documentation", ruleName: "TX Processing/Underwriting Log", description: "Required if providing third-party processing/underwriting services", appliesTo: "both", effectiveDate: "2025-01-01" },
];

export const TEXAS_REQUIRED_DOCUMENTS: readonly RequiredDocumentDef[] = [
  // Federal — TRID initial
  { ruleName: "TRID - Initial Disclosures", stateCode: "FED", documentType: "initial_loan_application", displayName: "Initial Loan Application (signed/dated)", isMandatory: true, weight: 3, pipelineStage: "application", description: "Signed and dated by applicant(s) and RMLO" },
  { ruleName: "TRID - Initial Disclosures", stateCode: "FED", documentType: "initial_loan_estimate", displayName: "Initial Loan Estimate", isMandatory: true, weight: 3, pipelineStage: "processing" },
  { ruleName: "TRID - Initial Disclosures", stateCode: "FED", documentType: "intent_to_proceed", displayName: "Intent to Proceed Documentation", isMandatory: true, weight: 3, pipelineStage: "application" },
  { ruleName: "TRID - Initial Disclosures", stateCode: "FED", documentType: "appraisal", displayName: "Appraisal", isMandatory: true, weight: 3, pipelineStage: "underwriting" },
  // RESPA
  { ruleName: "RESPA Disclosures", stateCode: "FED", documentType: "homeownership_counseling_list", displayName: "List of Homeownership Counseling Organizations", isMandatory: true, weight: 3, pipelineStage: "processing" },
  { ruleName: "RESPA Disclosures", stateCode: "FED", documentType: "settlement_provider_list", displayName: "Settlement Service Provider List", isMandatory: true, weight: 3, pipelineStage: "processing" },
  { ruleName: "RESPA Disclosures", stateCode: "FED", documentType: "initial_privacy_notice", displayName: "Initial Privacy Notice", isMandatory: true, weight: 3, pipelineStage: "processing" },
  // Closing
  { ruleName: "TRID - Closing Disclosures", stateCode: "FED", documentType: "closing_disclosure_final", displayName: "Final Closing Disclosure (signed)", isMandatory: true, weight: 3, pipelineStage: "closing" },
  { ruleName: "TRID - Closing Disclosures", stateCode: "FED", documentType: "promissory_note", displayName: "Promissory Note / Loan Agreement", isMandatory: true, weight: 3, pipelineStage: "post_close" },
  { ruleName: "TRID - Closing Disclosures", stateCode: "FED", documentType: "deed_of_trust", displayName: "Deed of Trust / Security Instrument (recorded)", isMandatory: true, weight: 3, pipelineStage: "post_close" },
  { ruleName: "TRID - Closing Disclosures", stateCode: "FED", documentType: "title_policy", displayName: "Lender Title Policy", isMandatory: true, weight: 3, pipelineStage: "closing" },
  { ruleName: "TRID - Closing Disclosures", stateCode: "FED", documentType: "flood_certification", displayName: "Flood Certification", isMandatory: true, weight: 3, pipelineStage: "closing" },
  // ECOA / credit
  { ruleName: "ECOA Credit Disclosures", stateCode: "FED", documentType: "credit_report", displayName: "Credit Report(s)", isMandatory: true, weight: 3, pipelineStage: "processing" },
  { ruleName: "ECOA Credit Disclosures", stateCode: "FED", documentType: "credit_score_disclosure", displayName: "Credit Score Disclosure and Notice", isMandatory: true, weight: 3, pipelineStage: "processing" },
  // ATR
  { ruleName: "Ability-to-Repay", stateCode: "FED", documentType: "atr_documentation", displayName: "Ability-to-Repay Documentation", isMandatory: true, weight: 3, pipelineStage: "underwriting" },
  { ruleName: "Ability-to-Repay", stateCode: "FED", documentType: "voe", displayName: "Verification of Employment", isMandatory: true, weight: 3, pipelineStage: "underwriting" },
  { ruleName: "Ability-to-Repay", stateCode: "FED", documentType: "voi", displayName: "Verification of Income", isMandatory: true, weight: 3, pipelineStage: "underwriting" },
  // Texas-specific
  { ruleName: "TX Mortgage Company Disclosure", stateCode: "TX", documentType: "tx_mortgage_company_disclosure", displayName: "TX Mortgage Company Disclosure", isMandatory: true, weight: 2, pipelineStage: "application", description: "Signed/dated by applicant(s) or evidence of delivery" },
  { ruleName: "TX Notice of Penalties", stateCode: "TX", documentType: "tx_notice_penalties", displayName: "TX Notice of Penalties for False/Misleading Statement", isMandatory: true, weight: 2, pipelineStage: "closing" },
  { ruleName: "TX Home Equity Disclosure 50(a)(6)", stateCode: "TX", documentType: "tx_home_equity_disclosure", displayName: "TX Home Equity Disclosure - 50(a)(6)", isMandatory: true, weight: 2, pipelineStage: "closing", loanPurposeFilter: "home_equity_50a6" },
  { ruleName: "TX Acknowledgement Fair Market Value", stateCode: "TX", documentType: "tx_fair_market_value_ack", displayName: "Acknowledgement of Fair Market Value - 50(a)(6)", isMandatory: true, weight: 2, pipelineStage: "closing", loanPurposeFilter: "home_equity_50a6" },
  { ruleName: "TX Wrap Mortgage Disclosure", stateCode: "TX", documentType: "tx_wrap_mortgage_disclosure", displayName: "Wrap Mortgage Loan Disclosure", isMandatory: true, weight: 2, pipelineStage: "closing", loanPurposeFilter: "wrap_mortgage" },
  { ruleName: "TX Refinance Home Equity Notice 50(f)(2)", stateCode: "TX", documentType: "tx_refinance_home_equity_notice", displayName: "TX Notice Concerning Refinance of Home Equity Loan - 50(f)(2)", isMandatory: true, weight: 2, pipelineStage: "closing", loanPurposeFilter: "refinance" },
];

// Quarterly reporting deadlines to ensure for a company (idempotent by report_type+quarter).
export interface ReportingDeadlineDef {
  reportType: string;
  stateCode: string;
  quarter: string;
  dueOffsetDays: number; // informational
}
export const TEXAS_REPORTING_DEADLINES: readonly ReportingDeadlineDef[] = [
  { reportType: "TX RMLA Quarterly", stateCode: "TX", quarter: "Q1-2026", dueOffsetDays: 45 },
  { reportType: "TX SSSF Quarterly", stateCode: "TX", quarter: "Q1-2026", dueOffsetDays: 45 },
];
