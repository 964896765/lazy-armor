import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreateDeviceProfileDto {
  @IsString() @Length(1, 80) type!: string;
  @IsString() @Length(1, 120) brand!: string;
  @IsString() @Length(1, 120) model!: string;
  @IsDateString() purchasedAt!: string;
  @IsOptional() @IsDateString() warrantyUntil?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) maintenanceIntervalDays?: number;
  @IsString() @IsIn(['manual', 'internal', 'test']) sourceType!: 'manual' | 'internal' | 'test';
}

export class ListDeviceProfilesDto {
  @IsOptional() @IsString() @Length(1, 80) type?: string;
}

export class CreateDeviceConsumableDto {
  @IsUUID() deviceProfileId!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsDateString() lastReplacedAt!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(3650) replacementIntervalDays!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(3650) remindBeforeDays!: number;
}

export class ListDeviceConsumablesDto {
  @IsOptional() @IsUUID() deviceProfileId?: string;
}

export class UpdateDeviceConsumableReplacementDto {
  @IsDateString() lastReplacedAt!: string;
}
