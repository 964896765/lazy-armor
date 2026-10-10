import { describe, expect, it } from 'vitest';
import type { SkillCapability, SkillRepositoryProjection } from '@lazy-armor/plan-schema/mobile';
import { prepareSkillRevision, skillRevisionChanges, skillRevisionError, skillRevisionPreviewState } from './skill-revisions';

const manifest: SkillCapability = { name: 'RevisionMethod', version: '1.0.0', description: '版本核对方法', domain: 'device', input: {}, output: {},
  requiredCapabilities: [], permission: [], risk: 'R0', verification: ['USER_CONFIRMATION'], instruction: '按已有规则提出建议。' };
const repo: SkillRepositoryProjection = { id: 'repo', version: 2, name: '方法库', sourceType: 'USER', sourceUrl: null, provenance: 'USER_IMPORTED',
  enabled: false, status: 'ACTIVE', executionAuthorized: false, entries: [{ id: 'entry', revisionId: 'revision', contentHash: 'a'.repeat(64), manifest }] };
const next = { ...manifest, version: '1.1.0', requiredCapabilities: ['BROWSER_SUBMIT_FORM'], permission: ['WRITE'] as const, risk: 'R3' as const };
const text = JSON.stringify(next);

describe('User-provided immutable revision preview', () => {
  it('binds a standalone manifest to the reviewed repository version without changing its planning switch', () => {
    const preview = prepareSkillRevision(text, repo, 'entry');
    expect(preview).toMatchObject({ repositoryId: 'repo', repositoryVersion: 2, entryId: 'entry', baseRevisionId: 'revision', manifest: next });
    expect(skillRevisionPreviewState(preview, repo)).toBe('READY'); expect(repo.enabled).toBe(false); expect(repo.entries[0].manifest).toEqual(manifest);
  });
  it('selects only the matching method from a strict existing package', () => {
    const pack = { schemaVersion: 'skill-repository.v1', requestId: 'file', name: '包', sourceType: 'USER',
      entries: [{ ...manifest, name: 'OtherMethod' }, next] };
    expect(prepareSkillRevision(JSON.stringify(pack), repo, 'entry').manifest).toEqual(next);
    expect(() => prepareSkillRevision(JSON.stringify({ ...pack, entries: [pack.entries[0]] }), repo, 'entry')).toThrow('当前方法');
  });
  it.each([{ ...next, executionAuthorized: true }, { ...next, credential: 'should-never-bind' }, { ...next, name: 'OtherMethod' },
    { ...next, version: 'latest' }, { ...next, version: manifest.version }])('rejects an invalid/authority-bearing or same-version upload %#', raw => {
    expect(() => prepareSkillRevision(JSON.stringify(raw), repo, 'entry')).toThrow();
  });
  it('rejects malformed JSON, oversized UTF-8 content, archival and a missing entry', () => {
    expect(() => prepareSkillRevision('{', repo, 'entry')).toThrow('JSON');
    const oversized = JSON.stringify({ ...next, input: { text: '汉'.repeat(41000) } });
    expect(oversized.length).toBeLessThan(120000);
    expect(() => prepareSkillRevision(oversized, repo, 'entry')).toThrow('120 KB');
    expect(() => prepareSkillRevision(text, { ...repo, status: 'ARCHIVED' }, 'entry')).toThrow('仓库已变化');
    expect(() => prepareSkillRevision(text, repo, 'missing')).toThrow('仓库已变化');
  });
  it('fences preview after settings, revision, owner-target identity or archive changes; recognizes a saved replay', () => {
    const preview = prepareSkillRevision(text, repo, 'entry');
    for (const changed of [{ ...repo, version: 3 }, { ...repo, id: 'other-repo' }, { ...repo, status: 'ARCHIVED' },
      { ...repo, entries: [{ ...repo.entries[0], revisionId: 'new-revision' }] }]) expect(skillRevisionPreviewState(preview, changed)).toBe('STALE');
    const saved = { ...repo, version: 3, entries: [{ ...repo.entries[0], revisionId: 'new-revision', manifest: preview.manifest }] };
    expect(skillRevisionPreviewState(preview, saved)).toBe('SAVED');
  });
  it('shows required capability, permission and risk changes, including nested input/output changes', () => {
    expect(skillRevisionChanges(manifest, prepareSkillRevision(text, repo, 'entry').manifest)).toEqual(['所需能力', '权限声明', '声明风险']);
    expect(skillRevisionChanges({ ...manifest, input: { a: 1, b: { c: 2, d: 3 } } }, { ...manifest, input: { b: { d: 3, c: 2 }, a: 1 } })).toEqual([]);
    expect(skillRevisionChanges(manifest, { ...manifest, input: { required: true }, output: { receipt: true }, instruction: '新参考内容' })).toEqual(['输入说明', '输出说明', '规划参考内容']);
  });
  it('explains immutable version conflicts, superseded replay and stale repository failures', () => {
    expect(skillRevisionError(new Error('SKILL_VERSION_IMMUTABLE'))).toContain('已有不同内容');
    expect(skillRevisionError(new Error('SKILL_REVISION_SUPERSEDED'))).toContain('历史版本');
    expect(skillRevisionError(new Error('SKILL_REPOSITORY_CHANGED'))).toContain('重新预览');
    expect(skillRevisionError(new Error('timeout'))).toContain('刷新查看当前版本');
  });
});
