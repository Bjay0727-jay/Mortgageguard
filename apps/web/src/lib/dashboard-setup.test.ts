import { describe, it, expect } from "vitest";
import { hasProgramSetup, deriveTopActions } from "./dashboard-setup";

describe("hasProgramSetup (integrity-based)", () => {
  it("is incomplete while any required program is missing/incomplete/overdue", () => {
    expect(hasProgramSetup([{ status: "current", count: 3 }, { status: "missing", count: 2 }])).toBe(false);
    expect(hasProgramSetup([{ status: "current", count: 1 }, { status: "incomplete", count: 1 }])).toBe(false);
    expect(hasProgramSetup([{ status: "current", count: 1 }, { status: "source_review_due", count: 1 }])).toBe(false);
  });

  it("is complete only when at least one program is current and none need work", () => {
    expect(hasProgramSetup([{ status: "current", count: 4 }, { status: "not_applicable", count: 1 }])).toBe(true);
  });

  it("is incomplete when there are no programs at all", () => {
    expect(hasProgramSetup([])).toBe(false);
  });
});

describe("deriveTopActions includes program integrity actions", () => {
  const actions = deriveTopActions({
    attentionLoans: [],
    programs: [
      { status: "missing", count: 2 },
      { status: "incomplete", count: 1 },
      { status: "source_review_due", count: 3 },
      { status: "overdue", count: 1 },
    ],
    upcomingDeadlines: [],
    passingLoans: 0,
  });
  const byId = Object.fromEntries(actions.map((a) => [a.id, a]));

  it("surfaces a source-verification-due action", () => {
    expect(byId["verify-sources"]).toBeTruthy();
    expect(byId["verify-sources"].count).toBe(3);
  });

  it("surfaces program completion (missing + incomplete) and overdue reviews", () => {
    expect(byId["complete-programs"].count).toBe(3);
    expect(byId["overdue-programs"].count).toBe(1);
  });
});
