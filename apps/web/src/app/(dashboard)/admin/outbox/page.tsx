"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useCapabilities } from "@/lib/capabilities";
import { InsufficientPermission } from "@/components/insufficient-permission";
import {
  outboxStatusVariant,
  deriveOutboxSummaryCards,
  buildOutboxQuery,
  redactPayload,
  canRetryOutbox,
  canDeadLetterOutbox,
  canProcessOutbox,
  type OutboxSummary,
} from "@/lib/outbox";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  Table,
  useToast,
  type Column,
} from "@/components/ui";

interface OutboxEvent {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  company_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_error: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  processed_at: string | null;
}

const STATUSES = ["pending", "processing", "processed", "failed", "dead_letter"];
const CARD_TONE: Record<string, string> = { neutral: "var(--gray-700)", warn: "var(--amb)", danger: "var(--red)", good: "var(--grn)" };

export default function OutboxAdminPage() {
  const { can } = useCapabilities();
  const { toast } = useToast();
  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [summary, setSummary] = useState<OutboxSummary | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [detail, setDetail] = useState<OutboxEvent | null>(null);

  const load = useCallback(() => {
    api.get<{ summary: OutboxSummary; events: OutboxEvent[] }>(buildOutboxQuery({ status: status || undefined }))
      .then((d) => { setEvents(d.events); setSummary(d.summary); })
      .catch((e) => setError(e.message));
  }, [status]);

  useEffect(() => { load(); }, [load]);

  if (!can("viewOutbox")) return <InsufficientPermission />;

  async function processNow() {
    setProcessing(true);
    setError("");
    try {
      const res = await api.post<{ summary: { claimed: number; processed: number; failed: number; deadLettered: number } }>("/api/v1/outbox/process", {});
      load();
      toast({ variant: "success", title: "Outbox processed", description: `${res.summary.processed} processed, ${res.summary.failed} failed, ${res.summary.deadLettered} dead-lettered.` });
    } catch (e: any) {
      setError(e.message || "Processing failed");
    } finally {
      setProcessing(false);
    }
  }

  async function retry(id: string) {
    try { await api.post(`/api/v1/outbox/${id}/retry`, {}); load(); toast({ variant: "success", title: "Event re-queued" }); }
    catch (e: any) { setError(e.message); }
  }
  async function deadLetter(id: string) {
    try { await api.post(`/api/v1/outbox/${id}/dead-letter`, {}); load(); toast({ variant: "success", title: "Event dead-lettered" }); }
    catch (e: any) { setError(e.message); }
  }

  const cards = deriveOutboxSummaryCards(summary);

  const columns: Column<OutboxEvent>[] = [
    { key: "event_type", header: "Event", render: (e) => <span className="font-medium text-[var(--gray-900)]">{e.event_type}</span> },
    { key: "aggregate", header: "Aggregate", render: (e) => <span className="text-[var(--gray-600)]">{e.aggregate_type}</span>, hideOnMobile: true },
    { key: "status", header: "Status", render: (e) => <Badge variant={outboxStatusVariant(e.status)}>{e.status.replace(/_/g, " ")}</Badge> },
    { key: "attempts", header: "Attempts", render: (e) => `${e.attempts}/${e.max_attempts}` },
    { key: "next", header: "Next attempt", render: (e) => (e.next_attempt_at ? String(e.next_attempt_at).slice(0, 16).replace("T", " ") : "—"), hideOnMobile: true },
    { key: "error", header: "Last error", render: (e) => <span className="block max-w-[200px] truncate text-xs text-[var(--red)]">{e.last_error || "—"}</span>, hideOnMobile: true },
    {
      key: "actions",
      header: "Actions",
      render: (e) => (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => setDetail(e)}>View</Button>
          {canRetryOutbox(can) && e.status !== "processed" && <Button size="sm" variant="secondary" onClick={() => retry(e.id)}>Retry</Button>}
          {canDeadLetterOutbox(can) && !["processed", "dead_letter"].includes(e.status) && <Button size="sm" variant="danger" onClick={() => deadLetter(e.id)}>Dead-letter</Button>}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Outbox"
        description="Durable compliance events with retry, backoff, and dead-lettering."
        actions={canProcessOutbox(can) ? <Button onClick={processNow} loading={processing}>Process pending</Button> : null}
      />
      {error && <div role="alert" className="rounded-md bg-[var(--red-pl)] p-3 text-sm text-[var(--red)]">{error}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.key} className="text-center">
            <div className="text-2xl font-bold" style={{ color: CARD_TONE[c.tone] }}>{c.value}</div>
            <div className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--gray-500)]">{c.label}</div>
          </Card>
        ))}
      </div>

      <Card className="flex flex-wrap items-end gap-3">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
          <option value="">All</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </Select>
        {status && <Button variant="secondary" onClick={() => setStatus("")}>Clear</Button>}
      </Card>

      <Card flush className="overflow-hidden">
        <Table columns={columns} data={events} rowKey={(e) => e.id} caption="Outbox events"
          emptyState={<EmptyState icon={<span className="text-lg">📭</span>} title="No outbox events" description="Durable compliance events appear here as workflows run." />} />
      </Card>

      {detail && <OutboxDetailModal event={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function OutboxDetailModal({ event, onClose }: { event: OutboxEvent; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} size="lg" title={event.event_type} description={`Event ${event.id}`}>
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-2">
          {([
            ["Aggregate", `${event.aggregate_type} ${event.aggregate_id ?? ""}`],
            ["Company", event.company_id ?? "—"],
            ["Status", event.status],
            ["Attempts", `${event.attempts}/${event.max_attempts}`],
            ["Next attempt", event.next_attempt_at ?? "—"],
            ["Processed", event.processed_at ?? "—"],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}><p className="text-xs text-[var(--gray-500)]">{k}</p><p className="font-medium text-[var(--gray-900)]">{v}</p></div>
          ))}
        </div>
        {event.last_error && <div className="rounded-md bg-[var(--red-pl)] p-2.5 text-xs text-[var(--red)]">{event.last_error}</div>}
        <div>
          <p className="text-xs font-semibold text-[var(--gray-600)]">Payload (redacted)</p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-[var(--gray-50)] p-3 text-xs">{JSON.stringify(redactPayload(event.payload), null, 2)}</pre>
        </div>
      </div>
    </Modal>
  );
}
