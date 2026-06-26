"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import {
  WORKSPACE_TABS,
  parseTab,
  filterChecklist,
  filterTasks,
  isTaskOverdue,
  checklistRowState,
  deriveTxLogFields,
  txLogMissingFields,
  validateNote,
  timelineCategory,
  nextActionTab,
  NOTE_TYPE_VARIANT,
  type WorkspaceTab,
  type ChecklistFilter,
  type TaskFilter,
} from "@/lib/loan-workspace";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  ScoreBadge,
  Select,
  StatusBadge,
  Table,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from "@/components/ui";

const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
];
const ACCEPTED_EXTENSIONS = ".pdf,.docx,.png,.jpg,.jpeg";
const MAX_UPLOAD_BYTES = Number(process.env.NEXT_PUBLIC_MAX_DOCUMENT_UPLOAD_BYTES || 25 * 1024 * 1024);
const STAGE_ORDER = ["application", "processing", "underwriting", "closing", "post_close"] as const;
const TERMINAL_STAGES = ["denied", "withdrawn"] as const;

interface Loan {
  id: string;
  loan_number: string;
  borrower_first_name: string;
  borrower_last_name: string;
  property_address: string;
  property_city: string;
  property_state: string;
  property_zip: string;
  status: string;
  loan_purpose: string;
  loan_product: string;
  loan_type: string;
  loan_amount: string;
  interest_rate: string;
  loan_term: number;
  lien_position: string;
  occupancy_type: string;
  compliance_score: number;
  docs_complete: number;
  docs_required: number;
  originator_name: string;
  application_date: string;
  closing_date: string | null;
}

interface ChecklistItem {
  documentType: string;
  displayName: string;
  isMandatory: boolean;
  weight: number;
  pipelineStage: string | null;
  source: string;
  uploaded: boolean;
  documentId: string | null;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  uploadedAt: string | null;
  uploadedBy: string | null;
  status: string | null;
  uploadStatus: string | null;
  isSigned: boolean;
}

interface GateReview {
  canAdvance: boolean;
  currentStage: string;
  targetStage: string;
  transitionValid?: boolean;
  satisfiedCount: number;
  requiredCount: number;
  unsatisfied: { requiredDocumentId?: string; documentType: string; displayName: string }[];
  warnings: string[];
  blockers?: string[];
  allowedTargets?: string[];
}

interface TimelineEvent {
  id: string;
  event_type: string;
  stage_from: string | null;
  stage_to: string | null;
  description: string;
  occurred_at: string;
  performed_by_name: string | null;
}

interface LoanIntegrity {
  status: "clean" | "needs_attention" | "blocked" | "critical";
  blockers: string[];
  warnings: string[];
  nextActions: { label: string; href: string; priority: "low" | "normal" | "high" | "critical" }[];
}

interface LoanTask {
  id: string;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  priority: string;
  auto_key: string | null;
  assigned_to_name: string | null;
  due_at: string | null;
}

interface LoanNote {
  id: string;
  note_type: string;
  body: string;
  visibility: string;
  created_by_name: string | null;
  created_at: string;
}

const INTEGRITY_META: Record<LoanIntegrity["status"], { label: string; tone: "green" | "amber" | "red"; bg: string; fg: string }> = {
  clean: { label: "Clean", tone: "green", bg: "var(--grn-pl)", fg: "var(--grn)" },
  needs_attention: { label: "Needs attention", tone: "amber", bg: "var(--amb-pl)", fg: "var(--amb)" },
  blocked: { label: "Blocked", tone: "red", bg: "var(--red-pl)", fg: "var(--red)" },
  critical: { label: "Critical", tone: "red", bg: "var(--red-pl)", fg: "var(--red)" },
};

function formatStage(stage: string) {
  return stage.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function getNextStage(currentStage: string) {
  const index = STAGE_ORDER.indexOf(currentStage as typeof STAGE_ORDER[number]);
  if (index < 0 || index >= STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[index + 1];
}

function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [loan, setLoan] = useState<Loan | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [integrity, setIntegrity] = useState<LoanIntegrity | null>(null);
  const [tasks, setTasks] = useState<LoanTask[]>([]);
  const [notes, setNotes] = useState<LoanNote[]>([]);
  const [tab, setTab] = useState<WorkspaceTab>(parseTab(searchParams.get("tab")));
  const [checklistFilter, setChecklistFilter] = useState<ChecklistFilter>("all");
  const [checklistSearch, setChecklistSearch] = useState("");
  const [taskFilter, setTaskFilter] = useState<TaskFilter>("all");
  const [timelineFilter, setTimelineFilter] = useState("all");
  const [error, setError] = useState("");
  const [uploadItem, setUploadItem] = useState<ChecklistItem | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [gateReview, setGateReview] = useState<GateReview | null>(null);
  const [gateLoading, setGateLoading] = useState(false);
  const [advanceLoading, setAdvanceLoading] = useState(false);
  const [advanceError, setAdvanceError] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const { can } = useCapabilities();

  const canUploadDocuments = can("uploadLoanDocument");
  const canOverrideCompliance = can("overrideCompliance");
  const nextStage = loan ? getNextStage(loan.status) : null;
  const isTerminalStage = loan ? (TERMINAL_STAGES as readonly string[]).includes(loan.status) : false;

  async function refreshLoan() {
    const data = await api.get<{ loan: Loan }>(`/api/v1/loans/${id}`);
    setLoan(data.loan);
  }

  async function refreshChecklist() {
    const data = await api.get<{ checklist: ChecklistItem[] }>(`/api/v1/loans/${id}/checklist`);
    setChecklist(data.checklist);
  }

  async function refreshTimeline() {
    const data = await api.get<{ events: TimelineEvent[] }>(`/api/v1/loans/${id}/timeline`);
    setTimeline(data.events);
  }

  async function refreshIntegrity() {
    const data = await api.get<{ integrity: LoanIntegrity }>(`/api/v1/loans/${id}/integrity`);
    setIntegrity(data.integrity);
  }

  async function refreshTasks() {
    const data = await api.get<{ tasks: LoanTask[] }>(`/api/v1/loans/${id}/tasks`);
    setTasks(data.tasks);
  }

  async function refreshNotes() {
    const data = await api.get<{ notes: LoanNote[] }>(`/api/v1/loans/${id}/notes`);
    setNotes(data.notes);
  }

  async function createNote(body: string, noteType: string) {
    const err = validateNote(body);
    if (err) { toast({ variant: "error", title: "Cannot add note", description: err }); return false; }
    try {
      await api.post(`/api/v1/loans/${id}/notes`, { body, noteType });
      await Promise.all([refreshNotes(), refreshTimeline()]);
      return true;
    } catch (e: any) {
      toast({ variant: "error", title: "Could not add note", description: e.message });
      return false;
    }
  }

  async function deleteNote(noteId: string) {
    try {
      await api.delete(`/api/v1/loans/${id}/notes/${noteId}`);
      await Promise.all([refreshNotes(), refreshTimeline()]);
    } catch (e: any) {
      toast({ variant: "error", title: "Could not delete note", description: e.message });
    }
  }

  async function completeTask(taskId: string) {
    try {
      await api.patch(`/api/v1/loans/${id}/tasks/${taskId}`, { status: "complete" });
      await Promise.all([refreshTasks(), refreshIntegrity()]);
    } catch (e: any) {
      toast({ variant: "error", title: "Could not update task", description: e.message });
    }
  }

  async function refreshAfterUpload() {
    await Promise.all([refreshLoan(), refreshChecklist(), refreshTimeline(), refreshIntegrity(), refreshTasks()]);
    if (gateReview) {
      const data = await api.get<GateReview>(`/api/v1/loans/${id}/gate/${gateReview.targetStage}`);
      setGateReview(data);
    }
  }

  async function openGateReview(targetStage: string) {
    setGateLoading(true);
    setAdvanceError("");
    setOverrideReason("");
    try {
      const data = await api.get<GateReview>(`/api/v1/loans/${id}/gate/${targetStage}`);
      setGateReview(data);
    } catch (e: any) {
      toast({ variant: "error", title: "Gate review failed", description: e.message || "Unable to load gate review" });
    } finally {
      setGateLoading(false);
    }
  }

  async function handleAdvanceStage(useOverride = false) {
    if (!gateReview) return;
    setAdvanceLoading(true);
    setAdvanceError("");
    try {
      await api.post(`/api/v1/loans/${id}/advance`, {
        targetStage: gateReview.targetStage,
        override: useOverride,
        reason: useOverride ? overrideReason : undefined,
      });
      await Promise.all([refreshLoan(), refreshTimeline(), refreshChecklist()]);
      toast({
        variant: useOverride ? "warning" : "success",
        title: useOverride ? "Stage advanced (override)" : "Stage advanced",
        description: `Advanced to ${formatStage(gateReview.targetStage)}.`,
      });
      setGateReview(null);
      setOverrideReason("");
    } catch (e: any) {
      setAdvanceError(e.message || "Unable to advance stage");
    } finally {
      setAdvanceLoading(false);
    }
  }

  useEffect(() => {
    refreshLoan().catch((e) => setError(e.message));
    refreshChecklist().catch((e) => setError(e.message));
    refreshTimeline().catch(() => {});
    refreshIntegrity().catch(() => {});
    refreshTasks().catch(() => {});
    refreshNotes().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function openUpload(item: ChecklistItem) {
    setUploadItem(item);
    setSelectedFile(null);
    setUploadError("");
  }

  // Mobile bottom-bar shortcut: jump to the checklist and open the first
  // outstanding document (or the first item if everything is uploaded).
  function quickUpload() {
    setMoreOpen(false);
    setTab("checklist");
    if (checklist.length === 0) return;
    openUpload(checklist.find((c) => !c.uploaded) ?? checklist[0]);
  }

  function closeUpload() {
    if (uploading) return;
    setUploadItem(null);
    setSelectedFile(null);
    setUploadError("");
  }

  function handleFileChange(file: File | null) {
    setSelectedFile(null);
    setUploadError("");
    if (!file) return;
    if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
      setUploadError("Upload a PDF, DOCX, PNG, JPG, or JPEG file.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`File is too large. Maximum size is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setSelectedFile(file);
  }

  async function handleUpload() {
    if (!uploadItem || !selectedFile) return;
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);
      fd.append("documentType", uploadItem.documentType);
      await api.upload(`/api/v1/documents/upload/${id}`, fd);
      await refreshAfterUpload();
      toast({ variant: "success", title: "Document uploaded", description: `${uploadItem.displayName} uploaded successfully.` });
      closeUpload();
    } catch (e: any) {
      const message = e.message || "Upload failed";
      setUploadError(message);
      toast({ variant: "error", title: "Upload failed", description: message });
    } finally {
      setUploading(false);
    }
  }

  async function downloadDocument(item: ChecklistItem) {
    if (!item.documentId) return;
    setDownloadingDocId(item.documentId);
    try {
      const token = api.getToken();
      const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787";
      const res = await fetch(`${base}/api/v1/documents/${id}/${item.documentId}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = item.fileName || `${item.documentType}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e: any) {
      toast({ variant: "error", title: "Download failed", description: e.message || "Download failed" });
    } finally {
      setDownloadingDocId(null);
    }
  }

  if (error) return <div role="alert" className="rounded-md bg-[var(--red-pl)] p-4 text-sm text-[var(--red)]">{error}</div>;
  if (!loan) return <p className="text-[var(--gray-500)]">Loading…</p>;

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

  const openTasks = tasks.filter((t) => !["complete", "canceled"].includes(t.status)).length;
  const overdueTasks = tasks.filter((t) => isTaskOverdue(t)).length;
  const missingDocs = checklist.filter((c) => checklistRowState(c as any) === "missing").length;
  const txMissing = txLogMissingFields(loan as any);
  const tabCounts: Record<string, string> = {
    checklist: `${checklist.filter((c) => checklistRowState(c as any) === "uploaded").length}/${checklist.length}`,
    documents: String(checklist.filter((c) => c.uploaded).length),
    tasks: openTasks ? String(openTasks) : "",
    "transaction-log": txMissing.length ? String(txMissing.length) : "",
    notes: notes.length ? String(notes.length) : "",
  };
  const tabs = WORKSPACE_TABS.map((t) => ({ id: t.id, label: tabCounts[t.id] ? `${t.label} (${tabCounts[t.id]})` : t.label }));

  const checklistColumns: Column<ChecklistItem>[] = [
    {
      key: "displayName",
      header: "Document",
      render: (item) => (
        <div>
          <p className="font-medium text-[var(--gray-900)]">{item.displayName}</p>
          <span className={item.isMandatory ? "text-xs text-[var(--red)]" : "text-xs text-[var(--gray-500)]"}>
            {item.isMandatory ? "Required" : "Recommended"}
          </span>
        </div>
      ),
    },
    { key: "source", header: "Source", render: (i) => <span className="capitalize">{i.source}</span>, hideOnMobile: true },
    { key: "pipelineStage", header: "Stage", render: (i) => <span className="capitalize">{i.pipelineStage || "—"}</span>, hideOnMobile: true },
    {
      key: "status",
      header: "Status",
      render: (i) => <Badge variant={i.isSigned ? "blue" : i.uploaded ? "green" : "gray"}>{i.isSigned ? "Signed" : i.uploaded ? "Uploaded" : "Missing"}</Badge>,
    },
    {
      key: "file",
      header: "File",
      hideOnMobile: true,
      render: (i) =>
        i.uploaded ? (
          <div className="text-xs text-[var(--gray-600)]">
            <p className="font-medium text-[var(--gray-900)]">{i.fileName}</p>
            <p>{formatBytes(i.fileSize)}{i.uploadedAt ? ` · ${new Date(i.uploadedAt).toLocaleDateString()}` : ""}</p>
          </div>
        ) : "—",
    },
    {
      key: "actions",
      header: "Actions",
      render: (item) => (
        <div className="flex flex-wrap justify-end gap-2 md:justify-start">
          {item.uploaded && (
            <Button variant="secondary" size="sm" onClick={() => downloadDocument(item)} loading={downloadingDocId === item.documentId}>
              {downloadingDocId === item.documentId ? "Downloading…" : "View / Download"}
            </Button>
          )}
          {canUploadDocuments && (
            <Button size="sm" onClick={() => openUpload(item)}>{item.uploaded ? "Replace" : "Upload"}</Button>
          )}
        </div>
      ),
    },
  ];

  const showAdvance = can("advanceLoanStage") && !!nextStage && !isTerminalStage;

  return (
    <div className="space-y-6 pb-20 lg:pb-0">
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/loans" className="text-sm text-[var(--gray-500)] hover:text-[var(--gray-700)]">
          &larr; Loans
        </Link>
        <h1 className="text-2xl font-bold text-[var(--gray-900)]">{loan.loan_number}</h1>
        <StatusBadge status={loan.status} />
        <ScoreBadge score={loan.compliance_score} />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-[var(--gray-500)]">Current: <strong className="text-[var(--gray-800)]">{formatStage(loan.status)}</strong></span>
          {can("generateEvidencePackets") && (
            <Link href={`/evidence-packets?type=loan&loanId=${loan.id}`} className="hidden text-sm font-semibold text-[var(--royal)] hover:underline lg:inline">Generate Loan Evidence Packet</Link>
          )}
          {showAdvance && (
            <Button onClick={() => openGateReview(nextStage!)} loading={gateLoading} className="hidden lg:inline-flex">
              {gateLoading ? "Checking Gate…" : `Advance to ${formatStage(nextStage!)}`}
            </Button>
          )}
        </div>
      </div>

      <Card className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-[var(--gray-500)]">Borrower</p>
          <p className="text-sm font-medium text-[var(--gray-900)]">{loan.borrower_last_name}, {loan.borrower_first_name}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--gray-500)]">Property</p>
          <p className="text-sm font-medium text-[var(--gray-900)]">{loan.property_address}, {loan.property_city}, {loan.property_state} {loan.property_zip}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--gray-500)]">Amount</p>
          <p className="text-sm font-medium text-[var(--gray-900)]">{loan.loan_amount ? fmt(loan.loan_amount) : "—"}</p>
        </div>
      </Card>

      {/* Integrity rollup */}
      {integrity && integrity.status !== "clean" && (
        <div className="rounded-lg p-4" style={{ background: INTEGRITY_META[integrity.status].bg, color: INTEGRITY_META[integrity.status].fg }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Loan integrity: {INTEGRITY_META[integrity.status].label}</span>
          </div>
          {(integrity.blockers.length > 0 || integrity.warnings.length > 0) && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {integrity.blockers.map((b) => <li key={b}>{b}</li>)}
              {integrity.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {integrity.nextActions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {integrity.nextActions.map((a) => (
                <Link key={a.label} href={a.href} className="rounded-md bg-white/70 px-2.5 py-1 text-xs font-semibold underline">{a.label}</Link>
              ))}
            </div>
          )}
        </div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={(t) => setTab(t as typeof tab)} aria-label="Loan sections" />

      {tab === "overview" && (
        <div className="space-y-4">
          {/* Command-center cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <OverviewCard label="Compliance Score" value={`${loan.compliance_score}%`} tone={loan.compliance_score >= 80 ? "good" : loan.compliance_score >= 50 ? "warn" : "danger"} />
            <OverviewCard label="Integrity" value={integrity ? INTEGRITY_META[integrity.status].label : "—"} tone={integrity?.status === "clean" ? "good" : integrity?.status === "needs_attention" ? "warn" : "danger"} />
            <OverviewCard label="Missing Documents" value={String(missingDocs)} tone={missingDocs ? "danger" : "good"} onClick={() => setTab("checklist")} />
            <OverviewCard label="Open Tasks" value={String(openTasks)} tone={openTasks ? "warn" : "good"} onClick={() => setTab("tasks")} />
            <OverviewCard label="Overdue Tasks" value={String(overdueTasks)} tone={overdueTasks ? "danger" : "good"} onClick={() => setTab("tasks")} />
            <OverviewCard label="Transaction Log" value={txMissing.length ? `${txMissing.length} missing` : "Complete"} tone={txMissing.length ? "warn" : "good"} onClick={() => setTab("transaction-log")} />
            <OverviewCard label="Stage Gate" value={formatStage(loan.status)} tone="neutral" onClick={() => setTab("stage-gate")} />
            <OverviewCard label="Closing Date" value={loan.closing_date || "—"} tone="neutral" />
          </div>

          {/* Next actions, blockers, warnings */}
          {integrity && (integrity.nextActions.length > 0 || integrity.blockers.length > 0 || integrity.warnings.length > 0) && (
            <Card className="space-y-3">
              {integrity.nextActions.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[var(--gray-800)]">Next actions</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {integrity.nextActions.map((a) => (
                      <button key={a.label} onClick={() => setTab(nextActionTab(a))} className="rounded-md bg-[var(--royal-pl)] px-2.5 py-1 text-xs font-semibold text-[var(--royal)] hover:opacity-90">{a.label} →</button>
                    ))}
                  </div>
                </div>
              )}
              {integrity.blockers.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[var(--red)]">Blockers</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-[var(--gray-700)]">{integrity.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              )}
              {integrity.warnings.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[var(--amb)]">Warnings</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-[var(--gray-700)]">{integrity.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
              )}
            </Card>
          )}

          {/* Loan details + owners */}
          <Card className="grid gap-4 sm:grid-cols-3">
            {([
              ["Purpose", loan.loan_purpose],
              ["Product", loan.loan_product],
              ["Type", loan.loan_type],
              ["Rate", loan.interest_rate ? `${loan.interest_rate}%` : "—"],
              ["Term", loan.loan_term ? `${loan.loan_term} mo` : "—"],
              ["Lien", loan.lien_position],
              ["Occupancy", loan.occupancy_type],
              ["Property State", loan.property_state],
              ["Application", loan.application_date],
              ["Closing", loan.closing_date || "—"],
              ["Originator", loan.originator_name || "—"],
              ["Docs", `${loan.docs_complete}/${loan.docs_required}`],
            ] as [string, string][]).map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-[var(--gray-500)]">{label}</p>
                <p className="text-sm font-medium capitalize text-[var(--gray-900)]">{value}</p>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === "checklist" && (
        <div className="space-y-3">
          <Card className="flex flex-wrap items-center gap-2">
            <input value={checklistSearch} onChange={(e) => setChecklistSearch(e.target.value)} placeholder="Search documents…" className="rounded-md border border-[var(--gray-300)] px-3 py-1.5 text-sm" />
            {(["all", "missing", "required", "uploaded", "invalid", "not_applicable", "current_stage", "federal", "state"] as ChecklistFilter[]).map((f) => (
              <button key={f} onClick={() => setChecklistFilter(f)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${checklistFilter === f ? "bg-[var(--royal)] text-white" : "bg-[var(--gray-100)] text-[var(--gray-700)]"}`}>{f.replace(/_/g, " ")}</button>
            ))}
          </Card>
          <Card flush className="overflow-hidden">
            <Table
              columns={checklistColumns}
              data={filterChecklist(checklist as any, checklistFilter, checklistSearch, loan.status) as ChecklistItem[]}
              rowKey={(i) => i.documentType}
              caption="Compliance document checklist"
              emptyState={<EmptyState icon={<span className="text-lg">⏳</span>} title="No matching checklist items" description="Adjust the filters or refresh to see required compliance documents." />}
            />
          </Card>
        </div>
      )}

      {tab === "documents" && (
        <Card flush className="overflow-hidden">
          {checklist.filter((c) => c.documentId).length === 0 ? (
            <EmptyState icon={<span className="text-lg">📂</span>} title="No documents uploaded" description="Uploaded loan documents appear here with version and audit history." />
          ) : (
            <ul className="divide-y divide-[var(--gray-100)]">
              {checklist.filter((c) => c.documentId).map((c) => {
                const stateOf = checklistRowState(c as any);
                return (
                  <li key={c.documentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--gray-900)]">{c.fileName || c.displayName}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--gray-500)]">
                        <span className="capitalize">{c.documentType.replace(/_/g, " ")}</span>
                        <Badge variant={stateOf === "uploaded" ? "green" : stateOf === "invalid" ? "red" : "gray"}>{c.uploadStatus || "—"}</Badge>
                        {c.uploadedBy && <span>· {c.uploadedBy}</span>}
                        {c.uploadedAt && <span>· {String(c.uploadedAt).slice(0, 10)}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => downloadDocument(c)} loading={downloadingDocId === c.documentId}>Download</Button>
                      {canUploadDocuments && <Button size="sm" variant="secondary" onClick={() => openUpload(c)}>Replace</Button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "tasks" && (
        <div className="space-y-3">
          <Card className="flex flex-wrap items-center gap-2">
            {(["all", "open", "overdue", "auto", "manual", "complete"] as TaskFilter[]).map((f) => (
              <button key={f} onClick={() => setTaskFilter(f)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${taskFilter === f ? "bg-[var(--royal)] text-white" : "bg-[var(--gray-100)] text-[var(--gray-700)]"}`}>{f}</button>
            ))}
          </Card>
          <Card flush className="overflow-hidden">
            {filterTasks(tasks as any, taskFilter).length === 0 ? (
              <EmptyState icon={<span className="text-lg">✅</span>} title="No matching tasks" description="Auto-generated and manual tasks for this loan appear here." />
            ) : (
              <ul className="divide-y divide-[var(--gray-100)]">
                {(filterTasks(tasks as any, taskFilter) as LoanTask[]).map((t) => {
                  const done = ["complete", "canceled"].includes(t.status);
                  const overdue = isTaskOverdue(t as any);
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <div className="min-w-0">
                        <p className={`text-sm font-medium ${done ? "text-[var(--gray-400)] line-through" : "text-[var(--gray-900)]"}`}>{t.title}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--gray-500)]">
                          <Badge variant={t.priority === "critical" || t.priority === "high" ? "red" : "gray"}>{t.priority}</Badge>
                          <span className="capitalize">{t.task_type.replace(/_/g, " ")}</span>
                          <Badge variant={t.auto_key ? "gray" : "blue"}>{t.auto_key ? "auto" : "manual"}</Badge>
                          {t.assigned_to_name && <span>· {t.assigned_to_name}</span>}
                          {t.due_at && <span className={overdue ? "font-semibold text-[var(--red)]" : ""}>· due {String(t.due_at).slice(0, 10)}</span>}
                        </div>
                      </div>
                      {!done && can("manageLoanTasks") && (
                        <Button size="sm" variant="secondary" onClick={() => completeTask(t.id)}>Complete</Button>
                      )}
                      {done && <Badge variant="green">{t.status}</Badge>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "transaction-log" && (
        <div className="space-y-3">
          {txMissing.length > 0 && (
            <div role="status" className="rounded-md bg-[var(--amb-pl)] p-3 text-sm text-[var(--amb)]">
              {txMissing.length} required transaction-log field(s) missing — these will appear as warnings on the Texas transaction-log export.
            </div>
          )}
          <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {deriveTxLogFields(loan as any).map((f) => (
              <div key={f.key} className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-[var(--gray-500)]">{f.label}{f.conditional ? " (if applicable)" : ""}</p>
                  <p className="text-sm font-medium text-[var(--gray-900)]">{f.value || "—"}</p>
                </div>
                {!f.present && !f.conditional && <Badge variant="amber">missing</Badge>}
              </div>
            ))}
          </Card>
          <div className="flex flex-wrap gap-2">
            <a href={`/reports`} className="inline-flex items-center rounded-md border border-[var(--gray-300)] px-3 py-1.5 text-sm font-semibold text-[var(--royal)] hover:bg-[var(--gray-50)]">Export transaction log (Reports)</a>
            {canUploadDocuments && <Button variant="secondary" onClick={() => setTab("overview")}>Edit loan fields</Button>}
          </div>
        </div>
      )}

      {tab === "stage-gate" && (
        <Card className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="text-xs text-[var(--gray-500)]">Current stage</p>
              <StatusBadge status={loan.status} />
            </div>
            {nextStage && (
              <div>
                <p className="text-xs text-[var(--gray-500)]">Next allowed stage</p>
                <StatusBadge status={nextStage} />
              </div>
            )}
            {nextStage && can("advanceLoanStage") && (
              <Button className="ml-auto" onClick={() => openGateReview(nextStage)} loading={gateLoading}>Preview gate</Button>
            )}
          </div>
          {isTerminalStage && <p className="text-sm text-[var(--gray-500)]">This loan is at a terminal stage.</p>}
          {integrity && (integrity.blockers.length > 0 || integrity.warnings.length > 0) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-[var(--red)]">Blockers</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-[var(--gray-700)]">{integrity.blockers.length ? integrity.blockers.map((b) => <li key={b}>{b}</li>) : <li className="list-none text-[var(--gray-400)]">None</li>}</ul>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--amb)]">Warnings</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-[var(--gray-700)]">{integrity.warnings.length ? integrity.warnings.map((w) => <li key={w}>{w}</li>) : <li className="list-none text-[var(--gray-400)]">None</li>}</ul>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--gray-500)]">No outstanding blockers or warnings. Preview the gate to confirm readiness.</p>
          )}
        </Card>
      )}

      {tab === "notes" && (
        <NotesTab notes={notes} canManage={can("manageLoanNotes")} onCreate={createNote} onDelete={deleteNote} />
      )}

      {tab === "timeline" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {["all", "documents", "tasks", "stage", "notes", "evidence-packets", "audit"].map((f) => (
              <button key={f} onClick={() => setTimelineFilter(f)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${timelineFilter === f ? "bg-[var(--royal)] text-white" : "bg-[var(--gray-100)] text-[var(--gray-700)]"}`}>{f}</button>
            ))}
          </div>
          {timeline.filter((e) => timelineFilter === "all" || timelineCategory(e.event_type) === timelineFilter).map((event) => {
            let metadata: any = null;
            try {
              metadata = (event as any).metadata ? JSON.parse((event as any).metadata) : null;
            } catch {
              metadata = null;
            }
            const isStageEvent = event.event_type === "stage_advanced" || event.event_type === "stage_override";
            return (
              <div key={event.id} className={`flex gap-4 rounded-lg border bg-white px-4 py-3 ${isStageEvent ? "border-[var(--royal-pl)]" : "border-[var(--gray-200)]"}`}>
                <div className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${event.event_type === "stage_override" ? "bg-[var(--amb)]" : isStageEvent ? "bg-[var(--royal-lt)]" : "bg-[var(--gray-300)]"}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--gray-900)]">{event.description || event.event_type}</p>
                  <p className="text-xs text-[var(--gray-500)]">
                    {new Date(event.occurred_at).toLocaleString()}
                    {event.performed_by_name && ` by ${event.performed_by_name}`}
                  </p>
                  {metadata?.reason && <p className="mt-1 text-xs text-[var(--amb)]">Override reason: {metadata.reason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {event.stage_from && <StatusBadge status={event.stage_from} />}
                  {isStageEvent && <span className="text-xs text-[var(--gray-400)]">→</span>}
                  {event.stage_to && <StatusBadge status={event.stage_to} />}
                </div>
              </div>
            );
          })}
          {timeline.length === 0 && <p className="text-sm text-[var(--gray-500)]">No events yet.</p>}
        </div>
      )}

      {/* Gate review modal */}
      <Modal
        open={!!gateReview}
        onClose={() => !advanceLoading && setGateReview(null)}
        size="xl"
        title="Gate Review"
        description={gateReview ? `${formatStage(gateReview.currentStage)} → ${formatStage(gateReview.targetStage)}` : undefined}
        footer={
          gateReview && (
            <>
              <Button variant="secondary" onClick={() => setGateReview(null)} disabled={advanceLoading}>Cancel</Button>
              {!gateReview.canAdvance && canOverrideCompliance && (
                <Button variant="danger" onClick={() => handleAdvanceStage(true)} loading={advanceLoading} disabled={!overrideReason.trim()} className="!bg-[var(--amb)]">
                  {advanceLoading ? "Advancing…" : "Override with Reason"}
                </Button>
              )}
              <Button onClick={() => handleAdvanceStage(false)} loading={advanceLoading} disabled={!gateReview.canAdvance}>
                {advanceLoading ? "Advancing…" : `Advance to ${formatStage(gateReview.targetStage)}`}
              </Button>
            </>
          )
        }
      >
        {gateReview && (
          <>
            <div className={`mb-4 rounded-lg p-4 ${gateReview.canAdvance ? "bg-[var(--grn-pl)] text-[var(--grn)]" : "bg-[var(--amb-pl)] text-[var(--amb)]"}`}>
              <p className="text-sm font-semibold">{gateReview.satisfiedCount}/{gateReview.requiredCount} required documents satisfied</p>
              <p className="mt-1 text-sm">
                {gateReview.canAdvance ? "This loan is eligible to advance." : "Resolve the blockers below before advancing, or use an authorized override."}
              </p>
            </div>

            {(gateReview.blockers?.length ?? 0) > 0 && (
              <div className="mb-4 rounded-lg bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">
                <p className="font-semibold">Blockers</p>
                <ul className="mt-1 list-disc pl-5">
                  {gateReview.blockers!.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              </div>
            )}

            {gateReview.warnings.length > 0 && (
              <div className="mb-4 rounded-lg bg-[var(--amb-pl)] p-3 text-sm text-[var(--amb)]">
                <p className="font-semibold">Warnings</p>
                <ul className="mt-1 list-disc pl-5">
                  {gateReview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}

            <div className="mb-4 rounded-xl border border-[var(--gray-200)]">
              <div className="border-b border-[var(--gray-200)] px-4 py-3 text-sm font-semibold text-[var(--gray-900)]">Required documents</div>
              {gateReview.unsatisfied.length === 0 ? (
                <p className="px-4 py-5 text-sm text-[var(--grn)]">All required documents for this gate are satisfied.</p>
              ) : (
                <div className="divide-y divide-[var(--gray-100)]">
                  {gateReview.unsatisfied.map((doc) => {
                    const checklistItem = checklist.find((item) => item.documentType === doc.documentType);
                    return (
                      <div key={doc.documentType} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-[var(--gray-900)]">{doc.displayName}</p>
                          <p className="text-xs text-[var(--red)]">
                            {checklistItem?.status && !["uploaded", "signed", "delivered"].includes(checklistItem.status)
                              ? `Uploaded but status "${checklistItem.status}" is not accepted`
                              : "Missing required document"}
                          </p>
                        </div>
                        {canUploadDocuments && checklistItem && (
                          <Button size="sm" onClick={() => openUpload(checklistItem)}>Upload</Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {advanceError && <div role="alert" className="mb-4 rounded-lg bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">{advanceError}</div>}

            {!gateReview.canAdvance && canOverrideCompliance && (
              <div className="rounded-lg border border-[var(--amb-pl)] bg-[var(--amb-pl)] p-4">
                <Textarea
                  label="Override reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this compliance gate is being overridden…"
                />
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Upload modal */}
      <Modal
        open={!!uploadItem}
        onClose={closeUpload}
        size="lg"
        title={uploadItem?.uploaded ? "Replace document" : "Upload document"}
        description={uploadItem?.displayName}
        footer={
          <>
            <Button variant="secondary" onClick={closeUpload} disabled={uploading}>Cancel</Button>
            <Button onClick={handleUpload} loading={uploading} disabled={!selectedFile}>
              {uploading ? "Uploading…" : uploadItem?.uploaded ? "Replace document" : "Upload document"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-[var(--gray-50)] p-3 text-sm text-[var(--gray-600)]">
            Accepted file types: PDF, DOCX, PNG, JPG/JPEG. Maximum size: {formatBytes(MAX_UPLOAD_BYTES)}.
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-[var(--gray-700)]">Select file</span>
            <input
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
              disabled={uploading}
              className="block w-full rounded-lg border border-[var(--gray-300)] px-3 py-2 text-sm"
            />
          </label>
          {selectedFile && (
            <div className="rounded-lg border border-[var(--grn-pl)] bg-[var(--grn-pl)] p-3 text-sm text-[var(--grn)]">
              Selected: <strong>{selectedFile.name}</strong> ({formatBytes(selectedFile.size)})
            </div>
          )}
          {uploadError && <div role="alert" className="rounded-lg bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">{uploadError}</div>}
        </div>
      </Modal>

      {/* Sticky mobile action bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-[var(--gray-200)] bg-white px-3 py-2.5 shadow-[0_-2px_8px_rgba(0,0,0,0.06)] [padding-bottom:calc(0.625rem+env(safe-area-inset-bottom))] lg:hidden"
        role="toolbar"
        aria-label="Loan actions"
      >
        {canUploadDocuments && (
          <Button variant="secondary" className="flex-1" onClick={quickUpload}>Upload Doc</Button>
        )}
        {showAdvance && (
          <Button className="flex-1" onClick={() => openGateReview(nextStage!)} loading={gateLoading}>
            {gateLoading ? "Checking…" : "Advance Stage"}
          </Button>
        )}
        <Button variant="secondary" onClick={() => setMoreOpen(true)} aria-label="More actions" className="px-4">More</Button>
      </div>

      {/* "More" bottom sheet */}
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} size="sm" title="More actions">
        <div className="flex flex-col gap-2">
          <Button variant="secondary" fullWidth onClick={() => { setTab("overview"); setMoreOpen(false); }}>Overview</Button>
          <Button variant="secondary" fullWidth onClick={() => { setTab("checklist"); setMoreOpen(false); }}>Document checklist</Button>
          <Button variant="secondary" fullWidth onClick={() => { setTab("tasks"); setMoreOpen(false); }}>Tasks</Button>
          <Button variant="secondary" fullWidth onClick={() => { setTab("transaction-log"); setMoreOpen(false); }}>Transaction log</Button>
          <Button variant="secondary" fullWidth onClick={() => { setTab("notes"); setMoreOpen(false); }}>Notes</Button>
          <Button variant="secondary" fullWidth onClick={() => { setTab("timeline"); setMoreOpen(false); }}>Timeline</Button>
          <Link href="/loans" className="mt-1 text-center text-sm font-medium text-[var(--royal)] hover:underline" onClick={() => setMoreOpen(false)}>← Back to all loans</Link>
        </div>
      </Modal>
    </div>
  );
}

const CARD_TONE: Record<string, string> = {
  good: "var(--grn)",
  warn: "var(--amb)",
  danger: "var(--red)",
  neutral: "var(--gray-800)",
};

function OverviewCard({ label, value, tone, onClick }: { label: string; value: string; tone: "good" | "warn" | "danger" | "neutral"; onClick?: () => void }) {
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--gray-500)]">{label}</p>
      <p className="mt-1 text-lg font-bold capitalize" style={{ color: CARD_TONE[tone] }}>{value}</p>
    </>
  );
  const cls = "rounded-xl border border-[var(--gray-200)] bg-white p-3 text-left";
  return onClick ? (
    <button onClick={onClick} className={`${cls} transition hover:border-[var(--royal)] hover:bg-[var(--gray-50)]`}>{inner}</button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

const NOTE_TYPES = ["general", "borrower_follow_up", "lender_follow_up", "processor_note", "compliance_note", "condition_note"];

function NotesTab({ notes, canManage, onCreate, onDelete }: { notes: LoanNote[]; canManage: boolean; onCreate: (body: string, noteType: string) => Promise<boolean>; onDelete: (id: string) => void }) {
  const [body, setBody] = useState("");
  const [noteType, setNoteType] = useState("general");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const ok = await onCreate(body, noteType);
    setSaving(false);
    if (ok) setBody("");
  }

  return (
    <div className="space-y-4">
      {canManage && (
        <Card>
          <form onSubmit={submit} className="space-y-3">
            <Textarea label="Add a note" value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="Processor note, borrower/lender follow-up, condition…" />
            <div className="flex flex-wrap items-end gap-3">
              <Select label="Type" value={noteType} onChange={(e) => setNoteType(e.target.value)} className="w-auto">
                {NOTE_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
              </Select>
              <Button type="submit" loading={saving} disabled={!body.trim()}>Add note</Button>
            </div>
          </form>
        </Card>
      )}
      {notes.length === 0 ? (
        <Card><p className="text-sm text-[var(--gray-500)]">No notes yet.</p></Card>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-[var(--gray-200)] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant={NOTE_TYPE_VARIANT[n.note_type] || "gray"}>{n.note_type.replace(/_/g, " ")}</Badge>
                  {n.visibility === "compliance" && <Badge variant="royal">compliance</Badge>}
                </div>
                {canManage && <button onClick={() => onDelete(n.id)} className="text-xs font-semibold text-[var(--red)] hover:underline">Delete</button>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--gray-800)]">{n.body}</p>
              <p className="mt-1 text-xs text-[var(--gray-400)]">{n.created_by_name || "—"} · {new Date(n.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
