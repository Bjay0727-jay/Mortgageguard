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
  "LO Compensation Agreements",
  "Remote Work Policy",
] as const;

export function isDefaultAdmin(user?: DashboardSetupData["user"]): boolean {
  const name = user?.name?.toLowerCase() || "";
  const email = user?.email?.toLowerCase() || "";
  return Boolean(user?.mustChangePassword || name === "administrator" || email.includes("admin@"));
}

export function hasProgramSetup(programs: DashboardSetupData["programs"]): boolean {
  return programs.some((program) => ["current", "overdue", "draft"].includes(program.status) && program.count > 0);
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
    .filter((program) => program.status === "overdue")
    .reduce((sum, program) => sum + program.count, 0);

  return [
    {
      id: "upload-docs",
      title: "Upload missing documents",
      description: "Resolve required documents on loans below passing score.",
      href: missingDocs.length === 1 ? `/loans/${missingDocs[0].id}` : "/loans?score=critical",
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
  ];
}

export function hasActionableWork(data: TopActionsInput): boolean {
  return deriveTopActions(data).some((action) => action.count > 0);
}
