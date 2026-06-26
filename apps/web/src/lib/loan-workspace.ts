// ─────────────────────────────────────────────────────────────
// MortgageGuard — Loan workspace helpers (pure, testable)
//
// Tab parsing, checklist/task/document filtering, transaction-log field
// derivation, stage-gate readiness splitting, note validation, timeline event
// labelling, and overview next-action → tab mapping. Framework-free so the
// workspace UI stays thin and all the operational logic is unit-tested.
// ─────────────────────────────────────────────────────────────

import type { BadgeVariant } from "@/components/ui";

export const VALID_DOC_STATUSES = ["uploaded", "signed", "delivered"];
export const INVALID_DOC_STATUSES = ["rejected", "expired", "deleted", "superseded", "failed", "quarantined"];

// ── Tabs ──
export type WorkspaceTab = "overview" | "checklist" | "documents" | "tasks" | "transaction-log" | "stage-gate" | "notes" | "timeline";

export const WORKSPACE_TABS: { id: WorkspaceTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "checklist", label: "Checklist" },
  { id: "documents", label: "Documents" },
  { id: "tasks", label: "Tasks" },
  { id: "transaction-log", label: "Transaction Log" },
  { id: "stage-gate", label: "Stage Gate" },
  { id: "notes", label: "Notes" },
  { id: "timeline", label: "Timeline" },
];

export function parseTab(param: string | null | undefined): WorkspaceTab {
  const found = WORKSPACE_TABS.find((t) => t.id === param);
  return found ? found.id : "overview";
}

// ── Checklist ──
export interface ChecklistRow {
  documentType: string;
  displayName: string;
  isMandatory: boolean;
  source: string; // federal | state | company
  pipelineStage: string | null;
  uploaded: boolean;
  status: string | null;        // checklist row status
  uploadStatus: string | null;  // uploaded document status
}

export type ChecklistRowState = "uploaded" | "missing" | "invalid" | "not_applicable";

// The effective state of a checklist row. Invalid documents never count as
// satisfied; only VALID_DOC_STATUSES on an uploaded doc do.
export function checklistRowState(item: ChecklistRow): ChecklistRowState {
  if (item.status === "na" || item.status === "not_applicable") return "not_applicable";
  if (item.uploadStatus && INVALID_DOC_STATUSES.includes(item.uploadStatus)) return "invalid";
  if (item.uploaded && item.uploadStatus && VALID_DOC_STATUSES.includes(item.uploadStatus)) return "uploaded";
  return "missing";
}

export type ChecklistFilter = "all" | "missing" | "required" | "uploaded" | "invalid" | "not_applicable" | "current_stage" | "federal" | "state";

export function filterChecklist<T extends ChecklistRow>(items: T[], filter: ChecklistFilter, search: string, currentStage?: string | null): T[] {
  const q = search.trim().toLowerCase();
  return items.filter((item) => {
    if (q && !`${item.displayName} ${item.documentType}`.toLowerCase().includes(q)) return false;
    const stateOf = checklistRowState(item);
    switch (filter) {
      case "all": return true;
      case "missing": return stateOf === "missing";
      case "required": return item.isMandatory;
      case "uploaded": return stateOf === "uploaded";
      case "invalid": return stateOf === "invalid";
      case "not_applicable": return stateOf === "not_applicable";
      case "current_stage": return !!currentStage && item.pipelineStage === currentStage;
      case "federal": return item.source === "federal";
      case "state": return item.source === "state";
    }
  });
}

// ── Tasks ──
export const TASK_STATUSES = ["open", "in_progress", "blocked", "complete", "canceled"] as const;
export const TASK_TYPES = ["missing_document", "compliance_review", "borrower_follow_up", "lender_follow_up", "disclosure_delivery", "closing_condition", "post_close_review", "transaction_log_gap", "rules_not_loaded", "custom"] as const;
const OPEN_TASK_STATUSES = ["open", "in_progress", "blocked"];

export interface TaskRow {
  status: string;
  auto_key: string | null;
  due_at: string | null;
}

export type TaskFilter = "all" | "open" | "overdue" | "auto" | "manual" | "complete";

export function isTaskOverdue(task: TaskRow, now: Date = new Date()): boolean {
  return OPEN_TASK_STATUSES.includes(task.status) && !!task.due_at && new Date(task.due_at).getTime() < now.getTime();
}

export function filterTasks<T extends TaskRow>(tasks: T[], filter: TaskFilter, now: Date = new Date()): T[] {
  return tasks.filter((t) => {
    switch (filter) {
      case "all": return true;
      case "open": return OPEN_TASK_STATUSES.includes(t.status);
      case "overdue": return isTaskOverdue(t, now);
      case "auto": return !!t.auto_key;
      case "manual": return !t.auto_key;
      case "complete": return t.status === "complete";
    }
  });
}

// ── Transaction log fields ──
export interface TxLogLoanLike {
  loan_number?: string | null;
  borrower_first_name?: string | null;
  borrower_last_name?: string | null;
  application_date?: string | null;
  property_address?: string | null;
  property_city?: string | null;
  property_state?: string | null;
  property_zip?: string | null;
  interest_rate?: string | number | null;
  loan_purpose?: string | null;
  texas_cashout_type?: string | null;
  loan_product?: string | null;
  loan_type?: string | null;
  loan_term?: number | null;
  lien_position?: string | null;
  occupancy_type?: string | null;
  status?: string | null;
  closing_date?: string | null;
  loan_originator_name?: string | null;
  originator_nmls_id?: string | null;
  lender_name?: string | null;
  lender_nmls_id?: string | null;
}

export interface TxLogField {
  key: string;
  label: string;
  value: string;
  present: boolean;
  conditional?: boolean;
}

function texasCashOutLabel(raw: unknown): string {
  const v = String(raw ?? "").toLowerCase();
  if (v.includes("50a6") || v === "home_equity_50a6") return "50(a)(6)";
  if (v.includes("50f2")) return "50(f)(2)";
  return "";
}

const present = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

// The ordered Texas transaction-log fields for the workspace tab.
export function deriveTxLogFields(loan: TxLogLoanLike): TxLogField[] {
  const applicant = [loan.borrower_last_name, loan.borrower_first_name].filter(Boolean).join(", ");
  const cashOut = texasCashOutLabel(loan.texas_cashout_type);
  const raw: Array<{ key: string; label: string; value: unknown; conditional?: boolean }> = [
    { key: "loanNumber", label: "Loan number", value: loan.loan_number },
    { key: "applicantName", label: "Applicant name", value: applicant },
    { key: "applicationDate", label: "Date of initial application", value: loan.application_date },
    { key: "propertyStreet", label: "Property street", value: loan.property_address },
    { key: "propertyCity", label: "Property city", value: loan.property_city },
    { key: "propertyState", label: "Property state", value: loan.property_state },
    { key: "propertyZip", label: "Property ZIP", value: loan.property_zip },
    { key: "interestRate", label: "Interest rate", value: loan.interest_rate },
    { key: "loanPurpose", label: "Loan purpose", value: loan.loan_purpose },
    { key: "texasCashOut", label: "Texas cash-out classification", value: cashOut, conditional: true },
    { key: "loanProduct", label: "Loan product", value: loan.loan_product },
    { key: "loanType", label: "Loan type", value: loan.loan_type },
    { key: "loanTerm", label: "Loan term", value: loan.loan_term },
    { key: "lienPosition", label: "Lien position", value: loan.lien_position },
    { key: "occupancyType", label: "Occupancy type", value: loan.occupancy_type },
    { key: "status", label: "Status", value: loan.status },
    { key: "closingDate", label: "Closing date", value: loan.closing_date },
    { key: "originatorName", label: "Loan originator name", value: loan.loan_originator_name },
    { key: "originatorNmls", label: "Loan originator NMLS ID", value: loan.originator_nmls_id },
    { key: "lender", label: "Lender", value: loan.lender_name },
    { key: "lenderNmls", label: "Lender NMLS ID", value: loan.lender_nmls_id },
  ];
  return raw.map((f) => ({ key: f.key, label: f.label, value: present(f.value) ? String(f.value) : "", present: present(f.value), conditional: f.conditional }));
}

export function txLogMissingFields(loan: TxLogLoanLike): TxLogField[] {
  // Conditional fields (cash-out) are not counted as "missing" when empty.
  return deriveTxLogFields(loan).filter((f) => !f.present && !f.conditional);
}

// ── Stage gate ──
export interface GateLike {
  canAdvance: boolean;
  transitionValid?: boolean;
  blockers?: string[];
  warnings?: string[];
  unsatisfied?: { documentType: string; displayName: string }[];
}

export interface GateReadinessSplit {
  blockers: string[];
  warnings: string[];
  unsatisfied: { documentType: string; displayName: string }[];
  invalidTransition: boolean;
  canOverride: boolean;
}

// Split a gate review into blockers vs warnings, and decide whether an override
// is allowed. Invalid transitions are never overrideable.
export function splitGateReadiness(gate: GateLike): GateReadinessSplit {
  const invalidTransition = gate.transitionValid === false;
  return {
    blockers: gate.blockers ?? [],
    warnings: gate.warnings ?? [],
    unsatisfied: gate.unsatisfied ?? [],
    invalidTransition,
    canOverride: !gate.canAdvance && !invalidTransition,
  };
}

// ── Notes ──
export function validateNote(body: string | null | undefined): string | null {
  if (!body || !body.trim()) return "A note cannot be empty.";
  if (body.length > 5000) return "Notes are limited to 5000 characters.";
  return null;
}

// ── Timeline ──
export const TIMELINE_EVENT_LABELS: Record<string, string> = {
  loan_created: "Loan created",
  loan_updated: "Loan updated",
  rules_resolved: "Rules resolved",
  checklist_generated: "Checklist generated",
  checklist_changed: "Checklist changed",
  document_uploaded: "Document uploaded",
  document_replaced: "Document replaced",
  task_created: "Task created",
  task_updated: "Task updated",
  task_completed: "Task completed",
  stage_advanced: "Stage advanced",
  stage_override: "Stage overridden",
  note_created: "Note added",
  note_updated: "Note updated",
  note_deleted: "Note deleted",
  evidence_packet_generated: "Evidence packet generated",
};

export function timelineEventLabel(eventType: string): string {
  return TIMELINE_EVENT_LABELS[eventType] || eventType.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

export type TimelineCategory = "all" | "loan" | "documents" | "tasks" | "stage" | "notes" | "evidence-packets" | "audit";

export function timelineCategory(eventType: string): TimelineCategory {
  if (eventType.includes("document")) return "documents";
  if (eventType.includes("task")) return "tasks";
  if (eventType.includes("stage")) return "stage";
  if (eventType.includes("note")) return "notes";
  if (eventType.includes("evidence_packet")) return "evidence-packets";
  if (eventType.includes("checklist") || eventType.includes("rules") || eventType === "loan_updated") return "audit";
  return "loan";
}

// ── Overview next-action → tab routing ──
// Map an integrity next-action (label + href) to the workspace tab that resolves
// it, so Overview action chips deep-link to the right tab.
export function nextActionTab(action: { label: string; href?: string }): WorkspaceTab {
  const href = action.href || "";
  const tabMatch = href.match(/[?&]tab=([\w-]+)/);
  if (tabMatch) return parseTab(tabMatch[1]);
  const l = action.label.toLowerCase();
  if (l.includes("task")) return "tasks";
  if (l.includes("transaction log")) return "transaction-log";
  if (l.includes("rule")) return "overview";
  if (l.includes("closing") || l.includes("gate") || l.includes("advance")) return "stage-gate";
  if (l.includes("document") || l.includes("upload") || l.includes("replace")) return "checklist";
  return "overview";
}

export const NOTE_TYPE_VARIANT: Record<string, BadgeVariant> = {
  general: "gray",
  borrower_follow_up: "blue",
  lender_follow_up: "blue",
  processor_note: "amber",
  compliance_note: "royal",
  condition_note: "red",
};
