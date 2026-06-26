import { describe, it, expect } from "vitest";
import {
  REQUIRED_COMPLIANCE_PROGRAMS,
  RECOMMENDED_COMPLIANCE_PROGRAMS,
  REGULATORY_SOURCES,
  PROGRAM_SOURCE_LINKS,
  PROGRAM_EVIDENCE_REQUIREMENTS,
  PROGRAM_DOCUMENT_REQUIREMENTS,
  getProgramDef,
} from "./compliance-catalog";

describe("required program catalog", () => {
  it("includes the five required company programs", () => {
    const keys = REQUIRED_COMPLIANCE_PROGRAMS.map((p) => p.programKey);
    expect(keys).toEqual([
      "aml_program",
      "red_flags_program",
      "information_security_program",
      "lo_lender_compensation_agreements",
      "remote_work_policy",
    ]);
  });

  it("uses the full Loan Originator and Lender Compensation Agreements name", () => {
    const lo = getProgramDef("lo_lender_compensation_agreements");
    expect(lo?.name).toBe("Loan Originator and Lender Compensation Agreements");
    expect(lo?.name).not.toMatch(/LO Compensation/);
  });

  it("marks remote work as conditionally required", () => {
    const rw = getProgramDef("remote_work_policy");
    expect(rw?.isConditionallyRequired).toBe(true);
    expect(rw?.requiredIf).toContain("allows_remote_work");
  });

  it("exposes five recommended (non-required) programs", () => {
    expect(RECOMMENDED_COMPLIANCE_PROGRAMS).toHaveLength(5);
    expect(RECOMMENDED_COMPLIANCE_PROGRAMS.every((p) => p.isRequired === false)).toBe(true);
  });
});

describe("regulatory sources + links", () => {
  it("every program sourceKey resolves to a seeded source", () => {
    const sourceKeys = new Set(REGULATORY_SOURCES.map((s) => s.sourceKey));
    for (const p of REQUIRED_COMPLIANCE_PROGRAMS) {
      for (const key of p.sourceKeys) expect(sourceKeys.has(key)).toBe(true);
    }
  });

  it("derives a program/source link for every required program source", () => {
    const expected = REQUIRED_COMPLIANCE_PROGRAMS.reduce((n, p) => n + p.sourceKeys.length, 0);
    expect(PROGRAM_SOURCE_LINKS).toHaveLength(expected);
    // first link of each program is the binding rule
    const aml = PROGRAM_SOURCE_LINKS.filter((l) => l.programKey === "aml_program");
    expect(aml[0].appliesTo).toBe("program");
  });

  it("links remote work to the state-specific source and the safeguards rule", () => {
    const rw = PROGRAM_SOURCE_LINKS.filter((l) => l.programKey === "remote_work_policy").map((l) => l.sourceKey);
    expect(rw).toContain("remote_work_state_specific");
    expect(rw).toContain("safeguards_16_cfr_part_314");
  });
});

describe("evidence + document requirements", () => {
  it("seeds AML evidence keys", () => {
    const aml = PROGRAM_EVIDENCE_REQUIREMENTS.filter((e) => e.programKey === "aml_program").map((e) => e.evidenceKey);
    expect(aml).toContain("aml_policy_document");
    expect(aml).toContain("independent_testing");
  });

  it("has a document requirement for every catalog program", () => {
    const docKeys = new Set(PROGRAM_DOCUMENT_REQUIREMENTS.map((d) => d.programKey));
    for (const p of [...REQUIRED_COMPLIANCE_PROGRAMS, ...RECOMMENDED_COMPLIANCE_PROGRAMS]) {
      expect(docKeys.has(p.programKey)).toBe(true);
    }
  });
});
