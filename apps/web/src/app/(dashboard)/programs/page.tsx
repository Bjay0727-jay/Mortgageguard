"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, saveBlob } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  MetricCard,
  Modal,
  PageHeader,
  Table,
  useToast,
  type BadgeVariant,
  type Column,
} from "@/components/ui";

// ─── Types (enriched program shape from the API) ───
interface EvidenceItem {
  evidenceKey: string;
  displayName: string;
  description: string | null;
  required: boolean;
  sourceKey: string | null;
  status: string; // missing | uploaded | accepted | current | not_applicable
  notApplicable: boolean;
  satisfied: boolean;
}
interface SourceItem {
  id: string;
  sourceKey: string;
  citation: string;
  appliesTo: string;
  title: string;
  agency: string | null;
  jurisdiction: string;
  sourceUrl: string;
  rulemakingUrl: string | null;
  guidanceUrl: string | null;
  lastVerifiedAt: string | null;
  nextVerificationDueAt: string | null;
  verificationStatus: string;
}
interface Program {
  id: string;
  programKey: string | null;
  name: string;
  category: string | null;
  requiredBy: string | null;
  isRequired: boolean;
  isConditionallyRequired: boolean;
  applicable: boolean;
  owner: string | null;
  version: string | null;
  filePath: string | null;
  documentName: string | null;
  documentStatus: string | null;
  reviewFrequencyMonths: number;
  lastReviewedAt: string | null;
  nextReviewDue: string | null;
  status: string;
  blockers: string[];
  warnings: string[];
  nextAction: string | null;
  satisfiedEvidence: number;
  requiredEvidence: number;
  evidence: EvidenceItem[];
  sources: SourceItem[];
}
interface Summary {
  total: number; current: number; missing: number; incomplete: number;
  overdue: number; reviewDue: number; sourceReviewDue: number; notApplicable: number; overdueReview: number;
}
interface ProgramsResponse { programs: Program[]; summary: Summary }
interface Version { id: string; version: string; file_name: string | null; is_current: boolean; created_at: string }
interface Review { id: string; reviewed_at: string; next_review_due: string | null; notes: string | null }

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  current: "green",
  review_due: "amber",
  source_review_due: "amber",
  incomplete: "amber",
  overdue: "red",
  missing: "red",
  not_applicable: "gray",
  archived: "gray",
};
const STATUS_LABEL: Record<string, string> = {
  current: "Current", review_due: "Review due", source_review_due: "Source review due",
  incomplete: "Incomplete", overdue: "Overdue", missing: "Missing", not_applicable: "Not applicable", archived: "Archived",
};
const VERIFY_VARIANT: Record<string, BadgeVariant> = {
  verified: "green", review_due: "amber", changed: "amber", unverified: "gray", retired: "red",
};

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={STATUS_VARIANT[status] || "gray"}>{STATUS_LABEL[status] || status}</Badge>;
}

export default function ProgramsPage() {
  const [data, setData] = useState<ProgramsResponse | null>(null);
  const [error, setError] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { can } = useCapabilities();
  const { toast } = useToast();

  const load = useCallback(() => {
    api.get<ProgramsResponse>("/api/v1/programs").then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const ok = (description: string) => toast({ variant: "success", title: "Done", description });
  const fail = (description: string) => toast({ variant: "error", title: "Something went wrong", description });

  async function setup(kind: "required" | "recommended") {
    try {
      const res = await api.post<{ created: number }>(`/api/v1/programs/setup-${kind}`, {});
      ok(res.created > 0 ? `Added ${res.created} ${kind} program${res.created === 1 ? "" : "s"}.` : "Programs already set up.");
      load();
    } catch (e: any) { fail(e.message); }
  }

  if (!can("viewCompliancePrograms")) return <InsufficientPermission />;
  if (error) return <div role="alert" className="rounded-md bg-[var(--red-pl)] p-4 text-sm text-[var(--red)]">{error}</div>;
  if (!data) return <p className="text-[var(--gray-500)]">Loading programs…</p>;

  const canManage = can("manageCompliancePrograms");
  const { summary } = data;
  const needsWork = summary.missing + summary.incomplete;

  const columns: Column<Program>[] = [
    {
      key: "program",
      header: "Program",
      render: (p) => (
        <button onClick={() => setDetailId(p.id)} className="text-left">
          <span className="block text-sm font-medium text-[var(--royal)] hover:underline">{p.name}</span>
          <span className="block text-xs text-[var(--gray-500)]">{p.requiredBy || p.category}</span>
        </button>
      ),
    },
    { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
    { key: "owner", header: "Owner", render: (p) => p.owner || "—", hideOnMobile: true },
    {
      key: "evidence",
      header: "Evidence",
      render: (p) => (p.requiredEvidence ? <Badge variant={p.satisfiedEvidence >= p.requiredEvidence ? "green" : "gray"}>{p.satisfiedEvidence}/{p.requiredEvidence}</Badge> : "—"),
    },
    { key: "next_review", header: "Next Review", render: (p) => (p.nextReviewDue ? String(p.nextReviewDue).slice(0, 10) : "—"), hideOnMobile: true },
    { key: "actions", header: "Actions", render: (p) => <Button size="sm" variant="secondary" onClick={() => setDetailId(p.id)}>Details</Button> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Programs"
        description="Source-backed company compliance controls — documents, evidence, and the regulations behind each requirement."
        actions={(
          <>
            {can("generateEvidencePackets") && <a href="/evidence-packets?type=programs" className="inline-flex items-center rounded-md border border-[var(--gray-300)] px-3 py-1.5 text-sm font-semibold text-[var(--royal)] hover:bg-[var(--gray-50)]">Generate Program Evidence Packet</a>}
            {canManage && (
              <>
                <Button variant="secondary" onClick={() => setup("required")}>Set up required programs</Button>
                <Button variant="secondary" onClick={() => setup("recommended")}>Add recommended</Button>
                <Button onClick={() => setAdding(true)}>Add program</Button>
              </>
            )}
          </>
        )}
      />

      {(summary.missing > 0 || summary.incomplete > 0 || summary.sourceReviewDue > 0) && (
        <div className="space-y-2">
          {needsWork > 0 && <Banner color="red" text={`${needsWork} required program${needsWork === 1 ? "" : "s"} need a document or evidence — examiners may cite missing written programs.`} />}
          {summary.sourceReviewDue > 0 && <Banner color="amber" text={`${summary.sourceReviewDue} program${summary.sourceReviewDue === 1 ? "" : "s"} reference a regulatory source that needs re-verification.`} />}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-5">
        <MetricCard label="Total" value={String(summary.total)} color="var(--gray-900)" />
        <MetricCard label="Current" value={String(summary.current)} color="var(--grn)" bgColor="var(--grn-pl)" />
        <MetricCard label="Needs work" value={String(needsWork)} color="var(--red)" bgColor="var(--red-pl)" />
        <MetricCard label="Overdue" value={String(summary.overdue)} color="var(--amb)" bgColor="var(--amb-pl)" />
        <MetricCard label="Source review" value={String(summary.sourceReviewDue)} color="var(--amb)" bgColor="var(--amb-pl)" />
      </div>

      <Card flush className="overflow-hidden">
        <Table
          columns={columns}
          data={data.programs}
          rowKey={(p) => p.id}
          caption="Compliance programs"
          emptyState={
            <EmptyState
              icon={<span className="text-lg">📁</span>}
              title="No programs yet"
              description={canManage ? "Use “Set up required programs” to seed the source-backed controls." : "No compliance programs have been added yet."}
              action={canManage ? <Button onClick={() => setup("required")}>Set up required programs</Button> : undefined}
            />
          }
        />
      </Card>

      {detailId && (
        <ProgramDetailModal
          programId={detailId}
          onClose={() => setDetailId(null)}
          onChanged={load}
          ok={ok}
          fail={fail}
          canManage={canManage}
          canUpload={can("uploadProgramDocument")}
          canReview={can("reviewCompliancePrograms")}
          canVerify={can("verifyRegulatorySources")}
        />
      )}
      {adding && <AddProgramModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); ok("Program added."); }} onError={fail} />}
    </div>
  );
}

function Banner({ color, text }: { color: "red" | "amber"; text: string }) {
  const cls = color === "red" ? "bg-[var(--red-pl)] text-[var(--red)]" : "bg-[var(--amb-pl)] text-[var(--amb)]";
  return <div className={`rounded-lg px-4 py-3 text-sm ${cls}`}>⚠️ {text}</div>;
}

// ─── Detail modal ───
function ProgramDetailModal({ programId, onClose, onChanged, ok, fail, canManage, canUpload, canReview, canVerify }: {
  programId: string; onClose: () => void; onChanged: () => void;
  ok: (m: string) => void; fail: (m: string) => void;
  canManage: boolean; canUpload: boolean; canReview: boolean; canVerify: boolean;
}) {
  const [detail, setDetail] = useState<{ program: Program; versions: Version[]; reviews: Review[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.get<{ program: Program; versions: Version[]; reviews: Review[] }>(`/api/v1/programs/${programId}`).then(setDetail).catch((e) => fail(e.message));
  }, [programId, fail]);
  useEffect(() => { refresh(); }, [refresh]);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.upload(`/api/v1/programs/${programId}/documents`, fd);
      ok("Program document uploaded.");
      refresh(); onChanged();
    } catch (e: any) { fail(e.message || "Upload failed"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function setEvidence(evidenceKey: string, status: string) {
    try {
      await api.post(`/api/v1/programs/${programId}/evidence`, { evidenceKey, status });
      refresh(); onChanged();
    } catch (e: any) { fail(e.message); }
  }

  async function recordReview() {
    try {
      await api.post(`/api/v1/programs/${programId}/reviews`, {});
      ok("Review recorded.");
      refresh(); onChanged();
    } catch (e: any) { fail(e.message); }
  }

  async function verifySource(sourceId: string) {
    try {
      await api.post(`/api/v1/regulatory-sources/${sourceId}/mark-verified`, {});
      ok("Source marked verified.");
      refresh(); onChanged();
    } catch (e: any) { fail(e.message); }
  }

  async function download() {
    try { saveBlob(await api.download(`/api/v1/programs/${programId}/download`), `${detail?.program.name || "program"}.file`); }
    catch (e: any) { fail(e.message); }
  }

  const p = detail?.program;

  return (
    <Modal open onClose={onClose} size="xl" title={p?.name || "Program"} description={p?.requiredBy || undefined}>
      {!detail || !p ? (
        <p className="text-sm text-[var(--gray-500)]">Loading…</p>
      ) : (
        <div className="space-y-6">
          {/* Overview */}
          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusBadge status={p.status} />
              {p.isRequired ? <Badge variant="royal">Required</Badge> : <Badge variant="gray">Recommended</Badge>}
              {p.isConditionallyRequired && <Badge variant="gray">Conditional</Badge>}
            </div>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <Field label="Category" value={p.category} />
              <Field label="Owner" value={p.owner} />
              <Field label="Review cadence" value={`${p.reviewFrequencyMonths} mo`} />
              <Field label="Last reviewed" value={p.lastReviewedAt ? String(p.lastReviewedAt).slice(0, 10) : "—"} />
              <Field label="Next review due" value={p.nextReviewDue ? String(p.nextReviewDue).slice(0, 10) : "—"} />
              <Field label="Applicable" value={p.applicable ? "Yes" : "No"} />
            </dl>
            {p.nextAction && <p className="mt-3 rounded-lg bg-[var(--amb-pl)] px-3 py-2 text-sm text-[var(--amb)]">Next action: {p.nextAction}</p>}
            {p.blockers.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-[var(--red)]">{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            )}
          </section>

          {/* Current document */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--gray-900)]">Current document</h3>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--gray-200)] p-3 text-sm">
              <span className="flex-1 text-[var(--gray-700)]">{p.documentName || "Program document"} {p.version && <span className="text-xs text-[var(--gray-400)]">({p.version})</span>}</span>
              {p.filePath ? <Badge variant="green">{p.documentStatus || "current"}</Badge> : <Badge variant="red">missing</Badge>}
              {p.filePath && <Button size="sm" variant="secondary" onClick={download}>Download</Button>}
              {canUpload && (
                <>
                  <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.docx" className="hidden" aria-label={`Upload document for ${p.name}`} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                  <Button size="sm" loading={busy} onClick={() => fileRef.current?.click()}>{p.filePath ? "Replace" : "Upload"}</Button>
                </>
              )}
            </div>
          </section>

          {/* Evidence checklist */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--gray-900)]">Evidence checklist ({p.satisfiedEvidence}/{p.requiredEvidence})</h3>
            <ul className="divide-y divide-[var(--gray-100)] rounded-lg border border-[var(--gray-200)]">
              {p.evidence.map((e) => (
                <li key={e.evidenceKey} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <span className="block text-sm text-[var(--gray-800)]">{e.displayName}</span>
                    <span className="text-xs">{evidenceBadge(e)}</span>
                  </div>
                  {canUpload && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setEvidence(e.evidenceKey, "accepted")}>Accept</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEvidence(e.evidenceKey, "not_applicable")}>N/A</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* Regulatory basis */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--gray-900)]">Regulatory basis</h3>
            <div className="space-y-2">
              {p.sources.length === 0 && <p className="text-sm text-[var(--gray-500)]">No regulatory source linked.</p>}
              {p.sources.map((s) => (
                <div key={s.sourceKey} className="rounded-lg border border-[var(--gray-200)] p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-[var(--gray-900)]">{s.citation}</span>
                    <Badge variant="gray">{s.agency || s.jurisdiction}</Badge>
                    <Badge variant={VERIFY_VARIANT[s.verificationStatus] || "gray"}>{s.verificationStatus}</Badge>
                  </div>
                  <p className="mt-1 text-[var(--gray-600)]">{s.title}</p>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--royal)] hover:underline">eCFR / source</a>
                    {s.rulemakingUrl && <a href={s.rulemakingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--royal)] hover:underline">Rulemaking</a>}
                    {s.guidanceUrl && <a href={s.guidanceUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-[var(--royal)] hover:underline">Agency guidance</a>}
                  </div>
                  <p className="mt-1 text-xs text-[var(--gray-400)]">
                    Last verified: {s.lastVerifiedAt ? String(s.lastVerifiedAt).slice(0, 10) : "never"}
                    {s.nextVerificationDueAt && ` · next due ${String(s.nextVerificationDueAt).slice(0, 10)}`}
                  </p>
                  {canVerify && <Button size="sm" variant="secondary" className="mt-2" onClick={() => verifySource(s.id)}>Mark Source Verified</Button>}
                </div>
              ))}
            </div>
          </section>

          {/* History */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[var(--gray-900)]">Version & review history</h3>
              {canReview && <Button size="sm" variant="secondary" onClick={recordReview}>Record review</Button>}
            </div>
            <div className="space-y-1 text-sm">
              {detail.versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded border border-[var(--gray-100)] px-3 py-1.5">
                  <span>{v.version} · {v.file_name || "document"} {v.is_current && <Badge variant="green">current</Badge>}</span>
                  <span className="text-xs text-[var(--gray-400)]">{String(v.created_at).slice(0, 10)}</span>
                </div>
              ))}
              {detail.reviews.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded border border-[var(--gray-100)] px-3 py-1.5">
                  <span className="text-[var(--gray-600)]">Reviewed {r.notes ? `— ${r.notes}` : ""}</span>
                  <span className="text-xs text-[var(--gray-400)]">{String(r.reviewed_at).slice(0, 10)}</span>
                </div>
              ))}
              {detail.versions.length === 0 && detail.reviews.length === 0 && <p className="text-sm text-[var(--gray-500)]">No history yet.</p>}
            </div>
          </section>

          {canManage && <p className="text-xs text-[var(--gray-400)]">This packet of document + evidence + verified sources feeds the examiner evidence packet.</p>}
        </div>
      )}
    </Modal>
  );
}

function evidenceBadge(e: EvidenceItem) {
  if (e.notApplicable) return <Badge variant="gray">N/A</Badge>;
  if (e.satisfied) return <Badge variant="green">{e.status}</Badge>;
  return <Badge variant="red">missing</Badge>;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-[var(--gray-500)]">{label}</dt>
      <dd className="font-medium capitalize text-[var(--gray-900)]">{value || "—"}</dd>
    </div>
  );
}

// ─── Add ad-hoc program ───
function AddProgramModal({ onClose, onSaved, onError }: { onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({ programType: "", programName: "", owner: "" });
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/api/v1/programs", { programType: form.programType, programName: form.programName, owner: form.owner || undefined });
      onSaved();
    } catch (e: any) { onError(e.message || "Save failed"); }
    finally { setSaving(false); }
  }
  return (
    <Modal open onClose={() => !saving && onClose()} size="md" title="Add program"
      footer={<><Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button><Button type="submit" form="add-program-form" loading={saving}>Save</Button></>}>
      <form id="add-program-form" onSubmit={submit} className="space-y-3">
        <Input label="Program type" required value={form.programType} onChange={(e) => setForm((f) => ({ ...f, programType: e.target.value }))} />
        <Input label="Program name" required value={form.programName} onChange={(e) => setForm((f) => ({ ...f, programName: e.target.value }))} />
        <Input label="Owner" value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} />
      </form>
    </Modal>
  );
}
