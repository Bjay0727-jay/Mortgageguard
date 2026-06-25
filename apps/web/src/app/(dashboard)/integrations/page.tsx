"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";

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

const TYPE_COLORS: Record<string, string> = {
  LOS: "bg-blue-100 text-blue-800",
  POS: "bg-purple-100 text-purple-800",
  DOC: "bg-amber-100 text-amber-800",
  CREDIT: "bg-green-100 text-green-800",
};
const STATUS_COLORS: Record<string, string> = {
  connected: "bg-green-100 text-green-800",
  error: "bg-red-100 text-red-800",
  disconnected: "bg-gray-100 text-gray-600",
};
const CRED_LABELS: Record<CredentialField, string> = {
  clientId: "Client ID",
  clientSecret: "Client Secret",
  apiKey: "API Key",
  instanceUrl: "Instance URL",
};
const isUrl = (v: string) => /^https?:\/\/.+/i.test(v);

type Toast = { type: "success" | "error"; message: string } | null;

export default function IntegrationsPage() {
  const [available, setAvailable] = useState<System[]>([]);
  const [connected, setConnected] = useState<ConnectedIntegration[]>([]);
  const [toast, setToast] = useState<Toast>(null);
  const [wizardSystem, setWizardSystem] = useState<System | null>(null);
  const [editing, setEditing] = useState<ConnectedIntegration | null>(null);
  const [historyFor, setHistoryFor] = useState<ConnectedIntegration | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState<ConnectedIntegration | null>(null);
  const { can } = useCapabilities();

  const showToast = useCallback((t: Toast) => { setToast(t); if (t) setTimeout(() => setToast(null), 4000); }, []);
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
    try { await api.post(`/api/v1/integrations/sync/${systemId}`); showToast({ type: "success", message: "Sync completed." }); load(); }
    catch (e: any) { showToast({ type: "error", message: e.message }); }
  }
  async function disconnect(c: ConnectedIntegration) {
    try { await api.delete(`/api/v1/integrations/${c.systemId}`); setConfirmDisconnect(null); showToast({ type: "success", message: `${c.name} disconnected.` }); load(); }
    catch (e: any) { showToast({ type: "error", message: e.message }); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
        <p className="text-sm text-gray-500">Connect your LOS, POS, and vendor systems with a guided setup and health monitoring.</p>
      </div>

      {/* Connected — health dashboard */}
      {connected.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Connected</h2>
          {connected.map((c) => (
            <div key={c.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[c.type] || "bg-gray-100 text-gray-600"}`}>{c.type}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[c.status] || "bg-gray-100 text-gray-600"}`}>{c.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Connected {new Date(c.connectedAt).toLocaleDateString()}
                    {" · "}Last sync: {c.lastSyncAt ? new Date(c.lastSyncAt).toLocaleString() : "never"}
                    {c.webhookEnabled && " · Webhook enabled"}
                  </p>
                  {c.lastError && <p className="mt-1 text-xs font-medium text-red-600">Last error: {c.lastError}</p>}
                  {c.webhookUrl && <p className="mt-1 break-all text-[11px] text-gray-400">Webhook: {c.webhookUrl}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {canSync && <button onClick={() => sync(c.systemId)} className="rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298]">Sync Now</button>}
                  <button onClick={() => setHistoryFor(c)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">View History</button>
                  {canManage && <button onClick={() => setEditing(c)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">Edit Credentials</button>}
                  {canManage && <button onClick={() => setConfirmDisconnect(c)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">Disconnect</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Available */}
      <h2 className="text-sm font-semibold text-gray-900">Available Systems</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {available.map((sys) => {
          const conn = connectedMap.get(sys.id);
          return (
            <div key={sys.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-900">{sys.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[sys.type] || "bg-gray-100 text-gray-600"}`}>{sys.type}</span>
              </div>
              <p className="mb-2 text-xs text-gray-500">{sys.vendor}</p>
              <ul className="mb-3 space-y-1">
                {sys.features.slice(0, 3).map((f) => <li key={f} className="text-xs text-gray-600">&bull; {f}</li>)}
              </ul>
              {conn ? (
                <span className="text-xs font-medium text-green-700">Connected</span>
              ) : canManage ? (
                <button onClick={() => setWizardSystem(sys)} className="w-full rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298]">Set up</button>
              ) : (
                <span className="text-xs text-gray-500">Insufficient permission to connect</span>
              )}
            </div>
          );
        })}
      </div>

      {(wizardSystem || editing) && (
        <SetupWizard
          system={wizardSystem || available.find((s) => s.id === editing!.systemId) || null}
          existing={editing}
          onClose={() => { setWizardSystem(null); setEditing(null); }}
          onDone={(msg) => { setWizardSystem(null); setEditing(null); showToast({ type: "success", message: msg }); load(); }}
          onError={(m) => showToast({ type: "error", message: m })}
        />
      )}
      {historyFor && <HistoryModal integration={historyFor} onClose={() => setHistoryFor(null)} onError={(m) => showToast({ type: "error", message: m })} />}
      {confirmDisconnect && (
        <ConfirmModal
          title={`Disconnect ${confirmDisconnect.name}?`}
          message="This removes stored credentials and the webhook. Sync history is retained. This cannot be undone."
          confirmLabel="Disconnect"
          onCancel={() => setConfirmDisconnect(null)}
          onConfirm={() => disconnect(confirmDisconnect)}
        />
      )}
      {toast && <div role="status" className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}>{toast.message}</div>}
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

  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-[#1B3A6B] focus:ring-2 focus:ring-[#1B3A6B]/10";
  const canNext = step === 1 ? credSatisfied : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">{existing ? "Edit" : "Set up"} {system.name}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        {/* Stepper */}
        <ol className="mt-3 flex flex-wrap gap-1 text-[11px]">
          {STEPS.map((label, i) => (
            <li key={label} className={`rounded-full px-2 py-0.5 ${i === step ? "bg-[#1B3A6B] text-white" : i < step ? "bg-[#E8EEF7] text-[#1B3A6B]" : "bg-gray-100 text-gray-400"}`}>{i + 1}. {label}</li>
          ))}
        </ol>

        <div className="mt-5 min-h-[180px]">
          {step === 0 && (
            <div>
              <p className="text-sm text-gray-600">You are setting up <strong>{system.name}</strong> ({system.vendor}). This {system.type} system syncs <strong>{system.syncDirection}</strong>.</p>
              <ul className="mt-3 space-y-1">{system.features.map((f) => <li key={f} className="text-xs text-gray-600">&bull; {f}</li>)}</ul>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-3">
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">🔒 Credentials are encrypted at rest and never shown again. Only enter values you are authorized to store.</div>
              {required.map((field) => (
                <label key={field} className="block">
                  <span className="text-sm font-medium text-gray-700">{CRED_LABELS[field]}{(field === "clientSecret" && existing?.hasClientSecret) || (field === "apiKey" && existing?.hasApiKey) ? " (leave blank to keep current)" : ""}</span>
                  <input
                    type={field === "clientSecret" || field === "apiKey" ? "password" : "text"}
                    value={(form as any)[field]}
                    onChange={(e) => set(field, e.target.value)}
                    placeholder={field === "instanceUrl" ? "https://your-instance.example.com" : ""}
                    className={input}
                  />
                  {field === "instanceUrl" && urlInvalid && <span className="text-xs text-red-600">Must be a valid http(s) URL.</span>}
                </label>
              ))}
              {required.length === 0 && <p className="text-sm text-gray-500">This system needs no stored credentials.</p>}
            </div>
          )}
          {step === 2 && (
            <label className="block">
              <span className="text-sm font-medium text-gray-700">Sync direction</span>
              <select value={form.syncDirection} onChange={(e) => set("syncDirection", e.target.value)} className={input}>
                <option value="bi-directional">Bi-directional</option>
                <option value="inbound">Inbound (pull only)</option>
                <option value="outbound">Outbound (push only)</option>
              </select>
              <p className="mt-2 text-xs text-gray-500">Choose how data flows between MortgageGuard and {system.name}.</p>
            </label>
          )}
          {step === 3 && (
            system.supportsWebhook ? (
              <label className="flex items-start gap-3">
                <input type="checkbox" checked={form.webhookEnabled} onChange={(e) => set("webhookEnabled", e.target.checked)} className="mt-1" />
                <span className="text-sm text-gray-700">Enable webhook. We&apos;ll generate a signed webhook URL and a one-time signing secret so {system.name} can push real-time updates.</span>
              </label>
            ) : <p className="text-sm text-gray-500">{system.name} does not support webhooks.</p>
          )}
          {step === 4 && (
            <div className="space-y-3">
              <button onClick={runTest} disabled={busy || !credSatisfied} className="rounded-lg bg-[#0F7B46] px-4 py-2 text-sm font-semibold text-white hover:bg-[#15A35E] disabled:opacity-50">{busy ? "Testing…" : "Test connection"}</button>
              {test && <div className={`rounded-lg p-3 text-sm ${test.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{test.success ? "✓ " : "✕ "}{test.message}</div>}
            </div>
          )}
          {step === 5 && (
            webhookSecret ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-green-700">Connected.</p>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-semibold">Webhook signing secret (shown once):</p>
                  <code className="mt-1 block break-all text-xs">{webhookSecret}</code>
                  <p className="mt-1 text-xs">Configure this in {system.name}. It will not be shown again.</p>
                </div>
                <button onClick={() => onDone(`${system.name} connected.`)} className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white">Done</button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">Review and save. Credentials will be encrypted and stored.</p>
                <ul className="text-xs text-gray-600">
                  <li>System: {system.name}</li>
                  <li>Sync: {form.syncDirection}</li>
                  <li>Webhook: {form.webhookEnabled ? "enabled" : "disabled"}</li>
                  {test && <li>Last test: {test.success ? "passed" : "failed"}</li>}
                </ul>
                <button onClick={finish} disabled={busy} className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2B5298] disabled:opacity-50">{busy ? "Saving…" : existing ? "Save changes" : "Connect"}</button>
              </div>
            )
          )}
        </div>

        {!webhookSecret && (
          <div className="mt-5 flex justify-between">
            <button onClick={() => setStep((s) => Math.max(existing ? 1 : 0, s - 1))} disabled={step === (existing ? 1 : 0) || busy} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 disabled:opacity-40">Back</button>
            {step < STEPS.length - 1 ? (
              <button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="rounded-lg bg-[#1B3A6B] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Next</button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryModal({ integration, onClose, onError }: { integration: ConnectedIntegration; onClose: () => void; onError: (m: string) => void }) {
  const [history, setHistory] = useState<SyncRun[] | null>(null);
  useEffect(() => {
    api.get<{ history: SyncRun[] }>(`/api/v1/integrations/${integration.systemId}/history`).then((d) => setHistory(d.history)).catch((e) => onError(e.message));
  }, [integration.systemId, onError]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-gray-900">Sync history — {integration.name}</h2>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-600">&times;</button>
        </div>
        <div className="mt-4 space-y-2">
          {!history && <p className="text-sm text-gray-400">Loading…</p>}
          {history && history.length === 0 && <p className="text-sm text-gray-500">No syncs yet.</p>}
          {history?.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "completed" ? "bg-green-100 text-green-800" : r.status === "failed" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{r.status}</span>
                <span className="ml-2 text-xs text-gray-500">{new Date(r.started_at).toLocaleString()}</span>
                {r.error_message && <p className="mt-1 text-xs text-red-600">{r.error_message}</p>}
              </div>
              <span className="text-xs text-gray-600">{r.records_processed ?? 0} records</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel, onCancel, onConfirm }: { title: string; message: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">Cancel</button>
          <button onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
