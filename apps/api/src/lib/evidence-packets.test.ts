import { describe, it, expect } from "vitest";
import {
  buildLoanEvidencePacket,
  buildProgramEvidencePacket,
  buildReportingEvidencePacket,
  buildExaminationReadinessPacket,
  computePacketHash,
  derivePacketSummary,
  type LoanPacketInput,
  type ProgramPacketInput,
  type ReportingPacketInput,
  type ExaminationPacketInput,
} from "./evidence-packets";

const meta = {
  packetId: "pkt-1",
  generatedAt: "2026-06-26T00:00:00.000Z",
  generatedBy: { id: "u1", name: "Casey", email: "casey@x.com" },
  company: { id: "company-1", name: "Acme Mortgage", nmlsId: "111", entityType: "lender", licensedStates: ["TX"] },
  scope: {},
};

const section = (p: { sections: Array<{ key: string; items: Array<Record<string, unknown>> }> }, key: string) => p.sections.find((s) => s.key === key)!;

function loanInput(overrides: Partial<LoanPacketInput> = {}): LoanPacketInput {
  return {
    meta,
    loan: { id: "loan-1", loanNumber: "TX-1", applicantName: "Lee, Sam", propertyState: "TX", complianceScore: 82 },
    txLog: { complete: false, missingFields: ["closing_date"], status: "missing_fields" },
    checklist: [
      { documentType: "loan_application", displayName: "Application", isMandatory: true, status: "satisfied" },
      { documentType: "tx_50a6_disclosure", displayName: "50(a)(6) Disclosure", isMandatory: true, status: "missing" },
      { documentType: "flood_cert", displayName: "Flood Cert", isMandatory: false, status: "missing" },
    ],
    documents: [{ id: "d1", documentType: "loan_application", fileName: "app.pdf", status: "uploaded" }],
    conditionalFlags: [{ code: "tx_50a6", label: "Texas 50(a)(6)" }],
    gate: { canAdvance: true, unsatisfied: [] },
    tasks: [{ id: "t1", title: "Verify income", status: "open" }],
    citations: [{ rule: "TX Home Equity", citation: "Tex. Const. art. XVI §50(a)(6)", sourceUrl: "https://example.gov" }],
    rulesLoaded: true,
    ...overrides,
  };
}

describe("buildLoanEvidencePacket", () => {
  it("includes a loan summary section", () => {
    const p = buildLoanEvidencePacket(loanInput());
    expect(section(p, "loan_summary").items[0]).toMatchObject({ id: "loan-1", loanNumber: "TX-1" });
    expect(p.packetKey).toBe("loan_evidence_packet");
  });

  it("includes the compliance checklist", () => {
    const p = buildLoanEvidencePacket(loanInput());
    expect(section(p, "checklist").items).toHaveLength(3);
  });

  it("blocks on missing required documents", () => {
    const p = buildLoanEvidencePacket(loanInput());
    expect(p.blockers.some((b) => b.code === "loan_required_document_missing")).toBe(true);
    // optional missing is a warning, not a blocker
    expect(p.warnings.some((w) => w.code === "optional_document_missing")).toBe(true);
  });

  it("includes transaction-log completeness", () => {
    const p = buildLoanEvidencePacket(loanInput());
    expect(section(p, "transaction_log").items[0]).toMatchObject({ status: "missing", completeness: "missing_fields" });
    expect(p.warnings.some((w) => w.code === "transaction_log_incomplete")).toBe(true);
  });

  it("includes triggered conditional rule flags", () => {
    const p = buildLoanEvidencePacket(loanInput());
    expect(section(p, "conditional_flags").items[0]).toMatchObject({ code: "tx_50a6" });
  });

  it("escalates to critical on invalid documents and blocked gate", () => {
    const p = buildLoanEvidencePacket(loanInput({
      checklist: [{ documentType: "x", displayName: "X", isMandatory: true, status: "invalid" }],
      gate: { canAdvance: false, unsatisfied: ["appraisal"] },
    }));
    expect(p.summary.status).toBe("critical");
    expect(p.blockers.some((b) => b.code === "invalid_document")).toBe(true);
    expect(p.blockers.some((b) => b.code === "loan_gate_blocked")).toBe(true);
  });
});

function programInput(overrides: Partial<ProgramPacketInput> = {}): ProgramPacketInput {
  return {
    meta,
    programs: [
      { programKey: "aml", name: "AML Program", status: "current", isRequired: true, currentDocument: { fileName: "aml.pdf", version: 2 }, evidenceChecklist: [{ key: "policy", label: "Policy doc", satisfied: true }], lastReviewedAt: "2026-01-01", nextReviewDueAt: "2027-01-01", sources: [{ title: "BSA", citation: "31 USC 5318", verificationStatus: "verified" }] },
      { programKey: "red_flags", name: "Red Flags Program", status: "missing", isRequired: true, missingEvidence: ["policy"], reviewOverdue: true, sources: [{ title: "Red Flags Rule", citation: "16 CFR 681", verificationStatus: "due" }] },
    ],
    includeRegulatorySources: true,
    includeSourceVerification: true,
    ...overrides,
  };
}

describe("buildProgramEvidencePacket", () => {
  it("includes required programs", () => {
    const p = buildProgramEvidencePacket(programInput());
    expect(section(p, "programs").items.map((i) => i.programKey)).toEqual(["aml", "red_flags"]);
  });
  it("includes the evidence checklist", () => {
    const p = buildProgramEvidencePacket(programInput());
    expect(section(p, "evidence").items.length).toBeGreaterThan(0);
    expect(p.blockers.some((b) => b.code === "required_evidence_missing")).toBe(true);
  });
  it("includes regulatory sources", () => {
    const p = buildProgramEvidencePacket(programInput());
    expect(section(p, "regulatory_sources").items.length).toBe(2);
  });
  it("warns on source verification due", () => {
    const p = buildProgramEvidencePacket(programInput());
    expect(p.warnings.some((w) => w.code === "source_verification_due")).toBe(true);
  });
});

function reportingInput(overrides: Partial<ReportingPacketInput> = {}): ReportingPacketInput {
  return {
    meta,
    deadlines: [
      { obligationKey: "rmla", reportType: "RMLA", jurisdiction: "TX", period: "Q1-2026", dueDate: "2026-05-15", status: "filed", filedAt: "2026-05-10", confirmationNumber: "NMLS-1", hasReceipt: false },
      { obligationKey: "sssf", reportType: "SSSF", jurisdiction: "TX", period: "Q4-2025", dueDate: "2026-02-14", status: "overdue", hasReceipt: false },
    ],
    exports: [{ reportKey: "tx_transaction_log", format: "csv", periodStart: "2026-01-01", periodEnd: "2026-03-31", rowCount: 10 }],
    txLogSummary: { rowCount: 10, missingFieldLoans: 2 },
    ...overrides,
  };
}

describe("buildReportingEvidencePacket", () => {
  it("includes deadlines with filed status and confirmation number", () => {
    const p = buildReportingEvidencePacket(reportingInput());
    const filed = section(p, "deadlines").items.find((i) => i.obligationKey === "rmla")!;
    expect(filed).toMatchObject({ status: "filed", confirmationNumber: "NMLS-1" });
  });
  it("warns on missing receipts and blocks on overdue", () => {
    const p = buildReportingEvidencePacket(reportingInput());
    expect(p.warnings.some((w) => w.code === "report_receipt_missing")).toBe(true);
    expect(p.blockers.some((b) => b.code === "report_overdue")).toBe(true);
    expect(p.summary.status).toBe("critical");
  });
  it("summarizes transaction-log gaps", () => {
    const p = buildReportingEvidencePacket(reportingInput());
    expect(p.warnings.some((w) => w.code === "transaction_log_gaps")).toBe(true);
  });
});

function examinationInput(overrides: Partial<ExaminationPacketInput> = {}): ExaminationPacketInput {
  return {
    meta,
    setup: { coreSetupComplete: true, profileComplete: true, rulesLoaded: true, licensedStates: ["TX"], warnings: [] },
    programs: { requiredTotal: 4, requiredCurrent: 4, requiredNeedsWork: 0, overdue: 0 },
    sourceVerification: { total: 5, verified: 5, due: 0 },
    reporting: { overdueDeadlines: 0, dueSoonDeadlines: 1, missingReceipts: 0, filed: 3 },
    txLogSummary: { rowCount: 12, missingFieldLoans: 0 },
    loans: { total: 12, attention: 2 },
    loanSummaries: [{ loanId: "loan-1", loanNumber: "TX-1", complianceScore: 82, status: "processing", blockers: 0, warnings: 1 }],
    ...overrides,
  };
}

describe("buildExaminationReadinessPacket", () => {
  it("includes setup, programs, reports, and loan summary sections", () => {
    const p = buildExaminationReadinessPacket(examinationInput());
    const keys = p.sections.map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["setup", "programs", "reporting", "loan_inventory", "loan_evidence_summaries"]));
  });
  it("rolls blockers up to critical when reports are overdue", () => {
    const p = buildExaminationReadinessPacket(examinationInput({ reporting: { overdueDeadlines: 2, dueSoonDeadlines: 0, missingReceipts: 0, filed: 1 } }));
    expect(p.summary.status).toBe("critical");
  });
});

describe("packet hash + summary", () => {
  it("hash changes when the payload changes", () => {
    const a = buildLoanEvidencePacket(loanInput());
    const b = buildLoanEvidencePacket(loanInput({ loan: { id: "loan-1", loanNumber: "TX-999" } }));
    expect(a.hash).toBeTruthy();
    expect(a.hash).not.toBe(b.hash);
    // stable for identical input
    expect(computePacketHash({ ...a })).toBe(a.hash);
  });

  it("summary counts warnings and blockers", () => {
    const p = buildLoanEvidencePacket(loanInput());
    const s = derivePacketSummary(p);
    expect(s.warningCount).toBe(p.warnings.length);
    expect(s.blockerCount).toBe(p.blockers.length);
    expect(s.totalItems).toBeGreaterThan(0);
  });
});
