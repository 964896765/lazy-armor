import { z } from 'zod';

/** Declarative guidance only. Schemas and permissions cannot create tool bindings. */
export const skillCapabilitySchema = z.object({
  name: z.string().min(2).max(80).regex(/^[A-Za-z][A-Za-z0-9_.-]+$/),
  version: z.string().max(40).regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  description: z.string().trim().min(1).max(500),
  domain: z.string().min(1).max(64),
  input: z.record(z.string(), z.json()),
  output: z.record(z.string(), z.json()),
  requiredCapabilities: z.array(z.string().min(1).max(120)).max(16),
  permission: z.array(z.enum(['READ', 'WRITE', 'NOTIFY'])).max(3),
  risk: z.enum(['R0', 'R1', 'R2', 'R3', 'R4']),
  verification: z.array(z.enum(['READ_BACK', 'USER_CONFIRMATION', 'PROVIDER_RECEIPT', 'STRUCTURED_EVIDENCE'])).min(1).max(4),
  instruction: z.string().trim().min(1).max(6000),
}).strict();
export const skillRepositoryImportSchema = z.object({
  schemaVersion: z.literal('skill-repository.v1'),
  requestId: z.string().min(1).max(160),
  name: z.string().trim().min(1).max(120),
  sourceType: z.enum(['USER', 'GITHUB', 'COMMUNITY']),
  sourceUrl: z.string().url().max(1000).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  }).optional(),
  entries: z.array(skillCapabilitySchema).min(1).max(12),
}).strict().superRefine((value, ctx) => {
  if (value.sourceType !== 'USER' && !value.sourceUrl) ctx.addIssue({ code: 'custom', message: 'A third-party repository requires its source URL' });
  if (value.sourceType === 'GITHUB' && value.sourceUrl && new URL(value.sourceUrl).hostname !== 'github.com') ctx.addIssue({ code: 'custom', message: 'GitHub source requires a github.com URL' });
  if (new Set(value.entries.map(entry => entry.name)).size !== value.entries.length) ctx.addIssue({ code: 'custom', message: 'Entry names must be unique in an import' });
});
export type SkillCapability = z.infer<typeof skillCapabilitySchema>;
export type SkillRepositoryImport = z.infer<typeof skillRepositoryImportSchema>;
export const skillMethodRefSchema = z.object({
  repositoryId: z.string().uuid(), repositoryVersion: z.number().int().min(1),
  entryId: z.string().uuid(), revisionId: z.string().uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const skillMethodRefsSchema = z.array(skillMethodRefSchema).max(3).superRefine((refs, ctx) => {
  if (new Set(refs.map(ref => ref.entryId)).size !== refs.length)
    ctx.addIssue({ code: 'custom', message: 'Select each method at most once' });
});
export type SkillMethodRef = z.infer<typeof skillMethodRefSchema>;
export interface ConversationMethodProjection {
  ref: SkillMethodRef; name: string; version: string; repositoryName: string;
  state: 'CURRENT' | 'CHANGED' | 'UNAVAILABLE'; executionAuthorized: false;
}
export interface SkillRepositoryProjection {
  id: string;
  name: string;
  sourceType: string;
  sourceUrl: string | null;
  provenance: 'USER_IMPORTED';
  enabled: boolean;
  status: string;
  version: number;
  entries: Array<{ id: string; revisionId: string; contentHash: string; manifest: SkillCapability }>;
  executionAuthorized: false;
}
