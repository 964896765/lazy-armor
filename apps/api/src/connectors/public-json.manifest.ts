import { candidateCapability, type ProviderCapabilityManifest } from '@lazy-armor/connector-sdk';

/** Protocol/adapter capability only. An endpoint's content is never declared Truth. */
export const publicJsonManifest: ProviderCapabilityManifest = {
  schemaVersion: '1', providerKey: 'public_http_json', providerName: '公开 JSON 接口', revision: 1,
  accountTypes: ['PUBLIC_ENDPOINT'], sourceModes: ['OFFICIAL_API'], actionModes: ['OBSERVE'], providerReview: 'NOT_REQUIRED',
  rateLimitPolicy: 'Existing per-connection read budget; endpoint limits are not inferred', evidence: [], explicitDenials: [],
  capabilities: [{ ...candidateCapability({ key: 'READ_PUBLIC_HTTP_JSON', name: '读取公开接口数据', resource: 'PublicJsonResponse', sourceModes: ['OFFICIAL_API'] }),
    userFacingName: '读取公开接口数据', providerAvailability: 'beta', officialAvailability: 'AVAILABLE', implementationStatus: 'BETA', reviewStatus: 'NOT_REQUIRED',
    accountTypes: [], oauthScopes: [], androidPermissions: [], verificationMethods: ['TLS_JSON_RESPONSE'],
    dataBoundary: { resources: ['PublicJsonResponse'], readableFields: ['value', 'retrievedAt', 'sourceType', 'verification'], writableFields: [], purpose: ['user_requested_public_data_read'] },
    sideEffectContract: { sideEffect: false, supportsIdempotencyKey: false, supportsOperationLookup: false, retrySafety: 'safe' },
  }],
};
