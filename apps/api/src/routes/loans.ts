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
import {
  LOAN_STAGES,
  type LoanStage,
  type StageReadiness,
  buildStageReadiness,
  resolveAdvanceDecision,
} from "../lib/stage-gate";

export const loanRoutes = new Hono<{ Bindings: Env }>();

// ─── Validation Schemas ───
const createLoanSchema = z.object({
  loanNumber: z.string().min(1).max(50),
  borrowerLastName: z.string().min(1).max(100),
  borrowerFirstName: z.string().min(1).max(100),
  propertyAddress: z.string().min(1),
  propertyCity: z.string().min(1),
  propertyState: z.string().length(2),
  propertyZip: z.string().min(5).max(10),
  interestRate: z.number().min(0).max(30).optional(),
  loanPurpose: z.enum(["purchase", "refinance", "construction", "home_equity", "home_equity_50a6", "home_improvement", "land_lot", "wrap_mortgage", "reverse_mortgage"]),
  loanProduct: z.enum(["conventional", "fha", "va", "usda", "reverse", "other"]),
  loanType: z.enum(["fixed", "arm", "balloon", "interest_only", "other"]),
  loanTerm: z.number().int().positive().optional(),
  loanAmount: z.number().positive().optional(),
  lienPosition: z.enum(["first", "second", "wrap"]),
  occupancyType: z.enum(["primary", "secondary", "investment"]),
  lenderName: z.string().optional(),
  lenderNmlsId: z.string().optional(),
});

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

  // Insert the loan
  const [loan] = await sql`
    INSERT INTO loans (
      company_id, originator_id, loan_number,
      borrower_last_name, borrower_first_name,
      property_address, property_city, property_state, property_zip,
      interest_rate, loan_purpose, loan_product, loan_type,
      loan_term, loan_amount, lien_position, occupancy_type,
      lender_name, lender_nmls_id,
      originator_nmls_id, application_date, status, is_deleted
    ) VALUES (
      ${user.companyId}, ${user.userId}, ${body.loanNumber},
      ${body.borrowerLastName}, ${body.borrowerFirstName},
      ${body.propertyAddress}, ${body.propertyCity}, ${body.propertyState}, ${body.propertyZip},
      ${body.interestRate || null}, ${body.loanPurpose}, ${body.loanProduct}, ${body.loanType},
      ${body.loanTerm || null}, ${body.loanAmount || null}, ${body.lienPosition}, ${body.occupancyType},
      ${body.lenderName || null}, ${body.lenderNmlsId || null},
      ${user.nmlsId}, CURRENT_DATE, 'application', false
    )
    RETURNING *
  `;

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

  const checklist = await generateChecklist(
    loanId, loan.property_state, loan.loan_type, loan.loan_purpose, loan.loan_product, c.env
  );

  // Get latest uploaded document metadata for each checklist document type.
  const uploadedDocs = await sql`
    SELECT DISTINCT ON (document_type)
      id, document_type, file_name, file_size, mime_type, uploaded_by, status, is_signed, uploaded_at
    FROM loan_documents
    WHERE loan_id = ${loanId}
    ORDER BY document_type, uploaded_at DESC
  `;
  const uploadedSet = new Map(uploadedDocs.map(d => [d.document_type, d]));

  // Merge checklist with upload status and metadata needed by the UI.
  const enriched = checklist.map(item => {
    const uploadedDoc = uploadedSet.get(item.documentType);
    return {
      ...item,
      uploaded: Boolean(uploadedDoc),
      documentId: uploadedDoc?.id || null,
      fileName: uploadedDoc?.file_name || null,
      fileSize: uploadedDoc?.file_size || null,
      mimeType: uploadedDoc?.mime_type || null,
      uploadedAt: uploadedDoc?.uploaded_at || null,
      uploadedBy: uploadedDoc?.uploaded_by || null,
      status: uploadedDoc?.status || null,
      uploadStatus: uploadedDoc?.status || null,
      isSigned: uploadedDoc?.is_signed || false,
    };
  });

  return c.json({ checklist: enriched, total: checklist.length, complete: enriched.filter(i => i.uploaded).length });
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
