// Texas compliance rules status — derived from DB counts. Pure + testable.

export interface RulesStatusCounts {
  state: string;
  stateRulesCount: number;
  requiredDocumentsCount: number;
  reportingDeadlinesCount: number;
  activeRulesCount: number;
  lastLoadedAt?: string | null;
}

export interface RulesStatus extends RulesStatusCounts {
  loaded: boolean;
  blockers: string[];
  warnings: string[];
}

export function computeRulesStatus(counts: RulesStatusCounts): RulesStatus {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (counts.stateRulesCount === 0) blockers.push(`No ${counts.state} or federal compliance rules are loaded.`);
  if (counts.activeRulesCount === 0) blockers.push("No active rules are present.");
  if (counts.requiredDocumentsCount === 0) blockers.push("No required documents are linked to rules.");
  if (counts.reportingDeadlinesCount === 0) warnings.push("No reporting deadlines are configured yet.");

  const loaded = counts.stateRulesCount > 0 && counts.activeRulesCount > 0 && counts.requiredDocumentsCount > 0;

  return {
    ...counts,
    lastLoadedAt: counts.lastLoadedAt ?? null,
    loaded,
    blockers,
    warnings,
  };
}
