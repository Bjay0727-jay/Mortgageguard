import { describe, it, expect } from "vitest";
import { SCORE_THRESHOLDS, DOC_WEIGHTS, getScoreStatus } from "@mortgageguard/shared";
import {
  computeGateSatisfaction,
  isGateSatisfyingStatus,
  GATE_SATISFYING_DOCUMENT_STATUSES,
} from "./compliance-engine";

const REQ = [
  { requiredDocumentId: "r1", documentType: "appraisal", displayName: "Appraisal" },
];
const t = (offsetMs: number) => new Date(1_700_000_000_000 + offsetMs).toISOString();

describe("compliance engine - score thresholds", () => {
  it("returns passing for scores >= 80", () => {
    expect(getScoreStatus(80)).toBe("passing");
    expect(getScoreStatus(100)).toBe("passing");
    expect(getScoreStatus(95)).toBe("passing");
  });

  it("returns warning for scores >= 50 and < 80", () => {
    expect(getScoreStatus(50)).toBe("warning");
    expect(getScoreStatus(79)).toBe("warning");
    expect(getScoreStatus(65)).toBe("warning");
  });

  it("returns critical for scores < 50", () => {
    expect(getScoreStatus(0)).toBe("critical");
    expect(getScoreStatus(49)).toBe("critical");
    expect(getScoreStatus(25)).toBe("critical");
  });

  it("handles exact boundary values", () => {
    expect(getScoreStatus(80)).toBe("passing");
    expect(getScoreStatus(79)).toBe("warning");
    expect(getScoreStatus(50)).toBe("warning");
    expect(getScoreStatus(49)).toBe("critical");
  });
});

describe("compliance engine - doc weights", () => {
  it("mandatory > state_specific > recommended", () => {
    expect(DOC_WEIGHTS.mandatory).toBe(3);
    expect(DOC_WEIGHTS.state_specific).toBe(2);
    expect(DOC_WEIGHTS.recommended).toBe(1);
  });
});

describe("compliance engine - score calculation logic", () => {
  function computeScore(
    checks: { result: string; weight: number; isMandatory: boolean; isStateSpecific: boolean }[]
  ) {
    let totalWeight = 0;
    let satisfiedWeight = 0;
    const breakdown = {
      mandatory: { total: 0, satisfied: 0 },
      stateSpecific: { total: 0, satisfied: 0 },
      recommended: { total: 0, satisfied: 0 },
    };

    for (const check of checks) {
      const w = check.weight;
      totalWeight += w;
      const isSatisfied = check.result === "pass" || check.result === "na" || check.result === "waived";
      if (isSatisfied) satisfiedWeight += w;

      if (check.isMandatory) {
        breakdown.mandatory.total++;
        if (isSatisfied) breakdown.mandatory.satisfied++;
      } else if (check.isStateSpecific) {
        breakdown.stateSpecific.total++;
        if (isSatisfied) breakdown.stateSpecific.satisfied++;
      } else {
        breakdown.recommended.total++;
        if (isSatisfied) breakdown.recommended.satisfied++;
      }
    }

    const score = totalWeight > 0 ? Math.round((satisfiedWeight / totalWeight) * 100) : 0;
    return { score, totalWeight, satisfiedWeight, breakdown };
  }

  it("returns 0 for empty checks", () => {
    const result = computeScore([]);
    expect(result.score).toBe(0);
    expect(result.totalWeight).toBe(0);
  });

  it("returns 100% when all checks pass", () => {
    const result = computeScore([
      { result: "pass", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "pass", weight: 2, isMandatory: false, isStateSpecific: true },
      { result: "pass", weight: 1, isMandatory: false, isStateSpecific: false },
    ]);
    expect(result.score).toBe(100);
    expect(result.satisfiedWeight).toBe(6);
  });

  it("returns 0% when all checks pending", () => {
    const result = computeScore([
      { result: "pending", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "pending", weight: 2, isMandatory: false, isStateSpecific: true },
    ]);
    expect(result.score).toBe(0);
  });

  it("treats na and waived as satisfied", () => {
    const result = computeScore([
      { result: "na", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "waived", weight: 2, isMandatory: false, isStateSpecific: true },
      { result: "pending", weight: 1, isMandatory: false, isStateSpecific: false },
    ]);
    expect(result.score).toBe(83);
    expect(result.satisfiedWeight).toBe(5);
  });

  it("treats fail as not satisfied", () => {
    const result = computeScore([
      { result: "pass", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "fail", weight: 3, isMandatory: true, isStateSpecific: false },
    ]);
    expect(result.score).toBe(50);
  });

  it("categorizes breakdown correctly", () => {
    const result = computeScore([
      { result: "pass", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "pending", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "pass", weight: 2, isMandatory: false, isStateSpecific: true },
      { result: "pending", weight: 1, isMandatory: false, isStateSpecific: false },
    ]);
    expect(result.breakdown.mandatory).toEqual({ total: 2, satisfied: 1 });
    expect(result.breakdown.stateSpecific).toEqual({ total: 1, satisfied: 1 });
    expect(result.breakdown.recommended).toEqual({ total: 1, satisfied: 0 });
  });

  it("mandatory docs have more impact on score", () => {
    const result = computeScore([
      { result: "pass", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "pass", weight: 3, isMandatory: true, isStateSpecific: false },
      { result: "pending", weight: 1, isMandatory: false, isStateSpecific: false },
    ]);
    expect(result.score).toBe(86);
    expect(result.score).toBeGreaterThanOrEqual(SCORE_THRESHOLDS.passing);
  });
});

describe("compliance engine - gate evaluation logic", () => {
  function evaluateGate(
    requirements: { documentType: string; displayName: string }[],
    satisfiedDocs: Set<string>
  ) {
    const unsatisfied = requirements.filter(r => !satisfiedDocs.has(r.documentType));
    return {
      canAdvance: unsatisfied.length === 0,
      satisfiedCount: requirements.length - unsatisfied.length,
      requiredCount: requirements.length,
      unsatisfied,
    };
  }

  it("allows advance when all requirements met", () => {
    const result = evaluateGate(
      [{ documentType: "appraisal", displayName: "Appraisal" }],
      new Set(["appraisal"]),
    );
    expect(result.canAdvance).toBe(true);
    expect(result.unsatisfied).toHaveLength(0);
  });

  it("blocks advance when requirements missing", () => {
    const result = evaluateGate(
      [
        { documentType: "appraisal", displayName: "Appraisal" },
        { documentType: "title", displayName: "Title" },
      ],
      new Set(["appraisal"]),
    );
    expect(result.canAdvance).toBe(false);
    expect(result.unsatisfied).toHaveLength(1);
    expect(result.unsatisfied[0].documentType).toBe("title");
  });

  it("allows advance with no requirements", () => {
    const result = evaluateGate([], new Set());
    expect(result.canAdvance).toBe(true);
    expect(result.requiredCount).toBe(0);
  });

  it("reports correct counts", () => {
    const result = evaluateGate(
      [
        { documentType: "a", displayName: "A" },
        { documentType: "b", displayName: "B" },
        { documentType: "c", displayName: "C" },
      ],
      new Set(["a", "c"]),
    );
    expect(result.satisfiedCount).toBe(2);
    expect(result.requiredCount).toBe(3);
    expect(result.unsatisfied).toHaveLength(1);
  });
});

describe("computeGateSatisfaction - only current valid documents satisfy", () => {
  it("valid statuses are exactly uploaded/signed/delivered", () => {
    expect([...GATE_SATISFYING_DOCUMENT_STATUSES]).toEqual(["uploaded", "signed", "delivered"]);
    for (const s of ["uploaded", "signed", "delivered"]) expect(isGateSatisfyingStatus(s)).toBe(true);
    for (const s of ["pending", "rejected", "expired", "superseded", "replaced", "quarantined", "failed", null, undefined, ""]) {
      expect(isGateSatisfyingStatus(s as any)).toBe(false);
    }
  });

  it("an uploaded document satisfies the gate", () => {
    const r = computeGateSatisfaction({ requirements: REQ, documents: [{ documentType: "appraisal", status: "uploaded", uploadedAt: t(0) }] });
    expect(r.unsatisfied).toHaveLength(0);
    expect(r.satisfiedCount).toBe(1);
  });

  it("signed and delivered documents satisfy the gate", () => {
    expect(computeGateSatisfaction({ requirements: REQ, documents: [{ documentType: "appraisal", status: "signed", uploadedAt: t(0) }] }).unsatisfied).toHaveLength(0);
    expect(computeGateSatisfaction({ requirements: REQ, documents: [{ documentType: "appraisal", status: "delivered", uploadedAt: t(0) }] }).unsatisfied).toHaveLength(0);
  });

  it("a rejected document does NOT satisfy the gate", () => {
    const r = computeGateSatisfaction({ requirements: REQ, documents: [{ documentType: "appraisal", status: "rejected", uploadedAt: t(0) }] });
    expect(r.unsatisfied).toHaveLength(1);
    expect(r.unsatisfied[0].documentType).toBe("appraisal");
  });

  it("an expired document does NOT satisfy the gate", () => {
    const r = computeGateSatisfaction({ requirements: REQ, documents: [{ documentType: "appraisal", status: "expired", uploadedAt: t(0) }] });
    expect(r.unsatisfied).toHaveLength(1);
  });

  it("a deleted document (no row remains) does NOT satisfy the gate", () => {
    const r = computeGateSatisfaction({ requirements: REQ, documents: [] });
    expect(r.unsatisfied).toHaveLength(1);
  });

  it("only the LATEST document per type counts: stale valid + newer rejected => unsatisfied", () => {
    const r = computeGateSatisfaction({
      requirements: REQ,
      documents: [
        { documentType: "appraisal", status: "uploaded", uploadedAt: t(0) },   // old valid (superseded)
        { documentType: "appraisal", status: "rejected", uploadedAt: t(1000) }, // newest, invalid
      ],
    });
    expect(r.unsatisfied).toHaveLength(1);
  });

  it("a new replacement with a valid status satisfies even if the old one was rejected", () => {
    const r = computeGateSatisfaction({
      requirements: REQ,
      documents: [
        { documentType: "appraisal", status: "rejected", uploadedAt: t(0) },    // old, invalid
        { documentType: "appraisal", status: "uploaded", uploadedAt: t(1000) }, // newest replacement, valid
      ],
    });
    expect(r.unsatisfied).toHaveLength(0);
  });

  it("a waived/na compliance check satisfies without a document", () => {
    const r = computeGateSatisfaction({ requirements: REQ, documents: [], waivedRequiredDocumentIds: ["r1"] });
    expect(r.unsatisfied).toHaveLength(0);
  });

  it("no requirements => nothing unsatisfied", () => {
    const r = computeGateSatisfaction({ requirements: [], documents: [] });
    expect(r.unsatisfied).toHaveLength(0);
    expect(r.satisfiedCount).toBe(0);
  });
});
