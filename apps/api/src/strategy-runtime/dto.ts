import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
import { PLAN_STRATEGIES, type StrategyKey } from '@lazy-armor/plan-schema';

export class BindStrategyRuntimeDto {
  @IsUUID() planVersionId!: string;
  @IsString() @Length(1, 120) scenarioKey!: string;
  @IsOptional() @IsInt() @Min(1) scenarioRevision?: number;
  @IsOptional() @IsString() @IsIn(PLAN_STRATEGIES.map((item) => item.key)) strategy?: StrategyKey;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
}

export class DependencyQueryDto {
  @IsOptional() @IsString() @Length(1, 180) factKey?: string;
  @IsOptional() @IsString() @Length(1, 120) resourceType?: string;
  @IsOptional() @IsString() @Length(1, 255) subjectKey?: string;
}

export class ScenarioBindingsQueryDto {
  @IsString() @Length(1, 120) scenarioKey!: string;
}
