import { IsIn, IsISO8601, IsObject, IsString, Matches, MaxLength } from 'class-validator';
import { PARSER_KEYS, type MobileSourceMode } from '@lazy-armor/plan-schema';

const SHA256_HEX = /^[a-f0-9]{64}$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export class CreateMobileObservationDto {
  /** The device's self-declared identity; must match the signed trusted device. */
  @IsString() @MaxLength(128) deviceId!: string;

  @IsString() @Matches(ANDROID_PACKAGE) @MaxLength(255) packageName!: string;

  @IsIn(['NOTIFICATION', 'SHARE', 'APP_READ_SESSION']) sourceMode!: MobileSourceMode;

  @IsString() @MaxLength(255) eventId!: string;

  @IsIn(PARSER_KEYS) parserKey!: string;

  @IsString() @Matches(SHA256_HEX) evidenceHash!: string;

  @IsISO8601() observedAt!: string;

  @IsObject() payload!: Record<string, unknown>;
}
