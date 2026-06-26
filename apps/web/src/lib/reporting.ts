// ─────────────────────────────────────────────────────────────
// MortgageGuard — Reporting helpers (pure, testable)
//
// URL building, deadline summary → card mapping, status → badge mapping, and
// filing-form validation for the Reports page. Kept framework-free so it can be
// unit-tested without rendering React.
// ─────────────────────────────────────────────────────────────

import type { BadgeVariant } from "@/components/ui";

export interface ReportingSummary {
  total: number;
  upcoming: number;
  dueSoon: number;
  due: number;
  overdue: number;
  filed: number;
  notApplicable: number;
}

export interface Deadline {
  id: string;
  report_type: string;
  obligation_key?: string | null;
  jurisdiction?: string | null;
  state_code?: string | null;
  quarter: string | null;
  period_start?: string | null;
  period_end?: string | null;
  due_date: string;
  status: string;
  derived_status?: string | null;
  notes: string | null;
  confirmation_number?: string | null;
  filed_at?: string | null;
  evidence_file_path?: string | null;
}

export interface TransactionLogParams {
  jurisdiction?: string;
  from?: string;
  to?: string;
  format?: "csv" | "json";
}

// Build the transaction-log export URL. Empty/unset params are omitted so an
// unfiltered request stays clean.
export function buildTransactionLogUrl(params: TransactionLogParams): string {
  const qs = new URLSearchParams();
  if (params.jurisdiction) qs.set("jurisdiction", params.jurisdiction);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.format) qs.set("format", params.format);
  const s = qs.toString();
  return `/api/v1/reports/transaction-log${s ? `?${s}` : ""}`;
}

// Map a deadline's (derived) status to a badge variant.
export const DEADLINE_STATUS_VARIANT: Record<string, BadgeVariant> = {
  upcoming: "blue",
  due_soon: "amber",
  due: "amber",
  overdue: "red",
  filed: "green",
  not_applicable: "gray",
  // legacy stored statuses
  in_progress: "amber",
};

export function deadlineStatusVariant(status: string | null | undefined): BadgeVariant {
  return DEADLINE_STATUS_VARIANT[status || ""] || "gray";
}

// The effective status to display: prefer the server-derived status, fall back
// to the stored status.
export function effectiveStatus(d: Deadline): string {
  return d.derived_status || d.status;
}

// The period label for a deadline row (obligation-based period, else quarter).
export function periodLabel(d: Deadline): string {
  if (d.period_start && d.period_end) return `${d.period_start} → ${d.period_end}`;
  return d.quarter || "—";
}

export interface SummaryCard {
  key: keyof ReportingSummary;
  label: string;
  value: number;
  tone: "neutral" | "info" | "warn" | "danger" | "good";
}

// Map the summary into the dashboard cards shown above the deadline table.
export function deadlineSummaryCards(summary: ReportingSummary | null | undefined): SummaryCard[] {
  const s = summary ?? { total: 0, upcoming: 0, dueSoon: 0, due: 0, overdue: 0, filed: 0, notApplicable: 0 };
  return [
    { key: "total", label: "Total deadlines", value: s.total, tone: "neutral" },
    { key: "dueSoon", label: "Due soon", value: s.dueSoon + s.due, tone: "warn" },
    { key: "overdue", label: "Overdue", value: s.overdue, tone: "danger" },
    { key: "filed", label: "Filed", value: s.filed, tone: "good" },
    { key: "upcoming", label: "Upcoming", value: s.upcoming, tone: "info" },
  ];
}

export interface FilingInput {
  filedAt?: string;
  confirmationNumber?: string;
}

// A filing must carry evidence the report was actually submitted: either a
// confirmation/reference number or a filed date. Returns an error string when
// neither is present, otherwise null.
export function validateFiling(input: FilingInput): string | null {
  const hasConfirmation = Boolean(input.confirmationNumber && input.confirmationNumber.trim());
  const hasDate = Boolean(input.filedAt && input.filedAt.trim());
  if (!hasConfirmation && !hasDate) {
    return "Enter a confirmation number or a filed date to record this filing.";
  }
  return null;
}
