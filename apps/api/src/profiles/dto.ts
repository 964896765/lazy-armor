import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateVehicleProfileDto {
  @IsString() @Length(1, 120) brand!: string;
  @IsString() @Length(1, 120) model!: string;
  @IsInt() @Min(1886) @Max(2100) year!: number;
  @IsOptional() @IsISO8601() purchasedAt?: string;
  @IsInt() @Min(0) @Max(10_000_000) mileageKm!: number;
  @IsOptional() @IsISO8601() insuranceExpiresAt?: string;
  @IsOptional() @IsISO8601() inspectionDueAt?: string;
  @IsOptional() @IsISO8601() maintenanceDueAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) maintenanceMileageKm?: number;
  @IsOptional() @IsISO8601() tireInstalledAt?: string;
  @IsOptional() @IsISO8601() batteryInstalledAt?: string;
}

export class UpdateVehicleMileageDto {
  @IsInt() @Min(0) @Max(10_000_000) mileageKm!: number;
  @IsOptional() @IsISO8601() recordedAt?: string;
}

export class CreateDigitalAccountProfileDto {
  @IsString() @Length(1, 120) serviceName!: string;
  @IsIn(['active', 'trial', 'cancelled', 'none']) subscriptionStatus!: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsIn(['connected', 'degraded', 'disconnected', 'none']) connectionStatus!: string;
  @IsOptional() @IsISO8601() securityReminderAt?: string;
  @IsIn(['current', 'stale', 'unknown', 'not_configured']) backupStatus!: string;
}

export class CreateRecurringItemProfileDto {
  @IsIn(['life', 'housing', 'work']) domain!: 'life' | 'housing' | 'work';
  @IsString() @Length(1, 80) category!: string;
  @IsString() @Length(1, 160) title!: string;
  @IsISO8601() nextDueAt!: string;
  @IsOptional() @IsInt() @Min(1) @Max(3650) recurrenceDays?: number;
  @IsInt() @Min(0) @Max(3650) remindBeforeDays!: number;
}

export class CompleteRecurringItemProfileDto {
  @IsOptional() @IsISO8601() completedAt?: string;
}
