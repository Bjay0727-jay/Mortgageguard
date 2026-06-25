// ─────────────────────────────────────────────────────
// MortgageGuard — Supported integration systems + connection test simulation
// ─────────────────────────────────────────────────────

export type CredentialField = "clientId" | "clientSecret" | "apiKey" | "instanceUrl";

export interface SupportedSystem {
  id: string;
  name: string;
  vendor: string;
  type: string;
  syncDirection: string;
  features: string[];
  // Credentials required to connect this system (drives wizard + test validation).
  requiredCredentials: CredentialField[];
  supportsWebhook: boolean;
}

export const SUPPORTED_SYSTEMS: SupportedSystem[] = [
  { id: "encompass", name: "Encompass", vendor: "ICE Mortgage Technology", type: "LOS", syncDirection: "bi-directional", features: ["Loan data sync", "Document push/pull", "Milestone updates", "Compliance triggers", "Disclosure tracking"], requiredCredentials: ["clientId", "clientSecret", "instanceUrl"], supportsWebhook: true },
  { id: "calyx", name: "Calyx Point", vendor: "Calyx Technology", type: "LOS", syncDirection: "bi-directional", features: ["Loan file import", "Document sync", "Pipeline status", "Fee worksheets", "1003 form data"], requiredCredentials: ["apiKey", "instanceUrl"], supportsWebhook: true },
  { id: "lendingpad", name: "LendingPad", vendor: "LendingPad Corp", type: "LOS", syncDirection: "bi-directional", features: ["Real-time loan sync", "Task assignments", "Condition tracking", "Lender submission", "eSign status"], requiredCredentials: ["clientId", "clientSecret"], supportsWebhook: true },
  { id: "bytepro", name: "Byte Pro", vendor: "Byte Software", type: "LOS", syncDirection: "bi-directional", features: ["Workflow automation", "Credit decisioning", "Doc management"], requiredCredentials: ["apiKey", "instanceUrl"], supportsWebhook: false },
  { id: "floify", name: "Floify", vendor: "Floify LLC", type: "POS", syncDirection: "inbound", features: ["Borrower portal", "Document intake", "eConsent", "Status updates"], requiredCredentials: ["apiKey"], supportsWebhook: true },
  { id: "blend", name: "Blend", vendor: "Blend Labs", type: "POS", syncDirection: "inbound", features: ["Digital application", "Income verification", "Asset verification"], requiredCredentials: ["clientId", "clientSecret"], supportsWebhook: true },
  { id: "arive", name: "ARIVE", vendor: "ARIVE Inc", type: "LOS", syncDirection: "bi-directional", features: ["Pricing engine", "Wholesale connectivity", "Loan origination"], requiredCredentials: ["apiKey"], supportsWebhook: false },
  { id: "docmagic", name: "DocMagic", vendor: "DocMagic Inc", type: "DOC", syncDirection: "outbound", features: ["State disclosure gen", "eSign/eNotary", "TRID compliance", "Doc audit trail"], requiredCredentials: ["clientId", "clientSecret", "instanceUrl"], supportsWebhook: false },
  { id: "meridianlink", name: "MeridianLink / CBC", vendor: "MeridianLink", type: "CREDIT", syncDirection: "inbound", features: ["Tri-merge credit", "AUS integration", "VOE/VOI", "Flood cert", "OFAC screening"], requiredCredentials: ["apiKey", "instanceUrl"], supportsWebhook: false },
];

export function getSystem(systemId: string): SupportedSystem | undefined {
  return SUPPORTED_SYSTEMS.find((s) => s.id === systemId);
}

export interface IntegrationConfigInput {
  clientId?: string;
  clientSecret?: string;
  apiKey?: string;
  instanceUrl?: string;
}

export interface TestResult {
  success: boolean;
  message: string;
  missing?: CredentialField[];
}

const URL_RE = /^https?:\/\/.+/i;

// Validate the config shape for a system and simulate a connection test.
// Pure — no network — so it is deterministic and unit-testable. A real
// implementation would call the vendor's auth endpoint here.
export function simulateConnectionTest(systemId: string, config: IntegrationConfigInput): TestResult {
  const system = getSystem(systemId);
  if (!system) return { success: false, message: "Unsupported system" };

  const missing = system.requiredCredentials.filter((field) => {
    const value = (config as Record<string, unknown>)[field];
    return typeof value !== "string" || value.trim() === "";
  });
  if (missing.length) {
    return { success: false, message: `Missing required credentials: ${missing.join(", ")}`, missing };
  }

  if (system.requiredCredentials.includes("instanceUrl") && config.instanceUrl && !URL_RE.test(config.instanceUrl)) {
    return { success: false, message: "instanceUrl must be a valid http(s) URL", missing: ["instanceUrl"] };
  }

  return { success: true, message: `Connection to ${system.name} verified.` };
}
