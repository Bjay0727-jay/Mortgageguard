import { describe, it, expect } from "vitest";
import { deriveConditionalDocuments, type ConditionalDocAttrs } from "./loan-conditional-docs";

function base(o: Partial<ConditionalDocAttrs> = {}): ConditionalDocAttrs {
  return { propertyState: "TX", loanPurpose: "purchase", loanProduct: "conventional", loanType: "fixed", lienPosition: "first", texasCashoutType: "none", companyEntityType: "broker", ...o };
}
const types = (a: ConditionalDocAttrs) => deriveConditionalDocuments(a).map((d) => d.documentType);

describe("deriveConditionalDocuments — Texas matrix", () => {
  it("every Texas loan gets Notice of Penalties + company disclosure (broker)", () => {
    const t = types(base());
    expect(t).toContain("tx_notice_penalties");
    expect(t).toContain("tx_mortgage_company_disclosure");
    expect(t).not.toContain("tx_mortgage_banker_disclosure");
  });

  it("lender/banker entity gets the banker disclosure instead", () => {
    expect(types(base({ companyEntityType: "lender" }))).toContain("tx_mortgage_banker_disclosure");
    expect(types(base({ companyEntityType: "lender" }))).not.toContain("tx_mortgage_company_disclosure");
  });

  it("50(a)(6) adds home equity disclosure, FMV ack, and discount point ack", () => {
    const t = types(base({ texasCashoutType: "tx_50a6" }));
    expect(t).toEqual(expect.arrayContaining(["tx_home_equity_disclosure", "tx_fair_market_value_ack", "tx_discount_point_ack"]));
  });

  it("loan purpose home_equity_50a6 also triggers 50(a)(6) docs", () => {
    expect(types(base({ loanPurpose: "home_equity_50a6" }))).toContain("tx_home_equity_disclosure");
  });

  it("50(f)(2) adds the refinance notice", () => {
    expect(types(base({ loanPurpose: "refinance", texasCashoutType: "tx_50f2" }))).toContain("tx_refinance_home_equity_notice");
  });

  it("wrap mortgage adds the wrap disclosure + 5.016 notice (by purpose or lien)", () => {
    expect(types(base({ loanPurpose: "wrap_mortgage" }))).toEqual(expect.arrayContaining(["tx_wrap_mortgage_disclosure", "tx_prop_code_5016_notice"]));
    expect(types(base({ lienPosition: "wrap" }))).toContain("tx_prop_code_5016_notice");
  });

  it("ARM adds the program disclosure in any state", () => {
    expect(types(base({ loanType: "arm" }))).toContain("arm_program_disclosure");
    expect(types(base({ propertyState: "CA", loanType: "arm" }))).toContain("arm_program_disclosure");
  });

  it("reverse adds federal reverse docs + TX reverse disclosure", () => {
    const t = types(base({ loanProduct: "reverse" }));
    expect(t).toEqual(expect.arrayContaining(["ecoa_appraisal_notice", "servicing_disclosure_statement", "total_annual_loan_cost_rate", "certificate_of_counseling", "tx_reverse_mortgage_disclosure"]));
  });

  it("a plain non-TX purchase has no conditional docs", () => {
    expect(types(base({ propertyState: "CA" }))).toEqual([]);
  });

  it("returns deduped document types", () => {
    const t = types(base({ loanType: "arm", texasCashoutType: "tx_50a6" }));
    expect(new Set(t).size).toBe(t.length);
  });
});
