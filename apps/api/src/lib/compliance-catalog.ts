// ─────────────────────────────────────────────────────────────
// MortgageGuard — Source-backed compliance program catalog
//
// COMPANY-LEVEL compliance controls only (AML, Red Flags, Information
// Security, LO/Lender Compensation, Remote Work). These are distinct from
// LOAN-LEVEL required documents (disclosures, LE/CD, appraisal, etc.) which
// live in the loan checklist — do not mix the two layers.
//
// Every requirement carries a click-through audit trail via `sourceKeys`
// into the Regulatory Source Registry below.
// ─────────────────────────────────────────────────────────────

export interface RequiredProgramDef {
  programKey: string;
  name: string;
  category: string;
  requiredBy: string;
  reviewFrequencyMonths: number;
  requiredDocumentType: string;
  requiredDocumentName: string;
  isRequired: boolean;
  isConditionallyRequired: boolean;
  requiredIf?: string;
  sourceModel?: string;
  sourceKeys: readonly string[];
}

export const REQUIRED_COMPLIANCE_PROGRAMS: readonly RequiredProgramDef[] = [
  {
    programKey: "aml_program",
    name: "AML Program",
    category: "anti_money_laundering",
    requiredBy: "31 CFR 1029.210",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "aml_program_policy",
    requiredDocumentName: "AML Program Policy",
    isRequired: true,
    isConditionallyRequired: false,
    sourceKeys: ["aml_program_31_cfr_1029_210", "aml_sar_31_cfr_1029_320"],
  },
  {
    programKey: "red_flags_program",
    name: "Red Flags Program",
    category: "identity_theft",
    requiredBy: "16 CFR 681.1",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "red_flags_program",
    requiredDocumentName: "Identity Theft Prevention Program",
    isRequired: true,
    isConditionallyRequired: false,
    sourceKeys: ["red_flags_16_cfr_681_1"],
  },
  {
    programKey: "information_security_program",
    name: "Information Security Program",
    category: "information_security",
    requiredBy: "16 CFR Part 314",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "information_security_program",
    requiredDocumentName: "Information Security Program",
    isRequired: true,
    isConditionallyRequired: false,
    sourceKeys: ["safeguards_16_cfr_part_314", "safeguards_16_cfr_314_4"],
  },
  {
    programKey: "lo_lender_compensation_agreements",
    name: "Loan Originator and Lender Compensation Agreements",
    category: "loan_originator_compensation",
    requiredBy: "12 CFR 1026.36 and 12 CFR 1026.25(c)(2)",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "lo_compensation_agreements",
    requiredDocumentName: "Loan Originator and Lender Compensation Agreements",
    isRequired: true,
    isConditionallyRequired: false,
    sourceKeys: ["lo_comp_12_cfr_1026_36", "lo_recordkeeping_12_cfr_1026_25_c_2"],
  },
  {
    programKey: "remote_work_policy",
    name: "Remote Work Policy",
    category: "remote_work",
    requiredBy: "State mortgage licensing law / company policy / GLBA Safeguards controls",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "remote_work_policy",
    requiredDocumentName: "Remote Work Policy",
    isRequired: true,
    isConditionallyRequired: true,
    requiredIf: "company.allows_remote_work === true",
    sourceModel: "state_specific",
    sourceKeys: ["remote_work_state_specific", "safeguards_16_cfr_part_314"],
  },
];

export const RECOMMENDED_COMPLIANCE_PROGRAMS: readonly RequiredProgramDef[] = [
  {
    programKey: "ability_to_repay_underwriting_policy",
    name: "Ability-to-Repay Underwriting Policies",
    category: "underwriting",
    requiredBy: "Recommended compliance policy",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "ability_to_repay_underwriting_policy",
    requiredDocumentName: "Ability-to-Repay Underwriting Policy",
    isRequired: false,
    isConditionallyRequired: false,
    sourceKeys: [],
  },
  {
    programKey: "quality_control_policy",
    name: "Quality Control Policy / Compliance Manual",
    category: "quality_control",
    requiredBy: "Recommended compliance policy",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "quality_control_policy",
    requiredDocumentName: "Quality Control Policy / Compliance Manual",
    isRequired: false,
    isConditionallyRequired: false,
    sourceKeys: [],
  },
  {
    programKey: "advertising_social_media_policy",
    name: "Advertising / Social Media Policy",
    category: "advertising",
    requiredBy: "Recommended compliance policy",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "advertising_social_media_policy",
    requiredDocumentName: "Advertising / Social Media Policy",
    isRequired: false,
    isConditionallyRequired: false,
    sourceKeys: [],
  },
  {
    programKey: "esign_act_procedures",
    name: "E-Sign Act Procedures",
    category: "esign",
    requiredBy: "Recommended compliance policy",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "esign_act_procedures",
    requiredDocumentName: "E-Sign Act Procedures",
    isRequired: false,
    isConditionallyRequired: false,
    sourceKeys: [],
  },
  {
    programKey: "personnel_employee_policies",
    name: "Personnel Administration / Employee Policies",
    category: "personnel",
    requiredBy: "Recommended compliance policy",
    reviewFrequencyMonths: 12,
    requiredDocumentType: "personnel_employee_policies",
    requiredDocumentName: "Personnel Administration / Employee Policies",
    isRequired: false,
    isConditionallyRequired: false,
    sourceKeys: [],
  },
];

// ─── Regulatory Source Registry seed ──────────────────────────
export interface RegulatorySourceSeed {
  sourceKey: string;
  title: string;
  citation: string;
  jurisdiction: string;
  agency: string | null;
  sourceType: string;
  sourceUrl: string;
  rulemakingCitation?: string | null;
  rulemakingUrl?: string | null;
  guidanceUrl?: string | null;
  notes?: string | null;
}

export const REGULATORY_SOURCES: readonly RegulatorySourceSeed[] = [
  {
    sourceKey: "aml_program_31_cfr_1029_210",
    title: "AML Program Requirements for Residential Mortgage Lenders and Originators",
    citation: "31 CFR 1029.210",
    jurisdiction: "FED",
    agency: "FinCEN",
    sourceType: "ecfr",
    sourceUrl: "https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1029/subpart-B/section-1029.210",
    rulemakingCitation: "77 FR 8148",
    rulemakingUrl: "https://www.federalregister.gov/documents/2012/02/14/2012-3074/",
    guidanceUrl: "https://www.fincen.gov/news/news-releases/important-notice-non-bank-residential-mortgage-lenders-and-originators",
  },
  {
    sourceKey: "aml_sar_31_cfr_1029_320",
    title: "Suspicious Activity Reports by Residential Mortgage Lenders and Originators",
    citation: "31 CFR 1029.320",
    jurisdiction: "FED",
    agency: "FinCEN",
    sourceType: "ecfr",
    sourceUrl: "https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1029/subpart-C/section-1029.320",
    rulemakingCitation: "77 FR 8148",
    rulemakingUrl: "https://www.federalregister.gov/documents/2012/02/14/2012-3074/",
  },
  {
    sourceKey: "red_flags_16_cfr_681_1",
    title: "Duties Regarding the Detection, Prevention, and Mitigation of Identity Theft",
    citation: "16 CFR 681.1",
    jurisdiction: "FED",
    agency: "FTC",
    sourceType: "ecfr",
    sourceUrl: "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-F/part-681/section-681.1",
    rulemakingCitation: "72 FR 63718",
    rulemakingUrl: "https://www.federalregister.gov/documents/2007/11/09/E7-21663/identity-theft-red-flags-and-address-discrepancies-under-the-fair-and-accurate-credit-transactions",
    guidanceUrl: "https://www.ftc.gov/business-guidance/resources/fighting-identity-theft-red-flags-rule-how-guide-business",
  },
  {
    sourceKey: "safeguards_16_cfr_part_314",
    title: "Standards for Safeguarding Customer Information",
    citation: "16 CFR Part 314",
    jurisdiction: "FED",
    agency: "FTC",
    sourceType: "ecfr",
    sourceUrl: "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314",
    rulemakingCitation: "86 FR 70304; 88 FR 77508",
    rulemakingUrl: "https://www.federalregister.gov/documents/2023/11/13/2023-24412/",
    guidanceUrl: "https://www.ftc.gov/legal-library/browse/rules/safeguards-rule",
  },
  {
    sourceKey: "safeguards_16_cfr_314_4",
    title: "Elements of an Information Security Program",
    citation: "16 CFR 314.4",
    jurisdiction: "FED",
    agency: "FTC",
    sourceType: "ecfr",
    sourceUrl: "https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-314/section-314.4",
    rulemakingCitation: "86 FR 70304; 88 FR 77508",
    rulemakingUrl: "https://www.federalregister.gov/documents/2023/11/13/2023-24412/",
    guidanceUrl: "https://www.ftc.gov/legal-library/browse/rules/safeguards-rule",
  },
  {
    sourceKey: "lo_comp_12_cfr_1026_36",
    title: "Loan Originator Compensation and Steering",
    citation: "12 CFR 1026.36",
    jurisdiction: "FED",
    agency: "CFPB",
    sourceType: "ecfr",
    sourceUrl: "https://www.ecfr.gov/current/title-12/chapter-X/part-1026/subpart-E/section-1026.36",
    rulemakingCitation: "78 FR 11280",
    rulemakingUrl: "https://www.federalregister.gov/documents/2013/02/15/2013-01503/",
    guidanceUrl: "https://www.consumerfinance.gov/rules-policy/regulations/1026/36/",
  },
  {
    sourceKey: "lo_recordkeeping_12_cfr_1026_25_c_2",
    title: "Loan Originator Compensation Record Retention",
    citation: "12 CFR 1026.25(c)(2)",
    jurisdiction: "FED",
    agency: "CFPB",
    sourceType: "ecfr",
    sourceUrl: "https://www.ecfr.gov/current/title-12/chapter-X/part-1026/subpart-D/section-1026.25",
    rulemakingCitation: "78 FR 11280",
    rulemakingUrl: "https://www.federalregister.gov/documents/2013/02/15/2013-01503/",
    guidanceUrl: "https://www.consumerfinance.gov/rules-policy/regulations/1026/25/",
  },
  {
    sourceKey: "remote_work_state_specific",
    title: "Remote Work Policy - State-Specific Mortgage Licensing Requirement",
    citation: "State mortgage licensing law and regulator guidance",
    jurisdiction: "MULTI_STATE",
    agency: "State mortgage regulators / NMLS / CSBS",
    sourceType: "state_guidance",
    sourceUrl: "https://mortgage.nationwidelicensingsystem.org/",
    rulemakingCitation: null,
    rulemakingUrl: null,
    guidanceUrl: null,
    notes: "Remote work policy requirements depend on the company's licensed jurisdictions. Use state-specific regulator guidance where available. GLBA Safeguards controls may also apply to customer-data handling in remote environments.",
  },
];

// ─── Program ⇄ Source links (derived from each program's sourceKeys) ──────
export interface ProgramSourceLink {
  programKey: string;
  sourceKey: string;
  citation: string;
  appliesTo: string;
}

const CITATION_BY_SOURCE: Record<string, string> = Object.fromEntries(
  REGULATORY_SOURCES.map((s) => [s.sourceKey, s.citation]),
);

export const PROGRAM_SOURCE_LINKS: readonly ProgramSourceLink[] = REQUIRED_COMPLIANCE_PROGRAMS.flatMap((p) =>
  p.sourceKeys.map((sourceKey, i) => ({
    programKey: p.programKey,
    sourceKey,
    citation: CITATION_BY_SOURCE[sourceKey] ?? p.requiredBy,
    // The first source is the binding rule for the program; later ones support
    // recordkeeping / customer-data security controls.
    appliesTo: i === 0 ? "program" : "recordkeeping",
  })),
);

// ─── Evidence requirements per program ────────────────────────
export interface EvidenceRequirementDef {
  programKey: string;
  evidenceKey: string;
  displayName: string;
  description?: string;
  required?: boolean;
  sourceKey?: string;
  cadenceMonths?: number;
}

function ev(programKey: string, sourceKey: string, items: Array<[string, string]>): EvidenceRequirementDef[] {
  return items.map(([evidenceKey, displayName]) => ({ programKey, evidenceKey, displayName, required: true, sourceKey }));
}

export const PROGRAM_EVIDENCE_REQUIREMENTS: readonly EvidenceRequirementDef[] = [
  ...ev("aml_program", "aml_program_31_cfr_1029_210", [
    ["aml_policy_document", "Written AML program policy"],
    ["senior_management_approval", "Senior management approval"],
    ["aml_compliance_officer", "Designated AML compliance officer"],
    ["employee_training_evidence", "Employee AML training evidence"],
    ["independent_testing", "Independent testing of the program"],
    ["suspicious_activity_escalation_procedure", "Suspicious activity escalation procedure"],
    ["recordkeeping_procedure", "Recordkeeping procedure"],
  ]),
  ...ev("red_flags_program", "red_flags_16_cfr_681_1", [
    ["identity_theft_program_document", "Written Identity Theft Prevention Program"],
    ["covered_accounts_assessment", "Covered accounts assessment"],
    ["red_flags_detection_procedures", "Red flags detection procedures"],
    ["red_flags_response_procedures", "Red flags response procedures"],
    ["program_update_review", "Periodic program update / review"],
    ["staff_training_evidence", "Staff training evidence"],
    ["service_provider_oversight", "Service provider oversight"],
  ]),
  ...ev("information_security_program", "safeguards_16_cfr_314_4", [
    ["information_security_program_document", "Written information security program"],
    ["qualified_individual_assignment", "Qualified individual assignment"],
    ["written_risk_assessment", "Written risk assessment"],
    ["access_controls", "Access controls"],
    ["encryption_or_compensating_controls", "Encryption or compensating controls"],
    ["mfa_or_equivalent_controls", "MFA or equivalent controls"],
    ["vendor_oversight", "Vendor oversight"],
    ["incident_response_plan", "Incident response plan"],
    ["safeguards_review", "Periodic safeguards review"],
  ]),
  ...ev("lo_lender_compensation_agreements", "lo_comp_12_cfr_1026_36", [
    ["compensation_policy", "Loan originator compensation policy"],
    ["signed_compensation_agreements", "Signed compensation agreements"],
    ["anti_steering_controls", "Anti-steering controls"],
    ["compensation_plan_effective_dates", "Compensation plan effective dates"],
    ["compensation_record_retention", "Compensation record retention"],
    ["prior_version_archive", "Prior version archive"],
  ]),
  ...ev("remote_work_policy", "remote_work_state_specific", [
    ["remote_work_policy_document", "Written remote work policy"],
    ["licensed_location_review", "Licensed location review"],
    ["employee_remote_work_attestation", "Employee remote work attestation"],
    ["customer_data_security_controls", "Customer data security controls"],
    ["device_and_network_security_controls", "Device and network security controls"],
    ["supervision_monitoring_procedure", "Supervision / monitoring procedure"],
    ["state_specific_remote_work_review", "State-specific remote work review"],
  ]),
];

// ─── Document requirements per program (one current policy doc each) ──────
export interface DocumentRequirementDef {
  programKey: string;
  documentType: string;
  displayName: string;
  required: boolean;
}

export const PROGRAM_DOCUMENT_REQUIREMENTS: readonly DocumentRequirementDef[] = [
  ...REQUIRED_COMPLIANCE_PROGRAMS,
  ...RECOMMENDED_COMPLIANCE_PROGRAMS,
].map((p) => ({
  programKey: p.programKey,
  documentType: p.requiredDocumentType,
  displayName: p.requiredDocumentName,
  required: p.isRequired,
}));

export const ALL_PROGRAM_DEFS: readonly RequiredProgramDef[] = [
  ...REQUIRED_COMPLIANCE_PROGRAMS,
  ...RECOMMENDED_COMPLIANCE_PROGRAMS,
];

export function getProgramDef(programKey: string): RequiredProgramDef | undefined {
  return ALL_PROGRAM_DEFS.find((p) => p.programKey === programKey);
}
