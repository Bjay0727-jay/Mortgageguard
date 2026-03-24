"use client";

import { useEffect, useState, useRef } from "react";
import { api } from "@/lib/api";

interface Program {
  id: string;
  program_type: string;
  program_name: string;
  is_required: boolean;
  required_by: string | null;
  version: string | null;
  status: string;
  last_reviewed_at: string | null;
  next_review_due: string | null;
}

interface ProgramsResponse {
  programs: Program[];
  summary: { total: number; current: number; overdue: number; missing: number };
}

const STATUS_COLORS: Record<string, string> = {
  current: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
  missing: "bg-gray-100 text-gray-600",
  draft: "bg-amber-100 text-amber-800",
};

export default function ProgramsPage() {
  const [data, setData] = useState<ProgramsResponse | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    api.get<ProgramsResponse>("/api/v1/programs").then(setData).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function handleUpload(programId: string) {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(programId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.upload(`/api/v1/programs/${programId}/upload`, fd);
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (error) return <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  if (!data) return <p className="text-gray-500">Loading programs...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Compliance Programs</h1>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Total", data.summary.total, "text-gray-900"],
          ["Current", data.summary.current, "text-green-700"],
          ["Overdue", data.summary.overdue, "text-red-700"],
          ["Missing", data.summary.missing, "text-gray-500"],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs font-medium text-gray-500">{label as string}</p>
            <p className={`mt-1 text-xl font-bold ${color}`}>{value as number}</p>
          </div>
        ))}
      </div>

      <input type="file" ref={fileRef} className="hidden" />

      {/* Program list */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Program</th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Required By</th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Last Reviewed</th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.programs.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">{p.program_name}</p>
                  <p className="text-xs text-gray-500">{p.program_type}</p>
                </td>
                <td className="px-4 py-3 text-sm capitalize text-gray-600">{p.required_by || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[p.status] || STATUS_COLORS.missing}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{p.last_reviewed_at || "Never"}</td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => {
                      fileRef.current?.click();
                      const handler = () => {
                        handleUpload(p.id);
                        fileRef.current?.removeEventListener("change", handler);
                      };
                      fileRef.current?.addEventListener("change", handler);
                    }}
                    disabled={uploading === p.id}
                    className="rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298] disabled:opacity-50"
                  >
                    {uploading === p.id ? "Uploading..." : "Upload"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
