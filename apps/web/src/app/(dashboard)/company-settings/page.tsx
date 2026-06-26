"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { Button, Card, Input, PageHeader, Select, useToast } from "@/components/ui";

interface CompanySettings {
  id: string;
  name: string | null;
  nmlsId: string | null;
  entityType: string | null;
  primaryContact: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  address: string | null;
  licenseStates: string[];
  allowsRemoteWork: boolean | null;
}

const STATES = ["TX", "CA", "FL", "NY", "IL", "GA", "AZ", "CO", "NC", "WA"];

export default function CompanySettingsPage() {
  const { can } = useCapabilities();
  const { toast } = useToast();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const canManage = can("manageCompanySettings");

  const load = useCallback(() => {
    api.get<{ company: CompanySettings }>("/api/v1/company/settings").then((d) => setSettings(d.company)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  function set<K extends keyof CompanySettings>(key: K, value: CompanySettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }
  function toggleState(code: string) {
    setSettings((s) => {
      if (!s) return s;
      const has = s.licenseStates.includes(code);
      return { ...s, licenseStates: has ? s.licenseStates.filter((x) => x !== code) : [...s.licenseStates, code] };
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      await api.patch("/api/v1/company/settings", {
        name: settings.name || undefined,
        nmlsId: settings.nmlsId || undefined,
        entityType: settings.entityType || undefined,
        primaryContact: settings.primaryContact || undefined,
        primaryEmail: settings.primaryEmail || undefined,
        primaryPhone: settings.primaryPhone || undefined,
        address: settings.address || undefined,
        licenseStates: settings.licenseStates,
        allowsRemoteWork: settings.allowsRemoteWork ?? undefined,
      });
      toast({ variant: "success", title: "Company profile saved", description: "Setup status will reflect your changes." });
      load();
    } catch (e: any) {
      toast({ variant: "error", title: "Could not save", description: e.message });
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) return <Card className="text-center"><p className="text-sm text-[var(--red)]">{error}</p></Card>;
  if (!settings) return <p className="text-[var(--gray-500)]">Loading company settings…</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="Company Settings" description="Confirm your company profile, licensed states, compliance contact, and remote-work setting." />

      <Card>
        <form onSubmit={save} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Legal company name" value={settings.name || ""} onChange={(e) => set("name", e.target.value)} disabled={!canManage} />
            <Input label="NMLS ID" value={settings.nmlsId || ""} onChange={(e) => set("nmlsId", e.target.value)} disabled={!canManage} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Entity type" value={settings.entityType || ""} onChange={(e) => set("entityType", e.target.value)} disabled={!canManage}>
              <option value="">Select…</option>
              <option value="broker">Broker</option>
              <option value="lender">Lender</option>
              <option value="servicer">Servicer</option>
              <option value="broker_lender">Broker / Lender</option>
            </Select>
            <Input label="Principal office address" value={settings.address || ""} onChange={(e) => set("address", e.target.value)} disabled={!canManage} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Primary compliance contact" value={settings.primaryContact || ""} onChange={(e) => set("primaryContact", e.target.value)} disabled={!canManage} />
            <Input label="Compliance contact email" type="email" value={settings.primaryEmail || ""} onChange={(e) => set("primaryEmail", e.target.value)} disabled={!canManage} />
          </div>

          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-[var(--gray-700)]">Licensed states</legend>
            <div className="flex flex-wrap gap-2">
              {STATES.map((code) => {
                const active = settings.licenseStates.includes(code);
                return (
                  <button key={code} type="button" disabled={!canManage} onClick={() => toggleState(code)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${active ? "border-[var(--royal)] bg-[var(--royal-pl)] text-[var(--royal)]" : "border-[var(--gray-300)] text-[var(--gray-600)]"} disabled:opacity-60`}
                    aria-pressed={active}>
                    {code}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-[var(--gray-700)]">Allow remote work?</legend>
            <p className="mb-2 text-xs text-[var(--gray-500)]">Confirm explicitly — this determines whether the Remote Work Policy program is required or marked not applicable.</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={settings.allowsRemoteWork === true ? "primary" : "secondary"} disabled={!canManage} onClick={() => set("allowsRemoteWork", true)}>Yes, remote work allowed</Button>
              <Button type="button" size="sm" variant={settings.allowsRemoteWork === false ? "primary" : "secondary"} disabled={!canManage} onClick={() => set("allowsRemoteWork", false)}>No, in-office only</Button>
            </div>
          </fieldset>

          {canManage && (
            <div className="flex justify-end">
              <Button type="submit" loading={saving}>Save company profile</Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
