// ─────────────────────────────────────────────────────
// MortgageGuard — Compliance Engine Service
// The core of the platform: rule resolution, checklist
// generation, gate evaluation, and score calculation.
// ─────────────────────────────────────────────────────
import postgres from "postgres";
import type { Env, ComplianceEvent } from "../env";

// ─── Types ───
interface ResolvedRule {
  ruleId: string;
  stateCode: string;
  ruleName: string;
  ruleCategory: string;
}

interface ChecklistItem {
  requiredDocumentId: string;
  stateRuleId: string;
  documentType: string;
  displayName: string;
  isMandatory: boolean;
  weight: number;
  pipelineStage: string | null;
  source: "federal" | "state";
  stateCode: string;
}

interface GateResult {
  canAdvance: boolean;
  satisfiedCount: number;
  requiredCount: number;
  unsatisfied: { documentType: string; displayName: string }[];
}

interface ComplianceScore {
  score: number;
  totalWeight: number;
  satisfiedWeight: number;
  breakdown: {
    mandatory: { total: number; satisfied: number };
    stateSpecific: { total: number; satisfied: number };
    recommended: { total: number; satisfied: number };
  };
}

// ─── Cache Key Builders ───
const cacheKey = {
  stateRules: (state: string) => `rules:${state}`,
  checklist: (loanId: string) => `checklist:${loanId}`,
  score: (loanId: string) => `score:${loanId}`,
};

const CACHE_TTL_SECONDS = 900; // 15 minutes

// ─── State Rule Resolver ───
// Step 1: Given a state code, return all active rules for that state
export async function resolveStateRules(
  stateCode: string,
  env: Env
): Promise<ResolvedRule[]> {
  // Check KV cache first
  const cached = await env.RULE_CACHE.get(cacheKey.stateRules(stateCode), "json");
  if (cached) return cached as ResolvedRule[];

  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const rules = await sql`
    SELECT id as "ruleId", state_code as "stateCode", rule_name as "ruleName", rule_category as "ruleCategory"
    FROM state_rules
    WHERE state_code = ${stateCode}
      AND is_active = true
      AND effective_date <= CURRENT_DATE
    ORDER BY rule_category, rule_name
  `;

  // Cache for 15 minutes
  await env.RULE_CACHE.put(
    cacheKey.stateRules(stateCode),
    JSON.stringify(rules),
    { expirationTtl: CACHE_TTL_SECONDS }
  );

  return rules as unknown as ResolvedRule[];
}

// ─── Checklist Generator ───
// Step 2: Merge federal + state rules, filter by loan attributes, produce unified checklist
export async function generateChecklist(
  loanId: string,
  propertyState: string,
  loanType: string,
  loanPurpose: string,
  loanProduct: string,
  env: Env
): Promise<ChecklistItem[]> {
  // Check cache
  const cached = await env.RULE_CACHE.get(cacheKey.checklist(loanId), "json");
  if (cached) return cached as ChecklistItem[];

  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  // Single query: join state_rules + required_documents, filtered by loan attributes
  // Fetches BOTH federal (state_code = 'FED') and state-specific rules
  const items = await sql`
    SELECT
      rd.id as "requiredDocumentId",
      sr.id as "stateRuleId",
      rd.document_type as "documentType",
      rd.display_name as "displayName",
      rd.is_mandatory as "isMandatory",
      rd.weight,
      rd.pipeline_stage as "pipelineStage",
      sr.state_code as "stateCode",
      CASE WHEN sr.state_code = 'FED' THEN 'federal' ELSE 'state' END as "source"
    FROM required_documents rd
    JOIN state_rules sr ON sr.id = rd.state_rule_id
    WHERE sr.is_active = true
      AND sr.effective_date <= CURRENT_DATE
      AND sr.state_code IN (${propertyState}, 'FED')
      AND (rd.loan_type_filter IS NULL OR rd.loan_type_filter = ${loanType})
      AND (rd.loan_purpose_filter IS NULL OR rd.loan_purpose_filter = ${loanPurpose})
      AND (rd.loan_product_filter IS NULL OR rd.loan_product_filter = ${loanProduct})
    ORDER BY rd.weight DESC, rd.display_name
  `;

  // Deduplicate by document_type (federal and state may both require same doc)
  const seen = new Set<string>();
  const checklist: ChecklistItem[] = [];
  for (const item of items) {
    if (!seen.has(item.documentType)) {
      seen.add(item.documentType);
      checklist.push(item as ChecklistItem);
    }
  }

  // Cache the resolved checklist
  await env.RULE_CACHE.put(
    cacheKey.checklist(loanId),
    JSON.stringify(checklist),
    { expirationTtl: CACHE_TTL_SECONDS }
  );

  return checklist;
}

// ─── Gate Evaluator ───
// Step 3: Check if a loan can advance to the target stage
export async function evaluateGate(
  loanId: string,
  targetStage: string,
  env: Env
): Promise<GateResult> {
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  // Get required docs for the current stage gate
  const gateRequirements = await sql`
    SELECT
      rd.document_type as "documentType",
      rd.display_name as "displayName",
      rd.is_mandatory as "isMandatory"
    FROM compliance_checks cc
    JOIN required_documents rd ON rd.id = cc.required_document_id
    WHERE cc.loan_id = ${loanId}
      AND rd.pipeline_stage = ${targetStage}
      AND rd.is_mandatory = true
  `;

  // Get which docs are satisfied
  const satisfiedDocs = await sql`
    SELECT DISTINCT cc.required_document_id
    FROM compliance_checks cc
    WHERE cc.loan_id = ${loanId}
      AND cc.result = 'pass'
  `;

  const satisfiedSet = new Set(satisfiedDocs.map(d => d.required_document_id));
  const unsatisfied = gateRequirements.filter(r => !satisfiedSet.has(r.requiredDocumentId));

  return {
    canAdvance: unsatisfied.length === 0,
    satisfiedCount: gateRequirements.length - unsatisfied.length,
    requiredCount: gateRequirements.length,
    unsatisfied: unsatisfied.map(u => ({
      documentType: u.documentType,
      displayName: u.displayName,
    })),
  };
}

// ─── Score Calculator ───
// Step 4: Compute weighted compliance score
export async function calculateScore(
  loanId: string,
  env: Env
): Promise<ComplianceScore> {
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const results = await sql`
    SELECT
      cc.result,
      rd.weight,
      rd.is_mandatory as "isMandatory",
      CASE WHEN sr.state_code != 'FED' THEN true ELSE false END as "isStateSpecific"
    FROM compliance_checks cc
    JOIN required_documents rd ON rd.id = cc.required_document_id
    JOIN state_rules sr ON sr.id = cc.state_rule_id
    WHERE cc.loan_id = ${loanId}
  `;

  let totalWeight = 0;
  let satisfiedWeight = 0;
  const breakdown = {
    mandatory: { total: 0, satisfied: 0 },
    stateSpecific: { total: 0, satisfied: 0 },
    recommended: { total: 0, satisfied: 0 },
  };

  for (const check of results) {
    const w = Number(check.weight);
    totalWeight += w;

    const isSatisfied = check.result === "pass" || check.result === "na" || check.result === "waived";
    if (isSatisfied) satisfiedWeight += w;

    if (check.isMandatory) {
      breakdown.mandatory.total++;
      if (isSatisfied) breakdown.mandatory.satisfied++;
    } else if (check.isStateSpecific) {
      breakdown.stateSpecific.total++;
      if (isSatisfied) breakdown.stateSpecific.satisfied++;
    } else {
      breakdown.recommended.total++;
      if (isSatisfied) breakdown.recommended.satisfied++;
    }
  }

  const score = totalWeight > 0 ? Math.round((satisfiedWeight / totalWeight) * 100) : 0;

  // Update the loan record with current score
  await sql`
    UPDATE loans SET
      compliance_score = ${score},
      docs_complete = ${breakdown.mandatory.satisfied + breakdown.stateSpecific.satisfied + breakdown.recommended.satisfied},
      updated_at = NOW()
    WHERE id = ${loanId}
  `;

  // Cache score
  await env.RULE_CACHE.put(
    cacheKey.score(loanId),
    JSON.stringify({ score, totalWeight, satisfiedWeight, breakdown }),
    { expirationTtl: 300 } // 5 min cache for scores
  );

  return { score, totalWeight, satisfiedWeight, breakdown };
}

// ─── Initialize Compliance Checks ───
// Called when a loan is created: generates pending checks for all checklist items
export async function initializeComplianceChecks(
  loanId: string,
  propertyState: string,
  loanType: string,
  loanPurpose: string,
  loanProduct: string,
  env: Env
): Promise<number> {
  const checklist = await generateChecklist(loanId, propertyState, loanType, loanPurpose, loanProduct, env);
  const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  // Batch insert compliance checks
  if (checklist.length > 0) {
    for (const item of checklist) {
      await sql`
        INSERT INTO compliance_checks (loan_id, state_rule_id, required_document_id, check_type, result)
        VALUES (${loanId}, ${item.stateRuleId}, ${item.requiredDocumentId}, 'document_present', 'pending')
      `;
    }
  }

  // Update loan with total required docs
  await sql`
    UPDATE loans SET docs_required = ${checklist.length}, updated_at = NOW()
    WHERE id = ${loanId}
  `;

  return checklist.length;
}

// ─── Queue Consumer: Process Compliance Events ───
export async function processComplianceEvent(event: ComplianceEvent, env: Env): Promise<void> {
  switch (event.type) {
    case "loan.created": {
      const { propertyState, loanType, loanPurpose, loanProduct } = event.payload as any;
      await initializeComplianceChecks(event.loanId, propertyState, loanType, loanPurpose, loanProduct, env);
      break;
    }
    case "document.uploaded": {
      // Re-evaluate compliance checks for this loan
      const { documentType } = event.payload as any;
      const sql = postgres(env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

      // Mark matching compliance check as pass
      await sql`
        UPDATE compliance_checks SET result = 'pass', checked_at = NOW()
        WHERE loan_id = ${event.loanId}
          AND required_document_id IN (
            SELECT id FROM required_documents WHERE document_type = ${documentType}
          )
          AND result = 'pending'
      `;

      // Recalculate score
      await calculateScore(event.loanId, env);

      // Invalidate checklist cache
      await env.RULE_CACHE.delete(cacheKey.checklist(event.loanId));
      break;
    }
    case "score.recalculate": {
      await calculateScore(event.loanId, env);
      break;
    }
    case "integration.webhook": {
      // LOS webhook: log the event and recalculate if we have a valid loanId
      const { systemId } = event.payload as { systemId: string };
      console.log(`[INTEGRATION] Webhook from ${systemId} for loan ${event.loanId}`);
      if (event.loanId && event.loanId !== "unknown") {
        await calculateScore(event.loanId, env);
      }
      break;
    }
  }
}
