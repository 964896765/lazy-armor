import { describe, expect, it } from 'vitest';
import { skillRepositoryImportSchema } from '../src/skill-capability';
const entry = { name: 'BillAnalyzeSkill', version: '1.0.0', description: '整理账单', domain: 'finance', input: { type: 'object' }, output: { type: 'object' },
  requiredCapabilities: ['bill.read'], permission: ['READ'], risk: 'R0', verification: ['STRUCTURED_EVIDENCE'], instruction: '先读取已核实账单，再分析。' };
const bundle = { schemaVersion: 'skill-repository.v1', requestId: 'import-1', name: '财务方法', sourceType: 'USER', entries: [entry] };
describe('Declarative skill capability contract', () => {
  it('rejects authority fields, duplicate entries, and unsupported versions', () => {
    expect(skillRepositoryImportSchema.safeParse({ ...bundle, executionAuthorized: true }).success).toBe(false);
    expect(skillRepositoryImportSchema.safeParse({ ...bundle, entries: [entry, entry] }).success).toBe(false);
    expect(skillRepositoryImportSchema.safeParse({ ...bundle, entries: [{ ...entry, version: 'latest' }] }).success).toBe(false);
  });
  it('requires third-party provenance and refuses a user claim of official origin', () => {
    expect(skillRepositoryImportSchema.safeParse({ ...bundle, sourceType: 'GITHUB' }).success).toBe(false);
    expect(skillRepositoryImportSchema.safeParse({ ...bundle, sourceType: 'OFFICIAL' }).success).toBe(false);
    expect(skillRepositoryImportSchema.safeParse({ ...bundle, sourceType: 'GITHUB', sourceUrl: 'https://example.test/repo' }).success).toBe(false);
    expect(skillRepositoryImportSchema.safeParse({ ...bundle, sourceType: 'GITHUB', sourceUrl: 'https://github.com/example/methods' }).success).toBe(true);
  });
  it('rejects credential-bearing or executable source URLs', () => {
    for (const sourceUrl of ['https://user:secret@example.test/repo', 'http://example.test/repo', 'javascript:alert(1)']) {
      expect(skillRepositoryImportSchema.safeParse({ ...bundle, sourceUrl }).success).toBe(false);
    }
  });
});
