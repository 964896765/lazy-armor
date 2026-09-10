import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDefined, IsIn, IsInt, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { SOURCE_MODES, type CapabilityRequirement, type SourceMode } from '@lazy-armor/connector-sdk';

export class CapabilityRequirementDto implements CapabilityRequirement {
  @IsIn(['1']) schemaVersion!: '1';
  @IsString() @Length(1, 100) capabilityKey!: string;
  @IsString() @Length(1, 120) resource!: string;
  @IsIn(['read', 'execute']) operation!: 'read' | 'execute';
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 120, { each: true }) fields!: string[];
  @IsString() @Length(1, 120) purpose!: string;
  @IsIn(['CLAIMED', 'OBSERVED', 'CORROBORATED', 'VERIFIED']) minimumReality!: CapabilityRequirement['minimumReality'];
  @IsInt() @Min(0) @Max(31536000) maxAgeSeconds!: number;
  @IsIn(['R0', 'R1', 'R2', 'R3', 'R4']) maxRisk!: CapabilityRequirement['maxRisk'];
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) maxCostMicros!: number;
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 80, { each: true }) preferredProviders!: string[];
  @IsArray() @ArrayMaxSize(20) @IsIn(SOURCE_MODES, { each: true }) preferredSourceModes!: SourceMode[];
}

export class ResolveCapabilityDto {
  @IsUUID() planVersionId!: string;
  @IsString() @Length(1, 120) requestKey!: string;
  @IsDefined() @ValidateNested() @Type(() => CapabilityRequirementDto) requirement!: CapabilityRequirementDto;
}
