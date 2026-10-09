export interface GoalResourceCandidate {
  resourceId: string; name: string; state: 'READY' | 'UNAVAILABLE' | 'NEEDS_SELECTION'; reasons: string[];
  action: { label: string; path: string };
}
/** Current read-only resource projection for a saved, version-bound understanding. */
export interface GoalResourceMatch {
  schemaVersion: 'goal-resource-match.v1'; conversationId: string; conversationVersion: number; messageId: string; proposalId: string;
  summary: string; evaluatedAt: string; executionAuthorized: false;
  requirements: Array<{ key: string; sourcePackage?: string; resources: GoalResourceCandidate[]; reasons: string[] }>;
}
