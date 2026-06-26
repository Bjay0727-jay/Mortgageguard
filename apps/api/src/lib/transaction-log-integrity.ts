// ─────────────────────────────────────────────────────────────
// MortgageGuard — Transaction-log completeness (Texas SML)
//
// The Texas guide requires a CURRENT mortgage transaction log with all
// required fields, entered within 7 days of application. This pure helper
// derives which fields are missing and whether the log entry is overdue, so
// loan creation never blocks but the workspace can show clear action items.
// ─────────────────────────────────────────────────────────────

export interface TxLogLoan {
  loan_number?: string | null;
  borrower_first_name?: string | null;
  borrower_last_name?: string | null;
  loan_originator_name?: string | null;
  originator_name?: string | null; // joined fallback
  originator_nmls_id?: string | null;
  application_date?: string | null;
  property_address?: string | null;
  property_state?: string | null;
  loan_purpose?: string | null;
  loan_product?: string | null;
  loan_type?: string | null;
  lien_position?: string | null;
  occupancy_type?: string | null;
  status?: string | null;
  interest_rate?: string | number | null;
  loan_term?: number | null;
  lender_name?: string | null;
  lender_nmls_id?: string | null;
  closing_date?: string | null;
  transaction_log_entered_at?: string | null;
}

export type TransactionLogStatus = "complete" | "missing_fields" | "overdue";

export interface TransactionLogCompleteness {
  complete: boolean;
  missingFields: string[];
  warnings: string[];
  status: TransactionLogStatus;
  dueAt: string | null;
}

const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

// Fields that must always be present for a usable transaction-log entry.
const ALWAYS_REQUIRED: Array<{ field: string; get: (l: TxLogLoan) => unknown }> = [
  { field: "loan_number", get: (l) => l.loan_number },
  { field: "applicant_name", get: (l) => l.borrower_last_name || l.borrower_first_name },
  { field: "application_date", get: (l) => l.application_date },
  { field: "property_address", get: (l) => l.property_address },
  { field: "loan_purpose", get: (l) => l.loan_purpose },
  { field: "loan_product", get: (l) => l.loan_product },
  { field: "loan_type", get: (l) => l.loan_type },
  { field: "lien_position", get: (l) => l.lien_position },
  { field: "occupancy_type", get: (l) => l.occupancy_type },
  { field: "status", get: (l) => l.status },
  { field: "loan_originator_name", get: (l) => l.loan_originator_name || l.originator_name },
  { field: "originator_nmls_id", get: (l) => l.originator_nmls_id },
];

// Soft fields — missing produces a warning, not an incomplete log.
const SOFT_FIELDS: Array<{ field: string; get: (l: TxLogLoan) => unknown }> = [
  { field: "interest_rate", get: (l) => l.interest_rate },
  { field: "loan_term", get: (l) => l.loan_term },
  { field: "lender_name", get: (l) => l.lender_name },
  { field: "lender_nmls_id", get: (l) => l.lender_nmls_id },
];

export function deriveTransactionLogCompleteness(loan: TxLogLoan, now: Date = new Date()): TransactionLogCompleteness {
  const missingFields = ALWAYS_REQUIRED.filter((f) => !has(f.get(loan))).map((f) => f.field);
  const warnings: string[] = [];

  for (const f of SOFT_FIELDS) {
    if (!has(f.get(loan))) warnings.push(`Transaction log: ${f.field} is not recorded yet.`);
  }
  // Closing date is required once the loan reaches closing/post-close.
  if ((loan.status === "closing" || loan.status === "post_close") && !has(loan.closing_date)) {
    missingFields.push("closing_date");
  }

  // 7-day entry expectation from the application date.
  let dueAt: string | null = null;
  let overdue = false;
  if (has(loan.application_date)) {
    const due = new Date(loan.application_date as string);
    due.setDate(due.getDate() + 7);
    dueAt = due.toISOString();
    overdue = !has(loan.transaction_log_entered_at) && now.getTime() > due.getTime();
  }

  const complete = missingFields.length === 0;
  const status: TransactionLogStatus = !complete ? "missing_fields" : overdue ? "overdue" : "complete";
  // An overdue-but-otherwise-complete log still needs attention.
  if (overdue && complete) warnings.push("Transaction log entry is past the 7-day deadline.");

  return { complete, missingFields, warnings, status, dueAt };
}
