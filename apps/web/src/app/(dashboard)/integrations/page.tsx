"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  PageHeader,
  Select,
  cn,
  useToast,
  type BadgeVariant,
} from "@/components/ui";

type CredentialField = "clientId" | "clientSecret" | "apiKey" | "instanceUrl";

interface System {
  id: string;
  name: string;
  vendor: string;
  type: string;
  syncDirection: string;
  features: string[];
  requiredCredentials: CredentialField[];
  supportsWebhook: boolean;
}

interface ConnectedIntegration {
  id: string;
  systemId: string;
  name: string;
  type: string;
  status: string;
  syncDirection: string | null;
  clientId: string | null;
  instanceUrl: string | null;
  hasClientSecret: boolean;
  hasApiKey: boolean;
  webhookEnabled: boolean;
  webhookUrl: string | null;
  connectedAt: string;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
}

interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_processed: number | null;
  error_message: string | null;
}

const TYPE_VARIANT: Record<string, BadgeVariant> = {
  LOS: "blue",
  POS: "purple",
  DOC: "amber",
  CREDIT: "green",
};
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  connected: "green",
  error: "red",
  disconnected: "gray",
};
const CRED_LABELS: Record<CredentialField, string> = {
  clientId: "Client ID",
  clientSecret: "Client Secret",
  apiKey: "API Key",
  instanceUrl: "Instance URL",
};
const isUrl = (v: string) => /^https?:\/\/.+/i.test(v);

export default function IntegrationsPage() {
  const [available, setAvailable] = useState<System[]>([]);
  const [connected, setConnected] = useState<ConnectedIntegration[]>([]);
  const [wizardSystem, setWizardSystem] = useState<System | null>(null);
  const [editing, setEditing] = useState<ConnectedIntegration | null>(null);
  const [historyFor, setHistoryFor] = useState<ConnectedIntegration | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ConnectedIntegration | null>(null);
  const { can } = useCapabilities();
  const { toast } = useToast();

  const ok = (description: string) => toast({ variant: "success", title: "Done", description });
  const fail = (description: string) => toast({ variant: "error", title: "Something went wrong", description });

  const load = useCallback(() => {
    api.get<{ systems: System[] }>("/api/v1/integrations/available").then((d) => setAvailable(d.systems)).catch(() => {});
    api.get<{ integrations: ConnectedIntegration[] }>("/api/v1/integrations/connected").then((d) => setConnected(d.integrations)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!can("viewIntegrations")) return <InsufficientPermission />;
  const canManage = can("manageIntegrations");
  const canSync = can("syncIntegrations");
  const connectedMap = new Map(connected.map((c) => [c.systemId, c]));

  async function sync(systemId: string) {
    try { await api.post(`/api/v1/integrations/sync/${systemId}`); ok("Sync completed."); load(); }
    catch (e: any) { fail(e.message); }
  }
  async function disconnect(c: ConnectedIntegration) {
    try { await api.delete(`/api/v1/integrations/${c.systemId}`); setConfirmDisconnect(null); ok(`${c.name} disconnected.`); load(); }
    catch (e: any) { fail(e.message); }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Integrations" description="Connect your LOS, POS, and vendor systems with a guided setup and health monitoring." />

      {/* Connected — health dashboard */}
      {connected.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[var(--gray-900)]">Connected</h2>
          {connected.map((c) => (
            <Card key={c.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--gray-900)]">{c.name}</p>
                    <Badge variant={TYPE_VARIANT[c.type] || "gray"}>{c.type}</Badge>
                    <Badge variant={STATUS_VARIANT[c.status] || "gray"}>{c.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--gray-500)]">
                    Connected {new Date(c.connectedAt).toLocaleDateString()}
                    {" · "}Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : "never"}
                    {c.webhookEnabled && " · Webhook enabled"}
                  </p>
                  {c.lastError && <p className="mt-1 text-xs font-medium text-[var(--red)]">Last error: {c.lastError}</p>}
                  {c.webhookUrl && <p className="mt-1 break-all text-[11px] text-[var(--gray-400)]">Webhook: {c.webhookUrl}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canSync && <Button size="sm" onClick={() => sync(c.systemId)}>Sync Now</Button>}
                  <Button variant="secondary" size="sm" onClick={() => setHistoryFor(c)}>View History</Button>
                  {canManage && <Button variant="secondary" size="sm" onClick={() => setEditing(c)}>Edit Credentials</Button>}
                  {canManage && <Button variant="secondary" size="sm" onClick={() => setConfirmDisconnect(c)} className="!border-[var(--red)] !text-[var(--red)]">Disconnect</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Available */}
      <h2 className="text-sm font-semibold text-[var(--gray-900)]">Available Systems</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {available.map((sys) => {
          const conn = connectedMap.get(sys.id);
          return (
            <Card key={sys.id}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[var(--gray-900)]">{sys.name}</h3>
                <Badge variant={TYPE_VARIANT[sys.type] || "gray"}>{sys.type}</Badge>
              </div>
              <p className="mb-2 text-xs text-[var(--gray-500)]">{sys.vendor}</p>
              <ul className="mb-3 space-y-1">
                {sys.features.slice(0, 3).map((f) => <li key={f} className="text-xs text-[var(--gray-600)]">&bull; {f}</li>)}
              </ul>
              {conn ? (
                <span className="text-xs font-medium text-[var(--grn)]">Connected</span>
              ) : canManage ? (
                <Button fullWidth size="sm" onClick={() => setWizardSystem(sys)}>Set up</Button>
              ) : (
                <span className="text-xs text-[var(--gray-500)]">Insufficient permission to connect</span>
              )}
            </Card>
          );
        })}
      </div>

      {(wizardSystem || editing) && (
        <SetupWizard
          system={wizardSystem || available.find((s) => s.id === editing!.systemId) || null}
          existing={editing}
          onClose={() => { setWizardSystem(null); setEditing(null); }}
          onDone={(msg) => { setWizardSystem(null); setEditing(null); ok(msg); load(); }}
          onError={fail}
        />
      )}
      {historyFor && <HistoryModal integration={historyFor} onClose={() => setHistoryFor(null)} onError={fail} />}
      {confirmDisconnect && (
        <ConfirmModal
          title={`Disconnect ${confirmDisconnect.name}?`}
          message="This removes stored credentials and the webhook. Sync history is retained. This cannot be undone."
          confirmLabel="Disconnect"
          onCancel={() => setConfirmDisconnect(null)}
          onConfirm={() => disconnect(confirmDisconnect)}
        />
      )}
    </div>
  );
}

const STEPS = ["System", "Credentials", "Sync", "Webhook", "Test", "Finish"];

function SetupWizard({ system, existing, onClose, onDone, onError }: {
  system: System | null; existing: ConnectedIntegration | null;
  onClose: () => void; onDone: (msg: string) => void; onError: (m: string) => void;
}) {
  const [step, setStep] = useState(existing ? 1 : 0);
  const [form, setForm] = useState({
    clientId: existing?.clientId || "",
    clientSecret: "",
    apiKey: "",
    instanceUrl: existing?.instanceUrl || "",
    syncDirection: existing?.syncDirection || system?.syncDirection || "bi-directional",
    webhookEnabled: existing?.webhookEnabled || false,
  });
  const [test, setTest] = useState<{ success: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  if (!system) return null;

  const required = system.requiredCredentials;
  // On edit, secrets already stored count as satisfied unless the user re-enters them.
  const credSatisfied = required.every((field) => {
    if (field === "instanceUrl") return form.instanceUrl ? isUrl(form.instanceUrl) : false;
    if (field === "clientSecret") return Boolean(form.clientSecret || existing?.hasClientSecret);
    if (field === "apiKey") return Boolean(form.apiKey || existing?.hasApiKey);
    return Boolean((form as any)[field]);
  });
  const urlInvalid = required.includes("instanceUrl") && form.instanceUrl !== "" && !isUrl(form.instanceUrl);

  function buildPayload() {
    const p: any = { systemId: system!.id, syncDirection: form.syncDirection, webhookEnabled: form.webhookEnabled };
    if (form.clientId) p.clientId = form.clientId;
    if (form.clientSecret) p.clientSecret = form.clientSecret;
    if (form.apiKey) p.apiKey = form.apiKey;
    if (form.instanceUrl) p.instanceUrl = form.instanceUrl;
    return p;
  }

  async function runTest() {
    setBusy(true); setTest(null);
    try {
      const res = await api.post<{ success: boolean; message: string }>("/api/v1/integrations/test", buildPayload());
      setTest(res);
    } catch (e: any) {
      // /test returns 400 with a body for failures; api throws with the message.
      setTest({ success: false, message: e.message });
    } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true);
    try {
      const res = await api.post<{ integration: any; webhookSecret: string | null }>("/api/v1/integrations/connect", buildPayload());
      if (res.webhookSecret) { setWebhookSecret(res.webhookSecret); }
      else { onDone(existing ? `${system!.name} updated.` : `${system!.name} connected.`); }
    } catch (e: any) {
      onError(e.message); setBusy(false);
    }
  }

  const canNext = step === 1 ? credSatisfied : true;

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      size="lg"
      title={`${existing ? "Edit" : "Set up"} ${system.name}`}
      footer={
        !webhookSecret && (
          <div className="flex w-full justify-between">
            <Button variant="secondary" onClick={() => setStep((s) => Math.max(existing ? 1 : 0, s - 1))} disabled={step === (existing ? 1 : 0) || busy}>Back</Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Next</Button>
            ) : <span />}
          </div>
        )
      }
    >
      {/* Stepper */}
      <ol className="mb-5 flex flex-wrap gap-1 text-[11px]">
        {STEPS.map((label, i) => (
          <li key={label} className={cn("rounded-full px-2 py-0.5", i === step ? "bg-[var(--royal)] text-white" : i < step ? "bg-[var(--royal-pl)] text-[var(--royal)]" : "bg-[var(--gray-100)] text-[var(--gray-400)]")}>{i + 1}. {label}</li>
        ))}
      </ol>

      <div className="min-h-[180px]">
        {step === 0 && (
          <div>
            <p className="text-sm text-[var(--gray-600)]">You are setting up <strong>{system.name}</strong> ({system.vendor}). This {system.type} system syncs <strong>{system.syncDirection}</strong>.</p>
            <ul className="mt-3 space-y-1">{system.features.map((f) => <li key={f} className="text-xs text-[var(--gray-600)]">&bull; {f}</li>)}</ul>
          </div>
        )}
        {step === 1 && (
          <div className="space-y-3">
            <div className="rounded-lg bg-[var(--amb-pl)] p-3 text-xs text-[var(--amb)]">🔒 Credentials are encrypted at rest and never shown again. Only enter values you are authorized to store.</div>
            {required.map((field) => (
              <Input
                key={field}
                type={field === "clientSecret" || field === "apiKey" ? "password" : "text"}
                label={`${CRED_LABELS[field]}${(field === "clientSecret" && existing?.hasClientSecret) || (field === "apiKey" && existing?.hasApiKey) ? " (leave blank to keep current)" : ""}`}
                value={(form as any)[field]}
                onChange={(e) => set(field, e.target.value)}
                placeholder={field === "instanceUrl" ? "https://your-instance.example.com" : ""}
                error={field === "instanceUrl" && urlInvalid ? "Must be a valid http(s) URL." : undefined}
              />
            ))}
            {required.length === 0 && <p className="text-sm text-[var(--gray-500)]">This system needs no stored credentials.</p>}
          </div>
        )}
        {step === 2 && (
          <div>
            <Select label="Sync direction" value={form.syncDirection} onChange={(e) => set("syncDirection", e.target.value)}>
              <option value="bi-directional">Bi-directional</option>
              <option value="inbound">Inbound (pull only)</option>
              <option value="outbound">Outbound (push only)</option>
            </Select>
            <p className="mt-2 text-xs text-[var(--gray-500)]">Choose how data flows between MortgageGuard and {system.name}.</p>
          </div>
        )}
        {step === 3 && (
          system.supportsWebhook ? (
            <label className="flex items-start gap-3">
              <input type="checkbox" checked={form.webhookEnabled} onChange={(e) => set("webhookEnabled", e.target.checked)} className="mt-1 accent-[var(--royal)]" />
              <span className="text-sm text-[var(--gray-700)]">Enable webhook. We&apos;ll generate a signed webhook URL and a one-time signing secret so {system.name} can push real-time updates.</span>
            </label>
          ) : <p className="text-sm text-[var(--gray-500)]">{system.name} does not support webhooks.</p>
        )}
        {step === 4 && (
          <div className="space-y-3">
            <Button variant="success" onClick={runTest} loading={busy} disabled={!credSatisfied}>{busy ? "Testing…" : "Test connection"}</Button>
            {test && <div className={cn("rounded-lg p-3 text-sm", test.success ? "bg-[var(--grn-pl)] text-[var(--grn)]" : "bg-[var(--red-pl)] text-[var(--red)]")}>{test.success ? "✓ " : "✕ "}{test.message}</div>}
          </div>
        )}
        {step === 5 && (
          webhookSecret ? (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-[var(--grn)]">Connected.</p>
              <div className="rounded-lg border border-[var(--amb-pl)] bg-[var(--amb-pl)] p-3 text-sm text-[var(--amb)]">
                <p className="font-semibold">Webhook signing secret (shown once):</p>
                <code className="mt-1 block break-all text-xs">{webhookSecret}</code>
                <p className="mt-1 text-xs">Configure this in {system.name}. It will not be shown again.</p>
              </div>
              <Button onClick={() => onDone(`${system.name} connected.`)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--gray-600)]">Review and save. Credentials will be encrypted and stored.</p>
              <ul className="text-xs text-[var(--gray-600)]">
                <li>System: {system.name}</li>
                <li>Sync: {form.syncDirection}</li>
                <li>Webhook: {form.webhookEnabled ? "enabled" : "disabled"}</li>
                {test && <li>Last test: {test.success ? "passed" : "failed"}</li>}
              </ul>
              <Button onClick={finish} loading={busy}>{busy ? "Saving…" : existing ? "Save changes" : "Connect"}</Button>
            </div>
          )
        )}
      </div>
    </Modal>
  );
}

function HistoryModal({ integration, onClose, onError }: { integration: ConnectedIntegration; onClose: () => void; onError: (m: string) => void }) {
  const [history, setHistory] = useState<SyncRun[] | null>(null);
  useEffect(() => {
    api.get<{ history: SyncRun[] }>(`/api/v1/integrations/${integration.systemId}/history`).then((d) => setHistory(d.history)).catch((e) => onError(e.message));
  }, [integration.systemId, onError]);
  return (
    <Modal open onClose={onClose} size="lg" title={`Sync history — ${integration.name}`}>
      <div className="space-y-2">
        {!history && <p className="text-sm text-[var(--gray-400)]">Loading…</p>}
        {history && history.length === 0 && <p className="text-sm text-[var(--gray-500)]">No syncs yet.</p>}
        {history?.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-[var(--gray-200)] px-3 py-2 text-sm">
            <div>
              <Badge variant={r.status === "completed" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Badge>
              <span className="ml-2 text-xs text-[var(--gray-500)]">{new Date(r.started_at).toLocaleString()}</span>
              {r.error_message && <p className="mt-1 text-xs text-[var(--red)]">{r.error_message}</p>}
            </div>
            <span className="text-xs text-[var(--gray-600)]">{r.records_processed ?? 0} records</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function ConfirmModal({ title, message, confirmLabel, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      size="md"
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="text-sm text-[var(--gray-600)]">{message}</p>
    </Modal>
  );
}
