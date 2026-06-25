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
