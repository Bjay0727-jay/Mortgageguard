// ─────────────────────────────────────────────────────
// MortgageGuard — Stage Gate Decision Model (pure)
//
// Single source of truth for stage-advancement readiness. Both the gate
// preview (GET /loans/:id/gate/:targetStage) and the actual advance
// (POST /loans/:id/advance) build their decision from buildStageReadiness so
// `canAdvance` can never disagree between the two.
//
// Warnings vs blockers:
//   - warnings  → informational, never block advancement
//   - blockers  → prevent advancement unless an authorized override is used
//   canAdvance is true only when there are zero blockers (which also means the
//   transition is valid and there are no unsatisfied required documents).
// ─────────────────────────────────────────────────────

export const PIPELINE_STAGE_ORDER = ["application", "processing", "underwriting", "closing", "post_close"] as const;
export const TERMINAL_STAGES = ["denied", "withdrawn"] as const;
export const LOAN_STAGES = [...PIPELINE_STAGE_ORDER, ...TERMINAL_STAGES] as const;
export type LoanStage = (typeof LOAN_STAGES)[number];

export function isTerminalStage(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function getNextStage(currentStage: string): LoanStage | null {
  const index = PIPELINE_STAGE_ORDER.indexOf(currentStage as (typeof PIPELINE_STAGE_ORDER)[number]);
  if (index < 0 || index >= PIPELINE_STAGE_ORDER.length - 1) return null;
  return PIPELINE_STAGE_ORDER[index + 1];
}

export function isValidStageTransition(currentStage: string, targetStage: string): boolean {
  if (isTerminalStage(currentStage)) return false;          // terminal loans can't move
  if (isTerminalStage(targetStage)) return true;            // any active loan may be denied/withdrawn
  return getNextStage(currentStage) === targetStage;        // otherwise only the immediate next stage
}

// Stages a loan in `currentStage` may legally advance to.
export function allowedTargetsFor(currentStage: string): string[] {
  if (isTerminalStage(currentStage)) return [];
  const next = getNextStage(currentStage);
  return [...(next ? [next] : []), ...TERMINAL_STAGES];
}

export function formatStage(stage: string): string {
  return stage.split("_").map((word) => (word[0] ? word[0].toUpperCase() + word.slice(1) : word)).join(" ");
}

export interface GateUnsatisfied {
  requiredDocumentId: string;
  documentType: string;
  displayName: string;
}

export interface GateResultLike {
  satisfiedCount: number;
  requiredCount: number;
  unsatisfied: GateUnsatisfied[];
  warnings: string[];
}

export interface StageReadiness {
  canAdvance: boolean;
  currentStage: string;
  targetStage: string;
  transitionValid: boolean;
  isTerminal: boolean;
  satisfiedCount: number;
  requiredCount: number;
  unsatisfied: GateUnsatisfied[];
  warnings: string[];
  blockers: string[];
  allowedTargets: string[];
}

// Combine stage-transition validity with the compliance gate result into one
// readiness decision used by BOTH preview and advance.
export function buildStageReadiness(params: {
  currentStage: string;
  targetStage: string;
  gate: GateResultLike;
}): StageReadiness {
  const { currentStage, targetStage, gate } = params;
  const isTerminal = isTerminalStage(currentStage);
  const transitionValid = isValidStageTransition(currentStage, targetStage);

  const warnings = [...gate.warnings];
  const blockers: string[] = [];

  if (isTerminal) {
    blockers.push(`Loan is ${formatStage(currentStage)} and cannot be advanced.`);
  } else if (!transitionValid) {
    blockers.push(`Invalid stage transition: ${formatStage(currentStage)} cannot advance directly to ${formatStage(targetStage)}.`);
  }

  for (const u of gate.unsatisfied) {
    blockers.push(`Required document missing or invalid: ${u.displayName}.`);
  }

  return {
    canAdvance: blockers.length === 0,
    currentStage,
    targetStage,
    transitionValid,
    isTerminal,
    satisfiedCount: gate.satisfiedCount,
    requiredCount: gate.requiredCount,
    unsatisfied: gate.unsatisfied,
    warnings,
    blockers,
    allowedTargets: allowedTargetsFor(currentStage),
  };
}

export interface AdvanceDecision {
  action: "advance" | "reject";
  isOverride: boolean;
  status?: number;
  error?: string;
  code?: string;
  auditMeta?: {
    reason: string | null;
    blockers: string[];
    warnings: string[];
    unsatisfied: GateUnsatisfied[];
  };
}

// Pure policy for POST /advance. Mirrors the readiness decision and layers the
// override rules on top. An invalid stage transition is NEVER overrideable; only
// unsatisfied-document blockers can be overridden, and only with the
// overrideCompliance capability plus a reason.
export function resolveAdvanceDecision(params: {
  readiness: StageReadiness;
  override: boolean;
  hasOverrideCapability: boolean;
  reason?: string;
}): AdvanceDecision {
  const { readiness, override, hasOverrideCapability, reason } = params;

  if (readiness.canAdvance) {
    return { action: "advance", isOverride: false };
  }

  // Transition problems are structural and cannot be overridden here.
  if (!readiness.transitionValid) {
    return {
      action: "reject",
      isOverride: false,
      status: 400,
      error: readiness.isTerminal ? "Loan is terminal and cannot be advanced" : "Invalid stage transition",
      code: readiness.isTerminal ? "LOAN_TERMINAL" : "INVALID_TRANSITION",
    };
  }

  // Remaining blockers are unsatisfied required documents → overrideable.
  if (!override) {
    return { action: "reject", isOverride: false, status: 400, error: "Cannot advance — compliance gate not satisfied", code: "GATE_UNSATISFIED" };
  }
  if (!hasOverrideCapability) {
    return { action: "reject", isOverride: true, status: 403, error: "Insufficient permissions", code: "OVERRIDE_FORBIDDEN" };
  }
  if (!reason || !reason.trim()) {
    return { action: "reject", isOverride: true, status: 400, error: "Override reason is required", code: "OVERRIDE_REASON_REQUIRED" };
  }

  return {
    action: "advance",
    isOverride: true,
    auditMeta: {
      reason: reason.trim(),
      blockers: readiness.blockers,
      warnings: readiness.warnings,
      unsatisfied: readiness.unsatisfied,
    },
  };
}
