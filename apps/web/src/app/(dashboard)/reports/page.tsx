"use client";

import { useCallback, useEffect, useState } from "react";
import { api, saveBlob } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import {
  buildTransactionLogUrl,
  deadlineStatusVariant,
  deadlineSummaryCards,
  effectiveStatus,
  periodLabel,
  validateFiling,
  type Deadline,
  type ReportingSummary,
} from "@/lib/reporting";
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
  type Column,
  type ToastOptions,
} from "@/components/ui";

interface LoanOption {
  id: string;
  loan_number: string;
  borrower_last_name: string;
  borrower_first_name: string;
}

interface TxLogResult {
  rowCount: number;
  warningCount: number;
  rulesLoaded: boolean;
  rows: Record<string, unknown>[];
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
}

const DEADLINE_STATUSES = ["upcoming", "due_soon", "due", "overdue", "filed", "not_applicable"];
const JURISDICTIONS = ["TX"];

const CARD_TONE: Record<string, string> = {
  neutral: "var(--gray-700)",
  info: "var(--royal)",
  warn: "var(--amber)",
  danger: "var(--red)",
  good: "var(--grn)",
};

export default function ReportsPage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [summary, setSummary] = useState<ReportingSummary | null>(null);
  const [loans, setLoans] = useState<LoanOption[]>([]);
  const [tab, setTab] = useState<"deadlines" | "txlog" | "evidence">("deadlines");
  const [error, setError] = useState("");
  const [settingUp, setSettingUp] = useState(false);
  const { can } = useCapabilities();
  const { toast } = useToast();

  // Deadline filters
  const [fStatus, setFStatus] = useState("");
  const [fJurisdiction, setFJurisdiction] = useState("");
  const [fDueSoon, setFDueSoon] = useState(false);

  const loadDeadlines = useCallback(() => {
    const params = new URLSearchParams();
    if (fStatus) params.set("status", fStatus);
    if (fJurisdiction) params.set("jurisdiction", fJurisdiction);
    if (fDueSoon) params.set("dueSoon", "true");
    const qs = params.toString();
    api
      .get<{ summary: ReportingSummary; deadlines: Deadline[] }>(`/api/v1/reports/deadlines${qs ? `?${qs}` : ""}`)
      .then((d) => { setDeadlines(d.deadlines); setSummary(d.summary); })
      .catch((e) => setError(e.message));
  }, [fStatus, fJurisdiction, fDueSoon]);

  useEffect(() => { loadDeadlines(); }, [loadDeadlines]);
  useEffect(() => {
    api.get<{ loans: LoanOption[] }>("/api/v1/loans?limit=100").then((d) => setLoans(d.loans)).catch(() => {});
  }, []);

  // ── Modals ──
  const [filing, setFiling] = useState<Deadline | null>(null);
  const [receiptFor, setReceiptFor] = useState<Deadline | null>(null);

  async function setupDeadlines() {
    setSettingUp(true);
    setError("");
    try {
      const res = await api.post<{ created: number; skipped: number; entityType: string | null }>("/api/v1/reports/setup-deadlines", { jurisdiction: "TX" });
      loadDeadlines();
      toast({ variant: "success", title: "Reporting deadlines ready", description: `${res.created} created, ${res.skipped} already present (entity: ${res.entityType || "unknown"}).` });
    } catch (e: any) {
      setError(e.message || "Could not set up deadlines");
    } finally {
      setSettingUp(false);
    }
  }

  if (!can("viewReports")) return <InsufficientPermission />;

  const tabs = [
    { id: "deadlines", label: "Reporting Deadlines" },
    { id: "txlog", label: "TX Transaction Log" },
    { id: "evidence", label: "Evidence Packet" },
  ];

  const cards = deadlineSummaryCards(summary);

  const deadlineColumns: Column<Deadline>[] = [
    { key: "report_type", header: "Report", render: (d) => <span className="font-medium text-[var(--gray-900)]">{d.report_type}</span> },
    { key: "jurisdiction", header: "Jurisdiction", render: (d) => d.jurisdiction || d.state_code || "—" },
    { key: "period", header: "Period", render: (d) => <span className="text-[var(--gray-600)]">{periodLabel(d)}</span> },
    { key: "due_date", header: "Due Date", render: (d) => d.due_date },
    { key: "status", header: "Status", render: (d) => <Badge variant={deadlineStatusVariant(effectiveStatus(d))}>{effectiveStatus(d).replace(/_/g, " ")}</Badge> },
    { key: "filed_at", header: "Filed", render: (d) => (d.filed_at ? String(d.filed_at).slice(0, 10) : "—") },
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
      header: "Actions",
      render: (d) => (
        <div className="flex flex-wrap gap-1.5">
          {can("fileReports") && effectiveStatus(d) !== "filed" && (
            <Button variant="success" size="sm" onClick={() => setFiling(d)}>Mark filed</Button>
          )}
          {can("uploadReportReceipts") && (
            <Button variant="secondary" size="sm" onClick={() => setReceiptFor(d)}>Receipt</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" />
      {error && <div role="alert" className="rounded-md bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">{error}</div>}

      <Tabs tabs={tabs} value={tab} onChange={(t) => setTab(t as typeof tab)} aria-label="Report sections" />

      {tab === "deadlines" && (
        <div className="space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {cards.map((c) => (
              <Card key={c.key} className="text-center">
                <div className="text-2xl font-bold" style={{ color: CARD_TONE[c.tone] }}>{c.value}</div>
                <div className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--gray-500)]">{c.label}</div>
              </Card>
            ))}
          </div>

          {/* Setup + filters */}
          <Card className="flex flex-wrap items-end gap-3">
            <FilterSelect label="Status" value={fStatus} onChange={setFStatus} options={DEADLINE_STATUSES} />
            <FilterSelect label="Jurisdiction" value={fJurisdiction} onChange={setFJurisdiction} options={JURISDICTIONS} />
            <label className="flex items-center gap-2 pb-2.5 text-sm text-[var(--gray-700)]">
              <input type="checkbox" checked={fDueSoon} onChange={(e) => setFDueSoon(e.target.checked)} className="accent-[var(--royal)]" /> Due soon
            </label>
            {(fStatus || fJurisdiction || fDueSoon) && (
              <Button variant="secondary" onClick={() => { setFStatus(""); setFJurisdiction(""); setFDueSoon(false); }}>Clear</Button>
            )}
            {can("setupReportingDeadlines") && (
              <div className="ml-auto">
                <Button onClick={setupDeadlines} loading={settingUp}>Set up reporting deadlines</Button>
              </div>
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
                  title="No reporting deadlines yet"
                  description={can("setupReportingDeadlines") ? "Use “Set up reporting deadlines” to generate RMLA, SSSF, and Financial Condition due dates." : "Ask an administrator to set up reporting deadlines."}
                />
              }
            />
          </Card>
        </div>
      )}

      {tab === "txlog" && <TransactionLogTab canExport={can("exportReports")} onError={setError} toast={toast} />}

      {tab === "evidence" && <EvidencePacketTab loans={loans} canExport={can("exportReports")} onError={setError} toast={toast} />}

      {filing && (
        <FilingModal
          deadline={filing}
          onClose={() => setFiling(null)}
          onFiled={() => { const d = filing; setFiling(null); loadDeadlines(); toast({ variant: "success", title: "Report filed", description: `${d.report_type}${d.quarter ? ` · ${d.quarter}` : ""} recorded.` }); }}
          onError={(m) => toast({ variant: "error", title: "Filing failed", description: m })}
        />
      )}

      {receiptFor && (
        <ReceiptModal
          deadline={receiptFor}
          onClose={() => setReceiptFor(null)}
          onUploaded={() => { setReceiptFor(null); loadDeadlines(); toast({ variant: "success", title: "Receipt uploaded", description: "Filing receipt stored and linked to the deadline." }); }}
          onError={(m) => toast({ variant: "error", title: "Upload failed", description: m })}
        />
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-auto">
      <option value="">All</option>
      {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
    </Select>
  );
}

// ── Texas transaction log export + preview ──
function TransactionLogTab({ canExport, onError, toast }: { canExport: boolean; onError: (m: string) => void; toast: (o: ToastOptions) => number }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState<TxLogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    onError("");
    try {
      const data = await api.get<TxLogResult>(buildTransactionLogUrl({ jurisdiction: "TX", from: from || undefined, to: to || undefined }));
      setResult(data);
    } catch (e: any) {
      onError(e.message || "Could not load transaction log");
    } finally {
      setLoading(false);
    }
  }, [from, to, onError]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  async function exportCsv() {
    setExporting(true);
    onError("");
    try {
      const blob = await api.download(buildTransactionLogUrl({ jurisdiction: "TX", from: from || undefined, to: to || undefined, format: "csv" }));
      saveBlob(blob, `mortgageguard-tx-transaction-log-${from || "all"}-to-${to || "all"}.csv`);
      toast({ variant: "success", title: "Transaction log exported", description: "Downloaded a formula-safe, Excel-compatible CSV." });
    } catch (e: any) {
      onError(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const previewKeys = result?.rows?.length ? Object.keys(result.rows[0]).slice(0, 8) : [];

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3">
        <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button variant="secondary" onClick={loadPreview} loading={loading}>Preview</Button>
        {canExport && <Button onClick={exportCsv} loading={exporting} disabled={!result || result.rowCount === 0}>Export CSV</Button>}
      </Card>

      {result && (
        <>
          {result.warnings.length > 0 && (
            <div role="status" className="rounded-md bg-[var(--amber-pl,#FEF3C7)] p-3 text-sm text-[var(--amber,#92400E)]">
              <p className="font-semibold">{result.warningCount} warning(s) for this period:</p>
              <ul className="mt-1 list-disc pl-5">
                {result.warnings.slice(0, 8).map((w) => <li key={w}>{w}</li>)}
                {result.warnings.length > 8 && <li>…and {result.warnings.length - 8} more.</li>}
              </ul>
            </div>
          )}
          {!result.rulesLoaded && (
            <div role="status" className="rounded-md bg-[var(--amber-pl,#FEF3C7)] p-3 text-sm text-[var(--amber,#92400E)]">
              Texas compliance rules are not loaded — transaction-log completeness may be inaccurate.
            </div>
          )}
          <Card flush className="overflow-x-auto">
            {result.rowCount === 0 ? (
              <div className="p-6">
                <EmptyState icon={<span className="text-lg">📄</span>} title="No Texas loans for this period" description="Adjust the date range or create Texas loans to populate the transaction log." />
              </div>
            ) : (
              <table className="min-w-full divide-y divide-[var(--gray-200)] text-xs">
                <thead className="bg-[var(--gray-50)]">
                  <tr>
                    {previewKeys.map((k) => (
                      <th key={k} className="whitespace-nowrap px-3 py-2 text-left font-medium uppercase tracking-wider text-[var(--gray-500)]">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--gray-100)]">
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-[var(--gray-50)]">
                      {previewKeys.map((k) => (
                        <td key={k} className="max-w-[200px] truncate whitespace-nowrap px-3 py-2 text-[var(--gray-700)]">{String(row[k] ?? "—")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function FilingModal({ deadline, onClose, onFiled, onError }: { deadline: Deadline; onClose: () => void; onFiled: () => void; onError: (m: string) => void }) {
  const [filedAt, setFiledAt] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateFiling({ filedAt, confirmationNumber });
    if (v) { setFormError(v); return; }
    setFormError("");
    setSaving(true);
    try {
      await api.post(`/api/v1/reports/deadlines/${deadline.id}/file`, {
        filedAt: filedAt || undefined,
        confirmationNumber: confirmationNumber || undefined,
        notes: notes || undefined,
      });
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
      title="Record report filing"
      description={`${deadline.report_type}${deadline.quarter ? ` · ${deadline.quarter}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="success" type="submit" form="filing-form" loading={saving}>{saving ? "Saving…" : "Save filing"}</Button>
        </>
      }
    >
      <form id="filing-form" onSubmit={submit} className="space-y-3">
        {formError && <div role="alert" className="rounded-md bg-[var(--red-pl)] p-2.5 text-sm text-[var(--red)]">{formError}</div>}
        <Input label="Filed date" type="date" value={filedAt} onChange={(e) => setFiledAt(e.target.value)} />
        <Input label="Confirmation / reference number" value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} placeholder="e.g. NMLS-2026-Q1-00123" />
        <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        <p className="text-xs text-[var(--gray-500)]">Upload the filing receipt separately with the “Receipt” action after recording the filing.</p>
      </form>
    </Modal>
  );
}

function ReceiptModal({ deadline, onClose, onUploaded, onError }: { deadline: Deadline; onClose: () => void; onUploaded: () => void; onError: (m: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.upload(`/api/v1/reports/deadlines/${deadline.id}/receipt`, fd);
      onUploaded();
    } catch (err: any) {
      onError(err.message || "Upload failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      title="Upload filing receipt"
      description={`${deadline.report_type}${deadline.quarter ? ` · ${deadline.quarter}` : ""}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="success" type="submit" form="receipt-form" loading={saving} disabled={!file}>{saving ? "Uploading…" : "Upload receipt"}</Button>
        </>
      }
    >
      <form id="receipt-form" onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-[var(--gray-700)]">Filing receipt (PDF or image)</span>
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
