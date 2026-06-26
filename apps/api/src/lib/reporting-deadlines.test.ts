import { describe, it, expect } from "vitest";
import {
  generateQuarterlyDeadlines,
  generateFinancialConditionDeadlines,
  deriveDeadlineStatus,
  deriveReportingSummary,
} from "./reporting-deadlines";

const find = (ds: { quarter: string | null }[], quarter: string) => ds.find((d) => d.quarter === quarter)!;

describe("generateQuarterlyDeadlines (RMLA/SSSF)", () => {
  const rmla = generateQuarterlyDeadlines(2026, "rmla", "TX");

  it("RMLA Q1 is due May 15", () => {
    expect(find(rmla, "Q1-2026")).toMatchObject({ periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-05-15" });
  });
  it("RMLA Q2 is due August 14", () => {
    expect(find(rmla, "Q2-2026")).toMatchObject({ periodStart: "2026-04-01", periodEnd: "2026-06-30", dueDate: "2026-08-14" });
  });
  it("RMLA Q3 is due November 14", () => {
    expect(find(rmla, "Q3-2026")).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-09-30", dueDate: "2026-11-14" });
  });
  it("RMLA Q4 is due February 14 of the following year", () => {
    expect(find(rmla, "Q4-2026")).toMatchObject({ periodStart: "2026-10-01", periodEnd: "2026-12-31", dueDate: "2027-02-14" });
  });
  it("SSSF uses the same quarterly deadlines", () => {
    const sssf = generateQuarterlyDeadlines(2026, "sssf", "TX");
    expect(sssf.map((d) => d.dueDate)).toEqual(["2026-05-15", "2026-08-14", "2026-11-14", "2027-02-14"]);
    expect(sssf.every((d) => d.obligationKey === "sssf")).toBe(true);
  });
});

describe("generateFinancialConditionDeadlines", () => {
  it("is quarterly for a lender", () => {
    const ds = generateFinancialConditionDeadlines("lender", 2026, "TX");
    expect(ds).toHaveLength(4);
    expect(ds.every((d) => d.frequency === "quarterly" && d.obligationKey === "financial_condition")).toBe(true);
  });
  it("is quarterly for a servicer", () => {
    const ds = generateFinancialConditionDeadlines("servicer", 2026, "TX");
    expect(ds).toHaveLength(4);
    expect(ds[0].dueDate).toBe("2026-05-15");
  });
  it("is quarterly for a broker_lender", () => {
    const ds = generateFinancialConditionDeadlines("broker_lender", 2026, "TX");
    expect(ds).toHaveLength(4);
    expect(ds.every((d) => d.frequency === "quarterly")).toBe(true);
  });
  it("is annual for a broker (due Mar 31 of following year)", () => {
    const ds = generateFinancialConditionDeadlines("broker", 2026, "TX");
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ frequency: "annual", periodStart: "2026-01-01", periodEnd: "2026-12-31", dueDate: "2027-03-31", quarter: "Annual-2026" });
  });
});

describe("deriveDeadlineStatus", () => {
  const now = new Date("2026-05-01T12:00:00Z");

  it("derives due_soon within the 30-day window", () => {
    expect(deriveDeadlineStatus({ due_date: "2026-05-15", status: "upcoming" }, now)).toBe("due_soon");
  });
  it("derives due on the due date", () => {
    expect(deriveDeadlineStatus({ due_date: "2026-05-01", status: "upcoming" }, now)).toBe("due");
  });
  it("derives overdue once the due date has passed", () => {
    expect(deriveDeadlineStatus({ due_date: "2026-04-15", status: "upcoming" }, now)).toBe("overdue");
  });
  it("derives upcoming beyond the 30-day window", () => {
    expect(deriveDeadlineStatus({ due_date: "2026-08-14", status: "upcoming" }, now)).toBe("upcoming");
  });
  it("filed overrides due/overdue", () => {
    expect(deriveDeadlineStatus({ due_date: "2026-04-15", status: "filed" }, now)).toBe("filed");
    expect(deriveDeadlineStatus({ due_date: "2026-04-15", status: "upcoming", filed_at: "2026-04-10" }, now)).toBe("filed");
  });
});

describe("deriveReportingSummary", () => {
  it("rolls deadlines up into summary counts using derived status", () => {
    const now = new Date("2026-05-01T12:00:00Z");
    const summary = deriveReportingSummary(
      [
        { due_date: "2026-04-15", status: "upcoming" }, // overdue
        { due_date: "2026-05-15", status: "upcoming" }, // due_soon
        { due_date: "2026-05-01", status: "upcoming" }, // due
        { due_date: "2026-08-14", status: "upcoming" }, // upcoming
        { due_date: "2026-04-15", status: "filed" },    // filed
        { status: "not_applicable" },                    // n/a
      ],
      now,
    );
    expect(summary).toEqual({ total: 6, upcoming: 1, dueSoon: 1, due: 1, overdue: 1, filed: 1, notApplicable: 1 });
  });
});
