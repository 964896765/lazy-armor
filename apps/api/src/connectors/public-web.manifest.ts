import { candidateCapability, type ProviderCapabilityManifest } from '@lazy-armor/connector-sdk';
import { WEB_READ } from './public-web.connector';
export const publicWebManifest: ProviderCapabilityManifest = {
  schemaVersion: '1', providerKey: 'public_web_research', providerName: '公开网页检索', revision: 1,
  accountTypes: ['PUBLIC_WEBSITE_SCOPE'], sourceModes: ['PUBLIC_WEB'], actionModes: ['OBSERVE'], providerReview: 'NOT_REQUIRED',
  rateLimitPolicy: 'Existing read quota; at most three saved entry URLs, bounded GET requests', evidence: [], explicitDenials: [],
  capabilities: [{ ...candidateCapability({ key: WEB_READ, name: '检索并读取公开网页', resource: 'PublicWebExcerpt', sourceModes: ['PUBLIC_WEB'] }),
    userFacingName: '检索并读取公开网页', providerAvailability: 'beta', officialAvailability: 'AVAILABLE', implementationStatus: 'BETA', reviewStatus: 'NOT_REQUIRED',
    accountTypes: [], oauthScopes: [], androidPermissions: [], verificationMethods: ['TLS_PUBLIC_WEB_RESPONSE'],
    dataBoundary: { resources: ['PublicWebExcerpt'], readableFields: ['title', 'url', 'publishedAt', 'excerpt', 'retrievedAt', 'verification'], writableFields: [], purpose: ['user_requested_public_web_research'] },
    sideEffectContract: { sideEffect: false, supportsIdempotencyKey: false, supportsOperationLookup: false, retrySafety: 'safe' },
  }],
};
