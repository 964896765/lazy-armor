/** Read-only owner projection; a usable capability does not authorize an action. */
export interface ConnectionCapability {
  key: string;
  canonicalKey: string | null;
  name: string;
  operation: 'read' | 'execute' | 'subscribe';
  sourceModes: string[];
  riskLevel: string;
  providerAvailability: string;
  implementation: string;
  grant: string;
  health: string;
  usable: boolean;
  reasons: string[];
  dataBoundary: { resources: string[]; readableFields: string[]; writableFields: string[]; purpose: string[] } | null;
  verificationMethods: string[];
  explicitDenials: string[];
  evidence: { checkedAt: string | null; validUntil: string | null; fresh: boolean; reasonCode: string | null };
}
export interface ConnectionCapabilityView {
  connectionId: string;
  providerKey: string;
  providerName: string;
  manifestRevision: number | null;
  manifestHash: string | null;
  providerReview: string;
  connectionStatus: string;
  connectionStatusReason: string | null;
  evaluatedAt: string;
  executionAuthorized: false;
  capabilities: ConnectionCapability[];
}
