import { ConflictException } from '@nestjs/common';
import { catalogHash, compileScenarioPlan, compileSkillResourceGraph, compositionRuntimeCompilationSchema, definitionHash,
  normalizePlanDefinition, skillCapabilitySchema, type CompositionAuthoringSnapshot, type GoalBrief, type MethodResourceMatch,
  type PlanDefinitionInput, type SkillCapability, type SkillMethodRef, type SkillResourceGraphRequest } from '@lazy-armor/plan-schema';
import { newId } from '@lazy-armor/shared';
import type { PlannerResult } from '../ai-adapter/agent-planner.service';

const ports = (fields: Record<string, 'string' | 'boolean'>) => ({ type: 'object', additionalProperties: false,
  properties: Object.fromEntries(Object.entries(fields).map(([key, type]) => [key, { type }])), required: Object.keys(fields) });
// Fixed server implementations. Imported instructions never become executable tool bindings.
const official = [
  skillCapabilitySchema.parse({ name: 'ArmorInternalTaskSummary', version: '1.0.0', domain: 'daily_life', description: '汇总本账号已收录的 App 内重要事项',
    input: ports({}), output: ports({ humanSummary: 'string' }), requiredCapabilities: [], permission: ['READ'], risk: 'R1', verification: ['STRUCTURED_EVIDENCE'],
    instruction: '仅由平台 daily_life.errands.summary 的 summarize 步骤读取本账号 internal_task 候选，最多五项，未来24小时；不读邮箱、外部日历、手机通知或网页，不将候选视为已核实事实。' }),
  skillCapabilitySchema.parse({ name: 'ArmorInAppSummaryNotification', version: '1.0.0', domain: 'daily_life', description: '用本次摘要发送站内提醒，空摘要保持不提醒',
    input: ports({ humanSummary: 'string' }), output: ports({ notified: 'boolean' }), requiredCapabilities: [], permission: ['NOTIFY'], risk: 'R1', verification: ['STRUCTURED_EVIDENCE'],
    instruction: '仅由同一平台 Recipe 的 notify 步骤使用上一步保存的 humanSummary。遵守原 shouldNotify、站内去重与通知政策，不发送外部消息。' }),
] as const;
export function dailySummaryCompositionCatalog() {
  return { adapter: 'INTERNAL_DAILY_SUMMARY_V1', executionAuthorized: false, exampleGoal: '每天北京时间09:00汇总App内重要事项并发送站内提醒',
    limitations: ['仅 App 内已收录的 internal_task 候选，未来24小时最多五项', '固定北京时间09:00，原 Plan 审阅、启动与执行门保留', '结构化记录不证明候选事实已核实'],
    entries: official.map(manifest => ({ manifest: structuredClone(manifest), contentHash: catalogHash(manifest) })) };
}
type Method = { ref: SkillMethodRef; manifest: SkillCapability };
/** Match the entire supported goal/manifest/mapping, never just a name or self-declared capability. */
function match(request: SkillResourceGraphRequest, methods: readonly Method[], goal: GoalBrief | null) {
  if (!goal || goal.readiness.state !== 'READY_FOR_PROPOSAL' || methods.length !== 2
    || !/^每天(?:北京时间)?(?:上午)?(?:0?9:00|0?9点|九点)汇总(?:App|APP|应用)内重要事项并(?:发送)?站内提醒[。！!]?$/u.test(goal.statement.replace(/\s/g, '')))
    return null;
  const ordered = official.map(manifest => methods.find(method => method.ref.contentHash === catalogHash(manifest) && catalogHash(method.manifest) === catalogHash(manifest)));
  if (ordered.some(method => !method) || ordered[0]!.ref.entryId === ordered[1]!.ref.entryId || request.goalBindings.length || request.links.length !== 1) return null;
  const [summary, notification] = ordered as [Method, Method], link = request.links[0];
  if (link.fromMethodId !== summary.ref.entryId || link.toMethodId !== notification.ref.entryId || link.outputField !== 'humanSummary' || link.inputField !== 'humanSummary'
    || !request.deliveries.some(item => item.methodId === notification.ref.entryId && item.outputField === 'notified')
    || request.deliveries.some(item => !(item.methodId === summary.ref.entryId && item.outputField === 'humanSummary') && !(item.methodId === notification.ref.entryId && item.outputField === 'notified'))) return null;
  return [summary, notification] as const;
}
export function compileCompositionGraph(request: SkillResourceGraphRequest, methods: readonly Method[], goal: GoalBrief | null, resources: MethodResourceMatch) {
  const graph = compileSkillResourceGraph(request, methods, goal, resources), matched = match(request, methods, goal);
  if (!matched) return graph;
  // This exception is computed by the server from its complete fixed recipe, not supplied in a client DTO.
  const issues = graph.issues.filter(issue => !(issue.code === 'SIDE_EFFECT_RECIPE_REQUIRED' && issue.methodId === matched[1].ref.entryId));
  return { ...graph, issues, state: issues.length ? 'BLOCKED' as const : 'STRUCTURE_VALID' as const };
}
export function isDailySummaryComposition(request: SkillResourceGraphRequest, methods: readonly Method[], goal: GoalBrief | null) { return Boolean(match(request, methods, goal)); }
function compile(snapshot: CompositionAuthoringSnapshot) {
  const methods = snapshot.selection.basis.methodRefs.map(ref => ({ ref, manifest: official.find(manifest => catalogHash(manifest) === ref.contentHash)! }));
  if (methods.some(method => !method.manifest)) return null;
  const matched = match(snapshot.selection.graph, methods, snapshot.sourceGoal);
  if (!matched) return null;
  if (snapshot.selectionHash !== catalogHash(snapshot.selection) || snapshot.selection.basis.goalBriefRef.contentHash !== catalogHash(snapshot.sourceGoal)
    || catalogHash(snapshot.orderedMethodIds) !== catalogHash(matched.map(method => method.ref.entryId)) || snapshot.riskFloor !== 'R1'
    || snapshot.selection.resourceSelections?.length || snapshot.reportReadBindings?.length) throw new ConflictException('COMPOSITION_RUNTIME_CONTEXT_INVALID');
  const canonical = compileScenarioPlan({ scenarioKey: 'daily_life.errands', scenarioRevision: 2, strategy: 'PERIODIC_SUMMARY', mode: 'DRAFT' });
  const input: PlanDefinitionInput = { ...canonical.definitionInput, name: '每天汇总 App 内重要事项',
    description: '每天北京时间09:00汇总本账号App内已收录的重要事项候选，未来24小时最多五项，按原通知政策发送站内提醒。候选不表示已核实事实；不读取外部账号。',
    sources: [{ sourceType: 'internal', config: { resource: 'important_item_candidates', includedSources: ['internal_task'],
      includeCalendar: false, includeMessages: false, lookAheadHours: 24, maxItems: 5 }, sortOrder: 0 }] };
  const definition = normalizePlanDefinition(input);
  const basis = { schemaVersion: 'composition-runtime.v1', state: 'COMPILED_DRAFT', executionAuthorized: false,
    adapter: 'INTERNAL_DAILY_SUMMARY_V1', recipeKey: 'daily_life.errands.summary', recipeRevision: 2,
    selectionHash: snapshot.selectionHash, goalHash: catalogHash(snapshot.sourceGoal), definitionHash: definitionHash(definition),
    methods: matched.map((method, stepOrder) => ({ ref: method.ref, stepOrder,
      inputs: stepOrder ? [{ field: 'humanSummary', fromStepOrder: 0, outputField: 'humanSummary' }] : [], outputs: [stepOrder ? 'notified' : 'humanSummary'] })),
    sourceScope: 'OWNER_INTERNAL_TASK_CANDIDATES', schedule: '09:00 Asia/Shanghai', verification: 'ORIGINAL_EXECUTION_RECORDS' };
  return { definition, proof: compositionRuntimeCompilationSchema.parse({ ...basis, compilationHash: catalogHash(basis) }) };
}
export function compiledCompositionProposal(snapshot: CompositionAuthoringSnapshot, workContext: 'PLAN' | 'TEMPORARY'): PlannerResult | null {
  const compiled = compile(snapshot); if (!compiled) return null;
  const proposalId = newId();
  if (workContext !== 'PLAN') return { proposalId, result: 'CLARIFICATION_REQUIRED', validationErrors: [], warnings: [],
    clarification: { missingRequirements: ['每日摘要需要持续计划，请先将原目标转为计划后重新核对组合。'] } };
  return { proposalId, result: 'PLAN_DRAFT', validationErrors: [], warnings: [], methodRefs: compiled.proof.methods.map(method => method.ref),
    runtimeCompilation: compiled.proof,
    proposal: { proposalId, intentSummary: snapshot.sourceGoal.statement, domain: compiled.definition.domain, scenarioKey: 'daily_life.errands', scenarioRevision: 2,
      strategyKey: 'PERIODIC_SUMMARY', requiredFacts: [], selectedTruthRefs: [], requiredCapabilities: [], selectedSkillIds: [], toolRequirements: [],
      draftDefinition: compiled.definition as unknown as Record<string, unknown>, missingRequirements: [], warnings: [], riskHints: ['R1'],
      explanation: '已按平台支持的组合准备每日摘要草稿：北京时间09:00汇总App内已收录的重要事项，最多五项，并按原政策发送站内提醒。请审阅后确认计划；启动和执行仍沿原流程。' } };
}
export function assertCompiledCompositionResult(snapshot: CompositionAuthoringSnapshot, payload: Record<string, unknown>) {
  const expected = compile(snapshot);
  if (!expected) {
    if (payload.runtimeCompilation) throw new ConflictException('COMPOSITION_RUNTIME_UNSUPPORTED');
    return null;
  }
  if (payload.result !== 'PLAN_DRAFT') return null;
  const parsed = compositionRuntimeCompilationSchema.safeParse(payload.runtimeCompilation), proposal = payload.proposal as { draftDefinition?: unknown } | undefined;
  try {
    if (!parsed.success || catalogHash(parsed.data) !== catalogHash(expected.proof) || !proposal?.draftDefinition
      || definitionHash(normalizePlanDefinition(proposal.draftDefinition as PlanDefinitionInput)) !== expected.proof.definitionHash
      || catalogHash(payload.methodRefs) !== catalogHash(expected.proof.methods.map(method => method.ref))) throw new Error('invalid');
  } catch { throw new ConflictException('COMPOSITION_RUNTIME_COMPILATION_CHANGED'); }
  return expected.proof;
}
