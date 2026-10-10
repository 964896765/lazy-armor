import { describe, expect, it, vi } from 'vitest';
import { SkillSourceService, skillSourceUrl, type SkillPackageFetcher } from '../src/portable-skills/skill-source.service';
import type { SkillRepositoriesService } from '../src/portable-skills/skill-repositories.service';
const manifest = { name: 'WeatherAnalysisSkill', version: '1.0.0', description: 'Weather analysis', domain: 'travel', input: {}, output: {},
  requiredCapabilities: ['weather.read'], permission: ['READ'], risk: 'R0', verification: ['STRUCTURED_EVIDENCE'], instruction: 'Analyze the acquired forecast.' };
const commit = 'a'.repeat(40);
const url = `https://github.com/example/methods/blob/${commit}/skills.json`;
describe('Remote method packages retain explicit source and preview identity', () => {
  it('pins GitHub imports and rejects private, mutable and credential-bearing URLs', () => {
    expect(skillSourceUrl(url).fetchUrl.href).toBe(`https://raw.githubusercontent.com/example/methods/${commit}/skills.json`);
    for (const invalid of ['http://example.com/a.json', 'https://127.0.0.1/a.json', 'https://user:secret@example.com/a.json',
      'https://github.com/example/methods/blob/main/skills.json', 'https://example.com/a.json?token=secret']) expect(() => skillSourceUrl(invalid)).toThrow();
  });
  it('overrides remote source authority, hashes preview content, and rejects content changes before import', async () => {
    const fetch = vi.fn().mockResolvedValue({ schemaVersion: 'skill-repository.v1', name: 'Third party methods', sourceType: 'OFFICIAL', requestId: 'remote-owned', entries: [manifest] });
    const save = vi.fn().mockResolvedValue({ id: 'imported' });
    const service = new SkillSourceService({ fetch } as unknown as SkillPackageFetcher, { import: save } as unknown as SkillRepositoriesService);
    const preview = await service.preview(url);
    expect(preview).toMatchObject({ package: { sourceType: 'GITHUB', sourceUrl: url }, executionAuthorized: false });
    expect(preview.package).not.toHaveProperty('requestId');
    await service.import('owner', { url, contentHash: preview.contentHash, requestId: 'owner-attempt' });
    expect(save).toHaveBeenCalledWith('owner', { ...preview.package, requestId: 'owner-attempt' });
    fetch.mockResolvedValueOnce({ schemaVersion: 'skill-repository.v1', name: 'Changed', entries: [manifest] });
    await expect(service.import('owner', { url, contentHash: preview.contentHash, requestId: 'next' })).rejects.toThrow('SKILL_SOURCE_CHANGED');
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('does not import remote executable or oversized declarations', async () => {
    const save = vi.fn(); const fetch = vi.fn().mockResolvedValue({ schemaVersion: 'skill-repository.v1', name: 'Unsafe', entries: [manifest], execute: 'run-shell' });
    const service = new SkillSourceService({ fetch } as unknown as SkillPackageFetcher, { import: save } as unknown as SkillRepositoriesService);
    await expect(service.preview(url)).rejects.toThrow('Invalid or oversized'); expect(save).not.toHaveBeenCalled();
  });
});
