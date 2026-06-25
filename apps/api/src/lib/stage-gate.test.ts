import { describe, it, expect } from "vitest";
import { hasCapability } from "@mortgageguard/shared";
import {
  buildStageReadiness,
  resolveAdvanceDecision,
  isValidStageTransition,
  allowedTargetsFor,
  getNextStage,
  type GateResultLike,
} from "./stage-gate";

const satisfiedGate: GateResultLike = { satisfiedCount: 1, requiredCount: 1, unsatisfied: [], warnings: [] };
const missingGate: GateResultLike = {
  satisfiedCount: 0,
  requiredCount: 1,
  unsatisfied: [{ requiredDocumentId: "r1", documentType: "appraisal", displayName: "Appraisal" }],
  warnings: [],
};
const noReqGate: GateResultLike = {
  satisfiedCount: 0,
  requiredCount: 0,
  unsatisfied: [],
  warnings: ["No mandatory document requirements are configured for this stage."],
};

describe("stage transition helpers", () => {
  it("only allows the immediate next pipeline stage", () => {
    expect(isValidStageTransition("application", "processing")).toBe(true);
    expect(isValidStageTransition("application", "underwriting")).toBe(false);
    expect(getNextStage("processing")).toBe("underwriting");
  });

  it("allows any active loan to go terminal but not the reverse", () => {
    expect(isValidStageTransition("processing", "denied")).toBe(true);
    expect(isValidStageTransition("denied", "processing")).toBe(false);
  });

  it("computes allowed targets", () => {
    expect(allowedTargetsFor("application")).toEqual(["processing", "denied", "withdrawn"]);
    expect(allowedTargetsFor("denied")).toEqual([]);
  });
});

describe("buildStageReadiness — preview and advance share this", () => {
  it("agree: satisfied required documents => canAdvance true, no blockers", () => {
    const r = buildStageReadiness({ currentStage: "application", targetStage: "processing", gate: satisfiedGate });
    expect(r.canAdvance).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(resolveAdvanceDecision({ readiness: r, override: false, hasOverrideCapability: false }).action).toBe("advance");
  });

  it("agree: missing required documents => canAdvance false with a blocker", () => {
    const r = buildStageReadiness({ currentStage: "application", targetStage: "processing", gate: missingGate });
    expect(r.canAdvance).toBe(false);
    expect(r.blockers.some((b) => b.includes("Appraisal"))).toBe(true);
    const d = resolveAdvanceDecision({ readiness: r, override: false, hasOverrideCapability: false });
    expect(d.action).toBe("reject");
    expect(d.code).toBe("GATE_UNSATISFIED");
  });

  it("no configured requirements is NON-blocking and surfaces a warning", () => {
    const r = buildStageReadiness({ currentStage: "application", targetStage: "processing", gate: noReqGate });
    expect(r.canAdvance).toBe(true);
    expect(r.blockers).toHaveLength(0);
    expect(r.warnings).toContain("No mandatory document requirements are configured for this stage.");
  });

  it("invalid transition is a blocker in preview and is NOT overrideable in advance", () => {
    const r = buildStageReadiness({ currentStage: "application", targetStage: "closing", gate: satisfiedGate });
    expect(r.canAdvance).toBe(false);
    expect(r.transitionValid).toBe(false);
    const d = resolveAdvanceDecision({ readiness: r, override: true, hasOverrideCapability: true, reason: "force it" });
    expect(d.action).toBe("reject");
    expect(d.code).toBe("INVALID_TRANSITION");
  });

  it("terminal loan cannot advance", () => {
    const r = buildStageReadiness({ currentStage: "denied", targetStage: "processing", gate: satisfiedGate });
    expect(r.canAdvance).toBe(false);
    expect(r.isTerminal).toBe(true);
    expect(r.allowedTargets).toEqual([]);
    const d = resolveAdvanceDecision({ readiness: r, override: true, hasOverrideCapability: true, reason: "x" });
    expect(d.code).toBe("LOAN_TERMINAL");
  });
});

describe("resolveAdvanceDecision — override policy", () => {
  const blocked = buildStageReadiness({ currentStage: "application", targetStage: "processing", gate: missingGate });

  it("override requires the overrideCompliance capability", () => {
    const d = resolveAdvanceDecision({ readiness: blocked, override: true, hasOverrideCapability: false, reason: "need it" });
    expect(d.action).toBe("reject");
    expect(d.code).toBe("OVERRIDE_FORBIDDEN");
    expect(d.status).toBe(403);
  });

  it("override requires a reason", () => {
    const d = resolveAdvanceDecision({ readiness: blocked, override: true, hasOverrideCapability: true, reason: "   " });
    expect(d.action).toBe("reject");
    expect(d.code).toBe("OVERRIDE_REASON_REQUIRED");
  });

  it("successful override carries blockers, warnings, unsatisfied docs, and reason for audit", () => {
    const d = resolveAdvanceDecision({ readiness: blocked, override: true, hasOverrideCapability: true, reason: "exception approved by GM" });
    expect(d.action).toBe("advance");
    expect(d.isOverride).toBe(true);
    expect(d.auditMeta?.reason).toBe("exception approved by GM");
    expect(d.auditMeta?.blockers.length).toBeGreaterThan(0);
    expect(d.auditMeta?.unsatisfied).toHaveLength(1);
    expect(Array.isArray(d.auditMeta?.warnings)).toBe(true);
  });
});

describe("gate preview capability policy", () => {
  it("advanceLoanStage gates preview: held by operational roles, not read_only", () => {
    for (const role of ["company_admin", "qualifying_individual", "loan_originator", "processor", "compliance_officer"]) {
      expect(hasCapability(role, "advanceLoanStage")).toBe(true);
    }
    expect(hasCapability("read_only", "advanceLoanStage")).toBe(false);
  });
});
