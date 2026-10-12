import { catalogHash, reportMethodOutputSchema, reportMethodRunSchema, reportMethodSources, resolveReportMethodInputs,
  type ReportComposition, type ReportMethod, type ReportMethodRun, type ReportSource, type ReportMethodValues } from '@lazy-armor/plan-schema';

export function reportMethodInputHash(composition: ReportComposition, method: ReportMethod, inputs: ReportMethodValues, previous: ReportMethodRun[], sources: ReportSource[]) {
  const dependencies = composition.snapshot.selection.graph.links.filter(link => link.toMethodId === method.ref.entryId).map(link => link.fromMethodId);
  return catalogHash({ selectionHash: composition.snapshot.selectionHash, methodRef: method.ref, inputs, sourceHash: catalogHash(sources),
    dependencies: previous.filter(run => dependencies.includes(run.methodRef.entryId)).map(run => ({ methodRef: run.methodRef, outputHash: run.outputHash })) });
}
export function checkedReportMethodRun(composition: ReportComposition, method: ReportMethod, previous: ReportMethodRun[], sources: ReportSource[], raw: unknown, modelId: string): ReportMethodRun {
  const inputs = resolveReportMethodInputs(composition, method, previous), scoped = reportMethodSources(composition, method, previous, sources);
  const parsed = reportMethodOutputSchema(composition, method, scoped).safeParse(raw);
  if (!parsed.success) throw new Error('REPORT_METHOD_OUTPUT_INVALID');
  const outputs = parsed.data.outputs as ReportMethodValues, sourceIds = parsed.data.sourceIds;
  return reportMethodRunSchema.parse({ methodRef: method.ref, inputs, outputs, sourceIds, modelId, checkedAt: new Date().toISOString(),
    sourceHash: catalogHash(scoped), inputHash: reportMethodInputHash(composition, method, inputs, previous, scoped),
    outputHash: catalogHash({ outputs, sourceIds }), verification: 'CONTRACT_CHECKED_ONLY', provenance: 'MODEL_GENERATED_UNVERIFIED', semanticVerified: false });
}
/** Revalidate all saved ancestors before a resumed node or final writing consumes them. */
export function assertReportMethodPrefix(composition: ReportComposition, runs: ReportMethodRun[], sources: ReportSource[], complete = false) {
  if (runs.length > composition.methods.length || complete && runs.length !== composition.methods.length) throw new Error('REPORT_METHOD_STATE_INVALID');
  if (composition.methods.some(method => catalogHash(method.manifest) !== method.ref.contentHash)) throw new Error('REPORT_METHOD_STATE_INVALID');
  const previous: ReportMethodRun[] = [];
  try {
    for (const [index, run] of runs.entries()) {
      const method = composition.methods[index];
      const checked = checkedReportMethodRun(composition, method, previous, sources, { outputs: run.outputs, sourceIds: run.sourceIds }, run.modelId);
      if (catalogHash(run.methodRef) !== catalogHash(method.ref) || catalogHash(run.inputs) !== catalogHash(checked.inputs) ||
        run.inputHash !== checked.inputHash || run.sourceHash !== checked.sourceHash || run.outputHash !== checked.outputHash) throw new Error('REPORT_METHOD_STATE_INVALID');
      previous.push(run);
    }
  } catch { throw new Error('REPORT_METHOD_STATE_INVALID'); }
}
