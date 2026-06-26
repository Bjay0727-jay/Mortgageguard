// ─────────────────────────────────────────────────────────────
// MortgageGuard — Compliance program integrity
//
// Pure status engine: given a program's document, evidence, source links and
// review dates, decide whether the company control is current/missing/etc.,
// and surface the blockers, warnings, and the single next action a user must
// take. Kept side-effect free so it can be unit-tested and reused by the
// list/detail endpoints and the dashboard.
// ─────────────────────────────────────────────────────────────

export type ComplianceProgramStatus =
  | "missing"
  | "incomplete"
  | "current"
  | "review_due"
  | "overdue"
  | "source_review_due"
  | "not_applicable"
  | "archived";

// A program's current document counts only when its status is one of these.
export const VALID_PROGRAM_DOC_STATUSES = ["uploaded", "current", "approved"] as const;
// These never satisfy a requirement, even if a row exists.
export const INVALID_PROGRAM_DOC_STATUSES = ["superseded", "rejected", "deleted", "expired", "failed", "quarantined"] as const;

// Verification states that mean the regulatory source needs attention.
const SOURCE_NEEDS_REVIEW = ["review_due", "changed", "retired", "unverified"];

export interface IntegrityEvidence {
  required: boolean;
  satisfied: boolean;
  notApplicable: boolean;
}

export interface IntegritySource {
  verificationStatus: string;
  nextVerificationDueAt?: string | null;
}

export interface IntegrityInput {
  isRequired: boolean;
  /** False → control does not apply (e.g. remote work disabled). */
  applicable: boolean;
  archived?: boolean;
  hasDocument: boolean;
  documentStatus?: string | null;
  owner?: string | null;
  lastReviewedAt?: string | null;
  nextReviewDue?: string | null;
  evidence?: IntegrityEvidence[];
  sources?: IntegritySource[];
  now?: Date;
}

export interface IntegrityResult {
  status: ComplianceProgramStatus;
  blockers: string[];
  warnings: string[];
  nextAction: string | null;
  satisfiedEvidence: number;
  requiredEvidence: number;
}

function isValidDoc(input: IntegrityInput): boolean {
  if (!input.hasDocument) return false;
  const s = (input.documentStatus || "").toLowerCase();
  // No explicit status but a document exists → treat as uploaded/valid.
  if (!s) return true;
  if ((INVALID_PROGRAM_DOC_STATUSES as readonly string[]).includes(s)) return false;
  return (VALID_PROGRAM_DOC_STATUSES as readonly string[]).includes(s);
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}

export function computeProgramStatus(input: IntegrityInput): IntegrityResult {
  const now = input.now ?? new Date();
  const blockers: string[] = [];
  const warnings: string[] = [];
  const evidence = input.evidence ?? [];
  const requiredEvidence = evidence.filter((e) => e.required && !e.notApplicable).length;
  const satisfiedEvidence = evidence.filter((e) => e.required && !e.notApplicable && e.satisfied).length;

  // 1. Not applicable / archived short-circuit.
  if (input.archived) {
    return { status: "archived", blockers, warnings, nextAction: null, satisfiedEvidence, requiredEvidence };
  }
  if (!input.applicable) {
    return { status: "not_applicable", blockers, warnings, nextAction: null, satisfiedEvidence, requiredEvidence };
  }

  const docValid = isValidDoc(input);
  if (input.hasDocument && !docValid) {
    warnings.push(`Current document status "${input.documentStatus}" is not an accepted status.`);
  }

  // 2. No valid current document → missing.
  if (!docValid) {
    blockers.push("Upload the required program document.");
    return {
      status: "missing",
      blockers,
      warnings,
      nextAction: "Upload the required program document.",
      satisfiedEvidence,
      requiredEvidence,
    };
  }

  // 3. Completeness checks (document present).
  if (!input.owner) blockers.push("Assign a program owner.");
  if (!input.lastReviewedAt) blockers.push("Record the last review date.");
  if (!input.nextReviewDue) blockers.push("Set the next review due date.");

  const unsatisfied = evidence.filter((e) => e.required && !e.notApplicable && !e.satisfied);
  if (unsatisfied.length > 0) {
    blockers.push(`Provide ${unsatisfied.length} required evidence item${unsatisfied.length === 1 ? "" : "s"}.`);
  }

  const sources = input.sources ?? [];
  if (sources.length === 0) {
    blockers.push("Link a regulatory source.");
  }

  if (blockers.length > 0) {
    return {
      status: "incomplete",
      blockers,
      warnings,
      nextAction: blockers[0],
      satisfiedEvidence,
      requiredEvidence,
    };
  }

  // 4. Review timing.
  if (input.nextReviewDue) {
    const due = new Date(input.nextReviewDue);
    if (due.getTime() < now.getTime()) {
      return {
        status: "overdue",
        blockers,
        warnings: [...warnings, "Program review is overdue."],
        nextAction: "Review and re-attest this program.",
        satisfiedEvidence,
        requiredEvidence,
      };
    }
  }

  // 5. Source verification timing.
  const sourceDue = sources.some((s) => {
    if (SOURCE_NEEDS_REVIEW.includes((s.verificationStatus || "").toLowerCase())) return true;
    if (s.nextVerificationDueAt) return new Date(s.nextVerificationDueAt).getTime() < now.getTime();
    return false;
  });
  if (sourceDue) {
    return {
      status: "source_review_due",
      blockers,
      warnings: [...warnings, "A linked regulatory source needs re-verification."],
      nextAction: "Verify the regulatory source.",
      satisfiedEvidence,
      requiredEvidence,
    };
  }

  // 6. Review due soon (within 30 days) but not yet overdue.
  if (input.nextReviewDue) {
    const due = new Date(input.nextReviewDue);
    if (daysBetween(now, due) <= 30) {
      return {
        status: "review_due",
        blockers,
        warnings,
        nextAction: "Schedule the upcoming program review.",
        satisfiedEvidence,
        requiredEvidence,
      };
    }
  }

  return { status: "current", blockers, warnings, nextAction: null, satisfiedEvidence, requiredEvidence };
}

// Display metadata for the eight program statuses.
export const PROGRAM_STATUS_META: Record<ComplianceProgramStatus, { label: string; tone: "green" | "amber" | "red" | "gray" }> = {
  current: { label: "Current", tone: "green" },
  review_due: { label: "Review due", tone: "amber" },
  source_review_due: { label: "Source review due", tone: "amber" },
  incomplete: { label: "Incomplete", tone: "amber" },
  overdue: { label: "Overdue", tone: "red" },
  missing: { label: "Missing", tone: "red" },
  not_applicable: { label: "Not applicable", tone: "gray" },
  archived: { label: "Archived", tone: "gray" },
};
