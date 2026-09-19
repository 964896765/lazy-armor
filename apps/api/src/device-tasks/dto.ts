import { IsIn, IsObject, IsString, Matches, MaxLength } from 'class-validator';

const SHA256 = /^[a-f0-9]{64}$/;

export class HeartbeatDeviceDto {
  @IsIn(['online', 'offline', 'unknown'])
  onlineState!: 'online' | 'offline' | 'unknown';
}

export class HeartbeatTaskDto {
  @IsString() @Matches(SHA256)
  claimToken!: string;
}

export class CompleteDeviceTaskDto {
  @IsString() @Matches(SHA256)
  claimToken!: string;

  @IsObject()
  result!: Record<string, unknown>;
}

export class FailDeviceTaskDto {
  @IsString() @Matches(SHA256)
  claimToken!: string;

  @IsString() @MaxLength(120)
  errorCode!: string;
}
