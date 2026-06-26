export interface DashboardSetupData {
  totalLoans: number;
  upcomingDeadlinesCount: number;
  programs: { status: string; count: number }[];
  user?: { name?: string; email?: string; mustChangePassword?: boolean } | null;
}

export interface SetupChecklistItem {
  id: string;
  icon: string;
  title: string;
  complete: boolean;
  explanation: string;
  cta: string;
  href: string;
}

export const PIPELINE_STAGES = ["application", "processing", "underwriting", "closing", "post_close"] as const;

export const REQUIRED_PROGRAM_SETUP = [
  "AML Program",
  "Red Flags Program",
  "Information Security Program",
  "Loan Originator and Lender Compensation Agreements",
  "Remote Work Policy",
] as const;

// Program statuses that mean a required control still needs work.
const PROGRAM_NEEDS_WORK = ["missing", "incomplete", "overdue", "source_review_due", "review_due"];

function programCount(programs: DashboardSetupData["programs"], statuses: string[]): number {
  return programs.filter((p) => statuses.includes(p.status)).reduce((sum, p) => sum + p.count, 0);
}

export function isDefaultAdmin(user?: DashboardSetupData["user"]): boolean {
  const name = user?.name?.toLowerCase() || "";
  const email = user?.email?.toLowerCase() || "";
  return Boolean(user?.mustChangePassword || name === "administrator" || email.includes("admin@"));
}

// Program setup is "done" only when at least one program is current and no
// required program is still missing/incomplete/overdue or has a source review
// due — i.e. the source-backed integrity checks are acceptable.
export function hasProgramSetup(programs: DashboardSetupData["programs"]): boolean {
  const current = programCount(programs, ["current"]);
  const needsWork = programCount(programs, PROGRAM_NEEDS_WORK);
  return current > 0 && needsWork === 0;
}

export function buildSetupChecklist(data: DashboardSetupData): SetupChecklistItem[] {
  return [
    {
      id: "password",
      icon: "🔐",
      title: "Change default admin password",
      complete: !isDefaultAdmin(data.user),
      explanation: "Protect the seeded administrator account before adding production loan data.",
      cta: "Change Password",
      href: "/change-password",
    },
    {
      id: "company",
      icon: "🏢",
      title: "Confirm company profile",
      complete: false,
      explanation: "Verify legal name, NMLS ID, licensed states, and exam contacts.",
      cta: "Open Company Settings",
      href: "/company-settings",
    },
    {
      id: "rules",
      icon: "📚",
      title: "Load Texas compliance rules",
      complete: false,
      explanation: "Rules power checklists, score calculations, and exam-readiness reports.",
      cta: "View Setup Instructions",
      href: "/company-settings?tab=rules",
    },
    {
      id: "loan",
      icon: "🏠",
      title: "Create first loan",
      complete: data.totalLoans > 0,
      explanation: "Creating a loan generates the first compliance checklist and pipeline record.",
      cta: "Create First Loan",
      href: "/loans",
    },
    {
      id: "programs",
      icon: "✅",
      title: "Upload required compliance program documents",
      complete: hasProgramSetup(data.programs),
      explanation: "Upload AML, Red Flags, information security, compensation, and remote work policies.",
      cta: "Set Up Programs",
      href: "/programs",
    },
    {
      id: "invites",
      icon: "👥",
      title: "Invite team members",
      complete: false,
      explanation: "Invite originators, processors, compliance staff, and read-only exam reviewers.",
      cta: "Manage Invites",
      href: "/users",
    },
    {
      id: "integrations",
      icon: "🔌",
      title: "Connect LOS integration",
      complete: false,
      explanation: "Connect your loan origination system to keep loan and document data in sync.",
      cta: "Connect LOS",
      href: "/integrations",
    },
  ];
}

// ─── Backend setup status (GET /api/v1/setup/status) ───
export interface BackendSetupWarning {
  key: string;
  title: string;
  message: string;
  severity: "critical" | "warning" | "info";
  actionLabel: string;
  actionHref: string;
}
export interface BackendSetupStep {
  key: string;
  title: string;
  description: string;
  complete: boolean;
  required: boolean;
  status: "complete" | "incomplete" | "warning" | "blocked" | "optional";
  actionLabel: string;
  actionHref: string;
  details?: Record<string, unknown>;
}
export interface BackendSetupStatus {
  companyId: string;
  setupComplete: boolean;
  coreSetupComplete: boolean;
  progress: { completed: number; total: number; percent: number };
  warnings: BackendSetupWarning[];
  steps: BackendSetupStep[];
}

const STEP_ICONS: Record<string, string> = {
  change_default_admin_password: "🔐",
  confirm_company_profile: "🏢",
  load_texas_compliance_rules: "📚",
  create_first_loan: "🏠",
  upload_required_compliance_program_documents: "✅",
  invite_team_members: "👥",
  connect_los_integration: "🔌",
};

// Map backend steps to the checklist item shape the dashboard panel renders.
export function setupStepsToChecklist(steps: BackendSetupStep[]): SetupChecklistItem[] {
  return steps.map((s) => ({
    id: s.key,
    icon: STEP_ICONS[s.key] || "•",
    title: s.title,
    complete: s.complete,
    explanation: s.description,
    cta: s.actionLabel,
    href: s.actionHref,
  }));
}

export function getSetupProgress(items: SetupChecklistItem[]) {
  const complete = items.filter((item) => item.complete).length;
  return {
    complete,
    total: items.length,
    percent: items.length ? Math.round((complete / items.length) * 100) : 0,
  };
}

// ─── Dashboard filters ───
export interface DashboardFilters {
  state?: string;
  status?: string;
  from?: string;
  to?: string;
}

// Build a stable, encoded query string from the active filters. Empty/unset
// filters are omitted so an unfiltered request stays exactly `""`.
export function buildDashboardQuery(filters: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters.state) params.set("state", filters.state);
  if (filters.status) params.set("status", filters.status);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ─── Top actions (data-driven action center) ───
export interface TopActionsInput {
  attentionLoans: { id: string; docs_required?: number; docs_complete?: number }[];
  programs: { status: string; count: number }[];
  upcomingDeadlines: unknown[];
  passingLoans: number;
  loanOps?: { overdueTasks?: number; upcomingClosings?: number; txLogIssues?: number };
  reportOps?: { overdueDeadlines?: number; dueSoonDeadlines?: number; missingReceipts?: number; transactionLogGaps?: number };
}

export interface TopAction {
  id: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  count: number;
  priority: "High" | "Medium" | "Low";
}

// Derive the operational "Top actions" from live dashboard data. Counts drive
// ordering/emphasis in the UI; items with a count of 0 are shown muted.
export function deriveTopActions(data: TopActionsInput): TopAction[] {
  const missingDocs = data.attentionLoans.filter(
    (loan) => (loan.docs_required ?? 0) > (loan.docs_complete ?? 0),
  );
  const overduePrograms = data.programs
    .filter((program) => ["overdue", "review_due"].includes(program.status))
    .reduce((sum, program) => sum + program.count, 0);
  const incompletePrograms = data.programs
    .filter((program) => ["missing", "incomplete"].includes(program.status))
    .reduce((sum, program) => sum + program.count, 0);
  const sourceReviewDue = data.programs
    .filter((program) => program.status === "source_review_due")
    .reduce((sum, program) => sum + program.count, 0);

  return [
    {
      id: "upload-docs",
      title: "Upload missing documents",
      description: "Resolve required documents on loans below passing score.",
      href: missingDocs.length === 1 ? `/loans/${missingDocs[0].id}?tab=checklist` : "/loans?score=critical",
      cta: "Upload Documents",
      count: missingDocs.length,
      priority: "High",
    },
    {
      id: "overdue-programs",
      title: "Review overdue programs",
      description: "Renew compliance programs that are past their review date.",
      href: "/programs",
      cta: "Review Programs",
      count: overduePrograms,
      priority: "High",
    },
    {
      id: "file-reports",
      title: "File upcoming reports",
      description: "Submit quarterly and state filings before their due dates.",
      href: "/reports",
      cta: "File Reports",
      count: data.upcomingDeadlines.length,
      priority: "Medium",
    },
    {
      id: "advance-loans",
      title: "Advance ready loans",
      description: "Move passing loans to their next pipeline stage.",
      href: "/loans?score=passing",
      cta: "Review Loans",
      count: data.passingLoans,
      priority: "Medium",
    },
    {
      id: "complete-programs",
      title: "Complete required program setup",
      description: "Upload program documents and evidence for missing or incomplete controls.",
      href: "/programs",
      cta: "Open Programs",
      count: incompletePrograms,
      priority: "High",
    },
    {
      id: "verify-sources",
      title: "Verify regulatory sources",
      description: "Re-verify the authoritative sources backing your compliance programs.",
      href: "/programs",
      cta: "Verify Sources",
      count: sourceReviewDue,
      priority: "Medium",
    },
    {
      id: "loan-tasks",
      title: "Resolve overdue loan tasks",
      description: "Clear processing tasks that are past their due date.",
      href: "/loans",
      cta: "Review Loans",
      count: data.loanOps?.overdueTasks ?? 0,
      priority: "High",
    },
    {
      id: "tx-log",
      title: "Fix transaction-log gaps",
      description: "Complete missing or overdue transaction-log fields on open loans.",
      href: "/loans",
      cta: "Open Loans",
      count: data.loanOps?.txLogIssues ?? 0,
      priority: "Medium",
    },
    {
      id: "upcoming-closings",
      title: "Prepare upcoming closings",
      description: "Loans closing within 14 days — clear closing conditions.",
      href: "/loans",
      cta: "Review Closings",
      count: data.loanOps?.upcomingClosings ?? 0,
      priority: "Medium",
    },
    {
      id: "file-overdue-reports",
      title: "File overdue reports",
      description: "Reporting deadlines that are past due and not yet filed.",
      href: "/reports",
      cta: "File Reports",
      count: data.reportOps?.overdueDeadlines ?? 0,
      priority: "High",
    },
    {
      id: "file-upcoming-reports",
      title: "File upcoming reports",
      description: "Reporting deadlines due within 30 days — record the filing.",
      href: "/reports",
      cta: "Review Deadlines",
      count: data.reportOps?.dueSoonDeadlines ?? 0,
      priority: "Medium",
    },
    {
      id: "upload-receipts",
      title: "Upload filing receipts",
      description: "Filed reports that are missing a confirmation receipt.",
      href: "/reports",
      cta: "Upload Receipt",
      count: data.reportOps?.missingReceipts ?? 0,
      priority: "Medium",
    },
    {
      id: "report-tx-log",
      title: "Fix transaction-log gaps",
      description: "Loans with missing or overdue transaction-log fields before export.",
      href: "/reports",
      cta: "Open Reports",
      count: data.reportOps?.transactionLogGaps ?? 0,
      priority: "Medium",
    },
  ];
}

export function hasActionableWork(data: TopActionsInput): boolean {
  return deriveTopActions(data).some((action) => action.count > 0);
}
