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
  Select,
  Table,
  Textarea,
  useToast,
  type BadgeVariant,
  type Column,
} from "@/components/ui";

interface Program {
  id: string;
  program_type: string;
  program_name: string;
  is_required: boolean;
  required_by: string | null;
  version: string | null;
  status: string;
  owner: string | null;
  notes: string | null;
  file_path: string | null;
  last_reviewed_at: string | null;
  next_review_due: string | null;
}

interface Summary { total: number; current: number; overdue: number; missing: number; overdueReview: number }
interface ProgramsResponse { programs: Program[]; summary: Summary }
interface Version { id: string; version: string; file_name: string | null; file_size: number | null; is_current: boolean; created_at: string }

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  current: "green",
  overdue: "red",
  missing: "gray",
  draft: "amber",
};
const STATUSES = ["current", "overdue", "missing", "draft"];

export default function ProgramsPage() {
  const [data, setData] = useState<ProgramsResponse | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Program | "new" | null>(null);
  const [versionsFor, setVersionsFor] = useState<Program | null>(null);
  const { can } = useCapabilities();
  const { toast } = useToast();

  const load = useCallback(() => {
    api.get<ProgramsResponse>("/api/v1/programs").then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const ok = (description: string) => toast({ variant: "success", title: "Done", description });
  const fail = (description: string) => toast({ variant: "error", title: "Something went wrong", description });

  async function bootstrap() {
    try {
      await api.post("/api/v1/programs/bootstrap");
      ok("Required programs set up.");
      load();
    } catch (e: any) {
      fail(e.message);
    }
  }

  if (!can("viewCompliancePrograms")) return <InsufficientPermission />;
  if (error) return <div role="alert" className="rounded-md bg-[var(--red-pl)] p-4 text-sm text-[var(--red)]">{error}</div>;
  if (!data) return <p className="text-[var(--gray-500)]">Loading programs…</p>;

  const canManage = can("manageCompliancePrograms");
  const canUpload = can("uploadProgramDocument");
  const { summary } = data;
  const today = new Date().toISOString().slice(0, 10);

  const columns: Column<Program>[] = [
    {
      key: "program",
      header: "Program",
      render: (p) => (
        <div>
          <p className="text-sm font-medium text-[var(--gray-900)]">{p.program_name}{p.version && <span className="ml-2 text-xs text-[var(--gray-400)]">{p.version}</span>}</p>
          <p className="text-xs text-[var(--gray-500)]">{p.program_type}{p.is_required ? " · required" : ""}</p>
        </div>
      ),
    },
    { key: "required_by", header: "Required By", render: (p) => <span className="capitalize">{p.required_by || "—"}</span>, hideOnMobile: true },
    { key: "owner", header: "Owner", render: (p) => p.owner || "—", hideOnMobile: true },
    { key: "status", header: "Status", render: (p) => <Badge variant={STATUS_VARIANT[p.status] || "gray"}>{p.status}</Badge> },
    {
      key: "next_review",
      header: "Next Review",
      render: (p) => {
        const overdue = p.next_review_due && String(p.next_review_due).slice(0, 10) < today && p.status !== "missing";
        return <span className={overdue ? "font-semibold text-[var(--amb)]" : "text-[var(--gray-600)]"}>{p.next_review_due ? String(p.next_review_due).slice(0, 10) : "—"}</span>;
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (p) => (
        <ProgramActions
          program={p}
          canUpload={canUpload}
          canManage={canManage}
          onUploaded={(msg) => { ok(msg); load(); }}
          onError={fail}
          onEdit={() => setEditing(p)}
          onVersions={() => setVersionsFor(p)}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Programs"
        actions={canManage && (
          <>
            <Button variant="secondary" onClick={bootstrap}>Set up required programs</Button>
            <Button onClick={() => setEditing("new")}>Add program</Button>
          </>
        )}
      />

      {/* Warnings */}
      {(summary.missing > 0 || summary.overdueReview > 0) && (
        <div className="space-y-2">
          {summary.missing > 0 && (
            <Banner color="red" text={`${summary.missing} required program${summary.missing === 1 ? "" : "s"} missing — upload documents to become exam-ready.`} />
          )}
          {summary.overdueReview > 0 && (
            <Banner color="amber" text={`${summary.overdueReview} program${summary.overdueReview === 1 ? " is" : "s are"} past the review due date.`} />
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-5">
        <MetricCard label="Total" value={String(summary.total)} color="var(--gray-900)" />
        <MetricCard label="Current" value={String(summary.current)} color="var(--grn)" bgColor="var(--grn-pl)" />
        <MetricCard label="Overdue" value={String(summary.overdue)} color="var(--red)" bgColor="var(--red-pl)" />
        <MetricCard label="Missing" value={String(summary.missing)} color="var(--gray-500)" />
        <MetricCard label="Review due" value={String(summary.overdueReview)} color="var(--amb)" bgColor="var(--amb-pl)" />
      </div>

      {/* Program list — responsive table (cards on small screens) */}
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
              description={canManage ? "Use “Set up required programs” to start." : "No compliance programs have been added yet."}
            />
          }
        />
      </Card>

      {editing && (
        <ProgramModal
          program={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); ok("Program saved."); }}
          onError={fail}
        />
      )}
      {versionsFor && <VersionsModal program={versionsFor} onClose={() => setVersionsFor(null)} onError={fail} />}
    </div>
  );
}

function Banner({ color, text }: { color: "red" | "amber"; text: string }) {
  const cls = color === "red" ? "bg-[var(--red-pl)] text-[var(--red)]" : "bg-[var(--amb-pl)] text-[var(--amb)]";
  return <div className={`rounded-lg border border-transparent px-4 py-3 text-sm ${cls}`}>⚠️ {text}</div>;
}

function ProgramActions({ program: p, canUpload, canManage, onUploaded, onError, onEdit, onVersions }: {
  program: Program; canUpload: boolean; canManage: boolean;
  onUploaded: (msg: string) => void; onError: (msg: string) => void; onEdit: () => void; onVersions: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  async function upload() {
    if (!selected) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", selected);
      await api.upload(`/api/v1/programs/${p.id}/upload`, fd);
      setSelected(null);
      if (fileRef.current) fileRef.current.value = "";
      onUploaded(`Uploaded new version of ${p.program_name}.`);
    } catch (e: any) {
      onError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function download() {
    try {
      const blob = await api.download(`/api/v1/programs/${p.id}/download`);
      saveBlob(blob, `${p.program_name}.file`);
    } catch (e: any) {
      onError(e.message);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-start">
      {p.file_path && (
        <button onClick={download} className="text-xs font-semibold text-[var(--royal)] hover:underline">View file</button>
      )}
      <button onClick={onVersions} className="text-xs font-semibold text-[var(--gray-600)] hover:underline">History</button>
      {canManage && <button onClick={onEdit} className="text-xs font-semibold text-[var(--gray-600)] hover:underline">Edit</button>}
      {canUpload && (
        <div className="flex items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.docx"
            aria-label={`Upload document for ${p.program_name}`}
            className="hidden"
            onChange={(e) => setSelected(e.target.files?.[0] || null)}
          />
          {!selected ? (
            <Button size="sm" onClick={() => fileRef.current?.click()}>Upload</Button>
          ) : (
            <>
              <span className="max-w-[140px] truncate text-xs text-[var(--gray-600)]" title={selected.name}>{selected.name}</span>
              <Button variant="success" size="sm" onClick={upload} loading={uploading}>{uploading ? "Uploading…" : "Confirm"}</Button>
              <button onClick={() => { setSelected(null); if (fileRef.current) fileRef.current.value = ""; }} disabled={uploading} aria-label="Clear selected file" className="text-xs text-[var(--gray-400)] hover:text-[var(--gray-600)]">✕</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ProgramModal({ program, onClose, onSaved, onError }: { program: Program | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({
    programType: program?.program_type || "",
    programName: program?.program_name || "",
    requiredBy: program?.required_by || "",
    version: program?.version || "",
    status: program?.status || "missing",
    owner: program?.owner || "",
    notes: program?.notes || "",
    lastReviewedAt: program?.last_reviewed_at ? String(program.last_reviewed_at).slice(0, 10) : "",
    nextReviewDue: program?.next_review_due ? String(program.next_review_due).slice(0, 10) : "",
    isRequired: program?.is_required ?? true,
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: any = {
        programType: form.programType, programName: form.programName, requiredBy: form.requiredBy || undefined,
        version: form.version || undefined, status: form.status, owner: form.owner || undefined, notes: form.notes || undefined,
        lastReviewedAt: form.lastReviewedAt || undefined, nextReviewDue: form.nextReviewDue || undefined, isRequired: form.isRequired,
      };
      if (program) await api.put(`/api/v1/programs/${program.id}`, payload);
      else await api.post("/api/v1/programs", payload);
      onSaved();
    } catch (e: any) {
      onError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => !saving && onClose()}
      size="lg"
      title={program ? "Edit program" : "Add program"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" form="program-form" loading={saving}>{saving ? "Saving…" : "Save"}</Button>
        </>
      }
    >
      <form id="program-form" onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Program type" required value={form.programType} onChange={(e) => set("programType", e.target.value)} />
          <Input label="Version" value={form.version} onChange={(e) => set("version", e.target.value)} />
        </div>
        <Input label="Program name" required value={form.programName} onChange={(e) => set("programName", e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Required by" value={form.requiredBy} onChange={(e) => set("requiredBy", e.target.value)} placeholder="federal / state" />
          <Input label="Owner" value={form.owner} onChange={(e) => set("owner", e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Select label="Status" value={form.status} onChange={(e) => set("status", e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Input label="Last reviewed" type="date" value={form.lastReviewedAt} onChange={(e) => set("lastReviewedAt", e.target.value)} />
          <Input label="Next review due" type="date" value={form.nextReviewDue} onChange={(e) => set("nextReviewDue", e.target.value)} />
        </div>
        <Textarea label="Notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        <label className="flex items-center gap-2 text-sm text-[var(--gray-700)]">
          <input type="checkbox" checked={form.isRequired} onChange={(e) => set("isRequired", e.target.checked)} className="accent-[var(--royal)]" /> Required program
        </label>
      </form>
    </Modal>
  );
}

function VersionsModal({ program, onClose, onError }: { program: Program; onClose: () => void; onError: (m: string) => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  useEffect(() => {
    api.get<{ versions: Version[] }>(`/api/v1/programs/${program.id}/versions`).then((d) => setVersions(d.versions)).catch((e) => onError(e.message));
  }, [program.id, onError]);

  async function download(v: Version) {
    try {
      const blob = await api.download(`/api/v1/programs/${program.id}/versions/${v.id}/download`);
      saveBlob(blob, v.file_name || `${program.program_name}-${v.version}`);
    } catch (e: any) {
      onError(e.message);
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Version history" description={program.program_name}>
      <div className="space-y-2">
        {!versions && <p className="text-sm text-[var(--gray-400)]">Loading…</p>}
        {versions && versions.length === 0 && <p className="text-sm text-[var(--gray-500)]">No documents uploaded yet.</p>}
        {versions?.map((v) => (
          <div key={v.id} className="flex items-center justify-between rounded-lg border border-[var(--gray-200)] px-3 py-2">
            <div>
              <p className="flex items-center gap-1 text-sm font-medium text-[var(--gray-900)]">{v.version} {v.is_current && <Badge variant="green">Current</Badge>}</p>
              <p className="text-xs text-[var(--gray-500)]">{v.file_name || "document"} · {String(v.created_at).slice(0, 10)}</p>
            </div>
            <button onClick={() => download(v)} className="text-xs font-semibold text-[var(--royal)] hover:underline">Download</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
