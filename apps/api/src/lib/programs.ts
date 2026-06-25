// ─────────────────────────────────────────────────────
// MortgageGuard — Required compliance programs
// The baseline set every mortgage company must maintain. Used to bootstrap a
// company's program list and to flag what's missing.
// ─────────────────────────────────────────────────────
export const REQUIRED_PROGRAMS = [
  { programType: "aml", programName: "Anti-Money Laundering (AML) Program", requiredBy: "federal" },
  { programType: "red_flags", programName: "Identity Theft Prevention / Red Flags Program", requiredBy: "federal" },
  { programType: "information_security", programName: "Information Security Program", requiredBy: "federal" },
  { programType: "lo_compensation", programName: "LO Compensation Agreements", requiredBy: "federal" },
  { programType: "remote_work", programName: "Remote Work Policy", requiredBy: "state" },
] as const;

export type RequiredProgram = (typeof REQUIRED_PROGRAMS)[number];
