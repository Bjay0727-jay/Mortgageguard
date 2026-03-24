"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Deadline {
  id: string;
  report_type: string;
  state_code: string;
  quarter: string;
  due_date: string;
  status: string;
  notes: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  upcoming: "bg-blue-100 text-blue-800",
  in_progress: "bg-amber-100 text-amber-800",
  filed: "bg-green-100 text-green-800",
  overdue: "bg-red-100 text-red-800",
};

export default function ReportsPage() {
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [txLog, setTxLog] = useState<any[]>([]);
  const [tab, setTab] = useState<"deadlines" | "txlog">("deadlines");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get<{ deadlines: Deadline[] }>("/api/v1/reports/deadlines").then((d) => setDeadlines(d.deadlines)).catch((e) => setError(e.message));
    api.get<{ transactionLog: any[]; count: number }>("/api/v1/reports/transaction-log").then((d) => setTxLog(d.transactionLog)).catch(() => {});
  }, []);

  async function markFiled(id: string) {
    try {
      await api.put(`/api/v1/reports/deadlines/${id}`, { status: "filed" });
      setDeadlines((prev) => prev.map((d) => (d.id === id ? { ...d, status: "filed" } : d)));
    } catch (e: any) {
      setError(e.message);
    }
  }

  function downloadCsv() {
    const token = localStorage.getItem("mg_token");
    const url = `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"}/api/v1/reports/transaction-log?format=csv`;
    window.open(url, "_blank");
  }

  const tabs = [
    { key: "deadlines" as const, label: "Reporting Deadlines" },
    { key: "txlog" as const, label: `TX Transaction Log (${txLog.length})` },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Reports</h1>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`border-b-2 px-1 pb-3 text-sm font-medium ${
                tab === t.key ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "deadlines" && (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Report</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Quarter</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {deadlines.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{d.report_type}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{d.quarter || "—"}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{d.due_date}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLORS[d.status] || "bg-gray-100 text-gray-600"}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {d.status !== "filed" && (
                      <button
                        onClick={() => markFiled(d.id)}
                        className="rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700"
                      >
                        Mark Filed
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {deadlines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">No deadlines configured.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "txlog" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={downloadCsv}
              className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-medium text-white hover:bg-[#2B5298]"
            >
              Export CSV
            </button>
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
    </div>
  );
}
