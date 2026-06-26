import { describe, it, expect } from "vitest";
import { buildSetupStatus, type SetupInputs } from "./setup-status";
import { computeRulesStatus } from "./rules-status";

const loadedRules = computeRulesStatus({ state: "TX", stateRulesCount: 25, activeRulesCount: 25, requiredDocumentsCount: 22, stateSpecificActiveRulesCount: 16, stateSpecificRequiredDocumentsCount: 6, reportingDeadlinesCount: 2 });
const noRules = computeRulesStatus({ state: "TX", stateRulesCount: 0, activeRulesCount: 0, requiredDocumentsCount: 0, stateSpecificActiveRulesCount: 0, stateSpecificRequiredDocumentsCount: 0, reportingDeadlinesCount: 0 });
// Federal-only: combined counts are non-zero but TX-specific subset is empty → not loaded.
const federalOnly = computeRulesStatus({ state: "TX", stateRulesCount: 9, activeRulesCount: 9, requiredDocumentsCount: 17, stateSpecificActiveRulesCount: 0, stateSpecificRequiredDocumentsCount: 0, reportingDeadlinesCount: 0 });

function base(overrides: Partial<SetupInputs> = {}): SetupInputs {
  return {
    companyId: "company-1",
    user: { mustChangePassword: false, isSeededAdmin: false },
    company: {
      name: "Acme Mortgage", nmlsId: "123456", entityType: "broker",
      primaryContact: "Jane Doe", primaryEmail: "jane@acme.com",
      address: "1 Main St", licenseStates: ["TX"], allowsRemoteWork: false,
    },
    rules: loadedRules,
    loanCount: 1,
    programsAvailable: true,
    programs: { requiredTotal: 4, requiredCurrent: 4, requiredNeedsWork: 0, overdue: 0 },
    invites: { activeUsersCount: 2, pendingInvitesCount: 0, acceptedInvitesCount: 1, expiredInvitesCount: 0 },
    los: { connectedLosCount: 0, healthyLosCount: 0 },
    ...overrides,
  };
}

function step(status: ReturnType<typeof buildSetupStatus>, key: string) {
  return status.steps.find((s) => s.key === key)!;
}

describe("buildSetupStatus", () => {
  it("returns all seven setup steps", () => {
    const s = buildSetupStatus(base());
    expect(s.steps.map((x) => x.key)).toEqual([
      "change_default_admin_password",
      "confirm_company_profile",
      "load_texas_compliance_rules",
      "create_first_loan",
      "upload_required_compliance_program_documents",
      "invite_team_members",
      "connect_los_integration",
    ]);
  });

  it("computes progress over required steps", () => {
    const s = buildSetupStatus(base());
    // all 6 required complete (LOS optional excluded)
    expect(s.progress).toEqual({ completed: 6, total: 6, percent: 100 });
    expect(s.coreSetupComplete).toBe(true);
    // setupComplete is stricter — includes optional LOS which is not connected
    expect(s.setupComplete).toBe(false);
  });

  it("password step is incomplete/blocked when must_change_password is true", () => {
    const s = buildSetupStatus(base({ user: { mustChangePassword: true, isSeededAdmin: true } }));
    expect(step(s, "change_default_admin_password").complete).toBe(false);
    expect(step(s, "change_default_admin_password").status).toBe("blocked");
  });

  it("password step completes when must_change_password is false", () => {
    expect(step(buildSetupStatus(base()), "change_default_admin_password").complete).toBe(true);
  });

  it("company profile is incomplete when required fields are missing", () => {
    const s = buildSetupStatus(base({ company: { ...base().company, nmlsId: null } }));
    expect(step(s, "confirm_company_profile").complete).toBe(false);
  });

  it("company profile requires allows_remote_work to be explicitly confirmed", () => {
    const s = buildSetupStatus(base({ company: { ...base().company, allowsRemoteWork: null } }));
    expect(step(s, "confirm_company_profile").complete).toBe(false);
    // explicit false counts as confirmed
    const s2 = buildSetupStatus(base({ company: { ...base().company, allowsRemoteWork: false } }));
    expect(step(s2, "confirm_company_profile").complete).toBe(true);
  });

  it("texas rules step reflects rule presence", () => {
    expect(step(buildSetupStatus(base({ rules: noRules })), "load_texas_compliance_rules").complete).toBe(false);
    expect(step(buildSetupStatus(base()), "load_texas_compliance_rules").complete).toBe(true);
  });

  it("first loan step completes when the company has a loan", () => {
    expect(step(buildSetupStatus(base({ loanCount: 0 })), "create_first_loan").complete).toBe(false);
    expect(step(buildSetupStatus(base({ loanCount: 3 })), "create_first_loan").complete).toBe(true);
  });

  it("programs step is incomplete when required programs need work or are unavailable", () => {
    expect(step(buildSetupStatus(base({ programsAvailable: false, programs: { requiredTotal: 0, requiredCurrent: 0, requiredNeedsWork: 0, overdue: 0 } })), "upload_required_compliance_program_documents").complete).toBe(false);
    expect(step(buildSetupStatus(base({ programs: { requiredTotal: 4, requiredCurrent: 2, requiredNeedsWork: 2, overdue: 0 } })), "upload_required_compliance_program_documents").complete).toBe(false);
  });

  it("programs step completes when required program integrity is current", () => {
    expect(step(buildSetupStatus(base()), "upload_required_compliance_program_documents").complete).toBe(true);
  });

  it("invite step completes with an accepted invite or more than one active user", () => {
    expect(step(buildSetupStatus(base({ invites: { activeUsersCount: 1, pendingInvitesCount: 0, acceptedInvitesCount: 0, expiredInvitesCount: 0 } })), "invite_team_members").complete).toBe(false);
    expect(step(buildSetupStatus(base({ invites: { activeUsersCount: 1, pendingInvitesCount: 0, acceptedInvitesCount: 1, expiredInvitesCount: 0 } })), "invite_team_members").complete).toBe(true);
    // pending-only → warning
    const warn = step(buildSetupStatus(base({ invites: { activeUsersCount: 1, pendingInvitesCount: 2, acceptedInvitesCount: 0, expiredInvitesCount: 0 } })), "invite_team_members");
    expect(warn.complete).toBe(false);
    expect(warn.status).toBe("warning");
  });

  it("LOS step is optional by default", () => {
    const los = step(buildSetupStatus(base()), "connect_los_integration");
    expect(los.required).toBe(false);
    expect(los.status).toBe("optional");
  });

  it("generates a critical default-admin warning and a rules warning", () => {
    const s = buildSetupStatus(base({ user: { mustChangePassword: true, isSeededAdmin: true }, rules: noRules }));
    const keys = s.warnings.map((w) => w.key);
    expect(keys).toContain("default_admin_password");
    expect(s.warnings.find((w) => w.key === "default_admin_password")!.severity).toBe("critical");
    expect(keys).toContain("texas_rules_missing");
  });
});

describe("computeRulesStatus", () => {
  it("is not loaded with zero rules and lists blockers", () => {
    expect(noRules.loaded).toBe(false);
    expect(noRules.blockers.length).toBeGreaterThan(0);
  });
  it("is loaded when rules + active + required docs exist", () => {
    expect(loadedRules.loaded).toBe(true);
    expect(loadedRules.blockers).toHaveLength(0);
  });
  it("is NOT loaded when only federal rows exist (no state-specific rules/docs)", () => {
    expect(federalOnly.loaded).toBe(false);
    expect(federalOnly.blockers.join(" ")).toMatch(/TX-specific/);
  });
});
