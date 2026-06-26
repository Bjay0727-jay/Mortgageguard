"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import { Badge, Button, Card, Input, PageHeader, Select, useToast } from "@/components/ui";

const STATES = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];

interface LoanContext {
  licensedStates: string[];
  companyEntityType: string | null;
  loanPurposes: string[];
  loanProducts: string[];
  loanTypes: string[];
  texasCashoutTypes: string[];
  lienPositions: string[];
  occupancyTypes: string[];
  assignableUsers: { id: string; name: string; role: string }[];
  ruleLoadStatus: Record<string, boolean>;
  warnings: string[];
}

const INITIAL = {
  // borrower
  borrowerFirstName: "", borrowerLastName: "", coBorrowerName: "",
  applicantEmail: "", applicantPhone: "", applicationDate: "", applicationMethod: "",
  // property
  propertyAddress: "", propertyCity: "", propertyState: "TX", propertyZip: "", propertyCounty: "", occupancyType: "primary",
  // loan
  loanNumber: "", loanPurpose: "purchase", texasCashoutType: "none", loanProduct: "conventional", loanType: "fixed",
  loanTerm: "360", lienPosition: "first", interestRate: "", loanAmount: "", purchasePrice: "", estimatedClosingDate: "",
  // originator
  loanOriginatorName: "", loanOriginatorNmlsId: "", lenderName: "", lenderNmlsId: "", processorUserId: "", complianceOwnerUserId: "",
};
type Form = typeof INITIAL;

const STEPS = ["Borrower", "Property", "Loan details", "Originator", "Review"];
const LABEL: Record<string, string> = {
  purchase: "Purchase", refinance: "Refinance", construction: "Construction", home_equity: "Home Equity",
  home_equity_50a6: "Home Equity 50(a)(6)", home_improvement: "Home Improvement", land_lot: "Land/Lot",
  wrap_mortgage: "Wrap Mortgage", reverse_mortgage: "Reverse Mortgage", reverse: "Reverse",
  conventional: "Conventional", fha: "FHA", va: "VA", usda: "USDA", non_qm: "Non-QM", other: "Other",
  fixed: "Fixed", arm: "ARM", balloon: "Balloon", interest_only: "Interest Only",
  first: "First", second: "Second", wrap: "Wrap", primary: "Primary", secondary: "Secondary", investment: "Investment",
  none: "None", tx_50a6: "Texas 50(a)(6) cash-out", tx_50f2: "Texas 50(f)(2) refinance",
};
const titleCase = (v: string) => LABEL[v] || v;

export default function NewLoanWizard() {
  const router = useRouter();
  const { toast } = useToast();
  const { can } = useCapabilities();
  const [ctx, setCtx] = useState<LoanContext | null>(null);
  const [form, setForm] = useState<Form>(INITIAL);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCtx = useCallback(() => {
    api.get<LoanContext>("/api/v1/loans/new/context")
      .then((d) => { setCtx(d); setForm((f) => ({ ...f, propertyState: d.licensedStates[0] || "TX" })); })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => { loadCtx(); }, [loadCtx]);

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isTX = form.propertyState === "TX";
  const rulesLoaded = ctx?.ruleLoadStatus?.[form.propertyState] ?? true;

  // Per-step required-field gating.
  const stepValid = useMemo(() => {
    switch (step) {
      case 0: return !!(form.borrowerFirstName && form.borrowerLastName);
      case 1: return !!(form.propertyAddress && form.propertyCity && form.propertyState && form.propertyZip);
      case 2: return !!(form.loanNumber && form.loanPurpose && form.loanProduct && form.loanType && form.lienPosition);
      default: return true;
    }
  }, [step, form]);

  if (!can("createLoan")) return <InsufficientPermission />;

  async function submit() {
    setError("");
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        loanNumber: form.loanNumber,
        borrowerFirstName: form.borrowerFirstName,
        borrowerLastName: form.borrowerLastName,
        coBorrowerName: form.coBorrowerName || undefined,
        applicantEmail: form.applicantEmail || undefined,
        applicantPhone: form.applicantPhone || undefined,
        applicationMethod: form.applicationMethod || undefined,
        applicationDate: form.applicationDate || undefined,
        propertyAddress: form.propertyAddress,
        propertyCity: form.propertyCity,
        propertyState: form.propertyState,
        propertyZip: form.propertyZip,
        propertyCounty: form.propertyCounty || undefined,
        occupancyType: form.occupancyType,
        loanPurpose: form.loanPurpose,
        texasCashoutType: isTX ? form.texasCashoutType : undefined,
        loanProduct: form.loanProduct,
        loanType: form.loanType,
        lienPosition: form.lienPosition,
        loanTerm: form.loanTerm ? Number(form.loanTerm) : undefined,
        interestRate: form.interestRate ? Number(form.interestRate) : undefined,
        loanAmount: form.loanAmount ? Number(form.loanAmount) : undefined,
        purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : undefined,
        estimatedClosingDate: form.estimatedClosingDate || undefined,
        loanOriginatorName: form.loanOriginatorName || undefined,
        loanOriginatorNmlsId: form.loanOriginatorNmlsId || undefined,
        lenderName: form.lenderName || undefined,
        lenderNmlsId: form.lenderNmlsId || undefined,
        processorUserId: form.processorUserId || undefined,
        complianceOwnerUserId: form.complianceOwnerUserId || undefined,
      };
      const { loan } = await api.post<{ loan: { id: string } }>("/api/v1/loans", payload);
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
        title="New loan"
        description="A guided intake that captures transaction-log fields and generates the compliance checklist."
        actions={<Link href="/loans"><Button variant="ghost">← All loans</Button></Link>}
      />

      {/* Stepper */}
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li key={label} className={`rounded-full px-3 py-1 font-medium ${i === step ? "bg-[var(--royal)] text-white" : i < step ? "bg-[var(--royal-pl)] text-[var(--royal)]" : "bg-[var(--gray-100)] text-[var(--gray-400)]"}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && <div role="alert" className="rounded-lg bg-[var(--red-pl)] px-3.5 py-2.5 text-sm text-[var(--red)]">{error}</div>}

      <Card className="max-w-3xl">
        {/* Step 1 — Borrower */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Applicant first name *" required value={form.borrowerFirstName} onChange={(e) => set("borrowerFirstName", e.target.value)} />
              <Input label="Applicant last name *" required value={form.borrowerLastName} onChange={(e) => set("borrowerLastName", e.target.value)} />
            </div>
            <Input label="Co-borrower name" value={form.coBorrowerName} onChange={(e) => set("coBorrowerName", e.target.value)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Email" type="email" value={form.applicantEmail} onChange={(e) => set("applicantEmail", e.target.value)} />
              <Input label="Phone" value={form.applicantPhone} onChange={(e) => set("applicantPhone", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Application date" type="date" value={form.applicationDate} onChange={(e) => set("applicationDate", e.target.value)} hint="Defaults to today. Drives the 7-day transaction-log deadline." />
              <Select label="Application method" value={form.applicationMethod} onChange={(e) => set("applicationMethod", e.target.value)}>
                <option value="">—</option>
                <option value="online">Online</option>
                <option value="phone">Phone</option>
                <option value="in_person">In person</option>
                <option value="mail">Mail</option>
              </Select>
            </div>
          </div>
        )}

        {/* Step 2 — Property */}
        {step === 1 && (
          <div className="space-y-4">
            <Input label="Property street address *" required value={form.propertyAddress} onChange={(e) => set("propertyAddress", e.target.value)} placeholder="123 Main St" />
            <div className="grid gap-3 sm:grid-cols-4">
              <Input label="City *" required value={form.propertyCity} onChange={(e) => set("propertyCity", e.target.value)} />
              <Select label="State *" value={form.propertyState} onChange={(e) => set("propertyState", e.target.value)}>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Input label="ZIP *" required value={form.propertyZip} onChange={(e) => set("propertyZip", e.target.value)} placeholder="75001" />
              <Input label="County" value={form.propertyCounty} onChange={(e) => set("propertyCounty", e.target.value)} />
            </div>
            <Select label="Occupancy *" value={form.occupancyType} onChange={(e) => set("occupancyType", e.target.value)} className="sm:max-w-xs">
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
              <option value="investment">Investment</option>
            </Select>
            {!rulesLoaded && (
              <p className="rounded-lg bg-[var(--amb-pl)] px-3 py-2 text-xs text-[var(--amb)]">⚠️ Compliance rules aren&apos;t loaded for {form.propertyState}. The loan will still be created; load rules from <Link href="/setup?step=rules" className="font-semibold underline">Setup</Link> for a complete checklist.</p>
            )}
          </div>
        )}

        {/* Step 3 — Loan details */}
        {step === 2 && (
          <div className="space-y-4">
            <Input label="Loan number *" required value={form.loanNumber} onChange={(e) => set("loanNumber", e.target.value)} placeholder="LN-2026-0001" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Purpose *" value={form.loanPurpose} onChange={(e) => set("loanPurpose", e.target.value)}>
                {(ctx?.loanPurposes || ["purchase","refinance","home_equity_50a6","wrap_mortgage","reverse_mortgage"]).map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
              </Select>
              <Select label="Product *" value={form.loanProduct} onChange={(e) => set("loanProduct", e.target.value)}>
                {(ctx?.loanProducts || ["conventional","fha","va","usda","reverse","non_qm","other"]).map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
              </Select>
              <Select label="Type *" value={form.loanType} onChange={(e) => set("loanType", e.target.value)}>
                {(ctx?.loanTypes || ["fixed","arm","balloon","interest_only","other"]).map((p) => <option key={p} value={p}>{titleCase(p)}</option>)}
              </Select>
            </div>
            {isTX && (
              <Select label="Texas cash-out type" value={form.texasCashoutType} onChange={(e) => set("texasCashoutType", e.target.value)} className="sm:max-w-sm" hint="Drives Texas 50(a)(6) / 50(f)(2) disclosures.">
                <option value="none">None</option>
                <option value="tx_50a6">Texas 50(a)(6) cash-out home equity</option>
                <option value="tx_50f2">Texas 50(f)(2) refinance to non-home-equity</option>
              </Select>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Lien position *" value={form.lienPosition} onChange={(e) => set("lienPosition", e.target.value)}>
                <option value="first">First</option>
                <option value="second">Second</option>
                <option value="wrap">Wrap</option>
              </Select>
              <Input label="Term (months)" type="number" value={form.loanTerm} onChange={(e) => set("loanTerm", e.target.value)} />
              <Input label="Interest rate (%)" type="number" step="0.001" value={form.interestRate} onChange={(e) => set("interestRate", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Loan amount" type="number" value={form.loanAmount} onChange={(e) => set("loanAmount", e.target.value)} />
              <Input label="Purchase price" type="number" value={form.purchasePrice} onChange={(e) => set("purchasePrice", e.target.value)} />
              <Input label="Est. closing date" type="date" value={form.estimatedClosingDate} onChange={(e) => set("estimatedClosingDate", e.target.value)} />
            </div>
          </div>
        )}

        {/* Step 4 — Originator / lender */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Loan originator name" value={form.loanOriginatorName} onChange={(e) => set("loanOriginatorName", e.target.value)} />
              <Input label="Originator NMLS ID" value={form.loanOriginatorNmlsId} onChange={(e) => set("loanOriginatorNmlsId", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Lender name" value={form.lenderName} onChange={(e) => set("lenderName", e.target.value)} />
              <Input label="Lender NMLS ID" value={form.lenderNmlsId} onChange={(e) => set("lenderNmlsId", e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Processor" value={form.processorUserId} onChange={(e) => set("processorUserId", e.target.value)}>
                <option value="">Unassigned</option>
                {(ctx?.assignableUsers || []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </Select>
              <Select label="Compliance owner" value={form.complianceOwnerUserId} onChange={(e) => set("complianceOwnerUserId", e.target.value)}>
                <option value="">Unassigned</option>
                {(ctx?.assignableUsers || []).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
              </Select>
            </div>
          </div>
        )}

        {/* Step 5 — Review */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--gray-900)]">Review &amp; generate checklist</h3>
            <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              {[
                ["Loan #", form.loanNumber], ["Borrower", `${form.borrowerLastName}, ${form.borrowerFirstName}`],
                ["State", form.propertyState], ["Purpose", titleCase(form.loanPurpose)],
                ["Product", titleCase(form.loanProduct)], ["Type", titleCase(form.loanType)],
                ["Lien", titleCase(form.lienPosition)], ["Occupancy", titleCase(form.occupancyType)],
                ...(isTX && form.texasCashoutType !== "none" ? [["TX cash-out", titleCase(form.texasCashoutType)]] : []),
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-[var(--gray-500)]">{label}</dt>
                  <dd className="font-medium text-[var(--gray-900)]">{value || "—"}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-lg border border-[var(--gray-200)] p-3 text-sm">
              <p className="mb-1 font-medium text-[var(--gray-800)]">Conditional rule flags</p>
              <div className="flex flex-wrap gap-2">
                {flagsFor(form, isTX).length === 0 ? (
                  <span className="text-xs text-[var(--gray-500)]">No special conditional disclosures triggered.</span>
                ) : flagsFor(form, isTX).map((f) => <Badge key={f} variant="royal">{f}</Badge>)}
              </div>
              <p className="mt-2 text-xs text-[var(--gray-500)]">The full federal + state checklist is generated on submit from the loaded rules.</p>
            </div>

            {!rulesLoaded && (
              <p className="rounded-lg bg-[var(--amb-pl)] px-3 py-2 text-sm text-[var(--amb)]">⚠️ Rules for {form.propertyState} aren&apos;t loaded — the loan is created but the checklist will be sparse until you load them.</p>
            )}
          </div>
        )}

        {/* Nav */}
        <div className="mt-6 flex items-center justify-between border-t border-[var(--gray-200)] pt-4">
          <Button variant="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || saving}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!stepValid}>Next</Button>
          ) : (
            <Button onClick={submit} loading={saving}>Create loan</Button>
          )}
        </div>
      </Card>
    </div>
  );
}

// UI hint only — the authoritative conditional documents are resolved server-side
// (lib/loan-conditional-docs.ts). This just labels which flags the user triggered.
function flagsFor(form: Form, isTX: boolean): string[] {
  const out: string[] = [];
  if (form.loanType === "arm") out.push("ARM disclosure");
  if (form.loanProduct === "reverse" || form.loanPurpose === "reverse" || form.loanPurpose === "reverse_mortgage") out.push("Reverse mortgage");
  if (form.loanPurpose === "wrap_mortgage" || form.lienPosition === "wrap") out.push("Wrap mortgage");
  if (isTX && (form.texasCashoutType === "tx_50a6" || form.loanPurpose === "home_equity_50a6")) out.push("TX 50(a)(6)");
  if (isTX && form.texasCashoutType === "tx_50f2") out.push("TX 50(f)(2)");
  if (isTX) out.push("TX standard disclosures");
  return out;
}
