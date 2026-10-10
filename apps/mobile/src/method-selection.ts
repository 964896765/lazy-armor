import { skillCapabilitySchema, skillMethodRefsSchema, type SkillCapability, type SkillMethodRef, type SkillRepositoryProjection } from '@lazy-armor/plan-schema/mobile';

export interface SelectedMethod { ref: SkillMethodRef; repositoryName: string; manifest: SkillCapability }
export type MethodSelectionState = 'CURRENT' | 'CHANGED' | 'UNAVAILABLE' | 'CHECKING';
export interface MethodConversationRequest { mode: 'TEMPORARY'; title: string; methodRefs: SkillMethodRef[] }

/** Local choices are display snapshots. Only the original server transaction authorizes their use. */
export function addSelectedMethod(selected: readonly SelectedMethod[], repo: SkillRepositoryProjection, entryId: string): SelectedMethod[] {
  if (selected.some(item => item.ref.entryId === entryId)) throw new Error('已选择此方法，请先移除后重新选择。');
  if (selected.length >= 3) throw new Error('最多选择三个方法，请先移除一个。');
  const entry = repo.entries.find(item => item.id === entryId);
  if (repo.status !== 'ACTIVE' || !repo.enabled || !entry) throw new Error('请先在仓库启用当前方法的规划参考。');
  const refs = skillMethodRefsSchema.parse([...selected.map(item => item.ref), { repositoryId: repo.id, repositoryVersion: repo.version,
    entryId: entry.id, revisionId: entry.revisionId, contentHash: entry.contentHash }]);
  return [...selected, { ref: refs.at(-1)!, repositoryName: repo.name, manifest: skillCapabilitySchema.parse(entry.manifest) }];
}

export function removeSelectedMethod(selected: readonly SelectedMethod[], entryId: string): SelectedMethod[] {
  return selected.filter(item => item.ref.entryId !== entryId);
}

export function moveSelectedMethod(selected: readonly SelectedMethod[], entryId: string, direction: -1 | 1): SelectedMethod[] {
  const result = [...selected], index = result.findIndex(item => item.ref.entryId === entryId), target = index + direction;
  if (index >= 0 && target >= 0 && target < result.length) [result[index], result[target]] = [result[target], result[index]];
  return result;
}

export function methodSelectionState(ref: SkillMethodRef, repo: SkillRepositoryProjection | undefined): MethodSelectionState {
  if (!repo) return 'CHECKING';
  const entry = repo.entries.find(item => item.id === ref.entryId);
  if (repo.id !== ref.repositoryId || repo.status !== 'ACTIVE' || !repo.enabled || !entry) return 'UNAVAILABLE';
  return repo.version === ref.repositoryVersion && entry.revisionId === ref.revisionId && entry.contentHash === ref.contentHash ? 'CURRENT' : 'CHANGED';
}

export function methodConversationRequest(selected: readonly SelectedMethod[]): MethodConversationRequest {
  if (!selected.length) throw new Error('请先选择至少一个方法。');
  return { mode: 'TEMPORARY', title: '方法组合会话', methodRefs: skillMethodRefsSchema.parse(selected.map(item => item.ref)) };
}

/** Refresh the exact selection; never replace a reference with the latest revision. */
export async function startMethodConversation<T>(selected: readonly SelectedMethod[], readRepository: (id: string) => Promise<SkillRepositoryProjection>,
  createConversation: (request: MethodConversationRequest) => Promise<T>): Promise<T> {
  const request = methodConversationRequest(selected);
  const repositories = await Promise.all([...new Set(request.methodRefs.map(ref => ref.repositoryId))].map(id => readRepository(id)));
  if (request.methodRefs.some(ref => methodSelectionState(ref, repositories.find(repo => repo.id === ref.repositoryId)) !== 'CURRENT'))
    throw new Error('SKILL_CONTEXT_CHANGED');
  return createConversation(request);
}
