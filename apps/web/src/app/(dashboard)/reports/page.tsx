"use client";

import { useCallback, useEffect, useState } from "react";
import { api, saveBlob } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";

interface Deadline {
  id: string;
  report_type: string;
  state_code: string | null;
  quarter: string | null;
  due_date: string;
  status: string;
  notes: string | null;
  confirmation_number?: string | null;
  filed_at?: string | null;
  evidence_file_path?: string | null;
}

interface LoanOption {
  id: string;
  loan_number: string;
  borrower_last_name: string;
  borrower_first_name: string;
}

const STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  filed: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
};
const DEADLINE_STATUSES = ["upcoming", "in_progress", "filed", "overdue"];
const STATE_OPTIONS = ["TX", "CA", "FL", "NY", "IL"];

export default function ReportsPage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [txLog, setTxLog] = useState<any[]>([]);
  const [loans, setLoans] = useState<LoanOption[]>([]);
  const [tab, setTab] = useState<"deadlines" | "txlog" | "evidence">("deadlines");
  const [error, setError] = useState("");
  const { can } = useCapabilities();

  // Deadline filters
  const [fStatus, setFStatus] = useState("");
  const [fState, setFState] = useState("");
  const [fQuarter, setFQuarter] = useState("");
  const [fDueSoon, setFDueSoon] = useState(false);

  const loadDeadlines = useCallback(() => {
    const params = new URLSearchParams();
    if (fStatus) params.set("status", fStatus);
    if (fState) params.set("state", fState);
    if (fQuarter) params.set("quarter", fQuarter);
    if (fDueSoon) params.set("dueSoon", "true");
    const qs = params.toString();
    api
      .get<{ deadlines: Deadline[] }>(`/api/v1/reports/deadlines${qs ? `?${qs}` : ""}`)
      .then((d) => setDeadlines(d.deadlines))
      .catch((e) => setError(e.message));
  }, [fStatus, fState, fQuarter, fDueSoon]);

  useEffect(() => { loadDeadlines(); }, [loadDeadlines]);
  useEffect(() => {
    api.get<{ transactionLog: any[] }>("/api/v1/reports/transaction-log").then((d) => setTxLog(d.transactionLog)).catch(() => {});
    api.get<{ loans: LoanOption[] }>("/api/v1/loans?limit=100").then((d) => setLoans(d.loans)).catch(() => {});
  }, []);

  // ── Filing modal ──
  const [filing, setFiling] = useState<Deadline | null>(null);

  async function downloadCsv() {
    setError("");
    try {
      const blob = await api.download("/api/v1/reports/transaction-log?format=csv");
      saveBlob(blob, "tx_transaction_log.csv");
    } catch (e: any) {
      setError(e.message || "Export failed");
    }
  }

  if (!can("viewReports")) return <InsufficientPermission />;

  const tabs = [
    { key: "deadlines" as const, label: "Reporting Deadlines" },
    { key: "txlog" as const, label: `TX Transaction Log (${txLog.length})` },
    { key: "evidence" as const, label: "Evidence Packet" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`border-b-2 px-1 pb-3 text-sm font-medium ${tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "deadlines" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
            <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={DEADLINE_STATUSES} />
            <FilterSelect label="State" value={fState} onChange={setFState} options={STATE_OPTIONS} />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Quarter</label>
              <input value={fQuarter} onChange={(e) => setFQuarter(e.target.value)} placeholder="Q1-2026" className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/10" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
              <input type="checkbox" checked={fDueSoon} onChange={(e) => setFDueSoon(e.target.checked)} /> Due soon
            </label>
            {(fStatus || fState || fQuarter || fDueSoon) && (
              <button onClick={() => { setFStatus(""); setFState(""); setFQuarter(""); setFDueSoon(false); }} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Clear</button>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {["Report", "Quarter", "Due Date", "Status", "Confirmation #", "Action"].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {deadlines.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.report_type}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{d.quarter || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{d.due_date}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[d.status] || "bg-gray-100 text-gray-600"}`}>{d.status}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {d.confirmation_number || "—"}
                      {d.evidence_file_path && (
                        <a href="#" onClick={async (e) => { e.preventDefault(); try { saveBlob(await api.download(`/api/v1/reports/deadlines/${d.id}/evidence`), `filing-receipt-${d.id}`); } catch (err: any) { setError(err.message); } }} className="ml-2 text-xs font-semibold text-[#1B3A6B] hover:underline">Receipt</a>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {can("manageReportDeadlines") && d.status !== "filed" && (
                        <button onClick={() => setFiling(d)} className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">File Report</button>
                      )}
                    </td>
                  </tr>
                ))}
                {deadlines.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">No deadlines match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "txlog" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {can("exportReports") && <button onClick={downloadCsv} className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-medium text-white hover:bg-[#2B5298]">Export CSV</button>}
          </div>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-xs">
              <thead className="bg-gray-50">
                <tr>
                  {["Loan #", "Borrower", "App Date", "Property", "Rate", "Purpose", "Product", "Status"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium tracking-wider text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {txLog.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-gray-900">{row.loan_number}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{row.borrower}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{row.application_date}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-gray-600">{row.property}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{row.interest_rate || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize text-gray-600">{row.loan_purpose}</td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize text-gray-600">{row.loan_product}</td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize text-gray-600">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "evidence" && <EvidencePacketTab loans={loans} canExport={can("exportReports")} onError={setError} />}

      {filing && <FilingModal deadline={filing} onClose={() => setFiling(null)} onFiled={() => { setFiling(null); loadDeadlines(); }} onError={setError} />}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/10">
        <option value="">All</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FilingModal({ deadline, onClose, onFiled, onError }: { deadline: Deadline; onClose: () => void; onFiled: () => void; onError: (m: string) => void }) {
  const [status, setStatus] = useState("filed");
  const [filedDate, setFiledDate] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("status", status);
      if (filedDate) fd.append("filedDate", filedDate);
      if (confirmationNumber) fd.append("confirmationNumber", confirmationNumber);
      if (notes) fd.append("notes", notes);
      if (file) fd.append("file", file);
      await api.upload(`/api/v1/reports/deadlines/${deadline.id}/file`, fd);
      onFiled();
    } catch (err: any) {
      onError(err.message || "Filing failed");
    } finally {
      setSaving(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/10";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-gray-900">File report</h2>
        <p className="mt-1 text-sm text-gray-500">{deadline.report_type}{deadline.quarter ? ` · ${deadline.quarter}` : ""}</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={input}>
              {DEADLINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Filed date</label>
            <input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Confirmation / reference number</label>
            <input value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} className={input} placeholder="e.g. NMLS-2026-Q1-00123" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={input} />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Filing receipt (PDF/image, optional)</label>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="mt-1 w-full text-sm" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">{saving ? "Saving..." : "Save filing"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EvidencePacketTab({ loans, canExport, onError }: { loans: LoanOption[]; canExport: boolean; onError: (m: string) => void }) {
  const [mode, setMode] = useState<"loan" | "range">("loan");
  const [loanId, setLoanId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ artifactKey: string; generatedAt: string; packet: any } | null>(null);

  if (!canExport) return <InsufficientPermission />;

  async function generate() {
    setGenerating(true);
    onError("");
    try {
      const body = mode === "loan" ? { loanId } : { from: from || undefined, to: to || undefined };
      const res = await api.post<{ packet: any; artifactKey: string; generatedAt: string }>("/api/v1/reports/evidence-packet", body);
      setResult(res);
      saveBlob(new Blob([JSON.stringify(res.packet, null, 2)], { type: "application/json" }), `evidence-packet-${mode === "loan" ? loanId : "range"}.json`);
    } catch (e: any) {
      onError(e.message || "Could not generate packet");
    } finally {
      setGenerating(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/10";
  return (
    <div className="max-w-xl space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div>
        <h2 className="text-lg font-bold text-[#1B3A6B]">Examiner evidence packet</h2>
        <p className="mt-1 text-sm text-gray-500">Generate an exam-ready package: loan summary, compliance checklist, documents, score breakdown, timeline/audit trail, exceptions, and rule citations.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={() => setMode("loan")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "loan" ? "bg-[#1B3A6B] text-white" : "border border-gray-300 text-gray-700"}`}>Single loan</button>
        <button onClick={() => setMode("range")} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === "range" ? "bg-[#1B3A6B] text-white" : "border border-gray-300 text-gray-700"}`}>Date range</button>
      </div>

      {mode === "loan" ? (
        <div>
          <label className="text-sm font-medium text-gray-700">Loan</label>
          <select value={loanId} onChange={(e) => setLoanId(e.target.value)} className={input}>
            <option value="">Select a loan…</option>
            {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_number} — {l.borrower_last_name}, {l.borrower_first_name}</option>)}
          </select>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-sm font-medium text-gray-700">From</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} /></div>
          <div><label className="text-sm font-medium text-gray-700">To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} /></div>
        </div>
      )}

      <button onClick={generate} disabled={generating || (mode === "loan" && !loanId)} className="rounded-lg bg-[#0F7B46] px-4 py-2 text-sm font-semibold text-white hover:bg-[#15A35E] disabled:opacity-50">
        {generating ? "Generating…" : "Generate & download packet"}
      </button>

      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <p className="font-semibold">Packet generated.</p>
          <p className="mt-1 text-xs">Downloaded as JSON and archived to secure storage at <code className="break-all">{result.artifactKey}</code>.</p>
          <button onClick={() => saveBlob(new Blob([JSON.stringify(result.packet, null, 2)], { type: "application/json" }), "evidence-packet.json")} className="mt-2 text-xs font-semibold text-[#1B3A6B] hover:underline">Download again</button>
        </div>
      )}
    </div>
  );
}
