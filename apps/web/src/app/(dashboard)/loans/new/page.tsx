"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import { Button, Card, Input, PageHeader, Select, useToast } from "@/components/ui";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

const INITIAL = {
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
};

export default function NewLoanPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { can } = useCapabilities();
  const [form, setForm] = useState(INITIAL);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!can("createLoan")) return <InsufficientPermission />;

  const set = (k: keyof typeof INITIAL, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { loan } = await api.post<{ loan: { id: string } }>("/api/v1/loans", form);
      toast({ variant: "success", title: "Loan created", description: `${form.loanNumber} added. Compliance checklist generated.` });
      router.push(`/loans/${loan.id}`);
    } catch (e: any) {
      setError(e.message || "Failed to create loan");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create first loan"
        description="Creating a loan generates its initial compliance checklist from the loaded rules."
        actions={<Link href="/loans"><Button variant="ghost">← All loans</Button></Link>}
      />

      <Card className="max-w-2xl">
        <p className="mb-4 rounded-lg bg-[var(--royal-pl)] px-3 py-2 text-xs text-[var(--royal)]">
          If Texas compliance rules aren&apos;t loaded yet, the checklist will be sparse. Load them from <Link href="/setup?step=rules" className="font-semibold underline">Setup</Link>.
        </p>
        {error && <div role="alert" className="mb-4 rounded-lg bg-[var(--red-pl)] px-3.5 py-2.5 text-sm text-[var(--red)]">{error}</div>}
        <form onSubmit={submit} className="space-y-4">
          <Input label="Loan number *" required value={form.loanNumber} onChange={(e) => set("loanNumber", e.target.value)} placeholder="LN-2026-0001" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Borrower first name *" required value={form.borrowerFirstName} onChange={(e) => set("borrowerFirstName", e.target.value)} />
            <Input label="Borrower last name *" required value={form.borrowerLastName} onChange={(e) => set("borrowerLastName", e.target.value)} />
          </div>
          <Input label="Property address *" required value={form.propertyAddress} onChange={(e) => set("propertyAddress", e.target.value)} placeholder="123 Main St" />
          <div className="grid grid-cols-3 gap-3">
            <Input label="City *" required value={form.propertyCity} onChange={(e) => set("propertyCity", e.target.value)} />
            <Select label="State *" value={form.propertyState} onChange={(e) => set("propertyState", e.target.value)}>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Input label="ZIP *" required value={form.propertyZip} onChange={(e) => set("propertyZip", e.target.value)} placeholder="75001" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Select label="Purpose *" value={form.loanPurpose} onChange={(e) => set("loanPurpose", e.target.value)}>
              <option value="purchase">Purchase</option>
              <option value="refinance">Refinance</option>
              <option value="construction">Construction</option>
              <option value="home_equity">Home Equity</option>
              <option value="home_equity_50a6">Home Equity 50(a)(6)</option>
              <option value="home_improvement">Home Improvement</option>
              <option value="reverse_mortgage">Reverse Mortgage</option>
            </Select>
            <Select label="Product *" value={form.loanProduct} onChange={(e) => set("loanProduct", e.target.value)}>
              <option value="conventional">Conventional</option>
              <option value="fha">FHA</option>
              <option value="va">VA</option>
              <option value="usda">USDA</option>
              <option value="reverse">Reverse</option>
              <option value="other">Other</option>
            </Select>
            <Select label="Type *" value={form.loanType} onChange={(e) => set("loanType", e.target.value)}>
              <option value="fixed">Fixed</option>
              <option value="arm">ARM</option>
              <option value="balloon">Balloon</option>
              <option value="interest_only">Interest Only</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select label="Lien position *" value={form.lienPosition} onChange={(e) => set("lienPosition", e.target.value)}>
              <option value="first">First</option>
              <option value="second">Second</option>
              <option value="wrap">Wrap</option>
            </Select>
            <Select label="Occupancy *" value={form.occupancyType} onChange={(e) => set("occupancyType", e.target.value)}>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="investment">Investment</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Link href="/loans"><Button type="button" variant="secondary">Cancel</Button></Link>
            <Button type="submit" loading={saving}>Create loan</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
