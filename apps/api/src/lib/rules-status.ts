// Texas compliance rules status — derived from DB counts. Pure + testable.
//
// Counts track federal+state combined totals (for display) AND the
// state-specific subset, because federal seed rows alone must NOT mark a state
// as "loaded": a DB with only the FED rows, or a partial load that stopped
// after federal data, still needs its state-specific rules/documents.

export interface RulesStatusCounts {
  state: string;
  // Combined state + federal counts.
  stateRulesCount: number;
  requiredDocumentsCount: number;
  reportingDeadlinesCount: number;
  activeRulesCount: number;
  // State-specific (e.g. TX-only) subset.
  stateSpecificActiveRulesCount: number;
  stateSpecificRequiredDocumentsCount: number;
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
  if (counts.stateSpecificActiveRulesCount === 0) blockers.push(`No active ${counts.state}-specific rules are loaded.`);
  if (counts.stateSpecificRequiredDocumentsCount === 0) blockers.push(`No ${counts.state}-specific required documents are loaded.`);
  if (counts.reportingDeadlinesCount === 0) warnings.push("No reporting deadlines are configured yet.");

  const loaded =
    counts.activeRulesCount > 0 &&
    counts.requiredDocumentsCount > 0 &&
    counts.stateSpecificActiveRulesCount > 0 &&
    counts.stateSpecificRequiredDocumentsCount > 0;

  return {
    ...counts,
    lastLoadedAt: counts.lastLoadedAt ?? null,
    loaded,
    blockers,
    warnings,
  };
}
