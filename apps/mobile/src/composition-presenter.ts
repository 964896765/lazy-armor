import type { CompositionResourceOptions, CompositionResourceSelection, CompositionOptions, SkillResourceGraphRequest } from '@lazy-armor/plan-schema/mobile';
import { ConsumerPresentationMapper as p } from './consumer-presentation';

export const goalFieldLabel = { goal: '目标', motivation: '原因', currentState: '现状', resources: '已有资源', constraints: '限制', timeframe: '时间', budget: '预算', location: '地点', successCriteria: '成功标准', riskPreference: '风险偏好' };
const fieldLabels: Record<string, string> = { ...goalFieldLabel, research: '研究结果', report: '报告', content: '内容', title: '标题', summary: '摘要' };
export const compositionFieldLabel = (field: string) => fieldLabels[field] ?? field;
export type InputSource = { kind: 'GOAL'; field: keyof typeof goalFieldLabel; label: string } | { kind: 'OUTPUT'; methodId: string; field: string; label: string };
export function compositionSources(options: CompositionOptions, methodId: string, inputField: string): InputSource[] {
  const index = options.methods.findIndex(method => method.ref.entryId === methodId), type = options.methods[index]?.input?.fields[inputField];
  if (!type) return [];
  const goal: InputSource[] = type === 'string' ? (options.goal?.fields ?? []).filter(field => field.value && ['USER_STATED', 'ASSUMPTION'].includes(field.status))
    .map(field => ({ kind: 'GOAL', field: field.key, label: `${goalFieldLabel[field.key]}${field.status === 'ASSUMPTION' ? '（假设）' : ''}：${field.value!.slice(0, 180)}${field.value!.length > 180 ? '…' : ''}` })) : [];
  return [...goal, ...options.methods.slice(0, index).flatMap(method => Object.entries(method.output?.fields ?? {}).filter(([, outputType]) => outputType === type || outputType === 'integer' && type === 'number')
    .map(([field]) => ({ kind: 'OUTPUT' as const, methodId: method.ref.entryId, field, label: `${method.name} → ${compositionFieldLabel(field)}` })))];
}
export function bindCompositionInput(request: SkillResourceGraphRequest, methodId: string, inputField: string, source: InputSource | null): SkillResourceGraphRequest {
  const next = { ...request, links: request.links.filter(link => link.toMethodId !== methodId || link.inputField !== inputField), goalBindings: request.goalBindings.filter(binding => binding.methodId !== methodId || binding.inputField !== inputField) };
  if (source?.kind === 'GOAL') next.goalBindings.push({ methodId, inputField, goalField: source.field });
  if (source?.kind === 'OUTPUT') next.links.push({ fromMethodId: source.methodId, outputField: source.field, toMethodId: methodId, inputField });
  return next;
}
const issueLabels: Record<string, string> = {
  METHOD_SELECTION_REQUIRED: '请选择规划方法', GOAL_INPUT_NOT_READY: '请回原目标补齐必要条件', RESOURCE_CONTEXT_MISMATCH: '目标已变化，请重新核对',
  INPUT_CONTRACT_UNSUPPORTED: '此方法尚未提供可组合的输入说明', OUTPUT_CONTRACT_UNSUPPORTED: '此方法尚未提供可组合的输出说明',
  METHOD_RESOURCE_REFERENCE_MISMATCH: '方法版本与资源核对结果不一致', RESOURCE_GAP: '所需资源尚未就绪', RESOURCE_RISK_UNKNOWN: '资源风险需要进一步核对',
  SIDE_EFFECT_RECIPE_REQUIRED: '此方法包含写入或通知，需要另行准备执行方案', MAPPING_FIELD_MISSING: '输入或输出字段已变化', MAPPING_TYPE_MISMATCH: '输入与输出类型不一致',
  DUPLICATE_INPUT_BINDING: '一个输入只能选择一个来源', GOAL_MAPPING_TYPE_MISMATCH: '目标条件不能直接用于此输入', GOAL_FIELD_UNAVAILABLE: '所选目标条件尚未提供',
  CONFIRMED_GOAL_SOURCE_ADAPTER_REQUIRED: '此历史来源暂不支持组合，请回原目标补充', REQUIRED_INPUT_MISSING: '需要选择输入来源', DELIVERY_FIELD_MISSING: '所选成果已变化',
  DUPLICATE_DELIVERY: '同一成果重复选择', METHOD_CYCLE: '方法之间存在循环依赖', GRAPH_NODE_LIMIT: '组合范围过大，请减少方法或字段',
};
export const compositionIssueLabel = (code: string) => issueLabels[code] ?? '组合仍需核对，请返回原目标';
export function compositionError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('COMPOSITION_METHODS_REQUIRED')) return '这个目标尚未选择规划方法。请从方法仓库选择后开始目标，再核对组合。';
  if (message.includes('COMPOSITION_SOURCE_REPORT_IN_PROGRESS')) return '原报告正在生成，请等本次报告结束后重新核对组合。';
  if (message.includes('COMPOSITION_RESOURCE_SELECTION_REQUIRED')) return '请为每项读取能力选择本次使用的来源。';
  if (message.includes('COMPOSITION_RESOURCE_SELECTION_UNAVAILABLE')) return '选定来源已不可用，请重新核对资源与授权。';
  if (message.includes('COMPOSITION_RESOURCE_AUTHORITY_CHANGED')) return '本次来源或授权已变化，请回原目标重新核对。';
  if (message.includes('COMPOSITION_REPORT_BINDINGS_REQUIRED')) return '此历史组合尚未固定来源，请重新核对组合后生成报告。';
  if (message.includes('COMPOSITION_REPORT_SOURCE_LIMIT')) return '本次报告最多使用三个公开来源连接，请减少范围。';
  if (message.includes('COMPOSITION_RESOURCE_SELECTION_INVALID')) return '来源选择与方法需求不一致，请重新读取后选择。';
  if (message.includes('COMPOSITION_REPORT_ADAPTER_UNSUPPORTED')) return '当前报告交付支持文本成果与公开读取。其他能力请回原目标准备执行方案。';
  if (message.includes('COMPOSITION_REPORT_CONFIRMED_SOURCE_UNSUPPORTED')) return '此报告含历史记忆或事实引用，请在原目标重新声明条件后核对组合。';
  if (message.includes('COMPOSITION_STRUCTURE_BLOCKED')) return '组合仍有缺项，请补齐输入与资源后重新核对。';
  if (message.includes('COMPOSITION_RESOURCES_CHANGED')) return '组合所需资源已变化，请重新核对资源与授权范围。';
  if (message.includes('COMPOSITION_REPLAY_MISMATCH')) return '这次提交的组合已变化，请刷新原目标查看已保存的任务。';
  if (message.includes('COMPOSITION_CONTEXT_CHANGED')) return '目标已更新或正在生成，请返回原目标查看进度，完成后重新核对。';
  if (message.includes('COMPOSITION_GOAL_SOURCE_UNAVAILABLE')) return '所选条件的原始来源已变化，请返回原目标重新补充。';
  if (message.includes('COMPOSITION_INPUT_INVALID')) return '选择范围或字段已变化，请重新读取后再选择。';
  if (message.includes('GOAL_BRIEF_VERSION_UNSUPPORTED')) return '此目标的条件格式暂不支持组合，请回原目标继续。';
  return p.error(error);
}

/** Unique ready sources are visible defaults; ambiguous sources need an explicit choice. */
export function reportResourceSelections(options: CompositionResourceOptions, choices: Record<string, string>): CompositionResourceSelection[] | null {
  const selected: CompositionResourceSelection[] = [];
  for (const requirement of options.requirements) {
    const connectionId = choices[`${requirement.methodId}:${requirement.capabilityKey}`] ?? (requirement.candidates.length === 1 ? requirement.candidates[0].connectionId : undefined);
    if (!connectionId || !requirement.candidates.some(candidate => candidate.connectionId === connectionId)) return null;
    selected.push({ methodId: requirement.methodId, capabilityKey: requirement.capabilityKey, connectionId });
  }
  return selected;
}
