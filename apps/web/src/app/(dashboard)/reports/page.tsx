"use client";

import { useCallback, useEffect, useState } from "react";
import { api, saveBlob } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Table,
  Tabs,
  Textarea,
  useToast,
  type BadgeVariant,
  type Column,
  type ToastOptions,
} from "@/components/ui";

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

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  upcoming: "blue",
  in_progress: "amber",
  filed: "green",
  overdue: "red",
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
  const { toast } = useToast();

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
    { id: "deadlines", label: "Reporting Deadlines" },
    { id: "txlog", label: `TX Transaction Log (${txLog.length})` },
    { id: "evidence", label: "Evidence Packet" },
  ];

  const deadlineColumns: Column<Deadline>[] = [
    { key: "report_type", header: "Report", render: (d) => <span className="font-medium text-[var(--gray-900)]">{d.report_type}</span> },
    { key: "quarter", header: "Quarter", render: (d) => d.quarter || "—" },
    { key: "due_date", header: "Due Date", render: (d) => d.due_date },
    { key: "status", header: "Status", render: (d) => <Badge variant={STATUS_VARIANT[d.status] || "gray"}>{d.status}</Badge> },
    {
      key: "confirmation",
      header: "Confirmation #",
      render: (d) => (
        <span className="text-[var(--gray-600)]">
          {d.confirmation_number || "—"}
          {d.evidence_file_path && (
            <a href="#" onClick={async (e) => { e.preventDefault(); try { saveBlob(await api.download(`/api/v1/reports/deadlines/${d.id}/evidence`), `filing-receipt-${d.id}`); } catch (err: any) { setError(err.message); } }} className="ml-2 text-xs font-semibold text-[var(--royal)] hover:underline">Receipt</a>
          )}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (d) =>
        can("manageReportDeadlines") && d.status !== "filed" ? (
          <Button variant="success" size="sm" onClick={() => setFiling(d)}>File Report</Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" />
      {error && <div role="alert" className="rounded-md bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">{error}</div>}

      <Tabs tabs={tabs} value={tab} onChange={(t) => setTab(t as typeof tab)} aria-label="Report sections" />

      {tab === "deadlines" && (
        <div className="space-y-4">
          {/* Filters */}
          <Card className="flex flex-wrap items-end gap-3">
            <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={DEADLINE_STATUSES} />
            <FilterSelect label="State" value={fState} onChange={setFState} options={STATE_OPTIONS} />
            <div className="w-36">
              <Input label="Quarter" value={fQuarter} onChange={(e) => setFQuarter(e.target.value)} placeholder="Q1-2026" />
            </div>
            <label className="flex items-center gap-2 pb-2.5 text-sm text-[var(--gray-700)]">
              <input type="checkbox" checked={fDueSoon} onChange={(e) => setFDueSoon(e.target.checked)} className="accent-[var(--royal)]" /> Due soon
            </label>
            {(fStatus || fState || fQuarter || fDueSoon) && (
              <Button variant="secondary" onClick={() => { setFStatus(""); setFState(""); setFQuarter(""); setFDueSoon(false); }}>Clear</Button>
            )}
          </Card>

          <Card flush className="overflow-hidden">
            <Table
              columns={deadlineColumns}
              data={deadlines}
              rowKey={(d) => d.id}
              caption="Reporting deadlines"
              emptyState={
                <EmptyState
                  icon={<span className="text-lg">🗓️</span>}
                  title="No deadlines match these filters"
                  description="Adjust or clear the filters above to see reporting deadlines."
                />
              }
            />
          </Card>
        </div>
      )}

      {tab === "txlog" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {can("exportReports") && <Button onClick={downloadCsv}>Export CSV</Button>}
          </div>
          <Card flush className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--gray-200)] text-xs">
              <thead className="bg-[var(--gray-50)]">
                <tr>
                  {["Loan #", "Borrower", "App Date", "Property", "Rate", "Purpose", "Product", "Status"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium uppercase tracking-wider text-[var(--gray-500)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gray-100)]">
                {txLog.map((row, i) => (
                  <tr key={i} className="hover:bg-[var(--gray-50)]">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-[var(--gray-900)]">{row.loan_number}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--gray-700)]">{row.borrower}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--gray-600)]">{row.application_date}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-[var(--gray-600)]">{row.property}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--gray-600)]">{row.interest_rate || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize text-[var(--gray-600)]">{row.loan_purpose}</td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize text-[var(--gray-600)]">{row.loan_product}</td>
                    <td className="whitespace-nowrap px-3 py-2 capitalize text-[var(--gray-600)]">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {tab === "evidence" && <EvidencePacketTab loans={loans} canExport={can("exportReports")} onError={setError} toast={toast} />}

      {filing && (
        <FilingModal
          deadline={filing}
          onClose={() => setFiling(null)}
          onFiled={() => { const d = filing; setFiling(null); loadDeadlines(); toast({ variant: "success", title: "Report filed", description: `${d.report_type}${d.quarter ? ` · ${d.quarter}` : ""} recorded.` }); }}
          onError={(m) => toast({ variant: "error", title: "Filing failed", description: m })}
        />
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-auto">
      <option value="">All</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </Select>
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

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      size="lg"
      title="File report"
      description={`${deadline.report_type}${deadline.quarter ? ` · ${deadline.quarter}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="success" type="submit" form="filing-form" loading={saving}>{saving ? "Saving…" : "Save filing"}</Button>
        </>
      }
    >
      <form id="filing-form" onSubmit={submit} className="space-y-3">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {DEADLINE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Input label="Filed date" type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} />
        <Input label="Confirmation / reference number" value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} placeholder="e.g. NMLS-2026-Q1-00123" />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--gray-700)]">Filing receipt (PDF/image, optional)</span>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm" />
        </label>
      </form>
    </Modal>
  );
}

function EvidencePacketTab({ loans, canExport, onError, toast }: { loans: LoanOption[]; canExport: boolean; onError: (m: string) => void; toast: (o: ToastOptions) => number }) {
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
      toast({ variant: "success", title: "Evidence packet generated", description: "Downloaded as JSON and archived to secure storage." });
    } catch (e: any) {
      onError(e.message || "Could not generate packet");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card className="max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-bold text-[var(--royal)]">Examiner evidence packet</h2>
        <p className="mt-1 text-sm text-[var(--gray-500)]">Generate an exam-ready package: loan summary, compliance checklist, documents, score breakdown, timeline/audit trail, exceptions, and rule citations.</p>
      </div>
      <div className="flex gap-2">
        <Button variant={mode === "loan" ? "primary" : "secondary"} size="sm" onClick={() => setMode("loan")}>Single loan</Button>
        <Button variant={mode === "range" ? "primary" : "secondary"} size="sm" onClick={() => setMode("range")}>Date range</Button>
      </div>

      {mode === "loan" ? (
        <Select label="Loan" value={loanId} onChange={(e) => setLoanId(e.target.value)}>
          <option value="">Select a loan…</option>
          {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_number} — {l.borrower_last_name}, {l.borrower_first_name}</option>)}
        </Select>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      )}

      <Button variant="success" onClick={generate} loading={generating} disabled={mode === "loan" && !loanId}>
        {generating ? "Generating…" : "Generate & download packet"}
      </Button>

      {result && (
        <div className="rounded-lg border border-[var(--grn-pl)] bg-[var(--grn-pl)] p-3 text-sm text-[var(--grn)]">
          <p className="font-semibold">Packet generated.</p>
          <p className="mt-1 text-xs">Downloaded as JSON and archived to secure storage at <code className="break-all">{result.artifactKey}</code>.</p>
          <button onClick={() => saveBlob(new Blob([JSON.stringify(result.packet, null, 2)], { type: "application/json" }), "evidence-packet.json")} className="mt-2 text-xs font-semibold text-[var(--royal)] hover:underline">Download again</button>
        </div>
      )}
    </Card>
  );
}
