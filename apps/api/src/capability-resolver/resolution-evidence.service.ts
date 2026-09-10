import { Injectable } from '@nestjs/common';
import type { ResolutionCandidate } from '@lazy-armor/connector-sdk';

export type ResolutionEvidence = Pick<ResolutionCandidate, 'accountSatisfied' | 'deviceSatisfied' | 'reality' | 'observedAt' | 'costMicros' | 'latencyMs' | 'reliability'>;
export interface ResolutionEvidenceContext {
  userId: string; connectionId: string; capabilityKey: string; resource: string; planVersionId: string;
}
export type ResolutionEvidenceHook = (context: ResolutionEvidenceContext) => Promise<ResolutionEvidence>;

/** Server-side adapter registration only. No HTTP endpoint can supply capability evidence. */
@Injectable()
export class ResolutionEvidenceService {
  private readonly hooks = new Map<string, ResolutionEvidenceHook>();
  register(providerKey: string, hook: ResolutionEvidenceHook) {
    if (this.hooks.has(providerKey)) throw new Error(`Resolution evidence hook already registered: ${providerKey}`);
    this.hooks.set(providerKey, hook);
  }
  async read(providerKey: string, context: ResolutionEvidenceContext): Promise<ResolutionEvidence | null> {
    const hook = this.hooks.get(providerKey);
    if (!hook) return null;
    try { return await hook(context); } catch { return null; }
  }
}
