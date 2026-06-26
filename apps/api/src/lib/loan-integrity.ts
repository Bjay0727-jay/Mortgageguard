// ─────────────────────────────────────────────────────────────
// MortgageGuard — Loan integrity (pure, testable)
//
// Rolls a loan's checklist, tasks, transaction-log completeness, rule-load
// state, and score into a single status with blockers, warnings, and the
// prioritized next actions the processing workspace + dashboard surface.
// ─────────────────────────────────────────────────────────────

import type { TransactionLogCompleteness } from "./transaction-log-integrity";

export const VALID_DOC_STATUSES = ["uploaded", "signed", "delivered"] as const;
export const INVALID_DOC_STATUSES = ["rejected", "expired", "deleted", "superseded", "failed", "quarantined"] as const;

export type LoanIntegrityStatus = "clean" | "needs_attention" | "blocked" | "critical";
export type ActionPriority = "low" | "normal" | "high" | "critical";

export interface IntegrityChecklistItem {
  documentType: string;
  displayName: string;
  isMandatory: boolean;
  pipelineStage?: string | null;
  uploaded?: boolean;
  status?: string | null; // uploaded document status
}

export interface IntegrityTask {
  status: string;
  due_at?: string | null;
}

export interface LoanIntegrityInput {
  loan: { id: string; status?: string | null; compliance_score?: number | null; closing_date?: string | null; property_state?: string | null };
  checklist: IntegrityChecklistItem[];
  tasks: IntegrityTask[];
  txLog: TransactionLogCompleteness;
  rulesLoaded: boolean;
  now?: Date;
}

export interface NextAction {
  label: string;
  href: string;
  priority: ActionPriority;
}

export interface LoanIntegrity {
  status: LoanIntegrityStatus;
  blockers: string[];
  warnings: string[];
  nextActions: NextAction[];
}

const isSatisfied = (i: IntegrityChecklistItem) =>
  !!i.uploaded && !!i.status && (VALID_DOC_STATUSES as readonly string[]).includes(i.status);
const isInvalid = (i: IntegrityChecklistItem) =>
  !!i.status && (INVALID_DOC_STATUSES as readonly string[]).includes(i.status);

export function deriveLoanIntegrity(input: LoanIntegrityInput): LoanIntegrity {
  const now = input.now ?? new Date();
  const href = `/loans/${input.loan.id}`;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nextActions: NextAction[] = [];
  let critical = false;

  // Rules not loaded for the loan's state.
  if (!input.rulesLoaded) {
    blockers.push(`Compliance rules are not loaded for ${input.loan.property_state || "the loan's state"}.`);
    nextActions.push({ label: "Load compliance rules", href: "/setup?step=rules", priority: "high" });
  }

  // Transaction-log completeness.
  if (input.txLog.missingFields.length > 0) {
    blockers.push(`Transaction log is missing ${input.txLog.missingFields.length} required field(s): ${input.txLog.missingFields.join(", ")}.`);
    nextActions.push({ label: "Complete transaction log fields", href, priority: "high" });
  }
  if (input.txLog.status === "overdue") {
    warnings.push("Transaction log entry is past the 7-day deadline.");
  }

  // Required documents.
  const mandatory = input.checklist.filter((i) => i.isMandatory);
  const missingDocs = mandatory.filter((i) => !isSatisfied(i));
  const invalidDocs = input.checklist.filter(isInvalid);
  if (missingDocs.length > 0) {
    warnings.push(`${missingDocs.length} required document(s) missing.`);
    nextActions.push({ label: `Upload ${missingDocs.length} required document(s)`, href, priority: "high" });
  }
  if (invalidDocs.length > 0) {
    critical = true;
    blockers.push(`${invalidDocs.length} uploaded document(s) have an invalid status (rejected/expired/etc.).`);
    nextActions.push({ label: "Replace invalid documents", href, priority: "critical" });
  }

  // Overdue tasks.
  const overdueTasks = input.tasks.filter((t) => ["open", "in_progress", "blocked"].includes(t.status) && t.due_at && new Date(t.due_at).getTime() < now.getTime());
  if (overdueTasks.length > 0) {
    warnings.push(`${overdueTasks.length} overdue task(s).`);
    nextActions.push({ label: "Resolve overdue tasks", href: `${href}?tab=tasks`, priority: "normal" });
  }

  // Closing approaching with missing closing-stage docs.
  if (input.loan.closing_date) {
    const days = Math.floor((new Date(input.loan.closing_date).getTime() - now.getTime()) / 86_400_000);
    const closingDocsMissing = mandatory.filter((i) => i.pipelineStage === "closing" && !isSatisfied(i));
    if (days >= 0 && days <= 14 && closingDocsMissing.length > 0) {
      critical = true;
      blockers.push(`Closing in ${days} day(s) with ${closingDocsMissing.length} closing document(s) outstanding.`);
      nextActions.push({ label: "Clear closing conditions", href, priority: "critical" });
    }
  }

  // Post-close files missing after closing.
  if (input.loan.status === "post_close") {
    const postCloseMissing = mandatory.filter((i) => i.pipelineStage === "post_close" && !isSatisfied(i));
    if (postCloseMissing.length > 0) {
      warnings.push(`${postCloseMissing.length} post-close document(s) missing.`);
      nextActions.push({ label: "Complete post-close file", href, priority: "normal" });
    }
  }

  // Compliance score thresholds.
  const score = input.loan.compliance_score ?? 0;
  if (score < 50) {
    critical = true;
    warnings.push(`Compliance score is critical (${score}%).`);
  } else if (score < 80) {
    warnings.push(`Compliance score is below passing (${score}%).`);
  }

  const status: LoanIntegrityStatus = critical
    ? "critical"
    : blockers.length > 0
      ? "blocked"
      : warnings.length > 0
        ? "needs_attention"
        : "clean";

  return { status, blockers, warnings, nextActions };
}
