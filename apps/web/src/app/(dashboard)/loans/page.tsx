"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  ScoreBadge,
  Select,
  StatusBadge,
  Table,
  useToast,
  type Column,
} from "@/components/ui";

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

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

export default function LoansPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [data, setData] = useState<LoansResponse | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const { can } = useCapabilities();
  const canCreateLoan = can("createLoan");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast({ variant: "success", title: "Loan created", description: `${form.loanNumber} was added.` });
      setForm(INITIAL_FORM);
      loadLoans();
    } catch (err: any) {
      setCreateError(err.message || "Failed to create loan");
    } finally {
      setCreating(false);
    }
  }

  const fmt = (n: string | number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(n));

  const columns: Column<Loan>[] = [
    {
      key: "loan_number",
      header: "Loan #",
      render: (l) => (
        <Link href={`/loans/${l.id}`} className="font-medium text-[var(--royal)] hover:underline" onClick={(e) => e.stopPropagation()}>
          {l.loan_number}
        </Link>
      ),
    },
    { key: "borrower", header: "Borrower", render: (l) => `${l.borrower_last_name}, ${l.borrower_first_name}` },
    { key: "property_state", header: "State", render: (l) => l.property_state },
    { key: "loan_amount", header: "Amount", render: (l) => (l.loan_amount ? fmt(l.loan_amount) : "—") },
    { key: "status", header: "Stage", render: (l) => <StatusBadge status={l.status} /> },
    { key: "compliance_score", header: "Score", render: (l) => <ScoreBadge score={l.compliance_score} /> },
    { key: "docs", header: "Docs", render: (l) => <Badge variant={l.docs_complete >= l.docs_required ? "green" : "gray"}>{l.docs_complete}/{l.docs_required}</Badge>, hideOnMobile: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loans"
        description={data ? `${data.pagination.total} total` : undefined}
        actions={canCreateLoan && <Button variant="success" onClick={() => setShowModal(true)}>+ New Loan</Button>}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadLoans();
          }}
          className="flex gap-2"
        >
          <Input
            type="text"
            placeholder="Search loans…"
            aria-label="Search loans"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[200px]"
          />
          <Button type="submit">Search</Button>
        </form>
        <Select aria-label="Filter by stage" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
          <option value="">All Stages</option>
          <option value="application">Application</option>
          <option value="processing">Processing</option>
          <option value="underwriting">Underwriting</option>
          <option value="closing">Closing</option>
          <option value="post_close">Post-Close</option>
        </Select>
        <Select aria-label="Filter by state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="w-auto">
          <option value="">All States</option>
          <option value="TX">Texas</option>
          <option value="CA">California</option>
          <option value="FL">Florida</option>
          <option value="NY">New York</option>
        </Select>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">
          {error}
        </div>
      )}

      {/* Loan table */}
      <Card flush className="overflow-hidden">
        <Table
          columns={columns}
          data={data?.loans ?? []}
          rowKey={(l) => l.id}
          onRowClick={(l) => router.push(`/loans/${l.id}`)}
          caption="Loans"
          emptyState={
            <EmptyState
              icon={<span className="text-lg">📋</span>}
              title="No loans yet"
              description="Create your first loan application to start tracking compliance."
              action={canCreateLoan ? <Button variant="success" onClick={() => setShowModal(true)}>+ New Loan</Button> : undefined}
            />
          }
        />
      </Card>

      {/* ── New Loan Modal ── */}
      <Modal
        open={showModal && canCreateLoan}
        onClose={() => setShowModal(false)}
        title="New Loan Application"
        size="xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button type="submit" form="new-loan-form" loading={creating}>{creating ? "Creating…" : "Create Loan"}</Button>
          </>
        }
      >
        {createError && (
          <div role="alert" className="mb-4 rounded-[10px] bg-[var(--red-pl)] px-3.5 py-2.5 text-sm text-[var(--red)]">
            {createError}
          </div>
        )}

        <form id="new-loan-form" onSubmit={handleCreate} className="space-y-4">
          <Input label="Loan Number *" required value={form.loanNumber} onChange={(e) => update("loanNumber", e.target.value)} placeholder="LN-2026-0001" />

          <div className="grid grid-cols-2 gap-3">
            <Input label="Borrower First Name *" required value={form.borrowerFirstName} onChange={(e) => update("borrowerFirstName", e.target.value)} />
            <Input label="Borrower Last Name *" required value={form.borrowerLastName} onChange={(e) => update("borrowerLastName", e.target.value)} />
          </div>

          <Input label="Property Address *" required value={form.propertyAddress} onChange={(e) => update("propertyAddress", e.target.value)} placeholder="123 Main St" />

          <div className="grid grid-cols-3 gap-3">
            <Input label="City *" required value={form.propertyCity} onChange={(e) => update("propertyCity", e.target.value)} />
            <Select label="State *" value={form.propertyState} onChange={(e) => update("propertyState", e.target.value)}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="ZIP *" required value={form.propertyZip} onChange={(e) => update("propertyZip", e.target.value)} placeholder="75001" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Select label="Purpose *" value={form.loanPurpose} onChange={(e) => update("loanPurpose", e.target.value)}>
              <option value="purchase">Purchase</option>
              <option value="refinance">Refinance</option>
              <option value="construction">Construction</option>
              <option value="home_equity">Home Equity</option>
              <option value="home_equity_50a6">Home Equity 50(a)(6)</option>
              <option value="home_improvement">Home Improvement</option>
              <option value="reverse_mortgage">Reverse Mortgage</option>
            </Select>
            <Select label="Product *" value={form.loanProduct} onChange={(e) => update("loanProduct", e.target.value)}>
              <option value="conventional">Conventional</option>
              <option value="fha">FHA</option>
              <option value="va">VA</option>
              <option value="usda">USDA</option>
              <option value="reverse">Reverse</option>
              <option value="other">Other</option>
            </Select>
            <Select label="Type *" value={form.loanType} onChange={(e) => update("loanType", e.target.value)}>
              <option value="fixed">Fixed</option>
              <option value="arm">ARM</option>
              <option value="balloon">Balloon</option>
              <option value="interest_only">Interest Only</option>
              <option value="other">Other</option>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Input label="Amount" type="number" value={form.loanAmount} onChange={(e) => update("loanAmount", e.target.value)} placeholder="485000" />
            <Input label="Rate (%)" type="number" step="0.001" value={form.interestRate} onChange={(e) => update("interestRate", e.target.value)} placeholder="6.375" />
            <Input label="Term (years)" type="number" value={form.loanTerm} onChange={(e) => update("loanTerm", e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select label="Lien Position *" value={form.lienPosition} onChange={(e) => update("lienPosition", e.target.value)}>
              <option value="first">First</option>
              <option value="second">Second</option>
              <option value="wrap">Wrap</option>
            </Select>
            <Select label="Occupancy *" value={form.occupancyType} onChange={(e) => update("occupancyType", e.target.value)}>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="investment">Investment</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Lender Name" value={form.lenderName} onChange={(e) => update("lenderName", e.target.value)} />
            <Input label="Lender NMLS" value={form.lenderNmlsId} onChange={(e) => update("lenderNmlsId", e.target.value)} />
          </div>
        </form>
      </Modal>
    </div>
  );
}
