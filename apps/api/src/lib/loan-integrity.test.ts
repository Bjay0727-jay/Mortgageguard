import { describe, it, expect } from "vitest";
import { deriveLoanIntegrity, type LoanIntegrityInput } from "./loan-integrity";
import { deriveTransactionLogCompleteness } from "./transaction-log-integrity";

const goodTxLog = deriveTransactionLogCompleteness({
  loan_number: "LN-1", borrower_last_name: "Doe", application_date: "2026-06-01", property_address: "1 Main",
  loan_purpose: "purchase", loan_product: "conventional", loan_type: "fixed", lien_position: "first",
  occupancy_type: "primary", status: "application", loan_originator_name: "O", originator_nmls_id: "1",
  transaction_log_entered_at: "2026-06-01",
}, new Date("2026-06-02"));

function base(o: Partial<LoanIntegrityInput> = {}): LoanIntegrityInput {
  return {
    loan: { id: "loan-1", status: "application", compliance_score: 100, closing_date: null, property_state: "TX" },
    checklist: [{ documentType: "appraisal", displayName: "Appraisal", isMandatory: true, pipelineStage: "underwriting", uploaded: true, status: "uploaded" }],
    tasks: [],
    txLog: goodTxLog,
    rulesLoaded: true,
    now: new Date("2026-06-02"),
    ...o,
  };
}

describe("deriveLoanIntegrity", () => {
  it("is clean when everything is satisfied", () => {
    expect(deriveLoanIntegrity(base()).status).toBe("clean");
  });

  it("blocks when rules are not loaded and offers a load action", () => {
    const r = deriveLoanIntegrity(base({ rulesLoaded: false }));
    expect(r.status).toBe("blocked");
    expect(r.nextActions.some((a) => a.href === "/setup?step=rules")).toBe(true);
  });

  it("blocks when transaction-log required fields are missing", () => {
    const txLog = deriveTransactionLogCompleteness({ loan_number: null, application_date: "2026-06-01" }, new Date("2026-06-02"));
    const r = deriveLoanIntegrity(base({ txLog }));
    expect(r.status).toBe("blocked");
    expect(r.blockers.join(" ")).toMatch(/Transaction log/);
  });

  it("warns and offers an upload action when a required document is missing", () => {
    const r = deriveLoanIntegrity(base({ checklist: [{ documentType: "appraisal", displayName: "Appraisal", isMandatory: true, pipelineStage: "underwriting", uploaded: false, status: null }] }));
    expect(r.status).toBe("needs_attention");
    expect(r.nextActions.some((a) => a.label.includes("Upload"))).toBe(true);
  });

  it("is critical when an uploaded document is invalid", () => {
    const r = deriveLoanIntegrity(base({ checklist: [{ documentType: "appraisal", displayName: "Appraisal", isMandatory: true, uploaded: true, status: "rejected" }] }));
    expect(r.status).toBe("critical");
  });

  it("is critical when closing is imminent with outstanding closing docs", () => {
    const r = deriveLoanIntegrity(base({
      loan: { id: "loan-1", status: "closing", compliance_score: 100, closing_date: "2026-06-05", property_state: "TX" },
      checklist: [{ documentType: "closing_disclosure_final", displayName: "CD", isMandatory: true, pipelineStage: "closing", uploaded: false, status: null }],
    }));
    expect(r.status).toBe("critical");
    expect(r.nextActions.some((a) => a.priority === "critical")).toBe(true);
  });

  it("warns on overdue tasks", () => {
    const r = deriveLoanIntegrity(base({ tasks: [{ status: "open", due_at: "2026-05-01" }] }));
    expect(r.warnings.join(" ")).toMatch(/overdue task/);
  });

  it("flags a critical compliance score", () => {
    const r = deriveLoanIntegrity(base({ loan: { id: "loan-1", status: "application", compliance_score: 40, property_state: "TX" } }));
    expect(r.status).toBe("critical");
  });
});
