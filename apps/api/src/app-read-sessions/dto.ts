import { ArrayMaxSize, ArrayUnique, ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, Min, MaxLength, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { UI_READ_CONSENT_VERSION } from '@lazy-armor/plan-schema';
import { APP_READ_SESSION_EVENT_TYPES, APP_READ_SESSION_MAX_SECONDS, APP_READ_SESSION_MODES, MOBILE_CANDIDATE_KIND_VALUES, type AppReadSessionEventType, type AppReadSessionMode } from '@lazy-armor/plan-schema';

const SHA256 = /^[a-f0-9]{64}$/;
const ANDROID_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

class UiReadConsentDto {
  @IsIn([UI_READ_CONSENT_VERSION]) version!: typeof UI_READ_CONSENT_VERSION;
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(30) @ArrayUnique() @IsString({ each: true }) @MaxLength(255, { each: true }) requestedFields!: string[];
}

export class CreateAppReadSessionDto {
  @IsUUID() connectionId!: string;
  @IsString() @Matches(ANDROID_PACKAGE) targetPackage!: string;
  @IsArray() @ArrayNotEmpty() @IsIn(APP_READ_SESSION_MODES, { each: true }) modes!: AppReadSessionMode[];
  @IsInt() @Min(30) @Max(APP_READ_SESSION_MAX_SECONDS) durationSeconds!: number;
  @ValidateIf(input => input.modes?.includes('UI_READ') || input.uiReadConsent !== undefined)
  @ValidateNested() @IsObject() @Type(() => UiReadConsentDto) uiReadConsent?: UiReadConsentDto;
}

export class AppReadHeartbeatDto {
  @IsString() @Matches(SHA256) eventKey!: string;
  @IsString() @Matches(ANDROID_PACKAGE) foregroundPackage!: string;
  @IsBoolean() usageAccessGranted!: boolean;
  @IsIn(['WAITING_FOREGROUND', 'READING']) nativeStatus!: 'WAITING_FOREGROUND' | 'READING';
  @IsISO8601() observedAt!: string;
}

export class CreateAppReadSessionEventDto {
  @IsString() @Matches(SHA256) eventKey!: string;
  @IsIn(APP_READ_SESSION_EVENT_TYPES) eventType!: AppReadSessionEventType;
  @IsOptional() @IsString() @Matches(ANDROID_PACKAGE) packageName?: string;
  @IsISO8601() observedAt!: string;
  @IsObject() payload!: Record<string, unknown>;
  @IsOptional() @IsString() @Matches(SHA256) evidenceHash?: string;
  @ValidateIf((input: CreateAppReadSessionEventDto) => input.eventType === 'NOTIFICATION_CAPTURED' || input.eventType === 'SHARE_CAPTURED')
  @IsIn(MOBILE_CANDIDATE_KIND_VALUES) candidateKind?: string;
  @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) amountMinor?: number;
  @IsOptional() @IsIn(['CNY']) currency?: 'CNY';
}
