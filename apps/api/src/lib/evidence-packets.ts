// ─────────────────────────────────────────────────────────────
// MortgageGuard — Examiner evidence packets (pure, testable)
//
// Pure builders that turn already-gathered loan / program / reporting / setup
// data into a consistent examiner-ready packet payload. The route layer is
// responsible only for fetching inputs and persisting/rendering the result, so
// these builders never touch the database and are fully unit-testable.
//
// Scope of honesty: packets assemble filing EVIDENCE and exam-readiness
// records. They are not an SES submission and not an official NMLS filing.
// ─────────────────────────────────────────────────────────────

export type PacketSummaryStatus = "ready" | "needs_attention" | "blocked" | "critical";
export type SectionStatus = "complete" | "incomplete" | "warning" | "blocked" | "not_applicable";

export interface PacketWarning {
  code: string;
  message: string;
  section?: string;
}
export interface PacketBlocker {
  code: string;
  message: string;
  section?: string;
  severity?: "blocker" | "critical";
}

export interface EvidencePacketSection {
  key: string;
  title: string;
  status: SectionStatus;
  items: Array<Record<string, unknown>>;
  warnings?: PacketWarning[];
  blockers?: PacketBlocker[];
}

export interface EvidencePacketSummary {
  status: PacketSummaryStatus;
  totalItems: number;
  satisfiedItems: number;
  missingItems: number;
  warningCount: number;
  blockerCount: number;
}

export interface PacketCompany {
  id: string;
  name: string;
  nmlsId?: string | null;
  entityType?: string | null;
  licensedStates?: string[] | null;
}

export interface PacketActor {
  id: string;
  name?: string | null;
  email?: string | null;
}

export interface PacketMeta {
  packetId: string;
  generatedAt: string;
  generatedBy?: PacketActor;
  company: PacketCompany;
  scope: Record<string, unknown>;
}

export interface EvidencePacketPayload {
  packetId: string;
  packetKey: string;
  packetType: string;
  title: string;
  generatedAt: string;
  generatedBy?: PacketActor;
  company: PacketCompany;
  scope: Record<string, unknown>;
  summary: EvidencePacketSummary;
  sections: EvidencePacketSection[];
  warnings: PacketWarning[];
  blockers: PacketBlocker[];
  auditTrail?: unknown[];
  hash?: string;
}

// Item-level status vocabularies used to tally satisfied vs missing items.
const SATISFIED_ITEM = new Set(["satisfied", "complete", "current", "pass", "filed", "verified", "ok", "not_applicable", "na"]);
const MISSING_ITEM = new Set(["missing", "incomplete", "fail", "overdue", "due", "invalid", "blocked"]);
// Blocker codes that escalate the packet to "critical".
const CRITICAL_BLOCKER_CODES = new Set(["invalid_document", "report_overdue", "loan_gate_blocked"]);

// ── Hashing ──────────────────────────────────────────────────
// cyrb53: fast, deterministic, non-cryptographic 53-bit hash. Used only as
// integrity/change-detection metadata (NOT a security primitive).
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const out = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return out.toString(16).padStart(14, "0");
}

// Hash everything that defines the packet's content (everything except the
// hash field itself), so the hash changes whenever the payload changes.
export function computePacketHash(payload: Omit<EvidencePacketPayload, "hash"> | EvidencePacketPayload): string {
  const { hash, ...rest } = payload as EvidencePacketPayload;
  void hash;
  return `cyrb53:${cyrb53(JSON.stringify(rest))}`;
}

// ── Summary / warning derivation ─────────────────────────────
export function derivePacketWarnings(payload: Pick<EvidencePacketPayload, "warnings" | "sections">): PacketWarning[] {
  const all = [...payload.warnings];
  for (const s of payload.sections) for (const w of s.warnings ?? []) all.push(w);
  // De-duplicate by code+message.
  const seen = new Set<string>();
  return all.filter((w) => {
    const k = `${w.code}|${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function derivePacketSummary(payload: Pick<EvidencePacketPayload, "sections" | "warnings" | "blockers">): EvidencePacketSummary {
  let totalItems = 0;
  let satisfiedItems = 0;
  let missingItems = 0;
  for (const section of payload.sections) {
    for (const item of section.items) {
      const st = typeof item.status === "string" ? item.status : null;
      if (!st) continue;
      totalItems++;
      if (SATISFIED_ITEM.has(st)) satisfiedItems++;
      else if (MISSING_ITEM.has(st)) missingItems++;
    }
  }
  const warningCount = payload.warnings.length;
  const blockerCount = payload.blockers.length;
  let status: PacketSummaryStatus = "ready";
  if (blockerCount > 0) {
    status = payload.blockers.some((b) => b.severity === "critical" || CRITICAL_BLOCKER_CODES.has(b.code)) ? "critical" : "blocked";
  } else if (warningCount > 0) {
    status = "needs_attention";
  }
  return { status, totalItems, satisfiedItems, missingItems, warningCount, blockerCount };
}

// Assemble a final payload from sections + meta, computing summary + hash and
// rolling section-level warnings/blockers up into the top level.
function finalize(
  meta: PacketMeta,
  packetKey: string,
  packetType: string,
  title: string,
  sections: EvidencePacketSection[],
  topWarnings: PacketWarning[],
  topBlockers: PacketBlocker[],
  auditTrail?: unknown[],
): EvidencePacketPayload {
  const warnings = [...topWarnings];
  const blockers = [...topBlockers];
  for (const s of sections) {
    for (const w of s.warnings ?? []) warnings.push(w);
    for (const b of s.blockers ?? []) blockers.push(b);
  }
  // De-duplicate.
  const dedupe = <T extends { code: string; message: string }>(arr: T[]): T[] => {
    const seen = new Set<string>();
    return arr.filter((x) => { const k = `${x.code}|${x.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const dWarnings = dedupe(warnings);
  const dBlockers = dedupe(blockers);

  const base: Omit<EvidencePacketPayload, "hash" | "summary"> = {
    packetId: meta.packetId,
    packetKey,
    packetType,
    title,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    company: meta.company,
    scope: meta.scope,
    sections,
    warnings: dWarnings,
    blockers: dBlockers,
    auditTrail,
  };
  const summary = derivePacketSummary({ sections, warnings: dWarnings, blockers: dBlockers });
  const withSummary = { ...base, summary } as EvidencePacketPayload;
  const hash = computePacketHash(withSummary);
  return { ...withSummary, hash };
}

const sectionStatus = (items: Array<Record<string, unknown>>, blockers: PacketBlocker[], warnings: PacketWarning[]): SectionStatus => {
  if (blockers.length > 0) return "blocked";
  if (items.length === 0) return "not_applicable";
  if (warnings.length > 0) return "warning";
  const hasMissing = items.some((i) => typeof i.status === "string" && MISSING_ITEM.has(i.status));
  return hasMissing ? "incomplete" : "complete";
};

// ── 1. Loan evidence packet ──────────────────────────────────
export interface LoanPacketChecklistItem {
  documentType: string;
  displayName: string;
  isMandatory: boolean;
  status: "satisfied" | "missing" | "not_applicable" | "invalid";
  pipelineStage?: string | null;
}
export interface LoanPacketInput {
  meta: PacketMeta;
  loan: Record<string, unknown> & { id: string; loanNumber?: string | null };
  txLog: { complete: boolean; missingFields: string[]; status: string };
  checklist: LoanPacketChecklistItem[];
  documents: Array<Record<string, unknown>>;
  conditionalFlags: Array<{ code: string; label: string; reason?: string }>;
  gate: { canAdvance: boolean; unsatisfied?: string[]; blockers?: string[] } | null;
  tasks: Array<{ id: string; title?: string; type?: string; status: string; dueAt?: string | null }>;
  citations: Array<{ rule: string; citation?: string | null; sourceUrl?: string | null }>;
  auditTrail?: unknown[];
  rulesLoaded: boolean;
}

export function buildLoanEvidencePacket(input: LoanPacketInput): EvidencePacketPayload {
  const sections: EvidencePacketSection[] = [];
  const warnings: PacketWarning[] = [];
  const blockers: PacketBlocker[] = [];

  if (!input.rulesLoaded) warnings.push({ code: "rules_not_loaded", message: "Texas compliance rules are not loaded; checklist may be incomplete.", section: "loan_summary" });

  // Loan summary
  sections.push({ key: "loan_summary", title: "Loan summary", status: "complete", items: [input.loan] });

  // Transaction log
  const txItems = [{ status: input.txLog.complete ? "complete" : "missing", completeness: input.txLog.status, missingFields: input.txLog.missingFields }];
  const txWarnings: PacketWarning[] = [];
  if (input.txLog.missingFields.length > 0) txWarnings.push({ code: "transaction_log_incomplete", message: `Transaction log is missing ${input.txLog.missingFields.length} field(s): ${input.txLog.missingFields.join(", ")}.`, section: "transaction_log" });
  sections.push({ key: "transaction_log", title: "Transaction-log completeness", status: sectionStatus(txItems, [], txWarnings), items: txItems, warnings: txWarnings });

  // Checklist — separated by satisfied / missing / n/a / invalid
  const satisfied = input.checklist.filter((c) => c.status === "satisfied");
  const missing = input.checklist.filter((c) => c.status === "missing" && c.isMandatory);
  const optionalMissing = input.checklist.filter((c) => c.status === "missing" && !c.isMandatory);
  const notApplicable = input.checklist.filter((c) => c.status === "not_applicable");
  const invalid = input.checklist.filter((c) => c.status === "invalid");
  const clBlockers: PacketBlocker[] = [];
  const clWarnings: PacketWarning[] = [];
  if (missing.length > 0) clBlockers.push({ code: "loan_required_document_missing", message: `${missing.length} required document(s) missing.`, section: "checklist" });
  if (invalid.length > 0) clBlockers.push({ code: "invalid_document", message: `${invalid.length} document(s) have an invalid/rejected/expired status.`, section: "checklist", severity: "critical" });
  if (optionalMissing.length > 0) clWarnings.push({ code: "optional_document_missing", message: `${optionalMissing.length} optional document(s) missing.`, section: "checklist" });
  sections.push({
    key: "checklist",
    title: "Compliance checklist",
    status: sectionStatus(input.checklist as any, clBlockers, clWarnings),
    items: input.checklist as any,
    warnings: clWarnings,
    blockers: clBlockers,
  });

  // Documents
  sections.push({ key: "documents", title: "Uploaded documents", status: input.documents.length ? "complete" : "not_applicable", items: input.documents });

  // Conditional rule flags
  sections.push({ key: "conditional_flags", title: "Conditional rule flags triggered", status: input.conditionalFlags.length ? "complete" : "not_applicable", items: input.conditionalFlags });

  // Stage gate
  const gateBlockers: PacketBlocker[] = [];
  if (input.gate && !input.gate.canAdvance) gateBlockers.push({ code: "loan_gate_blocked", message: `Stage gate is blocked: ${(input.gate.unsatisfied ?? input.gate.blockers ?? []).join(", ") || "unsatisfied requirements"}.`, section: "stage_gate", severity: "critical" });
  const gateItems = input.gate ? [{ status: input.gate.canAdvance ? "complete" : "blocked", canAdvance: input.gate.canAdvance, unsatisfied: input.gate.unsatisfied ?? [], blockers: input.gate.blockers ?? [] }] : [];
  sections.push({ key: "stage_gate", title: "Stage gate readiness", status: sectionStatus(gateItems, gateBlockers, []), items: gateItems, blockers: gateBlockers });

  // Tasks
  const openTasks = input.tasks.filter((t) => ["open", "in_progress", "blocked"].includes(t.status));
  const taskWarnings: PacketWarning[] = openTasks.length > 0 ? [{ code: "loan_open_tasks", message: `${openTasks.length} open task(s) on this loan.`, section: "tasks" }] : [];
  sections.push({ key: "tasks", title: "Loan tasks", status: sectionStatus(input.tasks.map((t) => ({ ...t, status: ["done", "completed"].includes(t.status) ? "complete" : "missing" })), [], taskWarnings), items: input.tasks as any, warnings: taskWarnings });

  // Citations
  sections.push({ key: "citations", title: "Regulatory citations", status: input.citations.length ? "complete" : "not_applicable", items: input.citations });

  // Counts in section items for satisfied/missing tally
  void satisfied; void notApplicable;

  return finalize(input.meta, "loan_evidence_packet", "loan", `Loan Evidence Packet — ${input.loan.loanNumber || input.loan.id}`, sections, warnings, blockers, input.auditTrail);
}

// ── 2. Program evidence packet ───────────────────────────────
export interface ProgramPacketProgram {
  programKey: string;
  name: string;
  status: string; // current | missing | incomplete | overdue | source_review_due | not_applicable
  owner?: string | null;
  isRequired: boolean;
  applicable?: boolean;
  currentDocument?: Record<string, unknown> | null;
  documentVersions?: Array<Record<string, unknown>>;
  evidenceChecklist?: Array<{ key: string; label: string; satisfied: boolean }>;
  missingEvidence?: string[];
  lastReviewedAt?: string | null;
  nextReviewDueAt?: string | null;
  reviewOverdue?: boolean;
  sources?: Array<Record<string, unknown> & { verificationStatus?: string; nextVerificationDueAt?: string | null }>;
}
export interface ProgramPacketInput {
  meta: PacketMeta;
  programs: ProgramPacketProgram[];
  includeRecommendedPrograms?: boolean;
  includeRegulatorySources?: boolean;
  includeSourceVerification?: boolean;
  auditTrail?: unknown[];
}

const PROGRAM_NEEDS_WORK = new Set(["missing", "incomplete", "overdue", "source_review_due", "review_due"]);

export function buildProgramEvidencePacket(input: ProgramPacketInput): EvidencePacketPayload {
  const sections: EvidencePacketSection[] = [];
  const warnings: PacketWarning[] = [];
  const blockers: PacketBlocker[] = [];

  const applicablePrograms = input.programs.filter((p) => p.applicable !== false && (input.includeRecommendedPrograms || p.isRequired));

  // Required/recommended programs
  const programItems = applicablePrograms.map((p) => ({
    programKey: p.programKey,
    name: p.name,
    owner: p.owner ?? null,
    isRequired: p.isRequired,
    status: p.status === "current" ? "current" : p.status === "not_applicable" ? "not_applicable" : PROGRAM_NEEDS_WORK.has(p.status) ? "missing" : p.status,
    currentDocument: p.currentDocument ?? null,
  }));
  const progBlockers: PacketBlocker[] = [];
  const progWarnings: PacketWarning[] = [];
  for (const p of applicablePrograms) {
    if (p.isRequired && (p.status === "missing")) progBlockers.push({ code: "required_program_missing", message: `Required program missing: ${p.name}.`, section: "programs" });
    else if (p.isRequired && PROGRAM_NEEDS_WORK.has(p.status)) progWarnings.push({ code: "required_program_incomplete", message: `Required program needs attention: ${p.name} (${p.status}).`, section: "programs" });
  }
  sections.push({ key: "programs", title: "Compliance programs", status: sectionStatus(programItems, progBlockers, progWarnings), items: programItems, blockers: progBlockers, warnings: progWarnings });

  // Evidence checklist
  const evidenceItems: Array<Record<string, unknown>> = [];
  const evBlockers: PacketBlocker[] = [];
  for (const p of applicablePrograms) {
    for (const e of p.evidenceChecklist ?? []) {
      evidenceItems.push({ program: p.name, label: e.label, status: e.satisfied ? "satisfied" : "missing" });
    }
    if (p.isRequired && (p.missingEvidence?.length ?? 0) > 0) {
      evBlockers.push({ code: "required_evidence_missing", message: `Missing evidence for ${p.name}: ${p.missingEvidence!.join(", ")}.`, section: "evidence" });
    }
  }
  sections.push({ key: "evidence", title: "Evidence checklist", status: sectionStatus(evidenceItems, evBlockers, []), items: evidenceItems, blockers: evBlockers });

  // Program reviews
  const reviewItems: Array<Record<string, unknown>> = [];
  const reviewWarnings: PacketWarning[] = [];
  for (const p of applicablePrograms) {
    reviewItems.push({ program: p.name, lastReviewedAt: p.lastReviewedAt ?? null, nextReviewDueAt: p.nextReviewDueAt ?? null, status: p.reviewOverdue ? "overdue" : "complete" });
    if (p.reviewOverdue) reviewWarnings.push({ code: "program_review_overdue", message: `Program review overdue: ${p.name}.`, section: "reviews" });
  }
  sections.push({ key: "reviews", title: "Program review history", status: sectionStatus(reviewItems, [], reviewWarnings), items: reviewItems, warnings: reviewWarnings });

  // Regulatory sources
  if (input.includeRegulatorySources !== false) {
    const sourceItems: Array<Record<string, unknown>> = [];
    const srcWarnings: PacketWarning[] = [];
    for (const p of applicablePrograms) {
      for (const s of p.sources ?? []) {
        sourceItems.push({ program: p.name, ...s });
        if (input.includeSourceVerification !== false && (s.verificationStatus === "due" || s.verificationStatus === "overdue" || s.verificationStatus === "unverified")) {
          srcWarnings.push({ code: "source_verification_due", message: `Regulatory source verification due for ${p.name}: ${(s as any).title || (s as any).citation || "source"}.`, section: "regulatory_sources" });
        }
      }
    }
    sections.push({ key: "regulatory_sources", title: "Regulatory basis & source verification", status: sectionStatus(sourceItems, [], srcWarnings), items: sourceItems, warnings: srcWarnings });
  }

  return finalize(input.meta, "program_evidence_packet", "programs", "Company Compliance Program Packet", sections, warnings, blockers, input.auditTrail);
}

// ── 3. Reporting evidence packet ─────────────────────────────
export interface ReportingPacketDeadline {
  obligationKey?: string | null;
  reportType: string;
  jurisdiction?: string | null;
  period?: string | null;
  dueDate: string;
  status: string; // derived: upcoming|due_soon|due|overdue|filed|not_applicable
  filedAt?: string | null;
  filedBy?: string | null;
  confirmationNumber?: string | null;
  hasReceipt: boolean;
}
export interface ReportingPacketInput {
  meta: PacketMeta;
  deadlines: ReportingPacketDeadline[];
  exports: Array<Record<string, unknown>>;
  txLogSummary: { rowCount: number; missingFieldLoans: number; warnings?: string[] };
  includeReceipts?: boolean;
  includeTransactionLogExports?: boolean;
  auditTrail?: unknown[];
}

export function buildReportingEvidencePacket(input: ReportingPacketInput): EvidencePacketPayload {
  const sections: EvidencePacketSection[] = [];
  const warnings: PacketWarning[] = [];
  const blockers: PacketBlocker[] = [];

  // Deadlines (each row carries derived status → satisfied/missing tally)
  const dlBlockers: PacketBlocker[] = [];
  const dlWarnings: PacketWarning[] = [];
  const deadlineItems = input.deadlines.map((d) => {
    const status = d.status === "filed" ? "filed" : d.status === "overdue" ? "overdue" : d.status === "not_applicable" ? "not_applicable" : d.status === "upcoming" ? "satisfied" : "due";
    return { obligationKey: d.obligationKey ?? null, reportType: d.reportType, jurisdiction: d.jurisdiction ?? null, period: d.period ?? null, dueDate: d.dueDate, status, filedAt: d.filedAt ?? null, filedBy: d.filedBy ?? null, confirmationNumber: d.confirmationNumber ?? null, hasReceipt: d.hasReceipt };
  });
  for (const d of input.deadlines) {
    if (d.status === "overdue") dlBlockers.push({ code: "report_overdue", message: `Report overdue: ${d.reportType}${d.period ? ` (${d.period})` : ""}.`, section: "deadlines", severity: "critical" });
    if (input.includeReceipts !== false && d.status === "filed" && !d.hasReceipt) dlWarnings.push({ code: "report_receipt_missing", message: `Filed report missing a receipt: ${d.reportType}${d.confirmationNumber ? ` (${d.confirmationNumber})` : ""}.`, section: "deadlines" });
  }
  sections.push({ key: "deadlines", title: "Reporting obligations & filing evidence", status: sectionStatus(deadlineItems, dlBlockers, dlWarnings), items: deadlineItems, blockers: dlBlockers, warnings: dlWarnings });

  // Transaction-log export history + missing-field summary
  if (input.includeTransactionLogExports !== false) {
    sections.push({ key: "report_exports", title: "Report export history", status: input.exports.length ? "complete" : "not_applicable", items: input.exports });
  }
  const txWarnings: PacketWarning[] = [];
  if (input.txLogSummary.missingFieldLoans > 0) txWarnings.push({ code: "transaction_log_gaps", message: `${input.txLogSummary.missingFieldLoans} loan(s) have missing transaction-log fields.`, section: "transaction_log_summary" });
  sections.push({ key: "transaction_log_summary", title: "Transaction-log summary", status: txWarnings.length ? "warning" : "complete", items: [{ rowCount: input.txLogSummary.rowCount, missingFieldLoans: input.txLogSummary.missingFieldLoans }], warnings: txWarnings });

  return finalize(input.meta, "reporting_evidence_packet", "reporting", "Reporting Evidence Packet", sections, warnings, blockers, input.auditTrail);
}

// ── 4. Examination readiness packet ──────────────────────────
export interface ExaminationPacketInput {
  meta: PacketMeta;
  setup: { coreSetupComplete: boolean; profileComplete: boolean; rulesLoaded: boolean; licensedStates?: string[]; warnings?: string[] };
  programs: { requiredTotal: number; requiredCurrent: number; requiredNeedsWork: number; overdue: number };
  sourceVerification: { total: number; verified: number; due: number };
  reporting: { overdueDeadlines: number; dueSoonDeadlines: number; missingReceipts: number; filed: number };
  txLogSummary: { rowCount: number; missingFieldLoans: number };
  loans: { total: number; attention: number };
  loanSummaries: Array<{ loanId: string; loanNumber?: string | null; complianceScore?: number | null; status?: string | null; blockers: number; warnings: number }>;
  auditSummary?: unknown[];
}

export function buildExaminationReadinessPacket(input: ExaminationPacketInput): EvidencePacketPayload {
  const sections: EvidencePacketSection[] = [];
  const warnings: PacketWarning[] = [];
  const blockers: PacketBlocker[] = [];

  // Setup
  const setupItems = [{ status: input.setup.coreSetupComplete ? "complete" : "incomplete", profileComplete: input.setup.profileComplete, rulesLoaded: input.setup.rulesLoaded, licensedStates: input.setup.licensedStates ?? [] }];
  const setupWarnings: PacketWarning[] = [];
  const setupBlockers: PacketBlocker[] = [];
  if (!input.setup.profileComplete) setupBlockers.push({ code: "company_profile_incomplete", message: "Company profile is incomplete.", section: "setup" });
  if (!input.setup.rulesLoaded) setupWarnings.push({ code: "rules_not_loaded", message: "Texas compliance rules are not loaded.", section: "setup" });
  for (const w of input.setup.warnings ?? []) setupWarnings.push({ code: "setup_warning", message: w, section: "setup" });
  sections.push({ key: "setup", title: "Setup & company readiness", status: sectionStatus(setupItems, setupBlockers, setupWarnings), items: setupItems, warnings: setupWarnings, blockers: setupBlockers });

  // Programs
  const progItems = [{ status: input.programs.requiredNeedsWork === 0 && input.programs.requiredTotal > 0 ? "complete" : "missing", ...input.programs }];
  const progWarnings: PacketWarning[] = [];
  if (input.programs.requiredNeedsWork > 0) progWarnings.push({ code: "programs_need_work", message: `${input.programs.requiredNeedsWork} required program(s) need attention.`, section: "programs" });
  sections.push({ key: "programs", title: "Compliance program readiness", status: sectionStatus(progItems, [], progWarnings), items: progItems, warnings: progWarnings });

  // Source verification
  const svItems = [{ status: input.sourceVerification.due === 0 ? "complete" : "due", ...input.sourceVerification }];
  const svWarnings: PacketWarning[] = input.sourceVerification.due > 0 ? [{ code: "source_verification_due", message: `${input.sourceVerification.due} regulatory source(s) due for verification.`, section: "regulatory_sources" }] : [];
  sections.push({ key: "regulatory_sources", title: "Regulatory source verification", status: sectionStatus(svItems, [], svWarnings), items: svItems, warnings: svWarnings });

  // Reporting
  const repItems = [{ status: input.reporting.overdueDeadlines === 0 ? "complete" : "overdue", ...input.reporting }];
  const repBlockers: PacketBlocker[] = input.reporting.overdueDeadlines > 0 ? [{ code: "report_overdue", message: `${input.reporting.overdueDeadlines} reporting deadline(s) overdue.`, section: "reporting", severity: "critical" }] : [];
  const repWarnings: PacketWarning[] = [];
  if (input.reporting.missingReceipts > 0) repWarnings.push({ code: "report_receipt_missing", message: `${input.reporting.missingReceipts} filed report(s) missing a receipt.`, section: "reporting" });
  if (input.reporting.dueSoonDeadlines > 0) repWarnings.push({ code: "report_due_soon", message: `${input.reporting.dueSoonDeadlines} reporting deadline(s) due within 30 days.`, section: "reporting" });
  sections.push({ key: "reporting", title: "Reporting deadlines & filing evidence", status: sectionStatus(repItems, repBlockers, repWarnings), items: repItems, blockers: repBlockers, warnings: repWarnings });

  // Transaction-log
  const txItems = [{ status: input.txLogSummary.missingFieldLoans === 0 ? "complete" : "missing", ...input.txLogSummary }];
  const txWarnings: PacketWarning[] = input.txLogSummary.missingFieldLoans > 0 ? [{ code: "transaction_log_gaps", message: `${input.txLogSummary.missingFieldLoans} loan(s) with transaction-log gaps.`, section: "transaction_log" }] : [];
  sections.push({ key: "transaction_log", title: "Transaction-log summary", status: sectionStatus(txItems, [], txWarnings), items: txItems, warnings: txWarnings });

  // Loan inventory
  sections.push({ key: "loan_inventory", title: "Loan inventory summary", status: "complete", items: [{ total: input.loans.total, attention: input.loans.attention }] });

  // Loan-level evidence summaries
  const loanItems = input.loanSummaries.map((l) => ({ loanId: l.loanId, loanNumber: l.loanNumber ?? null, complianceScore: l.complianceScore ?? null, loanStatus: l.status ?? null, blockers: l.blockers, warnings: l.warnings, status: l.blockers > 0 ? "missing" : "satisfied" }));
  sections.push({ key: "loan_evidence_summaries", title: "Loan-level evidence summaries", status: loanItems.length ? sectionStatus(loanItems, [], []) : "not_applicable", items: loanItems });

  return finalize(input.meta, "examination_readiness_packet", "examination", "Full Examination Readiness Packet", sections, warnings, blockers, input.auditSummary);
}
