/** Scenario-level evidence only: this does not grant permission to execute for a resource. */
export function projectScenarioFacts(requiredFacts: readonly string[], rows: ReadonlyArray<{ value: Record<string, unknown>; createdAt: Date }>, freshAfter: Date) {
  const required = new Set(requiredFacts);
  const relevant = rows.filter((row) => typeof row.value.factKey === 'string' && required.has(row.value.factKey));
  const availableFacts = [...new Set(relevant.filter((row) => row.createdAt >= freshAfter).map((row) => row.value.factKey as string))];
  return {
    availableFacts,
    staleFactCount: relevant.filter((row) => row.createdAt < freshAfter).length,
    hasDecidedTruth: relevant.length > 0,
  };
}
