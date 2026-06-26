import { describe, it, expect } from "vitest";
import { hasProgramSetup, deriveTopActions, setupStepsToChecklist, type BackendSetupStep } from "./dashboard-setup";

describe("setupStepsToChecklist", () => {
  const steps: BackendSetupStep[] = [
    { key: "change_default_admin_password", title: "Change default admin password", description: "Protect the seeded admin.", complete: false, required: true, status: "blocked", actionLabel: "Change Password", actionHref: "/change-password" },
    { key: "load_texas_compliance_rules", title: "Load Texas compliance rules", description: "Rules power checklists.", complete: true, required: true, status: "complete", actionLabel: "Load Texas Rules", actionHref: "/setup?step=rules" },
  ];

  it("maps backend steps to dashboard checklist items with icons + CTA hrefs", () => {
    const items = setupStepsToChecklist(steps);
    expect(items[0]).toMatchObject({ id: "change_default_admin_password", title: "Change default admin password", complete: false, cta: "Change Password", href: "/change-password" });
    expect(items[0].icon).toBeTruthy();
    expect(items[1]).toMatchObject({ complete: true, href: "/setup?step=rules" });
  });
});

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
