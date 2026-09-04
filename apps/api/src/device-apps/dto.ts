import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const ANDROID_PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class CreateDeviceAppConnectionDto {
  @IsString() @Length(1, 64)
  trustedDeviceId!: string;

  @IsString() @Length(1, 128)
  deviceId!: string;

  @IsString() @Length(3, 255) @Matches(ANDROID_PACKAGE_NAME)
  packageName!: string;

  @IsString() @Length(1, 120)
  displayName!: string;

  @IsOptional() @IsString() @Length(1, 120)
  versionName?: string;

  @IsOptional() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER)
  versionCode?: number;

  @IsBoolean()
  launchable!: boolean;

  /** SHA-256 of the local discovery tuple. It records the client claim without sending an app inventory. */
  @IsString() @Matches(SHA256_HEX)
  discoveryFingerprint!: string;

  @IsArray()
  @IsIn(['open_app', 'receive_share', 'notification_read', 'deep_link'], { each: true })
  modes!: string[];
}

export class UpdateDeviceAppConnectionDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsArray()
  @IsIn(['open_app', 'receive_share', 'notification_read', 'deep_link'], { each: true })
  modes?: string[];
}
