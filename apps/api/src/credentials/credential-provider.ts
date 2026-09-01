export type Credential = Record<string, string>;

export interface CredentialProviderHealth {
  status: 'ok' | 'unavailable';
  provider: string;
}

export type CredentialProviderErrorCode = 'NOT_FOUND' | 'VERSION_NOT_FOUND' | 'REVOKED' | 'UNAVAILABLE' | 'INVALID_DATA';

export class CredentialProviderError extends Error {
  constructor(readonly code: CredentialProviderErrorCode, message: string, readonly retryable = false) {
    super(message);
    this.name = 'CredentialProviderError';
  }
}

export interface CredentialRotationResult {
  ref: string;
  version: number;
}

// 固定逻辑引用 + 单调 Secret Version。调用方必须把 current version 持久化，
// 运行时按显式版本解析；rotation 不改变 ref，revoke 可针对版本或整个引用。
export interface CredentialProvider {
  get(ref: string, version?: number): Promise<Credential>;
  set(credential: Credential): Promise<string>;
  rotate(ref: string, credential: Credential): Promise<CredentialRotationResult>;
  currentVersion(ref: string): Promise<number>;
  revokeVersion(ref: string, version: number): Promise<void>;
  revoke(ref: string): Promise<void>;
  health(): Promise<CredentialProviderHealth>;
}

export const CREDENTIAL_PROVIDER = Symbol('CREDENTIAL_PROVIDER');
