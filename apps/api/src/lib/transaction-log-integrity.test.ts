import { describe, it, expect } from "vitest";
import { deriveTransactionLogCompleteness, type TxLogLoan } from "./transaction-log-integrity";

function complete(o: Partial<TxLogLoan> = {}): TxLogLoan {
  return {
    loan_number: "LN-1", borrower_last_name: "Doe", borrower_first_name: "Jane",
    application_date: "2026-06-01", property_address: "1 Main", loan_purpose: "purchase",
    loan_product: "conventional", loan_type: "fixed", lien_position: "first", occupancy_type: "primary",
    status: "application", loan_originator_name: "Officer", originator_nmls_id: "111",
    interest_rate: 6.5, loan_term: 360, lender_name: "Lender", lender_nmls_id: "222",
    transaction_log_entered_at: "2026-06-02",
    ...o,
  };
}

describe("deriveTransactionLogCompleteness", () => {
  it("is complete when all required fields are present", () => {
    const r = deriveTransactionLogCompleteness(complete(), new Date("2026-06-03"));
    expect(r.complete).toBe(true);
    expect(r.missingFields).toEqual([]);
    expect(r.status).toBe("complete");
  });

  it("lists missing required fields", () => {
    const r = deriveTransactionLogCompleteness(complete({ loan_number: null, originator_nmls_id: "" }), new Date("2026-06-03"));
    expect(r.complete).toBe(false);
    expect(r.missingFields).toEqual(expect.arrayContaining(["loan_number", "originator_nmls_id"]));
    expect(r.status).toBe("missing_fields");
  });

  it("warns on missing soft fields but stays complete", () => {
    const r = deriveTransactionLogCompleteness(complete({ interest_rate: null, lender_name: null }), new Date("2026-06-03"));
    expect(r.complete).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/interest_rate/);
  });

  it("requires closing_date once the loan is closing/post_close", () => {
    const r = deriveTransactionLogCompleteness(complete({ status: "closing", closing_date: null }), new Date("2026-06-03"));
    expect(r.missingFields).toContain("closing_date");
  });

  it("flags overdue when past the 7-day window with no entry timestamp", () => {
    const r = deriveTransactionLogCompleteness(complete({ transaction_log_entered_at: null }), new Date("2026-06-20"));
    expect(r.status).toBe("overdue");
    expect(r.dueAt).toBeTruthy();
  });
});
