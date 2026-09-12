import { ConflictException, Injectable } from '@nestjs/common';
import { CONNECTOR_RESPONSE_POLICY, verificationPolicyHash, type VerificationPolicy } from '@lazy-armor/plan-schema';

@Injectable()
export class VerificationPolicyRegistry {
  private readonly revisions = new Map<string, VerificationPolicy>();
  private readonly bindings = new Map<string, string>();
  constructor() { this.register(CONNECTOR_RESPONSE_POLICY); }
  register(policy: VerificationPolicy) {
    verificationPolicyHash(policy);
    const identity = policy.key + '@' + policy.revision;
    const prior = this.revisions.get(identity);
    if (prior && verificationPolicyHash(prior) !== verificationPolicyHash(policy)) throw new ConflictException('Verification policy revisions are immutable');
    if ((policy.providerKey === null) !== (policy.capabilityKey === null)) throw new ConflictException('Provider verification must bind an explicit capability');
    this.revisions.set(identity, structuredClone(policy));
    if (policy.providerKey && policy.capabilityKey) this.bindings.set(policy.providerKey + ':' + policy.capabilityKey, identity);
  }
  select(providerKey: string | null, capabilityKey: string | null): VerificationPolicy {
    const identity = this.bindings.get(providerKey + ':' + capabilityKey) ?? 'connector-response@1';
    return structuredClone(this.revisions.get(identity)!);
  }
  list() { return [...this.revisions.values()].map((policy) => ({ ...structuredClone(policy), definitionHash: verificationPolicyHash(policy) })); }
}
