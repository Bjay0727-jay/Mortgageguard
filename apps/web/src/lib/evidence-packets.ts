// ─────────────────────────────────────────────────────────────
// MortgageGuard — Evidence packet client helpers (pure, testable)
//
// Packet-type configuration (which fields each type needs), generate-request
// builders, status → badge mapping, and which download formats a packet
// exposes. Framework-free for unit testing.
// ─────────────────────────────────────────────────────────────

import type { BadgeVariant } from "@/components/ui";

export type PacketType = "loan" | "programs" | "reporting" | "examination";

export interface PacketTypeDef {
  key: PacketType;
  label: string;
  description: string;
}

export const PACKET_TYPES: PacketTypeDef[] = [
  { key: "loan", label: "Loan Evidence Packet", description: "Everything an examiner needs for one loan file." },
  { key: "programs", label: "Program Evidence Packet", description: "Company compliance programs, evidence, and regulatory basis." },
  { key: "reporting", label: "Reporting Evidence Packet", description: "Reporting obligations, filing evidence, and transaction-log summary." },
  { key: "examination", label: "Examination Readiness Packet", description: "Full company exam-readiness across setup, programs, reports, and loans." },
];

export interface PacketTypeFields {
  loanSelector: boolean;
  dateRange: boolean;
  jurisdiction: boolean;
  includeDocuments: boolean;
  includeAuditTrail: boolean;
  includeRegulatorySources: boolean;
  includeReceipts: boolean;
  includeRecommendedPrograms: boolean;
}

// Which inputs a packet type's generate form should show.
export function packetTypeFields(type: PacketType): PacketTypeFields {
  return {
    loanSelector: type === "loan",
    dateRange: type === "reporting" || type === "examination",
    jurisdiction: type === "reporting" || type === "examination",
    includeDocuments: type === "loan",
    includeAuditTrail: type === "loan" || type === "examination",
    includeRegulatorySources: type === "loan" || type === "programs" || type === "examination",
    includeReceipts: type === "reporting",
    includeRecommendedPrograms: type === "programs",
  };
}

export interface GenerateForm {
  loanId?: string;
  periodStart?: string;
  periodEnd?: string;
  jurisdiction?: string;
  includeDocuments?: boolean;
  includeAuditTrail?: boolean;
  includeRegulatorySources?: boolean;
  includeReceipts?: boolean;
  includeRecommendedPrograms?: boolean;
}

export interface GenerateRequest {
  path: string;
  body: Record<string, unknown>;
}

// Build the API path + body for a generate request given the active form.
export function buildGenerateRequest(type: PacketType, form: GenerateForm): GenerateRequest {
  const fields = packetTypeFields(type);
  const body: Record<string, unknown> = {};
  if (fields.includeDocuments) body.includeDocuments = form.includeDocuments !== false;
  if (fields.includeAuditTrail) body.includeAuditTrail = form.includeAuditTrail !== false;
  if (fields.includeRegulatorySources) body.includeRegulatorySources = form.includeRegulatorySources !== false;
  if (fields.includeReceipts) body.includeReceipts = form.includeReceipts !== false;
  if (fields.includeRecommendedPrograms) body.includeRecommendedPrograms = !!form.includeRecommendedPrograms;
  if (fields.jurisdiction) body.jurisdiction = form.jurisdiction || "TX";
  if (fields.dateRange) {
    if (form.periodStart) body.periodStart = form.periodStart;
    if (form.periodEnd) body.periodEnd = form.periodEnd;
  }
  switch (type) {
    case "loan": return { path: `/api/v1/evidence-packets/loan/${form.loanId}`, body };
    case "programs": return { path: "/api/v1/evidence-packets/programs", body };
    case "reporting": return { path: "/api/v1/evidence-packets/reporting", body };
    case "examination": return { path: "/api/v1/evidence-packets/examination", body };
  }
}

// Whether the form is ready to submit (loan packets need a selected loan).
export function canGenerate(type: PacketType, form: GenerateForm): boolean {
  if (type === "loan") return Boolean(form.loanId);
  return true;
}

export const PACKET_STATUS_VARIANT: Record<string, BadgeVariant> = {
  generating: "amber",
  generated: "green",
  failed: "red",
  expired: "gray",
  deleted: "gray",
};

export function packetStatusVariant(status: string | null | undefined): BadgeVariant {
  return PACKET_STATUS_VARIANT[status || ""] || "gray";
}

export const SUMMARY_STATUS_VARIANT: Record<string, BadgeVariant> = {
  ready: "green",
  needs_attention: "amber",
  blocked: "red",
  critical: "red",
};

export function summaryStatusVariant(status: string | null | undefined): BadgeVariant {
  return SUMMARY_STATUS_VARIANT[status || ""] || "gray";
}

// Only successfully generated packets expose downloadable formats.
export function packetFormats(status: string | null | undefined): Array<"json" | "html"> {
  return status === "generated" ? ["json", "html"] : [];
}
