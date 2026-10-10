import type { SkillMethodRef, SkillCapability } from './skill-capability';

export interface GoalResourceCandidate {
  resourceId: string; name: string; state: 'READY' | 'UNAVAILABLE' | 'NEEDS_SELECTION'; reasons: string[];
  action: { label: string; path: string };
  operation?: 'read' | 'execute' | 'subscribe'; riskLevel?: string;
}
export interface ResourceRequirementProjection { key: string; sourcePackage?: string; resources: GoalResourceCandidate[]; reasons: string[] }
/** Current read-only resource projection for a saved, version-bound understanding. */
export interface GoalResourceMatch {
  schemaVersion: 'goal-resource-match.v1'; conversationId: string; conversationVersion: number; messageId: string; proposalId: string;
  summary: string; evaluatedAt: string; executionAuthorized: false;
  requirements: ResourceRequirementProjection[];
}
/** Method declarations describe possible needs, never an executable binding. */
export interface MethodResourceMatch {
  schemaVersion: 'method-resource-match.v1'; conversationId: string; conversationVersion: number;
  workContext: 'TEMPORARY' | 'PLAN';
  evaluatedAt: string; executionAuthorized: false;
  methods: Array<{ ref: SkillMethodRef; name: string; version: string; repositoryName: string;
    declaredRisk: SkillCapability['risk']; requirements: ResourceRequirementProjection[] }>;
}
