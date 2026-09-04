import { IsString, Length, Matches } from 'class-validator';

const SHA256_HEX = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export class CreateTrustedDeviceChallengeDto {
  @IsString() @Length(1, 128)
  deviceId!: string;

  /** Stable opaque identifier derived from the local key, never a hardware serial. */
  @IsString() @Length(1, 128)
  keyId!: string;

  /** DER SubjectPublicKeyInfo, encoded as standard base64. */
  @IsString() @Length(64, 4096) @Matches(BASE64)
  publicKeySpki!: string;

  @IsString() @Matches(SHA256_HEX)
  publicKeyFingerprint!: string;
}

export class VerifyTrustedDeviceChallengeDto {
  /** ASN.1 DER ECDSA signature for the exact server-defined challenge payload, base64 encoded. */
  @IsString() @Length(8, 2048) @Matches(BASE64)
  signature!: string;
}
