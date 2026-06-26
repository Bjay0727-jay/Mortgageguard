"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, saveBlob } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import {
  PACKET_TYPES,
  packetTypeFields,
  buildGenerateRequest,
  canGenerate,
  packetStatusVariant,
  summaryStatusVariant,
  packetFormats,
  type PacketType,
  type GenerateForm,
} from "@/lib/evidence-packets";
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
  useToast,
  type Column,
} from "@/components/ui";

interface PacketRow {
  id: string;
  packet_key: string;
  packet_type: string;
  title: string;
  status: string;
  generated_at: string;
  generated_by?: string | null;
  warning_count: number;
  blocker_count: number;
  hash?: string | null;
}

interface LoanOption {
  id: string;
  loan_number: string;
  borrower_last_name: string;
  borrower_first_name: string;
}

export default function EvidencePacketsPage() {
  const { can } = useCapabilities();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const initialType = (["loan", "programs", "reporting", "examination"] as const).find((t) => t === searchParams.get("type")) ?? "loan";
  const initialLoanId = searchParams.get("loanId") ?? undefined;
  const [packets, setPackets] = useState<PacketRow[]>([]);
  const [loans, setLoans] = useState<LoanOption[]>([]);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<any | null>(null);

  const load = useCallback(() => {
    api.get<{ packets: PacketRow[] }>("/api/v1/evidence-packets").then((d) => setPackets(d.packets)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (can("generateEvidencePackets")) api.get<{ loans: LoanOption[] }>("/api/v1/loans?limit=100").then((d) => setLoans(d.loans)).catch(() => {});
  }, [can]);

  if (!can("viewEvidencePackets")) return <InsufficientPermission />;

  async function downloadPacket(id: string, format: "json" | "html") {
    try {
      const blob = await api.download(`/api/v1/evidence-packets/${id}/download?format=${format}`);
      saveBlob(blob, `evidence-packet-${id}.${format}`);
    } catch (e: any) {
      setError(e.message || "Download failed");
    }
  }

  async function viewPacket(id: string) {
    setError("");
    try {
      const blob = await api.download(`/api/v1/evidence-packets/${id}/download?format=json`);
      setDetail(JSON.parse(await blob.text()));
    } catch (e: any) {
      setError(e.message || "Could not load packet");
    }
  }

  async function deletePacket(id: string) {
    try {
      await api.delete(`/api/v1/evidence-packets/${id}`);
      load();
      toast({ variant: "success", title: "Packet deleted", description: "The evidence packet was removed from history." });
    } catch (e: any) {
      setError(e.message || "Delete failed");
    }
  }

  const columns: Column<PacketRow>[] = [
    { key: "title", header: "Packet", render: (p) => <span className="font-medium text-[var(--gray-900)]">{p.title}</span> },
    { key: "packet_type", header: "Type", render: (p) => <span className="capitalize text-[var(--gray-600)]">{p.packet_type}</span> },
    { key: "generated_at", header: "Generated", render: (p) => String(p.generated_at).slice(0, 16).replace("T", " ") },
    { key: "status", header: "Status", render: (p) => <Badge variant={packetStatusVariant(p.status)}>{p.status}</Badge> },
    { key: "warnings", header: "Warnings", render: (p) => p.warning_count ?? 0 },
    { key: "blockers", header: "Blockers", render: (p) => <span className={p.blocker_count ? "font-semibold text-[var(--red)]" : ""}>{p.blocker_count ?? 0}</span> },
    {
      key: "actions",
      header: "Actions",
      render: (p) => (
        <div className="flex flex-wrap gap-1.5">
          {packetFormats(p.status).length > 0 && can("downloadEvidencePackets") && (
            <>
              <Button size="sm" variant="secondary" onClick={() => viewPacket(p.id)}>View</Button>
              <Button size="sm" variant="secondary" onClick={() => downloadPacket(p.id, "json")}>JSON</Button>
              <Button size="sm" variant="secondary" onClick={() => downloadPacket(p.id, "html")}>HTML</Button>
            </>
          )}
          {can("deleteEvidencePackets") && (
            <Button size="sm" variant="danger" onClick={() => deletePacket(p.id)}>Delete</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Evidence Packets" description="Assemble examiner-ready evidence for loans, programs, reporting, and full examination readiness." />
      {error && <div role="alert" className="rounded-md bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">{error}</div>}

      {can("generateEvidencePackets") && <GeneratePanel loans={loans} initialType={initialType} initialLoanId={initialLoanId} onGenerated={load} onError={setError} toast={toast} />}

      <Card flush className="overflow-hidden">
        <Table
          columns={columns}
          data={packets}
          rowKey={(p) => p.id}
          caption="Evidence packet history"
          emptyState={<EmptyState icon={<span className="text-lg">📦</span>} title="No evidence packets yet" description="Generate a packet above to start your examiner-ready history." />}
        />
      </Card>

      {detail && <PacketDetailModal packet={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function GeneratePanel({ loans, initialType, initialLoanId, onGenerated, onError, toast }: { loans: LoanOption[]; initialType: PacketType; initialLoanId?: string; onGenerated: () => void; onError: (m: string) => void; toast: (o: any) => number }) {
  const [type, setType] = useState<PacketType>(initialType);
  const [form, setForm] = useState<GenerateForm>({ jurisdiction: "TX", loanId: initialLoanId });
  const [generating, setGenerating] = useState(false);
  const fields = packetTypeFields(type);

  function set<K extends keyof GenerateForm>(key: K, value: GenerateForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function generate() {
    setGenerating(true);
    onError("");
    try {
      const { path, body } = buildGenerateRequest(type, form);
      const res = await api.post<{ packet: { title: string; summary: { status: string; blockerCount: number; warningCount: number } } }>(path, body);
      onGenerated();
      toast({ variant: res.packet.summary.blockerCount > 0 ? "error" : "success", title: "Packet generated", description: `${res.packet.title} — ${res.packet.summary.status} (${res.packet.summary.blockerCount} blockers, ${res.packet.summary.warningCount} warnings).` });
    } catch (e: any) {
      onError(e.message || "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-bold text-[var(--royal)]">Generate packet</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Packet type" value={type} onChange={(e) => setType(e.target.value as PacketType)}>
          {PACKET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Select>
        {fields.loanSelector && (
          <Select label="Loan" value={form.loanId || ""} onChange={(e) => set("loanId", e.target.value)}>
            <option value="">Select a loan…</option>
            {loans.map((l) => <option key={l.id} value={l.id}>{l.loan_number} — {l.borrower_last_name}, {l.borrower_first_name}</option>)}
          </Select>
        )}
        {fields.jurisdiction && (
          <Select label="Jurisdiction" value={form.jurisdiction || "TX"} onChange={(e) => set("jurisdiction", e.target.value)}>
            <option value="TX">TX</option>
          </Select>
        )}
        {fields.dateRange && (
          <>
            <Input label="Period start" type="date" value={form.periodStart || ""} onChange={(e) => set("periodStart", e.target.value)} />
            <Input label="Period end" type="date" value={form.periodEnd || ""} onChange={(e) => set("periodEnd", e.target.value)} />
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-[var(--gray-700)]">
        {fields.includeDocuments && <Toggle label="Include documents" checked={form.includeDocuments !== false} onChange={(v) => set("includeDocuments", v)} />}
        {fields.includeAuditTrail && <Toggle label="Include audit trail" checked={form.includeAuditTrail !== false} onChange={(v) => set("includeAuditTrail", v)} />}
        {fields.includeRegulatorySources && <Toggle label="Include regulatory sources" checked={form.includeRegulatorySources !== false} onChange={(v) => set("includeRegulatorySources", v)} />}
        {fields.includeReceipts && <Toggle label="Include receipts" checked={form.includeReceipts !== false} onChange={(v) => set("includeReceipts", v)} />}
        {fields.includeRecommendedPrograms && <Toggle label="Include recommended programs" checked={!!form.includeRecommendedPrograms} onChange={(v) => set("includeRecommendedPrograms", v)} />}
      </div>
      <div>
        <Button onClick={generate} loading={generating} disabled={!canGenerate(type, form)}>Generate packet</Button>
      </div>
    </Card>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--royal)]" />
      {label}
    </label>
  );
}

function PacketDetailModal({ packet, onClose }: { packet: any; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="xl" title={packet.title} description={`Packet ${packet.packetId}`}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant={summaryStatusVariant(packet.summary?.status)}>{packet.summary?.status}</Badge>
          <span className="text-[var(--gray-600)]">{packet.summary?.satisfiedItems}/{packet.summary?.totalItems} satisfied · {packet.summary?.warningCount} warnings · {packet.summary?.blockerCount} blockers</span>
        </div>

        {packet.blockers?.length > 0 && (
          <div className="rounded-md bg-[var(--red-pl)] p-3 text-[var(--red)]">
            <p className="font-semibold">Blockers</p>
            <ul className="mt-1 list-disc pl-5">{packet.blockers.map((b: any, i: number) => <li key={i}>{b.message}</li>)}</ul>
          </div>
        )}
        {packet.warnings?.length > 0 && (
          <div className="rounded-md bg-[var(--amber-pl,#FEF3C7)] p-3 text-[var(--amber,#92400E)]">
            <p className="font-semibold">Warnings</p>
            <ul className="mt-1 list-disc pl-5">{packet.warnings.map((w: any, i: number) => <li key={i}>{w.message}</li>)}</ul>
          </div>
        )}

        {packet.sections?.map((s: any) => (
          <div key={s.key} className="rounded-lg border border-[var(--gray-200)]">
            <div className="flex items-center justify-between border-b border-[var(--gray-100)] bg-[var(--gray-50)] px-3 py-2">
              <span className="font-semibold text-[var(--gray-800)]">{s.title}</span>
              <Badge variant={s.status === "blocked" ? "red" : s.status === "warning" || s.status === "incomplete" ? "amber" : s.status === "complete" ? "green" : "gray"}>{s.status}</Badge>
            </div>
            <div className="px-3 py-2 text-xs text-[var(--gray-600)]">
              {s.items?.length ? <pre className="overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(s.items, null, 2)}</pre> : <span className="text-[var(--gray-400)]">No items.</span>}
            </div>
          </div>
        ))}

        <p className="text-xs text-[var(--gray-400)]">Integrity hash: {packet.hash}</p>
      </div>
    </Modal>
  );
}
