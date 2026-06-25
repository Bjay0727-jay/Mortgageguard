"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";
import { useCapabilities } from "@/lib/capabilities";

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
  const [loan, setLoan] = useState<Loan | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [tab, setTab] = useState<"details" | "checklist" | "timeline">("details");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
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

  async function refreshAfterUpload() {
    await Promise.all([refreshLoan(), refreshChecklist(), refreshTimeline()]);
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
      setToast({ type: "error", message: e.message || "Unable to load gate review" });
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
      setToast({ type: "success", message: `Advanced to ${formatStage(gateReview.targetStage)}.` });
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
  }, [id]);

  function openUpload(item: ChecklistItem) {
    setUploadItem(item);
    setSelectedFile(null);
    setUploadError("");
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
      setToast({ type: "success", message: `${uploadItem.displayName} uploaded successfully.` });
      closeUpload();
    } catch (e: any) {
      const message = e.message || "Upload failed";
      setUploadError(message);
      setToast({ type: "error", message });
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
      setToast({ type: "error", message: e.message || "Download failed" });
    } finally {
      setDownloadingDocId(null);
    }
  }

  if (error) return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!loan) return <p className="text-gray-500">Loading...</p>;

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

  const tabs = [
    { key: "details", label: "Loan Details" },
    { key: "checklist", label: `Checklist (${checklist.filter((c) => c.uploaded).length}/${checklist.length})` },
    { key: "timeline", label: "Timeline" },
  ] as const;

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`rounded-md p-3 text-sm ${toast.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
          <div className="flex items-center justify-between gap-3">
            <span>{toast.message}</span>
            <button onClick={() => setToast(null)} className="font-semibold">Dismiss</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4">
        <Link href="/loans" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Loans
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">{loan.loan_number}</h1>
        <StatusBadge status={loan.status} />
        <ScoreBadge score={loan.compliance_score} />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-gray-500">Current: <strong className="text-gray-800">{formatStage(loan.status)}</strong></span>
          {can("advanceLoanStage") && nextStage && !isTerminalStage && (
            <button
              onClick={() => openGateReview(nextStage)}
              disabled={gateLoading}
              className="rounded-lg bg-[#1B3A6B] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {gateLoading ? "Checking Gate..." : `Advance to ${formatStage(nextStage)}`}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-3">
        <div>
          <p className="text-xs text-gray-500">Borrower</p>
          <p className="text-sm font-medium text-gray-900">
            {loan.borrower_last_name}, {loan.borrower_first_name}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Property</p>
          <p className="text-sm font-medium text-gray-900">
            {loan.property_address}, {loan.property_city}, {loan.property_state} {loan.property_zip}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Amount</p>
          <p className="text-sm font-medium text-gray-900">{loan.loan_amount ? fmt(loan.loan_amount) : "—"}</p>
        </div>
      </div>

      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                tab === t.key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "details" && (
        <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-5 sm:grid-cols-3">
          {[
            ["Purpose", loan.loan_purpose],
            ["Product", loan.loan_product],
            ["Type", loan.loan_type],
            ["Rate", loan.interest_rate ? `${loan.interest_rate}%` : "—"],
            ["Term", loan.loan_term ? `${loan.loan_term} mo` : "—"],
            ["Lien", loan.lien_position],
            ["Occupancy", loan.occupancy_type],
            ["Application", loan.application_date],
            ["Closing", loan.closing_date || "—"],
            ["Originator", loan.originator_name || "—"],
            ["Docs", `${loan.docs_complete}/${loan.docs_required}`],
            ["Score", `${loan.compliance_score}%`],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs text-gray-500">{label}</p>
              <p className="text-sm font-medium capitalize text-gray-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "checklist" && (
        <div className="rounded-xl border border-gray-200 bg-white">
          {checklist.length === 0 ? (
            <div className="p-8 text-center">
              <div className="mb-2 text-3xl">⏳</div>
              <p className="text-sm font-medium text-gray-900">Checklist is being generated</p>
              <p className="mt-1 text-sm text-gray-500">Refresh shortly to see required compliance documents.</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Document</th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Stage</th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">File</th>
                  <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {checklist.map((item) => {
                  const statusLabel = item.isSigned ? "Signed" : item.uploaded ? "Uploaded" : "Missing";
                  return (
                    <tr key={item.documentType} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{item.displayName}</p>
                        <span className={`text-xs ${item.isMandatory ? "text-red-600" : "text-gray-500"}`}>
                          {item.isMandatory ? "Required" : "Recommended"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm capitalize text-gray-600">{item.source}</td>
                      <td className="px-4 py-3 text-sm capitalize text-gray-600">{item.pipelineStage || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          item.isSigned ? "bg-blue-100 text-blue-800" : item.uploaded ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600"
                        }`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {item.uploaded ? (
                          <div>
                            <p className="font-medium text-gray-900">{item.fileName}</p>
                            <p>{formatBytes(item.fileSize)}{item.uploadedAt ? ` · ${new Date(item.uploadedAt).toLocaleDateString()}` : ""}</p>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {item.uploaded && (
                            <button
                              onClick={() => downloadDocument(item)}
                              disabled={downloadingDocId === item.documentId}
                              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {downloadingDocId === item.documentId ? "Downloading..." : "View / Download"}
                            </button>
                          )}
                          {canUploadDocuments && (
                            <button
                              onClick={() => openUpload(item)}
                              className="rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298]"
                            >
                              {item.uploaded ? "Replace" : "Upload"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "timeline" && (
        <div className="space-y-3">
          {timeline.map((event) => {
            let metadata: any = null;
            try {
              metadata = (event as any).metadata ? JSON.parse((event as any).metadata) : null;
            } catch {
              metadata = null;
            }
            const isStageEvent = event.event_type === "stage_advanced" || event.event_type === "stage_override";
            return (
              <div key={event.id} className={`flex gap-4 rounded-lg border bg-white px-4 py-3 ${isStageEvent ? "border-blue-200" : "border-gray-200"}`}>
                <div className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${event.event_type === "stage_override" ? "bg-amber-500" : isStageEvent ? "bg-blue-500" : "bg-gray-300"}`} />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{event.description || event.event_type}</p>
                  <p className="text-xs text-gray-500">
                    {new Date(event.occurred_at).toLocaleString()}
                    {event.performed_by_name && ` by ${event.performed_by_name}`}
                  </p>
                  {metadata?.reason && <p className="mt-1 text-xs text-amber-700">Override reason: {metadata.reason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {event.stage_from && <StatusBadge status={event.stage_from} />}
                  {isStageEvent && <span className="text-xs text-gray-400">→</span>}
                  {event.stage_to && <StatusBadge status={event.stage_to} />}
                </div>
              </div>
            );
          })}
          {timeline.length === 0 && (
            <p className="text-sm text-gray-500">No events yet.</p>
          )}
        </div>
      )}

      {gateReview && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={(e) => e.target === e.currentTarget && !advanceLoading && setGateReview(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Gate Review</h2>
                <p className="mt-1 text-sm text-gray-600">
                  {formatStage(gateReview.currentStage)} → {formatStage(gateReview.targetStage)}
                </p>
              </div>
              <button onClick={() => setGateReview(null)} disabled={advanceLoading} className="text-2xl leading-none text-gray-400 hover:text-gray-600">&times;</button>
            </div>

            <div className={`mb-4 rounded-lg p-4 ${gateReview.canAdvance ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
              <p className="text-sm font-semibold">
                {gateReview.satisfiedCount}/{gateReview.requiredCount} required documents satisfied
              </p>
              <p className="mt-1 text-sm">
                {gateReview.canAdvance ? "This loan is eligible to advance." : "Resolve the blockers below before advancing, or use an authorized override."}
              </p>
            </div>

            {/* Blockers prevent advancement (unless overridden). Distinct from warnings. */}
            {(gateReview.blockers?.length ?? 0) > 0 && (
              <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <p className="font-semibold">Blockers</p>
                <ul className="mt-1 list-disc pl-5">
                  {gateReview.blockers!.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              </div>
            )}

            {/* Warnings are informational only and never block advancement. */}
            {gateReview.warnings.length > 0 && (
              <div className="mb-4 rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800">
                <p className="font-semibold">Warnings</p>
                <ul className="mt-1 list-disc pl-5">
                  {gateReview.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </div>
            )}

            <div className="mb-4 rounded-xl border border-gray-200">
              <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Required documents</div>
              {gateReview.unsatisfied.length === 0 ? (
                <p className="px-4 py-5 text-sm text-green-700">All required documents for this gate are satisfied.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {gateReview.unsatisfied.map((doc) => {
                    const checklistItem = checklist.find((item) => item.documentType === doc.documentType);
                    return (
                      <div key={doc.documentType} className="flex items-center justify-between gap-4 px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{doc.displayName}</p>
                          <p className="text-xs text-red-600">
                            {checklistItem?.status && !["uploaded", "signed", "delivered"].includes(checklistItem.status)
                              ? `Uploaded but status "${checklistItem.status}" is not accepted`
                              : "Missing required document"}
                          </p>
                        </div>
                        {canUploadDocuments && checklistItem && (
                          <button
                            onClick={() => openUpload(checklistItem)}
                            className="rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298]"
                          >
                            Upload
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {advanceError && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{advanceError}</div>}

            {!gateReview.canAdvance && canOverrideCompliance && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
                <label className="block text-sm font-semibold text-amber-900">Override reason</label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Explain why this compliance gate is being overridden..."
                />
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => setGateReview(null)} disabled={advanceLoading} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">Cancel</button>
              {!gateReview.canAdvance && canOverrideCompliance && (
                <button
                  onClick={() => handleAdvanceStage(true)}
                  disabled={advanceLoading || !overrideReason.trim()}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {advanceLoading ? "Advancing..." : "Override with Reason"}
                </button>
              )}
              <button
                onClick={() => handleAdvanceStage(false)}
                disabled={advanceLoading || !gateReview.canAdvance}
                className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {advanceLoading ? "Advancing..." : `Advance to ${formatStage(gateReview.targetStage)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => e.target === e.currentTarget && closeUpload()}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">{uploadItem.uploaded ? "Replace document" : "Upload document"}</h2>
                <p className="mt-1 text-sm text-gray-600">{uploadItem.displayName}</p>
              </div>
              <button onClick={closeUpload} disabled={uploading} className="text-2xl leading-none text-gray-400 hover:text-gray-600">&times;</button>
            </div>

            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                Accepted file types: PDF, DOCX, PNG, JPG/JPEG. Maximum size: {formatBytes(MAX_UPLOAD_BYTES)}.
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-gray-700">Select file</span>
                <input
                  type="file"
                  accept={ACCEPTED_EXTENSIONS}
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  disabled={uploading}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              {selectedFile && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  Selected: <strong>{selectedFile.name}</strong> ({formatBytes(selectedFile.size)})
                </div>
              )}
              {uploadError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>}
              <div className="flex justify-end gap-3">
                <button onClick={closeUpload} disabled={uploading} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">Cancel</button>
                <button
                  onClick={handleUpload}
                  disabled={!selectedFile || uploading}
                  className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {uploading ? "Uploading..." : uploadItem.uploaded ? "Replace document" : "Upload document"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
