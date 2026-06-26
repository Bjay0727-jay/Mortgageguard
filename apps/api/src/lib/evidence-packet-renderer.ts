// ─────────────────────────────────────────────────────────────
// MortgageGuard — Evidence packet renderers (JSON + HTML)
//
// Pure rendering of an EvidencePacketPayload to the two MVP output formats.
// HTML is fully escaped (no raw interpolation of packet data) so examiner
// documents are safe to open in a browser.
// ─────────────────────────────────────────────────────────────

import type { EvidencePacketPayload, EvidencePacketSection } from "./evidence-packets";

export function renderEvidencePacketJson(payload: EvidencePacketPayload): string {
  return JSON.stringify(payload, null, 2);
}

// HTML-escape a value for safe interpolation into element text/attributes.
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return escapeHtml(JSON.stringify(v));
  return escapeHtml(v);
}

function renderItemsTable(items: Array<Record<string, unknown>>): string {
  if (!items.length) return `<p class="muted">No items.</p>`;
  // Union of keys, stable by first appearance.
  const keys: string[] = [];
  for (const it of items) for (const k of Object.keys(it)) if (!keys.includes(k)) keys.push(k);
  const head = keys.map((k) => `<th>${escapeHtml(k)}</th>`).join("");
  const rows = items
    .map((it) => `<tr>${keys.map((k) => `<td>${renderValue(it[k])}</td>`).join("")}</tr>`)
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSection(s: EvidencePacketSection): string {
  const warnings = (s.warnings ?? []).map((w) => `<li class="warn">${escapeHtml(w.message)}</li>`).join("");
  const blockers = (s.blockers ?? []).map((b) => `<li class="block">${escapeHtml(b.message)}</li>`).join("");
  const notes = warnings || blockers ? `<ul class="notes">${blockers}${warnings}</ul>` : "";
  return `
    <section class="packet-section status-${escapeHtml(s.status)}">
      <h3>${escapeHtml(s.title)} <span class="badge">${escapeHtml(s.status)}</span></h3>
      ${notes}
      ${renderItemsTable(s.items)}
    </section>`;
}

export function renderEvidencePacketHtml(payload: EvidencePacketPayload): string {
  const { summary, company, generatedBy } = payload;
  const warningList = payload.warnings.map((w) => `<li>${escapeHtml(w.message)}</li>`).join("");
  const blockerList = payload.blockers.map((b) => `<li>${escapeHtml(b.message)}</li>`).join("");
  const sections = payload.sections.map(renderSection).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(payload.title)}</title>
<style>
  :root { --royal:#1B3A6B; --gray:#6B7280; --red:#B91C1C; --amber:#92400E; --grn:#166534; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color:#111827; margin:0; padding:2rem; max-width:1000px; }
  h1 { color:var(--royal); margin:0 0 .25rem; }
  h3 { color:var(--royal); margin:1.25rem 0 .5rem; display:flex; align-items:center; gap:.5rem; }
  .meta { color:var(--gray); font-size:.875rem; }
  .summary { display:flex; flex-wrap:wrap; gap:1rem; margin:1rem 0; }
  .summary div { background:#F3F4F6; border-radius:.5rem; padding:.5rem .75rem; font-size:.875rem; }
  .badge { font-size:.65rem; text-transform:uppercase; letter-spacing:.05em; background:#E5E7EB; color:#374151; border-radius:.25rem; padding:.1rem .4rem; }
  table { border-collapse:collapse; width:100%; font-size:.8rem; margin:.5rem 0; }
  th, td { border:1px solid #E5E7EB; padding:.35rem .5rem; text-align:left; vertical-align:top; }
  th { background:#F9FAFB; text-transform:uppercase; font-size:.65rem; letter-spacing:.04em; color:var(--gray); }
  .muted { color:var(--gray); font-size:.8rem; }
  ul.notes { margin:.25rem 0; padding-left:1.25rem; font-size:.8rem; }
  li.warn { color:var(--amber); } li.block { color:var(--red); }
  .status-blocked h3, .status-warning h3 { }
  .disclaimer { margin-top:2rem; padding-top:1rem; border-top:1px solid #E5E7EB; color:var(--gray); font-size:.75rem; }
</style>
</head>
<body>
  <h1>${escapeHtml(payload.title)}</h1>
  <p class="meta">
    ${escapeHtml(company.name)}${company.nmlsId ? ` · NMLS ${escapeHtml(company.nmlsId)}` : ""}${company.entityType ? ` · ${escapeHtml(company.entityType)}` : ""}<br/>
    Generated ${escapeHtml(payload.generatedAt)}${generatedBy?.name ? ` by ${escapeHtml(generatedBy.name)}` : ""} · Packet ${escapeHtml(payload.packetId)}
  </p>
  <div class="summary">
    <div><strong>Status:</strong> ${escapeHtml(summary.status)}</div>
    <div><strong>Items:</strong> ${summary.satisfiedItems}/${summary.totalItems} satisfied</div>
    <div><strong>Missing:</strong> ${summary.missingItems}</div>
    <div><strong>Warnings:</strong> ${summary.warningCount}</div>
    <div><strong>Blockers:</strong> ${summary.blockerCount}</div>
  </div>
  ${blockerList ? `<h3>Blockers</h3><ul class="notes">${blockerList}</ul>` : ""}
  ${warningList ? `<h3>Warnings</h3><ul class="notes">${warningList}</ul>` : ""}
  ${sections}
  <p class="disclaimer">
    This evidence packet assembles compliance records and filing evidence for examination preparation.
    It is not a direct SES submission and not an official NMLS filing. Document binaries are referenced by
    metadata and are not embedded. Integrity hash: ${escapeHtml(payload.hash || "n/a")}.
  </p>
</body>
</html>`;
}
