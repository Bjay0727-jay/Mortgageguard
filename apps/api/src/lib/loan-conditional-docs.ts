// ─────────────────────────────────────────────────────────────
// MortgageGuard — Conditional loan document catalog (Texas MVP)
//
// Data-driven rule resolution lives in state_rules/required_documents, but a
// few Texas requirements depend on combinations the single-value document
// filters can't express on their own (e.g. cash-out type, reverse, wrap, ARM,
// company entity type). This catalog encodes those conditional mappings in ONE
// tested place (NOT in React components), so the checklist, integrity checks,
// and the creation wizard's "expected documents" preview all agree.
//
// Architected for all states; only TX + federal conditionals are implemented.
// ─────────────────────────────────────────────────────────────

export interface ConditionalDocAttrs {
  propertyState: string;
  loanPurpose: string;
  loanProduct: string;
  loanType: string;
  lienPosition: string;
  /** none | tx_50a6 | tx_50f2 */
  texasCashoutType?: string | null;
  /** broker | lender | servicer | broker_lender | banker — drives company disclosure */
  companyEntityType?: string | null;
}

export interface ConditionalDoc {
  documentType: string;
  displayName: string;
  source: "federal" | "state";
  stateCode: string;
  pipelineStage: string;
  reason: string;
}

const isReverse = (a: ConditionalDocAttrs) => a.loanProduct === "reverse" || a.loanPurpose === "reverse" || a.loanPurpose === "reverse_mortgage";
const isWrap = (a: ConditionalDocAttrs) => a.loanPurpose === "wrap_mortgage" || a.lienPosition === "wrap";
const is50a6 = (a: ConditionalDocAttrs) => a.texasCashoutType === "tx_50a6" || a.loanPurpose === "home_equity_50a6";
const is50f2 = (a: ConditionalDocAttrs) => a.texasCashoutType === "tx_50f2";

// Returns the conditionally-required documents for a loan's attributes.
// Deduped by documentType, deterministic order.
export function deriveConditionalDocuments(attrs: ConditionalDocAttrs): ConditionalDoc[] {
  const out: ConditionalDoc[] = [];
  const tx = attrs.propertyState?.toUpperCase() === "TX";

  // ── ARM (any state): program disclosure ──
  if (attrs.loanType === "arm") {
    out.push({ documentType: "arm_program_disclosure", displayName: "ARM Program Disclosure (CHARM booklet)", source: "federal", stateCode: "FED", pipelineStage: "application", reason: "Adjustable-rate loan" });
  }

  // ── Reverse mortgage (any state + Texas-specific) ──
  if (isReverse(attrs)) {
    out.push(
      { documentType: "ecoa_appraisal_notice", displayName: "ECOA Appraisal Notice", source: "federal", stateCode: "FED", pipelineStage: "application", reason: "Reverse mortgage" },
      { documentType: "servicing_disclosure_statement", displayName: "Servicing Disclosure Statement", source: "federal", stateCode: "FED", pipelineStage: "processing", reason: "Reverse mortgage" },
      { documentType: "total_annual_loan_cost_rate", displayName: "Total Annual Loan Cost (TALC) Rate Disclosure", source: "federal", stateCode: "FED", pipelineStage: "processing", reason: "Reverse mortgage" },
      { documentType: "certificate_of_counseling", displayName: "Certificate of Counseling", source: "federal", stateCode: "FED", pipelineStage: "processing", reason: "Reverse mortgage" },
    );
    if (tx) {
      out.push({ documentType: "tx_reverse_mortgage_disclosure", displayName: "Texas Constitution Reverse Mortgage Disclosure", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "Texas reverse mortgage" });
    }
  }

  if (!tx) return dedupe(out);

  // ── All Texas loans ──
  out.push({ documentType: "tx_notice_penalties", displayName: "TX Notice of Penalties for False/Misleading Statement", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "All Texas loans" });
  // Company vs. banker disclosure depends on entity type.
  if (attrs.companyEntityType === "lender" || attrs.companyEntityType === "banker") {
    out.push({ documentType: "tx_mortgage_banker_disclosure", displayName: "TX Mortgage Banker Disclosure", source: "state", stateCode: "TX", pipelineStage: "application", reason: "Texas mortgage banker" });
  } else {
    out.push({ documentType: "tx_mortgage_company_disclosure", displayName: "TX Mortgage Company Disclosure", source: "state", stateCode: "TX", pipelineStage: "application", reason: "Texas mortgage company" });
  }

  // ── Texas 50(a)(6) home equity ──
  if (is50a6(attrs)) {
    out.push(
      { documentType: "tx_home_equity_disclosure", displayName: "TX Home Equity Disclosure - 50(a)(6)", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "Texas 50(a)(6) home equity" },
      { documentType: "tx_fair_market_value_ack", displayName: "Acknowledgement of Fair Market Value - 50(a)(6)", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "Texas 50(a)(6) home equity" },
      { documentType: "tx_discount_point_ack", displayName: "Discount Point Acknowledgement - 50(a)(6)", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "Texas 50(a)(6) bona fide discount points" },
    );
  }

  // ── Texas 50(f)(2) refinance to non-home-equity ──
  if (is50f2(attrs)) {
    out.push({ documentType: "tx_refinance_home_equity_notice", displayName: "TX Notice Concerning Refinance of Home Equity Loan - 50(f)(2)", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "Texas 50(f)(2) refinance" });
  }

  // ── Wrap mortgage ──
  if (isWrap(attrs)) {
    out.push(
      { documentType: "tx_wrap_mortgage_disclosure", displayName: "Wrap Mortgage Loan Disclosure", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "Wrap mortgage" },
      { documentType: "tx_prop_code_5016_notice", displayName: "Tex. Prop. Code 5.016 Notice (to lienholder)", source: "state", stateCode: "TX", pipelineStage: "closing", reason: "Wrap mortgage" },
    );
  }

  return dedupe(out);
}

function dedupe(docs: ConditionalDoc[]): ConditionalDoc[] {
  const seen = new Set<string>();
  const out: ConditionalDoc[] = [];
  for (const d of docs) {
    if (!seen.has(d.documentType)) {
      seen.add(d.documentType);
      out.push(d);
    }
  }
  return out;
}
