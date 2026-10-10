import { describe, expect, it, vi } from 'vitest';
import type { SkillRepositoryProjection } from '@lazy-armor/plan-schema/mobile';
import { addSelectedMethod, methodConversationRequest, methodSelectionState, moveSelectedMethod, removeSelectedMethod, startMethodConversation, type SelectedMethod } from './method-selection';

const uuid = (number: number) => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
function repository(number = 1): SkillRepositoryProjection {
  return { id: uuid(number), version: 2, name: '方法库', sourceType: 'USER', sourceUrl: null, provenance: 'USER_IMPORTED', enabled: true, status: 'ACTIVE', executionAuthorized: false,
    entries: [0, 1].map(index => ({ id: uuid(number * 10 + index), revisionId: uuid(number * 100 + index), contentHash: 'a'.repeat(64),
      manifest: { name: index ? 'SecondMethod' : 'SharedMethod', version: '1.0.0', description: '选择方法', domain: 'device', input: {}, output: {},
        requiredCapabilities: ['notification.send'], permission: ['NOTIFY'], risk: 'R3', verification: ['USER_CONFIRMATION'], instruction: '仅作为规划参考。' } })) };
}
const pick = (repo: SkillRepositoryProjection, selected: SelectedMethod[] = [], index = 0) => addSelectedMethod(selected, repo, repo.entries[index].id);

describe('Ordered immutable method choices on the original conversation contract', () => {
  it('combines same-repository methods and equal names from another repository by identity', () => {
    const first = repository(), other = repository(2);
    const selected = pick(other, pick(first, pick(first), 1));
    expect(methodConversationRequest(selected).methodRefs.map(ref => ref.entryId)).toEqual([first.entries[0].id, first.entries[1].id, other.entries[0].id]);
    expect(selected.map(item => item.manifest.name)).toEqual(['SharedMethod', 'SecondMethod', 'SharedMethod']);
  });
  it('preserves reference snapshots when reordering/removing before submission', () => {
    const first = repository(), other = repository(2), selected = pick(other, pick(first, pick(first), 1));
    const ordered = moveSelectedMethod(moveSelectedMethod(selected, other.entries[0].id, -1), other.entries[0].id, -1);
    const result = methodConversationRequest(removeSelectedMethod(ordered, first.entries[1].id));
    expect(result.methodRefs).toEqual([selected[2].ref, selected[0].ref]);
    expect(selected.map(item => item.ref.entryId)).toEqual([first.entries[0].id, first.entries[1].id, other.entries[0].id]);
  });
  it('refuses duplicates and a fourth selection without replacing the original revisions', () => {
    const first = repository(), other = repository(2), one = pick(first), three = pick(other, pick(first, one, 1));
    expect(() => pick({ ...first, version: 3 }, one)).toThrow('先移除');
    expect(() => pick(repository(3), three)).toThrow('最多选择三个');
    expect(three.map(item => item.ref.repositoryVersion)).toEqual([2, 2, 2]);
  });
  it.each(['DISABLED', 'ARCHIVED', 'MISSING'])('refuses an unavailable %s choice without enabling anything', state => {
    const repo = repository();
    if (state === 'DISABLED') repo.enabled = false;
    if (state === 'ARCHIVED') repo.status = 'ARCHIVED';
    expect(() => addSelectedMethod([], repo, state === 'MISSING' ? uuid(99) : repo.entries[0].id)).toThrow('启用');
    expect(repo.enabled).toBe(state !== 'DISABLED');
  });
  it('copies display declarations so refreshing the catalogue cannot mutate a reviewed choice', () => {
    const repo = repository(), selected = pick(repo);
    repo.entries[0].manifest.requiredCapabilities.push('BROWSER_SUBMIT_FORM'); repo.entries[0].manifest.instruction = 'changed';
    repo.entries[0].revisionId = uuid(999);
    expect(selected[0].manifest.requiredCapabilities).toEqual(['notification.send']); expect(selected[0].manifest.instruction).toBe('仅作为规划参考。');
    expect(selected[0].ref.revisionId).toBe(uuid(100));
  });
  it('marks settings/revision/hash changes and unavailable repositories without substituting a new reference', () => {
    const repo = repository(), ref = pick(repo)[0].ref;
    expect(methodSelectionState(ref, repo)).toBe('CURRENT'); expect(methodSelectionState(ref, undefined)).toBe('CHECKING');
    for (const changed of [{ ...repo, version: 3 }, { ...repo, entries: [{ ...repo.entries[0], revisionId: uuid(999) }] },
      { ...repo, entries: [{ ...repo.entries[0], contentHash: 'b'.repeat(64) }] }]) expect(methodSelectionState(ref, changed)).toBe('CHANGED');
    for (const changed of [{ ...repo, enabled: false }, { ...repo, status: 'ARCHIVED' }, { ...repo, id: uuid(9) }, { ...repo, entries: [] }])
      expect(methodSelectionState(ref, changed)).toBe('UNAVAILABLE');
    expect(ref.repositoryVersion).toBe(2); expect(ref.revisionId).toBe(uuid(100));
  });
  it('sends only strict references to a new temporary conversation, never method declarations or execution authority', () => {
    const request = methodConversationRequest(pick(repository()));
    expect(Object.keys(request)).toEqual(['mode', 'title', 'methodRefs']); expect(request.mode).toBe('TEMPORARY');
    expect(JSON.stringify(request)).not.toMatch(/instruction|permission|risk|executionAuthorized|capabilities/);
    expect(() => methodConversationRequest([])).toThrow('至少一个');
    const forged = pick(repository()); Object.assign(forged[0].ref, { executionAuthorized: true });
    expect(() => methodConversationRequest(forged)).toThrow();
  });
  it('rechecks one time per distinct repository and posts the frozen ordered references', async () => {
    const first = repository(), other = repository(2), selected = pick(other, pick(first, pick(first), 1));
    const read = vi.fn(async (id: string) => id === first.id ? first : other), create = vi.fn(async () => ({ id: 'conversation' }));
    expect(await startMethodConversation(selected, read, create)).toEqual({ id: 'conversation' });
    expect(read.mock.calls.map(call => call[0])).toEqual([first.id, other.id]); expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(methodConversationRequest(selected));
  });
  it('does not create a conversation if any refreshed choice changed or its repository could not be read', async () => {
    const repo = repository(), selected = pick(repo), create = vi.fn();
    await expect(startMethodConversation(selected, async () => ({ ...repo, version: 3 }), create)).rejects.toThrow('SKILL_CONTEXT_CHANGED');
    await expect(startMethodConversation(selected, async () => { throw new Error('404'); }, create)).rejects.toThrow('404');
    expect(create).not.toHaveBeenCalled();
  });
  it('freezes the request before async refresh so later UI changes cannot replace references in flight', async () => {
    const repo = repository(), selected = pick(repo), expected = methodConversationRequest(selected);
    let release!: (repo: SkillRepositoryProjection) => void;
    const read = new Promise<SkillRepositoryProjection>(resolve => { release = resolve; });
    const create = vi.fn(async () => ({ id: 'conversation' })), pending = startMethodConversation(selected, () => read, create);
    selected[0].ref.revisionId = uuid(999); selected.reverse(); release(repo);
    await pending; expect(create).toHaveBeenCalledWith(expected);
  });
  it('leaves a server conflict intact when a method changes after the client refresh', async () => {
    const repo = repository(), create = vi.fn(async () => { throw new Error('SKILL_CONTEXT_CHANGED'); });
    await expect(startMethodConversation(pick(repo), async () => repo, create)).rejects.toThrow('SKILL_CONTEXT_CHANGED');
    expect(create).toHaveBeenCalledOnce();
  });
});
