import { IsBoolean, IsISO8601, IsString, Matches } from 'class-validator';

const ANDROID_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class CreateMobileNotificationReceiptDto {
  @IsString() @Matches(SHA256_HEX)
  eventId!: string;

  /** Non-reversible, device-generated digest of notification text. Raw title/body are never accepted. */
  @IsString() @Matches(SHA256_HEX)
  contentHash!: string;

  @IsString() @Matches(ANDROID_PACKAGE_NAME)
  sourcePackage!: string;

  @IsISO8601()
  postedAt!: string;

  @IsISO8601()
  capturedAt!: string;

  @IsBoolean()
  hasTitle!: boolean;

  @IsBoolean()
  hasText!: boolean;
}
