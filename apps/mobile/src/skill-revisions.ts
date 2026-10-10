import { skillCapabilitySchema, skillRepositoryImportSchema, type SkillCapability, type SkillRepositoryProjection } from '@lazy-armor/plan-schema/mobile';

export interface SkillRevisionPreview {
  repositoryId: string; repositoryVersion: number; entryId: string; baseRevisionId: string;
  previous: SkillCapability; manifest: SkillCapability;
}

/** Local preview only. The server remains responsible for ownership, CAS and immutability. */
export function prepareSkillRevision(text: string, repo: SkillRepositoryProjection, entryId: string): SkillRevisionPreview {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes > 120000) throw new Error('请选择不超过 120 KB 的方法文件。');
  }
  const entry = repo.entries.find(item => item.id === entryId);
  if (repo.status !== 'ACTIVE' || !entry) throw new Error('仓库已变化，请返回仓库核对。');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('请选择有效的 JSON 方法文件。'); }
  const single = skillCapabilitySchema.safeParse(raw), pack = single.success ? null : skillRepositoryImportSchema.safeParse(raw);
  const manifest = single.success ? single.data : pack?.success ? pack.data.entries.find(item => item.name === entry.manifest.name) : undefined;
  if (!manifest || manifest.name !== entry.manifest.name) throw new Error('文件必须包含当前方法，名称与声明格式需一致。');
  if (manifest.version === entry.manifest.version) throw new Error('当前版本不能改写，请在文件中提供新的版本号。');
  return { repositoryId: repo.id, repositoryVersion: repo.version, entryId, baseRevisionId: entry.revisionId,
    previous: entry.manifest, manifest };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => JSON.stringify(key) + ':' + stable(item)).join(',') + '}';
  return JSON.stringify(value) ?? '';
}

export function skillRevisionChanges(previous: SkillCapability, next: SkillCapability): string[] {
  const labels: Partial<Record<keyof SkillCapability, string>> = { description: '方法说明', domain: '适用领域', input: '输入说明', output: '输出说明',
    requiredCapabilities: '所需能力', permission: '权限声明', risk: '声明风险', verification: '核实方式', instruction: '规划参考内容' };
  return (Object.entries(labels) as Array<[keyof SkillCapability, string]>).flatMap(([key, label]) => stable(previous[key]) === stable(next[key]) ? [] : [label]);
}

export function skillRevisionPreviewState(preview: SkillRevisionPreview, repo: SkillRepositoryProjection): 'READY' | 'SAVED' | 'STALE' {
  const entry = repo.entries.find(item => item.id === preview.entryId);
  if (repo.id !== preview.repositoryId || repo.status !== 'ACTIVE' || !entry) return 'STALE';
  if (stable(entry.manifest) === stable(preview.manifest)) return 'SAVED';
  return repo.version === preview.repositoryVersion && entry.revisionId === preview.baseRevisionId ? 'READY' : 'STALE';
}

export function skillRevisionError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('SKILL_VERSION_IMMUTABLE')) return '这个版本号已有不同内容，请提供未使用的新版本号。';
  if (message.includes('SKILL_REVISION_SUPERSEDED')) return '这个历史版本已被后续版本替代，不能重新设为当前版本。';
  if (message.includes('SKILL_REPOSITORY_CHANGED')) return '仓库已更新或移出，请刷新后重新预览。';
  return '更新未完成，请刷新查看当前版本后重试。';
}
