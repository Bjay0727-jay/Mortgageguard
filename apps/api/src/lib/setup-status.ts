// ─────────────────────────────────────────────────────────────
// MortgageGuard — Setup status engine (pure, testable)
//
// Given facts already gathered from the database, decide each setup step's
// completion, the overall progress, and the dashboard warnings. The route
// layer is responsible only for gathering inputs and emitting this shape.
// ─────────────────────────────────────────────────────────────

import type { RulesStatus } from "./rules-status";

export type StepStatus = "complete" | "incomplete" | "warning" | "blocked" | "optional";
export type WarningSeverity = "critical" | "warning" | "info";

export interface SetupStep {
  key: string;
  title: string;
  description: string;
  complete: boolean;
  required: boolean;
  status: StepStatus;
  actionLabel: string;
  actionHref: string;
  details?: Record<string, unknown>;
}

export interface SetupWarning {
  key: string;
  title: string;
  message: string;
  severity: WarningSeverity;
  actionLabel: string;
  actionHref: string;
}

export interface SetupStatus {
  companyId: string;
  setupComplete: boolean;
  coreSetupComplete: boolean;
  progress: { completed: number; total: number; percent: number };
  warnings: SetupWarning[];
  steps: SetupStep[];
}

export interface SetupInputs {
  companyId: string;
  user: { mustChangePassword: boolean; isSeededAdmin: boolean };
  company: {
    name?: string | null;
    nmlsId?: string | null;
    entityType?: string | null;
    primaryContact?: string | null;
    primaryEmail?: string | null;
    address?: string | null;
    licenseStates?: string[] | null;
    allowsRemoteWork?: boolean | null;
  };
  rules: RulesStatus;
  loanCount: number;
  programsAvailable: boolean;
  programs: {
    requiredTotal: number;
    requiredCurrent: number;
    requiredNeedsWork: number; // missing/incomplete/overdue/source_review_due among required+applicable
    overdue: number;
  };
  invites: { activeUsersCount: number; pendingInvitesCount: number; acceptedInvitesCount: number; expiredInvitesCount: number };
  los: { connectedLosCount: number; healthyLosCount: number };
}

const ENTITY_TYPES = ["broker", "lender", "servicer", "broker_lender", "banker"];

function companyProfileComplete(c: SetupInputs["company"]): boolean {
  return Boolean(
    c.name &&
    c.nmlsId &&
    c.entityType && ENTITY_TYPES.includes(c.entityType) &&
    c.primaryContact &&
    c.primaryEmail &&
    (c.licenseStates && c.licenseStates.length > 0) &&
    c.allowsRemoteWork !== null && c.allowsRemoteWork !== undefined,
  );
}

export function buildSetupStatus(input: SetupInputs): SetupStatus {
  const steps: SetupStep[] = [];

  // 1. Change default admin password.
  const pwComplete = !input.user.mustChangePassword;
  steps.push({
    key: "change_default_admin_password",
    title: "Change default admin password",
    description: "Protect the seeded administrator account before adding production data.",
    complete: pwComplete,
    required: true,
    status: pwComplete ? "complete" : "blocked",
    actionLabel: "Change Password",
    actionHref: "/change-password",
  });

  // 2. Confirm company profile.
  const profileComplete = companyProfileComplete(input.company);
  steps.push({
    key: "confirm_company_profile",
    title: "Confirm company profile",
    description: "Verify legal name, NMLS ID, entity type, compliance contact, licensed states, and remote-work setting.",
    complete: profileComplete,
    required: true,
    status: profileComplete ? "complete" : "incomplete",
    actionLabel: "Open Company Settings",
    actionHref: "/company-settings",
    details: {
      allowsRemoteWorkConfirmed: input.company.allowsRemoteWork !== null && input.company.allowsRemoteWork !== undefined,
      licenseStates: input.company.licenseStates ?? [],
    },
  });

  // 3. Load Texas compliance rules.
  steps.push({
    key: "load_texas_compliance_rules",
    title: "Load Texas compliance rules",
    description: "Rules power checklists, score calculations, and reporting deadlines.",
    complete: input.rules.loaded,
    required: true,
    status: input.rules.loaded ? "complete" : "warning",
    actionLabel: "Load Texas Rules",
    actionHref: "/setup?step=rules",
    details: {
      stateRulesCount: input.rules.stateRulesCount,
      requiredDocumentsCount: input.rules.requiredDocumentsCount,
      reportingDeadlinesCount: input.rules.reportingDeadlinesCount,
      reportingObligationsCount: input.rules.reportingObligationsCount,
      activeRulesCount: input.rules.activeRulesCount,
    },
  });

  // 4. Create first loan.
  const loanComplete = input.loanCount > 0;
  steps.push({
    key: "create_first_loan",
    title: "Create first loan",
    description: "Creating a loan generates the first compliance checklist and pipeline record.",
    complete: loanComplete,
    required: true,
    status: loanComplete ? "complete" : "incomplete",
    actionLabel: "Create First Loan",
    actionHref: "/loans/new",
    details: { loanCount: input.loanCount },
  });

  // 5. Upload required compliance program documents.
  const programsComplete = input.programsAvailable && input.programs.requiredTotal > 0 && input.programs.requiredNeedsWork === 0 && input.programs.overdue === 0;
  steps.push({
    key: "upload_required_compliance_program_documents",
    title: "Upload required compliance program documents",
    description: "Upload AML, Red Flags, information security, compensation, and (if applicable) remote-work policies with evidence.",
    complete: programsComplete,
    required: true,
    status: programsComplete ? "complete" : "incomplete",
    actionLabel: "Set Up Programs",
    actionHref: "/programs",
    details: { ...input.programs, programsAvailable: input.programsAvailable },
  });

  // 6. Invite team members.
  const inviteComplete = input.invites.activeUsersCount > 1 || input.invites.acceptedInvitesCount > 0;
  const invitePendingOnly = !inviteComplete && input.invites.pendingInvitesCount > 0;
  steps.push({
    key: "invite_team_members",
    title: "Invite team members",
    description: "Invite originators, processors, compliance staff, and read-only exam reviewers.",
    complete: inviteComplete,
    required: true,
    status: inviteComplete ? "complete" : invitePendingOnly ? "warning" : "incomplete",
    actionLabel: "Manage Invites",
    actionHref: "/users",
    details: { ...input.invites },
  });

  // 7. Connect LOS integration (optional).
  const losComplete = input.los.connectedLosCount > 0 || input.los.healthyLosCount > 0;
  steps.push({
    key: "connect_los_integration",
    title: "Connect LOS integration",
    description: "Connect your loan origination system to keep loan and document data in sync.",
    complete: losComplete,
    required: false,
    status: losComplete ? "complete" : "optional",
    actionLabel: "Connect LOS",
    actionHref: "/integrations",
    details: { connectedLosCount: input.los.connectedLosCount, healthyLosCount: input.los.healthyLosCount, required: false },
  });

  // Progress over required steps.
  const requiredSteps = steps.filter((s) => s.required);
  const completedRequired = requiredSteps.filter((s) => s.complete).length;
  const percent = requiredSteps.length ? Math.round((completedRequired / requiredSteps.length) * 100) : 100;

  const coreSetupComplete = requiredSteps.every((s) => s.complete);
  const setupComplete = steps.every((s) => s.complete);

  // Warnings.
  const warnings: SetupWarning[] = [];
  if (input.user.mustChangePassword && input.user.isSeededAdmin) {
    warnings.push({
      key: "default_admin_password",
      title: "Default admin account detected",
      message: "Change this password before using production data.",
      severity: "critical",
      actionLabel: "Change Password",
      actionHref: "/change-password",
    });
  }
  if (!input.rules.loaded) {
    warnings.push({
      key: "texas_rules_missing",
      title: "Texas compliance rules are not loaded yet",
      message: "Load or verify Texas rules so checklists, scores, and reporting deadlines can be generated accurately.",
      severity: "warning",
      actionLabel: "Load Texas Rules",
      actionHref: "/setup?step=rules",
    });
  }
  if (!profileComplete) {
    warnings.push({
      key: "company_profile_incomplete",
      title: "Company profile is incomplete",
      message: "Confirm your company profile, licensed states, and remote-work setting.",
      severity: "warning",
      actionLabel: "Open Company Settings",
      actionHref: "/company-settings",
    });
  }
  if (input.programsAvailable && (input.programs.requiredNeedsWork > 0 || input.programs.requiredTotal === 0)) {
    warnings.push({
      key: "programs_incomplete",
      title: "Required compliance programs need attention",
      message: "Upload program documents and evidence so your written programs are exam-ready.",
      severity: "warning",
      actionLabel: "Set Up Programs",
      actionHref: "/setup?step=programs",
    });
  }

  return {
    companyId: input.companyId,
    setupComplete,
    coreSetupComplete,
    progress: { completed: completedRequired, total: requiredSteps.length, percent },
    warnings,
    steps,
  };
}
