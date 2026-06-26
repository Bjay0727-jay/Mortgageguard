// ─────────────────────────────────────────────────────────────
// MortgageGuard — Reporting deadline generation (pure, testable)
//
// The Texas SML guide requires quarterly Mortgage Call Reports (RMLA + the
// State-Specific Supplemental Form) due within 45 days of each calendar
// quarter end, and Financial Condition reporting whose cadence depends on the
// company's entity type (quarterly for lenders/servicers, annual for brokers).
//
// These helpers turn a calendar year + company entity type into the concrete
// deadlines we persist, and derive the at-a-glance status/summary the reports
// page and dashboard surface. They are pure so the route layer only gathers
// inputs and persists results. The architecture is jurisdiction-parameterized
// so additional states can be layered on later.
// ─────────────────────────────────────────────────────────────

export type ReportingDeadlineStatus =
  | "upcoming"
  | "due_soon"
  | "due"
  | "overdue"
  | "filed"
  | "not_applicable";

export type ReportingFrequency = "quarterly" | "annual";

export interface GeneratedDeadline {
  obligationKey: string;
  jurisdiction: string;
  frequency: ReportingFrequency;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;    // YYYY-MM-DD
  dueDate: string;      // YYYY-MM-DD
  quarter: string | null; // "Q1-2026" | "Annual-2026"
}

export interface DeadlineLike {
  status?: string | null;
  filed_at?: string | null;
  due_date?: string | null;
}

export interface ReportingSummary {
  total: number;
  upcoming: number;
  dueSoon: number;
  due: number;
  overdue: number;
  filed: number;
  notApplicable: number;
}

// Entity types that file Financial Condition quarterly (same cadence as RMLA).
export const QUARTERLY_FINANCIAL_ENTITY_TYPES = ["lender", "servicer", "broker_lender", "banker"];
// Entity types that file Financial Condition annually.
export const ANNUAL_FINANCIAL_ENTITY_TYPES = ["broker"];

// Fixed quarterly Mortgage Call Report due dates from the TX-SML guide: each is
// 45 days after the quarter's calendar end. Q4 is due Feb 14 of the FOLLOWING
// year, so the helper offsets the year for Q4.
const QUARTERS: Array<{ q: 1 | 2 | 3 | 4; startMonth: number; start: string; end: string; due: string; dueYearOffset: number }> = [
  { q: 1, startMonth: 1, start: "01-01", end: "03-31", due: "05-15", dueYearOffset: 0 },
  { q: 2, startMonth: 4, start: "04-01", end: "06-30", due: "08-14", dueYearOffset: 0 },
  { q: 3, startMonth: 7, start: "07-01", end: "09-30", due: "11-14", dueYearOffset: 0 },
  { q: 4, startMonth: 10, start: "10-01", end: "12-31", due: "02-14", dueYearOffset: 1 },
];

// RMLA / SSSF (and quarterly Financial Condition) all share the quarterly
// schedule, so this is the single source of truth for quarterly dates.
export function generateQuarterlyDeadlines(year: number, obligationKey: string, jurisdiction: string): GeneratedDeadline[] {
  return QUARTERS.map((qd) => ({
    obligationKey,
    jurisdiction,
    frequency: "quarterly" as const,
    periodStart: `${year}-${qd.start}`,
    periodEnd: `${year}-${qd.end}`,
    dueDate: `${year + qd.dueYearOffset}-${qd.due}`,
    quarter: `Q${qd.q}-${year}`,
  }));
}

// Financial Condition cadence depends on the company's entity type. Brokers
// file annually (due within 90 days of calendar year end → Mar 31 of the
// following year); lenders/servicers file quarterly.
export function generateFinancialConditionDeadlines(companyEntityType: string | null | undefined, year: number, jurisdiction: string): GeneratedDeadline[] {
  const entity = (companyEntityType || "").toLowerCase();
  if (ANNUAL_FINANCIAL_ENTITY_TYPES.includes(entity)) {
    return [
      {
        obligationKey: "financial_condition",
        jurisdiction,
        frequency: "annual",
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`,
        dueDate: `${year + 1}-03-31`, // within 90 days of calendar year end
        quarter: `Annual-${year}`,
      },
    ];
  }
  // Default to quarterly for lender/servicer/broker_lender (and unknown types,
  // which we treat as the stricter quarterly cadence).
  return generateQuarterlyDeadlines(year, "financial_condition", jurisdiction);
}

const DAY_MS = 86_400_000;
const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// Derive the live status of a single deadline. A filed deadline is always
// "filed" regardless of its due date; otherwise the due date relative to now
// (and the 30-day "due soon" window) decides upcoming/due_soon/due/overdue.
export function deriveDeadlineStatus(deadline: DeadlineLike, now: Date = new Date()): ReportingDeadlineStatus {
  if (deadline.status === "not_applicable") return "not_applicable";
  if (deadline.status === "filed" || deadline.filed_at) return "filed";
  if (!deadline.due_date) return "upcoming";

  const due = dateOnly(new Date(deadline.due_date)).getTime();
  const today = dateOnly(now).getTime();
  const daysUntil = Math.round((due - today) / DAY_MS);

  if (daysUntil < 0) return "overdue";
  if (daysUntil === 0) return "due";
  if (daysUntil <= 30) return "due_soon";
  return "upcoming";
}

// Roll a list of deadlines up into the dashboard/reports summary counts using
// the derived (not stored) status so the counts always reflect "now".
export function deriveReportingSummary(deadlines: DeadlineLike[], now: Date = new Date()): ReportingSummary {
  const summary: ReportingSummary = { total: 0, upcoming: 0, dueSoon: 0, due: 0, overdue: 0, filed: 0, notApplicable: 0 };
  for (const d of deadlines) {
    summary.total++;
    switch (deriveDeadlineStatus(d, now)) {
      case "upcoming": summary.upcoming++; break;
      case "due_soon": summary.dueSoon++; break;
      case "due": summary.due++; break;
      case "overdue": summary.overdue++; break;
      case "filed": summary.filed++; break;
      case "not_applicable": summary.notApplicable++; break;
    }
  }
  return summary;
}
