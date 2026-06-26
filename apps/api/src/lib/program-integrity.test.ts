import { describe, it, expect } from "vitest";
import { computeProgramStatus, type IntegrityInput } from "./program-integrity";

const SOON = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
const PAST = "2020-01-01";
const verifiedSource = { verificationStatus: "verified", nextVerificationDueAt: new Date(Date.now() + 365 * 86_400_000).toISOString() };

function base(overrides: Partial<IntegrityInput> = {}): IntegrityInput {
  return {
    isRequired: true,
    applicable: true,
    hasDocument: true,
    documentStatus: "current",
    owner: "Jane Compliance",
    lastReviewedAt: "2025-01-01",
    nextReviewDue: SOON,
    evidence: [{ required: true, satisfied: true, notApplicable: false }],
    sources: [verifiedSource],
    ...overrides,
  };
}

describe("computeProgramStatus", () => {
  it("returns current when document, evidence, source and dates are all good", () => {
    expect(computeProgramStatus(base()).status).toBe("current");
  });

  it("missing when there is no current document", () => {
    expect(computeProgramStatus(base({ hasDocument: false, documentStatus: null })).status).toBe("missing");
  });

  it("does not count superseded/rejected/deleted/expired documents", () => {
    for (const documentStatus of ["superseded", "rejected", "deleted", "expired", "failed", "quarantined"]) {
      const r = computeProgramStatus(base({ documentStatus }));
      expect(r.status).toBe("missing");
    }
  });

  it("incomplete when required evidence is missing", () => {
    const r = computeProgramStatus(base({ evidence: [{ required: true, satisfied: false, notApplicable: false }] }));
    expect(r.status).toBe("incomplete");
    expect(r.blockers.join(" ")).toMatch(/evidence/i);
  });

  it("incomplete when no regulatory source is linked", () => {
    const r = computeProgramStatus(base({ sources: [] }));
    expect(r.status).toBe("incomplete");
    expect(r.blockers.join(" ")).toMatch(/source/i);
  });

  it("incomplete when owner or review dates are missing", () => {
    expect(computeProgramStatus(base({ owner: null })).status).toBe("incomplete");
    expect(computeProgramStatus(base({ nextReviewDue: null })).status).toBe("incomplete");
  });

  it("overdue when the next review date has passed", () => {
    expect(computeProgramStatus(base({ nextReviewDue: PAST })).status).toBe("overdue");
  });

  it("source_review_due when a linked source is past its verification date", () => {
    const r = computeProgramStatus(base({ sources: [{ verificationStatus: "verified", nextVerificationDueAt: PAST }] }));
    expect(r.status).toBe("source_review_due");
  });

  it("source_review_due when a source is unverified/changed", () => {
    expect(computeProgramStatus(base({ sources: [{ verificationStatus: "unverified" }] })).status).toBe("source_review_due");
    expect(computeProgramStatus(base({ sources: [{ verificationStatus: "changed" }] })).status).toBe("source_review_due");
  });

  it("not_applicable when the control does not apply (remote work disabled)", () => {
    expect(computeProgramStatus(base({ applicable: false })).status).toBe("not_applicable");
  });

  it("archived short-circuits", () => {
    expect(computeProgramStatus(base({ archived: true })).status).toBe("archived");
  });

  it("not-applicable evidence does not block completion", () => {
    const r = computeProgramStatus(base({ evidence: [{ required: true, satisfied: false, notApplicable: true }] }));
    expect(r.status).toBe("current");
  });
});
