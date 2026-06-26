// ─────────────────────────────────────────────────────
// MortgageGuard — Loan Routes
// CRUD, pipeline management, compliance gate evaluation
// ─────────────────────────────────────────────────────
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import postgres from "postgres";
import type { Env } from "../env";
import { evaluateGate, calculateScore, generateChecklist } from "../services/compliance-engine";
import { requireCapability } from "../middleware/auth";
import { hasCapability } from "@mortgageguard/shared";
import { deriveConditionalDocuments } from "../lib/loan-conditional-docs";
import { deriveTransactionLogCompleteness } from "../lib/transaction-log-integrity";
import { deriveLoanIntegrity } from "../lib/loan-integrity";
import {
  LOAN_STAGES,
  type LoanStage,
  type StageReadiness,
  buildStageReadiness,
  resolveAdvanceDecision,
} from "../lib/stage-gate";

export const loanRoutes = new Hono<{ Bindings: Env }>();

// ─── Validation Schemas ───
const LOAN_PURPOSES = ["purchase", "refinance", "construction", "home_equity", "home_equity_50a6", "home_improvement", "land_lot", "wrap_mortgage", "reverse_mortgage", "reverse"] as const;
const LOAN_PRODUCTS = ["conventional", "fha", "va", "usda", "reverse", "non_qm", "other"] as const;
const LOAN_TYPES = ["fixed", "arm", "balloon", "interest_only", "other"] as const;
const TEXAS_CASHOUT = ["none", "tx_50a6", "tx_50f2"] as const;

const createLoanSchema = z.object({
  loanNumber: z.string().min(1).max(50),
  borrowerLastName: z.string().min(1).max(100),
  borrowerFirstName: z.string().min(1).max(100),
  coBorrowerName: z.string().max(255).optional(),
  applicantEmail: z.string().email().max(255).optional().or(z.literal("")),
  applicantPhone: z.string().max(40).optional(),
  applicationMethod: z.string().max(40).optional(),
  applicationDate: z.string().optional(),
  propertyAddress: z.string().min(1),
  propertyCity: z.string().min(1),
  propertyState: z.string().length(2),
  propertyZip: z.string().min(5).max(10),
  propertyCounty: z.string().max(100).optional(),
  interestRate: z.number().min(0).max(30).optional(),
  loanPurpose: z.enum(LOAN_PURPOSES),
  texasCashoutType: z.enum(TEXAS_CASHOUT).optional(),
  loanProduct: z.enum(LOAN_PRODUCTS),
  loanType: z.enum(LOAN_TYPES),
  loanTerm: z.number().int().positive().optional(),
  loanAmount: z.number().positive().optional(),
  purchasePrice: z.number().positive().optional(),
  estimatedClosingDate: z.string().optional(),
  lienPosition: z.enum(["first", "second", "wrap"]),
  occupancyType: z.enum(["primary", "secondary", "investment"]),
  loanOriginatorName: z.string().max(255).optional(),
  loanOriginatorNmlsId: z.string().max(20).optional(),
  lenderName: z.string().optional(),
  lenderNmlsId: z.string().optional(),
  processorUserId: z.string().uuid().optional(),
  complianceOwnerUserId: z.string().uuid().optional(),
});

// Attributes whose change re-resolves the applicable compliance rules.
const RULE_AFFECTING_FIELDS = ["propertyState", "loanPurpose", "texasCashoutType", "loanProduct", "loanType", "lienPosition", "occupancyType"] as const;

const updateLoanSchema = createLoanSchema.partial();

const advanceStageSchema = z.object({
  targetStage: z.enum(LOAN_STAGES),
  override: z.boolean().optional().default(false),
  reason: z.string().trim().min(1).max(1000).optional(),
});

// Single readiness model shared by gate preview and stage advance, so the two
// can never disagree on `canAdvance`. Combines stage-transition validity with
// the compliance gate (which itself only counts current valid documents).
async function evaluateStageAdvanceReadiness(params: {
  loanId: string;
  currentStage: string;
  targetStage: string;
  env: Env;
}): Promise<StageReadiness> {
  const gate = await evaluateGate(params.loanId, params.targetStage, params.env);
  return buildStageReadiness({ currentStage: params.currentStage, targetStage: params.targetStage, gate });
}

// Build the enriched checklist (rules-derived + conditional docs) with upload
// status merged in. Shared by the checklist endpoint, task generation, and
// integrity so they never disagree.
async function buildEnrichedChecklist(sql: any, env: Env, loan: any) {
  const rulesChecklist = await generateChecklist(loan.id, loan.property_state, loan.loan_type, loan.loan_purpose, loan.loan_product, env);
  const [company] = await sql`SELECT entity_type FROM companies WHERE id = ${loan.company_id}`;
  const conditional = deriveConditionalDocuments({
    propertyState: loan.property_state,
    loanPurpose: loan.loan_purpose,
    loanProduct: loan.loan_product,
    loanType: loan.loan_type,
    lienPosition: loan.lien_position,
    texasCashoutType: loan.texas_cashout_type,
    companyEntityType: company?.entity_type,
  });
  const present = new Set(rulesChecklist.map((i) => i.documentType));
  const merged = [
    ...rulesChecklist.map((i) => ({ ...i, conditional: false })),
    ...conditional.filter((d) => !present.has(d.documentType)).map((d) => ({
      requiredDocumentId: null, stateRuleId: null, documentType: d.documentType, displayName: d.displayName,
      isMandatory: true, weight: 2, pipelineStage: d.pipelineStage, source: d.source, stateCode: d.stateCode, conditional: true,
    })),
  ];

  const uploadedDocs = await sql`
    SELECT DISTINCT ON (document_type)
      id, document_type, file_name, file_size, mime_type, uploaded_by, status, is_signed, uploaded_at
    FROM loan_documents WHERE loan_id = ${loan.id}
    ORDER BY document_type, uploaded_at DESC`;
  const uploadedSet = new Map<string, any>(uploadedDocs.map((d: any) => [d.document_type, d]));

  return merged.map((item: any) => {
    const u = uploadedSet.get(item.documentType);
    return {
      ...item,
      uploaded: Boolean(u),
      documentId: u?.id || null,
      fileName: u?.file_name || null,
      fileSize: u?.file_size || null,
      mimeType: u?.mime_type || null,
      uploadedAt: u?.uploaded_at || null,
      uploadedBy: u?.uploaded_by || null,
      status: u?.status || null,
      uploadStatus: u?.status || null,
      isSigned: u?.is_signed || false,
    };
  });
}

// Has the loan's state got active rules loaded? Used by integrity/tasks.
async function rulesLoadedForState(sql: any, state: string): Promise<boolean> {
  const [row] = await sql`SELECT COUNT(*)::int AS n FROM state_rules WHERE state_code = ${state} AND is_active = true`;
  return Number(row?.n ?? 0) > 0;
}

const VALID_DOC = ["uploaded", "signed", "delivered"];

// Idempotently sync auto-generated tasks (missing docs, rules-not-loaded,
// transaction-log gaps). Unique (loan_id, auto_key) prevents duplicates;
// resolved items auto-complete.
async function syncAutoTasks(sql: any, loan: any, env: Env, actorUserId: string | null) {
  const checklist = await buildEnrichedChecklist(sql, env, loan);
  const missing = checklist.filter((i: any) => i.isMandatory && !(i.uploaded && VALID_DOC.includes(i.status)));
  const txLog = deriveTransactionLogCompleteness(loan);
  const rulesLoaded = await rulesLoadedForState(sql, loan.property_state);

  const desired: Array<{ autoKey: string; title: string; taskType: string; priority: string }> = [];
  for (const m of missing) desired.push({ autoKey: `missing_document:${m.documentType}`, title: `Upload ${m.displayName}`, taskType: "missing_document", priority: "high" });
  if (!rulesLoaded) desired.push({ autoKey: "rules_not_loaded", title: `Load compliance rules for ${loan.property_state}`, taskType: "compliance_review", priority: "high" });
  if (txLog.missingFields.length > 0) desired.push({ autoKey: "txlog_missing_fields", title: `Complete transaction log (${txLog.missingFields.length} field(s))`, taskType: "compliance_review", priority: "high" });

  const desiredKeys = new Set(desired.map((d) => d.autoKey));
  for (const d of desired) {
    await sql`
      INSERT INTO loan_tasks (company_id, loan_id, title, task_type, status, priority, auto_key, created_by)
      VALUES (${loan.company_id}, ${loan.id}, ${d.title}, ${d.taskType}, 'open', ${d.priority}, ${d.autoKey}, ${actorUserId})
      ON CONFLICT (loan_id, auto_key) WHERE auto_key IS NOT NULL DO NOTHING`;
  }
  // Auto-complete previously-generated tasks that no longer apply.
  const openAuto = await sql`SELECT id, auto_key FROM loan_tasks WHERE loan_id = ${loan.id} AND auto_key IS NOT NULL AND status NOT IN ('complete','canceled')`;
  for (const t of openAuto) {
    if (!desiredKeys.has(t.auto_key)) {
      await sql`UPDATE loan_tasks SET status = 'complete', completed_at = NOW(), updated_at = NOW() WHERE id = ${t.id}`;
    }
  }
  return checklist;
}

// ─── GET /api/v1/loans — List loans for company ───
loanRoutes.get("/", async (c) => {
  const user = c.get("user");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const status = c.req.query("status");
  const state = c.req.query("state");
  const search = c.req.query("search");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const loans = await sql`
    SELECT l.*, u.name as originator_name
    FROM loans l
    LEFT JOIN users u ON u.id = l.originator_id
    WHERE l.company_id = ${user.companyId}
      AND l.is_deleted = false
      ${status ? sql`AND l.status = ${status}` : sql``}
      ${state ? sql`AND l.property_state = ${state.toUpperCase()}` : sql``}
      ${search ? sql`AND (
        l.loan_number ILIKE ${'%' + search + '%'}
        OR l.borrower_last_name ILIKE ${'%' + search + '%'}
        OR l.borrower_first_name ILIKE ${'%' + search + '%'}
        OR l.property_address ILIKE ${'%' + search + '%'}
      )` : sql``}
    ORDER BY l.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countResult = await sql`
    SELECT COUNT(*) as total FROM loans
    WHERE company_id = ${user.companyId} AND is_deleted = false
      ${status ? sql`AND status = ${status}` : sql``}
      ${state ? sql`AND property_state = ${state.toUpperCase()}` : sql``}
      ${search ? sql`AND (
        loan_number ILIKE ${'%' + search + '%'}
        OR borrower_last_name ILIKE ${'%' + search + '%'}
        OR borrower_first_name ILIKE ${'%' + search + '%'}
        OR property_address ILIKE ${'%' + search + '%'}
      )` : sql``}
  `;

  return c.json({
    loans,
    pagination: { total: Number(countResult[0].total), limit, offset },
  });
});

// ─── POST /api/v1/loans — Create a new loan ───
loanRoutes.post("/", requireCapability("createLoan"), zValidator("json", createLoanSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const appDate = body.applicationDate || null;
  // Insert the loan with full transaction-log + portal fields.
  const [loan] = await sql`
    INSERT INTO loans (
      company_id, originator_id, loan_number,
      borrower_last_name, borrower_first_name, co_borrower_name,
      applicant_email, applicant_phone, application_method,
      property_address, property_city, property_state, property_zip, property_county,
      interest_rate, loan_purpose, texas_cashout_type, loan_product, loan_type,
      loan_term, loan_amount, purchase_price, estimated_closing_date, lien_position, occupancy_type,
      loan_originator_name, originator_nmls_id, lender_name, lender_nmls_id,
      processor_user_id, compliance_owner_user_id,
      application_date, status, is_deleted,
      transaction_log_entered_at, transaction_log_due_at
    ) VALUES (
      ${user.companyId}, ${user.userId}, ${body.loanNumber},
      ${body.borrowerLastName}, ${body.borrowerFirstName}, ${body.coBorrowerName || null},
      ${body.applicantEmail || null}, ${body.applicantPhone || null}, ${body.applicationMethod || null},
      ${body.propertyAddress}, ${body.propertyCity}, ${body.propertyState}, ${body.propertyZip}, ${body.propertyCounty || null},
      ${body.interestRate ?? null}, ${body.loanPurpose}, ${body.texasCashoutType || "none"}, ${body.loanProduct}, ${body.loanType},
      ${body.loanTerm ?? null}, ${body.loanAmount ?? null}, ${body.purchasePrice ?? null}, ${body.estimatedClosingDate || null}, ${body.lienPosition}, ${body.occupancyType},
      ${body.loanOriginatorName || null}, ${body.loanOriginatorNmlsId || user.nmlsId || null}, ${body.lenderName || null}, ${body.lenderNmlsId || null},
      ${body.processorUserId || null}, ${body.complianceOwnerUserId || null},
      ${appDate ? appDate : sql`CURRENT_DATE`}, 'application', false,
      NOW(), ${appDate ? sql`${appDate}::date + INTERVAL '7 days'` : sql`CURRENT_DATE + INTERVAL '7 days'`}
    )
    RETURNING *
  `;

  // Persist a transaction-log status snapshot for dashboards/top-actions.
  const txLog = deriveTransactionLogCompleteness(loan as any);
  await sql`UPDATE loans SET transaction_log_status = ${txLog.status} WHERE id = ${loan.id}`;
  (loan as any).transaction_log_status = txLog.status;

  // Emit compliance event to generate checklist asynchronously
  await c.env.COMPLIANCE_QUEUE.send({
    type: "loan.created",
    loanId: loan.id,
    companyId: user.companyId,
    payload: {
      propertyState: body.propertyState,
      loanType: body.loanType,
      loanPurpose: body.loanPurpose,
      loanProduct: body.loanProduct,
    },
    timestamp: new Date().toISOString(),
  });

  // Emit audit event
  await c.env.AUDIT_QUEUE.send({
    type: "loan.created",
    entityType: "loan",
    entityId: loan.id,
    companyId: user.companyId,
    userId: user.userId,
    action: "create",
    details: { loanNumber: body.loanNumber, state: body.propertyState },
    ipAddress: c.req.header("cf-connecting-ip") || "unknown",
    timestamp: new Date().toISOString(),
  });

  // Record in loan timeline
  await sql`
    INSERT INTO loan_timeline (loan_id, event_type, stage_to, description, performed_by)
    VALUES (${loan.id}, 'loan_created', 'application', 'Loan application created', ${user.userId})
  `;

  return c.json({ loan }, 201);
});

// ─── GET /api/v1/loans/new/context — Wizard context ───
loanRoutes.get("/new/context", requireCapability("viewLoans"), async (c) => {
  const user = c.get("user");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [company] = await sql`SELECT entity_type, license_states FROM companies WHERE id = ${user.companyId}`;
  const licensedStates: string[] = company?.license_states ?? [];
  const users = await sql`SELECT id, name, role FROM users WHERE company_id = ${user.companyId} AND is_active = true ORDER BY name`;

  // Rule-load status per licensed state (does the state have active rules?).
  const ruleLoadStatus: Record<string, boolean> = {};
  const warnings: string[] = [];
  for (const st of licensedStates.length ? licensedStates : ["TX"]) {
    const loaded = await rulesLoadedForState(sql, st);
    ruleLoadStatus[st] = loaded;
    if (!loaded) warnings.push(`Compliance rules are not loaded for ${st}.`);
  }

  return c.json({
    licensedStates: licensedStates.length ? licensedStates : ["TX"],
    companyEntityType: company?.entity_type ?? null,
    loanPurposes: LOAN_PURPOSES,
    loanProducts: LOAN_PRODUCTS,
    loanTypes: LOAN_TYPES,
    texasCashoutTypes: TEXAS_CASHOUT,
    lienPositions: ["first", "second", "wrap"],
    occupancyTypes: ["primary", "secondary", "investment"],
    assignableUsers: users,
    ruleLoadStatus,
    warnings,
  });
});

// ─── GET /api/v1/loans/:id — Get loan detail ───
loanRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const [loan] = await sql`
    SELECT l.*, u.name as originator_name
    FROM loans l
    LEFT JOIN users u ON u.id = l.originator_id
    WHERE l.id = ${loanId} AND l.company_id = ${user.companyId} AND l.is_deleted = false
  `;

  if (!loan) return c.json({ error: "Loan not found" }, 404);

  return c.json({ loan });
});

// ─── GET /api/v1/loans/:id/checklist — Get compliance checklist ───
loanRoutes.get("/:id/checklist", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const [loan] = await sql`
    SELECT * FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}
  `;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  const enriched = await buildEnrichedChecklist(sql, c.env, loan);
  return c.json({ checklist: enriched, total: enriched.length, complete: enriched.filter((i: any) => i.uploaded).length });
});

// ─── GET /api/v1/loans/:id/score — Get compliance score ───
loanRoutes.get("/:id/score", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");

  // Check cache first
  const cached = await c.env.RULE_CACHE.get(`score:${loanId}`, "json");
  if (cached) return c.json(cached);

  const score = await calculateScore(loanId, c.env);
  return c.json(score);
});

// ─── GET /api/v1/loans/:id/gate/:targetStage — Preview stage gate ───
// Capability policy: gate preview drives the advancement modal, so it requires
// the same capability as advancing (advanceLoanStage). This is intentional —
// not an accidental "any authenticated user" endpoint.
loanRoutes.get("/:id/gate/:targetStage", requireCapability("advanceLoanStage"), async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const targetStage = c.req.param("targetStage") as LoanStage;
  if (!(LOAN_STAGES as readonly string[]).includes(targetStage)) {
    return c.json({ error: "Invalid target stage" }, 400);
  }

  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`
    SELECT * FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}
  `;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  // Same decision model the POST /advance endpoint uses.
  const readiness = await evaluateStageAdvanceReadiness({
    loanId,
    currentStage: loan.status,
    targetStage,
    env: c.env,
  });
  return c.json(readiness);
});

// ─── POST /api/v1/loans/:id/advance — Advance pipeline stage ───
loanRoutes.post("/:id/advance", requireCapability("advanceLoanStage"), zValidator("json", advanceStageSchema), async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const { targetStage, override, reason } = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const [loan] = await sql`
    SELECT * FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}
  `;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  // Identical readiness model to the gate preview endpoint.
  const readiness = await evaluateStageAdvanceReadiness({
    loanId,
    currentStage: loan.status,
    targetStage,
    env: c.env,
  });

  const decision = resolveAdvanceDecision({
    readiness,
    override: Boolean(override),
    hasOverrideCapability: hasCapability(user.role, "overrideCompliance"),
    reason,
  });

  if (decision.action === "reject") {
    // Invalid transition / terminal: return allowed targets, no gate (not overrideable).
    if (decision.code === "INVALID_TRANSITION" || decision.code === "LOAN_TERMINAL") {
      return c.json({
        error: decision.error,
        currentStage: readiness.currentStage,
        targetStage: readiness.targetStage,
        allowedTargets: readiness.allowedTargets,
      }, decision.status as 400);
    }
    // Unsatisfied gate (or failed override): return the full readiness so the UI
    // can render blockers, warnings, and unsatisfied documents clearly.
    return c.json({
      error: decision.error,
      code: decision.code,
      gate: readiness,
    }, decision.status as 400);
  }

  // ── Advance ──
  const previousStage = loan.status;
  const isOverride = decision.isOverride;
  const auditMeta = {
    override: isOverride,
    reason: decision.auditMeta?.reason ?? null,
    blockers: decision.auditMeta?.blockers ?? [],
    warnings: readiness.warnings,
    unsatisfied: decision.auditMeta?.unsatisfied ?? [],
    satisfiedCount: readiness.satisfiedCount,
    requiredCount: readiness.requiredCount,
  };

  await sql`
    UPDATE loans SET status = ${targetStage}, updated_at = NOW()
    WHERE id = ${loanId}
  `;

  await sql`
    INSERT INTO loan_timeline (loan_id, event_type, stage_from, stage_to, description, metadata, performed_by)
    VALUES (${loanId}, ${isOverride ? 'stage_override' : 'stage_advanced'}, ${previousStage}, ${targetStage}, ${isOverride ? 'Override advanced from ' + previousStage + ' to ' + targetStage : 'Advanced from ' + previousStage + ' to ' + targetStage}, ${JSON.stringify(auditMeta)}, ${user.userId})
  `;

  await c.env.AUDIT_QUEUE.send({
    type: isOverride ? "stage.override" : "stage.changed",
    entityType: "loan",
    entityId: loanId,
    companyId: user.companyId,
    userId: user.userId,
    action: isOverride ? "override_stage_gate" : "advance_stage",
    details: { from: previousStage, to: targetStage, ...auditMeta },
    ipAddress: c.req.header("cf-connecting-ip") || "unknown",
    timestamp: new Date().toISOString(),
  });

  return c.json({ success: true, previousStage, newStage: targetStage, gate: readiness, override: isOverride });
});

// ─── GET /api/v1/loans/:id/timeline — Get loan event history ───
loanRoutes.get("/:id/timeline", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  // Verify loan belongs to user's company
  const [loan] = await sql`SELECT id FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId}`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  const events = await sql`
    SELECT lt.*, u.name as performed_by_name
    FROM loan_timeline lt
    LEFT JOIN users u ON u.id = lt.performed_by
    WHERE lt.loan_id = ${loanId}
    ORDER BY lt.occurred_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const [{ total }] = await sql`SELECT COUNT(*) as total FROM loan_timeline WHERE loan_id = ${loanId}`;

  return c.json({ events, pagination: { total: Number(total), limit, offset } });
});

// ─── PATCH /api/v1/loans/:id — Update a loan (re-resolves rules) ───
loanRoutes.patch("/:id", requireCapability("updateLoan"), zValidator("json", updateLoanSchema), async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const body = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });

  const [existing] = await sql`SELECT * FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId} AND is_deleted = false`;
  if (!existing) return c.json({ error: "Loan not found" }, 404);

  const COL: Record<string, string> = {
    propertyState: "property_state", loanPurpose: "loan_purpose", texasCashoutType: "texas_cashout_type",
    loanProduct: "loan_product", loanType: "loan_type", lienPosition: "lien_position", occupancyType: "occupancy_type",
  };
  const ruleChanges = (RULE_AFFECTING_FIELDS as readonly string[]).filter(
    (f) => body[f as keyof typeof body] !== undefined && String(body[f as keyof typeof body]) !== String(existing[COL[f]]),
  );

  const [updated] = await sql`
    UPDATE loans SET
      loan_number = COALESCE(${body.loanNumber ?? null}, loan_number),
      borrower_first_name = COALESCE(${body.borrowerFirstName ?? null}, borrower_first_name),
      borrower_last_name = COALESCE(${body.borrowerLastName ?? null}, borrower_last_name),
      co_borrower_name = COALESCE(${body.coBorrowerName ?? null}, co_borrower_name),
      applicant_email = COALESCE(${body.applicantEmail ?? null}, applicant_email),
      applicant_phone = COALESCE(${body.applicantPhone ?? null}, applicant_phone),
      property_address = COALESCE(${body.propertyAddress ?? null}, property_address),
      property_city = COALESCE(${body.propertyCity ?? null}, property_city),
      property_state = COALESCE(${body.propertyState ?? null}, property_state),
      property_zip = COALESCE(${body.propertyZip ?? null}, property_zip),
      property_county = COALESCE(${body.propertyCounty ?? null}, property_county),
      interest_rate = COALESCE(${body.interestRate ?? null}, interest_rate),
      loan_purpose = COALESCE(${body.loanPurpose ?? null}, loan_purpose),
      texas_cashout_type = COALESCE(${body.texasCashoutType ?? null}, texas_cashout_type),
      loan_product = COALESCE(${body.loanProduct ?? null}, loan_product),
      loan_type = COALESCE(${body.loanType ?? null}, loan_type),
      loan_term = COALESCE(${body.loanTerm ?? null}, loan_term),
      loan_amount = COALESCE(${body.loanAmount ?? null}, loan_amount),
      purchase_price = COALESCE(${body.purchasePrice ?? null}, purchase_price),
      estimated_closing_date = COALESCE(${body.estimatedClosingDate ?? null}, estimated_closing_date),
      lien_position = COALESCE(${body.lienPosition ?? null}, lien_position),
      occupancy_type = COALESCE(${body.occupancyType ?? null}, occupancy_type),
      loan_originator_name = COALESCE(${body.loanOriginatorName ?? null}, loan_originator_name),
      lender_name = COALESCE(${body.lenderName ?? null}, lender_name),
      lender_nmls_id = COALESCE(${body.lenderNmlsId ?? null}, lender_nmls_id),
      processor_user_id = COALESCE(${body.processorUserId ?? null}, processor_user_id),
      compliance_owner_user_id = COALESCE(${body.complianceOwnerUserId ?? null}, compliance_owner_user_id),
      updated_at = NOW()
    WHERE id = ${loanId} RETURNING *`;

  // Refresh transaction-log status snapshot.
  const txLog = deriveTransactionLogCompleteness(updated as any);
  await sql`UPDATE loans SET transaction_log_status = ${txLog.status} WHERE id = ${loanId}`;

  let checklistChanged = 0;
  if (ruleChanges.length > 0) {
    // Re-resolve rules: invalidate caches, reconcile compliance_checks, recalc.
    await c.env.RULE_CACHE.delete(`checklist:${loanId}`);
    await c.env.RULE_CACHE.delete(`score:${loanId}`);
    const newChecklist = await generateChecklist(loanId, updated.property_state, updated.loan_type, updated.loan_purpose, updated.loan_product, c.env);
    const newIds = new Set(newChecklist.map((i) => i.requiredDocumentId));
    const existingChecks = await sql`SELECT id, required_document_id, result FROM compliance_checks WHERE loan_id = ${loanId}`;
    const existingIds = new Set(existingChecks.map((r: any) => r.required_document_id));

    // No-longer-applicable → na (uploaded documents are preserved untouched).
    for (const ch of existingChecks) {
      if (!newIds.has(ch.required_document_id) && ch.result !== "na") {
        await sql`UPDATE compliance_checks SET result = 'na', checked_at = NOW() WHERE id = ${ch.id}`;
        checklistChanged++;
      } else if (newIds.has(ch.required_document_id) && ch.result === "na") {
        // Became applicable again.
        await sql`UPDATE compliance_checks SET result = 'pending', checked_at = NOW() WHERE id = ${ch.id}`;
        checklistChanged++;
      }
    }
    // Newly required checks.
    for (const item of newChecklist) {
      if (!existingIds.has(item.requiredDocumentId)) {
        await sql`INSERT INTO compliance_checks (loan_id, state_rule_id, required_document_id, check_type, result) VALUES (${loanId}, ${item.stateRuleId}, ${item.requiredDocumentId}, 'document_present', 'pending')`;
        checklistChanged++;
      }
    }
    await sql`UPDATE loans SET docs_required = ${newChecklist.length}, updated_at = NOW() WHERE id = ${loanId}`;
    await calculateScore(loanId, c.env);

    await c.env.AUDIT_QUEUE.send({ type: "loan.rules_resolved", entityType: "loan", entityId: loanId, companyId: user.companyId, userId: user.userId, action: "rules_resolved", details: { changedFields: ruleChanges, generatedChecklistCount: newChecklist.length, checklistChanged }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });
    await sql`INSERT INTO loan_timeline (loan_id, event_type, description, metadata, performed_by) VALUES (${loanId}, 'checklist_changed', 'Checklist re-resolved after loan update', ${JSON.stringify({ changedFields: ruleChanges, checklistChanged })}, ${user.userId})`;
  }

  // Refresh auto-tasks after the change.
  await syncAutoTasks(sql, updated, c.env, user.userId);

  await c.env.AUDIT_QUEUE.send({ type: "loan.updated", entityType: "loan", entityId: loanId, companyId: user.companyId, userId: user.userId, action: "update", details: { fields: Object.keys(body), ruleChanges }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });
  await sql`INSERT INTO loan_timeline (loan_id, event_type, description, metadata, performed_by) VALUES (${loanId}, 'loan_updated', 'Loan updated', ${JSON.stringify({ fields: Object.keys(body) })}, ${user.userId})`;

  return c.json({ loan: updated, changed: Object.keys(body), ruleChanges, checklistChanged });
});

// ─── GET /api/v1/loans/:id/integrity — Loan integrity rollup ───
loanRoutes.get("/:id/integrity", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`SELECT * FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId} AND is_deleted = false`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);

  const checklist = await buildEnrichedChecklist(sql, c.env, loan);
  const tasks = await sql`SELECT status, due_at FROM loan_tasks WHERE loan_id = ${loanId}`;
  const txLog = deriveTransactionLogCompleteness(loan as any);
  const rulesLoaded = await rulesLoadedForState(sql, loan.property_state);
  const integrity = deriveLoanIntegrity({
    loan: { id: loan.id, status: loan.status, compliance_score: loan.compliance_score, closing_date: loan.closing_date, property_state: loan.property_state },
    checklist: checklist as any,
    tasks: tasks as any,
    txLog,
    rulesLoaded,
  });
  return c.json({ integrity, transactionLog: txLog });
});

// ─── Loan tasks ───
loanRoutes.get("/:id/tasks", async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`SELECT * FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId} AND is_deleted = false`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);
  await syncAutoTasks(sql, loan, c.env, user.userId);
  const tasks = await sql`
    SELECT t.*, a.name as assigned_to_name FROM loan_tasks t
    LEFT JOIN users a ON a.id = t.assigned_to
    WHERE t.loan_id = ${loanId} ORDER BY (t.status = 'complete'), t.created_at DESC`;
  return c.json({ tasks });
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  taskType: z.enum(["missing_document", "compliance_review", "borrower_follow_up", "lender_follow_up", "disclosure_delivery", "closing_condition", "post_close_review", "custom"]).default("custom"),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  assignedTo: z.string().uuid().optional(),
  dueAt: z.string().optional(),
});
loanRoutes.post("/:id/tasks", requireCapability("manageLoanTasks"), zValidator("json", createTaskSchema), async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const body = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [loan] = await sql`SELECT id FROM loans WHERE id = ${loanId} AND company_id = ${user.companyId} AND is_deleted = false`;
  if (!loan) return c.json({ error: "Loan not found" }, 404);
  const [task] = await sql`
    INSERT INTO loan_tasks (company_id, loan_id, title, description, task_type, priority, assigned_to, due_at, created_by)
    VALUES (${user.companyId}, ${loanId}, ${body.title}, ${body.description || null}, ${body.taskType}, ${body.priority}, ${body.assignedTo || null}, ${body.dueAt || null}, ${user.userId})
    RETURNING *`;
  await c.env.AUDIT_QUEUE.send({ type: "loan.task_created", entityType: "loan", entityId: loanId, companyId: user.companyId, userId: user.userId, action: "create_task", details: { taskId: task.id, taskType: body.taskType }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });
  return c.json({ task }, 201);
});

const updateTaskSchema = z.object({
  status: z.enum(["open", "in_progress", "blocked", "complete", "canceled"]).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
  dueAt: z.string().nullable().optional(),
});
loanRoutes.patch("/:id/tasks/:taskId", requireCapability("manageLoanTasks"), zValidator("json", updateTaskSchema), async (c) => {
  const user = c.get("user");
  const loanId = c.req.param("id");
  const taskId = c.req.param("taskId");
  const body = c.req.valid("json");
  const sql = postgres(c.env.HYPERDRIVE.connectionString, { max: 5, fetch_types: false });
  const [existing] = await sql`SELECT id, status FROM loan_tasks WHERE id = ${taskId} AND loan_id = ${loanId} AND company_id = ${user.companyId}`;
  if (!existing) return c.json({ error: "Task not found" }, 404);

  const completing = body.status === "complete" && existing.status !== "complete";
  const [task] = await sql`
    UPDATE loan_tasks SET
      status = COALESCE(${body.status ?? null}, status),
      priority = COALESCE(${body.priority ?? null}, priority),
      assigned_to = ${body.assignedTo === undefined ? sql`assigned_to` : body.assignedTo},
      title = COALESCE(${body.title ?? null}, title),
      description = COALESCE(${body.description ?? null}, description),
      due_at = ${body.dueAt === undefined ? sql`due_at` : body.dueAt},
      completed_at = ${completing ? sql`NOW()` : sql`completed_at`},
      completed_by = ${completing ? user.userId : sql`completed_by`},
      updated_at = NOW()
    WHERE id = ${taskId} RETURNING *`;
  await c.env.AUDIT_QUEUE.send({ type: completing ? "loan.task_completed" : "loan.task_updated", entityType: "loan", entityId: loanId, companyId: user.companyId, userId: user.userId, action: completing ? "complete_task" : "update_task", details: { taskId, fields: Object.keys(body) }, ipAddress: c.req.header("cf-connecting-ip") || "unknown", timestamp: new Date().toISOString() });
  return c.json({ task });
});
