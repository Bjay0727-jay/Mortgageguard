// TX-SML Document Requirements Service
// Source: Mortgage Compliance Guide v12, January 26, 2026

export interface TxDocument {
  name: string;
  rule: string;
  timing: string;
  required: boolean;
  stage: string;
  loanTypes: string[];
  category: string;
}

export const TX_DOCUMENT_CATEGORIES = [
  {
    id: "fed_disclosures", name: "Federal Required Disclosures", docs: [
      { name: "Initial Loan Estimate (LE)", rule: "TRID / 12 CFR 1026.19(e)", timing: "Within 3 business days of application", required: true, stage: "application", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "Closing Disclosure (CD)", rule: "TRID / 12 CFR 1026.19(f)", timing: "At least 3 business days before closing", required: true, stage: "closing", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "Intent to Proceed", rule: "12 CFR 1026.19(e)(2)(i)(A)", timing: "Before fees collected", required: true, stage: "application", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "Credit Score Disclosure", rule: "FCRA / 15 U.S.C. 1681g", timing: "At or before closing", required: true, stage: "processing", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "ARM Program Disclosure", rule: "12 CFR 1026.19(b)", timing: "Within 3 days of application", required: true, stage: "application", loanTypes: ["arm"], category: "fed_disclosures" },
      { name: "Right to Rescind (Refinance)", rule: "TILA / 12 CFR 1026.23", timing: "At closing, 3-day window", required: true, stage: "closing", loanTypes: ["refinance","home_equity"], category: "fed_disclosures" },
      { name: "Rate Lock Agreement", rule: "Company policy", timing: "When rate is locked", required: true, stage: "processing", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "Settlement Service Provider List", rule: "12 CFR 1024.7", timing: "With Loan Estimate", required: true, stage: "application", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "Initial Privacy Notice", rule: "Gramm-Leach-Bliley Act", timing: "At time of application", required: true, stage: "application", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "Fee Agreement / Broker Agreement", rule: "RESPA / State law", timing: "Before fees collected", required: true, stage: "application", loanTypes: ["all"], category: "fed_disclosures" },
      { name: "Servicing Disclosure", rule: "12 CFR 1024.33", timing: "At application", required: true, stage: "application", loanTypes: ["all"], category: "fed_disclosures" },
    ]
  },
  {
    id: "fed_underwriting", name: "Federal Underwriting Documents", docs: [
      { name: "Uniform Residential Loan Application (1003)", rule: "Fannie Mae Form 1003", timing: "At application", required: true, stage: "application", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Credit Report (Tri-Merge)", rule: "GSE requirements", timing: "At processing", required: true, stage: "processing", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Appraisal Report", rule: "USPAP / GSE guidelines", timing: "Before underwriting decision", required: true, stage: "underwriting", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Title Commitment / Title Policy", rule: "ALTA standards", timing: "Before closing", required: true, stage: "closing", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Flood Hazard Determination", rule: "42 U.S.C. 4104b", timing: "Before closing", required: true, stage: "processing", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Verification of Employment (VOE)", rule: "GSE guidelines", timing: "During processing", required: true, stage: "processing", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Verification of Income (VOI)", rule: "ATR / 12 CFR 1026.43", timing: "During processing", required: true, stage: "processing", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Verification of Assets (VOA)", rule: "GSE guidelines", timing: "During processing", required: true, stage: "processing", loanTypes: ["all"], category: "fed_underwriting" },
      { name: "Homeowner's Insurance Binder", rule: "Lender requirement", timing: "Before closing", required: true, stage: "closing", loanTypes: ["all"], category: "fed_underwriting" },
    ]
  },
  {
    id: "tx_state", name: "Texas State Disclosures (TX-SML)", docs: [
      { name: "TX Mortgage Company Disclosure", rule: "Tex. Fin. Code 157.0062 / 7 TAC 81.200", timing: "At or before application", required: true, stage: "application", loanTypes: ["all"], category: "tx_state" },
      { name: "TX Consumer Fee Disclosure", rule: "7 TAC 81.200", timing: "At or before application", required: true, stage: "application", loanTypes: ["all"], category: "tx_state" },
      { name: "Anti-Coercion Notice", rule: "Tex. Ins. Code 2002", timing: "At application", required: true, stage: "application", loanTypes: ["all"], category: "tx_state" },
      { name: "TX Originator Compensation Disclosure", rule: "7 TAC 81.200", timing: "With Loan Estimate", required: true, stage: "application", loanTypes: ["all"], category: "tx_state" },
      { name: "TX Right to Choose Insurance Provider", rule: "Tex. Ins. Code 2002.052", timing: "At application", required: true, stage: "application", loanTypes: ["all"], category: "tx_state" },
      { name: "SML Complaint Notice", rule: "7 TAC 81.200", timing: "At application", required: true, stage: "application", loanTypes: ["all"], category: "tx_state" },
      { name: "Notice Concerning Extensions of Credit", rule: "TX Const. Art. XVI 50", timing: "At application", required: true, stage: "application", loanTypes: ["home_equity","refinance"], category: "tx_state" },
    ]
  },
  {
    id: "tx_homeequity", name: "Texas Home Equity 50(a)(6)", docs: [
      { name: "TX Home Equity Disclosure (12-Day Notice)", rule: "TX Const. Art. XVI 50(a)(6)", timing: "12 days before closing", required: true, stage: "application", loanTypes: ["home_equity_50a6"], category: "tx_homeequity" },
      { name: "Acknowledgement of Fair Market Value", rule: "TX Const. Art. XVI 50(a)(6)(Q)(ix)", timing: "Before closing", required: true, stage: "underwriting", loanTypes: ["home_equity_50a6"], category: "tx_homeequity" },
      { name: "Not-a-Home-Improvement Disclosure", rule: "TX Const. Art. XVI 50(a)(6)", timing: "At application", required: true, stage: "application", loanTypes: ["home_equity_50a6"], category: "tx_homeequity" },
      { name: "TX Notice of Penalties", rule: "TX Const. Art. XVI 50(a)(6)", timing: "At closing", required: true, stage: "closing", loanTypes: ["home_equity_50a6"], category: "tx_homeequity" },
      { name: "Discount Point Acknowledgement", rule: "TX Const. Art. XVI 50(a)(6)(E)", timing: "Before closing", required: true, stage: "processing", loanTypes: ["home_equity_50a6"], category: "tx_homeequity" },
      { name: "3% Fee Cap Certification", rule: "TX Const. Art. XVI 50(a)(6)(E)", timing: "At closing", required: true, stage: "closing", loanTypes: ["home_equity_50a6"], category: "tx_homeequity" },
      { name: "Owner Occupancy Affidavit", rule: "TX Const. Art. XVI 50(a)(6)(H)", timing: "At closing", required: true, stage: "closing", loanTypes: ["home_equity_50a6"], category: "tx_homeequity" },
    ]
  },
  {
    id: "tx_reporting", name: "Texas Reporting & Recordkeeping", docs: [
      { name: "Mortgage Transaction Log (17 fields)", rule: "7 TAC 81.100(d)", timing: "Within 7 days of activity", required: true, stage: "all", loanTypes: ["all"], category: "tx_reporting" },
      { name: "Residential Mortgage Loan Activity (RMLA)", rule: "NMLS MCR requirement", timing: "Quarterly, 45 days after quarter end", required: true, stage: "quarterly", loanTypes: ["all"], category: "tx_reporting" },
      { name: "State-Specific Supplemental Form (SSSF)", rule: "7 TAC 56.205 / 57.205", timing: "Quarterly with MCR (new Q1 2026)", required: true, stage: "quarterly", loanTypes: ["all"], category: "tx_reporting" },
      { name: "Annual Financial Condition Report", rule: "Tex. Fin. Code 156.202", timing: "March 31 annually", required: true, stage: "annual", loanTypes: ["all"], category: "tx_reporting" },
    ]
  },
];

export function getRequiredDocuments(loanPurpose: string, loanType: string): TxDocument[] {
  const allDocs = TX_DOCUMENT_CATEGORIES.flatMap(cat => cat.docs);
  return allDocs.filter(doc => {
    if (doc.loanTypes.includes("all")) return true;
    return doc.loanTypes.some(t => t === loanPurpose || t === loanType);
  });
}

export function getDocumentsByCategory() {
  return TX_DOCUMENT_CATEGORIES;
}
