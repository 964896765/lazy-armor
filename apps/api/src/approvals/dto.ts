import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import type { RiskLevel } from '@lazy-armor/plan-schema';

export class ApprovalDecisionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @MaxLength(120) deviceId?: string;
  @IsOptional() @IsString() confirmation?: string;
}

export class CreateTemporaryAuthorizationDto {
  @IsUUID() planVersionId!: string;
  @IsUUID() connectionId!: string;
  @IsOptional() @IsString() @MaxLength(100) capabilityKey?: string;
  @IsOptional() @IsString() @MaxLength(64) actionType?: string;
  @IsString() @IsIn(['R0', 'R1', 'R2', 'R3']) maximumRiskLevel!: RiskLevel;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) amountLimitMinor?: number;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsDateString() expiresAt!: string;
}
