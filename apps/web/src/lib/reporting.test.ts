import { describe, it, expect } from "vitest";
import {
  buildTransactionLogUrl,
  deadlineStatusVariant,
  effectiveStatus,
  periodLabel,
  deadlineSummaryCards,
  validateFiling,
  type Deadline,
} from "./reporting";

describe("buildTransactionLogUrl", () => {
  it("omits unset params", () => {
    expect(buildTransactionLogUrl({})).toBe("/api/v1/reports/transaction-log");
  });
  it("encodes jurisdiction/from/to/format", () => {
    expect(buildTransactionLogUrl({ jurisdiction: "TX", from: "2026-01-01", to: "2026-03-31", format: "csv" }))
      .toBe("/api/v1/reports/transaction-log?jurisdiction=TX&from=2026-01-01&to=2026-03-31&format=csv");
  });
});

describe("deadlineStatusVariant", () => {
  it("maps derived statuses to badge variants", () => {
    expect(deadlineStatusVariant("overdue")).toBe("red");
    expect(deadlineStatusVariant("due_soon")).toBe("amber");
    expect(deadlineStatusVariant("due")).toBe("amber");
    expect(deadlineStatusVariant("filed")).toBe("green");
    expect(deadlineStatusVariant("upcoming")).toBe("blue");
    expect(deadlineStatusVariant("not_applicable")).toBe("gray");
    expect(deadlineStatusVariant(undefined)).toBe("gray");
  });
});

describe("effectiveStatus / periodLabel", () => {
  const base: Deadline = { id: "d1", report_type: "RMLA", quarter: "Q1-2026", due_date: "2026-05-15", status: "upcoming", notes: null };

  it("prefers derived status over stored status", () => {
    expect(effectiveStatus({ ...base, derived_status: "overdue" })).toBe("overdue");
    expect(effectiveStatus(base)).toBe("upcoming");
  });
  it("renders period from period_start/end, else quarter", () => {
    expect(periodLabel({ ...base, period_start: "2026-01-01", period_end: "2026-03-31" })).toBe("2026-01-01 → 2026-03-31");
    expect(periodLabel(base)).toBe("Q1-2026");
  });
});

describe("deadlineSummaryCards", () => {
  it("maps a summary into ordered cards and folds due into due-soon", () => {
    const cards = deadlineSummaryCards({ total: 12, upcoming: 5, dueSoon: 2, due: 1, overdue: 3, filed: 1, notApplicable: 0 });
    const byKey = Object.fromEntries(cards.map((c) => [c.key, c.value]));
    expect(byKey.total).toBe(12);
    expect(byKey.dueSoon).toBe(3); // dueSoon + due
    expect(byKey.overdue).toBe(3);
    expect(byKey.filed).toBe(1);
    expect(byKey.upcoming).toBe(5);
  });
  it("handles a missing summary", () => {
    expect(deadlineSummaryCards(null).every((c) => c.value === 0)).toBe(true);
  });
});

describe("validateFiling", () => {
  it("requires a confirmation number or a filed date", () => {
    expect(validateFiling({})).toMatch(/confirmation number or a filed date/);
    expect(validateFiling({ confirmationNumber: "  " })).toBeTruthy();
  });
  it("passes when either field is present", () => {
    expect(validateFiling({ confirmationNumber: "NMLS-1" })).toBeNull();
    expect(validateFiling({ filedAt: "2026-05-10" })).toBeNull();
  });
});
