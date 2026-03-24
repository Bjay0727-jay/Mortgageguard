"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface System {
  id: string;
  name: string;
  vendor: string;
  type: string;
  syncDirection: string;
  features: string[];
}

interface ConnectedIntegration {
  systemId: string;
  name: string;
  type: string;
  status: string;
  connectedAt: string;
  lastSync: string | null;
}

export default function IntegrationsPage() {
  const [available, setAvailable] = useState<System[]>([]);
  const [connected, setConnected] = useState<ConnectedIntegration[]>([]);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);

  function load() {
    api.get<{ systems: System[] }>("/api/v1/integrations/available").then((d) => setAvailable(d.systems));
    api.get<{ integrations: ConnectedIntegration[] }>("/api/v1/integrations/connected").then((d) => setConnected(d.integrations)).catch(() => {});
  }

  useEffect(load, []);

  const connectedIds = new Set(connected.map((c) => c.systemId));

  async function connect(systemId: string) {
    setConnecting(systemId);
    try {
      await api.post("/api/v1/integrations/connect", { systemId });
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConnecting(null);
    }
  }

  async function sync(systemId: string) {
    try {
      await api.post(`/api/v1/integrations/sync/${systemId}`);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function disconnect(systemId: string) {
    try {
      await api.delete(`/api/v1/integrations/${systemId}`);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const TYPE_COLORS: Record<string, string> = {
    LOS: "bg-blue-100 text-blue-800",
    POS: "bg-purple-100 text-purple-800",
    DOC: "bg-amber-100 text-amber-800",
    CREDIT: "bg-green-100 text-green-800",
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
      <p className="text-sm text-gray-500">Connect your LOS, POS, and vendor systems.</p>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {/* Connected */}
      {connected.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Connected</h2>
          {connected.map((c) => (
            <div key={c.systemId} className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-4">
              <div>
                <p className="text-sm font-medium text-gray-900">{c.name}</p>
                <p className="text-xs text-gray-500">
                  Connected {new Date(c.connectedAt).toLocaleDateString()}
                  {c.lastSync && ` · Last sync: ${new Date(c.lastSync).toLocaleString()}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => sync(c.systemId)} className="rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298]">
                  Sync Now
                </button>
                <button onClick={() => disconnect(c.systemId)} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50">
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Available */}
      <h2 className="text-sm font-semibold text-gray-900">Available Systems</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {available.map((sys) => (
          <div key={sys.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{sys.name}</h3>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_COLORS[sys.type] || "bg-gray-100 text-gray-600"}`}>
                {sys.type}
              </span>
            </div>
            <p className="mb-2 text-xs text-gray-500">{sys.vendor}</p>
            <ul className="mb-3 space-y-1">
              {sys.features.slice(0, 3).map((f) => (
                <li key={f} className="text-xs text-gray-600">
                  &bull; {f}
                </li>
              ))}
            </ul>
            {connectedIds.has(sys.id) ? (
              <span className="text-xs font-medium text-green-700">Connected</span>
            ) : (
              <button
                onClick={() => connect(sys.id)}
                disabled={connecting === sys.id}
                className="w-full rounded-md bg-[#1B3A6B] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#2B5298] disabled:opacity-50"
              >
                {connecting === sys.id ? "Connecting..." : "Connect"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
