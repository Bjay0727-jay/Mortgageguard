"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { ScoreBadge } from "@/components/score-badge";
import { StatusBadge } from "@/components/status-badge";

interface Loan {
  id: string;
  loan_number: string;
  borrower_first_name: string;
  borrower_last_name: string;
  property_state: string;
  property_city: string;
  status: string;
  loan_purpose: string;
  loan_product: string;
  loan_amount: string;
  compliance_score: number;
  docs_complete: number;
  docs_required: number;
  originator_name: string;
  created_at: string;
}

interface LoansResponse {
  loans: Loan[];
  pagination: { total: number; limit: number; offset: number };
}

const INITIAL_FORM = {
  loanNumber: "",
  borrowerFirstName: "",
  borrowerLastName: "",
  propertyAddress: "",
  propertyCity: "",
  propertyState: "TX",
  propertyZip: "",
  loanPurpose: "purchase",
  loanProduct: "conventional",
  loanType: "fixed",
  lienPosition: "first",
  occupancyType: "primary",
  loanAmount: "",
  interestRate: "",
  loanTerm: "30",
  lenderName: "",
  lenderNmlsId: "",
};

export default function LoansPage() {
  const [data, setData] = useState<LoansResponse | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  function loadLoans() {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    if (stateFilter) params.set("state", stateFilter);
    const qs = params.toString();
    api
      .get<LoansResponse>(`/api/v1/loans${qs ? `?${qs}` : ""}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    loadLoans();
  }, [statusFilter, stateFilter]);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError("");
    setCreating(true);
    try {
      await api.post("/api/v1/loans", {
        ...form,
        loanAmount: form.loanAmount ? Number(form.loanAmount) : undefined,
        interestRate: form.interestRate ? Number(form.interestRate) : undefined,
        loanTerm: form.loanTerm ? Number(form.loanTerm) : undefined,
      });
      setShowModal(false);
      setForm(INITIAL_FORM);
      loadLoans();
    } catch (err: any) {
      setCreateError(err.message || "Failed to create loan");
    } finally {
      setCreating(false);
    }
  }

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(Number(n));

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-[#1B3A6B] focus:ring-1 focus:ring-[#1B3A6B] focus:outline-none";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "#1B3A6B" }}>
          Loans
        </h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {data ? `${data.pagination.total} total` : ""}
          </span>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white"
            style={{ backgroundColor: "#0F7B46" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#15A35E")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "#0F7B46")
            }
          >
            + New Loan
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadLoans();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            placeholder="Search loans..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={inputClass}
          />
          <button
            type="submit"
            className="rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ backgroundColor: "#1B3A6B" }}
          >
            Search
          </button>
        </form>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All Stages</option>
          <option value="application">Application</option>
          <option value="processing">Processing</option>
          <option value="underwriting">Underwriting</option>
          <option value="closing">Closing</option>
          <option value="post_close">Post-Close</option>
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="">All States</option>
          <option value="TX">Texas</option>
          <option value="CA">California</option>
          <option value="FL">Florida</option>
          <option value="NY">New York</option>
        </select>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Loan Table */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Loan #
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Borrower
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                State
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Amount
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Stage
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Score
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium tracking-wider text-gray-500 uppercase">
                Docs
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data?.loans.map((loan) => (
              <tr key={loan.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/loans/${loan.id}`}
                    className="text-sm font-medium hover:underline"
                    style={{ color: "#1B3A6B" }}
                  >
                    {loan.loan_number}
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {loan.borrower_last_name}, {loan.borrower_first_name}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {loan.property_state}
                </td>
                <td className="px-4 py-3 text-sm text-gray-900">
                  {loan.loan_amount ? fmt(loan.loan_amount) : "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={loan.status} />
                </td>
                <td className="px-4 py-3">
                  <ScoreBadge score={loan.compliance_score} />
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {loan.docs_complete}/{loan.docs_required}
                </td>
              </tr>
            ))}
            {data?.loans.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-sm text-gray-400"
                >
                  <div className="text-3xl mb-2">📋</div>
                  No loans yet.{" "}
                  <button
                    onClick={() => setShowModal(true)}
                    className="font-medium underline"
                    style={{ color: "#1B3A6B" }}
                  >
                    Create your first loan
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── New Loan Modal ── */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            className="w-full max-h-[90vh] overflow-y-auto bg-white"
            style={{
              maxWidth: 560,
              borderRadius: 16,
              padding: "32px",
              boxShadow: "0 25px 50px -12px rgba(0,0,0,.25)",
            }}
          >
            <div className="flex items-center justify-between mb-6">
              <h2
                className="text-lg font-bold"
                style={{ color: "#1B3A6B" }}
              >
                New Loan Application
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            {createError && (
              <div
                className="mb-4 text-sm"
                style={{
                  backgroundColor: "#FEF0EF",
                  color: "#C4302B",
                  borderRadius: 10,
                  padding: "10px 14px",
                }}
              >
                {createError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              {/* Loan Number */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Loan Number *
                </label>
                <input
                  type="text"
                  required
                  value={form.loanNumber}
                  onChange={(e) => update("loanNumber", e.target.value)}
                  className={inputClass}
                  placeholder="LN-2026-0001"
                />
              </div>

              {/* Borrower */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Borrower First Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.borrowerFirstName}
                    onChange={(e) => update("borrowerFirstName", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Borrower Last Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.borrowerLastName}
                    onChange={(e) => update("borrowerLastName", e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Property */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Property Address *
                </label>
                <input
                  type="text"
                  required
                  value={form.propertyAddress}
                  onChange={(e) => update("propertyAddress", e.target.value)}
                  className={inputClass}
                  placeholder="123 Main St"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    City *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.propertyCity}
                    onChange={(e) => update("propertyCity", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    State *
                  </label>
                  <select
                    value={form.propertyState}
                    onChange={(e) => update("propertyState", e.target.value)}
                    className={inputClass}
                  >
                    {["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"].map(
                      (s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      )
                    )}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    ZIP *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.propertyZip}
                    onChange={(e) => update("propertyZip", e.target.value)}
                    className={inputClass}
                    placeholder="75001"
                  />
                </div>
              </div>

              {/* Loan Details */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Purpose *
                  </label>
                  <select
                    value={form.loanPurpose}
                    onChange={(e) => update("loanPurpose", e.target.value)}
                    className={inputClass}
                  >
                    <option value="purchase">Purchase</option>
                    <option value="refinance">Refinance</option>
                    <option value="construction">Construction</option>
                    <option value="home_equity">Home Equity</option>
                    <option value="home_equity_50a6">Home Equity 50(a)(6)</option>
                    <option value="home_improvement">Home Improvement</option>
                    <option value="reverse_mortgage">Reverse Mortgage</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Product *
                  </label>
                  <select
                    value={form.loanProduct}
                    onChange={(e) => update("loanProduct", e.target.value)}
                    className={inputClass}
                  >
                    <option value="conventional">Conventional</option>
                    <option value="fha">FHA</option>
                    <option value="va">VA</option>
                    <option value="usda">USDA</option>
                    <option value="reverse">Reverse</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Type *
                  </label>
                  <select
                    value={form.loanType}
                    onChange={(e) => update("loanType", e.target.value)}
                    className={inputClass}
                  >
                    <option value="fixed">Fixed</option>
                    <option value="arm">ARM</option>
                    <option value="balloon">Balloon</option>
                    <option value="interest_only">Interest Only</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Amount
                  </label>
                  <input
                    type="number"
                    value={form.loanAmount}
                    onChange={(e) => update("loanAmount", e.target.value)}
                    className={inputClass}
                    placeholder="485000"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Rate (%)
                  </label>
                  <input
                    type="number"
                    step="0.001"
                    value={form.interestRate}
                    onChange={(e) => update("interestRate", e.target.value)}
                    className={inputClass}
                    placeholder="6.375"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Term (years)
                  </label>
                  <input
                    type="number"
                    value={form.loanTerm}
                    onChange={(e) => update("loanTerm", e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Lien Position *
                  </label>
                  <select
                    value={form.lienPosition}
                    onChange={(e) => update("lienPosition", e.target.value)}
                    className={inputClass}
                  >
                    <option value="first">First</option>
                    <option value="second">Second</option>
                    <option value="wrap">Wrap</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Occupancy *
                  </label>
                  <select
                    value={form.occupancyType}
                    onChange={(e) => update("occupancyType", e.target.value)}
                    className={inputClass}
                  >
                    <option value="primary">Primary</option>
                    <option value="secondary">Secondary</option>
                    <option value="investment">Investment</option>
                  </select>
                </div>
              </div>

              {/* Lender */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Lender Name
                  </label>
                  <input
                    type="text"
                    value={form.lenderName}
                    onChange={(e) => update("lenderName", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Lender NMLS
                  </label>
                  <input
                    type="text"
                    value={form.lenderNmlsId}
                    onChange={(e) => update("lenderNmlsId", e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "#1B3A6B" }}
                >
                  {creating ? "Creating..." : "Create Loan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
