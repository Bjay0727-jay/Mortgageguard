import { describe, expect, it } from "vitest";
import { CAPABILITIES, hasCapability, ROLE_CAPABILITIES, USER_ROLES } from "./index";

describe("role capabilities", () => {
  it("gives company_admin every capability", () => {
    expect(ROLE_CAPABILITIES.company_admin).toEqual(CAPABILITIES);
  });

  it("keeps read_only truly read-only", () => {
    expect(hasCapability("read_only", "viewLoans")).toBe(true);
    expect(hasCapability("read_only", "createLoan")).toBe(false);
    expect(hasCapability("read_only", "uploadLoanDocument")).toBe(false);
    expect(hasCapability("read_only", "manageIntegrations")).toBe(false);
    expect(hasCapability("read_only", "manageUsers")).toBe(false);
    expect(hasCapability("read_only", "manageInvites")).toBe(false);
  });

  it("matches expected access for each role", () => {
    const cases = [
      ["loan_originator", "createLoan", true],
      ["loan_originator", "manageCompliancePrograms", false],
      ["loan_originator", "manageIntegrations", false],
      ["processor", "uploadLoanDocument", true],
      ["processor", "manageIntegrations", false],
      ["compliance_officer", "manageCompliancePrograms", true],
      ["compliance_officer", "manageReportDeadlines", true],
      ["compliance_officer", "manageUsers", false],
      ["qualifying_individual", "overrideCompliance", true],
    ] as const;

    for (const [role, capability, expected] of cases) {
      expect(hasCapability(role, capability)).toBe(expected);
    }
  });

  it("defines capabilities for every role", () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual([...USER_ROLES].sort());
  });
});
