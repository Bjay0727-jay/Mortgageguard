"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, saveBlob } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";

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

const STATUS_COLORS: Record<string, string> = {
  current: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  missing: "bg-gray-100 text-gray-600",
  draft: "bg-amber-100 text-amber-800",
};
const STATUSES = ["current", "overdue", "missing", "draft"];

type Toast = { type: "success" | "error"; message: string } | null;

export default function ProgramsPage() {
  const [data, setData] = useState<ProgramsResponse | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<Program | "new" | null>(null);
  const [versionsFor, setVersionsFor] = useState<Program | null>(null);
  const { can } = useCapabilities();

  const load = useCallback(() => {
    api.get<ProgramsResponse>("/api/v1/programs").then(setData).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  const showToast = useCallback((t: Toast) => {
    setToast(t);
    if (t) setTimeout(() => setToast(null), 4000);
  }, []);

  async function bootstrap() {
    try {
      await api.post("/api/v1/programs/bootstrap");
      showToast({ type: "success", message: "Required programs set up." });
      load();
    } catch (e: any) {
      showToast({ type: "error", message: e.message });
    }
  }

  if (!can("viewCompliancePrograms")) return <InsufficientPermission />;
  if (error) return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <p className="text-gray-500">Loading programs...</p>;

  const canManage = can("manageCompliancePrograms");
  const canUpload = can("uploadProgramDocument");
  const { summary } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Compliance Programs</h1>
        {canManage && (
          <div className="flex gap-2">
            <button onClick={bootstrap} className="rounded-lg border border-[#1B3A6B] px-3 py-2 text-sm font-semibold text-[#1B3A6B] hover:bg-[#E8EEF7]">Set up required programs</button>
            <button onClick={() => setEditing("new")} className="rounded-lg bg-[#1B3A6B] px-3 py-2 text-sm font-semibold text-white hover:bg-[#2B5298]">Add program</button>
          </div>
        )}
      </div>

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
        {([
          ["Total", summary.total, "text-gray-900"],
          ["Current", summary.current, "text-green-700"],
          ["Overdue", summary.overdue, "text-red-700"],
          ["Missing", summary.missing, "text-gray-500"],
          ["Review due", summary.overdueReview, "text-amber-700"],
        ] as const).map(([label, value, color]) => (
          <div key={label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium text-gray-500">{label}</p>
            <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Program list */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {["Program", "Required By", "Owner", "Status", "Next Review", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.programs.map((p) => (
              <ProgramRow
                key={p.id}
                program={p}
                canUpload={canUpload}
                canManage={canManage}
                onUploaded={(msg) => { showToast({ type: "success", message: msg }); load(); }}
                onError={(msg) => showToast({ type: "error", message: msg })}
                onEdit={() => setEditing(p)}
                onVersions={() => setVersionsFor(p)}
              />
            ))}
            {data.programs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">No programs yet. {canManage && "Use “Set up required programs” to start."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <ProgramModal program={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); showToast({ type: "success", message: "Program saved." }); }} onError={(m) => showToast({ type: "error", message: m })} />}
      {versionsFor && <VersionsModal program={versionsFor} onClose={() => setVersionsFor(null)} onError={(m) => showToast({ type: "error", message: m })} />}
      {toast && (
        <div role="status" className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

function Banner({ color, text }: { color: "red" | "amber"; text: string }) {
  const cls = color === "red" ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800";
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>⚠️ {text}</div>;
}

function ProgramRow({ program: p, canUpload, canManage, onUploaded, onError, onEdit, onVersions }: {
  program: Program; canUpload: boolean; canManage: boolean;
  onUploaded: (msg: string) => void; onError: (msg: string) => void; onEdit: () => void; onVersions: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const reviewOverdue = p.next_review_due && String(p.next_review_due).slice(0, 10) < today && p.status !== "missing";

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
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-gray-900">{p.program_name}{p.version && <span className="ml-2 text-xs text-gray-400">{p.version}</span>}</p>
        <p className="text-xs text-gray-500">{p.program_type}{p.is_required ? " · required" : ""}</p>
      </td>
      <td className="px-4 py-3 text-sm capitalize text-gray-600">{p.required_by || "—"}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{p.owner || "—"}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[p.status] || STATUS_COLORS.missing}`}>{p.status}</span>
      </td>
      <td className="px-4 py-3 text-sm">
        <span className={reviewOverdue ? "font-semibold text-amber-700" : "text-gray-600"}>{p.next_review_due ? String(p.next_review_due).slice(0, 10) : "—"}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {p.file_path && (
            <button onClick={download} className="text-xs font-semibold text-[#1B3A6B] hover:underline">View file</button>
          )}
          <button onClick={onVersions} className="text-xs font-semibold text-gray-600 hover:underline">History</button>
          {canManage && <button onClick={onEdit} className="text-xs font-semibold text-gray-600 hover:underline">Edit</button>}
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
                <button onClick={() => fileRef.current?.click()} className="rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298]">Upload</button>
              ) : (
                <>
                  <span className="max-w-[140px] truncate text-xs text-gray-600" title={selected.name}>{selected.name}</span>
                  <button onClick={upload} disabled={uploading} className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50">
                    {uploading ? "Uploading…" : "Confirm"}
                  </button>
                  <button onClick={() => { setSelected(null); if (fileRef.current) fileRef.current.value = ""; }} disabled={uploading} className="text-xs text-gray-400 hover:text-gray-600">✕</button>
                </>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
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

  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/10";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-gray-900">{program ? "Edit program" : "Add program"}</h2>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Program type"><input required value={form.programType} onChange={(e) => set("programType", e.target.value)} className={input} /></Field>
            <Field label="Version"><input value={form.version} onChange={(e) => set("version", e.target.value)} className={input} /></Field>
          </div>
          <Field label="Program name"><input required value={form.programName} onChange={(e) => set("programName", e.target.value)} className={input} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Required by"><input value={form.requiredBy} onChange={(e) => set("requiredBy", e.target.value)} placeholder="federal / state" className={input} /></Field>
            <Field label="Owner"><input value={form.owner} onChange={(e) => set("owner", e.target.value)} className={input} /></Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Status">
              <select value={form.status} onChange={(e) => set("status", e.target.value)} className={input}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Last reviewed"><input type="date" value={form.lastReviewedAt} onChange={(e) => set("lastReviewedAt", e.target.value)} className={input} /></Field>
            <Field label="Next review due"><input type="date" value={form.nextReviewDue} onChange={(e) => set("nextReviewDue", e.target.value)} className={input} /></Field>
          </div>
          <Field label="Notes"><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className={input} /></Field>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.isRequired} onChange={(e) => set("isRequired", e.target.checked)} /> Required program</label>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2B5298] disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Version history</h2>
            <p className="mt-1 text-sm text-gray-500">{program.program_name}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <div className="mt-4 space-y-2">
          {!versions && <p className="text-sm text-gray-400">Loading…</p>}
          {versions && versions.length === 0 && <p className="text-sm text-gray-500">No documents uploaded yet.</p>}
          {versions?.map((v) => (
            <div key={v.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{v.version} {v.is_current && <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">Current</span>}</p>
                <p className="text-xs text-gray-500">{v.file_name || "document"} · {String(v.created_at).slice(0, 10)}</p>
              </div>
              <button onClick={() => download(v)} className="text-xs font-semibold text-[#1B3A6B] hover:underline">Download</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
    </label>
  );
}
