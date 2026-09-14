import { providerDefinitionHash, type ProviderCapabilityManifest, type OfficialEvidenceRevision, type ProviderRuntimePolicy } from '@lazy-armor/connector-sdk';
import { githubManifest, githubEvidence, githubPolicy } from './github-manifest';

// Published github@2 / evidence@1 / policy@1 stay byte-for-byte immutable.
const reviewedAt = '2026-09-14T06:00:00.000Z';
const uri = 'https://docs.github.com/en/webhooks/webhook-events-and-payloads';
const summary = 'Repository issues, pull_request and workflow_run signed refresh hints; raw SHA256 HMAC, HTTPS JSON 256KiB, durable dedupe and READ-only leased acquisition. No automatic hook creation or real-account acceptance.';
const evidence = { kind: 'OFFICIAL_DOC' as const, status: 'VERIFIED' as const, uri, verifiedAt: reviewedAt, summary };
export const githubWebhookManifest: ProviderCapabilityManifest = { ...structuredClone(githubManifest), revision: 3,
  sourceModes: ['OFFICIAL_API', 'WEBHOOK'], evidence: [...structuredClone(githubManifest.evidence), evidence],
  capabilities: githubManifest.capabilities.map((capability) => ({ ...structuredClone(capability),
    ...(capability.operation === 'read' ? { realtimeModes: ['POLL' as const, 'WEBHOOK' as const] } : {}),
    evidence: [...structuredClone(capability.evidence), evidence] })) };
export const githubWebhookEvidence: OfficialEvidenceRevision = { ...structuredClone(githubEvidence), revision: 2, uri, summary, reviewedAt,
  contentHash: providerDefinitionHash({ uri, reviewedAt, schema: 'github-refresh-hint.v1', rawAuthentication: 'HMAC_SHA256',
    maxPayloadBytes: 262144, dedupe: ['CONNECTION_DELIVERY', 'CONNECTION_RAW_HASH'], authority: 'OWNED_OFFICIAL_API_ONLY',
    worker: 'READ_ONLY_LEASE_CAS', events: ['issues', 'pull_request', 'workflow_run'] }) };
export const githubWebhookPolicy: ProviderRuntimePolicy = { ...structuredClone(githubPolicy), revision: 2, manifestRevision: 3,
  evidence: { key: githubWebhookEvidence.key, revision: 2, hash: providerDefinitionHash(githubWebhookEvidence) } };
